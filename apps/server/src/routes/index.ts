/**
 * HTTP route handlers for the game server
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHealthStatus } from '../health.js';
import type { PresenceStore } from '../PresenceStore.js';
import type { DistributedChallengeStore } from '../DistributedChallengeStore.js';
import type { ChallengeService } from '../ChallengeService.js';
import type { Database, MarketPositionRecord } from '../Database.js';
import { WORLD_SECTION_SPAWNS } from '../WorldSim.js';
import type { AdminCommand } from '../DistributedBus.js';
import { handleMetricsEndpoint, handleMetricsJsonEndpoint } from '../metrics.js';
import type { MarketService } from '../markets/MarketService.js';
import type { SnapshotStation } from '@arena/shared';

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
  /** Lazy getter for station list — set after stationRouter is initialized */
  getStations?: () => SnapshotStation[];
  handleStationInteractWithReply?: (
    playerId: string,
    payload: {
      stationId: string;
      action: string;
      wager?: number;
      pick?: string;
      side?: 'yes' | 'no';
      marketId?: string;
      playerSeed?: string;
      quickPlay?: boolean;
    },
    meta: { walletId?: string | null; displayName?: string | null },
    reply: (message: object) => void
  ) => Promise<boolean>;
};

/**
 * Set CORS headers on response
 * SECURITY: Uses explicit allowed origins list, never '*' with credentials
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const allowedOrigins = getAllowedCorsOrigins();
  const origin = req.headers.origin;

  // Check if origin is in allowed list
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
  } else if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
    // Development fallback only
    res.setHeader('access-control-allow-origin', '*');
  }

  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-internal-token');
}

/**
 * Get allowed CORS origins from environment
 */
function getAllowedCorsOrigins(): string[] {
  const originsEnv = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!originsEnv) {
    // Default to localhost for development
    if (process.env.NODE_ENV !== 'production') {
      return ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:4100'];
    }
    return [];
  }
  return originsEnv.split(',').map(o => o.trim()).filter(Boolean);
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
    return false;
  }
  const header = req.headers['x-internal-token'];
  const got = Array.isArray(header) ? header[0] : header;
  return got === token;
}

/**
 * Handle health check endpoint
 */
function handleHealth(req: IncomingMessage, res: ServerResponse): void {
  void req;
  const payload = createHealthStatus();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Handle presence endpoint
 */
async function handlePresence(
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
async function handleChallengesRecent(
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
function handleFavicon(req: IncomingMessage, res: ServerResponse): void {
  void req;
  res.statusCode = 204;
  res.end();
}

/** Map station kind to a game-type string for the quick-play surface */
const PLAYABLE_KIND_TO_GAME: Record<string, string> = {
  dealer_rps: 'rps',
  dealer_coinflip: 'coinflip',
  dealer_dice_duel: 'dice_duel',
  dealer_blackjack: 'blackjack',
  dealer_prediction: 'prediction',
};

/**
 * Handle GET /stations/playable
 * Returns dealer stations with game type, position, and availability.
 */
function handleStationsPlayable(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): void {
  void req;
  const all = ctx.getStations?.() ?? [];
  const playable = all
    .filter(s => s.kind in PLAYABLE_KIND_TO_GAME)
    .map(s => ({
      id: s.id,
      displayName: s.displayName,
      gameType: PLAYABLE_KIND_TO_GAME[s.kind],
      position: { x: s.x, z: s.z },
      available: true
    }));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, stations: playable, count: playable.length }));
}

async function handleStationsInteract(
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
  if (typeof ctx.handleStationInteractWithReply !== 'function') {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'stations_interact_unavailable' }));
    return;
  }

  const body = await readJsonBody<{
    playerId?: string;
    walletId?: string | null;
    displayName?: string | null;
    payload?: {
      stationId?: string;
      action?: string;
      wager?: number;
      pick?: string;
      side?: 'yes' | 'no';
      marketId?: string;
      playerSeed?: string;
      quickPlay?: boolean;
    };
  }>(req);
  const playerId = String(body?.playerId ?? '').trim();
  const stationId = String(body?.payload?.stationId ?? '').trim();
  const action = String(body?.payload?.action ?? '').trim();
  if (!playerId || !stationId || !action) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: 'player_station_action_required' }));
    return;
  }

  let message: object | null = null;
  const handled = await ctx.handleStationInteractWithReply(
    playerId,
    {
      stationId,
      action,
      wager: Number(body?.payload?.wager ?? 0),
      pick: body?.payload?.pick ? String(body.payload.pick) : undefined,
      side: body?.payload?.side,
      marketId: body?.payload?.marketId ? String(body.payload.marketId) : undefined,
      playerSeed: body?.payload?.playerSeed ? String(body.payload.playerSeed) : undefined,
      quickPlay: body?.payload?.quickPlay === true
    },
    {
      walletId: body?.walletId ? String(body.walletId) : null,
      displayName: body?.displayName ? String(body.displayName) : null
    },
    (nextMessage) => {
      message = nextMessage;
    }
  );

  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: handled, message }));
}

/**
 * Handle 404 Not Found
 */
function handleNotFound(req: IncomingMessage, res: ServerResponse): void {
  void req;
  res.statusCode = 404;
  res.end('Not Found');
}

async function handleAdminTeleport(
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

  if (pathname === '/admin/markets/player-view' && req.method === 'GET') {
    const markets = await ctx.marketService.listActiveMarketsForPlayer();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, markets, count: markets.length }));
    return;
  }

  if (pathname === '/admin/markets/quote' && req.method === 'POST') {
    const body = await readJsonBody<{ marketId?: string; side?: string; stake?: number }>(req);
    const marketId = String(body?.marketId || '').trim();
    const side = String(body?.side || 'yes') === 'no' ? 'no' as const : 'yes' as const;
    const stake = Math.max(1, Math.min(10000, Number(body?.stake || 10)));
    if (!marketId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, reason: 'market_id_required' }));
      return;
    }
    const payload = await ctx.marketService.quote({ marketId, side, stake });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === '/admin/markets/refresh' && req.method === 'POST') {
    await ctx.marketService.refreshMarketOutcomes();
    const state = await ctx.marketService.getAdminState();
    const chainlinkMarkets = state.markets.filter((m) => m.oracleSource === 'chainlink_btc_usd');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, chainlinkMarkets: chainlinkMarkets.length, markets: chainlinkMarkets }));
    return;
  }

  if (pathname === '/admin/markets/reconcile' && req.method === 'GET') {
    const includeLegacy = String(parsed.searchParams.get('includeLegacy') || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(400, Number(parsed.searchParams.get('limit') || 120)));
    const rows = await ctx.marketService.listSettlementIntegrity({ includeLegacy, limit });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, includeLegacy, rows, count: rows.length }));
    return;
  }

  if (pathname === '/admin/markets/reconcile/repair' && req.method === 'POST') {
    const body = await readJsonBody<{
      positionId?: string;
      marketId?: string;
      escrowBetId?: string;
      action?: 'void_refund' | 'db_close_legacy' | 'sync_onchain_final';
    }>(req);
    const positionId = String(body?.positionId || '').trim();
    const action = body?.action;
    if (!positionId || !action) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, reason: 'position_id_and_action_required' }));
      return;
    }
    const payload = await ctx.marketService.repairSettlementPosition({
      positionId,
      marketId: String(body?.marketId || '').trim() || undefined,
      escrowBetId: String(body?.escrowBetId || '').trim() || undefined,
      action
    });
    res.statusCode = payload.ok ? 200 : 400;
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
    setCorsHeaders(req, res);
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

    // Public arena metrics endpoint (games played, unique players, USDC volume, agent win rate)
    if (req.url?.startsWith('/api/arena-metrics')) {
      const windowHours = Math.max(1, Math.min(720, Number(parsed.searchParams.get('windowHours') ?? 24)));
      const metricsData = await ctx.database.getArenaMetrics(windowHours);
      res.setHeader('content-type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.end(JSON.stringify({ ok: true, ...metricsData }));
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
      const walletId = String(parsed.searchParams.get('walletId') || '').trim();
      const limit = Math.max(1, Math.min(300, Number(parsed.searchParams.get('limit') ?? 60)));
      if (!playerId && !walletId) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'player_or_wallet_required' }));
        return;
      }
      let recent: Array<Record<string, unknown>> = [];
      const candidatePlayerIds = new Set<string>();
      const pushPlayerIdCandidate = (raw: string) => {
        const normalized = String(raw || '').trim();
        if (!normalized) return;
        candidatePlayerIds.add(normalized);
        if (normalized.startsWith('u_')) {
          candidatePlayerIds.add(normalized.slice(2));
        } else {
          candidatePlayerIds.add(`u_${normalized}`);
        }
      };
      if (playerId) {
        pushPlayerIdCandidate(playerId);
      } else if (walletId) {
        const presence = await ctx.presenceStore.list().catch(() => []);
        for (const entry of presence) {
          if (String(entry?.walletId || '').trim() === walletId && String(entry?.playerId || '').trim()) {
            pushPlayerIdCandidate(String(entry.playerId));
          }
        }
        if (typeof (ctx.database as unknown as { listWalletMarketPositions?: unknown }).listWalletMarketPositions === 'function') {
          const positions = await (ctx.database as unknown as {
            listWalletMarketPositions: (walletId: string, limit?: number) => Promise<Array<{ playerId?: string }>>;
          }).listWalletMarketPositions(walletId, limit).catch(() => []);
          for (const position of positions) {
            const pid = String(position?.playerId || '').trim();
            if (pid) pushPlayerIdCandidate(pid);
          }
        }
      }
      const merged: Array<Record<string, unknown>> = [];
      for (const pid of candidatePlayerIds) {
        const events = await ctx.database.getEscrowEventsForPlayer({ playerId: pid, limit }) as unknown as Array<Record<string, unknown>>;
        merged.push(...events);
      }
      const deduped = new Map<string, Record<string, unknown>>();
      for (const event of merged) {
        const txHash = String(event.txHash || '').trim().toLowerCase();
        const phase = String(event.phase || '').trim();
        if (!txHash || !phase) continue;
        const key = `tx:${txHash}:${phase}`;
        if (!deduped.has(key)) deduped.set(key, event);
      }
      recent = [...deduped.values()]
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .slice(0, limit);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, recent }));
      return;
    }

    if (req.url?.startsWith('/markets/player/positions')) {
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
      const playerId = String(parsed.searchParams.get('playerId') || '').trim();
      const walletId = String(parsed.searchParams.get('walletId') || '').trim();
      const limit = Math.max(1, Math.min(300, Number(parsed.searchParams.get('limit') ?? 60)));
      if (!playerId && !walletId) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'player_or_wallet_required' }));
        return;
      }
      try {
        const positionsPromise: Promise<MarketPositionRecord[]> = playerId
          ? (async () => {
              const candidateIds = playerId.startsWith('u_')
                ? [playerId, playerId.slice(2)]
                : [playerId, `u_${playerId}`];
              const merged: MarketPositionRecord[] = [];
              for (const pid of candidateIds) {
                const next = await ctx.marketService!.listPlayerPositions(pid).catch(() => []);
                merged.push(...next);
              }
              const deduped = new Map<string, MarketPositionRecord>();
              for (const row of merged) {
                const id = String(row?.id || '').trim();
                if (id && !deduped.has(id)) {
                  deduped.set(id, row);
                }
              }
              return [...deduped.values()];
            })()
          : Promise.resolve(
              typeof (ctx.database as unknown as { listWalletMarketPositions?: unknown }).listWalletMarketPositions === 'function'
                ? (ctx.database as unknown as { listWalletMarketPositions: (walletId: string, limit?: number) => Promise<MarketPositionRecord[]> })
                  .listWalletMarketPositions(walletId, limit)
                : []
            );
        const [positions, admin] = await Promise.all([positionsPromise, ctx.marketService.getAdminState()]);
        const marketById = new Map((admin.markets || []).map((market) => [market.id, market]));
        const recent = positions
          .sort((a, b) => {
            const aAt = Number(a.settledAt || a.createdAt || 0);
            const bAt = Number(b.settledAt || b.createdAt || 0);
            return bAt - aAt;
          })
          .slice(0, limit)
          .map((position) => {
            const market = marketById.get(position.marketId);
            return {
              ...position,
              marketQuestion: market?.question || position.marketId,
              marketSlug: market?.slug || null,
              marketOracleSource: market?.oracleSource || null,
              marketRoundType: market?.roundType || null,
              marketCurrentSpotPrice: market?.currentSpotPrice ?? null,
              marketLockPrice: market?.lockPrice ?? null,
              marketFinalPrice: market?.finalPrice ?? null
            };
          });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, recent }));
      } catch {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, reason: 'market_positions_unavailable' }));
      }
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

    if (req.url === '/stations/playable') {
      handleStationsPlayable(req, res, ctx);
      return;
    }

    if (req.url === '/stations/interact') {
      await handleStationsInteract(req, res, ctx);
      return;
    }

    if (req.url === '/favicon.ico') {
      handleFavicon(req, res);
      return;
    }

    handleNotFound(req, res);
  };
}
