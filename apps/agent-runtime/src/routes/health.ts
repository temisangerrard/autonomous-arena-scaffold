import { sendJson, type SimpleRouter } from '../lib/http.js';

export function registerHealthRoutes(router: SimpleRouter, deps: {
  createHealthStatus: () => unknown;
  runtimeStatus: () => unknown;
}) {
  router.get('/health', (_req, res) => {
    sendJson(res, deps.createHealthStatus());
  });

  router.get('/status', (_req, res) => {
    sendJson(res, deps.runtimeStatus());
  });
}
