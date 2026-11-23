// Configuración guardada en la base. Las claves secretas se cifran con AES-256-GCM usando JWT_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { one, q } from './db.js';

const SECRET_KEYS = ['api_key', 'pass', 'secret'];
const key = () => createHash('sha256').update(`electricos:${process.env.JWT_SECRET || 'dev'}`).digest();

export function encrypt(text) {
  if (!text) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}
export function decrypt(v) {
  if (!v || !String(v).startsWith('enc:')) return v || '';
  try {
    const b = Buffer.from(String(v).slice(4), 'base64');
    const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const cache = new Map();
/** Lee una sección de configuración con los secretos ya descifrados. */
export async function getSetting(name) {
  if (cache.has(name)) return cache.get(name);
  const row = await one('SELECT value FROM app_settings WHERE key=$1', [name]);
  const v = { ...(row?.value || {}) };
  for (const k of SECRET_KEYS) if (k in v) v[k] = decrypt(v[k]);
  cache.set(name, v);
  return v;
}
/** Versión para mostrar en el panel: los secretos se reemplazan por un indicador. */
export async function getSettingPublic(name) {
  const v = { ...(await getSetting(name)) };
  for (const k of SECRET_KEYS) if (k in v) v[k] = v[k] ? '••••••••' : '';
  return v;
}
export async function setSetting(name, patch) {
  const cur = await getSetting(name);
  const next = { ...cur, ...patch };
  for (const k of SECRET_KEYS) if (k in patch && patch[k] === '••••••••') next[k] = cur[k]; // sin cambios
  const stored = { ...next };
  for (const k of SECRET_KEYS) if (k in stored) stored[k] = encrypt(stored[k]);
  await q(`INSERT INTO app_settings(key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [name, JSON.stringify(stored)]);
  cache.delete(name);
  return getSettingPublic(name);
}
