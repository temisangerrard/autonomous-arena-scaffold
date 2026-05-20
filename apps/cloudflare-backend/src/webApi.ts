import { buildPlayerShell } from '../../../apps/web/src/playerShell.js';
import { handleRuntimeRequest } from './runtimeState.js';

type D1First<T = Record<string, unknown>> = Promise<T | null>;
type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => D1First<T>;
  run: () => Promise<unknown>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
};
type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
};

type IdentityRecord = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  role: 'player' | 'admin';
  profileId: string | null;
  walletId: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: number;
  lastLoginAt: number;
};

type SessionRecord = {
  id: string;
  sub: string;
  expiresAt: number;
};

type PlayerProfile = {
  id: string;
  username: string;
  displayName: string;
  walletId: string;
  ownedBotIds: string[];
  wallet?: {
    id: string;
    address?: string;
    balance: number;
  };
};

type RuntimeStatusPayload = {
  bots?: Array<{
    id: string;
    connected?: boolean;
    walletId?: string | null;
    walletAddress?: string | null;
    behavior: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }>;
  wallets?: Array<{ id: string; ownerProfileId?: string | null; address?: string; balance?: number }>;
  superAgent?: Record<string, unknown> | null;
};

export type WebApiEnv = {
  STATE_DB?: D1DatabaseLike;
  SERVER_UPSTREAM?: string;
  INTERNAL_SERVICE_TOKEN?: string;
  FIREBASE_WEB_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  CDP_PROJECT_ID?: string;
  FIREBASE_GOOGLE_AUTH_ENABLED?: string;
  FIREBASE_CLIENT_AUTH_ENABLED?: string;
  EMAIL_AUTH_ENABLED?: string;
  GOOGLE_AUTH_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  LOCAL_AUTH_ENABLED?: string;
  REALTIME_ENABLED?: string;
  PUBLIC_GAME_WS_URL?: string;
  PUBLIC_WORLD_ASSET_BASE_URL?: string;
  DEFAULT_WORLD_ASSET_BASE_URL?: string;
  GAME_WS_AUTH_SECRET?: string;
  ALLOWED_AUTH_ORIGINS?: string;
  ADMIN_EMAILS?: string;
  COOKIE_NAME?: string;
};

const WEB_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS web_identities (
    sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT NOT NULL,
    role TEXT NOT NULL,
    profile_id TEXT,
    wallet_id TEXT,
    username TEXT,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    session_id TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_web_sessions_sub ON web_sessions(sub)`,
  `CREATE INDEX IF NOT EXISTS idx_web_identities_email ON web_identities(email)`,
];

let webSchemaReady: Promise<void> | null = null;

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers || {}),
    },
  });
}

function asNum(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return new Uint8Array(signature);
}

async function wsAuthForIdentity(env: WebApiEnv, identity: IdentityRecord): Promise<string | null> {
  const secret = String(env.GAME_WS_AUTH_SECRET || '').trim();
  if (!secret || !identity.profileId || !identity.walletId) return null;
  const now = Date.now();
  const payload = {
    v: 1,
    role: 'human',
    clientId: identity.profileId,
    walletId: identity.walletId,
    iat: now,
    exp: now + 1000 * 60,
  };
  const payloadB64 = base64UrlEncodeText(JSON.stringify(payload));
  const sigB64 = base64UrlEncode(await hmacSha256(secret, payloadB64));
  return `${payloadB64}.${sigB64}`;
}

function publicGameWsUrl(env: WebApiEnv): string {
  const explicit = String(env.PUBLIC_GAME_WS_URL || '').trim();
  if (explicit) return explicit;
  const serverOrigin = normalizeOrigin(env.SERVER_UPSTREAM);
  if (!serverOrigin) return '';
  if (serverOrigin.startsWith('https://')) return `wss://${serverOrigin.slice('https://'.length)}/ws`;
  if (serverOrigin.startsWith('http://')) return `ws://${serverOrigin.slice('http://'.length)}/ws`;
  return '';
}

function normalizeOrigin(value: string | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function cookieName(env: WebApiEnv): string {
  return String(env.COOKIE_NAME || 'arena_sid').trim() || 'arena_sid';
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function parseCookie(request: Request, key: string): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const current = part.slice(0, idx).trim();
    if (current !== key) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function sessionCookieHeader(env: WebApiEnv, sid: string, ttlMs: number, request: Request): string {
  return `${cookieName(env)}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax${secureRequest(request) ? '; Secure' : ''}; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

function clearSessionCookieHeader(env: WebApiEnv): string {
  return `${cookieName(env)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function allowedOrigins(env: WebApiEnv): Set<string> {
  const configured = String(env.ALLOWED_AUTH_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    'https://autobett.xyz',
    'https://www.autobett.xyz',
    'https://autobett.netlify.app',
    'https://www.autobett.netlify.app',
    ...configured,
  ]);
}

function isSameOriginRequest(request: Request, env: WebApiEnv): boolean {
  const host = String(request.headers.get('host') || '').trim().toLowerCase();
  if (!host) return false;
  const expected = `${new URL(request.url).protocol}//${host}`.toLowerCase();
  const origin = String(request.headers.get('origin') || '').trim();
  const referer = String(request.headers.get('referer') || '').trim();
  const candidates = [origin, referer].filter(Boolean);
  if (candidates.length === 0) {
    return true;
  }
  const allowed = allowedOrigins(env);
  for (const value of candidates) {
    try {
      const parsed = new URL(value);
      const normalized = parsed.origin.toLowerCase();
      if (normalized !== expected && !allowed.has(normalized)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function ensureWebSchema(db: D1DatabaseLike | undefined): Promise<void> {
  if (!db) return;
  if (!webSchemaReady) {
    webSchemaReady = (async () => {
      for (const statement of WEB_MIGRATIONS) {
        await db.prepare(statement).run();
      }
    })();
  }
  await webSchemaReady;
}

async function all<T>(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return Array.isArray(result.results) ? result.results : [];
}

async function first<T>(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

async function run(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<void> {
  await db.prepare(sql).bind(...values).run();
}

function randomHex(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(raw).map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

function sanitizeUser(identity: IdentityRecord): Record<string, unknown> {
  return {
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    role: identity.role,
    profileId: identity.profileId,
    walletId: identity.walletId,
    username: identity.username,
    displayName: identity.displayName,
  };
}

function resolveAuthSubjects(params: { provider: 'firebase' | 'google'; firebaseLocalId?: string | null; googleSub?: string | null }) {
  const firebaseLocalId = String(params.firebaseLocalId || '').trim();
  const googleSub = String(params.googleSub || '').trim();
  if (params.provider === 'firebase') {
    if (!firebaseLocalId) throw new Error('firebase_local_id_required');
    return { canonical: `firebase:${firebaseLocalId}`, aliases: [`firebase:${firebaseLocalId}`] };
  }
  if (firebaseLocalId) {
    const aliases = [`firebase:${firebaseLocalId}`];
    if (googleSub) aliases.push(`google:${googleSub}`);
    return { canonical: aliases[0]!, aliases: [...new Set(aliases)] };
  }
  if (!googleSub) throw new Error('google_sub_required');
  return { canonical: `google:${googleSub}`, aliases: [`google:${googleSub}`] };
}

function mapFirebaseAuthError(message: string): { reason: string; status: number } {
  const normalized = String(message || '').trim().toUpperCase();
  if (!normalized) return { reason: 'firebase_auth_failed', status: 502 };
  if (normalized === 'EMAIL_EXISTS') return { reason: 'email_exists', status: 409 };
  if (normalized === 'EMAIL_NOT_FOUND' || normalized === 'INVALID_PASSWORD' || normalized === 'INVALID_LOGIN_CREDENTIALS') {
    return { reason: 'invalid_credentials', status: 401 };
  }
  if (normalized === 'USER_DISABLED') return { reason: 'user_disabled', status: 403 };
  if (normalized === 'TOO_MANY_ATTEMPTS_TRY_LATER') return { reason: 'too_many_attempts', status: 429 };
  if (normalized.startsWith('WEAK_PASSWORD')) return { reason: 'weak_password', status: 400 };
  if (normalized === 'INVALID_EMAIL') return { reason: 'invalid_email', status: 400 };
  if (normalized === 'OPERATION_NOT_ALLOWED') return { reason: 'email_auth_disabled', status: 403 };
  return { reason: `firebase_${normalized.toLowerCase()}`, status: 502 };
}

async function firebaseIdentityAuth(env: WebApiEnv, mode: 'signup' | 'login', email: string, password: string) {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey) return { ok: false as const, reason: 'email_auth_disabled', status: 403 };
  const endpoint = mode === 'signup' ? 'accounts:signUp' : 'accounts:signInWithPassword';
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const mapped = mapFirebaseAuthError(String((payload.error as Record<string, unknown> | undefined)?.message || ''));
      return { ok: false as const, reason: mapped.reason, status: mapped.status };
    }
    const localId = String(payload.localId || '').trim();
    const normalizedEmail = String(payload.email || email || '').trim().toLowerCase();
    if (!localId || !normalizedEmail) return { ok: false as const, reason: 'firebase_invalid_payload', status: 502 };
    return {
      ok: true as const,
      result: {
        localId,
        email: normalizedEmail,
        displayName: String(payload.displayName || '').trim() || undefined,
      },
    };
  } catch {
    return { ok: false as const, reason: 'firebase_unreachable', status: 503 };
  }
}

async function firebaseLookupIdToken(env: WebApiEnv, idToken: string) {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey) return { ok: false as const, reason: 'email_auth_disabled', status: 403 };
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const mapped = mapFirebaseAuthError(String((payload.error as Record<string, unknown> | undefined)?.message || ''));
      return { ok: false as const, reason: mapped.reason, status: mapped.status };
    }
    const user = Array.isArray(payload.users) ? payload.users[0] as Record<string, unknown> : null;
    const localId = String(user?.localId || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!localId || !email) return { ok: false as const, reason: 'firebase_invalid_payload', status: 502 };
    return {
      ok: true as const,
      result: {
        localId,
        email,
        displayName: String(user?.displayName || '').trim() || undefined,
        picture: String(user?.photoUrl || '').trim() || undefined,
        emailVerified: String(user?.emailVerified ?? '').toLowerCase() === 'true',
      },
    };
  } catch {
    return { ok: false as const, reason: 'firebase_unreachable', status: 503 };
  }
}

async function runtimeFetch<T>(request: Request, env: WebApiEnv, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const origin = normalizeOrigin(new URL(request.url).origin);
  const url = `${origin}/runtime${path}`;
  const internalRequest = new Request(url, {
    method: init?.method || 'GET',
    headers: {
      ...(env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-token': env.INTERNAL_SERVICE_TOKEN } : {}),
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const response = await handleRuntimeRequest(internalRequest, env as any, new URL(url).pathname);
  if (!response) throw new Error('runtime_not_found');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload == null) {
    throw new Error(`runtime_${response.status}`);
  }
  return payload as T;
}

async function serverFetch<T>(env: WebApiEnv, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const origin = normalizeOrigin(env.SERVER_UPSTREAM);
  if (!origin) throw new Error('server_unconfigured');
  const response = await fetch(`${origin}${path}`, {
    method: init?.method || 'GET',
    headers: {
      ...(env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-token': env.INTERNAL_SERVICE_TOKEN } : {}),
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload == null) {
    throw new Error(`server_${response.status}`);
  }
  return payload as T;
}

async function getSession(db: D1DatabaseLike, request: Request, env: WebApiEnv): Promise<SessionRecord | null> {
  const sid = parseCookie(request, cookieName(env));
  if (!sid) return null;
  const row = await first<Record<string, unknown>>(db, 'SELECT session_id, sub, expires_at FROM web_sessions WHERE session_id = ?', [sid]);
  if (!row) return null;
  const expiresAt = asNum(row.expires_at);
  if (expiresAt <= Date.now()) {
    await run(db, 'DELETE FROM web_sessions WHERE session_id = ?', [sid]);
    return null;
  }
  return { id: asStr(row.session_id), sub: asStr(row.sub), expiresAt };
}

async function getIdentityBySub(db: D1DatabaseLike, sub: string): Promise<IdentityRecord | null> {
  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM web_identities WHERE sub = ?', [sub]);
  if (!row) return null;
  return {
    sub: asStr(row.sub),
    email: asStr(row.email),
    name: asStr(row.name),
    picture: asStr(row.picture),
    role: asStr(row.role) === 'admin' ? 'admin' : 'player',
    profileId: asStr(row.profile_id) || null,
    walletId: asStr(row.wallet_id) || null,
    username: asStr(row.username) || null,
    displayName: asStr(row.display_name) || null,
    createdAt: asNum(row.created_at),
    lastLoginAt: asNum(row.last_login_at),
  };
}

async function setIdentity(db: D1DatabaseLike, identity: IdentityRecord): Promise<void> {
  await run(
    db,
    `INSERT OR REPLACE INTO web_identities (
      sub, email, name, picture, role, profile_id, wallet_id, username, display_name, created_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      identity.sub, identity.email, identity.name, identity.picture, identity.role,
      identity.profileId, identity.walletId, identity.username, identity.displayName,
      identity.createdAt, identity.lastLoginAt,
    ],
  );
}

async function setSession(db: D1DatabaseLike, session: SessionRecord): Promise<void> {
  await run(db, 'INSERT OR REPLACE INTO web_sessions (session_id, sub, expires_at) VALUES (?, ?, ?)', [session.id, session.sub, session.expiresAt]);
}

async function deleteSession(db: D1DatabaseLike, sessionId: string): Promise<void> {
  await run(db, 'DELETE FROM web_sessions WHERE session_id = ?', [sessionId]);
}

async function findIdentitiesByEmail(db: D1DatabaseLike, email: string): Promise<IdentityRecord[]> {
  const rows = await all<Record<string, unknown>>(db, 'SELECT * FROM web_identities WHERE lower(email) = lower(?)', [email]);
  return rows.map((row) => ({
    sub: asStr(row.sub),
    email: asStr(row.email),
    name: asStr(row.name),
    picture: asStr(row.picture),
    role: asStr(row.role) === 'admin' ? 'admin' : 'player',
    profileId: asStr(row.profile_id) || null,
    walletId: asStr(row.wallet_id) || null,
    username: asStr(row.username) || null,
    displayName: asStr(row.display_name) || null,
    createdAt: asNum(row.created_at),
    lastLoginAt: asNum(row.last_login_at),
  }));
}

async function findIdentitiesByProfileId(db: D1DatabaseLike, profileId: string): Promise<IdentityRecord[]> {
  const rows = await all<Record<string, unknown>>(db, 'SELECT * FROM web_identities WHERE profile_id = ?', [profileId]);
  return rows.map((row) => ({
    sub: asStr(row.sub),
    email: asStr(row.email),
    name: asStr(row.name),
    picture: asStr(row.picture),
    role: asStr(row.role) === 'admin' ? 'admin' : 'player',
    profileId: asStr(row.profile_id) || null,
    walletId: asStr(row.wallet_id) || null,
    username: asStr(row.username) || null,
    displayName: asStr(row.display_name) || null,
    createdAt: asNum(row.created_at),
    lastLoginAt: asNum(row.last_login_at),
  }));
}

async function getIdentityFromReq(db: D1DatabaseLike, request: Request, env: WebApiEnv): Promise<IdentityRecord | null> {
  const session = await getSession(db, request, env);
  if (!session) return null;
  return getIdentityBySub(db, session.sub);
}

async function purgeSessionsForProfile(db: D1DatabaseLike, profileId: string): Promise<number> {
  const identities = await findIdentitiesByProfileId(db, profileId);
  const subs = [...new Set(identities.map((entry) => entry.sub).filter(Boolean))];
  if (subs.length === 0) return 0;
  let total = 0;
  for (const sub of subs) {
    const sessions = await all<Record<string, unknown>>(db, 'SELECT session_id FROM web_sessions WHERE sub = ?', [sub]);
    total += sessions.length;
    await run(db, 'DELETE FROM web_sessions WHERE sub = ?', [sub]);
  }
  return total;
}

function maskSubject(subject: string | null | undefined): string | null {
  const value = String(subject || '').trim();
  if (!value) return null;
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function runtimeSubjectLink(request: Request, env: WebApiEnv, subject: string) {
  if (!subject) return null;
  const payload = await runtimeFetch<{ ok?: boolean; link?: Record<string, unknown> }>(request, env, `/profiles/link?subject=${encodeURIComponent(subject)}`).catch(() => null);
  if (!payload?.ok || !payload.link?.profileId || !payload.link?.walletId) return null;
  return {
    profileId: String(payload.link.profileId),
    walletId: String(payload.link.walletId),
    linkedAt: Number(payload.link.linkedAt || 0),
    updatedAt: Number(payload.link.updatedAt || 0),
    continuitySource: String(payload.link.continuitySource || 'unknown'),
  };
}

async function upsertIdentitySubjectAliases(request: Request, env: WebApiEnv, identity: IdentityRecord, subjects: string[]): Promise<void> {
  if (!identity.profileId || !identity.walletId) return;
  for (const subject of [...new Set(subjects.map((entry) => String(entry || '').trim()).filter(Boolean))]) {
    await runtimeFetch(request, env, '/profiles/link', {
      method: 'POST',
      body: { subject, profileId: identity.profileId, walletId: identity.walletId },
    }).catch(() => null);
  }
}

function externalSubjectFromIdentity(identity: IdentityRecord): string {
  return identity.sub.includes(':') ? identity.sub : `google:${identity.sub}`;
}

function preferEmailIdentityOverContinuity(params: { continuity: { profileId: string; walletId: string; continuitySource?: string } | null; emailIdentities: IdentityRecord[] }) {
  const emailIdentity = params.emailIdentities.find((entry) => entry.profileId && entry.walletId) || null;
  if (emailIdentity?.profileId && emailIdentity?.walletId) {
    return {
      profileId: emailIdentity.profileId,
      walletId: emailIdentity.walletId,
      username: emailIdentity.username,
      displayName: emailIdentity.displayName,
      source: 'email' as const,
    };
  }
  if (params.continuity?.profileId && params.continuity?.walletId) {
    return {
      profileId: params.continuity.profileId,
      walletId: params.continuity.walletId,
      username: null,
      displayName: null,
      source: 'continuity' as const,
    };
  }
  return null;
}

async function ensurePlayerProvisioned(db: D1DatabaseLike, request: Request, env: WebApiEnv, identity: IdentityRecord, subjectAliases: string[] = []): Promise<void> {
  const continuitySubject = externalSubjectFromIdentity(identity);
  const continuity = await runtimeSubjectLink(request, env, continuitySubject).catch(() => null);
  const preferred = preferEmailIdentityOverContinuity({
    continuity,
    emailIdentities: await findIdentitiesByEmail(db, identity.email).catch(() => []),
  });
  if (preferred?.profileId && preferred?.walletId) {
    identity.profileId = preferred.profileId;
    identity.walletId = preferred.walletId;
    identity.username = preferred.username ?? identity.username;
    identity.displayName = preferred.displayName ?? identity.displayName;
    if (preferred.source === 'email') {
      await upsertIdentitySubjectAliases(request, env, identity, [continuitySubject, ...subjectAliases]);
    }
    return;
  }
  const created = await runtimeFetch<any>(request, env, '/profiles/provision', {
    method: 'POST',
    body: {
      externalSubject: continuitySubject,
      email: identity.email,
      displayName: identity.name,
      personality: 'social',
      targetPreference: 'human_first',
    },
  });
  if (!created?.profile) throw new Error(created?.reason || 'provision_failed');
  identity.profileId = String(created.profile.id || '');
  identity.walletId = String(created.wallet?.id || created.profile.walletId || '');
  identity.username = String(created.profile.username || '') || null;
  identity.displayName = String(created.profile.displayName || '') || null;
}

async function requireRole(db: D1DatabaseLike, request: Request, env: WebApiEnv, roles: Array<'player' | 'admin'>) {
  const identity = await getIdentityFromReq(db, request, env);
  if (!identity || !roles.includes(identity.role)) return { ok: false as const };
  return { ok: true as const, identity };
}

async function loadPlayerWalletSummary(request: Request, env: WebApiEnv, identity: IdentityRecord) {
  if (!identity.walletId) return null;
  return runtimeFetch<any>(request, env, `/wallets/${identity.walletId}/summary`).catch(() => null);
}

async function loadPlayerRuntimeBotContext(request: Request, env: WebApiEnv, identity: IdentityRecord, profile: PlayerProfile) {
  const runtimeStatus = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => ({ bots: [], wallets: [] }));
  const ownerWalletId = profile.wallet?.id ?? profile.walletId;
  const ownerWalletAddress = profile.wallet?.address
    ?? (runtimeStatus.wallets ?? []).find((wallet) => wallet?.id === ownerWalletId)?.address
    ?? '';
  const bots = (runtimeStatus.bots ?? [])
    .filter((bot) => bot.meta?.ownerProfileId === identity.profileId)
    .map((bot) => ({ ...bot, walletId: ownerWalletId, walletAddress: ownerWalletAddress || undefined }));
  return { runtimeStatus, ownerWalletId, ownerWalletAddress, bots, ownerBot: bots[0] ?? null };
}

function candidatePlayerIds(profileId: string): string[] {
  if (!profileId) return [];
  return profileId.startsWith('u_') ? [profileId, profileId.slice(2)].filter(Boolean) : [profileId, `u_${profileId}`];
}

async function loadPlayerActivity(request: Request, env: WebApiEnv, identity: IdentityRecord, limit = 30) {
  if (!identity.profileId || !identity.walletId) return { ok: false, activity: [] };
  let escrow: { recent?: Array<Record<string, unknown>> } = { recent: [] };
  for (const pid of candidatePlayerIds(identity.profileId)) {
    escrow = await serverFetch<any>(env, `/escrow/events/recent?playerId=${encodeURIComponent(pid)}&limit=${limit}`).catch(() => ({ recent: [] }));
    if (Array.isArray(escrow.recent) && escrow.recent.length > 0) break;
  }
  const onchain = await runtimeFetch<any>(request, env, `/wallets/${encodeURIComponent(identity.walletId)}/activity?limit=${limit}`).catch(() => ({ recent: [], tokenSymbol: 'TOKEN' }));
  let marketPositions: { recent?: any[] } = { recent: [] };
  for (const pid of candidatePlayerIds(identity.profileId)) {
    marketPositions = await serverFetch<any>(env, `/markets/player/positions?playerId=${encodeURIComponent(pid)}&limit=${limit}`).catch(() => ({ recent: [] }));
    if (Array.isArray(marketPositions.recent) && marketPositions.recent.length > 0) break;
  }
  const activity = [
    ...(Array.isArray(escrow.recent) ? escrow.recent : []).map((entry) => ({ ...entry, kind: 'escrow', at: Number(entry.at || Date.now()) })),
    ...(Array.isArray(onchain.recent) ? onchain.recent : []).map((entry: any) => ({ ...entry, kind: 'onchain_transfer', at: Number(entry.timestampMs || Date.now()), tokenSymbol: onchain.tokenSymbol || 'TOKEN' })),
    ...(Array.isArray(marketPositions.recent) ? marketPositions.recent : []).map((entry: any) => ({ ...entry, kind: 'market_position', at: Number(entry.settledAt || entry.createdAt || Date.now()) })),
  ].sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, limit);
  return { ok: true, chainId: Number(onchain.chainId || NaN) || null, walletAddress: String(onchain.address || ''), activity };
}

async function runtimeProfiles(request: Request, env: WebApiEnv): Promise<PlayerProfile[]> {
  const payload = await runtimeFetch<{ profiles: PlayerProfile[] }>(request, env, '/profiles');
  return payload.profiles || [];
}

function authConfigPayload(env: WebApiEnv) {
  const firebaseWebApiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  const firebaseAuthDomain = String(env.FIREBASE_AUTH_DOMAIN || '').trim();
  return {
    authEnabled: Boolean(firebaseWebApiKey || firebaseAuthDomain),
    emailAuthEnabled: true,
    googleAuthEnabled: false,
    googleClientId: '',
    firebaseGoogleAuthEnabled: true,
    firebaseClientAuthEnabled: true,
    firebaseWebApiKey,
    firebaseAuthDomain,
    firebaseProjectId: String(env.FIREBASE_PROJECT_ID || '').trim(),
    cdpProjectId: String(env.CDP_PROJECT_ID || '').trim(),
    localAuthEnabled: false,
    realtimeEnabled: String(env.REALTIME_ENABLED || 'false').toLowerCase() === 'true',
    gameWsUrl: publicGameWsUrl(env),
    worldAssetBaseUrl: String(env.PUBLIC_WORLD_ASSET_BASE_URL || env.DEFAULT_WORLD_ASSET_BASE_URL || '').trim(),
    escrowApprovalPolicy: {
      chainId: null,
      chainHint: 'https://base-rpc.publicnode.com',
      modeSepolia: 'auto',
      modeMainnet: 'manual',
      defaultMode: 'manual',
      autoApproveMaxWager: null,
      autoApproveDailyCap: null,
      effective: { mode: 'manual', network: 'unknown', reason: 'fallback:default_mode', autoApproveMaxWager: null, autoApproveDailyCap: null },
    },
  };
}

export async function handleWebApi(request: Request, env: WebApiEnv, pathname: string): Promise<Response | null> {
  const db = env.STATE_DB;
  if (!db) return null;
  await ensureWebSchema(db);
  const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

  if (pathname === '/api/config') {
    return json(authConfigPayload(env));
  }

  if (pathname === '/api/worlds') {
    return json({
      canonicalAlias: 'mega',
      compatibilityAliases: ['train_world', 'train-world', 'base', 'plaza', 'world'],
      aliases: ['mega', 'train_world', 'train-world', 'base', 'plaza', 'world'],
      filenameByAlias: { mega: 'mega-world.glb', base: 'mega-world.glb', plaza: 'mega-world.glb', world: 'mega-world.glb' },
      versionByAlias: { mega: 'current' },
      bundlesByAlias: {},
    });
  }

  if (pathname === '/api/health') {
    const runtimeStatus = await runtimeFetch<Record<string, unknown>>(request, env, '/status').catch(() => null);
    return json({
      ok: Boolean(runtimeStatus),
      backend: 'cloudflare-worker-web-api',
      runtime: runtimeStatus ? 'worker:d1-runtime' : 'unavailable',
      serverUpstream: normalizeOrigin(env.SERVER_UPSTREAM) || null,
    }, runtimeStatus ? 200 : 503);
  }

  if (pathname === '/api/session') {
    const identity = await getIdentityFromReq(db, request, env);
    const optional = String(new URL(request.url).searchParams.get('optional') || '').trim().toLowerCase();
    if (!identity) {
      return optional === '1' || optional === 'true'
        ? json({ ok: false, user: null, reason: 'unauthorized' })
        : json({ ok: false, reason: 'unauthorized' }, 401);
    }
    return json({ ok: true, user: sanitizeUser(identity) });
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    const identity = await getIdentityFromReq(db, request, env).catch(() => null);
    if (identity?.profileId) {
      await runtimeFetch(request, env, `/owners/${identity.profileId}/presence`, { method: 'POST', body: { state: 'offline' } }).catch(() => null);
    }
    const sid = parseCookie(request, cookieName(env));
    if (sid) await deleteSession(db, sid);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader(env) });
  }

  if (pathname === '/api/auth/email' && request.method === 'POST') {
    if (!isSameOriginRequest(request, env)) return json({ ok: false, reason: 'origin_mismatch' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '').trim();
    const mode = String(body?.mode || '').trim().toLowerCase();
    const requestedName = String(body?.name || '').trim();
    if (!email || !password || (mode !== 'signup' && mode !== 'login')) {
      return json({ ok: false, reason: 'email_credentials_required' }, 400);
    }
    const authResult = await firebaseIdentityAuth(env, mode === 'signup' ? 'signup' : 'login', email, password);
    if (!authResult.ok) return json({ ok: false, reason: authResult.reason }, authResult.status);
    const token = authResult.result;
    const now = Date.now();
    const subjects = resolveAuthSubjects({ provider: 'firebase', firebaseLocalId: token.localId });
    const sub = subjects.canonical;
    const admins = new Set(String(env.ADMIN_EMAILS || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const existing = await getIdentityBySub(db, sub);
    const identity: IdentityRecord = existing ?? {
      sub,
      email: token.email,
      name: requestedName || token.displayName || token.email.split('@')[0] || 'Player',
      picture: '',
      role: admins.has(token.email) ? 'admin' : 'player',
      profileId: null,
      walletId: null,
      username: null,
      displayName: null,
      createdAt: now,
      lastLoginAt: now,
    };
    identity.email = token.email;
    identity.name = mode === 'signup' && requestedName ? requestedName : (identity.name || token.displayName || token.email.split('@')[0] || 'Player');
    identity.role = admins.has(token.email) ? 'admin' : 'player';
    identity.lastLoginAt = now;
    try {
      await ensurePlayerProvisioned(db, request, env, identity, subjects.aliases);
    } catch {
      return json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    await upsertIdentitySubjectAliases(request, env, identity, subjects.aliases);
    await setIdentity(db, identity);
    const sid = randomHex(24);
    await setSession(db, { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs });
    return json({ ok: true, user: sanitizeUser(identity), redirectTo: '/dashboard' }, 200, { 'set-cookie': sessionCookieHeader(env, sid, sessionTtlMs, request) });
  }

  if (pathname === '/api/auth/firebase' && request.method === 'POST') {
    if (!isSameOriginRequest(request, env)) return json({ ok: false, reason: 'origin_mismatch' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const idToken = String(body?.idToken || '').trim();
    if (!idToken) return json({ ok: false, reason: 'id_token_required' }, 400);
    const lookup = await firebaseLookupIdToken(env, idToken);
    if (!lookup.ok) return json({ ok: false, reason: lookup.reason }, lookup.status);
    if (!lookup.result.emailVerified) return json({ ok: false, reason: 'email_not_verified' }, 401);
    const token = lookup.result;
    const now = Date.now();
    const subjects = resolveAuthSubjects({ provider: 'firebase', firebaseLocalId: token.localId });
    const sub = subjects.canonical;
    const admins = new Set(String(env.ADMIN_EMAILS || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const existing = await getIdentityBySub(db, sub);
    const identity: IdentityRecord = existing ?? {
      sub,
      email: token.email,
      name: token.displayName || token.email.split('@')[0] || 'Player',
      picture: token.picture || '',
      role: admins.has(token.email) ? 'admin' : 'player',
      profileId: null,
      walletId: null,
      username: null,
      displayName: null,
      createdAt: now,
      lastLoginAt: now,
    };
    identity.email = token.email;
    identity.name = token.displayName || identity.name;
    identity.picture = token.picture || identity.picture;
    identity.role = admins.has(token.email) ? 'admin' : 'player';
    identity.lastLoginAt = now;
    try {
      await ensurePlayerProvisioned(db, request, env, identity, subjects.aliases);
    } catch {
      return json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    await upsertIdentitySubjectAliases(request, env, identity, subjects.aliases);
    await setIdentity(db, identity);
    const sid = randomHex(24);
    await setSession(db, { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs });
    return json({ ok: true, user: sanitizeUser(identity), redirectTo: '/dashboard' }, 200, { 'set-cookie': sessionCookieHeader(env, sid, sessionTtlMs, request) });
  }

  if (pathname === '/api/auth/google' && request.method === 'POST') {
    return json({ ok: false, reason: 'google_auth_disabled' }, 403);
  }

  if (pathname === '/api/auth/local' && request.method === 'POST') {
    return json({ ok: false, reason: 'local_auth_disabled' }, 403);
  }

  if (pathname === '/api/player/me') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    const optional = String(new URL(request.url).searchParams.get('optional') || '').trim().toLowerCase();
    if (!auth.ok) {
      return optional === '1' || optional === 'true'
        ? json({ ok: false, user: null, reason: 'unauthorized' })
        : json({ ok: false, reason: 'unauthorized' }, 401);
    }
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(db, request, env, identity);
        await setIdentity(db, identity);
      } catch {
        return json({ ok: false, reason: 'provision_failed' }, 503);
      }
    }
    const profiles = await runtimeProfiles(request, env).catch(() => []);
    let profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile && identity.profileId && identity.walletId) {
      profile = {
        id: identity.profileId,
        username: identity.username || 'player',
        displayName: identity.displayName || identity.name || 'Player',
        walletId: identity.walletId,
        ownedBotIds: [],
        wallet: { id: identity.walletId, balance: 0 },
      };
    }
    if (!profile) return json({ ok: false, reason: 'profile_unavailable' }, 503);
    identity.walletId = profile.wallet?.id ?? profile.walletId;
    identity.username = profile.username;
    identity.displayName = profile.displayName;
    await setIdentity(db, identity);
    const { bots } = await loadPlayerRuntimeBotContext(request, env, identity, profile);
    const ownerBot = bots[0] ?? null;
    return json({
      ok: true,
      user: sanitizeUser(identity),
      profile,
      bots,
      bot: { id: ownerBot?.id ?? null, connected: typeof ownerBot?.connected === 'boolean' ? ownerBot.connected : null },
      wsAuth: await wsAuthForIdentity(env, identity),
    });
  }

  if (pathname === '/api/player/bootstrap') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok) return json({ ok: false, reason: 'unauthorized' }, 401);
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(db, request, env, identity);
        await setIdentity(db, identity);
      } catch {
        return json({ ok: false, reason: 'provision_failed' }, 503);
      }
    }
    const profiles = await runtimeProfiles(request, env).catch(() => []);
    const profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile) return json({ ok: false, reason: 'profile_unavailable' }, 503);
    const world = new URL(request.url).searchParams.get('world') || 'mega';
    const playParams = new URLSearchParams({ world, name: profile.displayName, walletId: profile.wallet?.id ?? profile.walletId, clientId: profile.id });
    const { ownerWalletAddress, ownerBot } = await loadPlayerRuntimeBotContext(request, env, identity, profile);
    const walletSummary = await loadPlayerWalletSummary(request, env, identity);
    const activityPayload = await loadPlayerActivity(request, env, identity, 5);
    const ownerBotWallet = ownerBot?.id ? await runtimeFetch<Record<string, any>>(request, env, `/bots/${encodeURIComponent(ownerBot.id)}/wallet`).catch(() => null) : null;
    const playerShell = buildPlayerShell({
      user: sanitizeUser(identity) as any,
      profile,
      walletSummary,
      funding: {
        walletProvider: walletSummary?.wallet?.walletProvider ?? null,
        depositAddress: walletSummary?.wallet?.externalWalletAddress ?? ownerWalletAddress ?? walletSummary?.onchain?.address ?? '',
        chainId: Number.isFinite(Number(walletSummary?.onchain?.chainId)) ? Number(walletSummary.onchain.chainId) : null,
        tokenSymbol: String(walletSummary?.onchain?.tokenSymbol || 'USDC'),
      },
      bot: ownerBot,
      readiness: ownerBotWallet?.readiness || ownerBotWallet || null,
      activity: Array.isArray(activityPayload?.activity) ? activityPayload.activity : [],
      loadedAt: Date.now(),
    });
    return json({
      ok: true,
      user: sanitizeUser(identity),
      profile,
      playerShell,
      links: {
        welcome: '/welcome',
        dashboard: '/dashboard',
        play: `/play?${playParams.toString()}`,
        admin: '/admin',
      },
      invite: {
        note: 'Invite requires sign-in. Share the arena link; they must authenticate first.',
        playUrl: '/welcome',
      },
    });
  }

  if (pathname === '/api/player/identity-wallet') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok) return json({ ok: false, reason: 'unauthorized' }, 401);
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(db, request, env, identity);
        await setIdentity(db, identity);
      } catch {
        return json({ ok: false, reason: 'provision_failed' }, 503);
      }
    }
    const link = await runtimeSubjectLink(request, env, externalSubjectFromIdentity(identity)).catch(() => null);
    const profiles = await runtimeProfiles(request, env).catch(() => []);
    const profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    return json({
      ok: true,
      sub: identity.sub,
      email: identity.email,
      profileId: identity.profileId,
      walletId: identity.walletId,
      walletAddress: profile?.wallet?.address ?? null,
      continuitySource: link?.continuitySource ?? 'web-session-store',
      linkedAt: link?.linkedAt || identity.createdAt,
      lastVerifiedAt: Date.now(),
    });
  }

  if (pathname === '/api/player/directory') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const profiles = await runtimeProfiles(request, env).catch(() => []);
    const entries = profiles
      .filter((profile) => (profile.wallet?.id ?? profile.walletId))
      .map((profile) => ({
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        walletId: profile.wallet?.id ?? profile.walletId,
        walletAddress: profile.wallet?.address,
      }))
      .filter((entry) => entry.walletId && entry.id !== auth.identity.profileId);
    return json({ ok: true, players: entries });
  }

  if (pathname === '/api/player/wallet/summary') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const payload = await loadPlayerWalletSummary(request, env, auth.identity);
    return payload ? json(payload) : json({ ok: false, reason: 'wallet_summary_unavailable' }, 503);
  }

  const walletActionMap = new Map([
    ['/api/player/wallet/fund', 'fund'],
    ['/api/player/wallet/withdraw', 'withdraw'],
    ['/api/player/wallet/transfer', 'transfer'],
  ]);
  if (walletActionMap.has(pathname) && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = walletActionMap.get(pathname)!;
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (action === 'transfer') {
      const toWalletId = String(body?.toWalletId || '').trim();
      if (!toWalletId || amount <= 0) return json({ ok: false, reason: !toWalletId ? 'target_wallet_required' : 'invalid_amount' }, 400);
      const payload = await runtimeFetch(request, env, `/wallets/${auth.identity.walletId}/transfer`, { method: 'POST', body: { toWalletId, amount } }).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    if (amount <= 0) return json({ ok: false, reason: 'invalid_amount' }, 400);
    const payload = await runtimeFetch(request, env, `/wallets/${auth.identity.walletId}/${action}`, { method: 'POST', body: { amount } }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  if (pathname === '/api/player/wallet/prepare-escrow' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, reason: 'invalid_amount' }, 400);
    const payload = await runtimeFetch(request, env, '/wallets/onchain/prepare-escrow', { method: 'POST', body: { amount, walletIds: [auth.identity.walletId] } }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  if (pathname === '/api/player/wallet/export-key' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const payload = await runtimeFetch(request, env, `/wallets/${auth.identity.walletId}/export-key`, { method: 'POST', body: { profileId: auth.identity.profileId } }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  if (pathname === '/api/player/profile' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    const payload = await runtimeFetch(request, env, `/profiles/${auth.identity.profileId}/update`, { method: 'POST', body }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'profile_update_failed' }, 400);
  }

  if (pathname === '/api/player/onboarding' && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const payload = await runtimeFetch(request, env, `/profiles/${encodeURIComponent(auth.identity.profileId)}/onboarding`).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  if (pathname === '/api/player/onboarding/complete' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const payload = await runtimeFetch(request, env, `/profiles/${encodeURIComponent(auth.identity.profileId)}/onboarding/complete`, { method: 'POST', body: { completedAt: Date.now() } }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  if (pathname === '/api/player/bot/config' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    const runtimeStatus = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => ({ bots: [] }));
    const bot = (runtimeStatus.bots ?? []).find((entry) => entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!bot) return json({ ok: false, reason: 'bot_not_found' }, 404);
    const payload = await runtimeFetch(request, env, `/agents/${bot.id}/config`, { method: 'POST', body }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'bot_update_failed' }, 400);
  }

  if (pathname === '/api/player/bots/create' && request.method === 'POST') {
    return json({ ok: false, reason: 'bot_creation_disabled' }, 409);
  }

  const botWalletMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/wallet$/);
  if (botWalletMatch && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const botId = botWalletMatch[1] || '';
    const runtimeStatus = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) return json({ ok: false, reason: 'bot_not_owned' }, 403);
    const payload = await runtimeFetch(request, env, `/bots/${botId}/wallet`).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'wallet_readiness_unavailable' }, 503);
  }

  const botSessionMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/session(?:\/(deploy|pause|stop|logs))?$/);
  if (botSessionMatch && (request.method === 'GET' || request.method === 'POST')) {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const botId = botSessionMatch[1] || '';
    const action = botSessionMatch[2] || '';
    const runtimeStatus = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) return json({ ok: false, reason: 'bot_not_owned' }, 403);
    if (action === 'logs' && request.method === 'GET') {
      const payload = await runtimeFetch(request, env, `/agents/${botId}/session/logs`).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'agent_session_unavailable' }, 503);
    }
    if (!action && request.method === 'GET') {
      const payload = await runtimeFetch(request, env, `/agents/${botId}/session`).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'agent_session_unavailable' }, 503);
    }
    if (['deploy', 'pause', 'stop'].includes(action) && request.method === 'POST') {
      const body = action === 'deploy' ? await request.json().catch(() => null) : {};
      const payload = await runtimeFetch(request, env, `/agents/${botId}/session/${action}`, { method: 'POST', body: body || {} }).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'agent_session_update_failed' }, 400);
    }
  }

  const botConfigMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/config$/);
  if (botConfigMatch && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const botId = botConfigMatch[1] || '';
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    const runtimeStatus = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) return json({ ok: false, reason: 'bot_not_owned' }, 403);
    const payload = await runtimeFetch(request, env, `/agents/${botId}/config`, { method: 'POST', body }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'bot_update_failed' }, 400);
  }

  if (pathname === '/api/player/activity') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId || !auth.identity.walletId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const payload = await loadPlayerActivity(request, env, auth.identity, Math.max(1, Math.min(120, Number(new URL(request.url).searchParams.get('limit') || 30))));
    return json(payload);
  }

  if (pathname === '/api/player/wallet/escrow-history') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) return json({ ok: false, reason: 'unauthorized' }, 401);
    const limit = Math.max(1, Math.min(120, Number(new URL(request.url).searchParams.get('limit') || 30)));
    let recent: Array<Record<string, unknown>> = [];
    for (const pid of candidatePlayerIds(auth.identity.profileId)) {
      const payload = await serverFetch<{ recent?: Array<Record<string, unknown>> }>(env, `/escrow/events/recent?playerId=${encodeURIComponent(pid)}&limit=${limit}`).catch(() => ({ recent: [] }));
      if (Array.isArray(payload.recent) && payload.recent.length > 0) {
        recent = payload.recent;
        break;
      }
    }
    return json({ ok: true, recent });
  }

  const chiefChatDisabled = pathname === '/api/chief/v1/chat'
    || pathname === '/api/player/house/chat'
    || pathname === '/api/player/chief/chat'
    || pathname === '/api/super-agent/chat';
  if (chiefChatDisabled && request.method === 'POST') {
    const auth = await requireRole(db, request, env, pathname === '/api/super-agent/chat' ? ['admin'] : ['player', 'admin']);
    if (!auth.ok) return json({ ok: false, reason: pathname === '/api/super-agent/chat' ? 'forbidden' : 'unauthorized' }, pathname === '/api/super-agent/chat' ? 403 : 401);
    return json({
      ok: true,
      mode: pathname === '/api/super-agent/chat' ? 'admin' : 'player',
      intent: 'unknown',
      reply: 'Chief chat is unavailable in the Cloudflare migration build.',
      actions: [],
      requiresConfirmation: false,
      errors: [{ code: 'chief_disabled', message: 'Chief chat is disabled.' }],
    });
  }

  if (pathname === '/api/admin/chief/workspace/bootstrap' && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    return json({ ok: true, mode: 'cloudflare', chiefAvailable: false, incidents: [], runbooks: [] });
  }

  if (pathname === '/api/admin/chief/workspace/incidents' && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    return json({ ok: true, incidents: [] });
  }

  if (pathname === '/api/admin/chief/workspace/runbooks' && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    return json({ ok: true, runbooks: [] });
  }

  if (pathname === '/api/admin/chief/workspace/command' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    return json({
      ok: true,
      reply: 'Chief workspace commands are unavailable in the Cloudflare migration build.',
      actions: [],
      requiresConfirmation: false,
      traceId: 'cf-disabled',
      sessionId: 'cf-disabled',
      executionGraph: {
        objective: 'cloudflare chief workspace disabled',
        steps: [{ tool: 'chief.workspace', status: 'blocked', summary: 'Chief workspace is disabled in this build.' }],
        stopReason: 'blocked',
      },
    });
  }

  if (pathname.startsWith('/api/admin/runtime')) {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const subpath = pathname.slice('/api/admin/runtime'.length) || '/';

    if (subpath === '/status' && request.method === 'GET') {
      const payload = await runtimeFetch(request, env, '/status').catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    if (subpath === '/house/status' && request.method === 'GET') {
      const payload = await runtimeFetch(request, env, '/house/status').catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    if (subpath === '/onchain/status' && request.method === 'GET') {
      const payload = await serverFetch(env, '/admin/onchain/status').catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'server_unavailable' }, 503);
    }
    if (subpath === '/super-agent/status' && request.method === 'GET') {
      const payload = await runtimeFetch<RuntimeStatusPayload>(request, env, '/status').catch(() => null);
      return json({
        ok: true,
        enabled: false,
        mode: 'disabled',
        superAgent: payload?.superAgent ?? null,
      });
    }
    if (subpath === '/super-agent/ethskills' && request.method === 'GET') {
      return json({ ok: true, refreshed: 0, skills: [] });
    }

    const marketRoute = subpath === '/markets'
      || subpath === '/markets/player-view'
      || subpath === '/markets/reconcile'
      || subpath === '/markets/quote'
      || subpath === '/markets/refresh'
      || subpath === '/markets/activate'
      || subpath === '/markets/deactivate'
      || subpath === '/markets/config'
      || subpath === '/markets/reconcile/repair';
    if (marketRoute) {
      const path = `/admin${subpath}${request.method === 'GET' ? new URL(request.url).search : ''}`;
      const payload = await serverFetch(env, path, request.method === 'POST'
        ? { method: 'POST', body: await request.json().catch(() => ({})) }
        : undefined).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'server_unavailable' }, 503);
    }

    if (subpath === '/house/treasury/withdraw' && request.method === 'POST') {
      const payload = await serverFetch(env, '/admin/house/treasury/withdraw', {
        method: 'POST',
        body: await request.json().catch(() => ({})),
      }).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'server_unavailable' }, 503);
    }

    const runtimePostRoute = request.method === 'POST' && (
      subpath === '/profiles/create'
      || subpath === '/agents/reconcile'
      || subpath === '/house/config'
      || subpath === '/house/refill'
      || subpath === '/house/transfer'
      || subpath === '/wallets/onchain/prepare-escrow'
      || subpath === '/capabilities/wallet'
      || subpath === '/secrets/openrouter'
      || subpath === '/super-agent/config'
      || subpath === '/super-agent/ethskills/sync'
      || subpath === '/super-agent/delegate/apply'
      || /^\/agents\/[^/]+\/config$/.test(subpath)
      || /^\/wallets\/[^/]+\/(fund|withdraw|transfer|export-key)$/.test(subpath)
    );
    if (runtimePostRoute) {
      const payload = await runtimeFetch(request, env, subpath, {
        method: 'POST',
        body: await request.json().catch(() => ({})),
      }).catch(() => null);
      return payload ? json(payload) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }

    if (request.method === 'GET') {
      return json({ ok: false, reason: 'admin_proxy_not_allowed' }, 404);
    }
    return json({ ok: false, reason: 'runtime_request_not_supported' }, 501);
  }

  if (pathname === '/api/admin/users') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const [profiles, presencePayload] = await Promise.all([
      runtimeProfiles(request, env).catch(() => []),
      serverFetch<{ players?: Array<{ playerId: string; serverId: string; x: number; z: number; updatedAt: number }> }>(env, '/presence').catch(() => ({ players: [] })),
    ]);
    const presenceByPlayerId = new Map(
      (presencePayload.players ?? []).map((entry) => [entry.playerId, entry]),
    );
    const users = await Promise.all(profiles.map(async (profile) => {
      const playerId = `u_${profile.id}`;
      const presence = presenceByPlayerId.get(playerId) ?? null;
      const identities = await findIdentitiesByProfileId(db, profile.id).catch(() => []);
      const firstIdentity = identities[0] ?? null;
      return {
        profileId: profile.id,
        playerId,
        username: profile.username,
        displayName: profile.displayName,
        walletId: profile.wallet?.id ?? profile.walletId,
        walletAddress: profile.wallet?.address ?? null,
        walletBalance: Number(profile.wallet?.balance ?? 0),
        online: Boolean(presence),
        serverId: presence?.serverId ?? null,
        x: presence?.x ?? null,
        z: presence?.z ?? null,
        lastSeen: presence?.updatedAt ?? null,
        subjectHash: maskSubject(firstIdentity?.sub),
        continuitySource: firstIdentity ? 'cloudflare_d1' : null,
      };
    }));
    return json({ ok: true, users });
  }

  const adminTeleportMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/teleport$/);
  if (adminTeleportMatch && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const profileId = String(adminTeleportMatch[1] || '').trim();
    if (!profileId) return json({ ok: false, reason: 'profile_required' }, 400);
    const body = await request.json().catch(() => null);
    const payload = await serverFetch(env, '/admin/teleport', {
      method: 'POST',
      body: { playerId: `u_${profileId}`, x: body?.x, z: body?.z, section: body?.section },
    }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'server_unavailable' }, 503);
  }

  const adminWalletAdjustMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/wallet\/adjust$/);
  if (adminWalletAdjustMatch && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const profileId = String(adminWalletAdjustMatch[1] || '').trim();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const direction = body?.direction === 'debit' ? 'debit' : 'credit';
    const reason = String(body?.reason || 'admin_adjust').trim() || 'admin_adjust';
    if (!profileId || amount <= 0) return json({ ok: false, reason: 'invalid_adjust_payload' }, 400);
    const profiles = await runtimeProfiles(request, env).catch(() => []);
    const profile = profiles.find((entry) => entry.id === profileId);
    if (!profile) return json({ ok: false, reason: 'profile_not_found' }, 404);
    const walletId = profile.wallet?.id ?? profile.walletId;
    if (!walletId) return json({ ok: false, reason: 'wallet_not_found' }, 404);
    if (direction === 'credit') {
      const houseStatus = await runtimeFetch<any>(request, env, '/house/status').catch(() => null);
      const houseWalletId = String(houseStatus?.house?.wallet?.id || '').trim();
      if (!houseWalletId) return json({ ok: false, reason: 'house_wallet_missing' }, 500);
      const payload = await runtimeFetch(request, env, `/wallets/${houseWalletId}/transfer`, { method: 'POST', body: { toWalletId: walletId, amount, reason } }).catch(() => null);
      return payload ? json({ ok: true, direction, amount, walletId, runtime: payload }) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
    }
    const houseStatus = await runtimeFetch<any>(request, env, '/house/status').catch(() => null);
    const houseWalletId = String(houseStatus?.house?.wallet?.id || '').trim();
    if (!houseWalletId) return json({ ok: false, reason: 'house_wallet_missing' }, 500);
    const payload = await runtimeFetch(request, env, `/wallets/${walletId}/transfer`, { method: 'POST', body: { toWalletId: houseWalletId, amount } }).catch(() => null);
    return payload ? json({ ok: true, direction, amount, walletId, runtime: payload }) : json({ ok: false, reason: 'runtime_unavailable' }, 503);
  }

  const adminLogoutMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/logout$/);
  if (adminLogoutMatch && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const profileId = String(adminLogoutMatch[1] || '').trim();
    if (!profileId) return json({ ok: false, reason: 'profile_required' }, 400);
    const sessionsDeleted = await purgeSessionsForProfile(db, profileId).catch(() => 0);
    return json({ ok: true, profileId, sessionsDeleted });
  }

  if (pathname === '/api/admin/challenges/recent' && request.method === 'GET') {
    const auth = await requireRole(db, request, env, ['admin']);
    if (!auth.ok) return json({ ok: false, reason: 'forbidden' }, 403);
    const limit = Math.max(1, Math.min(300, Number(new URL(request.url).searchParams.get('limit') ?? 60)));
    const payload = await serverFetch(env, `/challenges/recent?limit=${limit}`).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'server_unavailable' }, 503);
  }

  if (pathname === '/api/game/stations/playable' && request.method === 'GET') {
    const payload = await serverFetch(env, '/stations/playable').catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'stations_unavailable' }, 503);
  }

  if (pathname === '/api/game/stations/interact' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok) return json({ ok: false, reason: 'unauthorized' }, 401);
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) return json({ ok: false, reason: 'profile_or_wallet_missing' }, 404);
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    const payload = await serverFetch(env, '/stations/interact', {
      method: 'POST',
      body: {
        playerId: `u_${identity.profileId}`,
        walletId: identity.walletId,
        displayName: identity.displayName || identity.name || identity.username || identity.profileId,
        payload: body,
      },
    }).catch(() => null);
    return payload ? json(payload) : json({ ok: false, reason: 'station_interact_failed' }, 503);
  }

  if (pathname === '/api/player/presence' && request.method === 'POST') {
    const auth = await requireRole(db, request, env, ['player', 'admin']);
    if (!auth.ok) return json({ ok: false, reason: 'unauthorized' }, 401);
    const identity = auth.identity;
    if (!identity.profileId) return json({ ok: false, reason: 'profile_missing' }, 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const state = body?.state === 'offline' ? 'offline' : 'online';
    const payload = await runtimeFetch(
      request,
      env,
      `/owners/${identity.profileId}/presence`,
      { method: 'POST', body: state === 'offline' ? { state: 'offline', source: 'legacy_browser' } : { state: 'online', ttlMs: 90_000, source: 'legacy_browser' } },
    ).catch(() => null);
    return payload
      ? json({ ok: true, state, runtime: payload })
      : json({ ok: false, state, reason: 'presence_runtime_degraded' }, 202);
  }

  return null;
}
