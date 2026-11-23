// Doble factor (TOTP, RFC 6238, compatible con Google Authenticator / Authy / 1Password) y bloqueo por intentos.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { one, q } from './db.js';
import { getSetting, encrypt, decrypt } from './settings.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(randomBytes(20));

export function totp(secret, t = Date.now(), step = 30) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = createHmac('sha1', unbase32(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
/** Acepta el código del período actual y uno antes/después (relojes desfasados). */
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return false;
  return [-1, 0, 1].some((w) => timingSafeEqual(Buffer.from(totp(secret, t + w * 30000)), Buffer.from(c)));
}
export const otpauthUri = (secret, email, issuer = 'Eléctricos Infratec') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export const sealSecret = (s) => (s ? encrypt(s) : null);
export const openSecret = (s) => (s ? decrypt(s) : null);

// Códigos de un solo uso enviados por WhatsApp: en memoria, 5 minutos, 3 intentos.
const sent = new Map();
export function issueWaCode(adminId) {
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  sent.set(adminId, { code, exp: Date.now() + 5 * 60000, tries: 0 });
  return code;
}
export function checkWaCode(adminId, code) {
  const s = sent.get(adminId);
  if (!s || s.exp < Date.now() || s.tries >= 3) return false;
  s.tries++;
  const ok = String(code || '').replace(/\D/g, '') === s.code;
  if (ok) sent.delete(adminId);
  return ok;
}

// ---------- Bloqueo por intentos fallidos ----------
const TABLES = new Set(['admins', 'app_users']);
async function policy() {
  const s = await getSetting('seguridad').catch(() => ({}));
  return { max: Number(s.max_attempts) || 5, minutes: Number(s.lock_minutes) || 15 };
}
/** Si la cuenta está bloqueada devuelve el mensaje para mostrar; si no, null. */
export function lockMessage(row) {
  if (!row?.locked_until || new Date(row.locked_until) <= new Date()) return null;
  const hora = new Date(row.locked_until).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ_LOCAL || 'America/Montevideo' });
  return `Demasiados intentos fallidos: la cuenta queda bloqueada hasta las ${hora}`;
}
/** Suma un intento fallido. Devuelve { locked: true, until } si con este se bloquea. */
export async function registerFailure(table, id) {
  if (!TABLES.has(table) || !id) return { locked: false };
  const { max, minutes } = await policy();
  const r = await one(
    `UPDATE ${table} SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
      WHERE id=$1 RETURNING failed_attempts, locked_until`, [id, max, minutes]);
  if (r && r.failed_attempts >= max) {
    await q(`UPDATE ${table} SET failed_attempts=0 WHERE id=$1`, [id]);
    return { locked: true, until: r.locked_until };
  }
  return { locked: false, left: max - (r?.failed_attempts || 0) };
}
export async function clearFailures(table, id) {
  if (TABLES.has(table)) await q(`UPDATE ${table} SET failed_attempts=0, locked_until=NULL WHERE id=$1`, [id]);
}
