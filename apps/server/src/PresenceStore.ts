type PresenceEntry = {
  playerId: string;
  role: 'human' | 'agent';
  displayName: string;
  walletId: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  updatedAt: number;
  serverId: string;
};

type RedisLike = {
  hSet: (key: string, values: Record<string, string>) => Promise<number>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  del: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<boolean>;
  keys: (pattern: string) => Promise<string[]>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  connect: () => Promise<unknown>;
  on: (event: 'error', cb: (error: unknown) => void) => void;
};

const PRESENCE_KEY_PREFIX = 'arena:presence:';
const SERVER_KEY_PREFIX = 'arena:server:';

function keyFor(playerId: string): string {
  return `${PRESENCE_KEY_PREFIX}${playerId}`;
}

function toNumber(value: string | undefined, fallback = 0): number {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePresence(hash: Record<string, string>): PresenceEntry | null {
  if (!hash.playerId) {
    return null;
  }
  return {
    playerId: hash.playerId,
    role: hash.role === 'agent' ? 'agent' : 'human',
    displayName: hash.displayName || hash.playerId,
    walletId: hash.walletId || null,
    x: toNumber(hash.x),
    y: toNumber(hash.y),
    z: toNumber(hash.z),
    yaw: toNumber(hash.yaw),
    speed: toNumber(hash.speed),
    updatedAt: toNumber(hash.updatedAt),
    serverId: hash.serverId || 'unknown'
  };
}

export class PresenceStore {
  private readonly memory = new Map<string, PresenceEntry>();
  private redis: RedisLike | null = null;

  constructor(
    private readonly serverId: string,
    private readonly ttlSeconds: number
  ) {}

  private serverKey(serverId: string): string {
    return `${SERVER_KEY_PREFIX}${serverId}`;
  }

  async connect(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      return;
    }
    const mod = await import('redis');
    const client = mod.createClient({ url: redisUrl }) as unknown as RedisLike;
    client.on('error', (error) => {
      console.error('presence redis error', error);
    });
    await client.connect();
    this.redis = client;
    console.log('presence store connected to redis');
  }

  async upsert(entry: Omit<PresenceEntry, 'updatedAt' | 'serverId'>): Promise<void> {
    const full: PresenceEntry = {
      ...entry,
      updatedAt: Date.now(),
      serverId: this.serverId
    };
    this.memory.set(entry.playerId, full);
    if (!this.redis) {
      return;
    }
    const key = keyFor(entry.playerId);
    await this.redis.hSet(key, {
      playerId: full.playerId,
      role: full.role,
      displayName: full.displayName,
      walletId: full.walletId ?? '',
      x: String(full.x),
      y: String(full.y),
      z: String(full.z),
      yaw: String(full.yaw),
      speed: String(full.speed),
      updatedAt: String(full.updatedAt),
      serverId: full.serverId
    });
    await this.redis.expire(key, this.ttlSeconds);
  }

  async remove(playerId: string): Promise<void> {
    this.memory.delete(playerId);
    if (!this.redis) {
      return;
    }
    await this.redis.del(keyFor(playerId));
  }

  async get(playerId: string): Promise<PresenceEntry | null> {
    const cached = this.memory.get(playerId);
    if (cached) {
      return cached;
    }
    if (!this.redis) {
      return null;
    }
    const hash = await this.redis.hGetAll(keyFor(playerId));
    const parsed = parsePresence(hash);
    if (parsed) {
      this.memory.set(playerId, parsed);
    }
    return parsed;
  }

  async list(): Promise<PresenceEntry[]> {
    if (!this.redis) {
      return [...this.memory.values()];
    }
    const keys = await this.redis.keys(`${PRESENCE_KEY_PREFIX}*`);
    if (keys.length === 0) {
      return [];
    }
    const entries = await Promise.all(keys.map(async (key) => parsePresence(await this.redis!.hGetAll(key))));
    return entries.filter((entry): entry is PresenceEntry => Boolean(entry));
  }

  async heartbeatServer(): Promise<void> {
    if (!this.redis) {
      return;
    }
    const payload = JSON.stringify({ serverId: this.serverId, at: Date.now() });
    await this.redis.set(this.serverKey(this.serverId), payload, { EX: this.ttlSeconds });
  }

  async liveServers(): Promise<string[]> {
    if (!this.redis) {
      return [this.serverId];
    }
    const keys = await this.redis.keys(`${SERVER_KEY_PREFIX}*`);
    const servers = keys.map((key) => key.slice(SERVER_KEY_PREFIX.length)).filter(Boolean);
    return servers;
  }
}
