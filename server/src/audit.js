// Registro de auditoría: quién hizo qué y cuándo.
import { q } from './db.js';

const SECRET = /password|token|secret|hash/i;
export function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET.test(k) ? '••••' : v && typeof v === 'object' ? scrub(v) : v;
  return out;
}

export async function audit({ actorType = 'admin', actorId = null, actorName = null, action, entity = null, entityId = null, summary, data = null, ip = null }) {
  try {
    await q(
      `INSERT INTO audit_log(actor_type, actor_id, actor_name, action, entity, entity_id, summary, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actorType, actorId, actorName, action, entity, entityId == null ? null : String(entityId), summary, data ? JSON.stringify(scrub(data)) : null, ip],
    );
  } catch {
    /* la auditoría nunca debe romper la operación */
  }
}

// Nombres legibles de cada recurso del panel
const ENTITIES = {
  tariffs: ['tarifa', 'Tarifa'], sites: ['sitio', 'Sitio'], accounts: ['cuenta', 'Cuenta'], cards: ['tarjeta', 'Tarjeta'],
  chargers: ['cargador', 'Cargador'], sessions: ['sesión', 'Sesión'], reservations: ['reserva', 'Reserva'], alerts: ['alerta', 'Alerta'],
  admins: ['usuario del panel', 'Usuario del panel'], 'app-users': ['usuario de la app', 'Usuario de la app'],
  'charger-models': ['driver de cargador', 'Driver de cargador'], movements: ['movimiento', 'Movimiento'],
};
const COMMANDS = {
  approve: 'aprobó', 'remote-start': 'inició una carga remota en', 'remote-stop': 'detuvo la carga en', reset: 'reinició',
  unlock: 'desbloqueó el conector de', 'local-list': 'envió la lista de tarjetas a', configuration: 'cambió la configuración de',
  'apply-driver': 'aplicó el driver a', close: 'cerró', resolve: 'resolvió', invite: 'generó un código de invitación para',
  'reset-password': 'restableció la contraseña de', movements: 'registró un movimiento en', password: 'cambió su contraseña', 'ocpp-password': 'cambió la contraseña OCPP de',
};

/** Describe una petición del panel (POST/PATCH/DELETE) en una frase. */
export function describe(method, url, params = {}) {
  const parts = url.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [res, idSeg, sub] = parts;
  const [noun, Noun] = ENTITIES[res] || [res, res];
  const id = params.id ?? params.key ?? (idSeg && !idSeg.startsWith(':') ? idSeg : null);
  if (sub) {
    const verb = COMMANDS[sub.replace(/^:.*/, '')] || `ejecutó «${sub}» en`;
    return { action: 'comando', entity: res, summary: `${verb} ${noun} ${id ?? ''}`.trim() };
  }
  if (method === 'POST') return { action: 'crear', entity: res, summary: `creó ${noun}` };
  if (method === 'DELETE') return { action: 'eliminar', entity: res, summary: `eliminó ${noun} ${id ?? ''}`.trim() };
  return { action: 'editar', entity: res, summary: `editó ${noun} ${id ?? ''}`.trim(), Noun };
}
