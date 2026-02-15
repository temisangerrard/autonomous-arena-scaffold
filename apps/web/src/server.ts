import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createHealthStatus } from './health.js';
import { log } from './logger.js';
import { availableWorldAliases, resolveWorldAssetPath, worldFilenameByAlias } from './worldAssets.js';
import { signWsAuthToken } from '@arena/shared';
import { loadEnvFromFile } from './lib/env.js';
import { clearSessionCookie, parseCookies, readJsonBody, redirect, sendFile, sendJson, setSessionCookie } from './lib/http.js';

loadEnvFromFile();

const port = Number(process.env.PORT ?? 3000);
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const serverBase = process.env.WEB_API_BASE_URL ?? 'http://localhost:4000';
const runtimeBase = process.env.WEB_AGENT_RUNTIME_BASE_URL ?? 'http://localhost:4100';
const publicGameWsUrl = process.env.WEB_GAME_WS_URL ?? '';
const publicWorldAssetBaseUrl = process.env.PUBLIC_WORLD_ASSET_BASE_URL ?? '';
const wsAuthSecret = process.env.GAME_WS_AUTH_SECRET?.trim() || '';
const internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() || '';
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAIL ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
// Local scaffold login is a dev-only escape hatch. Keep it disabled by default and
// never ship hardcoded credentials.
const localAdminUsername = process.env.ADMIN_USERNAME ?? '';
const localAdminPassword = process.env.ADMIN_PASSWORD ?? '';
const localAuthEnabled = (process.env.LOCAL_AUTH_ENABLED ?? 'false') === 'true';
const isProduction = process.env.NODE_ENV === 'production';

// --- Startup secret validation ---
if (localAuthEnabled && !localAdminPassword) {
  if (isProduction) {
    log.fatal('ADMIN_PASSWORD must be set when LOCAL_AUTH_ENABLED=true in production. Refusing to start.');
    process.exit(1);
  } else {
    log.warn('ADMIN_PASSWORD is not set. Local admin auth will reject all login attempts. Set ADMIN_PASSWORD in .env.');
  }
}

if (isProduction && localAuthEnabled && localAdminPassword && localAdminPassword.length < 8) {
  log.fatal('ADMIN_PASSWORD is too short for production (min 8 characters). Refusing to start.');
  process.exit(1);
}

if (isProduction && !wsAuthSecret) {
  log.fatal('GAME_WS_AUTH_SECRET must be set in production to prevent unauthenticated /ws access. Refusing to start.');
  process.exit(1);
}

if (isProduction && !internalToken) {
  log.fatal('INTERNAL_SERVICE_TOKEN must be set in production for runtime admin proxy + presence APIs. Refusing to start.');
  process.exit(1);
}
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
    address?: string;
    balance: number;
  };
};

type PlayerDirectoryEntry = {
  id: string;
  username: string;
  displayName: string;
  walletId: string;
  walletAddress?: string;
};

type RuntimeStatusPayload = {
  bots?: Array<{
    id: string;
    connected?: boolean;
    walletId?: string | null;
    walletAddress?: string | null;
    behavior: {
      personality: 'aggressive' | 'conservative' | 'social';
      mode?: 'active' | 'passive';
      targetPreference: 'human_only' | 'human_first' | 'any';
      challengeCooldownMs: number;
      challengeEnabled?: boolean;
      baseWager?: number;
      maxWager?: number;
    };
    meta?: {
      ownerProfileId?: string | null;
      displayName?: string;
      duty?: string;
      managedBySuperAgent?: boolean;
      patrolSection?: number | null;
    };
  }>;
  wallets?: Array<{
    id: string;
    ownerProfileId?: string | null;
    address?: string;
    balance?: number;
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
  const response = await fetch(`${runtimeBase}${pathname}`, {
    headers: internalToken ? { 'x-internal-token': internalToken } : undefined
  });
  if (!response.ok) {
    throw new Error(`runtime_get_${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function runtimePost<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${runtimeBase}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {})
    },
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

async function serverGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${serverBase}${pathname}`);
  if (!response.ok) {
    throw new Error(`server_get_${response.status}`);
  }
  return response.json() as Promise<T>;
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

function wsAuthForIdentity(identity: IdentityRecord): string | null {
  if (!wsAuthSecret) {
    return null;
  }
  if (!identity.profileId || !identity.walletId) {
    return null;
  }
  return signWsAuthToken(wsAuthSecret, {
    role: 'human',
    clientId: identity.profileId,
    walletId: identity.walletId,
    // Short-lived capability: clients must be logged-in to fetch a fresh token.
    exp: Date.now() + 1000 * 60
  });
}

function htmlRouteToFile(pathname: string, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): string | null {
  const identity = getIdentityFromReq(req);

  if (pathname === '/welcome') {
    if (identity) {
      // Always land on the player dashboard; admin tools are accessible from there.
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'welcome.html');
  }

  if (pathname === '/') {
    redirect(res, '/welcome');
    return null;
  }

  if (pathname === '/home' || pathname === '/landing') {
    if (identity) {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'index.html');
  }

  if (pathname === '/profile') {
    // Legacy alias: keep canonical path at /dashboard.
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    redirect(res, '/dashboard');
    return null;
  }

  if (pathname === '/dashboard') {
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
    sendJson(res, { aliases: availableWorldAliases(), filenameByAlias: worldFilenameByAlias() });
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, {
      googleClientId,
      authEnabled: googleClientId.length > 0,
      localAuthEnabled,
      // Used by the static Netlify client to connect to Cloud Run infra.
      gameWsUrl: publicGameWsUrl,
      worldAssetBaseUrl: publicWorldAssetBaseUrl
    });
    return;
  }

  if (pathname === '/api/auth/local' && req.method === 'POST') {
    if (!localAuthEnabled) {
      sendJson(res, { ok: false, reason: 'local_auth_disabled' }, 403);
      return;
    }
    if (!localAdminUsername || !localAdminPassword) {
      sendJson(res, { ok: false, reason: 'local_auth_misconfigured' }, 500);
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
    setSessionCookie(res, COOKIE_NAME, sid, SESSION_TTL_MS);

    // Allow local admins to play too (same as Google users).
    await ensurePlayerProvisioned(identity);

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      redirectTo: '/dashboard'
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

      // Admins should still be able to play; provision a player profile/wallet/bot for any Google user.
      await ensurePlayerProvisioned(identity);

      identities.set(identity.sub, identity);

      const sid = randomBytes(24).toString('hex');
      sessions.set(sid, {
        id: sid,
        sub: identity.sub,
        expiresAt: now + SESSION_TTL_MS
      });
      schedulePersistWebState();
      setSessionCookie(res, COOKIE_NAME, sid, SESSION_TTL_MS);

      sendJson(res, {
        ok: true,
        user: sanitizeUser(identity),
        // Always go to the dashboard first; admin entry points live there.
        redirectTo: '/dashboard'
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
    clearSessionCookie(res, COOKIE_NAME);
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

    const runtimeStatus = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [], wallets: [] }));
    const ownerWalletId = profile.wallet?.id ?? profile.walletId;
    const ownerWalletAddress = profile.wallet?.address
      ?? (runtimeStatus.wallets ?? []).find((wallet) => wallet?.id === ownerWalletId)?.address
      ?? '';
    const bots = (runtimeStatus.bots ?? [])
      .filter((bot) => bot.meta?.ownerProfileId === identity.profileId)
      .map((bot) => ({
        ...bot,
        walletId: ownerWalletId,
        walletAddress: ownerWalletAddress || undefined
      }));

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      profile,
      bots,
      wsAuth: wsAuthForIdentity(identity)
    });
    return;
  }

  if (pathname === '/api/player/directory') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const profiles = await runtimeProfiles().catch(() => []);
    const entries: PlayerDirectoryEntry[] = profiles
      .filter((profile) => profile.wallet?.id ?? profile.walletId)
      .map((profile) => ({
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        walletId: profile.wallet?.id ?? profile.walletId,
        walletAddress: profile.wallet?.address
      }))
      .filter((entry) => entry.walletId && entry.id !== auth.identity.profileId);

    sendJson(res, { ok: true, players: entries });
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
    identity.walletId = walletId;
    identity.username = profile.username;
    identity.displayName = profile.displayName;
    schedulePersistWebState();
    const world = requestUrl.searchParams.get('world') || 'mega';
    const playParams = new URLSearchParams({
      world,
      name: profile.displayName,
      walletId,
      clientId: profile.id
    });
    if (publicGameWsUrl) {
      playParams.set('ws', publicGameWsUrl);
    }

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
        note: 'Invite requires sign-in. Share the arena link; they must authenticate first.',
        playUrl: '/welcome'
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

  if (pathname === '/api/player/wallet/transfer' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<{ toWalletId?: string; amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const toWalletId = String(body?.toWalletId ?? '').trim();
    if (!toWalletId) {
      sendJson(res, { ok: false, reason: 'target_wallet_required' }, 400);
      return;
    }
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    try {
      const payload = await runtimePost(`/wallets/${auth.identity.walletId}/transfer`, { toWalletId, amount });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_transfer_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/wallet/escrow-history') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const limit = Math.max(1, Math.min(120, Number(requestUrl.searchParams.get('limit') ?? 30)));
    try {
      const payload = await runtimeGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(`/wallets/escrow/history?limit=${limit}`);
      const recent = (payload.recent ?? []).filter((entry) =>
        entry &&
        typeof entry === 'object' &&
        (
          entry.winnerWalletId === auth.identity.walletId ||
          entry.challengerWalletId === auth.identity.walletId ||
          entry.opponentWalletId === auth.identity.walletId
        )
      );
      sendJson(res, { ok: true, recent });
    } catch {
      sendJson(res, { ok: false, reason: 'escrow_history_unavailable' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/wallet/summary') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    try {
      const payload = await runtimeGet(`/wallets/${auth.identity.walletId}/summary`);
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_summary_unavailable' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/wallet/export-key' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    try {
      const payload = await runtimePost(`/wallets/${auth.identity.walletId}/export-key`, {
        profileId: auth.identity.profileId
      });
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_export_failed' }, 400);
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

  // Intentionally no "create more bots" API for players:
  // one character + one offline bot per player. Extra NPCs are system-managed.
  if (pathname === '/api/player/bots/create' && req.method === 'POST') {
    sendJson(res, { ok: false, reason: 'bot_creation_disabled' }, 409);
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

  // Ops super-agent is admin-only. Players use the scoped chief-of-staff endpoint below.
  if (pathname === '/api/super-agent/chat' && req.method === 'POST') {
    const auth = requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
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

  if (pathname === '/api/player/chief/chat' && req.method === 'POST') {
    const auth = requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const identity = auth.identity;

    const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
    const message = String(body?.message ?? '').trim();
    if (!message) {
      sendJson(res, { ok: false, reason: 'message_required' }, 400);
      return;
    }

    // Structured, player-scoped "chief of staff" actions. This intentionally does not allow
    // global ops actions like changing bot count / wallet policy / delegation.
    const normalized = message.toLowerCase().trim();

    const actions: string[] = [];
    function reply(text: string) {
      sendJson(res, { ok: true, reply: text, actions });
    }

    if (/\b(help|what can you do)\b/.test(normalized)) {
      reply(
        [
          'I can help with:',
          '- status',
          '- fund <amount>',
          '- withdraw <amount>',
          '- set personality <social|aggressive|conservative>',
          '- set target <human_first|human_only|any>',
          '- set mode <active|passive>',
          '- set cooldown <ms>',
          '- set wager base <n> max <n>'
        ].join('\n')
      );
      return;
    }

    if (/\bstatus\b/.test(normalized) || body?.includeStatus) {
      const ctx = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [], wallets: [] }));
      const ownerBot = (ctx.bots ?? []).find((entry) => entry.meta?.ownerProfileId === identity.profileId);
      const wallet = (ctx.wallets ?? []).find((entry) => entry.id === identity.walletId);
      reply(
        [
          `profileId=${identity.profileId || '-'}`,
          `walletId=${identity.walletId || '-'} balance=${Number(wallet?.balance || 0).toFixed(2)}`,
          ownerBot
            ? `bot=${ownerBot.id} personality=${ownerBot.behavior?.personality || '-'} target=${ownerBot.behavior?.targetPreference || '-'} mode=${ownerBot.behavior?.mode || '-'}`
            : 'bot=missing'
        ].join('\n')
      );
      return;
    }

    const fundMatch = normalized.match(/\bfund\s+(\d+(\.\d+)?)\b/);
    if (fundMatch?.[1]) {
      const amount = Math.max(0, Number(fundMatch[1]));
      if (!identity.walletId) {
        sendJson(res, { ok: false, reason: 'wallet_missing' }, 400);
        return;
      }
      await runtimePost(`/wallets/${identity.walletId}/fund`, { amount }).catch(() => null);
      actions.push(`fund:${amount}`);
      reply(`Funded wallet by ${amount}.`);
      return;
    }

    const withdrawMatch = normalized.match(/\b(withdraw|cash out)\s+(\d+(\.\d+)?)\b/);
    if (withdrawMatch?.[2]) {
      const amount = Math.max(0, Number(withdrawMatch[2]));
      if (!identity.walletId) {
        sendJson(res, { ok: false, reason: 'wallet_missing' }, 400);
        return;
      }
      await runtimePost(`/wallets/${identity.walletId}/withdraw`, { amount }).catch(() => null);
      actions.push(`withdraw:${amount}`);
      reply(`Withdrew ${amount} from wallet.`);
      return;
    }

    const personalityMatch = normalized.match(/\b(personality|persona)\s+(social|aggressive|conservative)\b/);
    const targetMatch = normalized.match(/\btarget\s+(human_first|human_only|any)\b/);
    const modeMatch = normalized.match(/\bmode\s+(active|passive)\b/);
    const cooldownMatch = normalized.match(/\bcooldown\s+(\d{3,6})\b/);
    const wagerMatch = normalized.match(/\bwager\s+base\s+(\d+)\s+max\s+(\d+)\b/);

    if (personalityMatch || targetMatch || modeMatch || cooldownMatch || wagerMatch) {
      const runtimeStatus = await runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
      const bot = (runtimeStatus.bots ?? []).find((entry) => entry.meta?.ownerProfileId === identity.profileId);
      if (!bot?.id) {
        sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
        return;
      }

      const patch: Record<string, unknown> = {};
      if (personalityMatch?.[2]) patch.personality = personalityMatch[2];
      if (targetMatch?.[1]) patch.targetPreference = targetMatch[1];
      if (modeMatch?.[1]) patch.mode = modeMatch[1];
      if (cooldownMatch?.[1]) patch.challengeCooldownMs = Number(cooldownMatch[1]);
      if (wagerMatch?.[1] && wagerMatch?.[2]) {
        const base = Math.max(1, Number(wagerMatch[1]));
        const max = Math.max(base, Number(wagerMatch[2]));
        patch.baseWager = base;
        patch.maxWager = max;
      }

      await runtimePost(`/agents/${bot.id}/config`, patch);
      actions.push(`bot_config:${bot.id}`);
      reply(`Updated ${bot.id}.`);
      return;
    }

    reply('I did not recognize that. Say "help" for supported commands.');
    return;
  }

  if (pathname === '/api/player/presence' && req.method === 'POST') {
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
    const body = await readJsonBody<{ state?: 'online' | 'offline' }>(req);
    const state = body?.state === 'offline' ? 'offline' : 'online';
    try {
      const payload = await runtimePost(`/owners/${identity.profileId}/presence`, {
        state,
        ttlMs: 90_000
      });
      sendJson(res, { ok: true, state, runtime: payload });
    } catch {
      sendJson(res, { ok: false, reason: 'presence_update_failed' }, 400);
    }
    return;
  }

  // Admin-only proxy routes to keep runtime ops out of the browser.
  if (pathname.startsWith('/api/admin/runtime')) {
    const auth = requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }

    const subpath = pathname.slice('/api/admin/runtime'.length) || '/';
    const allowGet = new Set(['/status', '/super-agent/status', '/super-agent/ethskills', '/house/status']);
    const allowPostExact = new Set([
      '/super-agent/config',
      '/capabilities/wallet',
      '/secrets/openrouter',
      '/super-agent/delegate/apply',
      '/super-agent/ethskills/sync',
      '/house/config',
      '/house/transfer',
      '/house/refill',
      '/profiles/create',
      '/agents/reconcile',
      '/super-agent/chat'
    ]);
    const allowPostRegex = [
      /^\/wallets\/[^/]+\/(fund|withdraw|export-key|transfer)$/i,
      /^\/agents\/[^/]+\/config$/i,
      /^\/profiles\/[^/]+\/bots\/create$/i
    ];

    if (req.method === 'GET') {
      if (!allowGet.has(subpath)) {
        sendJson(res, { ok: false, reason: 'admin_proxy_not_allowed' }, 404);
        return;
      }
      try {
        const payload = await runtimeGet(subpath);
        sendJson(res, payload);
      } catch {
        sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 400);
      }
      return;
    }

    if (req.method === 'POST') {
      const allowed = allowPostExact.has(subpath) || allowPostRegex.some((re) => re.test(subpath));
      if (!allowed) {
        sendJson(res, { ok: false, reason: 'admin_proxy_not_allowed' }, 404);
        return;
      }
      const body = await readJsonBody<unknown>(req);
      try {
        const payload = await runtimePost(subpath, body ?? {});
        sendJson(res, payload);
      } catch {
        sendJson(res, { ok: false, reason: 'runtime_request_failed' }, 400);
      }
      return;
    }

    sendJson(res, { ok: false, reason: 'method_not_allowed' }, 405);
    return;
  }

  if (pathname === '/api/admin/challenges/recent') {
    const auth = requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const limit = Math.max(1, Math.min(300, Number(requestUrl.searchParams.get('limit') ?? 60)));
    try {
      const payload = await serverGet(`/challenges/recent?limit=${limit}`);
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'server_unavailable' }, 400);
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
  log.info({ port }, 'web server listening');
});
