import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceSession, isOffpeak } from '../src/billing.js';
import { parseMeterValue } from '../src/ocpp.js';

const tariff = { price_kwh: 10, offpeak_price_kwh: 4, offpeak_start_hour: 0, offpeak_end_hour: 7, session_fee: 5 };
// Montevideo es UTC-3: 02:00 local = 05:00Z, 10:00 local = 13:00Z
test('franja valle según hora de Montevideo', () => {
  assert.equal(isOffpeak(tariff, new Date('2026-11-23T05:00:00Z')), true);
  assert.equal(isOffpeak(tariff, new Date('2026-11-23T13:00:00Z')), false);
});

test('franja que cruza medianoche', () => {
  const t = { ...tariff, offpeak_start_hour: 22, offpeak_end_hour: 6 };
  assert.equal(isOffpeak(t, new Date('2026-11-24T02:00:00Z')), true); // 23:00 local
  assert.equal(isOffpeak(t, new Date('2026-11-23T20:00:00Z')), false); // 17:00 local
});

test('parte la energía entre valle y normal y suma el cargo fijo', () => {
  const r = priceSession(tariff, [
    { ts: '2026-11-23T09:00:00Z', energy_wh: 0 },     // 06:00 local
    { ts: '2026-11-23T09:59:00Z', energy_wh: 2000 },  // 06:59 local, valle: 2 kWh x 4
    { ts: '2026-11-23T11:00:00Z', energy_wh: 5000 },  // 08:00 local, normal: 3 kWh x 10
  ]);
  assert.equal(r.energy_wh, 5000);
  assert.equal(r.amount, 2 * 4 + 3 * 10 + 5);
});

test('ignora lecturas que retroceden', () => {
  const r = priceSession({ price_kwh: 10, session_fee: 0 }, [
    { ts: '2026-11-23T13:00:00Z', energy_wh: 1000 },
    { ts: '2026-11-23T13:10:00Z', energy_wh: 500 },
    { ts: '2026-11-23T13:20:00Z', energy_wh: 2000 },
  ]);
  assert.equal(r.energy_wh, 1500);
});

test('lee MeterValues en kWh y W, sin medición por fase', () => {
  const r = parseMeterValue({ timestamp: 'x', sampledValue: [
    { value: '12.5', unit: 'kWh' },
    { value: '7000', measurand: 'Power.Active.Import', unit: 'W' },
    { value: '2300', measurand: 'Power.Active.Import', unit: 'W', phase: 'L1' },
  ] });
  assert.deepEqual(r, { energy: 12500, power: 7000 });
});
