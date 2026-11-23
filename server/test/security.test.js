import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32, unbase32, totp, verifyTotp, lockMessage } from '../src/security.js';

// Vectores del RFC 6238 (SHA-1, secreto "12345678901234567890"), recortados a 6 dígitos
const SECRET = base32(Buffer.from('12345678901234567890'));
test('TOTP coincide con los vectores del RFC 6238', () => {
  assert.equal(totp(SECRET, 59 * 1000), '287082');
  assert.equal(totp(SECRET, 1111111109 * 1000), '081804');
  assert.equal(totp(SECRET, 1234567890 * 1000), '005924');
  assert.equal(totp(SECRET, 2000000000 * 1000), '279037');
});
test('base32 ida y vuelta', () => {
  assert.equal(unbase32(SECRET).toString(), '12345678901234567890');
  assert.equal(unbase32(SECRET.toLowerCase().replace(/(.{4})/g, '$1 ')).toString(), '12345678901234567890');
});
test('acepta el código de la ventana anterior y siguiente, no más', () => {
  const t = 1700000000000;
  assert.ok(verifyTotp(SECRET, totp(SECRET, t - 30000), t));
  assert.ok(verifyTotp(SECRET, totp(SECRET, t + 30000), t));
  assert.ok(!verifyTotp(SECRET, totp(SECRET, t - 90000), t));
  assert.ok(!verifyTotp(SECRET, '12345', t));
  assert.ok(!verifyTotp(null, '123456', t));
});
test('mensaje de bloqueo solo si el bloqueo sigue vigente', () => {
  assert.equal(lockMessage({ locked_until: new Date(Date.now() - 1000) }), null);
  assert.match(lockMessage({ locked_until: new Date(Date.now() + 600000) }), /bloqueada hasta las/);
  assert.equal(lockMessage(null), null);
});
