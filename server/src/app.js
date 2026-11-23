// API de la app del usuario: registro, QR del cargador, iniciar/detener, consumo, reservas y pagos.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { one, many, q, tx } from './db.js';
import { clients, events, accountBalance } from './ocpp.js';
import { rateAt } from './billing.js';
import { audit } from './audit.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.statusCode = status;
  }
}

const PUBLIC_URL = () => (process.env.PUBLIC_URL || 'https://electricos.infratec.com.uy').replace(/\/$/, '');
const MP_TOKEN = () => process.env.MP_ACCESS_TOKEN;
export const appTag = (userId) => `APP-${userId}`;

/** Tarifa vigente para un cargador (la del sitio) o para una cuenta en ese cargador. */
async function tariffFor(chargerId, accountId = null) {
  return one(
    `SELECT t.* FROM tariffs t WHERE t.id = COALESCE(
       (SELECT tariff_id FROM accounts WHERE id=$1),
       (SELECT s.tariff_id FROM chargers c JOIN sites s ON s.id=c.site_id WHERE c.id=$2))`,
    [accountId, chargerId],
  );
}

function publicCharger(c, connectors, tariff, reservation, myAccountId) {
  const now = new Date();
  const rate = tariff ? rateAt(tariff, now) : null;
  return {
    id: c.id,
    name: c.name || c.id,
    site: c.site_name,
    online: c.connected,
    approved: c.approved,
    connectors: connectors.filter((k) => k.connector_id > 0).map((k) => ({ id: k.connector_id, status: k.status })),
    price: rate ? { band: rate.band, price_kwh: rate.price, currency: tariff.currency, session_fee: Number(tariff.session_fee || 0) } : null,
    reserved: reservation ? { mine: reservation.account_id === myAccountId, until: reservation.ends_at, from: reservation.starts_at } : null,
  };
}

/** Reserva vigente (o que empieza en los próximos minutos) de un cargador. */
export async function currentReservation(chargerId, at = new Date()) {
  return one(
    `SELECT * FROM reservations WHERE charger_id=$1 AND status='active' AND starts_at <= $2::timestamptz + interval '0 minutes' AND ends_at > $2
      ORDER BY starts_at LIMIT 1`,
    [chargerId, at],
  );
}

export async function settlePayment(paymentId, mp) {
  // mp: respuesta de GET /v1/payments/:id de Mercado Pago
  return tx(async (db) => {
    const p = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
    if (!p) return null;
    const status = mp.status === 'approved' ? 'approved' : ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(mp.status) ? 'rejected' : 'pending';
    if (p.status === 'approved') return p; // ya acreditado
    let movementId = null;
    if (status === 'approved') {
      const amount = Number(mp.transaction_amount ?? p.amount);
      movementId = (
        await db.query(`INSERT INTO movements(account_id, kind, amount, description) VALUES ($1,'payment',$2,$3) RETURNING id`, [
          p.account_id,
          amount,
          `Recarga Mercado Pago #${mp.id}`,
        ])
      ).rows[0].id;
    }
    return (
      await db.query('UPDATE payments SET status=$2, external_id=$3, movement_id=COALESCE($4, movement_id), updated_at=now() WHERE id=$1 RETURNING *', [
        p.id,
        status,
        String(mp.id),
        movementId,
      ])
    ).rows[0];
  });
}

export default async function appApi(app) {
  app.get('/config', async () => ({ payments: !!MP_TOKEN() }));

  app.post('/register', async (req, reply) => {
    const { name, email, phone, password, inviteCode } = req.body || {};
    if (!name || !email || !password) throw new HttpError(400, 'Completá nombre, email y contraseña');
    if (String(password).length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    const mail = String(email).trim().toLowerCase();
    if (await one('SELECT 1 FROM app_users WHERE email=$1', [mail])) throw new HttpError(409, 'Ya existe un usuario con ese email');
    const user = await tx(async (db) => {
      let accountId;
      if (inviteCode) {
        const acc = (await db.query('SELECT id FROM accounts WHERE invite_code=$1 AND active', [String(inviteCode).trim().toUpperCase()])).rows[0];
        if (!acc) throw new HttpError(400, 'El código de invitación no es válido');
        accountId = acc.id;
      } else {
        // Usuario externo (visita, barrio abierto): cuenta prepaga propia
        accountId = (await db.query(`INSERT INTO accounts(name, email, phone, billing_mode) VALUES ($1,$2,$3,'prepaid') RETURNING id`, [name, mail, phone || null])).rows[0].id;
      }
      const u = (
        await db.query('INSERT INTO app_users(account_id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, account_id, name, email', [
          accountId,
          name,
          mail,
          phone || null,
          await bcrypt.hash(String(password), 10),
        ])
      ).rows[0];
      await db.query(`INSERT INTO cards(id_tag, account_id, label, app_user_id) VALUES ($1,$2,$3,$4)`, [appTag(u.id), accountId, `App de ${name}`, u.id]);
      return u;
    });
    await audit({ actorType: 'app', actorId: user.id, actorName: name, action: 'crear', entity: 'app-users', entityId: user.id, summary: `se registró en la app${inviteCode ? ' con código de invitación' : ''}`, ip: req.ip });
    return reply.code(201).send({ token: app.jwt.sign({ sub: user.id, acc: user.account_id, role: 'user' }, { expiresIn: '90d' }), user });
  });

  app.post('/login', async (req) => {
    const { email, password } = req.body || {};
    const u = await one('SELECT * FROM app_users WHERE email=$1 AND active', [String(email || '').trim().toLowerCase()]);
    if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) throw new HttpError(401, 'Email o contraseña incorrectos');
    return { token: app.jwt.sign({ sub: u.id, acc: u.account_id, role: 'user' }, { expiresIn: '90d' }), user: { id: u.id, name: u.name, email: u.email } };
  });

  // Página pública del QR: estado y precio actual del cargador (sin datos personales)
  app.get('/chargers/:id', async (req) => {
    const c = await one('SELECT c.*, s.name AS site_name FROM chargers c LEFT JOIN sites s ON s.id=c.site_id WHERE c.id=$1', [req.params.id]);
    if (!c || !c.approved) throw new HttpError(404, 'Cargador no encontrado');
    const connectors = await many('SELECT connector_id, status FROM connectors WHERE charger_id=$1 ORDER BY connector_id', [c.id]);
    let accountId = null;
    try {
      await req.jwtVerify();
      if (req.user.role === 'user') accountId = req.user.acc;
    } catch {
      /* anónimo */
    }
    return publicCharger(c, connectors, await tariffFor(c.id, accountId), await currentReservation(c.id), accountId);
  });

  // Webhook de Mercado Pago (no requiere sesión: se verifica consultando el pago a la API de MP)
  app.post('/payments/webhook', async (req) => {
    const type = req.body?.type || req.query?.type || req.query?.topic;
    const id = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;
    if (type !== 'payment' || !id || !MP_TOKEN()) return { ok: true };
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${MP_TOKEN()}` } });
    if (!res.ok) return { ok: false };
    const mp = await res.json();
    const pid = Number(mp.external_reference);
    if (Number.isInteger(pid)) {
      const settled = await settlePayment(pid, mp);
      if (settled) events.emit('change', { type: 'payment', accountId: settled.account_id });
    }
    return { ok: true };
  });

  app.register(async (priv) => {
    priv.addHook('onRequest', async (req) => {
      try {
        await req.jwtVerify();
      } catch {
        throw new HttpError(401, 'Iniciá sesión de nuevo');
      }
      if (req.user.role !== 'user') throw new HttpError(403, 'Esta sección es para usuarios de la app');
      const u = await one('SELECT id, account_id, active FROM app_users WHERE id=$1', [req.user.sub]);
      if (!u || !u.active) throw new HttpError(401, 'Usuario deshabilitado');
      req.appUser = u;
    });

    priv.get('/me', async (req) => {
      const u = req.appUser;
      const account = await one('SELECT id, name, unit, billing_mode, credit_limit, site_id FROM accounts WHERE id=$1', [u.account_id]);
      const user = await one('SELECT id, name, email, phone, notify_whatsapp, notify_email FROM app_users WHERE id=$1', [u.id]);
      const active = await many(
        `SELECT x.id, x.charger_id, c.name AS charger_name, x.connector_id, x.started_at, x.last_meter_wh - x.meter_start_wh AS energy_wh, x.power_w
           FROM sessions x JOIN chargers c ON c.id=x.charger_id WHERE x.account_id=$1 AND x.status='active' ORDER BY x.started_at`,
        [u.account_id],
      );
      const recent = await many(
        `SELECT x.id, x.charger_id, c.name AS charger_name, x.started_at, x.stopped_at, x.energy_wh, x.amount, x.breakdown
           FROM sessions x JOIN chargers c ON c.id=x.charger_id
          WHERE x.account_id=$1 AND x.status='completed' AND x.energy_wh > 0 ORDER BY x.started_at DESC LIMIT 30`,
        [u.account_id],
      );
      const reservations = await many(
        `SELECT r.id, r.charger_id, c.name AS charger_name, r.starts_at, r.ends_at FROM reservations r JOIN chargers c ON c.id=r.charger_id
          WHERE r.account_id=$1 AND r.status='active' AND r.ends_at > now() ORDER BY r.starts_at`,
        [u.account_id],
      );
      const month = await one(
        `SELECT COALESCE(SUM(energy_wh),0) AS energy_wh, COALESCE(SUM(amount),0) AS amount FROM sessions
          WHERE account_id=$1 AND status='completed' AND started_at >= date_trunc('month', now() AT TIME ZONE 'America/Montevideo') AT TIME ZONE 'America/Montevideo'`,
        [u.account_id],
      );
      return { user, account, balance: await accountBalance(u.account_id), active, recent, reservations, month };
    });

    priv.patch('/me', async (req) => {
      const d = {};
      for (const k of ['notify_whatsapp', 'notify_email']) if (typeof req.body?.[k] === 'boolean') d[k] = req.body[k];
      if (typeof req.body?.phone === 'string') d.phone = req.body.phone.trim() || null;
      const keys = Object.keys(d);
      if (!keys.length) return { ok: true };
      await q(`UPDATE app_users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [req.appUser.id, ...Object.values(d)]);
      return { ok: true };
    });

    priv.get('/chargers', async (req) => {
      const acc = await one('SELECT site_id FROM accounts WHERE id=$1', [req.appUser.account_id]);
      return many(
        `SELECT c.id, COALESCE(NULLIF(c.name,''), c.id) AS name, s.name AS site, c.connected AS online,
                COALESCE((SELECT json_agg(json_build_object('id', k.connector_id, 'status', k.status) ORDER BY k.connector_id) FROM connectors k WHERE k.charger_id=c.id AND k.connector_id>0), '[]') AS connectors
           FROM chargers c LEFT JOIN sites s ON s.id=c.site_id
          WHERE c.approved AND ($1::int IS NULL OR c.site_id IS NULL OR c.site_id=$1) AND (c.owner_account_id IS NULL OR c.owner_account_id=$2)
          ORDER BY s.name NULLS LAST, c.name`,
        [acc?.site_id ?? null, req.appUser.account_id],
      );
    });

    priv.post('/chargers/:id/start', async (req) => {
      const client = clients.get(req.params.id);
      if (!client) throw new HttpError(409, 'El cargador no está conectado en este momento');
      const tag = appTag(req.appUser.id);
      const r = await client.call('RemoteStartTransaction', { idTag: tag, connectorId: Number(req.body?.connectorId || 1) });
      if (r.status !== 'Accepted') throw new HttpError(409, 'El cargador rechazó el inicio. ¿Está enchufado el auto?');
      await audit({ actorType: 'app', actorId: req.appUser.id, actorName: `usuario ${req.appUser.id}`, action: 'comando', entity: 'chargers', entityId: req.params.id, summary: `inició una carga desde la app en ${req.params.id}`, ip: req.ip });
      return { ok: true, message: 'Listo. Si no lo hiciste, enchufá el auto: la carga empieza sola.' };
    });

    priv.post('/sessions/:id/stop', async (req) => {
      const s = await one("SELECT * FROM sessions WHERE id=$1 AND account_id=$2 AND status='active'", [req.params.id, req.appUser.account_id]);
      if (!s) throw new HttpError(404, 'No tenés una carga activa con ese número');
      const client = clients.get(s.charger_id);
      if (!client) throw new HttpError(409, 'El cargador no está conectado. Desenchufá el auto para terminar.');
      const r = await client.call('RemoteStopTransaction', { transactionId: s.id });
      if (r.status !== 'Accepted') throw new HttpError(409, 'El cargador no aceptó la orden');
      return { ok: true };
    });

    // Reservas: bloques de 15 a 240 minutos, como máximo con 7 días de anticipación
    priv.post('/reservations', async (req, reply) => {
      const { chargerId, startsAt, minutes = 60 } = req.body || {};
      const start = new Date(startsAt || Date.now());
      const mins = Number(minutes);
      if (!Number.isFinite(start.getTime()) || !(mins >= 15 && mins <= 240)) throw new HttpError(400, 'Elegí entre 15 minutos y 4 horas');
      if (start < new Date(Date.now() - 5 * 60e3) || start > new Date(Date.now() + 7 * 864e5)) throw new HttpError(400, 'La reserva tiene que ser en los próximos 7 días');
      const end = new Date(start.getTime() + mins * 60e3);
      const c = await one('SELECT id, approved, owner_account_id FROM chargers WHERE id=$1', [chargerId]);
      if (!c || !c.approved) throw new HttpError(404, 'Cargador no encontrado');
      if (c.owner_account_id) throw new HttpError(400, 'Ese cargador es de uso exclusivo y no se reserva');
      const clash = await one(
        `SELECT 1 FROM reservations WHERE charger_id=$1 AND status='active' AND starts_at < $3 AND ends_at > $2`,
        [chargerId, start, end],
      );
      if (clash) throw new HttpError(409, 'Ese horario ya está reservado');
      const mine = await one(`SELECT count(*) AS n FROM reservations WHERE account_id=$1 AND status='active' AND ends_at > now()`, [req.appUser.account_id]);
      if (mine.n >= 2) throw new HttpError(409, 'Podés tener hasta 2 reservas activas');
      const r = await one(
        'INSERT INTO reservations(charger_id, account_id, app_user_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [chargerId, req.appUser.account_id, req.appUser.id, start, end],
      );
      events.emit('change', { type: 'reservation', chargerId });
      return reply.code(201).send(r);
    });
    priv.delete('/reservations/:id', async (req, reply) => {
      const r = await q(`UPDATE reservations SET status='cancelled' WHERE id=$1 AND account_id=$2 AND status='active'`, [req.params.id, req.appUser.account_id]);
      if (!r.rowCount) throw new HttpError(404, 'Reserva no encontrada');
      return reply.code(204).send();
    });
    priv.get('/chargers/:id/reservations', async (req) =>
      many(
        `SELECT id, starts_at, ends_at, account_id=$2 AS mine FROM reservations
          WHERE charger_id=$1 AND status='active' AND ends_at > now() AND starts_at < now() + interval '7 days' ORDER BY starts_at`,
        [req.params.id, req.appUser.account_id],
      ),
    );

    // Recarga de saldo con Mercado Pago (Checkout Pro)
    priv.post('/payments', async (req) => {
      if (!MP_TOKEN()) throw new HttpError(503, 'Los pagos online todavía no están habilitados');
      const amount = Math.round(Number(req.body?.amount) * 100) / 100;
      if (!(amount >= 50 && amount <= 20000)) throw new HttpError(400, 'El monto tiene que estar entre $50 y $20.000');
      const p = await one('INSERT INTO payments(account_id, app_user_id, amount) VALUES ($1,$2,$3) RETURNING *', [req.appUser.account_id, req.appUser.id, amount]);
      const base = PUBLIC_URL();
      const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${MP_TOKEN()}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `electricos-${p.id}` },
        body: JSON.stringify({
          items: [{ title: 'Recarga de saldo para carga de vehículo eléctrico', quantity: 1, unit_price: amount, currency_id: 'UYU' }],
          external_reference: String(p.id),
          notification_url: `${base}/api/app/payments/webhook`,
          back_urls: { success: `${base}/app?pago=ok`, pending: `${base}/app?pago=pendiente`, failure: `${base}/app?pago=error` },
          auto_return: 'approved',
        }),
      });
      const pref = await res.json().catch(() => ({}));
      if (!res.ok) {
        await q(`UPDATE payments SET status='cancelled', updated_at=now() WHERE id=$1`, [p.id]);
        req.log.error({ pref }, 'Mercado Pago rechazó la preferencia');
        throw new HttpError(502, 'No se pudo iniciar el pago. Probá de nuevo en unos minutos.');
      }
      await q('UPDATE payments SET preference_id=$2 WHERE id=$1', [p.id, pref.id]);
      return { url: pref.init_point, paymentId: p.id };
    });
  });
}

export function newInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}
