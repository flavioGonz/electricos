// Servidor central OCPP 1.6J: recibe a los cargadores, autoriza tarjetas, registra sesiones y cobra.
import { RPCServer } from 'ocpp-rpc';
import { EventEmitter } from 'node:events';
import { one, many, q, tx } from './db.js';
import { priceSession } from './billing.js';

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
    `SELECT c.*, a.active AS account_active, a.site_id AS account_site_id, a.billing_mode, a.credit_limit
       FROM cards c JOIN accounts a ON a.id = c.account_id WHERE c.id_tag=$1`,
    [idTag],
  );
  if (!card) return { info: { status: 'Invalid' } };
  const expiry = card.expires_at ? { expiryDate: new Date(card.expires_at).toISOString() } : {};
  if (card.status === 'blocked' || !card.account_active) return { info: { status: 'Blocked', ...expiry }, card };
  if (card.expires_at && new Date(card.expires_at) < new Date()) return { info: { status: 'Expired', ...expiry }, card };

  const charger = await one('SELECT * FROM chargers WHERE id=$1', [chargerId]);
  if (!charger || !charger.approved) return { info: { status: 'Invalid' }, card };
  if (charger.owner_account_id && charger.owner_account_id !== card.account_id) return { info: { status: 'Invalid' }, card };
  if (charger.site_id && card.account_site_id && charger.site_id !== card.account_site_id) return { info: { status: 'Invalid' }, card };

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
export async function closeSession(sessionId, { meterStop, timestamp, reason }) {
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
    // Si el medidor reportó menos que meterStop - meterStart (lecturas perdidas), confiamos en el total del medidor
    const total = Math.max(0, stopWh - s.meter_start_wh);
    let { energy_wh, amount } = priced;
    if (tariff && total > energy_wh) {
      amount += ((total - energy_wh) / 1000) * Number(tariff.price_kwh);
      energy_wh = total;
      amount = Math.round(amount * 100) / 100;
    }
    const updated = (
      await db.query(
        `UPDATE sessions SET stopped_at=$2, meter_stop_wh=$3, energy_wh=$4, amount=$5, stop_reason=$6, status='completed', power_w=NULL
          WHERE id=$1 RETURNING *`,
        [s.id, stoppedAt, stopWh, energy_wh, amount, reason || null],
      )
    ).rows[0];
    if (s.account_id && amount > 0) {
      await db.query(
        `INSERT INTO movements(account_id, kind, amount, description, session_id) VALUES ($1,'charge',$2,$3,$4)`,
        [s.account_id, -amount, `Carga ${(energy_wh / 1000).toFixed(2)} kWh en ${s.charger_id}`, s.id],
      );
    }
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

/** Reparte la potencia del sitio entre las sesiones activas (Smart Charging, TxProfile). */
export async function balanceSite(siteId, log = console) {
  if (!siteId) return;
  const site = await one('SELECT * FROM sites WHERE id=$1', [siteId]);
  if (!site || !site.max_amps) return;
  const active = await many(
    `SELECT s.id, s.charger_id, s.connector_id, c.max_amps FROM sessions s JOIN chargers c ON c.id=s.charger_id
      WHERE c.site_id=$1 AND s.status='active' ORDER BY s.started_at`,
    [siteId],
  );
  if (!active.length) return;
  const share = Math.floor(site.max_amps / active.length);
  for (const s of active) {
    const limit = Math.max(6, Math.min(share, s.max_amps)); // 6 A es el mínimo de IEC 61851
    const client = clients.get(s.charger_id);
    if (!client) continue;
    client
      .call('SetChargingProfile', {
        connectorId: s.connector_id,
        csChargingProfiles: {
          chargingProfileId: 100 + s.connector_id,
          transactionId: s.id,
          stackLevel: 0,
          chargingProfilePurpose: 'TxProfile',
          chargingProfileKind: 'Relative',
          chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit }] },
        },
      })
      .then((r) => events.emit('change', { type: 'power', chargerId: s.charger_id, limit, status: r.status }))
      .catch((err) => log.warn?.(`SetChargingProfile ${s.charger_id}: ${err.message}`));
  }
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
      const expected = process.env.OCPP_PASSWORD;
      if (expected) {
        const given = handshake.password ? handshake.password.toString() : '';
        if (given !== expected) return reject(401, 'credenciales inválidas');
      }
      await q('INSERT INTO chargers(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
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
