import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/consumo.js';

const tariff = { mode: 'franjas', valle_start_hour: 0, valle_end_hour: 7, punta_start_hour: 18, punta_end_hour: 22, punta_weekdays_only: true, cost_punta: 10, cost_llano: 5, cost_valle: 2 };
// Montevideo es UTC-3: 05:00Z = 02:00 local (valle), 15:00Z = 12:00 (llano), 22:00Z = 19:00 (punta, martes)
const r = (s, ts, wh) => ({ session_id: s, ts, energy_wh: wh, account: 'Apto 1' });

test('reparte cada incremento por hora local, día y franja', () => {
  const readings = [
    r(1, '2026-11-10T04:00:00Z', 0), r(1, '2026-11-10T05:00:00Z', 3000),
    r(2, '2026-11-10T14:00:00Z', 1000), r(2, '2026-11-10T15:00:00Z', 3000),
    r(3, '2026-11-10T21:00:00Z', 0), r(3, '2026-11-10T22:00:00Z', 4000),
  ];
  const tariffs = new Map([[1, tariff], [2, tariff], [3, tariff]]);
  const a = aggregate(readings, tariffs, ['2026-11-10']);
  assert.equal(a.total_wh, 9000);
  assert.deepEqual([a.bands.valle, a.bands.llano, a.bands.punta], [3000, 2000, 4000]);
  assert.equal(a.byHour[2].valle, 3000);
  assert.equal(a.byHour[12].llano, 2000);
  assert.equal(a.byHour[19].punta, 4000);
  assert.equal(a.byDay[0].punta, 4000);
  assert.deepEqual(a.top, [{ account: 'Apto 1', wh: 9000 }]);
});

test('no mezcla lecturas de sesiones distintas ni cuenta lo anterior al mes', () => {
  const readings = [r(1, '2026-10-31T23:00:00Z', 0), r(1, '2026-11-01T04:00:00Z', 500), r(1, '2026-11-01T05:00:00Z', 900), r(2, '2026-11-01T05:30:00Z', 10000)];
  const a = aggregate(readings, new Map([[1, tariff], [2, tariff]]), ['2026-11-01'], new Date('2026-11-01T03:00:00Z'));
  assert.equal(a.total_wh, 900);
});
