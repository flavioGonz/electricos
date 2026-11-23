import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api, { ensureAdmin } from './api.js';
import { createOcppServer } from './ocpp.js';
import { migrate } from './migrate.js';
import { startMonitor } from './monitor.js';
import { events } from './ocpp.js';
import { onSessionClosed } from './notify.js';
import { startTelegram } from './telegram.js';

const PORT = Number(process.env.PORT || 3000);
// Solo se confía en X-Forwarded-For cuando viene del proxy (NGX). Si se confiara en cualquiera, un cliente podría
// falsear su IP (saltear el límite de intentos, la auditoría y el endpoint interno de respaldos).
const TRUST_PROXY = (process.env.TRUST_PROXY ?? '127.0.0.1,::1,192.168.99.75').split(',').map((x) => x.trim()).filter(Boolean);

// Cabeceras de seguridad para todas las respuestas (panel, app y API)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
export function securityHeaders(reply) {
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(self), geolocation=(), microphone=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Content-Security-Policy', CSP);
}
const HOST = process.env.HOST || '0.0.0.0';
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export async function build({ logger = true } = {}) {
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('Falta JWT_SECRET');
    process.env.JWT_SECRET = 'solo-desarrollo';
  }
  const app = Fastify({ logger, trustProxy: TRUST_PROXY.length ? TRUST_PROXY : false });
  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET tiene que tener al menos 32 caracteres');
  app.addHook('onSend', async (req, reply, payload) => {
    securityHeaders(reply);
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, verify: { algorithms: ['HS256'] }, sign: { algorithm: 'HS256' } });
  await app.register(api, { prefix: '/api' });

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA: cualquier ruta que no sea /api ni /ocpp devuelve index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ocpp')) return reply.sendFile('index.html');
      reply.code(404).send({ error: 'no encontrado' });
    });
  }

  const ocpp = createOcppServer({ log: app.log });
  // Los cargadores se conectan a ws(s)://host/ocpp/<identidad>
  app.server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ocpp/')) return socket.destroy();
    ocpp.handleUpgrade(req, socket, head);
  });
  app.addHook('onClose', async () => ocpp.close({ awaitPending: false, force: true }).catch(() => {}));
  return app;
}

export async function start() {
  await migrate((m) => console.log(m));
  const app = await build();
  await ensureAdmin(app.log);
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`OCPP en ws://${HOST}:${PORT}/ocpp/<id-del-cargador>`);
  const stopMonitor = startMonitor(app.log);
  const stopTelegram = startTelegram(app.log);
  events.on('session-closed', (sess) => onSessionClosed(sess).catch((e) => app.log.warn(`aviso de fin de carga: ${e.message}`)));
  const stop = async () => {
    stopMonitor();
    stopTelegram();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return app;
}
