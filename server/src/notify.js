// Avisos por WhatsApp (OpenWA), Telegram (bot propio) y correo (SMTP): fin de carga, saldo bajo, alertas y respaldos.
import nodemailer from 'nodemailer';
import { tgSend, tgEscape } from './telegram.js';
import { many, one, q } from './db.js';
import { getSetting } from './settings.js';

/** Normaliza un celular uruguayo: 099 123 456 → 59899123456. */
export function phoneToWa(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 9) d = '598' + d.slice(1);
  else if (d.length === 8 && d.startsWith('9')) d = '598' + d;
  return d.length >= 10 ? d : null;
}

async function record(channel, to, kind, subject, body, ref) {
  return one('INSERT INTO notifications(channel, to_addr, kind, subject, body, ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [channel, to, kind, subject, body, ref]);
}
const done = (id, status, error = null) => q('UPDATE notifications SET status=$2, error=$3 WHERE id=$1', [id, status, error]);

export async function sendWhatsApp(phone, text, { kind = 'aviso', ref = null, logText } = {}) {
  const wa = await getSetting('whatsapp');
  const num = phoneToWa(phone);
  if (!num) return { ok: false, error: 'número inválido' };
  const n = await record('whatsapp', num, kind, null, logText ?? text, ref);
  if (!wa.enabled || !wa.url || !wa.session || !wa.api_key) { await done(n.id, 'omitido', 'WhatsApp no está configurado'); return { ok: false, error: 'WhatsApp no está configurado' }; }
  try {
    const base = wa.url.replace(/\/$/, '');
    const send = () => fetch(`${base}/api/sessions/${encodeURIComponent(wa.session)}/messages/send-text`, {
      method: 'POST', headers: { 'X-API-Key': wa.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${num}@c.us`, text }), signal: AbortSignal.timeout(15000),
    });
    let res = await send();
    if (!res.ok && res.status >= 400) {
      // La sesión de OpenWA a veces queda desconectada: se intenta reactivar una vez
      await fetch(`${base}/api/sessions/${encodeURIComponent(wa.session)}/start`, { method: 'POST', headers: { 'X-API-Key': wa.api_key }, signal: AbortSignal.timeout(15000) }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      res = await send();
    }
    if (!res.ok) throw new Error(`OpenWA respondió ${res.status}: ${(await res.text()).slice(0, 160)}`);
    await done(n.id, 'enviado');
    return { ok: true };
  } catch (e) {
    await done(n.id, 'error', e.message);
    return { ok: false, error: e.message };
  }
}

let transport = null;
let transportKey = '';
export async function sendEmail(to, subject, text, { kind = 'aviso', ref = null } = {}) {
  const em = await getSetting('email');
  if (!to) return { ok: false, error: 'sin email' };
  const n = await record('email', to, kind, subject, text, ref);
  if (!em.enabled || !em.host || !em.user || !em.pass) { await done(n.id, 'omitido', 'El correo no está configurado'); return { ok: false, error: 'El correo no está configurado' }; }
  try {
    const k = JSON.stringify([em.host, em.port, em.user, em.pass, em.secure]);
    if (!transport || k !== transportKey) {
      transport = nodemailer.createTransport({ host: em.host, port: Number(em.port) || 587, secure: !!em.secure, auth: { user: em.user, pass: em.pass } });
      transportKey = k;
    }
    await transport.sendMail({ from: em.from || em.user, to, subject, text, html: `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#1d1d1f">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>` });
    await done(n.id, 'enviado');
    return { ok: true };
  } catch (e) {
    await done(n.id, 'error', e.message);
    return { ok: false, error: e.message };
  }
}

export async function sendTelegram(chatId, text, { kind = 'aviso', ref = null, subject = null } = {}) {
  if (!chatId) return { ok: false, error: 'sin chat de Telegram' };
  const n = await record('telegram', String(chatId), kind, subject, text, ref);
  const tg = await getSetting('telegram');
  if (!tg.enabled || !tg.bot_token) { await done(n.id, 'omitido', 'Telegram no está configurado'); return { ok: false, error: 'Telegram no está configurado' }; }
  try {
    await tgSend(chatId, (subject ? `<b>${tgEscape(subject)}</b>\n` : '') + tgEscape(text));
    await done(n.id, 'enviado');
    return { ok: true };
  } catch (e) {
    await done(n.id, 'error', e.message);
    return { ok: false, error: e.message };
  }
}

// Qué eventos salen por qué canal: avisos.canales[evento][canal] (true si no está definido)
const EVENT = { alerta: 'alertas', alertas: 'alertas', respaldo: 'respaldo', seguridad: 'seguridad', fin_carga: 'fin_carga', saldo_bajo: 'saldo_bajo' };
export function wants(cfg, kind, channel) {
  const ev = EVENT[kind] || kind;
  return cfg[ev] !== false && cfg.canales?.[ev]?.[channel] !== false;
}

/** Avisa a los administradores (listas de WhatsApp, Telegram y correo de Configuración → Avisos). */
export async function notifyAdmins(kind, subject, text, ref) {
  const cfg = await getSetting('avisos');
  if (wants(cfg, kind, 'whatsapp')) for (const p of cfg.admin_whatsapp || []) await sendWhatsApp(p, `⚡ ${subject}\n${text}`, { kind, ref });
  if (wants(cfg, kind, 'telegram')) {
    const linked = (await many(`SELECT telegram_chat_id FROM admins WHERE active AND role IN ('admin','operador') AND telegram_chat_id IS NOT NULL`)).map((r) => r.telegram_chat_id);
    for (const c of new Set([...(cfg.admin_telegram || []), ...linked])) await sendTelegram(c, text, { kind, ref, subject: `⚡ ${subject}` });
  }
  if (wants(cfg, kind, 'email')) for (const m of cfg.admin_email || []) await sendEmail(m, `Eléctricos · ${subject}`, text, { kind, ref });
}

const money = (n, cur = 'UYU') => new Intl.NumberFormat('es-UY', { style: 'currency', currency: cur }).format(Number(n || 0));
const kwh = (wh) => `${(Number(wh || 0) / 1000).toLocaleString('es-UY', { maximumFractionDigits: 2 })} kWh`;

/** Fin de carga: avisa al usuario de la app que cargó (o a la cuenta si cargó con tarjeta) y revisa el saldo. */
export async function onSessionClosed(s) {
  if (!s || !s.account_id || !(Number(s.energy_wh) > 0)) return;
  const cfg = await getSetting('avisos');
  const acc = await one('SELECT * FROM accounts WHERE id=$1', [s.account_id]);
  const ch = await one(`SELECT COALESCE(NULLIF(name,''), id) AS name FROM chargers WHERE id=$1`, [s.charger_id]);
  const user = await one('SELECT u.* FROM cards k JOIN app_users u ON u.id=k.app_user_id WHERE k.id_tag=$1', [s.id_tag]);
  const bal = Number((await one('SELECT COALESCE(SUM(amount),0) AS b FROM movements WHERE account_id=$1', [s.account_id])).b);
  const mins = Math.round((new Date(s.stopped_at) - new Date(s.started_at)) / 60000);
  const recipients = user
    ? { phone: user.notify_whatsapp ? user.phone : null, email: user.notify_email ? user.email : null, telegram: user.notify_telegram ? user.telegram_chat_id : null, name: user.name }
    : { phone: acc.phone, email: acc.email, telegram: null, name: acc.name };
  if (cfg.fin_carga !== false) {
    const ref = `session:${s.id}`;
    const text = `Hola ${String(recipients.name || '').split(' ')[0]}, terminó tu carga en ${ch?.name || s.charger_id}.\n` +
      `${kwh(s.energy_wh)} en ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`} · ${money(s.amount)}.\n` +
      (acc.billing_mode === 'prepaid' ? `Saldo disponible: ${money(bal)}.` : 'Se suma a la liquidación mensual de tu unidad.');
    if (recipients.phone && wants(cfg, 'fin_carga', 'whatsapp')) await sendWhatsApp(recipients.phone, `⚡ ${text}`, { kind: 'fin_carga', ref });
    if (recipients.telegram && wants(cfg, 'fin_carga', 'telegram')) await sendTelegram(recipients.telegram, text, { kind: 'fin_carga', ref, subject: '⚡ Terminó tu carga' });
    if (recipients.email && wants(cfg, 'fin_carga', 'email')) await sendEmail(recipients.email, 'Terminó tu carga', text, { kind: 'fin_carga', ref });
  }
  const umbral = Number(cfg.saldo_bajo_umbral ?? 200);
  const recent = acc.low_balance_notified_at && Date.now() - new Date(acc.low_balance_notified_at) < 24 * 3600e3;
  if (cfg.saldo_bajo !== false && acc.billing_mode === 'prepaid' && bal < umbral && !recent) {
    const text = `Tu saldo para cargar es de ${money(bal)}. Recargá desde la app para seguir cargando: ${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/app/cuenta`;
    const ref = `account:${acc.id}`;
    if (recipients.phone && wants(cfg, 'saldo_bajo', 'whatsapp')) await sendWhatsApp(recipients.phone, `🔋 ${text}`, { kind: 'saldo_bajo', ref });
    if (recipients.telegram && wants(cfg, 'saldo_bajo', 'telegram')) await sendTelegram(recipients.telegram, text, { kind: 'saldo_bajo', ref, subject: '🔋 Tu saldo está bajo' });
    if (recipients.email && wants(cfg, 'saldo_bajo', 'email')) await sendEmail(recipients.email, 'Tu saldo está bajo', text, { kind: 'saldo_bajo', ref });
    await q('UPDATE accounts SET low_balance_notified_at=now() WHERE id=$1', [acc.id]);
  }
}

export async function recentNotifications(limit = 100) {
  return many('SELECT * FROM notifications ORDER BY at DESC LIMIT $1', [limit]);
}

/** Resumen de los últimos 30 días por canal y estado, para el tablero de Avisos. */
export async function notificationStats() {
  const rows = await many(`SELECT channel, status, count(*)::int AS n FROM notifications WHERE at > now() - interval '30 days' GROUP BY channel, status`);
  const daily = await many(`SELECT to_char(date_trunc('day', at AT TIME ZONE $1), 'YYYY-MM-DD') AS day, count(*) FILTER (WHERE status='enviado')::int AS sent, count(*) FILTER (WHERE status='error')::int AS failed
                              FROM notifications WHERE at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`, [process.env.TZ_LOCAL || 'America/Montevideo']);
  return { rows, daily };
}
