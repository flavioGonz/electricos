// Canal Telegram: un bot propio (creado con @BotFather). Se vinculan chats con /start <código>.
// Usa long polling (getUpdates), así no hace falta exponer un webhook público.
import { randomBytes } from 'node:crypto';
import { one, q } from './db.js';
import { getSetting } from './settings.js';

const api = async (token, method, body, timeout = 15000) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeout),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || `Telegram respondió ${res.status}`);
  return j.result;
};

/** Escapa texto para parse_mode HTML de Telegram. */
export const tgEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tgSend(chatId, html) {
  const tg = await getSetting('telegram');
  if (!tg.enabled || !tg.bot_token) throw new Error('Telegram no está configurado');
  return api(tg.bot_token, 'sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}

export async function tgStatus() {
  const tg = await getSetting('telegram');
  if (!tg.bot_token) return { status: 'sin configurar' };
  try {
    const me = await api(tg.bot_token, 'getMe', {}, 8000);
    return { status: tg.enabled ? 'conectado' : 'apagado', username: me.username, name: me.first_name };
  } catch (e) {
    return { status: 'sin conexión', error: e.message };
  }
}

/** Código de un solo uso para vincular un chat (vale 30 minutos). */
export async function tgLinkCode(kind, refId) {
  const tg = await getSetting('telegram');
  if (!tg.enabled || !tg.bot_token) throw Object.assign(new Error('Telegram todavía no está configurado'), { statusCode: 409 });
  let username = tg.bot_username;
  if (!username) {
    username = (await api(tg.bot_token, 'getMe', {}, 8000)).username;
  }
  const code = randomBytes(9).toString('base64url');
  await q(`DELETE FROM telegram_links WHERE expires_at < now() OR (kind=$1 AND ref_id=$2)`, [kind, refId]);
  await q(`INSERT INTO telegram_links(code, kind, ref_id, expires_at) VALUES ($1,$2,$3, now() + interval '30 minutes')`, [code, kind, refId]);
  return { url: `https://t.me/${username}?start=${code}`, username };
}

/** Procesa un mensaje entrante del bot. Devuelve el texto de respuesta (o null). Exportada para pruebas. */
export async function handleUpdate(u) {
  const msg = u.message;
  if (!msg?.chat?.id || typeof msg.text !== 'string') return null;
  const chatId = String(msg.chat.id);
  const m = /^\/start(?:\s+(\S+))?/.exec(msg.text.trim());
  if (!m) return 'Este bot solo manda avisos de Eléctricos. Para vincularlo usá el botón «Conectar Telegram» del panel o de la app.';
  if (!m[1]) return `Hola. Para recibir avisos, tocá «Conectar Telegram» en el panel o en la app.\nTu número de chat es <code>${chatId}</code>.`;
  const link = await one(`DELETE FROM telegram_links WHERE code=$1 AND expires_at > now() RETURNING *`, [m[1]]);
  if (!link) return 'El enlace venció o ya se usó. Generá uno nuevo desde Eléctricos.';
  if (link.kind === 'admin') {
    const a = await one('UPDATE admins SET telegram_chat_id=$2 WHERE id=$1 RETURNING name', [link.ref_id, chatId]);
    return `✅ Listo${a?.name ? `, ${tgEscape(a.name.split(' ')[0])}` : ''}. Vas a recibir acá las alertas de los cargadores y del sistema.`;
  }
  const usr = await one('UPDATE app_users SET telegram_chat_id=$2, notify_telegram=true WHERE id=$1 RETURNING name', [link.ref_id, chatId]);
  return `✅ Listo${usr?.name ? `, ${tgEscape(usr.name.split(' ')[0])}` : ''}. Te vamos a avisar acá cuando termine tu carga y si tu saldo está bajo.`;
}

let stopped = false;
/** Bucle de long polling. Se detiene con la función que devuelve. */
export function startTelegram(log = console) {
  stopped = false;
  let offset = 0;
  let lastToken = '';
  (async function loop() {
    while (!stopped) {
      const tg = await getSetting('telegram').catch(() => ({}));
      if (!tg.enabled || !tg.bot_token) { await new Promise((r) => setTimeout(r, 15000)); continue; }
      if (tg.bot_token !== lastToken) { lastToken = tg.bot_token; offset = 0; await api(tg.bot_token, 'deleteWebhook', {}).catch(() => {}); }
      try {
        const updates = await api(tg.bot_token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
        for (const u of updates) {
          offset = u.update_id + 1;
          const reply = await handleUpdate(u).catch((e) => { log.warn?.(`telegram: ${e.message}`); return null; });
          if (reply) await api(tg.bot_token, 'sendMessage', { chat_id: u.message.chat.id, text: reply, parse_mode: 'HTML' }).catch(() => {});
        }
      } catch (e) {
        log.warn?.(`telegram: ${e.message}`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  })();
  return () => { stopped = true; };
}
