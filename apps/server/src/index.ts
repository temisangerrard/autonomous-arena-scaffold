import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ChallengeService, type ChallengeEvent } from './ChallengeService.js';
import { config, resolveInternalServiceToken } from './config.js';
import { Database } from './Database.js';
import { DistributedBus, type AdminCommand, type ChallengeCommand } from './DistributedBus.js';
import { DistributedChallengeStore } from './DistributedChallengeStore.js';
import { EscrowAdapter } from './EscrowAdapter.js';
import { log } from './logger.js';
import { PresenceStore } from './PresenceStore.js';
import { WORLD_SECTION_SPAWNS, WorldSim } from './WorldSim.js';
import { createRouter } from './routes/index.js';
import { parseClientMessage } from './websocket/messages.js';
import type { GameMove } from '@arena/shared';
import {
  validateSession,
  verifyWsAuth,
  validateHumanAuthClaims,
  validateAgentAuthClaims,
  type PlayerRole,
  type ValidatedIdentity
} from './websocket/auth.js';
import {
  arePlayersNear,
  emitProximityEvents,
  clearPlayerProximityPairs
} from './game/proximity.js';
import { computeCoinflipFromSeeds, sha256Hex } from './coinflip.js';
import { createStationRouter } from './game/stations/router.js';
import { PolymarketFeed } from './markets/PolymarketFeed.js';
import { MarketService } from './markets/MarketService.js';
import { SettlementWorker } from './markets/SettlementWorker.js';

type PlayerMeta = {
  role: PlayerRole;
  displayName: string;
  walletId: string | null;
};

// Use centralized config
const serverInstanceId = config.serverInstanceId;
const database = new Database();
const presenceStore = new PresenceStore(serverInstanceId, config.presenceTtlSeconds);
const distributedChallengeStore = new DistributedChallengeStore(serverInstanceId);
const worldSim = new WorldSim();
const challengeIdPrefix = `${serverInstanceId}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const challengeService = new ChallengeService(
  () => Date.now(),
  () => Math.random(),
  config.challengePendingTimeoutMs,
  45_000,
  challengeIdPrefix
);
const internalServiceToken = resolveInternalServiceToken();
const escrowAdapter = new EscrowAdapter(
  config.agentRuntimeUrl,
  config.escrowFeeBps,
  {
    mode: config.escrowExecutionMode,
    rpcUrl: config.chainRpcUrl,
    resolverPrivateKey: config.escrowResolverPrivateKey,
    escrowContractAddress: config.escrowContractAddress,
    tokenDecimals: config.escrowTokenDecimals,
    internalToken: internalServiceToken
  }
);
const marketFeed = new PolymarketFeed();
const marketService = new MarketService(
  database,
  escrowAdapter,
  marketFeed,
  () => houseWalletId || walletIdFor('system_house')
);
const settlementWorker = new SettlementWorker(marketService);

const stationProximityThreshold = Math.max(3, Math.min(25, Number(process.env.STATION_PROXIMITY_THRESHOLD ?? 8)));

function newSeedHex(bytes = 18): string {
  return randomBytes(Math.max(8, Math.min(64, bytes))).toString('hex');
}

const challengeEscrowTxById = new Map<string, { lock?: string; resolve?: string; refund?: string }>();
const challengeEscrowFailureById = new Map<string, {
  reason: string;
  reasonCode?: string;
  reasonText?: string;
  preflight?: { playerOk: boolean; houseOk: boolean };
}>();
type ChallengeApprovalMeta = {
  approvalMode: 'auto' | 'manual';
  approvalStatus: 'ready' | 'required' | 'failed';
  approvalSource?: 'player_wallet' | 'super_agent';
};
const challengeApprovalById = new Map<string, ChallengeApprovalMeta>();
type PendingDealerRound = {
  playerId: string;
  stationId: string;
  wager: number;
  houseSeed: string;
  commitHash: string;
  method: string;
  createdAt: number;
  preflightApproved: boolean;
};
const pendingDealerRounds = new Map<string, PendingDealerRound>();

let houseWalletId: string | null = null;
async function refreshHouseWalletId(): Promise<void> {
  try {
    const response = await fetch(`${config.agentRuntimeUrl}/house/status`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json().catch(() => null)) as { house?: { wallet?: { id?: unknown } } } | null;
    const id = String(payload?.house?.wallet?.id ?? '').trim();
    if (id) {
      houseWalletId = id;
    }
  } catch {
    // ignore transient failures
  }
}
void refreshHouseWalletId();
setInterval(() => void refreshHouseWalletId(), 60_000);

function stationErrorFromEscrowFailure(input: {
  reason?: string;
  raw?: Record<string, unknown>;
}): {
  reason: string;
  reasonCode?: string;
  reasonText?: string;
  preflight?: { playerOk: boolean; houseOk: boolean };
} {
  const reason = String(input.reason || 'escrow_lock_failed');
  const reasonCode = typeof input.raw?.reasonCode === 'string'
    ? input.raw.reasonCode
    : undefined;
  const reasonText = typeof input.raw?.reasonText === 'string' ? input.raw.reasonText : undefined;
  const preflightRaw = input.raw?.preflight;
  const preflight = preflightRaw && typeof preflightRaw === 'object'
    ? {
        playerOk: Boolean((preflightRaw as { playerOk?: unknown }).playerOk),
        houseOk: Boolean((preflightRaw as { houseOk?: unknown }).houseOk)
      }
    : undefined;
  return {
    reason,
    reasonCode,
    reasonText,
    preflight
  };
}

const lastPlayerPos = new Map<string, { x: number; z: number }>();

// HTTP server using extracted router
const server = createServer(createRouter({
  serverInstanceId,
  presenceStore,
  distributedChallengeStore,
  challengeService,
  database,
  marketService,
  internalToken: internalServiceToken,
  publishAdminCommand: (targetServerId, command) => distributedBus.publishAdminCommand(targetServerId, command),
  teleportLocal: (playerId, x, z) => worldSim.teleportPlayer(playerId, x, z)
}));

const wss = new WebSocketServer({ noServer: true });
const sockets = new Map<string, WebSocket>();
const metaByPlayer = new Map<string, PlayerMeta>();
const activeProximityPairs = new Set<string>();
let nextClient = 1;
// Use config values
const proximityThreshold = config.proximityThreshold;
const escrowLockedChallenges = new Set<string>();
const challengeWalletsById = new Map<string, { challengerWalletId: string; opponentWalletId: string }>();
const agentToHumanChallengeCooldownMs = config.agentToHumanChallengeCooldownMs;
const recentAgentToHumanChallengeAt = new Map<string, number>();
let lastPresenceSyncAt = 0;
let lastPresenceRefreshAt = 0;
const challengePendingTimeoutMs = config.challengePendingTimeoutMs;
const challengeOrphanGraceMs = config.challengeOrphanGraceMs;
const wsAuthSecret = config.wsAuthSecret;
const escrowApprovalConfig = config.escrowApproval;
const serverEscrowApprovalMode = escrowApprovalConfig.resolved.mode;
// Product choice: keep in-world movement reserved for human players.
// Agents (NPCs / offline bots) can still participate in challenges, but do not roam unless explicitly enabled.
const agentLocomotionEnabled = String(process.env.AGENT_LOCOMOTION_ENABLED ?? '').trim().toLowerCase() === 'true';
const presenceByPlayerId = new Map<string, {
  playerId: string;
  role: PlayerRole;
  displayName: string;
  walletId: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}>();
let cachedPresence: Array<{
  playerId: string;
  role: PlayerRole;
  displayName: string;
  walletId: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}> = [];
const distributedBus = new DistributedBus(
  serverInstanceId,
  (message) => {
    const ws = sockets.get(message.playerId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return;
    }
    ws.send(JSON.stringify(message.payload));
  },
  (command) => {
    void handleDistributedCommand(command);
  },
  (command) => {
    void handleAdminCommand(command);
  }
);

// Note: resolveInternalServiceToken is imported from config.ts
// Note: parseClientMessage is imported from websocket/messages.ts
// Note: makePairKey, arePlayersNear, emitProximityEvents are imported from game/proximity.ts
// Note: validateSession is imported from websocket/auth.ts

function sendTo(playerId: string, payload: object): void {
  const ws = sockets.get(playerId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function sendToDistributed(playerId: string, payload: object): void {
  const ws = sockets.get(playerId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
    return;
  }
  void distributedBus.publishToPlayer(playerId, payload);
}

function displayNameFor(playerId: string): string {
  return metaByPlayer.get(playerId)?.displayName ?? presenceByPlayerId.get(playerId)?.displayName ?? playerId;
}

function walletIdFor(playerId: string): string | null {
  if (playerId === 'system_house') {
    return houseWalletId;
  }
  return metaByPlayer.get(playerId)?.walletId ?? presenceByPlayerId.get(playerId)?.walletId ?? null;
}

function isStaticNpcId(playerId: string): boolean {
  return typeof playerId === 'string' && playerId.startsWith('agent_bg_');
}

function autoNpcMove(challengeId: string, gameType: 'rps' | 'coinflip' | 'dice_duel'): GameMove {
  const digest = sha256Hex(challengeId);
  const seed = Number.parseInt(digest.slice(0, 2), 16);
  if (gameType === 'coinflip') {
    return (seed & 1) === 1 ? 'heads' : 'tails';
  }
  if (gameType === 'dice_duel') {
    return (['d1', 'd2', 'd3', 'd4', 'd5', 'd6'][seed % 6] ?? 'd1') as GameMove;
  }
  const rps: Array<'rock' | 'paper' | 'scissors'> = ['rock', 'paper', 'scissors'];
  return rps[seed % rps.length] ?? 'rock';
}

function broadcast(payload: object): void {
  const message = JSON.stringify(payload);
  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

function dispatchChallengeEvent(event: ChallengeEvent): void {
  const challenge = event.challenge;
  const reason = String(event.reason || '').toLowerCase();
  const isApprovalFailure = reason.includes('allowance')
    || reason.includes('approve_failed')
    || reason.includes('wallet_prepare_failed')
    || reason.includes('wallet_policy_disabled');
  const existingApproval = challenge?.id ? challengeApprovalById.get(challenge.id) : null;
  const approvalMeta: ChallengeApprovalMeta | null = existingApproval
    ?? (challenge && Number(challenge.wager || 0) > 0
      ? {
          approvalMode: serverEscrowApprovalMode,
          approvalSource: serverEscrowApprovalMode === 'auto' ? 'super_agent' : 'player_wallet',
          approvalStatus: serverEscrowApprovalMode === 'auto' ? 'ready' : 'required'
        }
      : null);
  const finalApprovalMeta = isApprovalFailure
    ? {
        approvalMode: approvalMeta?.approvalMode ?? serverEscrowApprovalMode,
        approvalSource: approvalMeta?.approvalSource ?? (serverEscrowApprovalMode === 'auto' ? 'super_agent' : 'player_wallet'),
        approvalStatus: 'failed' as const
      }
    : approvalMeta;
  if (event.to) {
    for (const playerId of event.to) {
      sendToDistributed(playerId, {
        type: 'challenge',
        event: event.event,
        reason: event.reason,
        challenge: event.challenge,
        approvalMode: finalApprovalMeta?.approvalMode,
        approvalSource: finalApprovalMeta?.approvalSource,
        approvalStatus: finalApprovalMeta?.approvalStatus
      });
    }
  }

  broadcast({
    type: 'challenge_feed',
    event: event.event,
    reason: event.reason,
    challenge: event.challenge,
    approvalMode: finalApprovalMeta?.approvalMode,
    approvalSource: finalApprovalMeta?.approvalSource,
    approvalStatus: finalApprovalMeta?.approvalStatus
  });

  if (challenge?.id && (event.event === 'resolved' || event.event === 'declined' || event.event === 'expired')) {
    challengeApprovalById.delete(challenge.id);
  }
}

function broadcastEscrowEvent(payload: {
  phase: 'lock' | 'resolve' | 'refund';
  challengeId: string;
  ok: boolean;
  reason?: string;
  txHash?: string;
  fee?: number;
  payout?: number;
}): void {
  const escrowTx = challengeEscrowTxById.get(payload.challengeId) ?? {};
  if (payload.txHash) {
    if (payload.phase === 'lock') escrowTx.lock = payload.txHash;
    if (payload.phase === 'resolve') escrowTx.resolve = payload.txHash;
    if (payload.phase === 'refund') escrowTx.refund = payload.txHash;
    challengeEscrowTxById.set(payload.challengeId, escrowTx);
  }
  // Persist escrow event to database before broadcasting
  void database.insertEscrowEvent({
    challengeId: payload.challengeId,
    phase: payload.phase,
    ok: payload.ok,
    reason: payload.reason,
    txHash: payload.txHash,
    fee: payload.fee,
    payout: payload.payout
  });

  broadcast({
    type: 'challenge_escrow',
    ...payload
  });
}

function withActorRecipient(event: ChallengeEvent, actorId: string): ChallengeEvent {
  if (event.to && event.to.length > 0) {
    return event;
  }
  return {
    ...event,
    to: [actorId]
  };
}

async function dispatchChallengeEventWithEscrow(event: ChallengeEvent): Promise<void> {
  await distributedChallengeStore.appendHistory({
    event: event.event,
    reason: event.reason ?? null,
    challenge: event.challenge ?? null
  });

  if (event.challenge) {
    const challenge = event.challenge;
    const wager = Math.max(0, challenge.wager);
    await distributedChallengeStore.updateStatus(challenge.id, event.event, JSON.stringify(challenge));
    if (event.event === 'created') {
      challengeApprovalById.set(challenge.id, {
        approvalMode: serverEscrowApprovalMode,
        approvalSource: serverEscrowApprovalMode === 'auto' ? 'super_agent' : 'player_wallet',
        approvalStatus: wager > 0
          ? (serverEscrowApprovalMode === 'auto' ? 'ready' : 'required')
          : 'ready'
      });
    }

    // Persist challenge state to database
    if (event.event === 'created') {
      void database.insertChallenge({
        id: challenge.id,
        challengerId: challenge.challengerId,
        opponentId: challenge.opponentId,
        gameType: challenge.gameType,
        wager: challenge.wager,
        status: event.event,
        challengeJson: challenge
      });
    } else {
      void database.updateChallengeStatus({
        id: challenge.id,
        status: event.event,
        winnerId: challenge.winnerId,
        challengerMove: challenge.challengerMove,
        opponentMove: challenge.opponentMove,
        coinflipResult: challenge.coinflipResult,
        challengeJson: challenge
      });
    }

    if (event.event === 'accepted' && wager > 0) {
      const challengerWalletId = walletIdFor(challenge.challengerId);
      const opponentWalletId = walletIdFor(challenge.opponentId);
      if (!challengerWalletId || !opponentWalletId) {
        const aborted = challengeService.abortChallenge(challenge.id, 'declined', 'wallet_required');
        dispatchChallengeEvent(aborted);
        return;
      }

      const locked = await escrowAdapter.lockStake({
        challengeId: challenge.id,
        challengerWalletId,
        opponentWalletId,
        amount: wager
      });
      if (!locked.ok) {
        challengeEscrowFailureById.set(challenge.id, stationErrorFromEscrowFailure({
          reason: locked.reason,
          raw: locked.raw
        }));
        broadcastEscrowEvent({
          phase: 'lock',
          challengeId: challenge.id,
          ok: false,
          reason: locked.reason
        });
        if (locked.reason?.includes('wallet_policy_disabled')) {
          dispatchChallengeEvent(event);
          return;
        }
        const aborted = challengeService.abortChallenge(challenge.id, 'declined', locked.reason ?? 'escrow_lock_failed');
        dispatchChallengeEvent(aborted);
        return;
      }
      escrowLockedChallenges.add(challenge.id);
      challengeWalletsById.set(challenge.id, { challengerWalletId, opponentWalletId });
      challengeEscrowFailureById.delete(challenge.id);
      broadcastEscrowEvent({
        phase: 'lock',
        challengeId: challenge.id,
        ok: true,
        txHash: locked.txHash
      });
    }

    if (event.event === 'resolved' && wager > 0) {
      if (!escrowLockedChallenges.has(challenge.id)) {
        broadcastEscrowEvent({
          phase: 'resolve',
          challengeId: challenge.id,
          ok: false,
          reason: 'escrow_not_locked'
        });
        dispatchChallengeEvent(event);
        return;
      }
      const participants = challengeWalletsById.get(challenge.id);
      const winnerWalletId = !challenge.winnerId
        ? null
        : challenge.winnerId === challenge.challengerId
          ? (participants?.challengerWalletId ?? walletIdFor(challenge.winnerId))
          : challenge.winnerId === challenge.opponentId
            ? (participants?.opponentWalletId ?? walletIdFor(challenge.winnerId))
            : walletIdFor(challenge.winnerId);
      const settled = await escrowAdapter.resolve({
        challengeId: challenge.id,
        winnerWalletId
      });
      if (!settled.ok) {
        broadcastEscrowEvent({
          phase: 'resolve',
          challengeId: challenge.id,
          ok: false,
          reason: settled.reason
        });
        const refunded = await escrowAdapter.refund(challenge.id);
        broadcastEscrowEvent({
          phase: 'refund',
          challengeId: challenge.id,
          ok: refunded.ok,
          reason: refunded.reason,
          txHash: refunded.txHash
        });
        escrowLockedChallenges.delete(challenge.id);
        challengeWalletsById.delete(challenge.id);
      } else {
        broadcastEscrowEvent({
          phase: 'resolve',
          challengeId: challenge.id,
          ok: true,
          txHash: settled.txHash,
          fee: settled.fee,
          payout: settled.payout
        });
        escrowLockedChallenges.delete(challenge.id);
        challengeWalletsById.delete(challenge.id);
      }
    }

    if ((event.event === 'declined' || event.event === 'expired') && wager > 0) {
      if (!escrowLockedChallenges.has(challenge.id)) {
        dispatchChallengeEvent(event);
        return;
      }
      const refunded = await escrowAdapter.refund(challenge.id);
      broadcastEscrowEvent({
        phase: 'refund',
        challengeId: challenge.id,
        ok: refunded.ok,
        reason: refunded.reason,
        txHash: refunded.txHash
      });
      escrowLockedChallenges.delete(challenge.id);
      challengeWalletsById.delete(challenge.id);
    }

    if (event.event === 'resolved' || event.event === 'declined' || event.event === 'expired') {
      challengeWalletsById.delete(challenge.id);
      challengeApprovalById.delete(challenge.id);
      await distributedChallengeStore.releasePlayers(
        challenge.id,
        [challenge.challengerId, challenge.opponentId].filter((id) => id !== 'system_house')
      );
      await distributedChallengeStore.clear(challenge.id);
    }
  }

  dispatchChallengeEvent(event);
}

async function registerCreatedChallenge(
  event: ChallengeEvent,
  actorId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(event.event === 'created' && event.challenge)) {
    return { ok: true };
  }
  const isHouseMatch =
    event.challenge.challengerId === 'system_house'
    || event.challenge.opponentId === 'system_house';
  const lockParticipants = isHouseMatch
    ? []
    : [event.challenge.challengerId, event.challenge.opponentId].filter((id) => id !== 'system_house');

  if (lockParticipants.length > 0) {
    const lockResult = await distributedChallengeStore.tryLockPlayers(
      event.challenge.id,
      lockParticipants,
      Math.max(6_000, challengePendingTimeoutMs)
    );
    if (!lockResult.ok) {
      const aborted = challengeService.abortChallenge(event.challenge.id, 'declined', lockResult.reason ?? 'player_busy');
      await dispatchChallengeEventWithEscrow(withActorRecipient(aborted, actorId));
      return { ok: false, reason: lockResult.reason ?? 'player_busy' };
    }
  }
  await distributedChallengeStore.registerChallenge({
    challengeId: event.challenge.id,
    challengerId: event.challenge.challengerId,
    opponentId: event.challenge.opponentId,
    status: event.event,
    challengeJson: JSON.stringify(event.challenge)
  });
  return { ok: true };
}

const stationRouter = createStationRouter({
  diceDuelEnabled: config.diceDuelEnabled,
  stationProximityThreshold,
  lastPlayerPos,
  challengeEscrowTxById,
  challengeEscrowFailureById,
  escrowLockedChallenges,
  challengeService,
  escrowAdapter,
  walletIdFor,
  getHouseWalletId: () => houseWalletId || walletIdFor('system_house'),
  sendTo,
  sendToDistributed,
  registerCreatedChallenge,
  dispatchChallengeEventWithEscrow,
  stationErrorFromEscrowFailure,
  newSeedHex,
  marketService
});
const STATIONS = config.stationPluginRouterEnabled
  ? stationRouter.stations
  : stationRouter.stations.filter((station) => station.kind === 'dealer_coinflip' || station.kind === 'cashier_bank');
const stationById = stationRouter.stationById;

// Note: emitProximityEvents is imported from game/proximity.ts
// Note: ValidatedIdentity is imported from websocket/auth.ts
// Note: validateSession is imported from websocket/auth.ts

const webAuthUrl = config.webAuthUrl;

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  // If WEB_AUTH_URL is configured, validate session before upgrade
  if (webAuthUrl) {
    const parsed = new URL(request.url ?? '/ws', 'http://localhost');
    const isAgent = parsed.searchParams.get('role') === 'agent';
    const hasWsAuth = Boolean(parsed.searchParams.get('wsAuth')?.trim());

    // Agents and wsAuth-signed humans can connect without forwarding cookie session IDs in query/header.
    if (isAgent || (wsAuthSecret && hasWsAuth)) {
      (request as unknown as Record<string, unknown>).__validatedIdentity = null;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return;
    }

    void validateSession(request.headers.cookie).then((identity) => {

      if (!identity && !isAgent) {
        log.warn({ url: request.url }, 'WebSocket upgrade rejected: no valid session');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Attach validated identity for use in connection handler
      (request as unknown as Record<string, unknown>).__validatedIdentity = identity;

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
    return;
  }

  // No auth configured — allow all connections (dev mode)
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  const parsed = new URL(request.url ?? '/ws', 'http://localhost');
  const validatedIdentity = (request as unknown as Record<string, unknown>).__validatedIdentity as ValidatedIdentity | null | undefined;

  const requestedRole = parsed.searchParams.get('role');
  const role: PlayerRole = requestedRole === 'agent' ? 'agent' : 'human';
  // Prefer validated identity data over URL params for humans
  const preferredName = (role === 'human' && validatedIdentity?.displayName)
    ? validatedIdentity.displayName
    : parsed.searchParams.get('name')?.trim();
  const walletId = (role === 'human' && validatedIdentity?.walletId)
    ? validatedIdentity.walletId
    : parsed.searchParams.get('walletId')?.trim() || null;
  const requestedClientId = parsed.searchParams.get('clientId')?.trim();
  const normalizedClientId = requestedClientId?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const requestedAgentId = parsed.searchParams.get('agentId')?.trim();

  // If a shared secret is configured, require signed ws auth to prevent unauthenticated entry points
  // (including bypassing the web server and connecting directly to /ws).
  if (wsAuthSecret) {
    const token = parsed.searchParams.get('wsAuth')?.trim() || '';
    const verified = verifyWsAuth(token, role);
    if (!verified.ok) {
      if (role === 'agent') {
        log.warn({ reason: verified.reason, requestedAgentId }, 'agent websocket auth rejected');
      }
      try {
        ws.close(4401, verified.reason);
      } catch {
        // ignore
      }
      return;
    }
    const claims = verified.claims ?? {};
    if (role === 'human') {
      const validated = validateHumanAuthClaims(claims, normalizedClientId, walletId ?? undefined);
      if (!validated.ok) {
        try {
          ws.close(4403, validated.reason ?? 'ws_auth_invalid_claims');
        } catch {
          // ignore
        }
        return;
      }
    } else {
      const validated = validateAgentAuthClaims(claims, requestedAgentId, walletId ?? undefined);
      if (!validated.ok) {
        log.warn({ reason: validated.reason, requestedAgentId }, 'agent websocket claims mismatch');
        try {
          ws.close(4403, validated.reason ?? 'ws_auth_invalid_claims');
        } catch {
          // ignore
        }
        return;
      }
    }
  }

  const preferredId =
    role === 'agent'
      ? requestedAgentId
      : normalizedClientId
        ? `u_${normalizedClientId}`
        : undefined;

  if (preferredId && sockets.has(preferredId)) {
    const existing = sockets.get(preferredId);
    try {
      existing?.close(4000, 'replaced_by_reconnect');
    } catch {
      // ignore
    }
    sockets.delete(preferredId);
    metaByPlayer.delete(preferredId);
    worldSim.removePlayer(preferredId);
  }

  let playerId = preferredId && !sockets.has(preferredId) ? preferredId : `p${nextClient}`;
  nextClient += 1;

  while (sockets.has(playerId)) {
    playerId = `${playerId}_${nextClient}`;
    nextClient += 1;
  }

  sockets.set(playerId, ws);
  metaByPlayer.set(playerId, {
    role,
    displayName: preferredName && preferredName.length > 0 ? preferredName : (role === 'agent' ? playerId : `Player ${playerId}`),
    walletId
  });

  // Allow runtime agents (NPCs/owner bots) to request deterministic section spawns.
  const spawnSectionRaw = parsed.searchParams.get('spawnSection');
  const spawnSection = spawnSectionRaw ? Number(spawnSectionRaw) : Number.NaN;
  const preferredSpawn =
    role === 'agent' && Number.isFinite(spawnSection)
      ? (() => {
          const idx = Math.max(0, Math.min(7, Math.floor(spawnSection)));
          return WORLD_SECTION_SPAWNS[idx] ?? null;
        })()
      : null;

  void presenceStore.get(playerId).then((presence) => {
    if (presence) {
      worldSim.joinPlayer(playerId, { x: presence.x, z: presence.z });
      return;
    }
    if (preferredSpawn) {
      worldSim.joinPlayer(playerId, preferredSpawn);
      return;
    }
    worldSim.joinPlayer(playerId);
  }).catch(() => {
    worldSim.joinPlayer(playerId, preferredSpawn ?? undefined);
  });

  ws.send(JSON.stringify({ type: 'welcome', playerId, role, displayName: displayNameFor(playerId), serverId: serverInstanceId }));

  ws.on('message', async (raw: RawData) => {
    try {
      const payload = parseClientMessage(raw);
      if (!payload) {
        return;
      }

    if (payload.type === 'input') {
      const role = metaByPlayer.get(playerId)?.role ?? 'human';
      if (role === 'agent' && !agentLocomotionEnabled) {
        worldSim.setInput(playerId, { moveX: 0, moveZ: 0 });
        return;
      }
      worldSim.setInput(playerId, {
        moveX: payload.moveX,
        moveZ: payload.moveZ
      });
      return;
    }

    if (payload.type === 'station_interact') {
      if (config.stationPluginRouterEnabled) {
        await stationRouter.handleStationInteract(playerId, payload);
        return;
      }
      const stationId = payload.stationId.trim();
      const station = stationById.get(stationId);
      if (!station) {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'station_not_found' }
        });
        return;
      }
      const pos = lastPlayerPos.get(playerId);
      if (!pos) {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'position_unknown' }
        });
        return;
      }
      const dist = Math.hypot(pos.x - station.x, pos.z - station.z);
      if (dist > stationProximityThreshold) {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'not_near_station' }
        });
        return;
      }
      if (station.kind !== 'dealer_coinflip') {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'invalid_station_kind' }
        });
        return;
      }

      if (payload.action === 'coinflip_house_start') {
        const wager = Math.max(0, Math.min(10_000, Number(payload.wager || 0)));
        const playerWalletId = walletIdFor(playerId);
        const currentHouseWalletId = houseWalletId || walletIdFor('system_house');
        if (wager > 0) {
          if (!playerWalletId || !currentHouseWalletId) {
            sendTo(playerId, {
              type: 'station_ui',
              stationId,
              view: {
                ok: false,
                state: 'dealer_error',
                reason: 'wallet_required',
                reasonCode: !playerWalletId ? 'PLAYER_SIGNER_UNAVAILABLE' : 'HOUSE_SIGNER_UNAVAILABLE',
                reasonText: !playerWalletId
                  ? 'Player wallet not ready for onchain escrow.'
                  : 'House wallet unavailable for onchain escrow.',
                preflight: { playerOk: Boolean(playerWalletId), houseOk: Boolean(currentHouseWalletId) }
              }
            });
            return;
          }
          const preflight = await escrowAdapter.preflightStake({
            challengerWalletId: playerWalletId,
            opponentWalletId: currentHouseWalletId,
            amount: wager
          });
          if (!preflight.ok) {
            sendTo(playerId, {
              type: 'station_ui',
              stationId,
              view: {
                ok: false,
                state: 'dealer_error',
                reason: preflight.reason || 'wallet_prepare_failed',
                reasonCode: preflight.reasonCode,
                reasonText: preflight.reasonText,
                preflight: preflight.preflight
              }
            });
            return;
          }
        }
        const houseSeed = newSeedHex(24);
        const commitHash = sha256Hex(houseSeed);
        const method = 'sha256(houseSeed|playerSeed|challengeId), LSB(firstByte)=1 -> heads';
        pendingDealerRounds.set(playerId, {
          playerId,
          stationId,
          wager,
          houseSeed,
          commitHash,
          method,
          createdAt: Date.now(),
          preflightApproved: true
        });
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: true,
            state: 'dealer_ready',
            stationId,
            wager,
            commitHash,
            method
          }
        });
        return;
      }

      if (payload.action !== 'coinflip_house_pick') {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'invalid_station_action' }
        });
        return;
      }

      const pending = pendingDealerRounds.get(playerId);
      if (!pending || pending.stationId !== stationId) {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'dealer_round_not_started' }
        });
        return;
      }
      if (Date.now() - pending.createdAt > 60_000) {
        pendingDealerRounds.delete(playerId);
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'dealer_round_expired' }
        });
        return;
      }

      const wager = Math.max(0, Math.min(10_000, Number(pending.wager || 0)));
      if (wager > 0 && !pending.preflightApproved) {
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: false,
            state: 'dealer_error',
            reason: 'dealer_preflight_required',
            reasonCode: 'RPC_UNAVAILABLE',
            reasonText: 'Run start round again to complete onchain preflight.',
            preflight: { playerOk: false, houseOk: false }
          }
        });
        return;
      }
      const playerPick = payload.pick;
      const opponentPick = playerPick === 'heads' ? 'tails' : 'heads';
      const playerSeed = payload.playerSeed.trim().slice(0, 96) || newSeedHex(12);

      sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: {
          ok: true,
          state: 'dealer_dealing',
          stationId,
          wager,
          playerPick
        }
      });

      const created = challengeService.createChallenge(playerId, 'system_house', 'coinflip', wager);
      if (created.event !== 'created' || !created.challenge) {
        pendingDealerRounds.delete(playerId);
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: created.reason || 'challenge_create_failed' }
        });
        return;
      }

      created.challenge.provablyFair = {
        commitHash: pending.commitHash,
        playerSeed,
        method: pending.method
      };

      created.to = [playerId];
      const createdRegistered = await registerCreatedChallenge(created, playerId);
      if (!createdRegistered.ok) {
        pendingDealerRounds.delete(playerId);
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: false,
            state: 'dealer_error',
            reason: createdRegistered.reason || 'challenge_lock_failed',
            reasonCode: createdRegistered.reason === 'player_busy' ? 'PLAYER_BUSY' : 'CHALLENGE_LOCK_FAILED',
            reasonText: createdRegistered.reason === 'player_busy'
              ? 'You already have a pending/active round. Wait a moment and retry.'
              : 'Challenge lock failed. Please retry.'
          }
        });
        return;
      }

      sendToDistributed(playerId, {
        type: 'provably_fair',
        phase: 'commit',
        challengeId: created.challenge.id,
        commitHash: pending.commitHash,
        playerSeed,
        method: pending.method
      });

      await dispatchChallengeEventWithEscrow(withActorRecipient(created, playerId));

      const accepted = challengeService.respond(created.challenge.id, 'system_house', true);
      accepted.to = [playerId];
      await dispatchChallengeEventWithEscrow(withActorRecipient(accepted, playerId));

      const locked = wager <= 0 ? true : escrowLockedChallenges.has(created.challenge.id);
      if (!locked) {
        const escrowFailure = challengeEscrowFailureById.get(created.challenge.id);
        pendingDealerRounds.delete(playerId);
        challengeEscrowFailureById.delete(created.challenge.id);
        sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: false,
            state: 'dealer_error',
            reason: escrowFailure?.reason || 'escrow_lock_failed',
            reasonCode: escrowFailure?.reasonCode,
            reasonText: escrowFailure?.reasonText,
            preflight: escrowFailure?.preflight
          }
        });
        return;
      }

      if (created.challenge.provablyFair) {
        created.challenge.provablyFair.revealSeed = pending.houseSeed;
      }
      sendToDistributed(playerId, {
        type: 'provably_fair',
        phase: 'reveal',
        challengeId: created.challenge.id,
        commitHash: pending.commitHash,
        playerSeed,
        houseSeed: pending.houseSeed,
        method: pending.method
      });

      const result = computeCoinflipFromSeeds(pending.houseSeed, playerSeed, created.challenge.id);
      challengeService.setCoinflipResultOverride(created.challenge.id, result);

      const submitted1 = challengeService.submitMove(created.challenge.id, playerId, playerPick);
      submitted1.to = [playerId];
      await dispatchChallengeEventWithEscrow(withActorRecipient(submitted1, playerId));

      const submitted2 = challengeService.submitMove(created.challenge.id, 'system_house', opponentPick);
      submitted2.to = [playerId];
      await dispatchChallengeEventWithEscrow(withActorRecipient(submitted2, playerId));

      const finalChallenge = submitted2.challenge ?? challengeService.getChallenge(created.challenge.id);
      const winnerId = finalChallenge?.winnerId ?? null;
      const payoutDelta =
        winnerId === playerId ? wager :
        winnerId && winnerId !== playerId ? -wager :
        0;
      sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: {
          ok: true,
          state: 'dealer_reveal',
          stationId,
          challengeId: created.challenge.id,
          wager,
          playerPick,
          coinflipResult: finalChallenge?.coinflipResult ?? result,
          winnerId,
          payoutDelta,
          commitHash: pending.commitHash,
          method: pending.method,
          escrowTx: challengeEscrowTxById.get(created.challenge.id) ?? {}
        }
      });
      pendingDealerRounds.delete(playerId);
      challengeEscrowTxById.delete(created.challenge.id);
      challengeEscrowFailureById.delete(created.challenge.id);
      return;
    }

    if (payload.type === 'challenge_send') {
      const targetLocal = sockets.has(payload.targetId);
      const targetPresence = targetLocal ? null : await presenceStore.get(payload.targetId);
      if (!targetLocal && !targetPresence) {
        sendTo(playerId, {
          type: 'challenge',
          event: 'invalid',
          reason: 'target_not_found'
        });
        return;
      }

      if (!arePlayersNear(activeProximityPairs, playerId, payload.targetId)) {
        sendTo(playerId, {
          type: 'challenge',
          event: 'invalid',
          reason: 'target_not_nearby'
        });
        return;
      }

      const senderRole = metaByPlayer.get(playerId)?.role ?? 'human';
      const targetRole =
        metaByPlayer.get(payload.targetId)?.role
        ?? targetPresence?.role
        ?? 'human';
      if (senderRole === 'agent' && targetRole === 'human' && agentToHumanChallengeCooldownMs > 0) {
        const key = `${playerId}|${payload.targetId}`;
        const now = Date.now();
        const last = recentAgentToHumanChallengeAt.get(key) ?? 0;
        if (now - last < agentToHumanChallengeCooldownMs) {
          sendTo(playerId, {
            type: 'challenge',
            event: 'invalid',
            reason: 'human_challenge_cooldown'
          });
          return;
        }
        recentAgentToHumanChallengeAt.set(key, now);
      }

      const wager = Math.max(0, Math.min(10_000, Number(payload.wager || 0)));
      if (wager > 0 && serverEscrowApprovalMode === 'auto') {
        const challengerWalletId = walletIdFor(playerId);
        const opponentWalletId = walletIdFor(payload.targetId);
        if (!challengerWalletId || !opponentWalletId) {
          log.warn(
            { playerId, targetId: payload.targetId, wager },
            'auto approval sponsorship rejected: missing wallet'
          );
          sendTo(playerId, {
            type: 'challenge',
            event: 'invalid',
            reason: 'wallet_required',
            approvalMode: 'auto',
            approvalSource: 'super_agent',
            approvalStatus: 'failed'
          });
          return;
        }
        const preflight = await escrowAdapter.preflightStake({
          challengerWalletId,
          opponentWalletId,
          amount: wager
        });
        if (!preflight.ok) {
          log.warn(
            {
              playerId,
              targetId: payload.targetId,
              wager,
              reason: preflight.reason,
              reasonCode: preflight.reasonCode
            },
            'auto approval sponsorship preflight failed'
          );
          sendTo(playerId, {
            type: 'challenge',
            event: 'invalid',
            reason: preflight.reason || 'wallet_prepare_failed',
            approvalMode: 'auto',
            approvalSource: 'super_agent',
            approvalStatus: 'failed'
          });
          return;
        }
        log.info(
          { playerId, targetId: payload.targetId, wager },
          'auto approval sponsorship preflight ready'
        );
      }

      const event = challengeService.createChallenge(
        playerId,
        payload.targetId,
        payload.gameType,
        payload.wager
      );
      const registered = await registerCreatedChallenge(event, playerId);
      if (!registered.ok) {
        return;
      }
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));

      // Static ambient NPCs should feel responsive even if their bot loop is delayed.
      if (event.challenge && isStaticNpcId(payload.targetId)) {
        const accepted = challengeService.respond(event.challenge.id, payload.targetId, true);
        await dispatchChallengeEventWithEscrow(withActorRecipient(accepted, payload.targetId));
        if (accepted.challenge && accepted.challenge.status === 'active') {
          const move = autoNpcMove(
            accepted.challenge.id,
            accepted.challenge.gameType === 'coinflip' ? 'coinflip' : 'rps'
          );
          const moveEvent = challengeService.submitMove(accepted.challenge.id, payload.targetId, move);
          await dispatchChallengeEventWithEscrow(withActorRecipient(moveEvent, payload.targetId));
        }
      }
      return;
    }

    if (payload.type === 'challenge_response') {
      const event = challengeService.respond(payload.challengeId, playerId, payload.accept);
      if (event.event === 'invalid' && event.reason === 'challenge_not_pending') {
        const owner = await distributedChallengeStore.getOwnerServerId(payload.challengeId);
        if (owner && owner !== serverInstanceId) {
          await distributedBus.publishCommand(owner, {
            type: 'challenge_response',
            challengeId: payload.challengeId,
            actorId: playerId,
            accept: payload.accept
          });
          return;
        }
      }
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));
      return;
    }

    if (payload.type === 'challenge_counter') {
      const existing = challengeService.getChallenge(payload.challengeId);
      if (!existing || existing.status !== 'pending') {
        const owner = await distributedChallengeStore.getOwnerServerId(payload.challengeId);
        if (owner && owner !== serverInstanceId) {
          await distributedBus.publishCommand(owner, {
            type: 'challenge_counter',
            challengeId: payload.challengeId,
            actorId: playerId,
            wager: payload.wager
          });
          return;
        }
        await dispatchChallengeEventWithEscrow(withActorRecipient({
          type: 'challenge',
          event: 'invalid',
          reason: 'challenge_not_pending'
        }, playerId));
        return;
      }

      if (existing.opponentId !== playerId) {
        await dispatchChallengeEventWithEscrow(withActorRecipient({
          type: 'challenge',
          event: 'invalid',
          reason: 'not_opponent'
        }, playerId));
        return;
      }

      const safeWager = Math.max(1, Math.min(10_000, Number(payload.wager || 1)));
      const declined = challengeService.respond(payload.challengeId, playerId, false);
      await dispatchChallengeEventWithEscrow(withActorRecipient(declined, playerId));

      const counterEvent = challengeService.createChallenge(
        playerId,
        existing.challengerId,
        existing.gameType,
        safeWager
      );
      const counterRegistered = await registerCreatedChallenge(counterEvent, playerId);
      if (!counterRegistered.ok) {
        return;
      }
      await dispatchChallengeEventWithEscrow(withActorRecipient(counterEvent, playerId));
      return;
    }

      if (payload.type === 'challenge_move') {
      const event = challengeService.submitMove(payload.challengeId, playerId, payload.move);
      if (event.event === 'invalid' && event.reason === 'challenge_not_active') {
        const owner = await distributedChallengeStore.getOwnerServerId(payload.challengeId);
        if (owner && owner !== serverInstanceId) {
          await distributedBus.publishCommand(owner, {
            type: 'challenge_move',
            challengeId: payload.challengeId,
            actorId: playerId,
            move: payload.move
          });
          return;
        }
      }
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));
    }
    } catch (error) {
      log.warn({ err: error, playerId }, 'failed to process ws message');
    }
  });

  ws.on('close', () => {
    if (sockets.get(playerId) !== ws) {
      return;
    }
    sockets.delete(playerId);
    metaByPlayer.delete(playerId);
    pendingDealerRounds.delete(playerId);
    stationRouter.clearPlayer(playerId);
    worldSim.removePlayer(playerId);
    lastPlayerPos.delete(playerId);
    void presenceStore.remove(playerId).catch((error) => {
      log.warn({ err: error, playerId }, 'presence remove failed');
    });

    clearPlayerProximityPairs(activeProximityPairs, playerId);

    for (const event of challengeService.clearDisconnectedPlayer(playerId)) {
      void dispatchChallengeEventWithEscrow(event);
    }
  });
});

setInterval(() => {
  const snapshot = worldSim.step(1 / 20);
  const now = Date.now();
  stationRouter.clearExpired(now);
  for (const [dealerPlayerId, round] of pendingDealerRounds) {
    if (now - round.createdAt > 60_000) {
      pendingDealerRounds.delete(dealerPlayerId);
    }
  }
  if (now - lastPresenceRefreshAt >= 500) {
    lastPresenceRefreshAt = now;
    void presenceStore.list().then((entries) => {
      cachedPresence = entries;
      presenceByPlayerId.clear();
      for (const entry of entries) {
        presenceByPlayerId.set(entry.playerId, entry);
      }
    }).catch(() => {
      // ignore transient presence read errors
    });
  }

  const remotePlayers = cachedPresence
    .filter((entry) => !snapshot.players.some((local) => local.id === entry.playerId))
    .map((entry) => ({
      id: entry.playerId,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      yaw: entry.yaw,
      speed: entry.speed,
      role: entry.role,
      displayName: entry.displayName,
      walletId: entry.walletId
    }));

  const mergedPlayers = [
    ...snapshot.players.map((player) => ({
      ...player,
      role: metaByPlayer.get(player.id)?.role ?? 'human',
      displayName: displayNameFor(player.id),
      walletId: walletIdFor(player.id)
    })),
    ...remotePlayers
  ];

  for (const player of snapshot.players) {
    lastPlayerPos.set(player.id, { x: player.x, z: player.z });
  }

  emitProximityEvents(
    mergedPlayers.map((player) => ({ id: player.id, x: player.x, z: player.z })),
    activeProximityPairs,
    proximityThreshold,
    displayNameFor,
    sendToDistributed
  );

  for (const event of challengeService.tick()) {
    void dispatchChallengeEventWithEscrow(event);
  }

  const syncNow = Date.now();
  if (syncNow - lastPresenceSyncAt >= 500) {
    lastPresenceSyncAt = syncNow;
    for (const player of snapshot.players) {
      const meta = metaByPlayer.get(player.id);
      if (!meta) {
        continue;
      }
      void presenceStore.upsert({
        playerId: player.id,
        role: meta.role,
        displayName: meta.displayName,
        walletId: meta.walletId,
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        speed: player.speed
      }).catch((error) => {
        log.warn({ err: error, playerId: player.id }, 'presence upsert failed');
      });
    }
  }

  const message = JSON.stringify({
    type: 'snapshot',
    tick: snapshot.tick,
    players: mergedPlayers,
    stations: STATIONS
  });

  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}, 50);

async function handleDistributedCommand(command: ChallengeCommand): Promise<void> {
  if (command.type === 'challenge_response') {
    const event = challengeService.respond(command.challengeId, command.actorId, command.accept);
    await dispatchChallengeEventWithEscrow(withActorRecipient(event, command.actorId));
    return;
  }
  if (command.type === 'challenge_counter') {
    const existing = challengeService.getChallenge(command.challengeId);
    if (!existing || existing.status !== 'pending') {
      const event = withActorRecipient({
        type: 'challenge',
        event: 'invalid',
        reason: 'challenge_not_pending'
      }, command.actorId);
      await dispatchChallengeEventWithEscrow(event);
      return;
    }
    if (existing.opponentId !== command.actorId) {
      const event = withActorRecipient({
        type: 'challenge',
        event: 'invalid',
        reason: 'not_opponent'
      }, command.actorId);
      await dispatchChallengeEventWithEscrow(event);
      return;
    }
    const safeWager = Math.max(1, Math.min(10_000, Number(command.wager || 1)));
    const declined = challengeService.respond(command.challengeId, command.actorId, false);
    await dispatchChallengeEventWithEscrow(withActorRecipient(declined, command.actorId));
    const counterEvent = challengeService.createChallenge(
      command.actorId,
      existing.challengerId,
      existing.gameType,
      safeWager
    );
    const commandRegistered = await registerCreatedChallenge(counterEvent, command.actorId);
    if (!commandRegistered.ok) {
      return;
    }
    await dispatchChallengeEventWithEscrow(withActorRecipient(counterEvent, command.actorId));
    return;
  }
  const event = challengeService.submitMove(command.challengeId, command.actorId, command.move);
  await dispatchChallengeEventWithEscrow(withActorRecipient(event, command.actorId));
}

async function handleAdminCommand(command: AdminCommand): Promise<void> {
  if (command.type !== 'admin_teleport') {
    return;
  }
  worldSim.teleportPlayer(command.playerId, command.x, command.z);
}

setInterval(() => {
  void presenceStore.heartbeatServer().catch((error) => {
    log.warn({ err: error }, 'presence heartbeat failed');
  });
}, 2_000);

setInterval(() => {
  void expireOrphanedChallenges().catch((error) => {
    log.warn({ err: error }, 'orphan challenge sweep failed');
  });
}, 3_000);

async function expireOrphanedChallenges(): Promise<void> {
  const liveServers = new Set(await presenceStore.liveServers());
  const metas = await distributedChallengeStore.listMetas();
  const now = Date.now();

  for (const meta of metas) {
    const isOpen =
      meta.status === 'created'
      || meta.status === 'accepted'
      || meta.status === 'move_submitted'
      || meta.status === 'pending'
      || meta.status === 'active';
    if (!isOpen) {
      continue;
    }
    if (liveServers.has(meta.ownerServerId)) {
      continue;
    }
    if (now - meta.updatedAt < challengeOrphanGraceMs) {
      continue;
    }

    const challenge = safeParseChallenge(meta.challengeJson);
    if (!challenge) {
      await distributedChallengeStore.releasePlayers(
        meta.challengeId,
        [meta.challengerId, meta.opponentId].filter((id) => id !== 'system_house')
      );
      await distributedChallengeStore.clear(meta.challengeId);
      continue;
    }

    const expiredChallenge = {
      ...challenge,
      status: 'expired',
      winnerId: null,
      resolvedAt: now
    };

    sendToDistributed(meta.challengerId, {
      type: 'challenge',
      event: 'expired',
      reason: 'owner_failover_expired',
      challenge: expiredChallenge
    });
    if (meta.opponentId !== 'system_house') {
      sendToDistributed(meta.opponentId, {
        type: 'challenge',
        event: 'expired',
        reason: 'owner_failover_expired',
        challenge: expiredChallenge
      });
    }
    await distributedChallengeStore.appendHistory({
      event: 'expired',
      reason: 'owner_failover_expired',
      challenge: expiredChallenge
    });
    await distributedChallengeStore.releasePlayers(
      meta.challengeId,
      [meta.challengerId, meta.opponentId].filter((id) => id !== 'system_house')
    );
    await distributedChallengeStore.clear(meta.challengeId);
  }
}

function safeParseChallenge(raw: string): {
  id: string;
  challengerId: string;
  opponentId: string;
  status: string;
  gameType: string;
  wager: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  resolvedAt: number | null;
  winnerId: string | null;
  challengerMove: string | null;
  opponentMove: string | null;
  coinflipResult: string | null;
} | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.challengerId !== 'string' || typeof parsed.opponentId !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      challengerId: parsed.challengerId,
      opponentId: parsed.opponentId,
      status: typeof parsed.status === 'string' ? parsed.status : 'pending',
      gameType: typeof parsed.gameType === 'string' ? parsed.gameType : 'rps',
      wager: Number(parsed.wager ?? 0),
      createdAt: Number(parsed.createdAt ?? Date.now()),
      expiresAt: Number(parsed.expiresAt ?? Date.now()),
      acceptedAt: parsed.acceptedAt == null ? null : Number(parsed.acceptedAt),
      resolvedAt: parsed.resolvedAt == null ? null : Number(parsed.resolvedAt),
      winnerId: typeof parsed.winnerId === 'string' ? parsed.winnerId : null,
      challengerMove: typeof parsed.challengerMove === 'string' ? parsed.challengerMove : null,
      opponentMove: typeof parsed.opponentMove === 'string' ? parsed.opponentMove : null,
      coinflipResult: typeof parsed.coinflipResult === 'string' ? parsed.coinflipResult : null
    };
  } catch {
    return null;
  }
}

void (async () => {
  if (process.env.NODE_ENV === 'production') {
    if (!config.redisUrl) {
      log.fatal('REDIS_URL must be set in production for global presence/multiplayer. Refusing to start.');
      process.exit(1);
    }
    if (!internalServiceToken) {
      log.fatal('INTERNAL_SERVICE_TOKEN must be set in production for admin ops. Refusing to start.');
      process.exit(1);
    }
  }
  await database.connect(config.databaseUrl);
  await presenceStore.connect(config.redisUrl);
  await distributedChallengeStore.connect(config.redisUrl);
  await distributedBus.connect(config.redisUrl);
  await marketService.syncAndAutoActivate()
    .then((result) => {
      log.info({ synced: result.synced, activated: result.activated, ok: result.ok }, 'prediction market sync bootstrap');
    })
    .catch((error) => {
      log.warn({ error: String((error as Error)?.message || error) }, 'prediction market sync bootstrap failed');
    });
  setInterval(() => {
    void marketService.syncAndAutoActivate()
      .then((result) => {
        log.info({ synced: result.synced, activated: result.activated, ok: result.ok }, 'prediction market sync tick');
      })
      .catch((error) => {
        log.warn({ error: String((error as Error)?.message || error) }, 'prediction market sync tick failed');
      });
  }, Math.max(30_000, Number(process.env.PREDICTION_ORACLE_SYNC_MS || 60_000))).unref();
  settlementWorker.start();
  if (wsAuthSecret) {
    log.info('websocket auth is enabled; ensure GAME_WS_AUTH_SECRET matches across web/server/agent-runtime.');
  }
  server.listen(config.port, () => {
    log.info({
      port: config.port,
      instanceId: serverInstanceId,
      runtimeUrl: config.agentRuntimeUrl,
      redisConfigured: Boolean(config.redisUrl),
      wsAuthConfigured: Boolean(wsAuthSecret),
      internalTokenConfigured: Boolean(internalServiceToken)
    }, 'server listening');
  });
})();
