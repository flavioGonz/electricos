import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines } from '../src/invoices.js';

test('separa la energía por franja y discrimina el IVA incluido', () => {
  const r = buildLines([
    { energy_wh: 10000, amount: 61, breakdown: [{ band: 'valle', energy_wh: 6000, amount: 30 }, { band: 'llano', energy_wh: 4000, amount: 30 }] },
    { energy_wh: 2000, amount: 12.2, breakdown: [{ band: 'valle', energy_wh: 2000, amount: 10 }] },
  ], { ivaRate: 22, includeIva: true });
  assert.equal(r.total, 73.2);
  assert.equal(r.lines.length, 3); // valle, llano y cargo fijo
  assert.equal(r.lines[0].quantity, 8);
  assert.equal(r.net + r.iva, r.total);
  assert.equal(r.net, 60);
});

test('si los precios no incluyen IVA se suma', () => {
  const r = buildLines([{ energy_wh: 1000, amount: 10, breakdown: [] }], { ivaRate: 22, includeIva: false });
  assert.equal(r.net, 10);
  assert.equal(r.total, 12.2);
});
