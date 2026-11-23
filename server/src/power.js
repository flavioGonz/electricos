// Reparto de potencia dinámico: nunca superar la potencia contratada del sitio cuando cargan varios autos a la vez.
import { many, one, q } from './db.js';
import { rateAt } from './billing.js';

export const MIN_A = 6; // mínimo de IEC 61851 para que el auto siga cargando

/**
 * Calcula cuántos amperes le toca a cada sesión.
 * sessions: [{ id, max_a, draw_a, started_at }] · available: A por fase · strategy: 'igual' | 'llegada'
 * Si un auto toma menos de lo que se le da (por ejemplo, está casi lleno), lo que sobra pasa a los demás.
 * Si no alcanza para darle el mínimo a todos, las últimas en llegar quedan en espera (0 A).
 */
export function allocate(sessions, available, strategy = 'igual') {
  const out = new Map();
  const order = [...sessions].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  let rest = available;
  const running = [];
  for (const s of order) {
    if (rest >= MIN_A) { running.push(s); rest -= MIN_A; out.set(s.id, MIN_A); } else out.set(s.id, 0);
  }
  // Tope de cada sesión: lo que admite el cargador y, si el auto viene tomando bastante menos, lo que toma más un margen
  const cap = (s) => {
    let c = Number(s.max_a) || 32;
    if (s.draw_a != null && s.draw_a > 0 && s.draw_a < (s.prev_limit_a ?? c) * 0.8) c = Math.min(c, Math.max(MIN_A, Math.ceil(s.draw_a + 2)));
    return c;
  };
  if (strategy === 'llegada') {
    for (const s of running) {
      const extra = Math.min(rest, cap(s) - out.get(s.id));
      out.set(s.id, out.get(s.id) + extra);
      rest -= extra;
    }
  } else {
    let open = running.filter((s) => cap(s) > out.get(s.id));
    while (rest > 0.05 && open.length) {
      const share = rest / open.length;
      for (const s of open) {
        const give = Math.min(share, cap(s) - out.get(s.id));
        out.set(s.id, out.get(s.id) + give);
        rest -= give;
      }
      open = open.filter((s) => cap(s) - out.get(s.id) > 0.05);
    }
  }
  for (const [k, v] of out) out.set(k, Math.floor(v * 10) / 10);
  return out;
}

/** Amperes por fase disponibles en el sitio ahora (tiene en cuenta el límite de punta). */
export async function siteAvailableAmps(site, now = new Date()) {
  let kw = site.contracted_kw != null ? Number(site.contracted_kw) : site.max_amps ? (site.max_amps * (site.voltage || 230) * (site.phases || 3)) / 1000 : null;
  if (kw == null) return null;
  if (site.punta_kw != null && site.tariff_id) {
    const t = await one('SELECT * FROM tariffs WHERE id=$1', [site.tariff_id]);
    if (t && rateAt(t, now).band === 'punta') kw = Math.min(kw, Number(site.punta_kw));
  }
  return (kw * 1000) / ((site.voltage || 230) * (site.phases || 3));
}

/** Estado de potencia de un sitio, para el panel. */
export async function siteStatus(siteId) {
  const site = await one('SELECT * FROM sites WHERE id=$1', [siteId]);
  if (!site) return null;
  const available = await siteAvailableAmps(site);
  const sessions = await many(
    `SELECT s.id, s.charger_id, COALESCE(NULLIF(c.name,''), c.id) AS charger, s.limit_amps, s.power_w, s.started_at, a.name AS account
       FROM sessions s JOIN chargers c ON c.id=s.charger_id LEFT JOIN accounts a ON a.id=s.account_id
      WHERE c.site_id=$1 AND s.status='active' ORDER BY s.started_at`,
    [siteId],
  );
  const v = (site.voltage || 230) * (site.phases || 3);
  const usedKw = sessions.reduce((t, s) => t + Number(s.power_w || 0), 0) / 1000;
  return {
    site_id: site.id, name: site.name, contracted_kw: site.contracted_kw != null ? Number(site.contracted_kw) : null,
    available_kw: available != null ? Math.round((available * v) / 100) / 10 : null, used_kw: Math.round(usedKw * 10) / 10,
    strategy: site.power_strategy, sessions,
  };
}

/** Recalcula y envía los límites a los cargadores del sitio. send(chargerId, connectorId, sessionId, amps) */
export async function rebalance(siteId, send, log = console) {
  if (!siteId) return;
  const site = await one('SELECT * FROM sites WHERE id=$1', [siteId]);
  if (!site) return;
  const available = await siteAvailableAmps(site);
  if (available == null) return;
  const v = (site.voltage || 230) * (site.phases || 3);
  const active = await many(
    `SELECT s.id, s.charger_id, s.connector_id, s.started_at, s.power_w, s.limit_amps, c.max_amps AS max_a
       FROM sessions s JOIN chargers c ON c.id=s.charger_id WHERE c.site_id=$1 AND s.status='active'`,
    [siteId],
  );
  if (!active.length) return;
  const alloc = allocate(active.map((s) => ({ ...s, draw_a: s.power_w ? Number(s.power_w) / v : null, prev_limit_a: s.limit_amps != null ? Number(s.limit_amps) : null })), available, site.power_strategy);
  for (const s of active) {
    const a = alloc.get(s.id);
    if (s.limit_amps != null && Math.abs(Number(s.limit_amps) - a) < 1) continue; // sin cambios relevantes
    try {
      await send(s.charger_id, s.connector_id, s.id, a);
      await q('UPDATE sessions SET limit_amps=$2, limit_at=now() WHERE id=$1', [s.id, a]);
    } catch (e) {
      log.warn?.(`límite de potencia ${s.charger_id}: ${e.message}`);
    }
  }
}
