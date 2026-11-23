// Comprobantes mensuales (e-Ticket / e-Factura). La emisión ante DGI la hace un proveedor habilitado de CFE:
// acá se arman los comprobantes y se envían al proveedor configurado (o se registran como emitidos a mano).
import { many, one, q, tx } from './db.js';
import { getSetting } from './settings.js';

const TZ = process.env.TZ_LOCAL || 'America/Montevideo';
const r2 = (n) => Math.round(n * 100) / 100;
const BAND = { punta: 'Punta', llano: 'Llano', valle: 'Valle', unica: 'Tarifa única', simple: 'Tarifa única' };

function range(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) throw Object.assign(new Error('el período debe ser AAAA-MM'), { statusCode: 400 });
  const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`;
  return [`${m[1]}-${m[2]}-01`, next];
}

/** Líneas del comprobante: energía por franja horaria y cargos fijos por sesión. */
export function buildLines(sessions, { ivaRate, includeIva }) {
  const bands = new Map();
  let fees = 0;
  for (const s of sessions) {
    const br = Array.isArray(s.breakdown) && s.breakdown.length ? s.breakdown : [{ band: 'unica', energy_wh: s.energy_wh, amount: s.amount }];
    let sum = 0;
    for (const b of br) {
      const k = b.band || 'unica';
      const cur = bands.get(k) || { wh: 0, amount: 0 };
      cur.wh += Number(b.energy_wh || 0); cur.amount += Number(b.amount || 0); sum += Number(b.amount || 0);
      bands.set(k, cur);
    }
    fees += Math.max(0, Number(s.amount || 0) - sum); // cargo fijo por carga, si la tarifa lo tiene
  }
  const lines = [];
  for (const [band, v] of bands) {
    if (v.amount <= 0) continue;
    const kwh = v.wh / 1000;
    lines.push({ description: `Energía para carga de vehículo eléctrico · ${BAND[band] || band}`, quantity: Math.round(kwh * 1000) / 1000, unit: 'kWh', gross: r2(v.amount) });
  }
  if (fees > 0.004) lines.push({ description: 'Cargo fijo por carga', quantity: sessions.length, unit: 'carga', gross: r2(fees) });
  const factor = includeIva ? 1 + ivaRate / 100 : 1;
  for (const l of lines) {
    l.net = r2(l.gross / factor);
    l.unit_price = l.quantity ? Math.round((l.net / l.quantity) * 10000) / 10000 : l.net;
  }
  const net = r2(lines.reduce((t, l) => t + l.net, 0));
  const total = includeIva ? r2(lines.reduce((t, l) => t + l.gross, 0)) : r2(net * (1 + ivaRate / 100));
  return { lines, net, iva: r2(total - net), total };
}

/** Crea los borradores del mes para todas las cuentas con consumo (no duplica los que ya existen). */
export async function generateDrafts(month, siteId = null) {
  const [from, to] = range(month);
  const cfg = await getSetting('facturacion');
  const ivaRate = Number(cfg.iva_rate ?? 22);
  const accounts = await many(
    `SELECT a.* FROM accounts a WHERE ($1::int IS NULL OR a.site_id=$1)
        AND EXISTS (SELECT 1 FROM sessions x WHERE x.account_id=a.id AND x.status='completed' AND x.amount > 0
                     AND x.started_at >= ($2::date::timestamp AT TIME ZONE $4) AND x.started_at < ($3::date::timestamp AT TIME ZONE $4))
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.account_id=a.id AND i.period=$5 AND i.status <> 'anulada')`,
    [siteId, from, to, TZ, month],
  );
  const created = [];
  for (const a of accounts) {
    const sessions = await many(
      `SELECT energy_wh, amount, breakdown FROM sessions WHERE account_id=$1 AND status='completed' AND amount > 0
          AND started_at >= ($2::date::timestamp AT TIME ZONE $4) AND started_at < ($3::date::timestamp AT TIME ZONE $4)`,
      [a.id, from, to, TZ],
    );
    const { lines, net, iva, total } = buildLines(sessions, { ivaRate, includeIva: cfg.prices_include_iva !== false });
    const receiver = { doc_type: a.doc_type, doc_number: a.doc_number, name: a.legal_name || a.name, unit: a.unit, address: a.billing_address, email: a.billing_email || a.email };
    created.push(await one(
      `INSERT INTO invoices(account_id, period, cfe_type, net, iva, total, iva_rate, lines, receiver) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [a.id, month, a.doc_type === 'RUT' ? 'e-Factura' : 'e-Ticket', net, iva, total, ivaRate, JSON.stringify(lines), JSON.stringify(receiver)],
    ));
  }
  return created;
}

/** Envía el comprobante al proveedor de CFE configurado. Devuelve el comprobante actualizado. */
export async function issue(invoiceId, manual = null) {
  const inv = await one('SELECT * FROM invoices WHERE id=$1', [invoiceId]);
  if (!inv) throw Object.assign(new Error('comprobante no encontrado'), { statusCode: 404 });
  if (inv.status === 'emitida') return inv;
  if (inv.status === 'anulada') throw Object.assign(new Error('el comprobante está anulado'), { statusCode: 409 });
  if (manual) {
    return one(`UPDATE invoices SET status='emitida', series=$2, number=$3, issued_at=now(), provider_msg='Registrada a mano' WHERE id=$1 RETURNING *`, [inv.id, manual.series || null, manual.number || null]);
  }
  const cfg = await getSetting('facturacion');
  if (cfg.provider === 'ninguno' || !cfg.provider_url) {
    throw Object.assign(new Error('todavía no hay un proveedor de facturación electrónica configurado; podés registrar el número a mano'), { statusCode: 409 });
  }
  if (inv.cfe_type === 'e-Factura' && !inv.receiver?.doc_number) throw Object.assign(new Error('la cuenta no tiene RUT cargado'), { statusCode: 400 });
  const payload = {
    tipo: inv.cfe_type, moneda: inv.currency, referencia: `ELEC-${inv.id}`, periodo: inv.period,
    emisor: { rut: cfg.emisor_rut, razon_social: cfg.emisor_nombre, domicilio: cfg.emisor_domicilio },
    receptor: inv.receiver, iva_tasa: Number(inv.iva_rate),
    lineas: inv.lines.map((l) => ({ descripcion: l.description, cantidad: l.quantity, unidad: l.unit, precio_unitario: l.unit_price, neto: l.net, iva_tasa: Number(inv.iva_rate) })),
    totales: { neto: Number(inv.net), iva: Number(inv.iva), total: Number(inv.total) },
  };
  try {
    const res = await fetch(cfg.provider_url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.provider_token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || j.message || `el proveedor respondió ${res.status}`);
    return one(`UPDATE invoices SET status='emitida', series=$2, number=$3, issued_at=now(), provider_ref=$4, provider_msg=$5, pdf_url=$6 WHERE id=$1 RETURNING *`,
      [inv.id, j.serie ?? j.series ?? null, String(j.numero ?? j.number ?? ''), String(j.id ?? j.referencia ?? ''), j.mensaje ?? 'Emitida', j.pdf ?? j.pdf_url ?? null]);
  } catch (e) {
    await q(`UPDATE invoices SET status='error', provider_msg=$2 WHERE id=$1`, [inv.id, e.message]);
    throw Object.assign(new Error(`no se pudo emitir: ${e.message}`), { statusCode: 502 });
  }
}

export async function cancelInvoice(id) {
  const inv = await one(`UPDATE invoices SET status='anulada' WHERE id=$1 AND status IN ('borrador','error') RETURNING *`, [id]);
  if (!inv) throw Object.assign(new Error('solo se anulan borradores o comprobantes con error; uno emitido se anula con una nota de crédito en el proveedor'), { statusCode: 409 });
  return inv;
}
