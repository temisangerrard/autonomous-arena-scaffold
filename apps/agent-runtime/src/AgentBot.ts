import { WebSocket, type RawData } from 'ws';
import { PolicyEngine, type AgentPlayerState, type Personality } from './PolicyEngine.js';
import { signWsAuthToken } from '@arena/shared';

type SnapshotPlayer = AgentPlayerState & { role?: 'human' | 'agent' };

type ChallengePayload = {
  id: string;
  challengerId: string;
  opponentId: string;
  gameType: 'coinflip' | 'rps';
  wager: number;
  status: 'pending' | 'active' | 'resolved' | 'declined' | 'expired';
  winnerId?: string;
  challengerMove?: 'rock' | 'paper' | 'scissors' | 'heads' | 'tails' | null;
  opponentMove?: 'rock' | 'paper' | 'scissors' | 'heads' | 'tails' | null;
  coinflipResult?: 'heads' | 'tails' | null;
};

export type AgentBehaviorConfig = {
  personality: Personality;
  mode: 'active' | 'passive';
  challengeEnabled: boolean;
  challengeCooldownMs: number;
  targetPreference: 'human_only' | 'human_first' | 'any';
  patrolSection?: number;
  patrolRadius?: number;
  baseWager: number;
  maxWager: number;
};

type AgentBotConfig = {
  id: string;
  wsBaseUrl: string;
  displayName: string;
  walletId?: string | null;
  behavior: AgentBehaviorConfig;
};

export type AgentBotStatus = {
  id: string;
  connected: boolean;
  playerId: string | null;
  behavior: AgentBehaviorConfig;
  nearbyCount: number;
  stats: {
    challengesSent: number;
    challengesReceived: number;
    challengesAccepted: number;
    challengesDeclined: number;
    challengesWon: number;
    challengesLost: number;
    lastChallengeAt: number | null;
  };
};

export class AgentBot {
  private readonly config: AgentBotConfig;
  private readonly policyEngine = new PolicyEngine();
  private readonly memory: { seed: number };

  private ws: WebSocket | null = null;
  private connected = false;
  private playerId: string | null = null;
  private playersById = new Map<string, SnapshotPlayer>();
  private nearbyIds = new Set<string>();

  private decisionTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private lastChallengeSentAt = 0;
  private challengeSuppressedUntil = 0;
  private targetCooldownUntil = new Map<string, number>();
  private submittedMoveByChallenge = new Set<string>();
  private stallFrames = 0;
  private lastSample: { x: number; z: number } | null = null;

  private stats = {
    challengesSent: 0,
    challengesReceived: 0,
    challengesAccepted: 0,
    challengesDeclined: 0,
    challengesWon: 0,
    challengesLost: 0,
    lastChallengeAt: null as number | null
  };

  constructor(config: AgentBotConfig) {
    this.config = config;
    this.memory = { seed: [...config.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) };
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.connected = false;
    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
      this.decisionTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getId(): string {
    return this.config.id;
  }

  updateBehavior(patch: Partial<AgentBehaviorConfig>): void {
    this.config.behavior = {
      ...this.config.behavior,
      ...patch
    };
  }

  updateDisplayName(displayName: string): void {
    const next = displayName.trim();
    if (!next || next === this.config.displayName) {
      return;
    }
    this.config.displayName = next;
    if (this.connected) {
      this.stop();
      this.start();
    }
  }

  getStatus(): AgentBotStatus {
    return {
      id: this.config.id,
      connected: this.connected,
      playerId: this.playerId,
      behavior: { ...this.config.behavior },
      nearbyCount: this.nearbyIds.size,
      stats: { ...this.stats }
    };
  }

  private connect(): void {
    const wsUrl = new URL(this.config.wsBaseUrl);
    wsUrl.searchParams.set('role', 'agent');
    wsUrl.searchParams.set('agentId', this.config.id);
    wsUrl.searchParams.set('name', this.config.displayName);
    if (this.config.walletId) {
      wsUrl.searchParams.set('walletId', this.config.walletId);
    }
    const wsAuthSecret = process.env.GAME_WS_AUTH_SECRET?.trim() || '';
    if (wsAuthSecret) {
      wsUrl.searchParams.set('wsAuth', signWsAuthToken(wsAuthSecret, {
        role: 'agent',
        agentId: this.config.id,
        walletId: this.config.walletId ?? null,
        exp: Date.now() + 1000 * 60 * 5
      }));
    }

    const ws = new WebSocket(wsUrl.toString());
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.startDecisionLoop();
    });

    ws.on('message', (raw: RawData) => {
      this.onMessage(raw.toString());
    });

    ws.on('close', () => {
      this.connected = false;
      this.playerId = null;
      this.playersById.clear();
      this.nearbyIds.clear();
      this.submittedMoveByChallenge.clear();
      this.stallFrames = 0;
      this.lastSample = null;

      if (this.decisionTimer) {
        clearInterval(this.decisionTimer);
        this.decisionTimer = null;
      }

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, 1000);
    });

    ws.on('error', () => {
      // Silent reconnect loop is enough for v1 runtime.
    });
  }

  private onMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (!payload || typeof payload !== 'object') {
      return;
    }

    const record = payload as Record<string, unknown>;

    if (record.type === 'welcome' && typeof record.playerId === 'string') {
      this.playerId = record.playerId;
      return;
    }

    if (record.type === 'snapshot' && Array.isArray(record.players)) {
      this.playersById.clear();
      for (const entry of record.players) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const item = entry as Record<string, unknown>;
        if (
          typeof item.id === 'string' &&
          typeof item.x === 'number' &&
          typeof item.z === 'number'
        ) {
          this.playersById.set(item.id, {
            id: item.id,
            x: item.x,
            z: item.z,
            role: item.role === 'agent' ? 'agent' : 'human'
          });
        }
      }
      return;
    }

    if (record.type === 'proximity' && typeof record.otherId === 'string') {
      if (record.event === 'enter') {
        this.nearbyIds.add(record.otherId);
        this.maybeSendChallenge();
      }
      if (record.event === 'exit') {
        this.nearbyIds.delete(record.otherId);
      }
      return;
    }

    if (record.type === 'challenge') {
      this.handleChallengeEvent(record);
    }
  }

  private startDecisionLoop(): void {
    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
    }

    this.decisionTimer = setInterval(() => {
      this.decideAndSendInput();
      this.maybeSendChallenge();
    }, 120);
  }

  private sectionFor(x: number, z: number): number {
    const col = Math.max(0, Math.min(3, Math.floor((x + 120) / 60)));
    const row = z < 0 ? 0 : 1;
    return row * 4 + col;
  }

  private isInSameOrAdjacentSection(a: SnapshotPlayer, b: SnapshotPlayer): boolean {
    const sa = this.sectionFor(a.x, a.z);
    const sb = this.sectionFor(b.x, b.z);
    const ca = sa % 4;
    const ra = Math.floor(sa / 4);
    const cb = sb % 4;
    const rb = Math.floor(sb / 4);
    return Math.abs(ca - cb) <= 1 && Math.abs(ra - rb) <= 1;
  }

  private decideAndSendInput(): void {
    if (!this.playerId || !this.ws || this.ws.readyState !== this.ws.OPEN) {
      return;
    }

    const self = this.playersById.get(this.playerId);
    if (!self) {
      return;
    }

    if (this.config.behavior.mode === 'passive') {
      // Passive means "parked": stop locomotion and do not make decisions.
      this.ws.send(JSON.stringify({ type: 'input', moveX: 0, moveZ: 0 }));
      return;
    }

    const allOthers = [...this.playersById.values()].filter((entry) => entry.id !== this.playerId);
    const scopedOthers = allOthers.filter((entry) => this.isInSameOrAdjacentSection(self, entry));
    const worldOthers = scopedOthers.length > 0 ? scopedOthers : allOthers;
    const agentOthers = worldOthers.filter((entry) => entry.role === 'agent');
    const humanOthers = worldOthers.filter((entry) => entry.role !== 'agent');

    // Movement should not hard-swarm humans from far away. Humans only become
    // "interesting" for locomotion when already close enough to plausibly interact.
    const HUMAN_INTEREST_RADIUS = 9.5;
    const movementHumans = humanOthers.filter(
      (entry) => Math.hypot(entry.x - self.x, entry.z - self.z) <= HUMAN_INTEREST_RADIUS
    );
    const movementOthers = agentOthers.concat(movementHumans);

    let decision = this.policyEngine.decide(
      this.config.behavior.personality,
      {
        self,
        others: movementOthers,
        nearbyIds: [...this.nearbyIds],
        nowMs: Date.now(),
        patrolSection: this.config.behavior.patrolSection,
        patrolRadius: this.config.behavior.patrolRadius
      },
      this.memory
    );

    if (this.lastSample) {
      const moved = Math.hypot(self.x - this.lastSample.x, self.z - this.lastSample.z);
      if (moved < 0.05) {
        this.stallFrames += 1;
      } else {
        this.stallFrames = Math.max(0, this.stallFrames - 2);
      }
    }
    this.lastSample = { x: self.x, z: self.z };

    // Escape local deadlocks: if stalled for ~3s, inject a deterministic burst.
    if (this.stallFrames > 24) {
      const bucket = Math.floor(Date.now() / 900);
      const angle = ((this.memory.seed * 31 + bucket * 17) % 360) * (Math.PI / 180);
      decision = {
        moveX: Math.cos(angle),
        moveZ: Math.sin(angle),
        focusId: null
      };
      this.stallFrames = 8;
    }

    this.ws.send(
      JSON.stringify({
        type: 'input',
        moveX: decision.moveX,
        moveZ: decision.moveZ
      })
    );
  }

  private maybeSendChallenge(): void {
    if (this.config.behavior.mode === 'passive') {
      return;
    }
    if (!this.config.behavior.challengeEnabled) {
      return;
    }
    if (!this.ws || this.ws.readyState !== this.ws.OPEN || !this.playerId) {
      return;
    }

    const now = Date.now();
    if (now < this.challengeSuppressedUntil) {
      return;
    }
    if (now - this.lastChallengeSentAt < this.config.behavior.challengeCooldownMs) {
      return;
    }

    const targetId = this.pickChallengeTarget();
    if (!targetId) {
      return;
    }

    const shouldSend =
      this.config.behavior.personality === 'aggressive' ||
      this.config.behavior.personality === 'social' ||
      (this.config.behavior.personality === 'conservative' && now % 2 === 0);

    if (!shouldSend) {
      return;
    }

    this.lastChallengeSentAt = now;
    this.stats.challengesSent += 1;
    this.stats.lastChallengeAt = now;
    const gameType = this.config.behavior.personality === 'conservative' ? 'coinflip' : 'rps';
    const personalityWager = this.config.behavior.personality === 'aggressive' ? 3 : 1;
    const base = Math.max(1, Number(this.config.behavior.baseWager || personalityWager));
    const max = Math.max(base, Number(this.config.behavior.maxWager || base));
    const wager = Math.max(1, Math.min(max, base));
    this.ws.send(JSON.stringify({ type: 'challenge_send', targetId, gameType, wager }));
  }

  private pickChallengeTarget(): string | null {
    const now = Date.now();
    const candidates = [...this.nearbyIds].filter((id) => id !== this.playerId);
    if (candidates.length === 0) {
      return null;
    }
    const cooled = candidates.filter((id) => (this.targetCooldownUntil.get(id) ?? 0) <= now);
    const pool = cooled.length > 0 ? cooled : candidates;

    const nowBucket = Math.floor(now / 1000);
    const rotateBy = (this.memory.seed + nowBucket) % pool.length;
    const rotated = pool.slice(rotateBy).concat(pool.slice(0, rotateBy));
    const humanCandidates = rotated.filter((id) => this.playersById.get(id)?.role !== 'agent');
    const agentCandidates = rotated.filter((id) => this.playersById.get(id)?.role === 'agent');

    if (
      this.config.behavior.targetPreference === 'human_first' ||
      this.config.behavior.targetPreference === 'human_only'
    ) {
      if (humanCandidates.length > 0) {
        // Keep humans prioritized without hard-swarming one player.
        if (this.config.behavior.targetPreference === 'human_only' || (this.memory.seed + nowBucket) % 3 !== 0) {
          return humanCandidates[0] ?? null;
        }
      }
      if (this.config.behavior.targetPreference === 'human_only') {
        return null;
      }
      if (agentCandidates.length > 0) {
        return agentCandidates[0] ?? null;
      }
    }

    return rotated[0] ?? null;
  }

  private handleChallengeEvent(record: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN || !this.playerId) {
      return;
    }

    const challenge = record.challenge as ChallengePayload | undefined;
    const reason = typeof record.reason === 'string' ? record.reason : '';

    if (record.event === 'invalid' || record.event === 'busy') {
      this.challengeSuppressedUntil = Date.now() + 2200 + (this.memory.seed % 700);
      if (reason === 'target_not_nearby' || reason === 'player_busy') {
        const current = this.pickChallengeTarget();
        if (current) {
          this.targetCooldownUntil.set(current, Date.now() + 9000);
        }
      }
      return;
    }

    if (record.event === 'created' && challenge && challenge.opponentId === this.playerId) {
      this.stats.challengesReceived += 1;
      const accept = this.shouldAcceptChallenge();
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
          return;
        }
        this.ws.send(
          JSON.stringify({
            type: 'challenge_response',
            challengeId: challenge.id,
            accept
          })
        );
        if (accept) {
          this.stats.challengesAccepted += 1;
        } else {
          this.stats.challengesDeclined += 1;
        }
      }, 400 + (this.memory.seed % 250));
    }

    if (record.event === 'created' && challenge && challenge.challengerId === this.playerId) {
      this.targetCooldownUntil.set(challenge.opponentId, Date.now() + 7000 + (this.memory.seed % 1500));
    }

    if ((record.event === 'accepted' || record.event === 'move_submitted') && challenge) {
      this.maybeSubmitGameMove(challenge);
    }

    if (record.event === 'resolved' && challenge) {
      this.submittedMoveByChallenge.delete(challenge.id);
      this.challengeSuppressedUntil = Date.now() + 1400;
      if (challenge.winnerId === this.playerId) {
        this.stats.challengesWon += 1;
      } else if (
        challenge.challengerId === this.playerId ||
        challenge.opponentId === this.playerId
      ) {
        this.stats.challengesLost += 1;
      }
    }

    if ((record.event === 'declined' || record.event === 'expired') && challenge) {
      this.submittedMoveByChallenge.delete(challenge.id);
      this.challengeSuppressedUntil = Date.now() + 1800;
      const otherId = challenge.challengerId === this.playerId ? challenge.opponentId : challenge.challengerId;
      if (otherId && otherId !== this.playerId) {
        this.targetCooldownUntil.set(otherId, Date.now() + 11000 + (this.memory.seed % 1800));
      }
    }
  }

  private shouldAcceptChallenge(): boolean {
    if (this.config.behavior.personality === 'aggressive') {
      return true;
    }
    if (this.config.behavior.personality === 'social') {
      return Date.now() % 5 !== 0;
    }
    return Date.now() % 3 === 0;
  }

  private maybeSubmitGameMove(challenge: ChallengePayload): void {
    if (!this.playerId || !this.ws || this.ws.readyState !== this.ws.OPEN) {
      return;
    }

    const iAmChallenger = challenge.challengerId === this.playerId;
    const iAmOpponent = challenge.opponentId === this.playerId;
    if (!iAmChallenger && !iAmOpponent) {
      return;
    }
    if (this.submittedMoveByChallenge.has(challenge.id)) {
      return;
    }

    const existingMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;
    if (existingMove) {
      this.submittedMoveByChallenge.add(challenge.id);
      return;
    }

    const rpsMoves: Array<'rock' | 'paper' | 'scissors'> = ['rock', 'paper', 'scissors'];
    const coinMoves: Array<'heads' | 'tails'> = ['heads', 'tails'];
    const idx = (Date.now() + this.memory.seed) % 3;
    const move =
      challenge.gameType === 'coinflip'
        ? (coinMoves[idx % coinMoves.length] ?? 'heads')
        : (rpsMoves[idx % rpsMoves.length] ?? 'rock');
    this.submittedMoveByChallenge.add(challenge.id);

    setTimeout(() => {
      if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
        return;
      }
      this.ws.send(
        JSON.stringify({
          type: 'challenge_move',
          challengeId: challenge.id,
          move
        })
      );
    }, 300 + (this.memory.seed % 400));
  }
}
