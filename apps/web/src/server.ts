import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createHealthStatus } from './health.js';
import { createChiefService, type ChiefChatRequest } from './chief.js';
import { createChief2Service } from './chief2/index.js';
import { createChiefDbGateway } from './chief/dbGateway.js';
import { log } from './logger.js';
import { availableWorldAliases, resolveWorldAssetPath, worldFilenameByAlias, worldFilenameForAlias, worldVersionByAlias } from './worldAssets.js';
import { resolveEscrowApprovalPolicy, signWsAuthToken } from '@arena/shared';
import { loadEnvFromFile } from './lib/env.js';
import { clearSessionCookie, readJsonBody, redirect, sendFile, sendFileCached, sendJson, setSessionCookieWithOptions } from './lib/http.js';
import { cookieSessionId, createSessionStore, type IdentityRecord, type Role, type SessionRecord } from './sessionStore.js';

loadEnvFromFile();

function resolveInternalServiceToken(): string {
  // SECURITY: Never derive tokens from private keys (predictable if key is compromised)
  // Always explicitly set INTERNAL_SERVICE_TOKEN
  const explicit = process.env.INTERNAL_SERVICE_TOKEN?.trim() || '';
  if (explicit) return explicit;
  // Removed insecure derivation from private keys
  return '';
}

const port = Number(process.env.PORT ?? 3000);
const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY?.trim() ?? '';
const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN?.trim() ?? '';
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? '';
const firebaseGoogleAuthEnabled = (process.env.FIREBASE_GOOGLE_AUTH_ENABLED ?? 'true') === 'true'
  && firebaseWebApiKey.length > 0
  && firebaseAuthDomain.length > 0;
const emailAuthEnabled = firebaseWebApiKey.length > 0;
const serverBase = process.env.WEB_API_BASE_URL ?? 'http://localhost:4000';
const runtimeBase = process.env.WEB_AGENT_RUNTIME_BASE_URL ?? 'http://localhost:4100';
const publicGameWsUrl = process.env.WEB_GAME_WS_URL ?? '';
const publicWorldAssetBaseUrl = process.env.PUBLIC_WORLD_ASSET_BASE_URL ?? '';
const defaultWorldAssetBaseUrl = '';
const allowedAuthOrigins = new Set(
  (process.env.ALLOWED_AUTH_ORIGINS?.trim()
    ? process.env.ALLOWED_AUTH_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : [
        'https://autobett.netlify.app',
        'https://www.autobett.netlify.app',
        'http://localhost:3000'
      ])
    .map((value) => {
      try {
        return new URL(value).origin.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
);
const wsAuthSecret = process.env.GAME_WS_AUTH_SECRET?.trim() || '';
const internalToken = resolveInternalServiceToken();
const redisUrl = process.env.REDIS_URL?.trim() || '';
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
const escrowApprovalChainIdRaw = Number(
  process.env.ESCROW_APPROVAL_CHAIN_ID
  ?? process.env.CHAIN_ID
  ?? Number.NaN
);
const escrowApprovalChainId = Number.isFinite(escrowApprovalChainIdRaw) ? escrowApprovalChainIdRaw : null;
const escrowApprovalChainHint = String(
  process.env.ESCROW_APPROVAL_CHAIN_HINT
  ?? process.env.CHAIN_RPC_URL
  ?? ''
).trim();
const escrowApprovalModeSepolia = String(process.env.ESCROW_APPROVAL_MODE_SEPOLIA ?? 'auto').trim().toLowerCase() === 'auto'
  ? 'auto'
  : 'manual';
const escrowApprovalModeMainnet = String(process.env.ESCROW_APPROVAL_MODE_MAINNET ?? 'manual').trim().toLowerCase() === 'auto'
  ? 'auto'
  : 'manual';
const escrowApprovalDefaultMode = String(process.env.ESCROW_APPROVAL_MODE_DEFAULT ?? 'manual').trim().toLowerCase() === 'auto'
  ? 'auto'
  : 'manual';
const escrowAutoApproveMaxWagerRaw = Number(process.env.ESCROW_AUTO_APPROVE_MAX_WAGER ?? Number.NaN);
const escrowAutoApproveMaxWager = Number.isFinite(escrowAutoApproveMaxWagerRaw) && escrowAutoApproveMaxWagerRaw > 0
  ? escrowAutoApproveMaxWagerRaw
  : null;
const escrowAutoApproveDailyCapRaw = Number(process.env.ESCROW_AUTO_APPROVE_DAILY_CAP ?? Number.NaN);
const escrowAutoApproveDailyCap = Number.isFinite(escrowAutoApproveDailyCapRaw) && escrowAutoApproveDailyCapRaw > 0
  ? escrowAutoApproveDailyCapRaw
  : null;
const escrowApprovalResolved = resolveEscrowApprovalPolicy({
  chainId: escrowApprovalChainId,
  chainHint: escrowApprovalChainHint,
  modeSepolia: escrowApprovalModeSepolia,
  modeMainnet: escrowApprovalModeMainnet,
  defaultMode: escrowApprovalDefaultMode,
  autoApproveMaxWager: escrowAutoApproveMaxWager,
  autoApproveDailyCap: escrowAutoApproveDailyCap
});
const chiefCooModeEnabled = process.env.CHIEF_COO_MODE_ENABLED === 'true';
const chiefDbGatewayEnabled = process.env.CHIEF_DB_GATEWAY_ENABLED === 'true';
const chiefSkillCatalogRoots = String(process.env.CHIEF_SKILL_ROOTS || '.agents/skills')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

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
if (isProduction && !redisUrl) {
  log.fatal('REDIS_URL must be set in production for auth session persistence. Refusing to start.');
  process.exit(1);
}
if (isProduction && adminEmails.size === 0) {
  log.fatal('ADMIN_EMAILS must be set in production. Refusing to start.');
  process.exit(1);
}
if (!isProduction && adminEmails.size === 0) {
  log.warn('ADMIN_EMAILS is empty. No configured admin email can access /admin or /users.');
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
  connectedBotCount?: number;
  disconnectedBotIds?: string[];
  lastBotWsErrorAt?: number | null;
  lastBotWsCloseById?: Record<string, { code?: number; reason?: string; at: number }>;
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

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const COOKIE_NAME = 'arena_sid';
const IDENTITY_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const sessionStore = await createSessionStore({
  redisUrl,
  isProduction,
  webStateFile
});
const chiefDbGateway = chiefDbGatewayEnabled
  ? await createChiefDbGateway({
      serverDatabaseUrl: process.env.DATABASE_URL,
      runtimeDatabaseUrl: process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL
    })
  : undefined;

async function extractSession(req: import('node:http').IncomingMessage): Promise<SessionRecord | null> {
  const sid = cookieSessionId(req);
  if (!sid) {
    return null;
  }
  return sessionStore.getSession(sid);
}

async function getIdentityFromReq(req: import('node:http').IncomingMessage): Promise<IdentityRecord | null> {
  const session = await extractSession(req);
  if (!session) {
    return null;
  }
  return sessionStore.getIdentity(session.sub);
}

async function reconcileIdentityLink(identity: IdentityRecord): Promise<void> {
  const subject = externalSubjectFromIdentity(identity);
  let linkLookupFailed = false;
  const link = await runtimeSubjectLink(subject).catch(() => {
    linkLookupFailed = true;
    return null;
  });
  if (!link) {
    // If canonical lookup is available and no link exists, treat session linkage as stale.
    // Re-provisioning here rebinds this subject to its own profile/wallet and prevents cross-user leakage.
    if (!linkLookupFailed) {
      await ensurePlayerProvisioned(identity);
      await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
      if (identity.profileId) {
        await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
      }
    }
    return;
  }
  const profileChanged = identity.profileId !== link.profileId;
  const walletChanged = identity.walletId !== link.walletId;
  if (!profileChanged && !walletChanged) {
    return;
  }

  identity.profileId = link.profileId;
  identity.walletId = link.walletId;
  await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
  if (identity.profileId) {
    await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
  }
}

async function requireRole(
  req: import('node:http').IncomingMessage,
  roles: Role[]
): Promise<{ ok: true; identity: IdentityRecord } | { ok: false }> {
  const identity = await getIdentityFromReq(req);
  if (!identity) {
    return { ok: false };
  }
  await reconcileIdentityLink(identity).catch(() => undefined);
  if (!roles.includes(identity.role)) {
    return { ok: false };
  }
  return { ok: true, identity };
}

function isSecureRequest(req: import('node:http').IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof proto === 'string' && proto.split(',')[0]?.trim().toLowerCase() === 'https') {
    return true;
  }
  return Boolean((req.socket as unknown as { encrypted?: boolean }).encrypted);
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

function externalSubjectFromIdentity(identity: IdentityRecord): string {
  return externalSubjectFromSub(identity.sub);
}

function externalSubjectFromSub(sub: string): string {
  const normalized = String(sub || '').trim();
  return normalized.includes(':') ? normalized : `google:${normalized}`;
}

function subjectHashForAdmin(subject: string): string {
  const normalized = String(subject || '').trim();
  if (!normalized) {
    return '';
  }
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function runtimeSubjectLink(subject: string): Promise<{
  profileId: string;
  walletId: string;
  linkedAt: number;
  updatedAt: number;
  continuitySource: string;
} | null> {
  const normalized = String(subject || '').trim();
  if (!normalized) {
    return null;
  }
  const payload = await runtimeGet<{
    ok?: boolean;
    link?: {
      profileId?: string;
      walletId?: string;
      linkedAt?: number;
      updatedAt?: number;
      continuitySource?: string;
    };
  }>(`/profiles/link?subject=${encodeURIComponent(normalized)}`).catch(() => null);
  if (!payload?.ok || !payload.link?.profileId || !payload.link?.walletId) {
    return null;
  }
  return {
    profileId: String(payload.link.profileId),
    walletId: String(payload.link.walletId),
    linkedAt: Number(payload.link.linkedAt || 0),
    updatedAt: Number(payload.link.updatedAt || 0),
    continuitySource: String(payload.link.continuitySource || 'unknown')
  };
}

async function serverGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${serverBase}${pathname}`, {
    headers: internalToken ? { 'x-internal-token': internalToken } : undefined
  });
  const payload = await response.json().catch(() => null) as { reason?: unknown; error?: unknown } | null;
  if (!response.ok) {
    const reason = String(payload?.reason || payload?.error || '').trim();
    throw new Error(reason ? `server_get_${response.status}:${reason}` : `server_get_${response.status}`);
  }
  return (payload as T | null) as T;
}

async function serverPost<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${serverBase}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {})
    },
    body: JSON.stringify(body ?? {})
  });
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload) {
    const reason = String((payload as { reason?: unknown; error?: unknown } | null)?.reason || (payload as { reason?: unknown; error?: unknown } | null)?.error || '').trim();
    throw new Error(reason ? `server_post_${response.status}:${reason}` : `server_post_${response.status}`);
  }
  return payload;
}

function upstreamErrorJson(error: unknown, fallbackReason: string, fallbackStatus = 400) {
  const message = String((error as Error)?.message || error || '').trim();
  const match = message.match(/^server_(get|post)_(\d+)(?::(.+))?$/i);
  if (match) {
    const status = Number(match[2] || fallbackStatus);
    const reason = String(match[3] || fallbackReason).trim() || fallbackReason;
    return {
      status: Number.isFinite(status) ? status : fallbackStatus,
      body: {
        ok: false,
        reason,
        upstreamStatus: Number.isFinite(status) ? status : fallbackStatus,
        source: 'server_proxy'
      }
    };
  }
  return {
    status: fallbackStatus,
    body: {
      ok: false,
      reason: fallbackReason,
      detail: message || fallbackReason,
      source: 'server_proxy'
    }
  };
}

function chainExplorerTxBase(chainId: number | null | undefined): string | null {
  if (!Number.isFinite(Number(chainId))) {
    return null;
  }
  const id = Number(chainId);
  if (id === 137) return 'https://polygonscan.com/tx/';
  if (id === 8453) return 'https://basescan.org/tx/';
  if (id === 84532) return 'https://sepolia.basescan.org/tx/';
  if (id === 11155111) return 'https://sepolia.etherscan.io/tx/';
  if (id === 1) return 'https://etherscan.io/tx/';
  return null;
}

const chiefService = createChiefService({
  runtimeGet,
  runtimePost,
  serverGet,
  runtimeProfiles,
  purgeSessionsForProfile: (profileId) => sessionStore.purgeSessionsForProfile(profileId),
  log,
  dbGateway: chiefDbGateway,
  cooModeEnabled: chiefCooModeEnabled,
  skillCatalogRoots: chiefSkillCatalogRoots
});

const chief2Service = createChief2Service({
  runtimeGet,
  runtimePost,
  serverGet,
  serverPost,
  adminActions: {
    userTeleport: async (params) => {
      const payload = {
        playerId: `u_${String(params.profileId || '').trim()}`,
        ...(typeof params.section === 'number' ? { section: params.section } : {}),
        ...(typeof params.x === 'number' ? { x: params.x } : {}),
        ...(typeof params.z === 'number' ? { z: params.z } : {})
      };
      return serverPost('/admin/teleport', payload);
    },
    userWalletAdjust: async (params) => {
      const profiles = await runtimeProfiles();
      const profile = profiles.find((entry) => entry.id === params.profileId);
      if (!profile) {
        throw new Error('profile_not_found');
      }
      const walletId = profile.wallet?.id ?? profile.walletId;
      if (!walletId) {
        throw new Error('wallet_not_found');
      }
      if (params.direction === 'credit') {
        return runtimePost('/house/transfer', {
          toWalletId: walletId,
          amount: params.amount,
          reason: params.reason
        });
      }
      const houseStatus = await runtimeGet<{ house?: { wallet?: { id?: string } } }>('/house/status');
      const houseWalletId = String(houseStatus?.house?.wallet?.id || '').trim();
      if (!houseWalletId) {
        throw new Error('house_wallet_missing');
      }
      return runtimePost(`/wallets/${walletId}/transfer`, {
        toWalletId: houseWalletId,
        amount: params.amount
      });
    },
    userLogout: async (params) => {
      return sessionStore.purgeSessionsForProfile(params.profileId);
    }
  },
  log
});

async function ensurePlayerProvisioned(identity: IdentityRecord): Promise<void> {
  let linkLookupFailed = false;
  const canonicalLink = await runtimeSubjectLink(externalSubjectFromIdentity(identity)).catch(() => {
    linkLookupFailed = true;
    return null;
  });
  if (canonicalLink?.profileId && canonicalLink?.walletId) {
    identity.profileId = canonicalLink.profileId;
    identity.walletId = canonicalLink.walletId;
    return;
  }

  // If canonical lookup is currently unavailable, never create or relink profiles.
  // This avoids duplicate subject->profile assignments during transient runtime failures.
  if (linkLookupFailed) {
    if (identity.profileId && identity.walletId) {
      return;
    }
    throw new Error('continuity_lookup_unavailable');
  }

  const externalSubject = externalSubjectFromIdentity(identity);

  const created = await runtimePost<{
    ok?: boolean;
    reason?: string;
    created?: boolean;
    profile?: PlayerProfile;
    wallet?: { id: string; balance: number };
  }>('/profiles/provision', {
    externalSubject,
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

type FirebaseAuthResult = {
  localId: string;
  email: string;
  displayName?: string;
};

type FirebaseLookupResult = {
  localId: string;
  email: string;
  displayName?: string;
  picture?: string;
  emailVerified: boolean;
};

function mapFirebaseAuthError(message: string): { reason: string; status: number } {
  const normalized = String(message || '').trim().toUpperCase();
  if (!normalized) {
    return { reason: 'firebase_auth_failed', status: 502 };
  }
  if (normalized === 'EMAIL_EXISTS') {
    return { reason: 'email_exists', status: 409 };
  }
  if (normalized === 'EMAIL_NOT_FOUND' || normalized === 'INVALID_PASSWORD' || normalized === 'INVALID_LOGIN_CREDENTIALS') {
    return { reason: 'invalid_credentials', status: 401 };
  }
  if (normalized === 'USER_DISABLED') {
    return { reason: 'user_disabled', status: 403 };
  }
  if (normalized === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
    return { reason: 'too_many_attempts', status: 429 };
  }
  if (normalized.startsWith('WEAK_PASSWORD')) {
    return { reason: 'weak_password', status: 400 };
  }
  if (normalized === 'INVALID_EMAIL') {
    return { reason: 'invalid_email', status: 400 };
  }
  if (normalized === 'OPERATION_NOT_ALLOWED') {
    return { reason: 'email_auth_disabled', status: 403 };
  }
  return { reason: `firebase_${normalized.toLowerCase()}`, status: 502 };
}

async function firebaseIdentityAuth(
  mode: 'signup' | 'login',
  email: string,
  password: string
): Promise<{ ok: true; result: FirebaseAuthResult } | { ok: false; reason: string; status: number }> {
  if (!firebaseWebApiKey) {
    return { ok: false, reason: 'email_auth_disabled', status: 403 };
  }

  const endpoint = mode === 'signup' ? 'accounts:signUp' : 'accounts:signInWithPassword';
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(firebaseWebApiKey)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    });
    const payload = await response.json().catch(() => ({})) as {
      localId?: unknown;
      email?: unknown;
      displayName?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok) {
      const mapped = mapFirebaseAuthError(String(payload?.error?.message || ''));
      return { ok: false, reason: mapped.reason, status: mapped.status };
    }

    const localId = String(payload.localId || '').trim();
    const normalizedEmail = String(payload.email || email || '').trim().toLowerCase();
    if (!localId || !normalizedEmail) {
      return { ok: false, reason: 'firebase_invalid_payload', status: 502 };
    }

    const displayName = String(payload.displayName || '').trim();
    return {
      ok: true,
      result: {
        localId,
        email: normalizedEmail,
        displayName: displayName || undefined
      }
    };
  } catch {
    return { ok: false, reason: 'firebase_unreachable', status: 503 };
  }
}

async function firebaseLookupIdToken(
  idToken: string
): Promise<{ ok: true; result: FirebaseLookupResult } | { ok: false; reason: string; status: number }> {
  if (!firebaseWebApiKey) {
    return { ok: false, reason: 'email_auth_disabled', status: 403 };
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ idToken })
      }
    );
    const payload = await response.json().catch(() => ({})) as {
      users?: Array<Record<string, unknown>>;
      error?: { message?: unknown };
    };
    if (!response.ok) {
      const mapped = mapFirebaseAuthError(String(payload?.error?.message || ''));
      return { ok: false, reason: mapped.reason, status: mapped.status };
    }

    const user = Array.isArray(payload.users) ? payload.users[0] : null;
    const localId = String(user?.localId || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!localId || !email) {
      return { ok: false, reason: 'firebase_invalid_payload', status: 502 };
    }

    return {
      ok: true,
      result: {
        localId,
        email,
        displayName: String(user?.displayName || '').trim() || undefined,
        picture: String(user?.photoUrl || '').trim() || undefined,
        emailVerified: String(user?.emailVerified ?? '').toLowerCase() === 'true'
      }
    };
  } catch {
    return { ok: false, reason: 'firebase_unreachable', status: 503 };
  }
}


function isSameOriginRequest(req: import('node:http').IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').trim().toLowerCase();
  if (!host) {
    return false;
  }
  const origin = String(req.headers.origin ?? '').trim();
  const referer = String(req.headers.referer ?? '').trim();
  const expected = `${isSecureRequest(req) ? 'https' : 'http'}://${host}`;

  const candidates = [origin, referer].filter(Boolean);
  if (candidates.length === 0) {
    // Netlify edge proxy may omit browser Origin/Referer when forwarding to Cloud Run.
    const netlifyForwarded = typeof req.headers['x-nf-request-id'] === 'string';
    return netlifyForwarded || !isProduction;
  }
  for (const value of candidates) {
    try {
      const parsed = new URL(value);
      const normalized = parsed.origin.toLowerCase();
      if (normalized !== expected.toLowerCase() && !allowedAuthOrigins.has(normalized)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
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

function htmlRouteToFile(
  pathname: string,
  identity: IdentityRecord | null,
  res: import('node:http').ServerResponse
): string | null {

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

  if (pathname === '/admin') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'admin-chief.html');
  }

  if (pathname === '/admin/chief') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'admin-chief.html');
  }

  if (pathname === '/admin/markets-lab') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'admin-markets-lab.html');
  }

  if (pathname === '/agents') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    redirect(res, '/admin');
    return null;
  }

  if (pathname === '/users') {
    if (!identity) {
      redirect(res, '/welcome');
      return null;
    }
    if (identity.role !== 'admin') {
      redirect(res, '/dashboard');
      return null;
    }
    return path.join(publicDir, 'users.html');
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

  // Auth/session APIs must never be cached by browser/CDN; stale 401/404s can
  // look like random forced logout loops.
  if (pathname.startsWith('/api/')) {
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    // Netlify edge may otherwise replay stale auth responses across sessions.
    res.setHeader('netlify-vary', 'cookie,query');
  }

  if (pathname === '/health') {
    const base = createHealthStatus();
    const [redisOk, runtimeOk, serverOk] = await Promise.all([
      sessionStore.ping().catch(() => false),
      fetch(`${runtimeBase}/status`, { headers: internalToken ? { 'x-internal-token': internalToken } : undefined })
        .then((r) => r.ok)
        .catch(() => false),
      fetch(`${serverBase}/health`).then((r) => r.ok).catch(() => false)
    ]);
    sendJson(res, {
      ...base,
      deps: {
        redis: redisOk,
        runtime: runtimeOk,
        server: serverOk
      }
    });
    return;
  }

  if (pathname === '/api/chief/v1/heartbeat') {
    const heartbeat = await chiefService.heartbeat();
    sendJson(res, {
      service: 'chief',
      timestamp: new Date().toISOString(),
      ...heartbeat
    }, heartbeat.ok ? 200 : 503);
    return;
  }

  if (pathname === '/api/chief/v1/skills' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const skills = await chiefService.listSkills();
    sendJson(res, { ok: true, skills });
    return;
  }

  if (pathname === '/api/chief/v1/runbooks' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    sendJson(res, { ok: true, runbooks: chiefService.listRunbooks() });
    return;
  }

  if (pathname === '/api/chief/v1/ops/state' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const state = await chiefService.getOpsState(auth.identity);
    sendJson(res, { ok: true, state });
    return;
  }

  if (pathname === '/api/admin/chief/workspace/bootstrap' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const payload = await chief2Service.bootstrap();
    sendJson(res, payload);
    return;
  }

  if (pathname === '/api/admin/chief/workspace/incidents' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const limit = Math.max(1, Math.min(200, Number(requestUrl.searchParams.get('limit') || 80)));
    sendJson(res, { ok: true, incidents: chief2Service.listIncidents(limit) });
    return;
  }

  if (pathname === '/api/admin/chief/workspace/runbooks' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    sendJson(res, { ok: true, runbooks: chief2Service.listRunbooks() });
    return;
  }

  if (pathname === '/api/admin/chief/workspace/command' && req.method === 'POST') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const body = await readJsonBody<{ message?: string; confirmToken?: string; context?: Record<string, unknown> }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }
    const payload = await chief2Service.command(auth.identity, body);
    sendJson(res, payload, payload.ok ? 200 : 400);
    return;
  }

  if (pathname === '/api/ops/runtime-sponsorship' && req.method === 'GET') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    try {
      const runtime = await runtimeGet<{
        wsAuthMismatchLikely?: boolean;
        connectedBotCount?: number;
        configuredBotCount?: number;
        house?: { wallet?: { id?: string; balance?: number } };
        profiles?: Array<{ walletId?: string; id?: string }>;
      }>('/status');
      sendJson(res, {
        ok: true,
        runtime: {
          wsAuthMismatchLikely: Boolean(runtime?.wsAuthMismatchLikely),
          connectedBotCount: Number(runtime?.connectedBotCount || 0),
          configuredBotCount: Number(runtime?.configuredBotCount || 0),
          houseWalletId: String(runtime?.house?.wallet?.id || ''),
          houseWalletBalance: Number(runtime?.house?.wallet?.balance || 0),
          samplePlayerWalletId: String(runtime?.profiles?.find((entry) => String(entry?.walletId || '').length > 0)?.walletId || '')
        }
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        reason: 'runtime_unavailable',
        detail: String((error as Error)?.message || 'unknown')
      }, 503);
    }
    return;
  }

  if (pathname === '/api/worlds') {
    sendJson(res, {
      canonicalAlias: 'mega',
      compatibilityAliases: ['train_world', 'train-world', 'base', 'plaza', 'world'],
      aliases: availableWorldAliases(),
      filenameByAlias: worldFilenameByAlias(),
      versionByAlias: worldVersionByAlias()
    });
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, {
      authEnabled: emailAuthEnabled,
      emailAuthEnabled,
      firebaseGoogleAuthEnabled,
      firebaseWebApiKey,
      firebaseAuthDomain,
      firebaseProjectId,
      localAuthEnabled,
      // Used by the static frontend to connect to backend infra.
      gameWsUrl: publicGameWsUrl,
      worldAssetBaseUrl: publicWorldAssetBaseUrl,
      escrowApprovalPolicy: {
        chainId: escrowApprovalChainId,
        chainHint: escrowApprovalChainHint,
        modeSepolia: escrowApprovalModeSepolia,
        modeMainnet: escrowApprovalModeMainnet,
        defaultMode: escrowApprovalDefaultMode,
        autoApproveMaxWager: escrowAutoApproveMaxWager,
        autoApproveDailyCap: escrowAutoApproveDailyCap,
        effective: escrowApprovalResolved
      }
    });
    return;
  }

  if (pathname === '/api/auth/local' && req.method === 'POST') {
    if (!localAuthEnabled) {
      sendJson(res, { ok: false, reason: 'local_auth_disabled' }, 403);
      return;
    }
    if (!localAdminPassword) {
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

    const normalizedUsername = username.toLowerCase();
    const normalizedAdminUsername = localAdminUsername.trim().toLowerCase();
    const isAdminLogin = normalizedAdminUsername.length > 0 && normalizedUsername === normalizedAdminUsername;

    if (password !== localAdminPassword) {
      sendJson(res, { ok: false, reason: 'invalid_credentials' }, 401);
      return;
    }
    if (isProduction && !isAdminLogin) {
      sendJson(res, { ok: false, reason: 'invalid_credentials' }, 401);
      return;
    }

    const now = Date.now();
    const sub = `local:${normalizedUsername}`;
    const existing = await sessionStore.getIdentity(sub);
    const role: Role = isAdminLogin ? 'admin' : 'player';
    const fallbackDisplayName = isAdminLogin ? 'Administrator' : username;
    const identity: IdentityRecord = existing ?? {
      sub,
      email: `${normalizedUsername}@local.user`,
      name: fallbackDisplayName,
      picture: '',
      role,
      profileId: null,
      walletId: null,
      username: null,
      displayName: fallbackDisplayName,
      createdAt: now,
      lastLoginAt: now
    };
    identity.email = `${normalizedUsername}@local.user`;
    identity.name = fallbackDisplayName;
    identity.displayName = identity.displayName || fallbackDisplayName;
    identity.role = role;
    identity.lastLoginAt = now;
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);

    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = {
      id: sid,
      sub: identity.sub,
      expiresAt: now + SESSION_TTL_MS
    };
    await sessionStore.setSession(session, SESSION_TTL_MS);
    await sessionStore.addSessionForSub(identity.sub, sid, SESSION_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }
    setSessionCookieWithOptions(res, COOKIE_NAME, sid, SESSION_TTL_MS, { secure: isSecureRequest(req) });

    // Allow local admins to play too.
    try {
      await ensurePlayerProvisioned(identity);
    } catch (error) {
      log.error({
        err: error,
        sub: identity.sub,
        reason: 'firebase_provision_failed'
      }, 'failed to provision firebase user');
      sendJson(res, {
        ok: false,
        reason: 'runtime_unavailable'
      }, 503);
      return;
    }
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      redirectTo: '/dashboard'
    });
    return;
  }


  if (pathname === '/api/auth/email' && req.method === 'POST') {
    if (!emailAuthEnabled) {
      sendJson(res, { ok: false, reason: 'email_auth_disabled' }, 403);
      return;
    }
    if (!isSameOriginRequest(req)) {
      sendJson(res, { ok: false, reason: 'origin_mismatch' }, 403);
      return;
    }

    const body = await readJsonBody<{ email?: string; password?: string; mode?: string; name?: string }>(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '').trim();
    const mode = String(body?.mode || '').trim().toLowerCase();
    const requestedName = String(body?.name || '').trim();
    if (!email || !password || (mode !== 'signup' && mode !== 'login')) {
      sendJson(res, { ok: false, reason: 'email_credentials_required' }, 400);
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      sendJson(res, { ok: false, reason: 'weak_password' }, 400);
      return;
    }

    const authResult = await firebaseIdentityAuth(mode === 'signup' ? 'signup' : 'login', email, password);
    if (!authResult.ok) {
      sendJson(res, { ok: false, reason: authResult.reason }, authResult.status);
      return;
    }

    const now = Date.now();
    const token = authResult.result;
    const sub = `firebase:${token.localId}`;
    const role: Role = adminEmails.has(token.email.toLowerCase()) ? 'admin' : 'player';
    const existing = await sessionStore.getIdentity(sub);
    const fallbackName = requestedName || token.displayName || token.email.split('@')[0] || 'Player';
    const identity: IdentityRecord = existing ?? {
      sub,
      email: token.email,
      name: fallbackName,
      picture: '',
      role,
      profileId: null,
      walletId: null,
      username: null,
      displayName: null,
      createdAt: now,
      lastLoginAt: now
    };

    identity.email = token.email;
    identity.name = identity.name || fallbackName;
    if (mode === 'signup' && requestedName) {
      identity.name = requestedName;
    }
    identity.role = role;
    identity.lastLoginAt = now;

    try {
      await ensurePlayerProvisioned(identity);
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return;
    }
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }

    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = {
      id: sid,
      sub: identity.sub,
      expiresAt: now + SESSION_TTL_MS
    };
    await sessionStore.setSession(session, SESSION_TTL_MS);
    await sessionStore.addSessionForSub(identity.sub, sid, SESSION_TTL_MS);
    setSessionCookieWithOptions(res, COOKIE_NAME, sid, SESSION_TTL_MS, { secure: isSecureRequest(req) });

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      redirectTo: '/dashboard'
    });
    return;
  }

  if (pathname === '/api/auth/firebase' && req.method === 'POST') {
    if (!firebaseGoogleAuthEnabled) {
      sendJson(res, { ok: false, reason: 'firebase_google_auth_disabled' }, 403);
      return;
    }
    if (!isSameOriginRequest(req)) {
      sendJson(res, { ok: false, reason: 'origin_mismatch' }, 403);
      return;
    }

    const body = await readJsonBody<{ idToken?: string }>(req);
    const idToken = String(body?.idToken || '').trim();
    if (!idToken) {
      sendJson(res, { ok: false, reason: 'id_token_required' }, 400);
      return;
    }

    const lookup = await firebaseLookupIdToken(idToken);
    if (!lookup.ok) {
      sendJson(res, { ok: false, reason: lookup.reason }, lookup.status);
      return;
    }
    if (!lookup.result.emailVerified) {
      sendJson(res, { ok: false, reason: 'email_not_verified' }, 401);
      return;
    }

    const now = Date.now();
    const token = lookup.result;
    const sub = `firebase:${token.localId}`;
    const role: Role = adminEmails.has(token.email.toLowerCase()) ? 'admin' : 'player';
    const existing = await sessionStore.getIdentity(sub);
    const fallbackName = token.displayName || token.email.split('@')[0] || 'Player';
    const identity: IdentityRecord = existing ?? {
      sub,
      email: token.email,
      name: fallbackName,
      picture: token.picture || '',
      role,
      profileId: null,
      walletId: null,
      username: null,
      displayName: null,
      createdAt: now,
      lastLoginAt: now
    };

    identity.email = token.email;
    identity.name = token.displayName || identity.name || fallbackName;
    identity.picture = token.picture || identity.picture;
    identity.role = role;
    identity.lastLoginAt = now;

    try {
      await ensurePlayerProvisioned(identity);
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return;
    }
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }

    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = {
      id: sid,
      sub: identity.sub,
      expiresAt: now + SESSION_TTL_MS
    };
    await sessionStore.setSession(session, SESSION_TTL_MS);
    await sessionStore.addSessionForSub(identity.sub, sid, SESSION_TTL_MS);
    setSessionCookieWithOptions(res, COOKIE_NAME, sid, SESSION_TTL_MS, { secure: isSecureRequest(req) });

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      redirectTo: '/dashboard'
    });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const sid = cookieSessionId(req);
    if (sid) {
      const session = await sessionStore.getSession(sid);
      await sessionStore.deleteSession(sid);
      if (session?.sub) {
        await sessionStore.removeSessionForSub(session.sub, sid);
      }
    }
    clearSessionCookie(res, COOKIE_NAME);
    sendJson(res, { ok: true });
    return;
  }

  if (pathname === '/api/session') {
    const identity = await getIdentityFromReq(req);
    if (!identity) {
      const optional = String(requestUrl.searchParams.get('optional') || '').trim();
      if (optional === '1' || optional.toLowerCase() === 'true') {
        sendJson(res, { ok: false, user: null, reason: 'unauthorized' }, 200);
        return;
      }
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    await reconcileIdentityLink(identity).catch(() => undefined);
    sendJson(res, { ok: true, user: sanitizeUser(identity) });
    return;
  }

  if (pathname === '/api/player/me') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      const optional = String(requestUrl.searchParams.get('optional') || '').trim();
      if (optional === '1' || optional.toLowerCase() === 'true') {
        sendJson(res, { ok: false, user: null, reason: 'unauthorized' }, 200);
        return;
      }
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(identity);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return;
      }
    }

    let profiles: PlayerProfile[] = [];
    try {
      profiles = await runtimeProfiles();
    } catch {
      // Degraded mode: keep signed-in players playable when runtime has a brief outage.
      // We can still issue wsAuth from cached identity profile/wallet linkage.
      if (identity.profileId && identity.walletId) {
        const fallbackProfile: PlayerProfile = {
          id: identity.profileId,
          username: identity.username || 'player',
          displayName: identity.displayName || identity.name || 'Player',
          walletId: identity.walletId,
          ownedBotIds: [],
          wallet: {
            id: identity.walletId,
            balance: 0
          }
        };
        sendJson(res, {
          ok: true,
          degraded: true,
          user: sanitizeUser(identity),
          profile: fallbackProfile,
          bots: [],
          bot: {
            id: null,
            connected: null
          },
          wsAuth: wsAuthForIdentity(identity)
        });
        return;
      }
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return;
    }
    let profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile) {
      // Preserve identity continuity: relink from canonical subject mapping
      // instead of creating a new profile on transient list misses.
      const canonicalLink = await runtimeSubjectLink(externalSubjectFromIdentity(identity)).catch(() => null);
      if (canonicalLink?.profileId && canonicalLink?.walletId) {
        identity.profileId = canonicalLink.profileId;
        identity.walletId = canonicalLink.walletId;
        await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
        if (identity.profileId) {
          await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
        }
        profile = profiles.find((entry) => entry.id === identity.profileId) ?? null;
      }
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_unavailable' }, 503);
        return;
      }
    }

    identity.walletId = profile.wallet?.id ?? profile.walletId;
    identity.displayName = profile.displayName;
    identity.username = profile.username;
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }

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
    const ownerBot = bots[0] ?? null;

    sendJson(res, {
      ok: true,
      user: sanitizeUser(identity),
      profile,
      bots,
      bot: {
        id: ownerBot?.id ?? null,
        connected: typeof ownerBot?.connected === 'boolean' ? ownerBot.connected : null
      },
      wsAuth: wsAuthForIdentity(identity)
    });
    return;
  }

  if (pathname === '/api/player/identity-wallet') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(identity);
        await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return;
      }
    }

    const link = await runtimeSubjectLink(externalSubjectFromIdentity(identity));
    const profiles = await runtimeProfiles().catch(() => []);
    const profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    sendJson(res, {
      ok: true,
      sub: identity.sub,
      email: identity.email,
      profileId: identity.profileId,
      walletId: identity.walletId,
      walletAddress: profile?.wallet?.address ?? null,
      continuitySource: link?.continuitySource ?? 'web-session-store',
      linkedAt: link?.linkedAt || identity.createdAt,
      lastVerifiedAt: Date.now()
    });
    return;
  }

  if (pathname === '/api/player/directory') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
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
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await ensurePlayerProvisioned(identity);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return;
      }
    }

    let profiles: PlayerProfile[] = [];
    try {
      profiles = await runtimeProfiles();
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return;
    }
    let profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile) {
      // Preserve identity continuity: if runtime profile listing is briefly stale,
      // relink from canonical subject mapping instead of reprovisioning a new profile.
      const canonicalLink = await runtimeSubjectLink(externalSubjectFromIdentity(identity)).catch(() => null);
      if (canonicalLink?.profileId && canonicalLink?.walletId) {
        identity.profileId = canonicalLink.profileId;
        identity.walletId = canonicalLink.walletId;
        await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
        if (identity.profileId) {
          await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
        }
        profile = profiles.find((entry) => entry.id === identity.profileId) ?? null;
      }
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_unavailable' }, 503);
        return;
      }
    }

    const walletId = profile.wallet?.id ?? profile.walletId;
    identity.walletId = walletId;
    identity.username = profile.username;
    identity.displayName = profile.displayName;
    await sessionStore.setIdentity(identity, IDENTITY_TTL_MS);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, IDENTITY_TTL_MS);
    }
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
    const auth = await requireRole(req, ['player', 'admin']);
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
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/withdraw' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/transfer' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/escrow-history') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const limit = Math.max(1, Math.min(120, Number(requestUrl.searchParams.get('limit') ?? 30)));
    try {
      const payload = await serverGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(
        `/escrow/events/recent?playerId=${encodeURIComponent(auth.identity.profileId)}&limit=${limit}`
      );
      sendJson(res, { ok: true, recent: Array.isArray(payload?.recent) ? payload.recent : [] });
    } catch {
      sendJson(res, { ok: false, reason: 'escrow_history_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/activity') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const limit = Math.max(1, Math.min(120, Number(requestUrl.searchParams.get('limit') ?? 30)));
    type OnchainActivityPayload = {
      ok?: boolean;
      chainId?: number | null;
      address?: string;
      tokenSymbol?: string;
      recent?: Array<{
        kind?: string;
        direction?: string;
        txHash?: string;
        amount?: string;
        from?: string;
        to?: string;
        method?: string | null;
        methodLabel?: string | null;
        txFrom?: string | null;
        txTo?: string | null;
        nativeValueEth?: string | null;
        timestampMs?: number | null;
      }>;
    };
    type MarketPositionActivityPayload = {
      ok?: boolean;
      recent?: Array<{
        id?: string;
        marketId?: string;
        marketQuestion?: string;
        side?: 'yes' | 'no';
        stake?: number;
        price?: number;
        shares?: number;
        status?: 'open' | 'won' | 'lost' | 'voided';
        payout?: number | null;
        settlementReason?: string | null;
        clobOrderId?: string | null;
        createdAt?: number;
        settledAt?: number | null;
      }>;
    };
    const onchainFallback: OnchainActivityPayload = {
      ok: false,
      chainId: null,
      address: '',
      tokenSymbol: 'TOKEN',
      recent: []
    };
    try {
      const [escrow, onchain] = await Promise.all([
        serverGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(
          `/escrow/events/recent?playerId=${encodeURIComponent(auth.identity.profileId)}&limit=${limit}`
        ).catch(() => ({ recent: [] })),
        runtimeGet<OnchainActivityPayload>(`/wallets/${encodeURIComponent(auth.identity.walletId)}/activity?limit=${limit}`)
          .catch(() => onchainFallback)
      ]);
      const marketPositions = await serverGet<MarketPositionActivityPayload>(
        `/markets/player/positions?playerId=${encodeURIComponent(auth.identity.profileId)}&limit=${limit}`
      ).catch(() => ({ ok: false, recent: [] }));

      const chainId = Number(onchain?.chainId ?? Number.NaN);
      const txBase = chainExplorerTxBase(Number.isFinite(chainId) ? chainId : null);

      const escrowActivity = (Array.isArray(escrow?.recent) ? escrow.recent : []).map((entry) => {
        const txHash = String(entry?.txHash || '');
        const at = Number(entry?.at ?? 0);
        return {
          kind: 'escrow',
          at: Number.isFinite(at) && at > 0 ? at : Date.now(),
          txHash: txHash || null,
          txUrl: txHash && txBase ? `${txBase}${txHash}` : null,
          phase: String(entry?.phase || ''),
          outcome: String(entry?.outcome || ''),
          challengeId: String(entry?.challengeId || ''),
          activitySource: String(entry?.activitySource || ''),
          wager: Number(entry?.wager ?? entry?.amount ?? 0),
          payout: Number(entry?.payout ?? 0),
          ok: entry?.ok !== false
        };
      });

      const onchainActivity = (Array.isArray(onchain?.recent) ? onchain.recent : []).map((entry) => {
        const txHash = String(entry?.txHash || '');
        const at = Number(entry?.timestampMs ?? 0);
        return {
          kind: 'onchain_transfer',
          at: Number.isFinite(at) && at > 0 ? at : Date.now(),
          txHash: txHash || null,
          txUrl: txHash && txBase ? `${txBase}${txHash}` : null,
          direction: String(entry?.direction || 'unknown'),
          amount: String(entry?.amount || '0'),
          from: String(entry?.from || ''),
          to: String(entry?.to || ''),
          tokenSymbol: String(onchain?.tokenSymbol || 'TOKEN'),
          method: entry?.method == null ? null : String(entry.method),
          methodLabel: entry?.methodLabel == null ? null : String(entry.methodLabel),
          txFrom: entry?.txFrom == null ? null : String(entry.txFrom),
          txTo: entry?.txTo == null ? null : String(entry.txTo),
          nativeValueEth: entry?.nativeValueEth == null ? null : String(entry.nativeValueEth)
        };
      });
      const marketActivity = (Array.isArray(marketPositions?.recent) ? marketPositions.recent : []).map((entry) => {
        const settledAt = Number(entry?.settledAt ?? 0);
        const createdAt = Number(entry?.createdAt ?? 0);
        const at = Number.isFinite(settledAt) && settledAt > 0 ? settledAt : createdAt;
        return {
          kind: 'market_position',
          at: Number.isFinite(at) && at > 0 ? at : Date.now(),
          positionId: String(entry?.id || ''),
          marketId: String(entry?.marketId || ''),
          marketQuestion: String(entry?.marketQuestion || entry?.marketId || ''),
          side: String(entry?.side || ''),
          stake: Number(entry?.stake ?? 0),
          price: Number(entry?.price ?? 0),
          shares: Number(entry?.shares ?? 0),
          status: String(entry?.status || 'open'),
          payout: entry?.payout == null ? null : Number(entry.payout),
          settlementReason: entry?.settlementReason == null ? null : String(entry.settlementReason),
          clobOrderId: entry?.clobOrderId == null ? null : String(entry.clobOrderId)
        };
      });

      const activity = [...escrowActivity, ...onchainActivity, ...marketActivity]
        .sort((a, b) => b.at - a.at)
        .slice(0, limit);

      sendJson(res, {
        ok: true,
        chainId: Number.isFinite(chainId) ? chainId : null,
        explorerTxBaseUrl: txBase,
        walletAddress: String(onchain?.address || ''),
        activity
      });
    } catch {
      sendJson(res, { ok: false, reason: 'activity_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/summary') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    try {
      const runtimeResponse = await fetch(`${runtimeBase}/wallets/${auth.identity.walletId}/summary`, {
        headers: internalToken ? { 'x-internal-token': internalToken } : undefined
      });
      const payload = await runtimeResponse.json().catch(() => null);
      if (!runtimeResponse.ok) {
        sendJson(
          res,
          payload && typeof payload === 'object' ? payload : { ok: false, reason: 'wallet_summary_unavailable' },
          runtimeResponse.status
        );
        return;
      }
      sendJson(res, payload ?? { ok: false, reason: 'wallet_summary_unavailable' });
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_summary_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/prepare-escrow' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }
    const activePolicy = resolveEscrowApprovalPolicy({
      chainId: escrowApprovalChainId,
      chainHint: escrowApprovalChainHint,
      modeSepolia: escrowApprovalModeSepolia,
      modeMainnet: escrowApprovalModeMainnet,
      defaultMode: escrowApprovalDefaultMode,
      autoApproveMaxWager: escrowAutoApproveMaxWager,
      autoApproveDailyCap: escrowAutoApproveDailyCap
    });
    if (activePolicy.mode === 'auto') {
      sendJson(res, {
        ok: true,
        mode: activePolicy.mode,
        network: activePolicy.network,
        reason: activePolicy.reason,
        results: [{
          walletId: auth.identity.walletId,
          ok: true,
          source: 'super_agent',
          status: 'ready'
        }]
      });
      return;
    }

    try {
      const payload = await runtimePost<Record<string, unknown>>('/wallets/onchain/prepare-escrow', {
        amount,
        walletIds: [auth.identity.walletId]
      });
      sendJson(res, {
        ...payload,
        mode: activePolicy.mode,
        network: activePolicy.network
      });
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/wallet/export-key' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  if (pathname === '/api/player/profile' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
      await sessionStore.setIdentity(auth.identity, IDENTITY_TTL_MS);
      if (auth.identity.profileId) {
        await sessionStore.addSubForProfile(auth.identity.profileId, auth.identity.sub, IDENTITY_TTL_MS);
      }
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'profile_update_failed' }, 400);
    }
    return;
  }

  if (pathname === '/api/player/bot/config' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
    const auth = await requireRole(req, ['player', 'admin']);
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

  if (pathname === '/api/chief/v1/chat' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }

    const body = await readJsonBody<ChiefChatRequest>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    const response = await chiefService.handleChat({
      identity: auth.identity,
      request: body
    });
    sendJson(res, response, response.ok ? 200 : 400);
    return;
  }

  // Ops super-agent is admin-only. Players use the scoped chief-of-staff endpoint below.
  if (pathname === '/api/super-agent/chat' && req.method === 'POST') {
    const auth = await requireRole(req, ['admin']);
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

  const isPlayerHouseChat =
    (pathname === '/api/player/house/chat' || pathname === '/api/player/chief/chat') &&
    req.method === 'POST';
  if (isPlayerHouseChat) {
    const auth = await requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return;
    }
    const body = await readJsonBody<ChiefChatRequest>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }
    const response = await chiefService.handleChat({
      identity: auth.identity,
      request: body,
      forcedMode: 'player'
    });
    const legacyPayload = {
      ok: response.ok,
      reply: response.reply,
      actions: response.actions.map((entry) => `${entry.tool}:${entry.status}`),
      requiresConfirmation: response.requiresConfirmation,
      confirmToken: response.confirmToken,
      intent: response.intent,
      mode: response.mode,
      errors: response.errors,
      stateSnapshot: response.stateSnapshot
    };
    sendJson(res, legacyPayload, response.ok ? 200 : 400);
    return;
  }

  if (pathname === '/api/player/presence' && req.method === 'POST') {
    const auth = await requireRole(req, ['player', 'admin']);
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
      // Presence should not hard-fail gameplay when runtime heartbeat is degraded.
      sendJson(res, { ok: false, state, reason: 'presence_runtime_degraded' }, 202);
    }
    return;
  }

  // Admin-only proxy routes to keep runtime ops out of the browser.
  if (pathname.startsWith('/api/admin/runtime')) {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }

    const subpath = pathname.slice('/api/admin/runtime'.length) || '/';
    const allowGet = new Set(['/status', '/super-agent/status', '/super-agent/ethskills', '/house/status', '/onchain/status']);
    const allowPostExact = new Set([
      '/super-agent/config',
      '/capabilities/wallet',
      '/secrets/openrouter',
      '/super-agent/delegate/apply',
      '/super-agent/ethskills/sync',
      '/house/config',
      '/house/transfer',
      '/house/refill',
      '/wallets/onchain/prepare-escrow',
      '/profiles/create',
      '/agents/reconcile',
      '/super-agent/chat'
    ]);
    const allowPostRegex = [
      /^\/wallets\/[^/]+\/(fund|withdraw|export-key|transfer)$/i,
      /^\/agents\/[^/]+\/config$/i,
      /^\/profiles\/[^/]+\/bots\/create$/i
    ];

    if (subpath === '/markets' && req.method === 'GET') {
      try {
        const payload = await serverGet('/admin/markets');
        sendJson(res, payload);
      } catch (error) {
        const upstream = upstreamErrorJson(error, 'server_unavailable', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return;
    }
    if (subpath === '/markets/live' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(200, Number(requestUrl.searchParams.get('limit') || 60)));
      const query = String(requestUrl.searchParams.get('query') || '').trim();
      const queryBits = new URLSearchParams({
        limit: String(limit)
      });
      if (query) queryBits.set('query', query);
      try {
        const payload = await serverGet(`/admin/markets/live?${queryBits.toString()}`);
        sendJson(res, payload);
      } catch (error) {
        const upstream = upstreamErrorJson(error, 'server_unavailable', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return;
    }
    if (
      (subpath === '/markets/sync'
      || subpath === '/markets/activate'
      || subpath === '/markets/deactivate'
      || subpath === '/markets/config')
      && req.method === 'POST'
    ) {
      const body = await readJsonBody<unknown>(req);
      try {
        const payload = await serverPost(`/admin${subpath}`, body ?? {});
        sendJson(res, payload);
      } catch (error) {
        const upstream = upstreamErrorJson(error, 'server_request_failed', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return;
    }

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

  if (pathname === '/api/admin/users') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    try {
      const [profiles, presencePayload] = await Promise.all([
        runtimeProfiles().catch(() => []),
        serverGet<{ ok?: boolean; players?: Array<{ playerId: string; serverId: string; x: number; z: number; updatedAt: number }> }>('/presence')
          .catch(() => ({ players: [] }))
      ]);

      const presenceByPlayerId = new Map<string, { serverId: string; x: number; z: number; updatedAt: number }>();
      for (const entry of presencePayload.players ?? []) {
        if (entry?.playerId) {
          presenceByPlayerId.set(entry.playerId, {
            serverId: String(entry.serverId || ''),
            x: Number(entry.x || 0),
            z: Number(entry.z || 0),
            updatedAt: Number(entry.updatedAt || 0)
          });
        }
      }

      const users = await Promise.all(profiles.map(async (profile) => {
        const playerId = `u_${profile.id}`;
        const presence = presenceByPlayerId.get(playerId) ?? null;
        const subs = await sessionStore.listSubsForProfile(profile.id).catch(() => []);
        const firstSub = String(subs[0] || '').trim();
        const continuity = firstSub ? await runtimeSubjectLink(externalSubjectFromSub(firstSub)).catch(() => null) : null;
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
          subjectHash: firstSub ? subjectHashForAdmin(firstSub) : null,
          continuitySource: continuity?.continuitySource ?? null
        };
      }));

      sendJson(res, { ok: true, users });
    } catch {
      sendJson(res, { ok: false, reason: 'admin_users_failed' }, 503);
    }
    return;
  }

  const adminTeleportMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/teleport$/);
  if (adminTeleportMatch && req.method === 'POST') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const profileId = String(adminTeleportMatch[1] ?? '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return;
    }
    const body = await readJsonBody<{ x?: number; z?: number; section?: number }>(req);
    const payload = {
      playerId: `u_${profileId}`,
      x: body?.x,
      z: body?.z,
      section: body?.section
    };
    try {
      const response = await serverPost('/admin/teleport', payload);
      sendJson(res, response);
    } catch {
      sendJson(res, { ok: false, reason: 'server_unavailable' }, 503);
    }
    return;
  }

  const adminWalletAdjustMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/wallet\/adjust$/);
  if (adminWalletAdjustMatch && req.method === 'POST') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const profileId = String(adminWalletAdjustMatch[1] ?? '').trim();
    const body = await readJsonBody<{ amount?: number; direction?: 'credit' | 'debit'; reason?: string }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const direction = body?.direction === 'debit' ? 'debit' : 'credit';
    const reason = String(body?.reason ?? 'admin_adjust').trim() || 'admin_adjust';
    if (!profileId || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_adjust_payload' }, 400);
      return;
    }

    try {
      const profiles = await runtimeProfiles();
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
        return;
      }
      const walletId = profile.wallet?.id ?? profile.walletId;
      if (!walletId) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return;
      }

      if (direction === 'credit') {
        const payload = await runtimePost('/house/transfer', { toWalletId: walletId, amount, reason });
        sendJson(res, { ok: true, direction, amount, walletId, runtime: payload });
        return;
      }

      const houseStatus = await runtimeGet<{ ok?: boolean; house?: { wallet?: { id?: string } } }>('/house/status');
      const houseWalletId = String(houseStatus?.house?.wallet?.id ?? '').trim();
      if (!houseWalletId) {
        sendJson(res, { ok: false, reason: 'house_wallet_missing' }, 500);
        return;
      }
      const payload = await runtimePost(`/wallets/${walletId}/transfer`, { toWalletId: houseWalletId, amount });
      sendJson(res, { ok: true, direction, amount, walletId, runtime: payload });
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return;
  }

  const adminLogoutMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/logout$/);
  if (adminLogoutMatch && req.method === 'POST') {
    const auth = await requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return;
    }
    const profileId = String(adminLogoutMatch[1] ?? '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return;
    }
    try {
      const deleted = await sessionStore.purgeSessionsForProfile(profileId);
      sendJson(res, { ok: true, profileId, sessionsDeleted: deleted });
    } catch {
      sendJson(res, { ok: false, reason: 'logout_failed' }, 500);
    }
    return;
  }

  if (pathname === '/api/admin/challenges/recent') {
    const auth = await requireRole(req, ['admin']);
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
      const canonicalFilename = worldFilenameForAlias(alias) || worldFilenameForAlias('mega') || 'train_station_mega_world.glb';
      const normalizedBase = String(publicWorldAssetBaseUrl || defaultWorldAssetBaseUrl).replace(/\/+$/, '');
      if (!normalizedBase) {
        log.error(
          {
            reason: 'local_world_missing_no_fallback',
            alias,
            canonicalFilename
          },
          'world asset missing locally and no fallback base configured'
        );
        res.statusCode = 404;
        res.end('World asset unavailable');
        return;
      }
      const versionByAlias = worldVersionByAlias();
      const normalizedAlias = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
      const version = String(versionByAlias[normalizedAlias] || versionByAlias.mega || '');
      let fallbackUrl = `${normalizedBase}/assets/world/mega.glb`;
      if (version) {
        fallbackUrl += `${fallbackUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
      }
      log.warn(
        {
          reason: 'local_world_missing',
          alias,
          canonicalFilename,
          fallbackUrl
        },
        'world asset missing locally; redirecting to canonical cloud asset'
      );
      res.statusCode = 302;
      res.setHeader('location', fallbackUrl);
      res.end();
      return;
    }
    await sendFileCached(req, res, worldPath, 'model/gltf-binary', {
      cacheControl: 'public, max-age=31536000, immutable'
    });
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

  if (pathname.startsWith('/css/')) {
    const cssPath = path.join(publicDir, pathname);
    await sendFile(res, cssPath, 'text/css; charset=utf-8');
    return;
  }

  if (pathname === '/runtime-config.js') {
    await sendFile(res, path.join(publicDir, 'runtime-config.js'), 'text/javascript; charset=utf-8');
    return;
  }

  if (pathname === '/styles.css') {
    await sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
    return;
  }

  const identity = await getIdentityFromReq(req);
  const htmlFile = htmlRouteToFile(pathname, identity, res);
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
  sessionStore.persistIfSupported();
}, 10000);
webAutosave.unref();

process.on('SIGINT', () => {
  sessionStore.persistIfSupported();
  process.exit(0);
});

process.on('SIGTERM', () => {
  sessionStore.persistIfSupported();
  process.exit(0);
});

server.listen(port, () => {
  log.info({
    port,
    runtimeBase,
    serverBase,
    internalTokenConfigured: Boolean(internalToken),
    wsAuthConfigured: Boolean(wsAuthSecret),
    chiefReady: true
  }, 'web server listening');
});
