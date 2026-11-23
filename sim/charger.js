// Simulador de cargador OCPP 1.6J para probar la plataforma sin hardware.
// Uso: node charger.js --url ws://localhost:3000/ocpp --id SIM-01 --tag 04A1B2C3 --kwh 5 --kw 7.4 --speed 60
import { RPCClient } from 'ocpp-rpc';
import { parseArgs } from 'node:util';
import readline from 'node:readline';

const { values: o } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:3000/ocpp' },
    id: { type: 'string', default: 'SIM-01' },
    password: { type: 'string' },
    tag: { type: 'string' },          // si se pasa, hace una carga automática y termina
    kwh: { type: 'string', default: '5' },
    kw: { type: 'string', default: '7.4' },
    speed: { type: 'string', default: '60' }, // multiplicador de tiempo (60 = 1 minuto real por segundo)
    interval: { type: 'string', default: '2' }, // segundos reales entre MeterValues
  },
});

const client = new RPCClient({
  endpoint: o.url,
  identity: o.id,
  protocols: ['ocpp1.6'],
  strictMode: true,
  ...(o.password ? { password: o.password } : {}),
});

let meterWh = 1_000_000; // lectura acumulada del medidor
let tx = null;
let maxAmps = 32;
let clock = Date.now();
const now = () => new Date(clock).toISOString();
const log = (...a) => console.log(`[${o.id}]`, ...a);

client.handle('RemoteStartTransaction', ({ params }) => {
  setTimeout(() => startCharge(params.idTag, params.connectorId || 1), 200);
  return { status: 'Accepted' };
});
client.handle('RemoteStopTransaction', ({ params }) => {
  if (!tx || tx.id !== params.transactionId) return { status: 'Rejected' };
  setTimeout(() => stopCharge('Remote'), 200);
  return { status: 'Accepted' };
});
client.handle('SetChargingProfile', ({ params }) => {
  maxAmps = params.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit;
  log(`límite de potencia: ${maxAmps} A`);
  return { status: 'Accepted' };
});
client.handle('SendLocalList', ({ params }) => {
  log(`lista local recibida: ${params.localAuthorizationList?.length ?? 0} tarjetas`);
  return { status: 'Accepted' };
});
client.handle('Reset', () => ({ status: 'Accepted' }));
client.handle('UnlockConnector', () => ({ status: 'Unlocked' }));
client.handle('ChangeConfiguration', () => ({ status: 'Accepted' }));
client.handle('GetConfiguration', () => ({ configurationKey: [{ key: 'MeterValueSampleInterval', readonly: false, value: '60' }] }));

const status = (connectorId, s) => client.call('StatusNotification', { connectorId, errorCode: 'NoError', status: s, timestamp: now() });

async function startCharge(idTag, connectorId = 1) {
  if (tx) return log('ya hay una carga en curso');
  const auth = await client.call('Authorize', { idTag });
  log(`Authorize ${idTag}: ${auth.idTagInfo.status}`);
  if (auth.idTagInfo.status !== 'Accepted') return false;
  await status(connectorId, 'Preparing');
  const r = await client.call('StartTransaction', { connectorId, idTag, meterStart: meterWh, timestamp: now() });
  log(`StartTransaction #${r.transactionId}: ${r.idTagInfo.status}`);
  if (r.idTagInfo.status !== 'Accepted') {
    await status(connectorId, 'Available');
    return false;
  }
  tx = { id: r.transactionId, connectorId, idTag, startWh: meterWh };
  await status(connectorId, 'Charging');
  const dt = Number(o.interval) * Number(o.speed) * 1000; // ms simulados por tick
  tx.timer = setInterval(async () => {
    const kw = Math.min(Number(o.kw), (maxAmps * 230) / 1000);
    clock += dt;
    meterWh += Math.round((kw * 1000 * dt) / 3_600_000);
    await client.call('MeterValues', {
      connectorId,
      transactionId: tx.id,
      meterValue: [
        {
          timestamp: now(),
          sampledValue: [
            { value: String(meterWh), measurand: 'Energy.Active.Import.Register', unit: 'Wh', context: 'Sample.Periodic' },
            { value: String(Math.round(kw * 1000)), measurand: 'Power.Active.Import', unit: 'W', context: 'Sample.Periodic' },
          ],
        },
      ],
    }).catch((e) => log('MeterValues error', e.message));
    const done = (meterWh - tx.startWh) / 1000;
    process.stdout.write(`\r[${o.id}] ${done.toFixed(2)} kWh a ${kw.toFixed(1)} kW   `);
    if (o.tag && done >= Number(o.kwh)) stopCharge('EVDisconnected');
  }, Number(o.interval) * 1000);
  return true;
}

async function stopCharge(reason = 'Local') {
  if (!tx) return;
  clearInterval(tx.timer);
  const t = tx;
  tx = null;
  process.stdout.write('\n');
  const r = await client.call('StopTransaction', { transactionId: t.id, idTag: t.idTag, meterStop: meterWh, timestamp: now(), reason });
  log(`StopTransaction #${t.id}: ${((meterWh - t.startWh) / 1000).toFixed(2)} kWh (${r.idTagInfo?.status ?? 'ok'})`);
  await status(t.connectorId, 'Available');
  if (o.tag) {
    await client.close();
    process.exit(0);
  }
}

client.on('close', () => log('desconectado'));
await client.connect();
const boot = await client.call('BootNotification', { chargePointVendor: 'Simulador', chargePointModel: 'SIM-AC22', chargePointSerialNumber: o.id, firmwareVersion: '1.0' });
log(`BootNotification: ${boot.status}`);
if (boot.status !== 'Accepted') log('el cargador está pendiente de aprobación en el panel; igual queda conectado');
await status(0, 'Available');
await status(1, 'Available');
setInterval(() => client.call('Heartbeat', {}).catch(() => {}), 60_000);

if (o.tag) {
  const ok = await startCharge(o.tag);
  if (!ok) {
    await client.close();
    process.exit(2);
  }
} else {
  console.log('Comandos: start <idTag> | stop | quit');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (cmd === 'start' && arg) await startCharge(arg);
    else if (cmd === 'stop') await stopCharge('Local');
    else if (cmd === 'quit') process.exit(0);
  });
}
