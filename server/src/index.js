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

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export async function build({ logger = true } = {}) {
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('Falta JWT_SECRET');
    process.env.JWT_SECRET = 'solo-desarrollo';
  }
  const app = Fastify({ logger, trustProxy: true });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET });
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
  events.on('session-closed', (sess) => onSessionClosed(sess).catch((e) => app.log.warn(`aviso de fin de carga: ${e.message}`)));
  const stop = async () => {
    stopMonitor();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return app;
}
