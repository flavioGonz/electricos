// Consumo por hora del día, por día del mes y por franja, a partir de las lecturas de los cargadores.
// Cada incremento de energía se asigna al instante de la lectura que lo cierra (igual que la facturación).
import { many } from './db.js';
import { rateAt } from './billing.js';

const TZ = process.env.TZ_LOCAL || 'America/Montevideo';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
export const BANDS = ['valle', 'llano', 'punta', 'normal'];

/**
 * readings: [{ session_id, account, ts, energy_wh }] ordenadas por sesión y hora; tariffs: Map(session_id → tarifa).
 * Devuelve totales por franja, por hora (0-23) y por día (AAAA-MM-DD), en Wh.
 */
export function aggregate(readings, tariffs, days, since = null) {
  const empty = () => Object.fromEntries(BANDS.map((b) => [b, 0]));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...empty() }));
  const byDay = new Map(days.map((d) => [d, { day: d, ...empty() }]));
  const bands = empty();
  const accounts = new Map();
  let prev = null;
  for (const r of readings) {
    if (r.energy_wh == null) continue;
    if (prev && prev.session_id === r.session_id) {
      const wh = Number(r.energy_wh) - Number(prev.energy_wh);
      const ts = new Date(r.ts);
      if (wh > 0 && (!since || ts >= since)) {
        const t = tariffs.get(r.session_id);
        const band = t ? rateAt(t, ts).band : 'normal';
        const b = BANDS.includes(band) ? band : 'normal';
        bands[b] += wh;
        byHour[Number(hourFmt.format(ts))][b] += wh;
        const d = byDay.get(dayFmt.format(ts));
        if (d) d[b] += wh;
        if (r.account) accounts.set(r.account, (accounts.get(r.account) || 0) + wh);
      }
    }
    prev = r;
  }
  const total = Object.values(bands).reduce((a, b) => a + b, 0);
  const top = [...accounts].map(([account, wh]) => ({ account, wh })).sort((a, b) => b.wh - a.wh).slice(0, 8);
  return { total_wh: total, bands, byHour, byDay: [...byDay.values()], top };
}

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export async function consumo({ month, siteId = null, scope = null }) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw Object.assign(new Error('el período debe ser AAAA-MM'), { statusCode: 400 });
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  // Se incluye la lectura anterior al inicio del mes de cada sesión para no perder el primer incremento
  const readings = await many(
    `SELECT mv.session_id, mv.ts, mv.energy_wh, COALESCE(NULLIF(a.unit,'') || ' · ' || a.name, a.name) AS account, x.tariff_id
       FROM meter_values mv JOIN sessions x ON x.id=mv.session_id JOIN chargers c ON c.id=x.charger_id LEFT JOIN accounts a ON a.id=x.account_id
      WHERE mv.ts < ($2::date::timestamp AT TIME ZONE $3) AND x.started_at < ($2::date::timestamp AT TIME ZONE $3)
        AND COALESCE(x.stopped_at, now()) >= ($1::date::timestamp AT TIME ZONE $3)
        AND ($4::int IS NULL OR c.site_id=$4) AND ($5::int[] IS NULL OR c.site_id = ANY($5))
      ORDER BY mv.session_id, mv.ts`,
    [from, to, TZ, siteId, scope],
  );
  const tariffRows = await many('SELECT * FROM tariffs');
  const byId = new Map(tariffRows.map((t) => [t.id, t]));
  const tariffs = new Map(readings.map((r) => [r.session_id, byId.get(r.tariff_id)]));
  // Solo cuentan los incrementos que cierran dentro del mes
  const [{ since }] = await many('SELECT ($1::date::timestamp AT TIME ZONE $2) AS since', [from, TZ]);
  const res = aggregate(readings, tariffs, monthDays(month), new Date(since));
  const sessions = new Set(readings.map((r) => r.session_id)).size;
  return { month, sessions, ...res };
}
