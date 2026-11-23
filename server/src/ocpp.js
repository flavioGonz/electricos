// Servidor central OCPP 1.6J: recibe a los cargadores, autoriza tarjetas, registra sesiones y cobra.
import { audit } from './audit.js';
import { RPCServer } from 'ocpp-rpc';
import { EventEmitter } from 'node:events';
import { one, many, q, tx } from './db.js';
import { priceSession, rateAt } from './billing.js';
import { rebalance } from './power.js';
import bcrypt from 'bcryptjs';
import { safeEqual } from './security.js';

let insecureWarned = false;

export const events = new EventEmitter(); // eventos para el panel en vivo (SSE)
events.setMaxListeners(100);
export const clients = new Map(); // id de cargador -> cliente RPC conectado

const HEARTBEAT_INTERVAL = 300;

export const normTag = (t) => String(t || '').trim().toUpperCase();

/** Saldo de una cuenta (suma del libro de movimientos). */
export async function accountBalance(accountId, db = { query: q }) {
  const r = await db.query('SELECT COALESCE(SUM(amount),0) AS balance FROM movements WHERE account_id=$1', [accountId]);
  return Number(r.rows[0].balance);
}

/** Decide si una tarjeta puede cargar en un cargador. Devuelve el idTagInfo de OCPP y la tarjeta/cuenta. */
export async function authorizeTag(chargerId, rawTag, { allowActive = false } = {}) {
  const idTag = normTag(rawTag);
  const card = await one(
    `SELECT c.*, a.active AS account_active, a.site_id AS account_site_id, a.billing_mode, a.credit_limit, u.active AS app_user_active
       FROM cards c JOIN accounts a ON a.id = c.account_id LEFT JOIN app_users u ON u.id = c.app_user_id WHERE c.id_tag=$1`,
    [idTag],
  );
  if (!card) return { info: { status: 'Invalid' } };
  const expiry = card.expires_at ? { expiryDate: new Date(card.expires_at).toISOString() } : {};
  if (card.status === 'blocked' || !card.account_active || card.app_user_active === false) return { info: { status: 'Blocked', ...expiry }, card };
  if (card.expires_at && new Date(card.expires_at) < new Date()) return { info: { status: 'Expired', ...expiry }, card };

  const charger = await one('SELECT * FROM chargers WHERE id=$1', [chargerId]);
  if (!charger || !charger.approved) return { info: { status: 'Invalid' }, card };
  if (charger.owner_account_id && charger.owner_account_id !== card.account_id) return { info: { status: 'Invalid' }, card };
  if (charger.site_id && card.account_site_id && charger.site_id !== card.account_site_id) return { info: { status: 'Invalid' }, card };

  // Reserva vigente de otra cuenta: el cargador queda para quien reservó
  const reserved = await one(
    `SELECT account_id FROM reservations WHERE charger_id=$1 AND status='active' AND starts_at <= now() AND ends_at > now() LIMIT 1`,
    [chargerId],
  );
  if (reserved && reserved.account_id !== card.account_id) return { info: { status: 'Invalid' }, card };

  if (card.billing_mode === 'prepaid') {
    const balance = await accountBalance(card.account_id);
    if (balance + Number(card.credit_limit) <= 0) return { info: { status: 'Blocked', ...expiry }, card };
  }
  if (!allowActive) {
    // Una tarjeta no puede cargar en dos cargadores a la vez (en el mismo cargador lo resuelve el propio equipo)
    const active = await one("SELECT id FROM sessions WHERE id_tag=$1 AND status='active' AND charger_id<>$2", [idTag, chargerId]);
    if (active) return { info: { status: 'ConcurrentTx', ...expiry }, card };
  }
  return { info: { status: 'Accepted', ...expiry }, card };
}

/** Tarifa vigente: la de la cuenta, si no la del sitio del cargador. */
async function resolveTariff(accountId, chargerId) {
  return one(
    `SELECT t.* FROM tariffs t
      WHERE t.id = COALESCE(
        (SELECT tariff_id FROM accounts WHERE id=$1),
        (SELECT s.tariff_id FROM chargers c JOIN sites s ON s.id=c.site_id WHERE c.id=$2))`,
    [accountId, chargerId],
  );
}

/** Busca el driver que corresponde a una marca y modelo (el más específico gana). */
export async function matchModel(vendor, model) {
  return one(
    `SELECT * FROM charger_models WHERE active
        AND COALESCE($1,'') ILIKE replace(replace(vendor,'%','\\%'),'*','%') AND COALESCE($2,'') ILIKE replace(replace(model_pattern,'%','\\%'),'*','%')
      ORDER BY (vendor='*'), (model_pattern='*'), length(model_pattern) DESC LIMIT 1`,
    [vendor ?? '', model ?? ''],
  );
}

/** Aplica la configuración del driver con ChangeConfiguration y guarda el resultado de cada clave. */
export async function applyDriver(chargerId) {
  const client = clients.get(chargerId);
  if (!client) throw Object.assign(new Error('el cargador no está conectado'), { statusCode: 409 });
  const ch = await one('SELECT c.model_id, m.config, m.name FROM chargers c LEFT JOIN charger_models m ON m.id=c.model_id WHERE c.id=$1', [chargerId]);
  const config = ch?.config || {};
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    try {
      const r = await client.call('ChangeConfiguration', { key, value: String(value) });
      result[key] = r.status;
    } catch (e) {
      result[key] = 'Error';
    }
  }
  await q('UPDATE chargers SET config_applied_at=now(), config_result=$2 WHERE id=$1', [chargerId, JSON.stringify(result)]);
  const failed = Object.entries(result).filter(([, v]) => !['Accepted', 'RebootRequired'].includes(v)).map(([k]) => k);
  await audit({ actorType: 'sistema', actorName: 'Sistema', action: 'comando', entity: 'chargers', entityId: chargerId,
    summary: `aplicó el driver «${ch?.name || 'sin driver'}» a ${chargerId}${failed.length ? ` (rechazó: ${failed.join(', ')})` : ''}`, data: result });
  events.emit('change', { type: 'driver', chargerId });
  return { model: ch?.name || null, result };
}

/** Extrae energía (Wh) y potencia (W) de un MeterValue de OCPP 1.6. */
export function parseMeterValue(mv) {
  let energy = null;
  let power = null;
  for (const sv of mv.sampledValue || []) {
    const measurand = sv.measurand || 'Energy.Active.Import.Register';
    const value = Number(sv.value);
    if (!Number.isFinite(value)) continue;
    if (sv.phase) continue; // nos quedamos con el total, no por fase
    if (measurand === 'Energy.Active.Import.Register') energy = sv.unit === 'kWh' ? value * 1000 : value;
    if (measurand === 'Power.Active.Import') power = sv.unit === 'kW' ? value * 1000 : value;
  }
  return { energy, power };
}

/** Cierra una sesión: valoriza, guarda e imputa el cargo a la cuenta. Idempotente. */
export async function closeSession(sessionId, opts) {
  let closedNow = null;
  const r = await closeSessionTx(sessionId, opts, (u) => { closedNow = u; });
  if (closedNow) events.emit('session-closed', closedNow);
  return r;
}
async function closeSessionTx(sessionId, { meterStop, timestamp, reason }, onClosed) {
  return tx(async (db) => {
    const s = (await db.query('SELECT * FROM sessions WHERE id=$1 FOR UPDATE', [sessionId])).rows[0];
    if (!s || s.status === 'completed') return s;
    const stoppedAt = timestamp ? new Date(timestamp) : new Date();
    const stopWh = meterStop ?? s.last_meter_wh ?? s.meter_start_wh;
    await db.query('INSERT INTO meter_values(session_id, ts, energy_wh) VALUES ($1,$2,$3)', [s.id, stoppedAt, stopWh]);
    const readings = (await db.query('SELECT ts, energy_wh FROM meter_values WHERE session_id=$1 ORDER BY ts, id', [s.id])).rows;
    readings.unshift({ ts: s.started_at, energy_wh: s.meter_start_wh });
    const tariff = s.tariff_id ? (await db.query('SELECT * FROM tariffs WHERE id=$1', [s.tariff_id])).rows[0] : null;
    const priced = priceSession(tariff, readings);
    // Si faltan lecturas intermedias y meterStop - meterStart supera lo valorizado, el resto va a la franja del cierre
    const total = Math.max(0, stopWh - s.meter_start_wh);
    let { energy_wh, amount, energy_cost, margin, breakdown } = priced;
    if (tariff && total > energy_wh) {
      const r = rateAt(tariff, stoppedAt);
      const extra = total - energy_wh;
      amount = Math.round((amount + (extra / 1000) * r.price) * 100) / 100;
      energy_cost = Math.round((energy_cost + (extra / 1000) * r.cost) * 100) / 100;
      margin = Math.round((amount - energy_cost) * 100) / 100;
      breakdown = [...breakdown, { band: r.band, price_kwh: r.price, cost_kwh: r.cost, energy_wh: extra, amount: Math.round((extra / 1000) * r.price * 100) / 100 }];
      energy_wh = total;
    }
    const updated = (
      await db.query(
        `UPDATE sessions SET stopped_at=$2, meter_stop_wh=$3, energy_wh=$4, amount=$5, stop_reason=$6, status='completed', power_w=NULL,
                energy_cost=$7, margin=$8, breakdown=$9
          WHERE id=$1 RETURNING *`,
        [s.id, stoppedAt, stopWh, energy_wh, amount, reason || null, tariff ? energy_cost : null, tariff ? margin : null, JSON.stringify(breakdown)],
      )
    ).rows[0];
    if (s.account_id && amount > 0) {
      await db.query(
        `INSERT INTO movements(account_id, kind, amount, description, session_id) VALUES ($1,'charge',$2,$3,$4)`,
        [s.account_id, -amount, `Carga ${(energy_wh / 1000).toFixed(2)} kWh en ${s.charger_id}`, s.id],
      );
    }
    onClosed(updated);
    return updated;
  });
}

function logMessage(chargerId, direction, raw) {
  try {
    const msg = JSON.parse(raw);
    const [type, , a, b] = msg;
    const action = type === 2 ? a : type === 3 ? 'CallResult' : 'CallError';
    const payload = type === 2 ? b : a;
    q('INSERT INTO ocpp_log(charger_id, direction, action, payload) VALUES ($1,$2,$3,$4)', [chargerId, direction, action, payload ?? null]).catch(() => {});
  } catch {
    /* mensaje no JSON: lo ignora ocpp-rpc */
  }
}

/** Reparte la potencia del sitio entre las sesiones activas (Smart Charging, TxProfile). Ver power.js. */
export async function balanceSite(siteId, log = console) {
  return rebalance(siteId, async (chargerId, connectorId, sessionId, limit) => {
    const client = clients.get(chargerId);
    if (!client) throw new Error('no conectado');
    const r = await client.call('SetChargingProfile', {
      connectorId,
      csChargingProfiles: {
        chargingProfileId: 100 + connectorId,
        transactionId: sessionId,
        stackLevel: 0,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Relative',
        chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit }] },
      },
    });
    if (r.status !== 'Accepted') throw new Error(`el cargador respondió ${r.status}`);
    events.emit('change', { type: 'power', chargerId, limit });
  }, log);
}

/** Recalcula todos los sitios con límite (lo llama el monitor cada minuto: cubre cambios de franja y autos que se llenan). */
export async function balanceAll(log = console) {
  const sites = await many('SELECT DISTINCT c.site_id FROM sessions s JOIN chargers c ON c.id=s.charger_id WHERE s.status=$1 AND c.site_id IS NOT NULL', ['active']);
  for (const { site_id } of sites) await balanceSite(site_id, log).catch(() => {});
}

async function chargerSite(chargerId) {
  return (await one('SELECT site_id FROM chargers WHERE id=$1', [chargerId]))?.site_id;
}

export function createOcppServer({ log = console } = {}) {
  const server = new RPCServer({ protocols: ['ocpp1.6'], strictMode: true });

  server.auth(async (accept, reject, handshake) => {
    try {
      const id = handshake.identity;
      if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id)) return reject(400, 'identidad inválida');
      // Autenticación (OCPP 1.6 Security Profile 1/2, HTTP Basic):
      //  - si el cargador tiene contraseña propia, se exige esa;
      //  - si no, y hay OCPP_PASSWORD, se exige la compartida;
      //  - sin ninguna de las dos se acepta (modo inseguro, solo para la puesta en marcha).
      const given = handshake.password ? handshake.password.toString() : '';
      const known = await one('SELECT id, ocpp_password_hash FROM chargers WHERE id=$1', [id]);
      if (known?.ocpp_password_hash) {
        if (!given || !(await bcrypt.compare(given, known.ocpp_password_hash))) {
          log.warn?.(`OCPP: contraseña incorrecta para ${id} desde ${handshake.remoteAddress}`);
          return reject(401, 'credenciales inválidas');
        }
      } else if (process.env.OCPP_PASSWORD) {
        if (!safeEqual(given, process.env.OCPP_PASSWORD)) {
          log.warn?.(`OCPP: contraseña incorrecta para ${id} desde ${handshake.remoteAddress}`);
          return reject(401, 'credenciales inválidas');
        }
      } else if (!insecureWarned) {
        insecureWarned = true;
        log.warn?.('OCPP sin contraseña: cualquiera puede conectarse como un cargador. Definí OCPP_PASSWORD o una contraseña por cargador.');
      }
      if (!known) {
        // Alta automática de cargadores nuevos (quedan pendientes de aprobación). Se puede apagar con OCPP_AUTO_REGISTER=0.
        if (process.env.OCPP_AUTO_REGISTER === '0') return reject(404, 'cargador no registrado');
        const pending = await one('SELECT count(*)::int AS n FROM chargers WHERE NOT approved');
        if (pending.n >= 50) return reject(503, 'demasiados cargadores pendientes de aprobación');
        await q('INSERT INTO chargers(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
      }
      accept({ id });
    } catch (err) {
      log.error?.(err);
      reject(500);
    }
  });

  server.on('client', async (client) => {
    const id = client.identity;
    clients.get(id)?.close({ code: 1000, reason: 'reemplazado' }).catch(() => {});
    clients.set(id, client);
    await q('UPDATE chargers SET connected=true, last_seen=now() WHERE id=$1', [id]);
    events.emit('change', { type: 'connected', chargerId: id });
    log.info?.(`cargador conectado: ${id}`);

    client.on('message', ({ message, outbound }) => logMessage(id, outbound ? 'out' : 'in', message));
    client.on('close', async () => {
      if (clients.get(id) === client) {
        clients.delete(id);
        await q('UPDATE chargers SET connected=false WHERE id=$1', [id]).catch(() => {});
        events.emit('change', { type: 'disconnected', chargerId: id });
        log.info?.(`cargador desconectado: ${id}`);
      }
    });

    const touch = () => q('UPDATE chargers SET last_seen=now() WHERE id=$1', [id]).catch(() => {});

    client.handle('BootNotification', async ({ params }) => {
      const c = await one(
        `UPDATE chargers SET vendor=$2, model=$3, serial=$4, firmware=$5, last_seen=now() WHERE id=$1 RETURNING approved`,
        [id, params.chargePointVendor, params.chargePointModel, params.chargePointSerialNumber ?? params.chargeBoxSerialNumber ?? null, params.firmwareVersion ?? null],
      );
      // Driver: se detecta por marca y modelo, y si el equipo está aprobado se le aplica su configuración
      const model = await matchModel(params.chargePointVendor, params.chargePointModel);
      if (model) await q('UPDATE chargers SET model_id=$2 WHERE id=$1 AND model_id IS NULL', [id, model.id]);
      if (c?.approved) setTimeout(() => applyDriver(id).catch(() => {}), 3000);
      events.emit('change', { type: 'boot', chargerId: id });
      return { status: c?.approved ? 'Accepted' : 'Pending', currentTime: new Date().toISOString(), interval: HEARTBEAT_INTERVAL };
    });

    client.handle('Heartbeat', async () => {
      await touch();
      return { currentTime: new Date().toISOString() };
    });

    client.handle('StatusNotification', async ({ params }) => {
      await q(
        `INSERT INTO connectors(charger_id, connector_id, status, error_code, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (charger_id, connector_id) DO UPDATE SET status=EXCLUDED.status, error_code=EXCLUDED.error_code, updated_at=now()`,
        [id, params.connectorId, params.status, params.errorCode],
      );
      await touch();
      events.emit('change', { type: 'status', chargerId: id, connectorId: params.connectorId, status: params.status });
      return {};
    });

    client.handle('Authorize', async ({ params }) => {
      const { info } = await authorizeTag(id, params.idTag);
      return { idTagInfo: info };
    });

    client.handle('StartTransaction', async ({ params }) => {
      const idTag = normTag(params.idTag);
      const { info, card } = await authorizeTag(id, idTag);
      const accountId = card?.account_id ?? null;
      const tariff = accountId ? await resolveTariff(accountId, id) : null;
      // Si quedó una sesión abierta en este conector (el cargador se reinició sin informar el fin), se cierra con la última lectura
      const stale = await many("SELECT id, last_meter_wh FROM sessions WHERE charger_id=$1 AND connector_id=$2 AND status='active'", [id, params.connectorId]);
      for (const s of stale) await closeSession(s.id, { meterStop: s.last_meter_wh, reason: 'Cerrada: nueva sesión en el conector' });
      // OCPP exige un transactionId aunque se rechace: registramos la sesión y la cerramos si no es aceptada
      const s = await one(
        `INSERT INTO sessions(charger_id, connector_id, id_tag, account_id, tariff_id, started_at, meter_start_wh, last_meter_wh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [id, params.connectorId, idTag, accountId, tariff?.id ?? null, new Date(params.timestamp), params.meterStart],
      );
      if (info.status !== 'Accepted') {
        await closeSession(s.id, { meterStop: params.meterStart, timestamp: params.timestamp, reason: `Rechazada: ${info.status}` });
      } else {
        events.emit('change', { type: 'start', chargerId: id, sessionId: s.id });
        balanceSite(await chargerSite(id), log);
      }
      return { transactionId: s.id, idTagInfo: info };
    });

    client.handle('MeterValues', async ({ params }) => {
      if (!params.transactionId) return {};
      const s = await one("SELECT id FROM sessions WHERE id=$1 AND charger_id=$2 AND status='active'", [params.transactionId, id]);
      if (!s) return {};
      for (const mv of params.meterValue) {
        const { energy, power } = parseMeterValue(mv);
        if (energy == null && power == null) continue;
        await q('INSERT INTO meter_values(session_id, ts, energy_wh, power_w) VALUES ($1,$2,$3,$4)', [s.id, new Date(mv.timestamp), energy, power]);
        await q('UPDATE sessions SET last_meter_wh=COALESCE($2,last_meter_wh), power_w=COALESCE($3,power_w) WHERE id=$1', [s.id, energy, power]);
      }
      events.emit('change', { type: 'meter', chargerId: id, sessionId: s.id });
      return {};
    });

    client.handle('StopTransaction', async ({ params }) => {
      const s = await one('SELECT * FROM sessions WHERE id=$1 AND charger_id=$2', [params.transactionId, id]);
      if (!s) return { idTagInfo: { status: 'Invalid' } };
      for (const td of params.transactionData || []) {
        const { energy, power } = parseMeterValue(td);
        if (energy != null && s.status === 'active') {
          await q('INSERT INTO meter_values(session_id, ts, energy_wh, power_w) VALUES ($1,$2,$3,$4)', [s.id, new Date(td.timestamp), energy, power]);
        }
      }
      await closeSession(s.id, { meterStop: params.meterStop, timestamp: params.timestamp, reason: params.reason || 'Local' });
      events.emit('change', { type: 'stop', chargerId: id, sessionId: s.id });
      balanceSite(await chargerSite(id), log);
      return params.idTag ? { idTagInfo: { status: 'Accepted' } } : {};
    });

    client.handle('DataTransfer', async () => ({ status: 'UnknownVendorId' }));
    client.handle('DiagnosticsStatusNotification', async () => ({}));
    client.handle('FirmwareStatusNotification', async () => ({}));
  });

  return server;
}

/** Envía la lista local de tarjetas habilitadas a un cargador (para cargar sin internet). */
export async function sendLocalList(chargerId) {
  const client = clients.get(chargerId);
  if (!client) throw new Error('cargador desconectado');
  const c = await one('SELECT site_id, owner_account_id FROM chargers WHERE id=$1', [chargerId]);
  const cards = await many(
    `SELECT k.id_tag, k.expires_at FROM cards k JOIN accounts a ON a.id=k.account_id
      WHERE k.status='active' AND a.active AND (k.expires_at IS NULL OR k.expires_at > now())
        AND ($1::int IS NULL OR a.site_id IS NULL OR a.site_id=$1)
        AND ($2::int IS NULL OR a.id=$2)
        AND a.billing_mode='postpaid'`,
    [c?.site_id ?? null, c?.owner_account_id ?? null],
  );
  const listVersion = Math.floor(Date.now() / 1000);
  return client.call('SendLocalList', {
    listVersion,
    updateType: 'Full',
    localAuthorizationList: cards.map((k) => ({
      idTag: k.id_tag.slice(0, 20),
      idTagInfo: { status: 'Accepted', ...(k.expires_at ? { expiryDate: new Date(k.expires_at).toISOString() } : {}) },
    })),
  });
}
