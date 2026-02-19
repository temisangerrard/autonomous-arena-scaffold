/**
 * HTTP route handlers for the game server
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHealthStatus } from '../health.js';
import type { PresenceStore } from '../PresenceStore.js';
import type { DistributedChallengeStore } from '../DistributedChallengeStore.js';
import type { ChallengeService } from '../ChallengeService.js';
import type { Database } from '../Database.js';
import { WORLD_SECTION_SPAWNS } from '../WorldSim.js';
import type { AdminCommand } from '../DistributedBus.js';
import { handleMetricsEndpoint, handleMetricsJsonEndpoint } from '../metrics.js';
import type { MarketService } from '../markets/MarketService.js';

export type RouteContext = {
  serverInstanceId: string;
  presenceStore: PresenceStore;
  distributedChallengeStore: DistributedChallengeStore;
  challengeService: ChallengeService;
  database: Database;
  internalToken: string;
  publishAdminCommand: (serverId: string, command: AdminCommand) => Promise<void>;
  teleportLocal: (playerId: string, x: number, z: number) => boolean;
  marketService?: MarketService | null;
};

/**
 * Set CORS headers on response
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-internal-token');
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}

function isInternalAuthorized(req: IncomingMessage, token: string): boolean {
  if (!token) {
    return true;
  }
  const header = req.headers['x-internal-token'];
  const got = Array.isArray(header) ? header[0] : header;
  return got === token;
}

/**
 * Handle health check endpoint
 */
export function handleHealth(req: IncomingMessage, res: ServerResponse): void {
  void req;
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
  void req;
  res.statusCode = 204;
  res.end();
}

/**
 * Handle 404 Not Found
 */
export function handleNotFound(req: IncomingMessage, res: ServerResponse): void {
  void req;
  res.statusCode = 404;
  res.end('Not Found');
}

export async function handleAdminTeleport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  if (!isInternalAuthorized(req, ctx.internalToken)) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'unauthorized_internal' }));
    return;
  }

  const body = await readJsonBody<{
    playerId?: string;
    x?: number;
    z?: number;
    section?: number;
  }>(req);
  const playerId = String(body?.playerId ?? '').trim();
  if (!playerId) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'player_required' }));
    return;
  }

  let x: number | null = null;
  let z: number | null = null;
  if (Number.isFinite(Number(body?.section))) {
    const idx = Math.max(0, Math.min(7, Math.floor(Number(body?.section))));
    const spawn = WORLD_SECTION_SPAWNS[idx];
    if (spawn) {
      x = spawn.x;
      z = spawn.z;
    }
  } else if (Number.isFinite(Number(body?.x)) && Number.isFinite(Number(body?.z))) {
    x = Number(body?.x);
    z = Number(body?.z);
  }

  if (x == null || z == null) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'coords_required' }));
    return;
  }

  const presence = await ctx.presenceStore.get(playerId);
  if (!presence) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'player_not_found' }));
    return;
  }

  if (presence.serverId && presence.serverId !== ctx.serverInstanceId) {
    await ctx.publishAdminCommand(presence.serverId, { type: 'admin_teleport', playerId, x, z });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, forwarded: true, serverId: presence.serverId, playerId, x, z }));
    return;
  }

  const ok = ctx.teleportLocal(playerId, x, z);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok, forwarded: false, serverId: ctx.serverInstanceId, playerId, x, z }));
}

async function handleAdminMarkets(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  parsed: URL
): Promise<void> {
  if (!isInternalAuthorized(req, ctx.internalToken)) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'unauthorized_internal' }));
    return;
  }
  if (!ctx.marketService) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'prediction_service_unavailable' }));
    return;
  }
  const pathname = parsed.pathname;

  if (pathname === '/admin/markets' && req.method === 'GET') {
    const payload = await ctx.marketService.getAdminState();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === '/admin/markets/sync' && req.method === 'POST') {
    const body = await readJsonBody<{ limit?: number }>(req);
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 60)));
    const payload = await ctx.marketService.syncFromOracle(limit);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  if ((pathname === '/admin/markets/activate' || pathname === '/admin/markets/deactivate') && req.method === 'POST') {
    const body = await readJsonBody<{
      marketId?: string;
      maxWager?: number;
      houseSpreadBps?: number;
      updatedBy?: string;
    }>(req);
    const marketId = String(body?.marketId || '').trim();
    if (!marketId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, reason: 'market_id_required' }));
      return;
    }
    const active = pathname.endsWith('/activate');
    const payload = await ctx.marketService.activateMarket({
      marketId,
      active,
      maxWager: body?.maxWager,
      houseSpreadBps: body?.houseSpreadBps,
      updatedBy: body?.updatedBy || 'admin'
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === '/admin/markets/config' && req.method === 'POST') {
    const body = await readJsonBody<{
      marketId?: string;
      active?: boolean;
      maxWager?: number;
      houseSpreadBps?: number;
      updatedBy?: string;
    }>(req);
    const marketId = String(body?.marketId || '').trim();
    if (!marketId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, reason: 'market_id_required' }));
      return;
    }
    const payload = await ctx.marketService.activateMarket({
      marketId,
      active: Boolean(body?.active),
      maxWager: body?.maxWager,
      houseSpreadBps: body?.houseSpreadBps,
      updatedBy: body?.updatedBy || 'admin'
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: false, reason: 'not_found' }));
}

/**
 * Main HTTP request router
 */
export function createRouter(ctx: RouteContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCorsHeaders(res);
    const parsed = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.url === '/health') {
      handleHealth(req, res);
      return;
    }

    // Prometheus metrics endpoint
    if (req.url === '/metrics') {
      handleMetricsEndpoint(req, res);
      return;
    }

    // JSON metrics endpoint
    if (req.url === '/metrics.json') {
      handleMetricsJsonEndpoint(req, res);
      return;
    }

    // Database migration status
    if (req.url === '/migrations/status') {
      if (!isInternalAuthorized(req, ctx.internalToken)) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'unauthorized_internal' }));
        return;
      }
      const status = await ctx.database.getMigrationStatus();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...status }));
      return;
    }

    // Leaderboard endpoint
    if (req.url?.startsWith('/leaderboard')) {
      const limit = Math.max(1, Math.min(100, Number(parsed.searchParams.get('limit') ?? 10)));
      const sortBy = parsed.searchParams.get('sortBy') === 'totalWon' ? 'totalWon' : 'wins';
      const leaderboard = await ctx.database.getLeaderboard({ limit, sortBy });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, leaderboard }));
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

    if (req.url?.startsWith('/escrow/events/recent')) {
      if (!isInternalAuthorized(req, ctx.internalToken)) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'unauthorized_internal' }));
        return;
      }
      const playerId = String(parsed.searchParams.get('playerId') || '').trim();
      const limit = Math.max(1, Math.min(300, Number(parsed.searchParams.get('limit') ?? 60)));
      if (!playerId) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'player_id_required' }));
        return;
      }
      const recent = await ctx.database.getEscrowEventsForPlayer({ playerId, limit });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, recent }));
      return;
    }

    if (req.url?.startsWith('/admin/teleport')) {
      await handleAdminTeleport(req, res, ctx);
      return;
    }

    if (req.url?.startsWith('/admin/markets')) {
      await handleAdminMarkets(req, res, ctx, parsed);
      return;
    }

    if (req.url === '/favicon.ico') {
      handleFavicon(req, res);
      return;
    }

    handleNotFound(req, res);
  };
}
