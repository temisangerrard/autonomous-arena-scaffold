import { createServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ChallengeService, type ChallengeEvent } from './ChallengeService.js';
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
};

type ChallengeResponseMessage = {
  type: 'challenge_response';
  challengeId: string;
  accept: boolean;
};

type ClientMessage = InputMessage | ChallengeSendMessage | ChallengeResponseMessage;

type PlayerRole = 'human' | 'agent';

type PlayerMeta = {
  role: PlayerRole;
};

const port = Number(process.env.PORT ?? 4000);
const worldSim = new WorldSim();
const challengeService = new ChallengeService(() => Date.now(), () => Math.random());

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

    if (payload.type === 'challenge_send' && typeof payload.targetId === 'string') {
      return {
        type: 'challenge_send',
        targetId: payload.targetId
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

function emitProximityEvents(players: Array<{ id: string; x: number; z: number }>): void {
  const nowNear = new Set<string>();
  const threshold = 6;

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (!a || !b) {
        continue;
      }

      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance <= threshold) {
        const key = makePairKey(a.id, b.id);
        nowNear.add(key);

        if (!activeProximityPairs.has(key)) {
          sendTo(a.id, { type: 'proximity', event: 'enter', otherId: b.id, distance });
          sendTo(b.id, { type: 'proximity', event: 'enter', otherId: a.id, distance });
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
      sendTo(a, { type: 'proximity', event: 'exit', otherId: b });
      sendTo(b, { type: 'proximity', event: 'exit', otherId: a });
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

  const preferredId = parsed.searchParams.get('agentId')?.trim();
  let playerId = preferredId && !sockets.has(preferredId) ? preferredId : `p${nextClient}`;
  nextClient += 1;

  while (sockets.has(playerId)) {
    playerId = `${playerId}_${nextClient}`;
    nextClient += 1;
  }

  sockets.set(playerId, ws);
  metaByPlayer.set(playerId, { role });
  worldSim.joinPlayer(playerId);

  ws.send(JSON.stringify({ type: 'welcome', playerId, role }));

  ws.on('message', (raw: RawData) => {
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

      const event = challengeService.createChallenge(playerId, payload.targetId);
      dispatchChallengeEvent(event);
      return;
    }

    if (payload.type === 'challenge_response') {
      const event = challengeService.respond(payload.challengeId, playerId, payload.accept);
      dispatchChallengeEvent(event);
    }
  });

  ws.on('close', () => {
    sockets.delete(playerId);
    metaByPlayer.delete(playerId);
    worldSim.removePlayer(playerId);

    for (const key of [...activeProximityPairs]) {
      if (key.includes(`${playerId}|`) || key.includes(`|${playerId}`)) {
        activeProximityPairs.delete(key);
      }
    }

    for (const event of challengeService.clearDisconnectedPlayer(playerId)) {
      dispatchChallengeEvent(event);
    }
  });
});

setInterval(() => {
  const snapshot = worldSim.step(1 / 20);
  emitProximityEvents(snapshot.players);

  for (const event of challengeService.tick()) {
    dispatchChallengeEvent(event);
  }

  const playersWithRole = snapshot.players.map((player) => ({
    ...player,
    role: metaByPlayer.get(player.id)?.role ?? 'human'
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
