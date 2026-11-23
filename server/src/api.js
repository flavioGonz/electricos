// API REST para el panel de administración.
import bcrypt from 'bcryptjs';
import { one, many, q } from './db.js';
import { clients, events, normTag, sendLocalList, accountBalance, closeSession, applyDriver, matchModel, balanceSite } from './ocpp.js';
import appApi, { newInviteCode, appTag } from './app.js';
import { audit, describe } from './audit.js';
import { getSetting, getSettingPublic, setSetting } from './settings.js';
import { siteStatus } from './power.js';
import { generateDrafts, issue, cancelInvoice } from './invoices.js';
import { consumo } from './consumo.js';
import { newSecret, verifyTotp, otpauthUri, sealSecret, openSecret, issueWaCode, checkWaCode, lockMessage, registerFailure, clearFailures, limitHook } from './security.js';
import { sendWhatsApp, sendEmail, sendTelegram, notifyAdmins, recentNotifications, notificationStats } from './notify.js';
import { tgStatus, tgLinkCode } from './telegram.js';
import { randomBytes } from 'node:crypto';

const TZ = process.env.TZ_LOCAL || 'America/Montevideo';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.statusCode = status;
  }
}
const notFound = () => new HttpError(404, 'no encontrado');

/** Arma INSERT/UPDATE con una lista blanca de columnas. */
function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body && Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f] === '' ? null : body[f];
  return out;
}
async function insert(table, data) {
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, 'sin datos');
  const sql = `INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`;
  return one(sql, Object.values(data));
}
async function update(table, keyCol, key, data) {
  const cols = Object.keys(data);
  if (!cols.length) return one(`SELECT * FROM ${table} WHERE ${keyCol}=$1`, [key]);
  const sql = `UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE ${keyCol}=$1 RETURNING *`;
  const row = await one(sql, [key, ...Object.values(data)]);
  if (!row) throw notFound();
  return row;
}

/** Sitios que puede ver el usuario: null = todos; un array = solo esos (administración de edificio). */
export const scopeOf = (req) => (req.admin?.role === 'edificio' ? (req.admin.site_ids || []).map(Number) : null);

function crud(app, { path, table, key = 'id', fields, list, transform = (d) => d, scopeCol }) {
  app.get(path, async (req) => {
    const sql = list || `SELECT * FROM ${table} ORDER BY ${key}`;
    const sc = scopeOf(req);
    if (!sc) return many(sql);
    if (!scopeCol) throw new HttpError(403, 'no tenés acceso a esta sección');
    return many(`SELECT * FROM (${sql}) z WHERE z.${scopeCol} = ANY($1::int[])`, [sc]);
  });
  app.post(path, async (req, reply) => reply.code(201).send(await insert(table, transform(pick(req.body, fields)))));
  app.patch(`${path}/:key`, async (req) => update(table, key, req.params.key, transform(pick(req.body, fields))));
  app.delete(`${path}/:key`, async (req, reply) => {
    const r = await q(`DELETE FROM ${table} WHERE ${key}=$1`, [req.params.key]);
    if (!r.rowCount) throw notFound();
    return reply.code(204).send();
  });
}

function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) throw new HttpError(400, 'month debe ser AAAA-MM');
  return [`${m[1]}-${m[2]}-01`, Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`];
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  // Evita la inyección de fórmulas al abrir el CSV en Excel (un email como "=HYPERLINK(...)" en un ingreso fallido)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function ensureAdmin(log = console) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const exists = await one('SELECT id FROM admins WHERE email=$1', [email.toLowerCase()]);
  if (exists) return;
  await q('INSERT INTO admins(email, name, password_hash) VALUES ($1,$2,$3)', [email.toLowerCase(), 'Administrador', await bcrypt.hash(password, 10)]);
  log.info?.(`administrador creado: ${email}`);
}

export default async function api(app) {
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || (err.code === '23505' ? 409 : err.code === '23503' ? 409 : err.code?.startsWith?.('22') ? 400 : 500);
    if (status >= 500) req.log.error(err);
    // Los errores internos no se muestran tal cual (pueden incluir detalles de la base o de la red interna)
    const message = err.code === '23505' ? 'ya existe' : err.code === '23503' ? 'está en uso o referencia algo que no existe'
      : status >= 500 && !err.statusCode ? 'error interno, probá de nuevo en unos minutos' : err.message;
    reply.code(status).send({ error: message });
  });

  app.get('/health', async () => ({ ok: true, chargersConnected: clients.size }));

  // Lo único que ve un usuario de administración de edificio (siempre filtrado por sus sitios)
  const EDIFICIO_GET = new Set(['/me', '/dashboard', '/sessions', '/sites', '/accounts', '/accounts/:id/movements', '/reports/monthly', '/reports/owners',
    '/invoices', '/invoices/:id', '/power', '/events', '/consumo']);

  // ---------- Ingreso al panel: contraseña, doble factor y bloqueo por intentos ----------
  const finishLogin = async (admin, req, how = '') => {
    await clearFailures('admins', admin.id);
    await q('UPDATE admins SET last_login_at=now() WHERE id=$1', [admin.id]);
    await audit({ actorId: admin.id, actorName: admin.name || admin.email, action: 'ingreso', entity: 'admins', entityId: admin.id, summary: `entró al panel${how}`, ip: req.ip });
    return { token: app.jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, { expiresIn: '12h' }), name: admin.name, email: admin.email, level: admin.role };
  };
  const failed = async (admin, req, actorName, summary) => {
    const f = admin ? await registerFailure('admins', admin.id) : { locked: false };
    await audit({ actorName, action: 'ingreso_fallido', entity: 'admins', entityId: admin?.id, summary: f.locked ? `${summary}; la cuenta quedó bloqueada` : summary, ip: req.ip });
    if (f.locked) {
      notifyAdmins('seguridad', 'Usuario bloqueado por intentos fallidos', `La cuenta ${admin.email} del panel de Eléctricos quedó bloqueada por varios intentos fallidos desde ${req.ip}. Si no fue esa persona, revisá la auditoría.`, `admin:${admin.id}`).catch(() => {});
      throw new HttpError(423, lockMessage({ locked_until: f.until }));
    }
  };
  const mfaAdmin = async (ticket) => {
    let t;
    try { t = app.jwt.verify(String(ticket || '')); } catch { throw new HttpError(401, 'el ingreso venció, volvé a poner tu contraseña'); }
    if (t.role !== 'mfa') throw new HttpError(401, 'el ingreso venció, volvé a poner tu contraseña');
    const admin = await one('SELECT * FROM admins WHERE id=$1 AND active', [t.sub]);
    if (!admin) throw new HttpError(401, 'tu usuario fue deshabilitado');
    const locked = lockMessage(admin);
    if (locked) throw new HttpError(423, locked);
    return admin;
  };
  const loginLimit = { onRequest: limitHook({ max: 10, windowMs: 60_000 }) };
  app.post('/auth/login', loginLimit, async (req) => {
    const { email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    const admin = await one('SELECT * FROM admins WHERE email=$1', [mail]);
    const locked = lockMessage(admin);
    if (locked) throw new HttpError(423, locked);
    if (!admin || !admin.active || !(await bcrypt.compare(String(password || ''), admin.password_hash))) {
      await failed(admin?.active ? admin : null, req, mail || '(vacío)', admin && !admin.active ? 'intentó entrar con un usuario deshabilitado' : 'intentó entrar con datos incorrectos');
      throw new HttpError(401, 'email o contraseña incorrectos');
    }
    if (admin.totp_enabled) {
      return { need_2fa: true, ticket: app.jwt.sign({ sub: admin.id, role: 'mfa' }, { expiresIn: '5m' }), name: admin.name, can_whatsapp: !!admin.phone };
    }
    return finishLogin(admin, req);
  });
  app.post('/auth/2fa', loginLimit, async (req) => {
    const admin = await mfaAdmin(req.body?.ticket);
    const code = req.body?.code;
    if (verifyTotp(openSecret(admin.totp_secret), code)) return finishLogin(admin, req, ' con doble factor');
    if (checkWaCode(admin.id, code)) return finishLogin(admin, req, ' con código por WhatsApp');
    await failed(admin, req, admin.name || admin.email, 'puso mal el código de doble factor');
    throw new HttpError(401, 'el código no es correcto');
  });
  app.post('/auth/2fa/whatsapp', { onRequest: limitHook({ max: 3, windowMs: 5 * 60_000 }) }, async (req) => {
    const admin = await mfaAdmin(req.body?.ticket);
    if (!admin.phone) throw new HttpError(400, 'tu usuario no tiene un celular cargado');
    const code = issueWaCode(admin.id);
    const r = await sendWhatsApp(admin.phone, `🔐 Tu código para entrar a Eléctricos es *${code}*. Vence en 5 minutos. Si no fuiste vos, avisá a un administrador.`, { kind: 'codigo', ref: `admin:${admin.id}`, logText: 'Código de ingreso (oculto)' });
    if (!r.ok) throw new HttpError(502, `no se pudo mandar el WhatsApp: ${r.error}`);
    return { ok: true, to: `•••• ${String(admin.phone).replace(/\D/g, '').slice(-3)}` };
  });

  // Aviso del respaldo nocturno (lo llama el cron de pve02, solo desde la red interna)
  app.post('/internal/backup', async (req) => {
    const ip = req.ip.replace('::ffff:', '');
    if (!['127.0.0.1', '192.168.99.3', '::1'].includes(ip)) throw new HttpError(403, 'solo desde la red interna');
    const ok = !!req.body?.ok;
    await setSetting('backup_status', { ok, at: new Date().toISOString(), file: req.body?.file || null, bytes: req.body?.bytes || null });
    await audit({ actorType: 'sistema', actorName: 'Sistema', action: 'comando', entity: 'backup', summary: ok ? `hizo el respaldo nocturno (${Math.round((req.body?.bytes || 0) / 1024)} KB)` : 'no pudo hacer el respaldo nocturno', ip });
    if (!ok) await notifyAdmins('respaldo', 'Falló el respaldo nocturno', 'El respaldo de la base de Eléctricos no se pudo hacer. Revisá pve02 (/mnt/backup-cluster/electricos/respaldos.log).', 'backup');
    return { ok: true };
  });

  // App de usuarios finales (QR, iniciar/detener, reservas, pagos)
  app.register(appApi, { prefix: '/app' });

  // Todo lo que sigue requiere sesión de administrador. EventSource no manda headers: aceptamos ?token= solo en /events.
  app.register(async (priv) => {
    priv.addHook('onRequest', async (req) => {
      if (req.routeOptions.url === '/api/events' && req.query?.token) req.headers.authorization = `Bearer ${req.query.token}`;
      try {
        await req.jwtVerify();
      } catch {
        throw new HttpError(401, 'sesión vencida o inválida');
      }
      if (req.user.role !== 'admin') throw new HttpError(401, 'sesión vencida o inválida');
      const me = await one('SELECT id, email, name, role, active, site_ids, totp_enabled, tokens_valid_after FROM admins WHERE id=$1', [req.user.sub]);
      if (!me || !me.active) throw new HttpError(401, 'tu usuario fue deshabilitado');
      if (me.tokens_valid_after && req.user.iat * 1000 < new Date(me.tokens_valid_after).getTime() - 1000) throw new HttpError(401, 'sesión vencida o inválida');
      req.admin = me;
      const url = req.routeOptions.url || '';
      // Doble factor obligatorio: hasta configurarlo solo puede ver su perfil y activar el 2FA
      if (!me.totp_enabled && !(url === '/api/me' || url.startsWith('/api/me/2fa') || url === '/api/me/password')) {
        const sec = await getSetting('seguridad').catch(() => ({}));
        if (sec.require_2fa_admins) throw new HttpError(403, 'activá el doble factor para seguir usando el panel');
      }
      if (me.role === 'edificio') {
        const own = url === '/api/me/password' || url.startsWith('/api/me/2fa');
        if (own) return;
        if (req.method !== 'GET' || !EDIFICIO_GET.has(url.replace(/^\/api/, ''))) throw new HttpError(403, 'tu usuario solo puede ver el consumo y la liquidación de tu edificio');
        return;
      }
      if (req.method === 'GET' || url === '/api/me/password' || url.startsWith('/api/me/2fa') || url === '/api/me/telegram') return;
      if (me.role === 'lectura') throw new HttpError(403, 'tu usuario es de solo lectura');
      if (me.role === 'operador' && (req.method === 'DELETE' || /^\/api\/(admins|charger-models|tariffs)/.test(url)))
        throw new HttpError(403, 'esta acción requiere un usuario administrador');
    });
    priv.addHook('preHandler', async (req) => {
      if (['admin', 'operador'].includes(req.admin?.role)) return;
      if (/^\/api\/(admins|audit)/.test(req.routeOptions.url || '')) throw new HttpError(403, 'esta sección es solo para administradores');
    });
    // Auditoría automática de todo lo que cambia algo
    priv.addHook('onSend', async (req, reply, payload) => {
      if (req.method !== 'GET' && reply.statusCode < 300 && typeof payload === 'string') {
        try { req.auditResult = JSON.parse(payload); } catch { /* sin cuerpo */ }
      }
      return payload;
    });
    priv.addHook('onResponse', async (req, reply) => {
      if (req.method === 'GET' || reply.statusCode >= 400 || !req.admin) return;
      const d = describe(req.method, req.routeOptions.url || req.url, req.params || {});
      const r = req.auditResult;
      const entityId = req.params?.id ?? req.params?.key ?? r?.id ?? null;
      const label = r?.name || r?.label || r?.email || r?.id_tag || null;
      await audit({ actorId: req.admin.id, actorName: req.admin.name || req.admin.email, action: d.action, entity: d.entity, entityId,
        summary: d.action === 'crear' && (label || entityId) ? `${d.summary} ${label || entityId}` : d.summary, data: { body: req.body ?? null }, ip: req.ip });
    });

    priv.get('/me', async (req) => {
      const x = await one('SELECT totp_enabled, phone, telegram_chat_id FROM admins WHERE id=$1', [req.admin.id]);
      const sec = await getSetting('seguridad').catch(() => ({}));
      const sc = scopeOf(req);
      const sites = sc ? await many('SELECT id, name FROM sites WHERE id = ANY($1::int[]) ORDER BY name', [sc]) : undefined;
      return { id: req.admin.id, email: req.admin.email, name: req.admin.name, level: req.admin.role, sites, telegram: !!x.telegram_chat_id, totp: x.totp_enabled, phone: x.phone, must_2fa: !!sec.require_2fa_admins && !x.totp_enabled };
    });
    // Doble factor del propio usuario
    priv.post('/me/2fa/setup', async (req) => {
      const secret = newSecret();
      await q('UPDATE admins SET totp_pending=$2 WHERE id=$1', [req.admin.id, sealSecret(secret)]);
      return { secret: secret.match(/.{1,4}/g).join(' '), uri: otpauthUri(secret, req.admin.email) };
    });
    priv.post('/me/2fa/enable', async (req) => {
      const x = await one('SELECT totp_pending FROM admins WHERE id=$1', [req.admin.id]);
      const secret = openSecret(x.totp_pending);
      if (!secret) throw new HttpError(400, 'empezá de nuevo la configuración');
      if (!verifyTotp(secret, req.body?.code)) throw new HttpError(400, 'el código no coincide; revisá que la hora del teléfono esté bien');
      await q('UPDATE admins SET totp_secret=totp_pending, totp_pending=NULL, totp_enabled=true WHERE id=$1', [req.admin.id]);
      return { ok: true };
    });
    priv.post('/me/2fa/disable', async (req) => {
      const x = await one('SELECT password_hash FROM admins WHERE id=$1', [req.admin.id]);
      if (!(await bcrypt.compare(String(req.body?.password || ''), x.password_hash))) throw new HttpError(400, 'la contraseña no es correcta');
      const sec = await getSetting('seguridad').catch(() => ({}));
      if (sec.require_2fa_admins) throw new HttpError(409, 'el doble factor es obligatorio para los usuarios del panel');
      await q('UPDATE admins SET totp_secret=NULL, totp_pending=NULL, totp_enabled=false WHERE id=$1', [req.admin.id]);
      return { ok: true };
    });
    priv.post('/me/password', async (req) => {
      const { current, next } = req.body || {};
      const me = await one('SELECT password_hash FROM admins WHERE id=$1', [req.admin.id]);
      if (!(await bcrypt.compare(String(current || ''), me.password_hash))) throw new HttpError(400, 'la contraseña actual no es correcta');
      if (String(next || '').length < 8) throw new HttpError(400, 'la nueva contraseña debe tener al menos 8 caracteres');
      await q('UPDATE admins SET password_hash=$2 WHERE id=$1', [req.admin.id, await bcrypt.hash(String(next), 10)]);
      return { ok: true };
    });

    // ---------- Usuarios del panel ----------
    const ROLES = ['admin', 'operador', 'lectura', 'edificio'];
    const siteIds = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : null);
    priv.get('/admins', async () => many('SELECT id, email, name, phone, role, active, site_ids, last_login_at, created_at, totp_enabled, CASE WHEN locked_until > now() THEN locked_until END AS locked_until FROM admins ORDER BY active DESC, name'));
    priv.post('/admins/:id/unlock', async (req) => { await clearFailures('admins', Number(req.params.id)); return { ok: true }; });
    priv.post('/admins/:id/reset-2fa', async (req) => {
      const r = await one('UPDATE admins SET totp_secret=NULL, totp_pending=NULL, totp_enabled=false, tokens_valid_after=now() WHERE id=$1 RETURNING id', [req.params.id]);
      if (!r) throw notFound();
      return { ok: true };
    });
    priv.post('/admins', async (req, reply) => {
      const { email, name, phone, role = 'operador', password } = req.body || {};
      if (!email || !name) throw new HttpError(400, 'completá nombre y email');
      if (!ROLES.includes(role)) throw new HttpError(400, 'rol inválido');
      const sites = siteIds(req.body.site_ids);
      if (role === 'edificio' && !sites?.length) throw new HttpError(400, 'elegí al menos un edificio para este usuario');
      const pass = password && String(password).length >= 8 ? String(password) : randomBytes(6).toString('base64url');
      const row = await one('INSERT INTO admins(email, name, phone, role, password_hash, site_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, name, phone, role, active, site_ids',
        [String(email).trim().toLowerCase(), name, phone || null, role, await bcrypt.hash(pass, 10), role === 'edificio' ? sites : null]);
      return reply.code(201).send({ ...row, temp_password: password ? undefined : pass });
    });
    const lastAdminGuard = async (id, next) => {
      if (next.role === 'admin' && next.active !== false) return;
      const others = await one(`SELECT count(*) AS n FROM admins WHERE role='admin' AND active AND id<>$1`, [id]);
      if (!others.n) throw new HttpError(409, 'tiene que quedar al menos un administrador activo');
    };
    priv.patch('/admins/:id', async (req) => {
      const data = pick(req.body, ['name', 'phone', 'role', 'active', 'site_ids']);
      if (data.role && !ROLES.includes(data.role)) throw new HttpError(400, 'rol inválido');
      if ('site_ids' in data) data.site_ids = siteIds(data.site_ids);
      if (data.role === 'edificio' && !data.site_ids?.length) throw new HttpError(400, 'elegí al menos un edificio para este usuario');
      if (data.role && data.role !== 'edificio') data.site_ids = null;
      const cur = await one('SELECT * FROM admins WHERE id=$1', [req.params.id]);
      if (!cur) throw notFound();
      if (cur.role === 'admin' && cur.active) await lastAdminGuard(cur.id, { role: data.role ?? cur.role, active: data.active ?? cur.active });
      // Si le bajan permisos o lo deshabilitan, se cierran sus sesiones abiertas
      if ((data.role && data.role !== cur.role) || data.active === false || ('site_ids' in data && cur.role === 'edificio')) data.tokens_valid_after = new Date();
      const r = await update('admins', 'id', req.params.id, data);
      return { id: r.id, email: r.email, name: r.name, phone: r.phone, role: r.role, active: r.active, site_ids: r.site_ids };
    });
    priv.post('/admins/:id/reset-password', async (req) => {
      const pass = randomBytes(6).toString('base64url');
      const r = await one('UPDATE admins SET password_hash=$2, failed_attempts=0, locked_until=NULL, tokens_valid_after=now() WHERE id=$1 RETURNING id', [req.params.id, await bcrypt.hash(pass, 10)]);
      if (!r) throw notFound();
      return { temp_password: pass };
    });
    priv.delete('/admins/:id', async (req, reply) => {
      if (Number(req.params.id) === req.admin.id) throw new HttpError(409, 'no podés eliminar tu propio usuario');
      const cur = await one('SELECT * FROM admins WHERE id=$1', [req.params.id]);
      if (!cur) throw notFound();
      if (cur.role === 'admin' && cur.active) await lastAdminGuard(cur.id, { role: 'x', active: false });
      await q('DELETE FROM admins WHERE id=$1', [req.params.id]);
      return reply.code(204).send();
    });

    // ---------- Usuarios de la app (todas las cuentas) ----------
    const APP_USER_COLS = `u.id, u.name, u.email, u.phone, u.active, u.created_at, u.last_login_at, u.account_id, a.name AS account_name, a.unit AS account_unit, a.billing_mode,
                   s.name AS site_name, u.notify_whatsapp, u.notify_email, u.notify_telegram, u.telegram_chat_id IS NOT NULL AS telegram,
                   CASE WHEN u.locked_until > now() THEN u.locked_until END AS locked_until,
                   st.sessions, st.energy_wh, st.amount, st.last_charge, st.active_now`;
    const APP_USER_FROM = `FROM app_users u JOIN accounts a ON a.id=u.account_id LEFT JOIN sites s ON s.id=a.site_id
           LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE x.status='completed')::int AS sessions, COALESCE(sum(x.energy_wh) FILTER (WHERE x.status='completed'),0) AS energy_wh,
                                     COALESCE(sum(x.amount) FILTER (WHERE x.status='completed'),0) AS amount, max(x.started_at) AS last_charge, bool_or(x.status='active') AS active_now
                                FROM sessions x JOIN cards k ON k.id_tag=x.id_tag WHERE k.app_user_id=u.id) st ON true`;
    priv.get('/app-users', async () => many(`SELECT ${APP_USER_COLS} ${APP_USER_FROM} ORDER BY u.active DESC, u.name`));
    priv.get('/app-users/:id', async (req) => {
      const u = await one(`SELECT ${APP_USER_COLS} ${APP_USER_FROM} WHERE u.id=$1`, [req.params.id]);
      if (!u) throw notFound();
      const months = await many(
        `SELECT to_char(date_trunc('month', x.started_at AT TIME ZONE $2), 'YYYY-MM') AS month, count(*)::int AS sessions, COALESCE(sum(x.energy_wh),0) AS energy_wh, COALESCE(sum(x.amount),0) AS amount
           FROM sessions x JOIN cards k ON k.id_tag=x.id_tag WHERE k.app_user_id=$1 AND x.status='completed' AND x.started_at > now() - interval '12 months'
          GROUP BY 1 ORDER BY 1`, [u.id, TZ]);
      return { ...u, months };
    });
    priv.get('/app-users/:id/sessions', async (req) => {
      const { month } = req.query;
      const [from, to] = month ? monthRange(month) : [null, null];
      return many(
        `SELECT x.id, x.charger_id, c.name AS charger_name, s.name AS site_name, x.started_at, x.stopped_at, x.status, x.energy_wh, x.amount, x.stop_reason, x.breakdown,
                CASE WHEN x.status='active' THEN x.last_meter_wh - x.meter_start_wh END AS live_wh
           FROM sessions x JOIN cards k ON k.id_tag=x.id_tag JOIN chargers c ON c.id=x.charger_id LEFT JOIN sites s ON s.id=c.site_id
          WHERE k.app_user_id=$1 AND ($2::date IS NULL OR x.started_at >= ($2::date::timestamp AT TIME ZONE $4)) AND ($3::date IS NULL OR x.started_at < ($3::date::timestamp AT TIME ZONE $4))
          ORDER BY x.started_at DESC LIMIT 500`, [req.params.id, from, to, TZ]);
    });
    priv.get('/app-users/:id/activity', async (req) => many(
      `SELECT id, at, actor_type, actor_name, action, summary, ip FROM audit_log
        WHERE (actor_type='app' AND actor_id=$1) OR (entity='app-users' AND entity_id=$1::text) ORDER BY at DESC LIMIT 200`, [Number(req.params.id)]));
    priv.post('/app-users/:id/password', async (req) => {
      const pass = String(req.body?.password || '');
      if (pass.length < 6) throw new HttpError(400, 'la contraseña tiene que tener al menos 6 caracteres');
      const r = await one('UPDATE app_users SET password_hash=$2, failed_attempts=0, locked_until=NULL WHERE id=$1 RETURNING id', [req.params.id, await bcrypt.hash(pass, 10)]);
      if (!r) throw notFound();
      if (req.body?.logout) await q('UPDATE app_users SET tokens_valid_after=now() WHERE id=$1', [req.params.id]);
      return { ok: true };
    });
    priv.post('/app-users/:id/unlock', async (req) => { await clearFailures('app_users', Number(req.params.id)); return { ok: true }; });
    priv.post('/app-users/:id/logout', async (req) => {
      const r = await one('UPDATE app_users SET tokens_valid_after=now() WHERE id=$1 RETURNING id', [req.params.id]);
      if (!r) throw notFound();
      return { ok: true };
    });
    priv.post('/app-users', async (req, reply) => {
      const { account_id, name, email, phone, password } = req.body || {};
      if (!account_id || !name || !email) throw new HttpError(400, 'completá cuenta, nombre y email');
      const pass = password && String(password).length >= 6 ? String(password) : randomBytes(5).toString('base64url');
      const u = await one('INSERT INTO app_users(account_id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, account_id, name, email, phone, active',
        [account_id, name, String(email).trim().toLowerCase(), phone || null, await bcrypt.hash(pass, 10)]);
      await q('INSERT INTO cards(id_tag, account_id, label, app_user_id) VALUES ($1,$2,$3,$4)', [appTag(u.id), account_id, `App de ${name}`, u.id]);
      return reply.code(201).send({ ...u, temp_password: password ? undefined : pass });
    });
    priv.post('/app-users/:id/reset-password', async (req) => {
      const pass = randomBytes(5).toString('base64url');
      const r = await one('UPDATE app_users SET password_hash=$2, failed_attempts=0, locked_until=NULL WHERE id=$1 RETURNING id', [req.params.id, await bcrypt.hash(pass, 10)]);
      if (!r) throw notFound();
      return { temp_password: pass };
    });

    // ---------- Drivers: cargadores compatibles ----------
    const MODEL_FIELDS = ['vendor', 'model_pattern', 'name', 'ocpp_version', 'max_kw', 'phases', 'connectors', 'connector_type', 'rfid', 'smart_charging', 'local_list', 'remote_start', 'ute_approved', 'config', 'notes', 'active'];
    const modelIn = (d) => {
      if (typeof d.config === 'string') {
        try { d.config = JSON.parse(d.config || '{}'); } catch { throw new HttpError(400, 'la configuración tiene que ser JSON válido, por ejemplo {"MeterValueSampleInterval":"30"}'); }
      }
      if (d.config) d.config = JSON.stringify(d.config);
      return d;
    };
    crud(priv, { path: '/charger-models', table: 'charger_models', fields: MODEL_FIELDS, transform: modelIn,
      list: `SELECT m.*, (SELECT count(*) FROM chargers c WHERE c.model_id=m.id) AS chargers FROM charger_models m ORDER BY (m.vendor='*'), m.vendor, m.name` });
    priv.get('/charger-models/match', async (req) => matchModel(req.query.vendor, req.query.model));
    priv.post('/chargers/:id/apply-driver', async (req) => applyDriver(req.params.id));

    // ---------- Facturación electrónica ----------
    priv.get('/invoices', async (req) => many(
      `SELECT i.*, a.name AS account, a.unit, s.name AS site FROM invoices i JOIN accounts a ON a.id=i.account_id LEFT JOIN sites s ON s.id=a.site_id
        WHERE ($1::text IS NULL OR i.period=$1) AND ($2::int IS NULL OR a.site_id=$2) AND ($3::int[] IS NULL OR a.site_id = ANY($3))
        ORDER BY i.status='anulada', a.site_id, a.unit, a.name`,
      [req.query.month || null, req.query.siteId ? Number(req.query.siteId) : null, scopeOf(req)]));
    priv.post('/invoices/generate', async (req) => {
      const r = await generateDrafts(req.body?.month, req.body?.siteId ? Number(req.body.siteId) : null);
      return { created: r.length };
    });
    priv.get('/invoices/:id', async (req) => {
      const r = await one(`SELECT i.*, a.name AS account, a.unit, s.name AS site FROM invoices i JOIN accounts a ON a.id=i.account_id LEFT JOIN sites s ON s.id=a.site_id
        WHERE i.id=$1 AND ($2::int[] IS NULL OR a.site_id = ANY($2))`, [Number(req.params.id), scopeOf(req)]);
      if (!r) throw notFound();
      return { ...r, emisor: await getSettingPublic('facturacion') };
    });
    priv.post('/invoices/:id/issue', async (req) => {
      const m = req.body?.manual ? { series: req.body.series, number: req.body.number } : null;
      if (m && !m.number) throw new HttpError(400, 'indicá el número del comprobante');
      return issue(Number(req.params.id), m);
    });
    priv.post('/invoices/:id/cancel', async (req) => cancelInvoice(Number(req.params.id)));

    // ---------- Consumo (gráficas) ----------
    priv.get('/consumo', async (req) => consumo({ month: req.query.month, siteId: req.query.siteId ? Number(req.query.siteId) : null, scope: scopeOf(req) }));

    // ---------- Potencia por sitio ----------
    priv.get('/power', async (req) => {
      const sites = await many('SELECT id FROM sites WHERE (contracted_kw IS NOT NULL OR max_amps IS NOT NULL) AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY name', [scopeOf(req)]);
      return Promise.all(sites.map((x) => siteStatus(x.id)));
    });
    priv.post('/sites/:id/rebalance', async (req) => { await balanceSite(Number(req.params.id)); return siteStatus(Number(req.params.id)); });

    // ---------- Avisos: WhatsApp, correo y destinatarios ----------
    const SETTINGS = ['whatsapp', 'email', 'telegram', 'avisos', 'facturacion', 'seguridad'];
    priv.get('/settings', async () => Object.fromEntries(await Promise.all([...SETTINGS, 'backup_status'].map(async (k) => [k, await getSettingPublic(k)]))));
    priv.put('/settings/:name', async (req) => {
      if (!SETTINGS.includes(req.params.name)) throw notFound();
      if (req.admin.role !== 'admin') throw new HttpError(403, 'solo un administrador cambia esta configuración');
      return setSetting(req.params.name, req.body || {});
    });
    priv.post('/settings/test', async (req) => {
      const { channel, to } = req.body || {};
      const text = 'Mensaje de prueba de Eléctricos. Si te llegó, los avisos están funcionando.';
      const r = channel === 'email' ? await sendEmail(to, 'Prueba de avisos', text, { kind: 'prueba' })
        : channel === 'telegram' ? await sendTelegram(to, text, { kind: 'prueba', subject: '⚡ Eléctricos' })
        : await sendWhatsApp(to, `⚡ ${text}`, { kind: 'prueba' });
      if (!r.ok) throw new HttpError(502, r.error);
      return r;
    });
    priv.get('/settings/whatsapp/status', async () => {
      const wa = await getSetting('whatsapp');
      if (!wa.url || !wa.session || !wa.api_key) return { status: 'sin configurar' };
      try {
        const res = await fetch(`${wa.url.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(wa.session)}`, { headers: { 'X-API-Key': wa.api_key }, signal: AbortSignal.timeout(8000) });
        const j = await res.json().catch(() => ({}));
        return { status: res.ok ? (j.status || j.state || 'desconocido') : `error ${res.status}`, phone: j.phone || j.me?.id || null };
      } catch (e) {
        return { status: 'sin conexión', error: e.message };
      }
    });
    priv.get('/notifications', async () => recentNotifications(200));
    priv.get('/notifications/stats', async () => notificationStats());
    priv.get('/settings/telegram/status', async () => tgStatus());
    priv.get('/telegram/admins', async () => many(`SELECT id, name, email, role, telegram_chat_id IS NOT NULL AS linked FROM admins WHERE active AND role IN ('admin','operador') ORDER BY name`));
    priv.post('/me/telegram', async (req) => tgLinkCode('admin', req.admin.id));
    priv.delete('/me/telegram', async (req) => { await q('UPDATE admins SET telegram_chat_id=NULL WHERE id=$1', [req.admin.id]); return { ok: true }; });

    // ---------- Auditoría ----------
    priv.get('/audit', async (req, reply) => {
      const { q: text, entity, actor, action, from, to, format } = req.query;
      const limit = Math.min(Number(req.query.limit) || 100, format === 'csv' ? 20000 : 500);
      const offset = Number(req.query.offset) || 0;
      const rows = await many(
        `SELECT * FROM audit_log
          WHERE ($1::text IS NULL OR summary ILIKE '%'||$1||'%' OR actor_name ILIKE '%'||$1||'%' OR entity_id ILIKE '%'||$1||'%')
            AND ($2::text IS NULL OR entity=$2) AND ($3::text IS NULL OR actor_type=$3) AND ($4::text IS NULL OR action=$4)
            AND ($5::date IS NULL OR at >= $5::date) AND ($6::date IS NULL OR at < $6::date + 1)
          ORDER BY at DESC LIMIT $7 OFFSET $8`,
        [text || null, entity || null, actor || null, action || null, from || null, to || null, limit, offset],
      );
      if (format !== 'csv') return rows;
      const head = ['fecha', 'quien', 'tipo', 'accion', 'recurso', 'id', 'detalle', 'ip'];
      const lines = rows.map((r) => [r.at.toISOString(), r.actor_name, r.actor_type, r.action, r.entity, r.entity_id, r.summary, r.ip].map(csvCell).join(';'));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="auditoria.csv"');
      return '\ufeff' + [head.join(';'), ...lines].join('\n');
    });

    priv.get('/events', (req, reply) => {
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = (e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
      events.on('change', send);
      req.raw.on('close', () => {
        clearInterval(ping);
        events.off('change', send);
      });
    });

    priv.get('/dashboard', async (req) => {
      const sc = scopeOf(req);
      if (sc) {
        return one(
          `SELECT
             (SELECT count(*) FROM chargers WHERE site_id = ANY($2)) AS chargers,
             (SELECT count(*) FROM chargers WHERE connected AND site_id = ANY($2)) AS chargers_online,
             0 AS chargers_pending,
             (SELECT count(*) FROM sessions x JOIN chargers c ON c.id=x.charger_id WHERE x.status='active' AND c.site_id = ANY($2)) AS sessions_active,
             (SELECT count(*) FROM accounts WHERE active AND site_id = ANY($2)) AS accounts,
             (SELECT count(*) FROM cards k JOIN accounts a ON a.id=k.account_id WHERE k.status='active' AND k.app_user_id IS NULL AND a.site_id = ANY($2)) AS cards,
             (SELECT count(*) FROM app_users u JOIN accounts a ON a.id=u.account_id WHERE u.active AND a.site_id = ANY($2)) AS app_users,
             (SELECT count(*) FROM alerts l JOIN chargers c ON c.id=l.charger_id WHERE l.resolved_at IS NULL AND c.site_id = ANY($2)) AS alerts_open,
             (SELECT COALESCE(SUM(x.energy_wh),0) FROM sessions x JOIN chargers c ON c.id=x.charger_id WHERE x.status='completed' AND c.site_id = ANY($2) AND x.started_at >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_energy_wh,
             (SELECT COALESCE(SUM(x.amount),0) FROM sessions x JOIN chargers c ON c.id=x.charger_id WHERE x.status='completed' AND c.site_id = ANY($2) AND x.started_at >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_amount`,
          [TZ, sc],
        );
      }
      return one(
        `SELECT
           (SELECT count(*) FROM chargers) AS chargers,
           (SELECT count(*) FROM chargers WHERE connected) AS chargers_online,
           (SELECT count(*) FROM chargers WHERE NOT approved) AS chargers_pending,
           (SELECT count(*) FROM sessions WHERE status='active') AS sessions_active,
           (SELECT count(*) FROM accounts WHERE active) AS accounts,
           (SELECT count(*) FROM cards WHERE status='active' AND app_user_id IS NULL) AS cards,
           (SELECT count(*) FROM app_users WHERE active) AS app_users,
           (SELECT count(*) FROM alerts WHERE resolved_at IS NULL) AS alerts_open,
           (SELECT COALESCE(SUM(energy_wh),0) FROM sessions WHERE status='completed' AND started_at >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_energy_wh,
           (SELECT COALESCE(SUM(amount),0) FROM sessions WHERE status='completed' AND started_at >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_amount,
           (SELECT COALESCE(SUM(margin),0) FROM sessions WHERE status='completed' AND started_at >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_margin`,
        [TZ],
      );
    });

    crud(priv, {
      path: '/tariffs',
      table: 'tariffs',
      fields: [
        'name', 'currency', 'mode', 'session_fee',
        'price_kwh', 'offpeak_price_kwh', 'offpeak_start_hour', 'offpeak_end_hour', 'energy_cost_kwh',
        'punta_start_hour', 'punta_end_hour', 'valle_start_hour', 'valle_end_hour', 'punta_weekdays_only',
        'cost_punta', 'cost_llano', 'cost_valle', 'margin_punta', 'margin_llano', 'margin_valle',
      ],
    });

    crud(priv, {
      path: '/sites',
      table: 'sites',
      fields: ['name', 'kind', 'address', 'max_amps', 'tariff_id', 'line_owner', 'owner_name', 'owner_contact', 'phases', 'voltage', 'contracted_kw', 'punta_kw', 'power_strategy'],
      list: `SELECT s.*, t.name AS tariff_name,
               (SELECT count(*) FROM chargers c WHERE c.site_id=s.id) AS chargers,
               (SELECT count(*) FROM accounts a WHERE a.site_id=s.id) AS accounts
             FROM sites s LEFT JOIN tariffs t ON t.id=s.tariff_id ORDER BY s.name`,
      scopeCol: 'id',
    });

    crud(priv, {
      path: '/accounts',
      table: 'accounts',
      fields: ['site_id', 'name', 'unit', 'email', 'phone', 'billing_mode', 'credit_limit', 'tariff_id', 'active', 'doc_type', 'doc_number', 'legal_name', 'billing_address', 'billing_email'],
      list: `SELECT a.*, s.name AS site_name,
               (SELECT COALESCE(SUM(amount),0) FROM movements m WHERE m.account_id=a.id) AS balance,
               (SELECT count(*) FROM cards k WHERE k.account_id=a.id) AS cards
             FROM accounts a LEFT JOIN sites s ON s.id=a.site_id ORDER BY s.name NULLS LAST, a.unit, a.name`,
      scopeCol: 'site_id',
    });

    crud(priv, {
      path: '/cards',
      table: 'cards',
      key: 'id_tag',
      fields: ['id_tag', 'account_id', 'label', 'status', 'expires_at'],
      transform: (d) => (d.id_tag ? { ...d, id_tag: normTag(d.id_tag) } : d),
      list: `SELECT k.*, a.name AS account_name, a.unit AS account_unit FROM cards k JOIN accounts a ON a.id=k.account_id ORDER BY a.name, k.label`,
    });

    // Cargadores: se crean solos al conectarse; acá se aprueban y configuran
    // El hash de la contraseña OCPP nunca sale de la API: solo si tiene una propia o no
    const chargerOut = (c) => {
      if (!c) return c;
      const { ocpp_password_hash, ...rest } = c;
      return { ...rest, ocpp_password: !!ocpp_password_hash };
    };
    priv.get('/chargers', async () =>
      (await many(`SELECT c.*, s.name AS site_name, a.name AS owner_name,
              COALESCE((SELECT json_agg(json_build_object('connector_id', k.connector_id, 'status', k.status, 'error_code', k.error_code, 'updated_at', k.updated_at) ORDER BY k.connector_id)
                FROM connectors k WHERE k.charger_id=c.id), '[]') AS connectors,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'connector_id', x.connector_id, 'id_tag', x.id_tag, 'account', ac.name, 'started_at', x.started_at,
                  'energy_wh', x.last_meter_wh - x.meter_start_wh, 'power_w', x.power_w))
                FROM sessions x LEFT JOIN accounts ac ON ac.id=x.account_id WHERE x.charger_id=c.id AND x.status='active'), '[]') AS active_sessions
            , m.name AS model_name, m.ute_approved AS model_ute_approved
            FROM chargers c LEFT JOIN sites s ON s.id=c.site_id LEFT JOIN accounts a ON a.id=c.owner_account_id LEFT JOIN charger_models m ON m.id=c.model_id
            ORDER BY c.approved, s.name NULLS LAST, c.id`)).map(chargerOut),
    );
    priv.post('/chargers', async (req, reply) =>
      reply.code(201).send(chargerOut(await insert('chargers', pick(req.body, ['id', 'site_id', 'name', 'approved', 'max_amps', 'owner_account_id'])))),
    );
    priv.patch('/chargers/:id', async (req) => {
      const before = await one('SELECT approved FROM chargers WHERE id=$1', [req.params.id]);
      const row = await update('chargers', 'id', req.params.id, pick(req.body, ['site_id', 'name', 'approved', 'max_amps', 'owner_account_id', 'model_id']));
      // Al aprobarlo, si está conectado, se le aplica su driver
      if (!before?.approved && row.approved && clients.has(row.id)) setTimeout(() => applyDriver(row.id).catch(() => {}), 500);
      return chargerOut(row);
    });

    // Contraseña OCPP propia del cargador (Security Profile 1/2). Si está conectado se la manda con
    // ChangeConfiguration AuthorizationKey y se guarda solo cuando el equipo la acepta. Con {manual:true}
    // se guarda sin mandarla (para cargarla a mano en el equipo). La contraseña se muestra una sola vez.
    priv.post('/chargers/:id/ocpp-password', async (req) => {
      if (req.admin.role !== 'admin') throw new HttpError(403, 'solo un administrador cambia la contraseña de un cargador');
      const c = await one('SELECT id FROM chargers WHERE id=$1', [req.params.id]);
      if (!c) throw notFound();
      const password = randomBytes(12).toString('hex'); // 24 caracteres: dentro de los 16 a 40 que pide OCPP
      let sent = null;
      if (!req.body?.manual) {
        const r = await online(c.id).call('ChangeConfiguration', { key: 'AuthorizationKey', value: password });
        sent = r.status;
        if (!['Accepted', 'RebootRequired'].includes(r.status)) throw new HttpError(409, `el cargador respondió ${r.status} al cambiar la contraseña`);
      }
      await q('UPDATE chargers SET ocpp_password_hash=$2, ocpp_password_set_at=now() WHERE id=$1', [c.id, await bcrypt.hash(password, 10)]);
      return { password, sent, url: `wss://${(process.env.PUBLIC_URL || 'https://electricos.infratec.com.uy').replace(/^https?:\/\//, '').replace(/\/$/, '')}/ocpp/${c.id}` };
    });
    priv.delete('/chargers/:id/ocpp-password', async (req) => {
      if (req.admin.role !== 'admin') throw new HttpError(403, 'solo un administrador cambia la contraseña de un cargador');
      await q('UPDATE chargers SET ocpp_password_hash=NULL, ocpp_password_set_at=NULL WHERE id=$1', [req.params.id]);
      return { ok: true };
    });
    priv.delete('/chargers/:id', async (req, reply) => {
      const used = await one('SELECT 1 FROM sessions WHERE charger_id=$1 LIMIT 1', [req.params.id]);
      if (used) throw new HttpError(409, 'el cargador tiene sesiones registradas; desaprobalo en lugar de borrarlo');
      const r = await q('DELETE FROM chargers WHERE id=$1', [req.params.id]);
      if (!r.rowCount) throw notFound();
      return reply.code(204).send();
    });

    const online = (id) => {
      const c = clients.get(id);
      if (!c) throw new HttpError(409, 'el cargador no está conectado');
      return c;
    };
    priv.post('/chargers/:id/remote-start', async (req) => {
      const { idTag, connectorId = 1 } = req.body || {};
      return online(req.params.id).call('RemoteStartTransaction', { idTag: normTag(idTag), connectorId: Number(connectorId) });
    });
    priv.post('/chargers/:id/remote-stop', async (req) => {
      const s = await one("SELECT id FROM sessions WHERE charger_id=$1 AND status='active' AND ($2::int IS NULL OR id=$2) ORDER BY started_at LIMIT 1", [
        req.params.id,
        req.body?.sessionId ?? null,
      ]);
      if (!s) throw new HttpError(404, 'no hay sesión activa');
      return online(req.params.id).call('RemoteStopTransaction', { transactionId: s.id });
    });
    priv.post('/chargers/:id/reset', async (req) => online(req.params.id).call('Reset', { type: req.body?.type === 'Hard' ? 'Hard' : 'Soft' }));
    priv.post('/chargers/:id/unlock', async (req) => online(req.params.id).call('UnlockConnector', { connectorId: Number(req.body?.connectorId ?? 1) }));
    priv.post('/chargers/:id/local-list', async (req) => sendLocalList(req.params.id));
    priv.post('/chargers/:id/configuration', async (req) => online(req.params.id).call('ChangeConfiguration', { key: String(req.body?.key), value: String(req.body?.value) }));
    priv.get('/chargers/:id/configuration', async (req) => online(req.params.id).call('GetConfiguration', {}));
    priv.get('/chargers/:id/log', async (req) => many('SELECT * FROM ocpp_log WHERE charger_id=$1 ORDER BY ts DESC LIMIT 200', [req.params.id]));

    // Cierre manual de una sesión colgada (el cargador nunca mandó StopTransaction)
    priv.post('/sessions/:id/close', async (req) => {
      const s = await one("SELECT * FROM sessions WHERE id=$1 AND status='active'", [req.params.id]);
      if (!s) throw new HttpError(404, 'no hay sesión activa con ese número');
      return closeSession(s.id, { meterStop: s.last_meter_wh, reason: 'Cerrada desde el panel' });
    });

    priv.get('/sessions', async (req) => {
      const { accountId, chargerId, siteId, status, from, to, limit = 200 } = req.query;
      const rows = await many(
        `SELECT x.*, a.name AS account_name, a.unit AS account_unit, c.name AS charger_name, s.name AS site_name
           FROM sessions x LEFT JOIN accounts a ON a.id=x.account_id JOIN chargers c ON c.id=x.charger_id LEFT JOIN sites s ON s.id=c.site_id
          WHERE ($1::int IS NULL OR x.account_id=$1) AND ($2::text IS NULL OR x.charger_id=$2) AND ($3::int IS NULL OR c.site_id=$3)
            AND ($4::text IS NULL OR x.status=$4) AND ($5::date IS NULL OR x.started_at >= $5) AND ($6::date IS NULL OR x.started_at < $6)
            AND ($8::int[] IS NULL OR c.site_id = ANY($8))
          ORDER BY x.started_at DESC LIMIT $7`,
        [accountId || null, chargerId || null, siteId || null, status || null, from || null, to || null, Math.min(Number(limit) || 200, 2000), scopeOf(req)],
      );
      if (scopeOf(req)) for (const r of rows) { delete r.margin; delete r.energy_cost; }
      return rows;
    });

    // Código para que los residentes se unan a la cuenta desde la app
    priv.post('/accounts/:id/invite', async (req) => {
      const row = await one('UPDATE accounts SET invite_code=$2 WHERE id=$1 RETURNING id, invite_code', [req.params.id, newInviteCode()]);
      if (!row) throw notFound();
      return row;
    });
    priv.get('/accounts/:id/app-users', async (req) => many('SELECT id, name, email, phone, active, created_at FROM app_users WHERE account_id=$1 ORDER BY name', [req.params.id]));
    priv.patch('/app-users/:id', async (req) => {
      const d = pick(req.body, ['active', 'name', 'phone', 'email', 'account_id', 'notify_whatsapp', 'notify_email', 'notify_telegram']);
      if (d.email) d.email = String(d.email).trim().toLowerCase();
      if (d.account_id != null) {
        d.account_id = Number(d.account_id);
        if (!(await one('SELECT 1 FROM accounts WHERE id=$1', [d.account_id]))) throw new HttpError(400, 'la cuenta no existe');
        await q('UPDATE cards SET account_id=$2 WHERE app_user_id=$1', [req.params.id, d.account_id]);
      }
      if (d.active === false) d.tokens_valid_after = new Date();
      const r = await update('app_users', 'id', req.params.id, d);
      return { id: r.id, name: r.name, email: r.email, phone: r.phone, active: r.active, account_id: r.account_id };
    });

    priv.get('/reservations', async () =>
      many(`SELECT r.*, c.name AS charger_name, a.name AS account_name, a.unit AS account_unit FROM reservations r
              JOIN chargers c ON c.id=r.charger_id JOIN accounts a ON a.id=r.account_id
             WHERE r.status='active' AND r.ends_at > now() ORDER BY r.starts_at`),
    );
    priv.delete('/reservations/:id', async (req, reply) => {
      await q(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [req.params.id]);
      return reply.code(204).send();
    });

    priv.get('/alerts', async (req) =>
      many(`SELECT a.*, c.name AS charger_name, s.name AS site_name FROM alerts a LEFT JOIN chargers c ON c.id=a.charger_id LEFT JOIN sites s ON s.id=c.site_id
             WHERE ($1::boolean OR a.resolved_at IS NULL) ORDER BY a.resolved_at IS NULL DESC, a.opened_at DESC LIMIT 200`, [req.query.all === '1']),
    );
    priv.post('/alerts/:id/resolve', async (req) => update('alerts', 'id', req.params.id, { resolved_at: new Date() }));

    priv.get('/payments', async () =>
      many(`SELECT p.*, a.name AS account_name FROM payments p JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT 300`),
    );

    priv.get('/accounts/:id/movements', async (req) => {
      const sc = scopeOf(req);
      if (sc && !(await one('SELECT 1 FROM accounts WHERE id=$1 AND site_id = ANY($2)', [req.params.id, sc]))) throw notFound();
      return {
      balance: await accountBalance(req.params.id),
      movements: await many('SELECT * FROM movements WHERE account_id=$1 ORDER BY created_at DESC LIMIT 500', [req.params.id]),
      };
    });
    priv.post('/accounts/:id/movements', async (req, reply) => {
      const { kind, amount, description = '' } = req.body || {};
      if (!['payment', 'adjustment'].includes(kind)) throw new HttpError(400, 'kind debe ser payment o adjustment');
      if (!Number.isFinite(Number(amount)) || Number(amount) === 0) throw new HttpError(400, 'monto inválido');
      return reply.code(201).send(await insert('movements', { account_id: Number(req.params.id), kind, amount: Number(amount), description }));
    });

    // Liquidación al propietario de la línea: lo cobrado, el costo de energía a devolverle y el margen del operador, por sitio.
    priv.get('/reports/owners', async (req, reply) => {
      const [from, to] = monthRange(req.query.month);
      const rows = await many(
        `SELECT s.id AS site_id, s.name AS site, s.line_owner, s.owner_name, s.owner_contact,
                count(x.id) AS sessions, COALESCE(SUM(x.energy_wh),0) AS energy_wh, COALESCE(SUM(x.amount),0) AS amount,
                COALESCE(SUM(x.energy_cost),0) AS energy_cost, COALESCE(SUM(x.margin),0) AS margin,
                CASE WHEN s.line_owner='cliente' THEN COALESCE(SUM(x.energy_cost),0) ELSE 0 END AS to_owner
           FROM sites s
           LEFT JOIN chargers c ON c.site_id=s.id
           LEFT JOIN sessions x ON x.charger_id=c.id AND x.status='completed'
                AND x.started_at >= ($1::date::timestamp AT TIME ZONE $3) AND x.started_at < ($2::date::timestamp AT TIME ZONE $3)
          WHERE ($4::int[] IS NULL OR s.id = ANY($4))
          GROUP BY s.id ORDER BY s.name`,
        [from, to, TZ, scopeOf(req)],
      );
      if (scopeOf(req)) for (const r of rows) { delete r.margin; delete r.energy_cost; } // el margen del operador no se muestra al edificio
      if (req.query.format !== 'csv') return rows;
      const header = ['Sitio', 'Suministro de', 'Propietario', 'Sesiones', 'kWh', 'Cobrado', 'Costo energía', 'A liquidar al propietario', 'Margen'];
      const lines = rows.map((r) =>
        [r.site, r.line_owner, r.owner_name, r.sessions, (r.energy_wh / 1000).toFixed(3), r.amount.toFixed(2), r.energy_cost?.toFixed(2) ?? '', r.to_owner.toFixed(2), r.margin?.toFixed(2) ?? ''].map(csvCell).join(';'),
      );
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="propietarios-${req.query.month}.csv"`);
      return '\uFEFF' + [header.join(';'), ...lines].join('\n');
    });

    // Liquidación mensual por cuenta (para expensas). ?format=csv descarga el archivo.
    priv.get('/reports/monthly', async (req, reply) => {
      const [from, to] = monthRange(req.query.month);
      const rows = await many(
        `SELECT a.id AS account_id, s.name AS site, a.unit, a.name AS account, a.billing_mode,
                count(x.id) AS sessions, COALESCE(SUM(x.energy_wh),0) AS energy_wh, COALESCE(SUM(x.amount),0) AS amount
           FROM accounts a LEFT JOIN sites s ON s.id=a.site_id
           LEFT JOIN sessions x ON x.account_id=a.id AND x.status='completed'
                AND x.started_at >= ($1::date::timestamp AT TIME ZONE $4) AND x.started_at < ($2::date::timestamp AT TIME ZONE $4)
          WHERE ($3::int IS NULL OR a.site_id=$3) AND ($5::int[] IS NULL OR a.site_id = ANY($5))
          GROUP BY a.id, s.name ORDER BY s.name NULLS LAST, a.unit, a.name`,
        [from, to, req.query.siteId || null, TZ, scopeOf(req)],
      );
      if (req.query.format !== 'csv') return rows;
      const header = ['Sitio', 'Unidad', 'Cuenta', 'Modalidad', 'Sesiones', 'kWh', 'Importe'];
      const lines = rows.map((r) => [r.site, r.unit, r.account, r.billing_mode, r.sessions, (r.energy_wh / 1000).toFixed(3), r.amount.toFixed(2)].map(csvCell).join(';'));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="liquidacion-${req.query.month}.csv"`);
      return '﻿' + [header.join(';'), ...lines].join('\n');
    });
  });
}
