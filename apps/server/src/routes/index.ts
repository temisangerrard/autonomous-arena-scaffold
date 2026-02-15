/**
 * HTTP route handlers for the game server
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHealthStatus } from '../health.js';
import type { PresenceStore } from '../PresenceStore.js';
import type { DistributedChallengeStore } from '../DistributedChallengeStore.js';
import type { ChallengeService } from '../ChallengeService.js';

export type RouteContext = {
  serverInstanceId: string;
  presenceStore: PresenceStore;
  distributedChallengeStore: DistributedChallengeStore;
  challengeService: ChallengeService;
};

/**
 * Set CORS headers on response
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

/**
 * Handle health check endpoint
 */
export function handleHealth(req: IncomingMessage, res: ServerResponse): void {
  const payload = createHealthStatus();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Handle presence endpoint
 */
export async function handlePresence(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  const id = parsed.searchParams.get('id')?.trim();
  res.setHeader('content-type', 'application/json');
  
  if (id) {
    try {
      const entry = await ctx.presenceStore.get(id);
      res.end(JSON.stringify({ ok: true, presence: entry }));
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, reason: 'presence_lookup_failed' }));
    }
    return;
  }
  
  try {
    const entries = await ctx.presenceStore.list();
    res.end(JSON.stringify({ ok: true, serverId: ctx.serverInstanceId, players: entries }));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, reason: 'presence_list_failed' }));
  }
}

/**
 * Handle challenges recent endpoint
 */
export async function handleChallengesRecent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  const limit = Math.max(1, Math.min(300, Number(parsed.searchParams.get('limit') ?? 60)));
  res.setHeader('content-type', 'application/json');
  
  try {
    const recent = await ctx.distributedChallengeStore.recentHistory(limit);
    if (recent.length > 0) {
      res.end(JSON.stringify({ recent }));
      return;
    }
    res.end(JSON.stringify({ recent: ctx.challengeService.getRecent(limit) }));
  } catch {
    res.end(JSON.stringify({ recent: ctx.challengeService.getRecent(limit) }));
  }
}

/**
 * Handle favicon endpoint
 */
export function handleFavicon(req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

/**
 * Handle 404 Not Found
 */
export function handleNotFound(req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 404;
  res.end('Not Found');
}

/**
 * Main HTTP request router
 */
export function createRouter(ctx: RouteContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.url === '/health') {
      handleHealth(req, res);
      return;
    }

    if (req.url?.startsWith('/presence')) {
      await handlePresence(req, res, ctx);
      return;
    }

    if (req.url?.startsWith('/challenges/recent')) {
      await handleChallengesRecent(req, res, ctx);
      return;
    }

    if (req.url === '/favicon.ico') {
      handleFavicon(req, res);
      return;
    }

    handleNotFound(req, res);
  };
}