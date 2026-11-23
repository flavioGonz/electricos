// Monitoreo para el servicio de mantenimiento: abre y cierra alertas, y avisa por webhook (Node-RED, WhatsApp, email).
import { many, q, one } from './db.js';
import { events } from './ocpp.js';

const OFFLINE_MIN = Number(process.env.ALERT_OFFLINE_MINUTES || 10);
const STUCK_HOURS = Number(process.env.ALERT_STUCK_HOURS || 14);

async function open(chargerId, kind, message, log) {
  const r = await one(
    `INSERT INTO alerts(charger_id, kind, message) VALUES ($1,$2,$3) ON CONFLICT (charger_id, kind) WHERE resolved_at IS NULL DO NOTHING RETURNING *`,
    [chargerId, kind, message],
  );
  if (!r) return;
  events.emit('change', { type: 'alert', chargerId, kind });
  log.warn?.(`alerta: ${message}`);
  await notify(r, log);
}

async function close(chargerId, kind) {
  const r = await q(`UPDATE alerts SET resolved_at=now() WHERE charger_id=$1 AND kind=$2 AND resolved_at IS NULL`, [chargerId, kind]);
  if (r.rowCount) events.emit('change', { type: 'alert', chargerId, kind, resolved: true });
}

async function notify(alert, log) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const c = await one('SELECT c.name, s.name AS site FROM chargers c LEFT JOIN sites s ON s.id=c.site_id WHERE c.id=$1', [alert.charger_id]);
    const text = `⚡ Eléctricos: ${alert.message}${c?.site ? ` (${c.site})` : ''}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...alert, charger: c, text }) });
    if (res.ok) await q('UPDATE alerts SET notified=true WHERE id=$1', [alert.id]);
  } catch (err) {
    log.warn?.(`no se pudo avisar la alerta: ${err.message}`);
  }
}

export async function checkOnce(log = console) {
  const chargers = await many(
    `SELECT c.id, COALESCE(NULLIF(c.name,''), c.id) AS name, c.connected, c.last_seen,
            (SELECT json_agg(k) FROM connectors k WHERE k.charger_id=c.id) AS connectors
       FROM chargers c WHERE c.approved`,
  );
  for (const c of chargers) {
    const stale = !c.connected && (!c.last_seen || Date.now() - new Date(c.last_seen) > OFFLINE_MIN * 60e3);
    if (stale) await open(c.id, 'offline', `${c.name} está desconectado desde hace más de ${OFFLINE_MIN} minutos`, log);
    else if (c.connected) await close(c.id, 'offline');

    const faulted = (c.connectors || []).filter((k) => k.status === 'Faulted');
    if (faulted.length) await open(c.id, 'faulted', `${c.name} reporta falla (${faulted.map((k) => `conector ${k.connector_id}: ${k.error_code}`).join(', ')})`, log);
    else await close(c.id, 'faulted');
  }
  const stuck = await many(
    `SELECT x.id, x.charger_id, COALESCE(NULLIF(c.name,''), c.id) AS name FROM sessions x JOIN chargers c ON c.id=x.charger_id
      WHERE x.status='active' AND x.started_at < now() - ($1 || ' hours')::interval`,
    [String(STUCK_HOURS)],
  );
  const stuckIds = new Set(stuck.map((s) => s.charger_id));
  for (const s of stuck) await open(s.charger_id, 'stuck_session', `${s.name}: la sesión #${s.id} lleva más de ${STUCK_HOURS} h abierta`, log);
  const openStuck = await many(`SELECT charger_id FROM alerts WHERE kind='stuck_session' AND resolved_at IS NULL`);
  for (const a of openStuck) if (!stuckIds.has(a.charger_id)) await close(a.charger_id, 'stuck_session');
}

export function startMonitor(log = console, everyMs = 60_000) {
  const run = () => checkOnce(log).catch((err) => log.error?.(err));
  const t = setInterval(run, everyMs);
  setTimeout(run, 5_000);
  return () => clearInterval(t);
}
