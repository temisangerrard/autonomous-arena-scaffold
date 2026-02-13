import { WebSocket } from 'ws';
import { PolicyEngine, type AgentPlayerState, type Personality } from './PolicyEngine.js';

type SnapshotPlayer = AgentPlayerState & { role?: 'human' | 'agent' };

type ChallengePayload = {
  id: string;
  challengerId: string;
  opponentId: string;
  status: 'pending' | 'active' | 'resolved' | 'declined' | 'expired';
  winnerId?: string;
};

export type AgentBehaviorConfig = {
  personality: Personality;
  challengeEnabled: boolean;
  challengeCooldownMs: number;
  targetPreference: 'human_only' | 'human_first' | 'any';
};

type AgentBotConfig = {
  id: string;
  wsBaseUrl: string;
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

    const ws = new WebSocket(wsUrl.toString());
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.startDecisionLoop();
    });

    ws.on('message', (raw) => {
      this.onMessage(raw.toString());
    });

    ws.on('close', () => {
      this.connected = false;
      this.playerId = null;
      this.playersById.clear();
      this.nearbyIds.clear();

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

  private decideAndSendInput(): void {
    if (!this.playerId || !this.ws || this.ws.readyState !== this.ws.OPEN) {
      return;
    }

    const self = this.playersById.get(this.playerId);
    if (!self) {
      return;
    }

    const others = [...this.playersById.values()].filter((entry) => entry.id !== this.playerId);

    const decision = this.policyEngine.decide(
      this.config.behavior.personality,
      {
        self,
        others,
        nearbyIds: [...this.nearbyIds],
        nowMs: Date.now()
      },
      this.memory
    );

    this.ws.send(
      JSON.stringify({
        type: 'input',
        moveX: decision.moveX,
        moveZ: decision.moveZ
      })
    );
  }

  private maybeSendChallenge(): void {
    if (!this.config.behavior.challengeEnabled) {
      return;
    }
    if (!this.ws || this.ws.readyState !== this.ws.OPEN || !this.playerId) {
      return;
    }

    const now = Date.now();
    if (now - this.lastChallengeSentAt < this.config.behavior.challengeCooldownMs) {
      return;
    }

    const targetId = this.pickChallengeTarget();
    if (!targetId) {
      return;
    }

    const shouldSend =
      this.config.behavior.personality === 'aggressive' ||
      (this.config.behavior.personality === 'social' && now % 3 !== 0) ||
      (this.config.behavior.personality === 'conservative' && now % 7 === 0);

    if (!shouldSend) {
      return;
    }

    this.lastChallengeSentAt = now;
    this.stats.challengesSent += 1;
    this.stats.lastChallengeAt = now;
    this.ws.send(JSON.stringify({ type: 'challenge_send', targetId }));
  }

  private pickChallengeTarget(): string | null {
    const candidates = [...this.nearbyIds].filter((id) => id !== this.playerId);
    if (candidates.length === 0) {
      return null;
    }

    if (
      this.config.behavior.targetPreference === 'human_first' ||
      this.config.behavior.targetPreference === 'human_only'
    ) {
      const human = candidates.find((id) => this.playersById.get(id)?.role !== 'agent');
      if (human) {
        return human;
      }
      if (this.config.behavior.targetPreference === 'human_only') {
        return null;
      }
    }

    return candidates[0] ?? null;
  }

  private handleChallengeEvent(record: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN || !this.playerId) {
      return;
    }

    const challenge = record.challenge as ChallengePayload | undefined;

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

    if (record.event === 'resolved' && challenge) {
      if (challenge.winnerId === this.playerId) {
        this.stats.challengesWon += 1;
      } else if (
        challenge.challengerId === this.playerId ||
        challenge.opponentId === this.playerId
      ) {
        this.stats.challengesLost += 1;
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
}
