// Pruebas de punta a punta de la API contra una base PostgreSQL descartable.
// Corre solo con TEST_DATABASE_URL, y solo si el nombre de la base contiene "test" (se borra entera).
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/electricos_test npm run test:api
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
const skip = !url ? 'definí TEST_DATABASE_URL para correr las pruebas de la API' : !/test/i.test(new URL(url).pathname) ? 'la base de prueba tiene que tener "test" en el nombre' : false;

let app, db, totp, adminToken;
const ADMIN = { email: 'admin@prueba.uy', password: 'clave-de-prueba-1' };

async function call(method, path, { token, body } = {}) {
  const res = await app.inject({ method, url: `/api${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body;

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = 'prueba';
  process.env.AUTH_RATE_LIMIT = '1000'; // las pruebas hacen muchos ingresos seguidos; el límite se prueba aparte
  process.env.ADMIN_EMAIL = ADMIN.email;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  db = await import('../../src/db.js');
  await db.q('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await (await import('../../src/migrate.js')).migrate(() => {});
  const { build } = await import('../../src/index.js');
  const { ensureAdmin } = await import('../../src/api.js');
  totp = (await import('../../src/security.js')).totp;
  app = await build({ logger: false });
  await ensureAdmin({});
  adminToken = (await login(ADMIN.email, ADMIN.password)).token;
});
after(async () => {
  if (skip) return;
  await app.close();
  await db.pool.end();
});

test('ingreso del administrador y datos base', { skip }, async () => {
  assert.ok(adminToken);
  const me = await call('GET', '/me', { token: adminToken });
  assert.equal(me.body.level, 'admin');
  const t = await call('POST', '/tariffs', { token: adminToken, body: { name: 'Residencial', currency: 'UYU', mode: 'simple', price_kwh: 10, energy_cost_kwh: 6 } });
  assert.equal(t.status, 201);
  for (const name of ['Torre Norte', 'Torre Sur']) {
    const s = await call('POST', '/sites', { token: adminToken, body: { name, kind: 'edificio', tariff_id: t.body.id } });
    assert.equal(s.status, 201);
    const a = await call('POST', '/accounts', { token: adminToken, body: { site_id: s.body.id, name: `Familia de ${name}`, unit: '101', billing_mode: 'postpaid', active: true } });
    assert.equal(a.status, 201);
  }
});

test('rol de solo lectura no puede cambiar nada', { skip }, async () => {
  const u = await call('POST', '/admins', { token: adminToken, body: { email: 'lee@prueba.uy', name: 'Lee', role: 'lectura', password: 'solo-lectura-1' } });
  assert.equal(u.status, 201);
  const tok = (await login('lee@prueba.uy', 'solo-lectura-1')).token;
  assert.equal((await call('GET', '/accounts', { token: tok })).status, 200);
  assert.equal((await call('POST', '/sites', { token: tok, body: { name: 'X' } })).status, 403);
});

test('la administración de un edificio solo ve su sitio', { skip }, async () => {
  const sites = (await call('GET', '/sites', { token: adminToken })).body;
  const norte = sites.find((s) => s.name === 'Torre Norte');
  const sinSitio = await call('POST', '/admins', { token: adminToken, body: { email: 'adm@norte.uy', name: 'Adm Norte', role: 'edificio', password: 'edificio-norte-1' } });
  assert.equal(sinSitio.status, 400);
  const u = await call('POST', '/admins', { token: adminToken, body: { email: 'adm@norte.uy', name: 'Adm Norte', role: 'edificio', password: 'edificio-norte-1', site_ids: [norte.id] } });
  assert.equal(u.status, 201);
  const tok = (await login('adm@norte.uy', 'edificio-norte-1')).token;
  const vis = (await call('GET', '/accounts', { token: tok })).body;
  assert.deepEqual(vis.map((a) => a.site_id), [norte.id]);
  assert.deepEqual((await call('GET', '/sites', { token: tok })).body.map((s) => s.id), [norte.id]);
  const otra = (await call('GET', '/accounts', { token: adminToken })).body.find((a) => a.site_id !== norte.id);
  assert.equal((await call('GET', `/accounts/${otra.id}/movements`, { token: tok })).status, 404);
  assert.equal((await call('GET', '/chargers', { token: tok })).status, 403);
  assert.equal((await call('GET', '/tariffs', { token: tok })).status, 403);
  assert.equal((await call('PATCH', `/accounts/${vis[0].id}`, { token: tok, body: { name: 'x' } })).status, 403);
  const owners = (await call('GET', '/reports/owners?month=2026-01', { token: tok })).body;
  assert.equal(owners.length, 1);
  assert.ok(!('margin' in owners[0]), 'el margen del operador no se muestra al edificio');
});

test('bloqueo tras intentos fallidos y desbloqueo por un administrador', { skip }, async () => {
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/auth/login', { body: { email: 'lee@prueba.uy', password: 'mal' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'lee@prueba.uy', password: 'mal' } })).status, 423);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'lee@prueba.uy', password: 'solo-lectura-1' } })).status, 423, 'bloqueado aunque ponga bien la clave');
  const lee = (await call('GET', '/admins', { token: adminToken })).body.find((a) => a.email === 'lee@prueba.uy');
  assert.ok(lee.locked_until);
  await call('POST', `/admins/${lee.id}/unlock`, { token: adminToken });
  assert.ok((await login('lee@prueba.uy', 'solo-lectura-1')).token);
});

test('doble factor con app de autenticación', { skip }, async () => {
  const setup = await call('POST', '/me/2fa/setup', { token: adminToken });
  const secret = setup.body.secret.replace(/ /g, '');
  assert.match(setup.body.uri, /^otpauth:\/\/totp\//);
  assert.equal((await call('POST', '/me/2fa/enable', { token: adminToken, body: { code: '000000' } })).status, 400);
  assert.equal((await call('POST', '/me/2fa/enable', { token: adminToken, body: { code: totp(secret) } })).status, 200);
  const step1 = await login(ADMIN.email, ADMIN.password);
  assert.equal(step1.need_2fa, true);
  assert.ok(!step1.token);
  assert.equal((await call('GET', '/me', { token: step1.ticket })).status, 401, 'el ticket intermedio no sirve como sesión');
  assert.equal((await call('POST', '/auth/2fa', { body: { ticket: step1.ticket, code: '123456' } })).status, 401);
  const ok = await call('POST', '/auth/2fa', { body: { ticket: step1.ticket, code: totp(secret) } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await call('POST', '/me/2fa/disable', { token: ok.body.token, body: { password: ADMIN.password } })).status, 200);
});

test('facturación: borradores del mes, registro manual y sin duplicar', { skip }, async () => {
  const acc = (await call('GET', '/accounts', { token: adminToken })).body[0];
  await db.q(`INSERT INTO chargers(id, approved, site_id) VALUES ('T-1', true, $1)`, [acc.site_id]);
  await db.q(`INSERT INTO sessions(charger_id, connector_id, id_tag, account_id, started_at, stopped_at, meter_start_wh, meter_stop_wh, energy_wh, amount, status, breakdown)
              VALUES ('T-1', 1, 'TAG', $1, '2026-01-10T15:00:00Z', '2026-01-10T17:00:00Z', 0, 10000, 10000, 122, 'completed', '[{"band":"normal","energy_wh":10000,"amount":122}]')`, [acc.id]);
  assert.deepEqual((await call('POST', '/invoices/generate', { token: adminToken, body: { month: '2026-01' } })).body, { created: 1 });
  assert.deepEqual((await call('POST', '/invoices/generate', { token: adminToken, body: { month: '2026-01' } })).body, { created: 0 });
  const [inv] = (await call('GET', '/invoices?month=2026-01', { token: adminToken })).body;
  assert.equal(inv.total, 122);
  assert.equal(inv.net, 100);
  assert.equal(inv.iva, 22);
  assert.equal((await call('POST', `/invoices/${inv.id}/issue`, { token: adminToken, body: {} })).status, 409, 'sin proveedor no se emite');
  const man = await call('POST', `/invoices/${inv.id}/issue`, { token: adminToken, body: { manual: true, series: 'A', number: '7' } });
  assert.equal(man.body.status, 'emitida');
  assert.equal((await call('POST', `/invoices/${inv.id}/cancel`, { token: adminToken })).status, 409);
});

test('consumo por hora a partir de las lecturas', { skip }, async () => {
  const s = await db.one(`INSERT INTO sessions(charger_id, connector_id, id_tag, started_at, stopped_at, meter_start_wh, energy_wh, status)
                          VALUES ('T-1', 1, 'TAG', '2026-02-03T22:00:00Z', '2026-02-03T23:00:00Z', 0, 5000, 'completed') RETURNING id`);
  await db.q(`INSERT INTO meter_values(session_id, ts, energy_wh) VALUES ($1,'2026-02-03T22:00:00Z',0), ($1,'2026-02-03T22:30:00Z',2000), ($1,'2026-02-03T23:00:00Z',5000)`, [s.id]);
  const c = (await call('GET', '/consumo?month=2026-02', { token: adminToken })).body;
  assert.equal(c.total_wh, 5000);
  assert.equal(c.byHour[19].normal, 2000); // 22:30Z = 19:30 en Montevideo
  assert.equal(c.byHour[20].normal, 3000);
});

test('gestión de usuarios de la app: contraseña, cierre de sesiones y ficha', { skip }, async () => {
  const acc = (await call('GET', '/accounts', { token: adminToken })).body[0];
  const u = await call('POST', '/app-users', { token: adminToken, body: { account_id: acc.id, name: 'Vecina Prueba', email: 'vecina@prueba.uy', password: 'inicial1' } });
  assert.equal(u.status, 201);
  const appLogin = async (password) => call('POST', '/app/login', { body: { email: 'vecina@prueba.uy', password } });
  const first = await appLogin('inicial1');
  assert.ok(first.body.token);
  assert.equal((await call('POST', `/app-users/${u.body.id}/password`, { token: adminToken, body: { password: '123' } })).status, 400);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await call('POST', `/app-users/${u.body.id}/password`, { token: adminToken, body: { password: 'cambiada1', logout: true } })).status, 200);
  assert.equal((await call('GET', '/app/me', { token: first.body.token })).status, 401, 'la sesión vieja queda cerrada');
  assert.equal((await appLogin('inicial1')).status, 401);
  const again = await appLogin('cambiada1');
  assert.equal((await call('GET', '/app/me', { token: again.body.token })).status, 200);
  const d = await call('GET', `/app-users/${u.body.id}`, { token: adminToken });
  assert.equal(d.body.name, 'Vecina Prueba');
  assert.ok(d.body.last_login_at);
  assert.ok(Array.isArray(d.body.months));
  assert.ok(Array.isArray((await call('GET', `/app-users/${u.body.id}/sessions`, { token: adminToken })).body));
  const act = await call('GET', `/app-users/${u.body.id}/activity`, { token: adminToken });
  assert.ok(act.body.length >= 1);
});

// ---------- Auditoría de seguridad ----------
const raw = (method, path, { token, body, ip = '127.0.0.1', headers = {} } = {}) =>
  app.inject({ method, url: `/api${path}`, remoteAddress: ip, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, payload: body });

test('cabeceras de seguridad en la API', { skip }, async () => {
  const r = await raw('GET', '/health');
  assert.match(r.headers['strict-transport-security'], /max-age=/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('X-Forwarded-For solo se acepta del proxy', { skip }, async () => {
  const fake = await raw('POST', '/internal/backup', { ip: '203.0.113.7', headers: { 'x-forwarded-for': '192.168.99.3' }, body: { ok: true } });
  assert.equal(fake.statusCode, 403, 'un cliente de afuera no puede hacerse pasar por pve02');
});

test('límite de intentos de ingreso por IP', { skip }, async (t) => {
  process.env.AUTH_RATE_LIMIT = '10';
  t.after(() => { process.env.AUTH_RATE_LIMIT = '1000'; });
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await raw('POST', '/auth/login', { ip: '203.0.113.9', body: { email: `nadie${i}@prueba.uy`, password: 'x' } })).statusCode);
  assert.equal(codes[0], 401);
  assert.equal(codes.at(-1), 429);
  assert.equal((await raw('POST', '/auth/login', { ip: '203.0.113.10', body: { email: 'nadie@prueba.uy', password: 'x' } })).statusCode, 401, 'otra IP no queda limitada');
});

test('restablecer la contraseña cierra las sesiones del panel', { skip }, async () => {
  const u = await call('POST', '/admins', { token: adminToken, body: { email: 'op@prueba.uy', name: 'Op', role: 'operador', password: 'operador-123' } });
  const tok = (await login('op@prueba.uy', 'operador-123')).token;
  assert.equal((await call('GET', '/me', { token: tok })).status, 200);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await call('POST', `/admins/${u.body.id}/reset-password`, { token: adminToken })).status, 200);
  assert.equal((await call('GET', '/me', { token: tok })).status, 401);
});

test('contraseña OCPP por cargador: no se expone el hash', { skip }, async () => {
  assert.equal((await call('POST', '/chargers', { token: adminToken, body: { id: 'SEG-1', approved: true } })).status, 201);
  const r = await call('POST', '/chargers/SEG-1/ocpp-password', { token: adminToken, body: { manual: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.password.length, 24);
  const c = (await call('GET', '/chargers', { token: adminToken })).body.find((x) => x.id === 'SEG-1');
  assert.equal(c.ocpp_password, true);
  assert.equal(c.ocpp_password_hash, undefined);
});

test('CSV de auditoría sin fórmulas', { skip }, async () => {
  await raw('POST', '/auth/login', { ip: '203.0.113.20', body: { email: '=HYPERLINK("http://x")', password: 'x' } });
  const r = await raw('GET', '/audit?format=csv', { token: adminToken });
  assert.ok(!/;=HYPERLINK/.test(r.body) && !/;"=HYPERLINK/.test(r.body));
});
