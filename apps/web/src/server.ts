import { createServer } from 'node:http';
import { log } from './logger.js';
import { loadServerConfig, validateServerConfig } from './server/config.js';
import { createServerContext } from './server/context.js';
import { dispatchRequest } from './server/dispatcher.js';
import { handleChiefRoutes } from './server/routes/chief.js';
import { handleAuthRoutes } from './server/routes/auth.js';
import { handlePlayerRoutes } from './server/routes/player.js';
import { handleAdminRoutes } from './server/routes/admin.js';
import { handleContentStudioRoutes } from './server/routes/contentStudio.js';
import { handlePublicRoutes } from './server/routes/public.js';

const config = loadServerConfig();
validateServerConfig(config);
const context = await createServerContext(config);

const handlers = [
  handleChiefRoutes,
  handleAuthRoutes,
  handlePlayerRoutes,
  handleAdminRoutes,
  handleContentStudioRoutes,
  handlePublicRoutes
];

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  await dispatchRequest(req, res, requestUrl, context, handlers);
});

const webAutosave = setInterval(() => {
  context.sessionStore.persistIfSupported();
}, 10000);
webAutosave.unref();

process.on('SIGINT', () => {
  context.sessionStore.persistIfSupported();
  process.exit(0);
});

process.on('SIGTERM', () => {
  context.sessionStore.persistIfSupported();
  process.exit(0);
});

server.listen(config.port ?? 3000, () => {
  log.info({
    port: config.port ?? 3000,
    runtimeBase: config.runtimeBase,
    serverBase: config.serverBase,
    internalTokenConfigured: Boolean(config.internalToken),
    wsAuthConfigured: Boolean(config.wsAuthSecret),
    chiefReady: true
  }, 'web server listening');
});
