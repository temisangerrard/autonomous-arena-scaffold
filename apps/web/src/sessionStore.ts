import type { IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

export type Role = 'player' | 'admin';

export type IdentityRecord = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  role: Role;
  profileId: string | null;
  walletId: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: number;
  lastLoginAt: number;
};

export type SessionRecord = {
  id: string;
  sub: string;
  expiresAt: number;
};

type PersistedWebState = {
  version: 1;
  savedAt: number;
  identities: IdentityRecord[];
  sessions: SessionRecord[];
};

export type SessionStore = {
  mode: 'memory' | 'redis';
  isReady: () => boolean;
  ping: () => Promise<boolean>;
  getSession: (sid: string) => Promise<SessionRecord | null>;
  setSession: (session: SessionRecord, ttlMs: number) => Promise<void>;
  deleteSession: (sid: string) => Promise<void>;
  getIdentity: (sub: string) => Promise<IdentityRecord | null>;
  setIdentity: (identity: IdentityRecord, ttlMs: number) => Promise<void>;
  addSessionForSub: (sub: string, sid: string, ttlMs: number) => Promise<void>;
  listSessionsForSub: (sub: string) => Promise<string[]>;
  removeSessionForSub: (sub: string, sid: string) => Promise<void>;
  addSubForProfile: (profileId: string, sub: string, ttlMs: number) => Promise<void>;
  listSubsForProfile: (profileId: string) => Promise<string[]>;
  purgeSessionsForProfile: (profileId: string) => Promise<number>;
  persistIfSupported: () => void;
};

const COOKIE_NAME = 'arena_sid';
const SESSION_HEADER = 'x-arena-sid';

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim();
  }
  return String(value ?? '').trim();
}

type RedisLike = {
  on: (event: 'error', listener: (error: unknown) => void) => void;
  connect: () => Promise<unknown>;
  ping: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  sAdd: (key: string, member: string) => Promise<number>;
  sMembers: (key: string) => Promise<string[]>;
  sRem: (key: string, member: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<boolean>;
};

export function cookieSessionId(req: IncomingMessage): string | null {
  const headerSid = firstHeaderValue(req.headers[SESSION_HEADER]);
  if (headerSid) {
    return headerSid;
  }
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === COOKIE_NAME) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

function pruneExpiredSessions(map: Map<string, SessionRecord>): void {
  const now = Date.now();
  for (const [id, session] of map.entries()) {
    if (session.expiresAt <= now) {
      map.delete(id);
    }
  }
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeTtlSeconds(ttlMs: number): number {
  return Math.max(1, Math.floor(Math.max(0, ttlMs) / 1000));
}

class MemoryStore {
  readonly mode = 'memory' as const;
  private readonly identities = new Map<string, IdentityRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionsBySub = new Map<string, Set<string>>();
  private readonly subsByProfile = new Map<string, Set<string>>();
  private persistTimer: NodeJS.Timeout | null = null;
  private ready = true;

  constructor(
    private readonly webStateFile: string
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  load(): void {
    if (!existsSync(this.webStateFile)) {
      return;
    }
    const raw = readFileSync(this.webStateFile, 'utf8');
    const parsed = safeJsonParse<PersistedWebState>(raw);
    if (!parsed || parsed.version !== 1) {
      return;
    }
    for (const identity of parsed.identities ?? []) {
      if (identity?.sub) {
        this.identities.set(identity.sub, identity);
      }
      if (identity?.profileId) {
        this.addSubForProfileSync(identity.profileId, identity.sub);
      }
    }
    for (const session of parsed.sessions ?? []) {
      if (session?.id && session?.sub && typeof session.expiresAt === 'number') {
        this.sessions.set(session.id, session);
        this.addSessionForSubSync(session.sub, session.id);
      }
    }
    pruneExpiredSessions(this.sessions);
  }

  persistIfSupported(): void {
    this.persist();
  }

  private persist(): void {
    try {
      pruneExpiredSessions(this.sessions);
      const payload: PersistedWebState = {
        version: 1,
        savedAt: Date.now(),
        identities: [...this.identities.values()],
        sessions: [...this.sessions.values()]
      };
      mkdirSync(path.dirname(this.webStateFile), { recursive: true });
      writeFileSync(this.webStateFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // ignore persistence failures in scaffold mode
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 250);
  }

  private addSessionForSubSync(sub: string, sid: string): void {
    const set = this.sessionsBySub.get(sub) ?? new Set<string>();
    set.add(sid);
    this.sessionsBySub.set(sub, set);
  }

  private addSubForProfileSync(profileId: string, sub: string): void {
    const set = this.subsByProfile.get(profileId) ?? new Set<string>();
    set.add(sub);
    this.subsByProfile.set(profileId, set);
  }

  async getSession(sid: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(sid) ?? null;
    if (!session) {
      return null;
    }
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sid);
      this.schedulePersist();
      return null;
    }
    return session;
  }

  async setSession(session: SessionRecord, ttlMs: number): Promise<void> {
    void ttlMs;
    this.sessions.set(session.id, session);
    this.addSessionForSubSync(session.sub, session.id);
    this.schedulePersist();
  }

  async deleteSession(sid: string): Promise<void> {
    const existing = this.sessions.get(sid);
    if (!existing) {
      return;
    }
    this.sessions.delete(sid);
    this.sessionsBySub.get(existing.sub)?.delete(sid);
    this.schedulePersist();
  }

  async getIdentity(sub: string): Promise<IdentityRecord | null> {
    return this.identities.get(sub) ?? null;
  }

  async setIdentity(identity: IdentityRecord, ttlMs: number): Promise<void> {
    void ttlMs;
    this.identities.set(identity.sub, identity);
    if (identity.profileId) {
      this.addSubForProfileSync(identity.profileId, identity.sub);
    }
    this.schedulePersist();
  }

  async addSessionForSub(sub: string, sid: string, ttlMs: number): Promise<void> {
    void ttlMs;
    this.addSessionForSubSync(sub, sid);
  }

  async listSessionsForSub(sub: string): Promise<string[]> {
    return [...(this.sessionsBySub.get(sub) ?? new Set<string>())];
  }

  async removeSessionForSub(sub: string, sid: string): Promise<void> {
    this.sessionsBySub.get(sub)?.delete(sid);
  }

  async addSubForProfile(profileId: string, sub: string, ttlMs: number): Promise<void> {
    void ttlMs;
    this.addSubForProfileSync(profileId, sub);
  }

  async listSubsForProfile(profileId: string): Promise<string[]> {
    return [...(this.subsByProfile.get(profileId) ?? new Set<string>())];
  }

  async purgeSessionsForProfile(profileId: string): Promise<number> {
    const subs = this.subsByProfile.get(profileId);
    if (!subs) {
      return 0;
    }
    let deleted = 0;
    for (const sub of subs) {
      for (const sid of await this.listSessionsForSub(sub)) {
        await this.deleteSession(sid);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class RedisStore {
  readonly mode = 'redis' as const;
  private client: RedisLike | null = null;
  private ready = false;

  constructor(private readonly redisUrl: string) {}

  async init(): Promise<void> {
    const mod = await import('redis');
    const client = mod.createClient({ url: this.redisUrl }) as unknown as RedisLike;
    client.on('error', (err) => {
      log.error({ err }, 'web redis error');
      this.ready = false;
    });
    await client.connect();
    this.client = client;
    this.ready = true;
    log.info('web connected to redis');
  }

  isReady(): boolean {
    return this.ready;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private sessKey(sid: string): string {
    return `arena:web:sess:${sid}`;
  }

  private idKey(sub: string): string {
    return `arena:web:id:${sub}`;
  }

  private subSessKey(sub: string): string {
    return `arena:web:subsess:${sub}`;
  }

  private profileSubsKey(profileId: string): string {
    return `arena:web:profileSubs:${profileId}`;
  }

  async getSession(sid: string): Promise<SessionRecord | null> {
    if (!this.client) return null;
    const raw = await this.client.get(this.sessKey(sid));
    if (!raw) return null;
    const parsed = safeJsonParse<SessionRecord>(raw);
    if (!parsed?.id || !parsed.sub || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    if (parsed.expiresAt < Date.now()) {
      await this.deleteSession(sid);
      return null;
    }
    return parsed;
  }

  async setSession(session: SessionRecord, ttlMs: number): Promise<void> {
    if (!this.client) return;
    const ttl = normalizeTtlSeconds(ttlMs);
    await this.client.set(this.sessKey(session.id), JSON.stringify(session), { EX: ttl });
  }

  async deleteSession(sid: string): Promise<void> {
    if (!this.client) return;
    // Best-effort cleanup: remove the stored session. Index cleanup happens via removeSessionForSub.
    await this.client.del(this.sessKey(sid));
  }

  async getIdentity(sub: string): Promise<IdentityRecord | null> {
    if (!this.client) return null;
    const raw = await this.client.get(this.idKey(sub));
    if (!raw) return null;
    const parsed = safeJsonParse<IdentityRecord>(raw);
    if (!parsed?.sub || !parsed.email) {
      return null;
    }
    return parsed;
  }

  async setIdentity(identity: IdentityRecord, ttlMs: number): Promise<void> {
    if (!this.client) return;
    const ttl = normalizeTtlSeconds(ttlMs);
    await this.client.set(this.idKey(identity.sub), JSON.stringify(identity), { EX: ttl });
  }

  async addSessionForSub(sub: string, sid: string, ttlMs: number): Promise<void> {
    if (!this.client) return;
    const ttl = normalizeTtlSeconds(ttlMs);
    const key = this.subSessKey(sub);
    await this.client.sAdd(key, sid);
    await this.client.expire(key, ttl);
  }

  async listSessionsForSub(sub: string): Promise<string[]> {
    if (!this.client) return [];
    const key = this.subSessKey(sub);
    const members = await this.client.sMembers(key);
    return Array.isArray(members) ? members : [];
  }

  async removeSessionForSub(sub: string, sid: string): Promise<void> {
    if (!this.client) return;
    await this.client.sRem(this.subSessKey(sub), sid);
  }

  async addSubForProfile(profileId: string, sub: string, ttlMs: number): Promise<void> {
    if (!this.client) return;
    const ttl = normalizeTtlSeconds(ttlMs);
    const key = this.profileSubsKey(profileId);
    await this.client.sAdd(key, sub);
    await this.client.expire(key, ttl);
  }

  async listSubsForProfile(profileId: string): Promise<string[]> {
    if (!this.client) return [];
    const members = await this.client.sMembers(this.profileSubsKey(profileId));
    return Array.isArray(members) ? members : [];
  }

  async purgeSessionsForProfile(profileId: string): Promise<number> {
    if (!this.client) return 0;
    const subs = await this.listSubsForProfile(profileId);
    let deleted = 0;
    for (const sub of subs) {
      const sids = await this.listSessionsForSub(sub);
      for (const sid of sids) {
        await this.deleteSession(sid);
        await this.removeSessionForSub(sub, sid);
        deleted += 1;
      }
    }
    return deleted;
  }

  persistIfSupported(): void {
    // Redis is already durable; no-op.
  }
}

export async function createSessionStore(params: {
  redisUrl: string;
  isProduction: boolean;
  webStateFile: string;
}): Promise<SessionStore> {
  const redisUrl = params.redisUrl.trim();
  if (params.isProduction && !redisUrl) {
    throw new Error('REDIS_URL is required in production for web session persistence');
  }

  if (redisUrl) {
    const store = new RedisStore(redisUrl);
    await store.init();
    return store;
  }

  const store = new MemoryStore(params.webStateFile);
  store.load();
  return store;
}
