// API REST para el panel de administración.
import bcrypt from 'bcryptjs';
import { one, many, q } from './db.js';
import { clients, events, normTag, sendLocalList, accountBalance, closeSession } from './ocpp.js';
import appApi, { newInviteCode } from './app.js';

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

function crud(app, { path, table, key = 'id', fields, list, transform = (d) => d }) {
  app.get(path, async () => many(list || `SELECT * FROM ${table} ORDER BY ${key}`));
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
  const s = v == null ? '' : String(v);
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
    const message = err.code === '23505' ? 'ya existe' : err.code === '23503' ? 'está en uso o referencia algo que no existe' : err.message;
    reply.code(status).send({ error: message });
  });

  app.get('/health', async () => ({ ok: true, chargersConnected: clients.size }));

  app.post('/auth/login', async (req) => {
    const { email, password } = req.body || {};
    const admin = await one('SELECT * FROM admins WHERE email=$1', [String(email || '').toLowerCase()]);
    if (!admin || !(await bcrypt.compare(String(password || ''), admin.password_hash))) throw new HttpError(401, 'email o contraseña incorrectos');
    return { token: app.jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, { expiresIn: '12h' }), name: admin.name, email: admin.email };
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
    });

    priv.get('/me', async (req) => one('SELECT id, email, name FROM admins WHERE id=$1', [req.user.sub]));

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

    priv.get('/dashboard', async () => {
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
      fields: ['name', 'kind', 'address', 'max_amps', 'tariff_id', 'line_owner', 'owner_name', 'owner_contact'],
      list: `SELECT s.*, t.name AS tariff_name,
               (SELECT count(*) FROM chargers c WHERE c.site_id=s.id) AS chargers,
               (SELECT count(*) FROM accounts a WHERE a.site_id=s.id) AS accounts
             FROM sites s LEFT JOIN tariffs t ON t.id=s.tariff_id ORDER BY s.name`,
    });

    crud(priv, {
      path: '/accounts',
      table: 'accounts',
      fields: ['site_id', 'name', 'unit', 'email', 'phone', 'billing_mode', 'credit_limit', 'tariff_id', 'active'],
      list: `SELECT a.*, s.name AS site_name,
               (SELECT COALESCE(SUM(amount),0) FROM movements m WHERE m.account_id=a.id) AS balance,
               (SELECT count(*) FROM cards k WHERE k.account_id=a.id) AS cards
             FROM accounts a LEFT JOIN sites s ON s.id=a.site_id ORDER BY s.name NULLS LAST, a.unit, a.name`,
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
    priv.get('/chargers', async () =>
      many(`SELECT c.*, s.name AS site_name, a.name AS owner_name,
              COALESCE((SELECT json_agg(json_build_object('connector_id', k.connector_id, 'status', k.status, 'error_code', k.error_code, 'updated_at', k.updated_at) ORDER BY k.connector_id)
                FROM connectors k WHERE k.charger_id=c.id), '[]') AS connectors,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'connector_id', x.connector_id, 'id_tag', x.id_tag, 'account', ac.name, 'started_at', x.started_at,
                  'energy_wh', x.last_meter_wh - x.meter_start_wh, 'power_w', x.power_w))
                FROM sessions x LEFT JOIN accounts ac ON ac.id=x.account_id WHERE x.charger_id=c.id AND x.status='active'), '[]') AS active_sessions
            FROM chargers c LEFT JOIN sites s ON s.id=c.site_id LEFT JOIN accounts a ON a.id=c.owner_account_id
            ORDER BY c.approved, s.name NULLS LAST, c.id`),
    );
    priv.post('/chargers', async (req, reply) =>
      reply.code(201).send(await insert('chargers', pick(req.body, ['id', 'site_id', 'name', 'approved', 'max_amps', 'owner_account_id']))),
    );
    priv.patch('/chargers/:id', async (req) => update('chargers', 'id', req.params.id, pick(req.body, ['site_id', 'name', 'approved', 'max_amps', 'owner_account_id'])));
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
      return many(
        `SELECT x.*, a.name AS account_name, a.unit AS account_unit, c.name AS charger_name, s.name AS site_name
           FROM sessions x LEFT JOIN accounts a ON a.id=x.account_id JOIN chargers c ON c.id=x.charger_id LEFT JOIN sites s ON s.id=c.site_id
          WHERE ($1::int IS NULL OR x.account_id=$1) AND ($2::text IS NULL OR x.charger_id=$2) AND ($3::int IS NULL OR c.site_id=$3)
            AND ($4::text IS NULL OR x.status=$4) AND ($5::date IS NULL OR x.started_at >= $5) AND ($6::date IS NULL OR x.started_at < $6)
          ORDER BY x.started_at DESC LIMIT $7`,
        [accountId || null, chargerId || null, siteId || null, status || null, from || null, to || null, Math.min(Number(limit) || 200, 2000)],
      );
    });

    // Código para que los residentes se unan a la cuenta desde la app
    priv.post('/accounts/:id/invite', async (req) => {
      const row = await one('UPDATE accounts SET invite_code=$2 WHERE id=$1 RETURNING id, invite_code', [req.params.id, newInviteCode()]);
      if (!row) throw notFound();
      return row;
    });
    priv.get('/accounts/:id/app-users', async (req) => many('SELECT id, name, email, phone, active, created_at FROM app_users WHERE account_id=$1 ORDER BY name', [req.params.id]));
    priv.patch('/app-users/:id', async (req) => update('app_users', 'id', req.params.id, pick(req.body, ['active', 'name', 'phone'])));

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

    priv.get('/accounts/:id/movements', async (req) => ({
      balance: await accountBalance(req.params.id),
      movements: await many('SELECT * FROM movements WHERE account_id=$1 ORDER BY created_at DESC LIMIT 500', [req.params.id]),
    }));
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
          GROUP BY s.id ORDER BY s.name`,
        [from, to, TZ],
      );
      if (req.query.format !== 'csv') return rows;
      const header = ['Sitio', 'Suministro de', 'Propietario', 'Sesiones', 'kWh', 'Cobrado', 'Costo energía', 'A liquidar al propietario', 'Margen'];
      const lines = rows.map((r) =>
        [r.site, r.line_owner, r.owner_name, r.sessions, (r.energy_wh / 1000).toFixed(3), r.amount.toFixed(2), r.energy_cost.toFixed(2), r.to_owner.toFixed(2), r.margin.toFixed(2)].map(csvCell).join(';'),
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
          WHERE ($3::int IS NULL OR a.site_id=$3)
          GROUP BY a.id, s.name ORDER BY s.name NULLS LAST, a.unit, a.name`,
        [from, to, req.query.siteId || null, TZ],
      );
      if (req.query.format !== 'csv') return rows;
      const header = ['Sitio', 'Unidad', 'Cuenta', 'Modalidad', 'Sesiones', 'kWh', 'Importe'];
      const lines = rows.map((r) => [r.site, r.unit, r.account, r.billing_mode, r.sessions, (r.energy_wh / 1000).toFixed(3), r.amount.toFixed(2)].map(csvCell).join(';'));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="liquidacion-${req.query.month}.csv"`);
      return '﻿' + [header.join(';'), ...lines].join('\n');
    });
  });
}
