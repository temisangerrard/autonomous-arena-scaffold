import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyCredentialedCors } from '../cors.js';
import type { RouteHandler, ServerContext } from './types.js';

export type { RouteHandler } from './types.js';

export async function dispatchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  context: ServerContext,
  handlers: RouteHandler[]
): Promise<void> {
  if (requestUrl.pathname.startsWith('/api/')) {
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    res.setHeader('netlify-vary', 'cookie,query');
    applyCredentialedCors(req, res, context.config.allowedAuthOrigins);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  for (const handler of handlers) {
    if (await handler(req, res, requestUrl, context)) {
      return;
    }
  }

  if (!res.writableEnded) {
    res.statusCode = 404;
    res.end('Not Found');
  }
}
