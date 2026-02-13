import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createHealthStatus } from './health.js';
import { availableWorldAliases, resolveWorldAssetPath } from './worldAssets.js';

const port = Number(process.env.PORT ?? 3000);
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const runtimeBase = process.env.WEB_AGENT_RUNTIME_BASE_URL ?? 'http://localhost:4100';
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAIL ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const localAdminUsername = process.env.ADMIN_USERNAME ?? 'admin';
const localAdminPassword = process.env.ADMIN_PASSWORD ?? '12345';
const localAuthEnabled = (process.env.LOCAL_AUTH_ENABLED ?? 'true') !== 'false';
const webStateFile = process.env.WEB_STATE_FILE
  ? path.resolve(process.cwd(), process.env.WEB_STATE_FILE)
  : path.resolve(process.cwd(), 'output', 'web-auth-state.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirCandidates = [
  path.resolve(process.cwd(), 'apps/web/public'),
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, '../../../../../../apps/web/public')
];
const publicDir = publicDirCandidates.find((candidate) => existsSync(candidate)) ?? path.resolve(__dirname, '../public');

type Role = 'player' | 'admin';

type IdentityRecord = {
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
    balance: number;
  };
};

type RuntimeStatusPayload = {
  bots?: Array<{
    id: string;
    connected?: boolean;
    behavior: {
      personality: 'aggressive' | 'conservative' | 'social';
      targetPreference: 'human_only' | 'human_first' | 'any';
      challengeCooldownMs: number;
      challengeEnabled?: boolean;
    };
    meta?: {
      ownerProfileId?: string | null;
      displayName?: string;
      duty?: string;
      managedBySuperAgent?: boolean;
      patrolSection?: number | null;
    };
  }>;
};

const identities = new Map<string, IdentityRecord>();
const sessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const COOKIE_NAME = 'arena_sid';
let persistTimer: NodeJS.Timeout | null = null;

type PersistedWebState = {
  version: 1;
  savedAt: number;
  identities: IdentityRecord[];
  sessions: SessionRecord[];
};

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

function persistWebState(): void {
  try {
    pruneExpiredSessions();
    const payload: PersistedWebState = {
      version: 1,
      savedAt: Date.now(),
      identities: [...identities.values()],
      sessions: [...sessions.values()]
    };
    mkdirSync(path.dirname(webStateFile), { recursive: true });
    writeFileSync(webStateFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // ignore persistence failures in scaffold mode
  }
}

function schedulePersistWebState(): void {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistWebState();
  }, 250);
}

function loadWebState(): void {
  if (!existsSync(webStateFile)) {
    return;
  }
  try {
    const raw = readFileSync(webStateFile, 'utf8');
    const parsed = JSON.parse(raw) as PersistedWebState;
    if (!parsed || parsed.version !== 1) {
      return;
    }
    for (const identity of parsed.identities ?? []) {
      if (identity?.sub) {
        identities.set(identity.sub, identity);
      }
    }
    for (const session of parsed.sessions ?? []) {
      if (session?.id && session?.sub && typeof session.expiresAt === 'number') {
        sessions.set(session.id, session);
      }
    }
    pruneExpiredSessions();
  } catch {
    // ignore invalid state files
  }
}

loadWebState();

function parseCookies(req: import('node:http').IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

function setSessionCookie(res: import('node:http').ServerResponse, sessionId: string): void {
  res.setHeader('set-cookie', `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res: import('node:http').ServerResponse): void {
  res.setHeader('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sendJson(res: import('node:http').ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function redirect(res: import('node:http').ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

async function readJsonBody<T>(req: import('node:http').IncomingMessage): Promise<T | null> {
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

async function sendFile(res: import('node:http').ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const body = await readFile(filePath);
    res.setHeader('content-type', contentType);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
}

function extractSession(req: import('node:http').IncomingMessage): SessionRecord | null {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (!sid) {
    return null;
  }
  const session = sessions.get(sid);
  if (!session) {
    return null;
  }
  if (session.expiresAt < Date.now()) {
    sessions.delete(sid);
    schedulePersistWebState();
    return null;
  }
  return session;
}

function getIdentityFromReq(req: import('node:http').IncomingMessage): IdentityRecord | null {
  const session = extractSession(req);
  if (!session) {
    return null;
  }
  return identities.get(session.sub) ?? null;
}

function requireRole(req: import('node:http').IncomingMessage, roles: Role[]): { ok: true; identity: IdentityRecord } | { ok: false } {
  const identity = getIdentityFromReq(req);
  if (!identity) {
    return { ok: false };
  }
  if (!roles.includes(identity.role)) {
    return { ok: false };
  }
  return { ok: true, identity };
}

async function runtimeGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${runtimeBase}${pathname}`);
  if (!response.ok) {
    throw new Error(`runtime_get_${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function runtimePost<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${runtimeBase}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload) {
    throw new Error(`runtime_post_${response.status}`);
  }
  return payload;
}

async function runtimeProfiles(): Promise<PlayerProfile[]> {
  const payload = await runtimeGet<{ profiles: PlayerProfile[] }>('/profiles');
  return payload.profiles ?? [];
}

async function ensurePlayerProvisioned(identity: IdentityRecord): Promise<void> {
  if (identity.role !== 'player') {
    return;
  }

  if (identity.profileId && identity.walletId) {
    return;
  }

  const created = await runtimePost<{
    ok?: boolean;
    reason?: string;
    created?: boolean;
    profile?: PlayerProfile;
    wallet?: { id: string; balance: number };
  }>('/profiles/provision', {
    externalSubject: `google:${identity.sub}`,
    email: identity.email,
    displayName: identity.name,
    personality: 'social',
    targetPreference: 'human_first'
  });

  if (!created.profile) {
    throw new Error(created.reason ?? 'provision_failed');
  }

  identity.profileId = created.profile.id;
  identity.walletId = created.wallet?.id ?? created.profile.walletId;
  identity.username = created.profile.username;
  identity.displayName = created.profile.displayName;
}

async function googleTokenInfo(idToken: string): Promise<{ sub: string; email: string; name?: string; picture?: string; aud: string; exp: string }> {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('invalid_google_token');
  }
  return response.json() as Promise<{ sub: string; email: string; name?: string; picture?: string; aud: string; exp: string }>;
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
    displayName: identity.displayName
  };
}

function htmlRouteToFile(pathname: string, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): string | null {
  const identity = getIdentityFromReq(req);

  if (pathname === '/welcome') {
    if (identity) {
      redirect(res, identity.role === 'admin' ? '/admin' : '/dashboard');
      return null;
    }
    return path.join(publicDir, 'welcome.html');
  }

  if (pathname === '/') {
    redirect(res, '/welcome');
    return null;
  }

  if (pathname === '/home' || pathname === '/landing') {
    return path.join(publicDir, 'index.html');
  }

  if (pathname === '/dashboard' || pathname === '/profile') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    return path.join(publicDir, 'dashboard.html');
  }

  if (pathname === '/admin' || pathname === '/agents') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'agents.html');
  }

  if (pathname === '/play') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    return path.join(publicDir, 'play.html');
  }

  if (pathname === '/viewer') {
    return path.join(publicDir, 'viewer.html');
  }

  return null;
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/health') {
    sendJson(res, createHealthStatus());
    return;
  }

  if (pathname === '/api/worlds') {
    sendJson(res, { aliases: availableWorldAliases() });
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, {
      googleClientId,
      authEnabled: googleClientId.length > 0,
      localAuthEnabled
    });
    return;
  }

  if (pathname === '/api/auth/local' && req.method === 'POST') {
    if (!localAuthEnabled) {
      sendJson(res, { ok: false, reason: 'local_auth_disabled' }, 403);
      return;
    }

    const body = await readJsonBody<{ username?: string; password?: string }>(req);
    const username = body?.username?.trim() ?? '';
    const password = body?.password?.trim() ?? '';
    if (!username || !password) {
      sendJson(res, { ok: false, reason: 'credentials_required' }, 400);
      return;
    }

    if (username !== localAdminUsername || password !== localAdminPassword) {
      sendJson(res, { ok: false, reason: 'invalid_credentials' }, 401);
      return;
    }

    const now = Date.now();
    const sub = `local:${localAdminUsername}`;
    const existing = identities.get(sub);
    const identity: IdentityRecord = existing ?? {
      sub,
      email: `${localAdminUsername}@local.admin`,
      name: 'Administrator',
      picture: '',
      role: 'admin',
      profileId: null,
      walletId: null,
      username: null,
      displayName: 'Administrator',
      createdAt: now,
      lastLoginAt: now
    };
    identity.role = 'admin';
    identity.lastLoginAt = now;
    identities.set(sub, identity);

    const sid = randomBytes(24).toString('hex');
    sessions.set(sid, {
      id: sid,
      sub: identity.sub,
      expiresAt: now + SESSION_TTL_MS
    });
    schedulePersistWebState();
    setSessionCookie(res, sid);

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      redirectTo: '/admin'
    });
    return;
  }

  if (pathname === '/api/auth/google' && req.method === 'POST') {
    const body = await readJsonBody<{ credential?: string }>(req);
    const credential = body?.credential?.trim();
    if (!credential) {
      sendJson(res, { ok: false, reason: 'credential_required' }, 400);
      return;
    }

    try {
      const token = await googleTokenInfo(credential);
      if (!token.sub || !token.email) {
        sendJson(res, { ok: false, reason: 'invalid_token_payload' }, 401);
        return;
      }
      if (googleClientId && token.aud !== googleClientId) {
        sendJson(res, { ok: false, reason: 'audience_mismatch' }, 401);
        return;
      }

      const now = Date.now();
      const role: Role = adminEmails.has(token.email.toLowerCase()) ? 'admin' : 'player';
      const existing = identities.get(token.sub);
      const identity: IdentityRecord = existing ?? {
        sub: token.sub,
        email: token.email,
        name: token.name ?? token.email.split('@')[0] ?? 'Player',
        picture: token.picture ?? '',
        role,
        profileId: null,
        walletId: null,
        username: null,
        displayName: null,
        createdAt: now,
        lastLoginAt: now
      };

      identity.email = token.email;
      identity.name = token.name ?? identity.name;
      identity.picture = token.picture ?? identity.picture;
      identity.role = role;
      identity.lastLoginAt = now;

      if (identity.role === 'player') {
        await ensurePlayerProvisioned(identity);
      }

      identities.set(identity.sub, identity);

      const sid = randomBytes(24).toString('hex');
      sessions.set(sid, {
        id: sid,
        sub: identity.sub,
        expiresAt: now + SESSION_TTL_MS
      });
      schedulePersistWebState();
      setSessionCookie(res, sid);

      sendJson(res, {
        ok: true,
        user: sanitizeUser(identity),
        redirectTo: identity.role === 'admin' ? '/admin' : '/dashboard'
      });
      return;
    } catch (error) {
      sendJson(res, { ok: false, reason: String((error as Error).message || 'auth_failed') }, 401);
      return;
    }
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const sid = parseCookies(req)[COOKIE_NAME];
    if (sid) {
      sessions.delete(sid);
      schedulePersistWebState();
    }
    clearSessionCookie(res);
    sendJson(res, { ok: true });
    return;
  }

  if (pathname === '/api/session') {
    const identity = getIdentityFromReq(req);
    if (!identity) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    sendJson(res, { ok: true, user: sanitizeUser(identity) });
    return;
  }

  if (pathname === '/api/player/me') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const identity = auth.identity;
    if (!identity.profileId) {
      sendJson(res, { ok: false, reason: 'profile_missing' }, 404);
      return;
    }

    const profiles = await runtimeProfiles();
    const profile = profiles.find((entry) => entry.id === identity.profileId);
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    identity.walletId = profile.wallet?.id ?? profile.walletId;
    identity.displayName = profile.displayName;
    identity.username = profile.username;
    schedulePersistWebState();

    const runtimeStatus = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const bots = (runtimeStatus.bots ?? []).filter((bot) => bot.meta?.ownerProfileId === identity.profileId);

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      profile,
      bots
    });
    return;
  }

  if (pathname === '/api/player/bootstrap') {
    const auth = requireRole(req, ['player']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const identity = auth.identity;
    if (!identity.profileId) {
      sendJson(res, { ok: false, reason: 'profile_missing' }, 404);
      return;
    }

    const profiles = await runtimeProfiles();
    const profile = profiles.find((entry) => entry.id === identity.profileId);
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    const walletId = profile.wallet?.id ?? profile.walletId;
    const world = requestUrl.searchParams.get('world') || 'mega';
    const playParams = new URLSearchParams({
      world,
      name: profile.displayName,
      walletId
    });

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      profile,
      links: {
        welcome: '/welcome',
        dashboard: '/dashboard',
        play: `/play?${playParams.toString()}`,
        admin: '/admin'
      },
      invite: {
        note: 'Share the play URL with a friend after they sign in.',
        playUrl: `/play?${playParams.toString()}`
      }
    });
    return;
  }

  if (pathname === '/api/player/wallet/fund' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    try {
      const payload = await runtimePost(`/wallets/${auth.identity.walletId}/fund`, { amount });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_fund_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/wallet/withdraw' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    try {
      const payload = await runtimePost(`/wallets/${auth.identity.walletId}/withdraw`, { amount });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_withdraw_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/profile' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<{ displayName?: string; username?: string }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    try {
      const payload = await runtimePost(`/profiles/${auth.identity.profileId}/update`, body);
      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        auth.identity.displayName = body.displayName.trim();
      }
      if (typeof body.username === 'string' && body.username.trim()) {
        auth.identity.username = body.username.trim();
      }
      schedulePersistWebState();
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'profile_update_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/bot/config' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    const runtimeStatus = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const bot = (runtimeStatus.bots ?? []).find((entry) => entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!bot) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return;
    }

    try {
      const payload = await runtimePost(`/agents/${bot.id}/config`, body);
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'bot_update_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/bots/create' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const body = await readJsonBody<{
      displayName?: string;
      personality?: 'aggressive' | 'conservative' | 'social';
      targetPreference?: 'human_only' | 'human_first' | 'any';
      managedBySuperAgent?: boolean;
    }>(req);

    try {
      const payload = await runtimePost(`/profiles/${auth.identity.profileId}/bots/create`, {
        displayName: body?.displayName,
        personality: body?.personality ?? 'social',
        targetPreference: body?.targetPreference ?? 'human_first',
        managedBySuperAgent: body?.managedBySuperAgent ?? true
      });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'bot_create_failed' }, 400);
    }
    return;
  }

  const playerBotConfigMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/config$/);
  if (playerBotConfigMatch && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const botId = playerBotConfigMatch[1];
    if (!botId) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    const runtimeStatus = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) {
      sendJson(res, { ok: false, reason: 'bot_not_owned' }, 403);
      return;
    }

    try {
      const payload = await runtimePost(`/agents/${botId}/config`, body);
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'bot_update_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/super-agent/chat' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
    if (!body?.message || !body.message.trim()) {
      sendJson(res, { ok: false, reason: 'message_required' }, 400);
      return;
    }

    try {
      const payload = await runtimePost('/super-agent/chat', {
        message: body.message.trim(),
        includeStatus: Boolean(body.includeStatus)
      });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'super_agent_chat_failed' }, 400);
    }
    return;
  }

  const worldMatch = pathname.match(/^\/assets\/world\/([a-zA-Z0-9_-]+)\.glb$/);
  if (worldMatch) {
    const alias = worldMatch[1];
    if (!alias) {
      res.statusCode = 400;
      res.end('Invalid world alias');
      return;
    }
    const worldPath = resolveWorldAssetPath(alias);
    if (!worldPath) {
      res.statusCode = 404;
      res.end('Unknown world alias');
      return;
    }
    await sendFile(res, worldPath, 'model/gltf-binary');
    return;
  }

  if (pathname.startsWith('/js/')) {
    const jsPath = path.join(publicDir, pathname);
    await sendFile(res, jsPath, 'text/javascript; charset=utf-8');
    return;
  }

  if (pathname.startsWith('/img/')) {
    const filePath = path.join(publicDir, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
    await sendFile(res, filePath, contentType);
    return;
  }

  if (pathname === '/styles.css') {
    await sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
    return;
  }

  const htmlFile = htmlRouteToFile(pathname, req, res);
  if (htmlFile) {
    await sendFile(res, htmlFile, 'text/html; charset=utf-8');
    return;
  }

  if (!res.writableEnded) {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

const webAutosave = setInterval(() => {
  persistWebState();
}, 10000);
webAutosave.unref();

process.on('SIGINT', () => {
  persistWebState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  persistWebState();
  process.exit(0);
});

server.listen(port, () => {
  console.log(`web listening on :${port}`);
});
