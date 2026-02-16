import { log as rootLog } from './logger.js';

const log = rootLog.child({ module: 'challenge-store' });

type RedisClientLike = {
  connect: () => Promise<unknown>;
  on: (event: 'error', listener: (error: unknown) => void) => void;
  hSet: (key: string, values: Record<string, string>) => Promise<number>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  del: (key: string) => Promise<number>;
  set: (key: string, value: string, options?: { NX?: boolean; PX?: number }) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  lPush: (key: string, values: string[]) => Promise<number>;
  lTrim: (key: string, start: number, stop: number) => Promise<string>;
  lRange: (key: string, start: number, stop: number) => Promise<string[]>;
};

type ChallengeMeta = {
  challengeId: string;
  ownerServerId: string;
  challengerId: string;
  opponentId: string;
  status: string;
  updatedAt: number;
  challengeJson: string;
};

const CHALLENGE_KEY_PREFIX = 'arena:challenge:';
const PLAYER_LOCK_PREFIX = 'arena:lock:player:';
const HISTORY_KEY = 'arena:challenge:history';
const HISTORY_LIMIT = 300;

function challengeKey(challengeId: string): string {
  return `${CHALLENGE_KEY_PREFIX}${challengeId}`;
}

function playerLockKey(playerId: string): string {
  return `${PLAYER_LOCK_PREFIX}${playerId}`;
}

export class DistributedChallengeStore {
  private redis: RedisClientLike | null = null;
  private memoryLocks = new Map<string, string>();
  private memoryMeta = new Map<string, ChallengeMeta>();

  constructor(private readonly ownerServerId: string) {}

  async connect(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      return;
    }
    const mod = await import('redis');
    const client = mod.createClient({ url: redisUrl }) as unknown as RedisClientLike;
    client.on('error', (error) => {
      log.error({ err: error }, 'redis connection error');
    });
    await client.connect();
    this.redis = client;
    log.info('connected to redis');
  }

  async registerChallenge(params: {
    challengeId: string;
    challengerId: string;
    opponentId: string;
    status: string;
    challengeJson: string;
  }): Promise<void> {
    const meta: ChallengeMeta = {
      challengeId: params.challengeId,
      ownerServerId: this.ownerServerId,
      challengerId: params.challengerId,
      opponentId: params.opponentId,
      status: params.status,
      updatedAt: Date.now(),
      challengeJson: params.challengeJson
    };
    this.memoryMeta.set(params.challengeId, meta);
    if (!this.redis) {
      return;
    }
    await this.redis.hSet(challengeKey(params.challengeId), {
      challengeId: meta.challengeId,
      ownerServerId: meta.ownerServerId,
      challengerId: meta.challengerId,
      opponentId: meta.opponentId,
      status: meta.status,
      updatedAt: String(meta.updatedAt),
      challengeJson: meta.challengeJson
    });
  }

  async updateStatus(challengeId: string, status: string, challengeJson?: string): Promise<void> {
    const existing = this.memoryMeta.get(challengeId);
    if (existing) {
      existing.status = status;
      existing.updatedAt = Date.now();
      if (challengeJson) {
        existing.challengeJson = challengeJson;
      }
    }
    if (!this.redis) {
      return;
    }
    const payload: Record<string, string> = {
      status,
      updatedAt: String(Date.now())
    };
    if (challengeJson) {
      payload.challengeJson = challengeJson;
    }
    await this.redis.hSet(challengeKey(challengeId), payload);
  }

  async getOwnerServerId(challengeId: string): Promise<string | null> {
    const local = this.memoryMeta.get(challengeId);
    if (local) {
      return local.ownerServerId;
    }
    if (!this.redis) {
      return null;
    }
    const hash = await this.redis.hGetAll(challengeKey(challengeId));
    return hash.ownerServerId || null;
  }

  async getMeta(challengeId: string): Promise<ChallengeMeta | null> {
    const local = this.memoryMeta.get(challengeId);
    if (local) {
      return local;
    }
    if (!this.redis) {
      return null;
    }
    const hash = await this.redis.hGetAll(challengeKey(challengeId));
    if (!hash.challengeId) {
      return null;
    }
    const parsed: ChallengeMeta = {
      challengeId: hash.challengeId,
      ownerServerId: hash.ownerServerId || '',
      challengerId: hash.challengerId || '',
      opponentId: hash.opponentId || '',
      status: hash.status || 'unknown',
      updatedAt: Number(hash.updatedAt || 0),
      challengeJson: hash.challengeJson || ''
    };
    this.memoryMeta.set(challengeId, parsed);
    return parsed;
  }

  async listMetas(): Promise<ChallengeMeta[]> {
    if (!this.redis) {
      return [...this.memoryMeta.values()];
    }
    const keys = (await this.redis.keys(`${CHALLENGE_KEY_PREFIX}*`))
      .filter((key) => key !== HISTORY_KEY);
    if (keys.length === 0) {
      return [];
    }
    const metas: ChallengeMeta[] = [];
    for (const key of keys) {
      let hash: Record<string, string>;
      try {
        hash = await this.redis.hGetAll(key);
      } catch (error) {
        log.warn({ err: error, key }, 'failed to read challenge hash');
        continue;
      }
      if (!hash.challengeId) {
        continue;
      }
      metas.push({
        challengeId: hash.challengeId,
        ownerServerId: hash.ownerServerId || '',
        challengerId: hash.challengerId || '',
        opponentId: hash.opponentId || '',
        status: hash.status || 'unknown',
        updatedAt: Number(hash.updatedAt || 0),
        challengeJson: hash.challengeJson || ''
      });
    }
    return metas;
  }

  async appendHistory(entry: Record<string, unknown>): Promise<void> {
    const encoded = JSON.stringify({ ...entry, at: Date.now() });
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.lPush(HISTORY_KEY, [encoded]);
      await this.redis.lTrim(HISTORY_KEY, 0, HISTORY_LIMIT - 1);
    } catch (error) {
      // Self-heal stale key type mismatches from older deployments.
      log.warn({ err: error }, 'history key invalid type; resetting');
      await this.redis.del(HISTORY_KEY);
      await this.redis.lPush(HISTORY_KEY, [encoded]);
      await this.redis.lTrim(HISTORY_KEY, 0, HISTORY_LIMIT - 1);
    }
  }

  async recentHistory(limit: number): Promise<Record<string, unknown>[]> {
    if (!this.redis) {
      return [];
    }
    let raw: string[] = [];
    try {
      raw = await this.redis.lRange(HISTORY_KEY, 0, Math.max(0, limit - 1));
    } catch (error) {
      log.warn({ err: error }, 'failed reading challenge history');
      return [];
    }
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  async clear(challengeId: string): Promise<void> {
    this.memoryMeta.delete(challengeId);
    if (this.redis) {
      await this.redis.del(challengeKey(challengeId));
    }
  }

  async tryLockPlayers(challengeId: string, playerIds: string[], ttlMs: number): Promise<{ ok: boolean; reason?: string }> {
    const lockValue = `${challengeId}:${this.ownerServerId}`;
    if (!this.redis) {
      for (const playerId of playerIds) {
        const existing = this.memoryLocks.get(playerId);
        if (existing && existing !== lockValue) {
          return { ok: false, reason: 'player_busy' };
        }
      }
      for (const playerId of playerIds) {
        this.memoryLocks.set(playerId, lockValue);
      }
      return { ok: true };
    }

    const locked: string[] = [];
    for (const playerId of playerIds) {
      const key = playerLockKey(playerId);
      const setResult = await this.redis.set(key, lockValue, { NX: true, PX: ttlMs });
      if (setResult === 'OK') {
        locked.push(key);
        continue;
      }
      const existing = await this.redis.get(key);
      if (existing === lockValue) {
        locked.push(key);
        continue;
      }
      for (const held of locked) {
        await this.redis.del(held);
      }
      return { ok: false, reason: 'player_busy' };
    }
    return { ok: true };
  }

  async releasePlayers(challengeId: string, playerIds: string[]): Promise<void> {
    const lockValue = `${challengeId}:${this.ownerServerId}`;
    if (!this.redis) {
      for (const playerId of playerIds) {
        if (this.memoryLocks.get(playerId) === lockValue) {
          this.memoryLocks.delete(playerId);
        }
      }
      return;
    }
    for (const playerId of playerIds) {
      const key = playerLockKey(playerId);
      const existing = await this.redis.get(key);
      if (existing === lockValue) {
        await this.redis.del(key);
      }
    }
  }
}
