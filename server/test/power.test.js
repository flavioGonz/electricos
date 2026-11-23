import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../src/power.js';

const t0 = '2026-11-23T10:00:00Z', t1 = '2026-11-23T10:05:00Z', t2 = '2026-11-23T10:10:00Z';

test('reparte en partes iguales sin pasar el máximo de cada cargador', () => {
  const r = allocate([{ id: 1, max_a: 32, started_at: t0 }, { id: 2, max_a: 16, started_at: t1 }], 40);
  assert.equal(r.get(2), 16);
  assert.equal(r.get(1), 24);
});

test('si no alcanza el mínimo para todos, el último en llegar espera', () => {
  const r = allocate([{ id: 1, max_a: 32, started_at: t0 }, { id: 2, max_a: 32, started_at: t1 }, { id: 3, max_a: 32, started_at: t2 }], 14);
  assert.equal(r.get(1), 7);
  assert.equal(r.get(2), 7);
  assert.equal(r.get(3), 0);
});

test('lo que un auto casi lleno no usa pasa a los demás', () => {
  const r = allocate([{ id: 1, max_a: 32, started_at: t0, draw_a: 4, prev_limit_a: 16 }, { id: 2, max_a: 32, started_at: t1 }], 32);
  assert.equal(r.get(1), 6);
  assert.equal(r.get(2), 26);
});

test('por orden de llegada el primero recibe todo lo que admite', () => {
  const r = allocate([{ id: 1, max_a: 32, started_at: t0 }, { id: 2, max_a: 32, started_at: t1 }], 40, 'llegada');
  assert.equal(r.get(1), 32);
  assert.equal(r.get(2), 8);
});
