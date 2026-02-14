import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ChallengeService, type ChallengeEvent, type GameMove, type GameType } from './ChallengeService.js';
import { EscrowAdapter } from './EscrowAdapter.js';
import { createHealthStatus } from './health.js';
import { WorldSim } from './WorldSim.js';

type InputMessage = {
  type: 'input';
  moveX: number;
  moveZ: number;
};

type ChallengeSendMessage = {
  type: 'challenge_send';
  targetId: string;
  gameType: GameType;
  wager: number;
};

type ChallengeResponseMessage = {
  type: 'challenge_response';
  challengeId: string;
  accept: boolean;
};

type ChallengeMoveMessage = {
  type: 'challenge_move';
  challengeId: string;
  move: GameMove;
};

type ClientMessage =
  | InputMessage
  | ChallengeSendMessage
  | ChallengeResponseMessage
  | ChallengeMoveMessage;

type PlayerRole = 'human' | 'agent';

type PlayerMeta = {
  role: PlayerRole;
  displayName: string;
  walletId: string | null;
};

const port = Number(process.env.PORT ?? 4000);
const worldSim = new WorldSim();
const challengeService = new ChallengeService(() => Date.now(), () => Math.random());
const internalServiceToken = resolveInternalServiceToken();
const escrowAdapter = new EscrowAdapter(
  process.env.AGENT_RUNTIME_URL ?? 'http://localhost:4100',
  Math.max(0, Math.min(10_000, Number(process.env.ESCROW_FEE_BPS ?? 0))),
  {
    mode: (process.env.ESCROW_EXECUTION_MODE === 'onchain' ? 'onchain' : 'runtime'),
    rpcUrl: process.env.CHAIN_RPC_URL,
    resolverPrivateKey: process.env.ESCROW_RESOLVER_PRIVATE_KEY,
    escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
    tokenDecimals: Number(process.env.ESCROW_TOKEN_DECIMALS ?? 6),
    internalToken: internalServiceToken
  }
);

const server = createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.url === '/health') {
    const payload = createHealthStatus();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.url?.startsWith('/challenges/recent')) {
    const parsed = new URL(req.url, 'http://localhost');
    const limit = Number(parsed.searchParams.get('limit') ?? 60);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ recent: challengeService.getRecent(limit) }));
    return;
  }

  if (req.url === '/favicon.ico') {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true });
const sockets = new Map<string, WebSocket>();
const metaByPlayer = new Map<string, PlayerMeta>();
const activeProximityPairs = new Set<string>();
let nextClient = 1;
const proximityThreshold = Number(process.env.PROXIMITY_THRESHOLD ?? 12);
const escrowLockedChallenges = new Set<string>();
const agentToHumanChallengeCooldownMs = Math.max(0, Number(process.env.AGENT_TO_HUMAN_CHALLENGE_COOLDOWN_MS ?? 20000));
const recentAgentToHumanChallengeAt = new Map<string, number>();

function resolveInternalServiceToken(): string {
  const configured = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (configured) {
    return configured;
  }
  const superAgentKey = (process.env.ESCROW_RESOLVER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!superAgentKey) {
    return '';
  }
  return `sa_${createHash('sha256').update(superAgentKey).digest('hex')}`;
}

function setCorsHeaders(res: import('node:http').ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function rawToString(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw instanceof Buffer) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString('utf8');
  }
  return '';
}

function parseClientMessage(raw: RawData): ClientMessage | null {
  try {
    const payload = JSON.parse(rawToString(raw)) as Record<string, unknown>;

    if (
      payload.type === 'input' &&
      typeof payload.moveX === 'number' &&
      typeof payload.moveZ === 'number'
    ) {
      return {
        type: 'input',
        moveX: payload.moveX,
        moveZ: payload.moveZ
      };
    }

    if (
      payload.type === 'challenge_send' &&
      typeof payload.targetId === 'string' &&
      (payload.gameType === 'rps' || payload.gameType === 'coinflip')
    ) {
      return {
        type: 'challenge_send',
        targetId: payload.targetId,
        gameType: payload.gameType,
        wager: typeof payload.wager === 'number' ? payload.wager : 1
      };
    }

    if (
      payload.type === 'challenge_response' &&
      typeof payload.challengeId === 'string' &&
      typeof payload.accept === 'boolean'
    ) {
      return {
        type: 'challenge_response',
        challengeId: payload.challengeId,
        accept: payload.accept
      };
    }

    if (
      payload.type === 'challenge_move' &&
      typeof payload.challengeId === 'string' &&
      (payload.move === 'rock' ||
        payload.move === 'paper' ||
        payload.move === 'scissors' ||
        payload.move === 'heads' ||
        payload.move === 'tails')
    ) {
      return {
        type: 'challenge_move',
        challengeId: payload.challengeId,
        move: payload.move
      };
    }

    return null;
  } catch {
    return null;
  }
}

function makePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function arePlayersNear(a: string, b: string): boolean {
  return activeProximityPairs.has(makePairKey(a, b));
}

function sendTo(playerId: string, payload: object): void {
  const ws = sockets.get(playerId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function displayNameFor(playerId: string): string {
  return metaByPlayer.get(playerId)?.displayName ?? playerId;
}

function walletIdFor(playerId: string): string | null {
  return metaByPlayer.get(playerId)?.walletId ?? null;
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
  if (event.to) {
    for (const playerId of event.to) {
      sendTo(playerId, {
        type: 'challenge',
        event: event.event,
        reason: event.reason,
        challenge: event.challenge
      });
    }
  }

  broadcast({
    type: 'challenge_feed',
    event: event.event,
    reason: event.reason,
    challenge: event.challenge
  });
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
  if (event.challenge) {
    const challenge = event.challenge;
    const wager = Math.max(0, challenge.wager);

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
      const winnerWalletId = challenge.winnerId ? walletIdFor(challenge.winnerId) : null;
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
    }
  }

  dispatchChallengeEvent(event);
}

function emitProximityEvents(players: Array<{ id: string; x: number; z: number }>): void {
  const nowNear = new Set<string>();

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (!a || !b) {
        continue;
      }

      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance <= proximityThreshold) {
        const key = makePairKey(a.id, b.id);
        nowNear.add(key);

        if (!activeProximityPairs.has(key)) {
          sendTo(a.id, { type: 'proximity', event: 'enter', otherId: b.id, otherName: displayNameFor(b.id), distance });
          sendTo(b.id, { type: 'proximity', event: 'enter', otherId: a.id, otherName: displayNameFor(a.id), distance });
        }
      }
    }
  }

  for (const key of activeProximityPairs) {
    if (nowNear.has(key)) {
      continue;
    }

    const [a, b] = key.split('|');
    if (a && b) {
      sendTo(a, { type: 'proximity', event: 'exit', otherId: b, otherName: displayNameFor(b) });
      sendTo(b, { type: 'proximity', event: 'exit', otherId: a, otherName: displayNameFor(a) });
    }
  }

  activeProximityPairs.clear();
  for (const key of nowNear) {
    activeProximityPairs.add(key);
  }
}

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  const parsed = new URL(request.url ?? '/ws', 'http://localhost');
  const requestedRole = parsed.searchParams.get('role');
  const role: PlayerRole = requestedRole === 'agent' ? 'agent' : 'human';
  const preferredName = parsed.searchParams.get('name')?.trim();
  const walletId = parsed.searchParams.get('walletId')?.trim() || null;
  const requestedClientId = parsed.searchParams.get('clientId')?.trim();
  const normalizedClientId = requestedClientId?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const preferredId =
    role === 'agent'
      ? parsed.searchParams.get('agentId')?.trim()
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
  worldSim.joinPlayer(playerId);

  ws.send(JSON.stringify({ type: 'welcome', playerId, role, displayName: displayNameFor(playerId) }));

  ws.on('message', async (raw: RawData) => {
    const payload = parseClientMessage(raw);
    if (!payload) {
      return;
    }

    if (payload.type === 'input') {
      worldSim.setInput(playerId, {
        moveX: payload.moveX,
        moveZ: payload.moveZ
      });
      return;
    }

    if (payload.type === 'challenge_send') {
      if (!sockets.has(payload.targetId)) {
        sendTo(playerId, {
          type: 'challenge',
          event: 'invalid',
          reason: 'target_not_found'
        });
        return;
      }

      if (!arePlayersNear(playerId, payload.targetId)) {
        sendTo(playerId, {
          type: 'challenge',
          event: 'invalid',
          reason: 'target_not_nearby'
        });
        return;
      }

      const senderRole = metaByPlayer.get(playerId)?.role ?? 'human';
      const targetRole = metaByPlayer.get(payload.targetId)?.role ?? 'human';
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

      const event = challengeService.createChallenge(
        playerId,
        payload.targetId,
        payload.gameType,
        payload.wager
      );
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));
      return;
    }

    if (payload.type === 'challenge_response') {
      const event = challengeService.respond(payload.challengeId, playerId, payload.accept);
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));
      return;
    }

    if (payload.type === 'challenge_move') {
      const event = challengeService.submitMove(payload.challengeId, playerId, payload.move);
      await dispatchChallengeEventWithEscrow(withActorRecipient(event, playerId));
    }
  });

  ws.on('close', () => {
    if (sockets.get(playerId) !== ws) {
      return;
    }
    sockets.delete(playerId);
    metaByPlayer.delete(playerId);
    worldSim.removePlayer(playerId);

    for (const key of [...activeProximityPairs]) {
      if (key.includes(`${playerId}|`) || key.includes(`|${playerId}`)) {
        activeProximityPairs.delete(key);
      }
    }

    for (const event of challengeService.clearDisconnectedPlayer(playerId)) {
      void dispatchChallengeEventWithEscrow(event);
    }
  });
});

setInterval(() => {
  const snapshot = worldSim.step(1 / 20);
  emitProximityEvents(snapshot.players);

  for (const event of challengeService.tick()) {
    void dispatchChallengeEventWithEscrow(event);
  }

  const playersWithRole = snapshot.players.map((player) => ({
    ...player,
    role: metaByPlayer.get(player.id)?.role ?? 'human',
    displayName: displayNameFor(player.id)
  }));

  const message = JSON.stringify({
    type: 'snapshot',
    tick: snapshot.tick,
    players: playersWithRole
  });

  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}, 50);

server.listen(port, () => {
  console.log(`server listening on :${port}`);
});
