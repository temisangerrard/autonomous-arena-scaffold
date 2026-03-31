import path from 'node:path';
import { createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { signWsAuthToken } from '@arena/shared';
import { createChiefService } from '../chief.js';
import { createChief2Service } from '../chief2/index.js';
import { createChiefDbGateway } from '../chief/dbGateway.js';
import { rewriteEmailIdentityBindings } from '../adminWalletRelink.js';
import { findMatchingContinuityLink, preferEmailIdentityOverContinuity } from '../identityContinuity.js';
import { log } from '../logger.js';
import { redirect } from '../lib/http.js';
import { createSessionStore, cookieSessionId, type IdentityRecord, type Role, type SessionRecord } from '../sessionStore.js';
import type {
  FirebaseAuthResult,
  FirebaseGoogleExchangeResult,
  FirebaseLookupResult,
  GoogleTokenInfo,
  PlayerProfile,
  RuntimeStatusPayload,
  ServerConfig,
  ServerContext
} from './types.js';

// Dev-only auth bypass. Never active when NODE_ENV=production, even if env var is set.
const DEV_IDENTITY: IdentityRecord | null =
  process.env.DEV_BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'production'
    ? {
        sub: 'dev-bypass',
        email: 'dev@local',
        name: 'Dev Player',
        picture: '',
        role: 'player' as const,
        profileId: 'dev-player',
        walletId: null,
        username: 'dev',
        displayName: 'Dev Player',
        createdAt: 0,
        lastLoginAt: 0
      }
    : null;

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

export async function createServerContext(config: ServerConfig): Promise<ServerContext> {
  const sessionTtlMs = config.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 7;
  const identityTtlMs = config.identityTtlMs ?? 1000 * 60 * 60 * 24 * 30;
  const googleAuthClient = new OAuth2Client(config.googleClientId || undefined);

  const sessionStore = await createSessionStore({
    redisUrl: config.redisUrl ?? '',
    isProduction: Boolean(config.isProduction),
    webStateFile: config.webStateFile ?? path.resolve(process.cwd(), 'output', 'web-auth-state.json')
  });

  const chiefDbGateway = config.chiefDbGatewayEnabled
    ? await createChiefDbGateway({
        serverDatabaseUrl: process.env.DATABASE_URL,
        runtimeDatabaseUrl: process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL
      })
    : undefined;

  function isSecureRequest(req: import('node:http').IncomingMessage): boolean {
    const forwarded = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof proto === 'string' && proto.split(',')[0]?.trim().toLowerCase() === 'https') {
      return true;
    }
    return Boolean((req.socket as unknown as { encrypted?: boolean }).encrypted);
  }

  async function runtimeGet<T>(pathname: string): Promise<T> {
    const response = await fetch(`${config.runtimeBase}${pathname}`, {
      headers: config.internalToken ? { 'x-internal-token': config.internalToken } : undefined
    });
    if (!response.ok) {
      throw new Error(`runtime_get_${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  async function runtimePost<T>(pathname: string, body: unknown): Promise<T> {
    const response = await fetch(`${config.runtimeBase}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.internalToken ? { 'x-internal-token': config.internalToken } : {})
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

  async function runtimeStatusOk(): Promise<boolean> {
    return fetch(`${config.runtimeBase}/status`, {
      headers: config.internalToken ? { 'x-internal-token': config.internalToken } : undefined
    }).then((r) => r.ok).catch(() => false);
  }

  async function serverGet<T>(pathname: string): Promise<T> {
    const response = await fetch(`${config.serverBase}${pathname}`, {
      headers: config.internalToken ? { 'x-internal-token': config.internalToken } : undefined
    });
    const payload = await response.json().catch(() => null) as { reason?: unknown; error?: unknown } | null;
    if (!response.ok) {
      const reason = String(payload?.reason || payload?.error || '').trim();
      throw new Error(reason ? `server_get_${response.status}:${reason}` : `server_get_${response.status}`);
    }
    return payload as T;
  }

  async function serverPost<T>(pathname: string, body: unknown): Promise<T> {
    const response = await fetch(`${config.serverBase}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.internalToken ? { 'x-internal-token': config.internalToken } : {})
      },
      body: JSON.stringify(body ?? {})
    });
    const payload = await response.json().catch(() => null) as T | null;
    if (!response.ok || !payload) {
      const reason = String((payload as { reason?: unknown; error?: unknown } | null)?.reason || (payload as { error?: unknown } | null)?.error || '').trim();
      throw new Error(reason ? `server_post_${response.status}:${reason}` : `server_post_${response.status}`);
    }
    return payload;
  }

  async function serverHealthOk(): Promise<boolean> {
    return fetch(`${config.serverBase}/health`).then((r) => r.ok).catch(() => false);
  }

  function upstreamErrorJson(error: unknown, fallbackReason: string, fallbackStatus = 400) {
    const message = String((error as Error)?.message || error || '').trim();
    const match = message.match(/^server_(get|post)_(\d+)(?::(.+))?$/i);
    if (match) {
      const status = Number(match[2] || fallbackStatus);
      const reason = String(match[3] || fallbackReason).trim() || fallbackReason;
      return {
        status: Number.isFinite(status) ? status : fallbackStatus,
        body: { ok: false, reason, upstreamStatus: Number.isFinite(status) ? status : fallbackStatus, source: 'server_proxy' }
      };
    }
    return {
      status: fallbackStatus,
      body: { ok: false, reason: fallbackReason, detail: message || fallbackReason, source: 'server_proxy' }
    };
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
    if (!normalized) return '';
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
    if (!normalized) return null;
    const payload = await runtimeGet<any>(`/profiles/link?subject=${encodeURIComponent(normalized)}`).catch(() => null);
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

  function candidatePlayerIds(profileId: string): string[] {
    const normalized = String(profileId || '').trim();
    if (!normalized) return [];
    if (normalized.startsWith('u_')) {
      return [normalized, normalized.slice(2)].filter(Boolean);
    }
    return [normalized, `u_${normalized}`];
  }

  async function extractSession(req: import('node:http').IncomingMessage): Promise<SessionRecord | null> {
    const sid = cookieSessionId(req);
    if (!sid) return null;
    return sessionStore.getSession(sid);
  }

  async function getIdentityFromReq(req: import('node:http').IncomingMessage): Promise<IdentityRecord | null> {
    if (DEV_IDENTITY) return DEV_IDENTITY;
    const session = await extractSession(req);
    if (!session) return null;
    return sessionStore.getIdentity(session.sub);
  }

  async function upsertIdentitySubjectAliases(identity: IdentityRecord, subjects: string[]): Promise<void> {
    if (!identity.profileId || !identity.walletId) return;
    const aliases = [...new Set(subjects.map((entry) => String(entry || '').trim()).filter(Boolean))];
    for (const subject of aliases) {
      await runtimePost('/profiles/link', {
        subject,
        profileId: identity.profileId,
        walletId: identity.walletId
      }).catch(() => null);
    }
  }

  async function reconcileIdentityLink(identity: IdentityRecord): Promise<void> {
    const subject = externalSubjectFromIdentity(identity);
    const link = await runtimeSubjectLink(subject).catch(() => null);
    const emailIdentities = await sessionStore.findIdentitiesByEmail(identity.email).catch(() => []);
    const preferred = preferEmailIdentityOverContinuity({ continuity: link, emailIdentities });
    if (!preferred) return;
    const profileChanged = identity.profileId !== preferred.profileId;
    const walletChanged = identity.walletId !== preferred.walletId;
    if (!profileChanged && !walletChanged) return;
    identity.profileId = preferred.profileId;
    identity.walletId = preferred.walletId;
    if (preferred.username) identity.username = preferred.username;
    if (preferred.displayName) identity.displayName = preferred.displayName;
    await sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    if (preferred.source === 'email') {
      await upsertIdentitySubjectAliases(identity, [subject]);
    }
  }

  async function requireRole(
    req: import('node:http').IncomingMessage,
    roles: Role[]
  ): Promise<{ ok: true; identity: IdentityRecord } | { ok: false }> {
    if (DEV_IDENTITY && roles.includes(DEV_IDENTITY.role)) return { ok: true, identity: DEV_IDENTITY };
    const identity = await getIdentityFromReq(req);
    if (!identity) return { ok: false };
    await reconcileIdentityLink(identity).catch(() => undefined);
    if (!roles.includes(identity.role)) return { ok: false };
    return { ok: true, identity };
  }

  async function loadPlayerWalletSummary(identity: IdentityRecord) {
    if (!identity.walletId) return null;
    try {
      const runtimeResponse = await fetch(`${config.runtimeBase}/wallets/${identity.walletId}/summary`, {
        headers: config.internalToken ? { 'x-internal-token': config.internalToken } : undefined
      });
      const payload = await runtimeResponse.json().catch(() => null);
      if (!runtimeResponse.ok) return null;
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }

  async function loadPlayerRuntimeBotContext(identity: IdentityRecord, profile: PlayerProfile) {
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
    return {
      runtimeStatus,
      ownerWalletId,
      ownerWalletAddress,
      bots,
      ownerBot: bots[0] ?? null
    };
  }

  function chainExplorerTxBase(chainId: number | null | undefined): string | null {
    if (!Number.isFinite(Number(chainId))) return null;
    const id = Number(chainId);
    if (id === 137) return 'https://polygonscan.com/tx/';
    if (id === 8453) return 'https://basescan.org/tx/';
    if (id === 1) return 'https://etherscan.io/tx/';
    return null;
  }

  async function loadPlayerActivity(identity: IdentityRecord, limit = 30) {
    if (!identity.profileId || !identity.walletId) {
      return { ok: false, chainId: null, explorerTxBaseUrl: null, walletAddress: '', activity: [] };
    }
    const onchainFallback = { ok: false, chainId: null, address: '', tokenSymbol: 'TOKEN', recent: [] as any[] };
    let escrow: { ok?: boolean; recent?: Array<Record<string, unknown>> } = { recent: [] };
    for (const pid of candidatePlayerIds(identity.profileId)) {
      escrow = await serverGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(
        `/escrow/events/recent?playerId=${encodeURIComponent(pid)}&limit=${limit}`
      ).catch(() => ({ recent: [] }));
      if (Array.isArray(escrow?.recent) && escrow.recent.length > 0) break;
    }
    if ((!Array.isArray(escrow?.recent) || escrow.recent.length === 0) && identity.walletId) {
      escrow = await serverGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(
        `/escrow/events/recent?walletId=${encodeURIComponent(identity.walletId)}&limit=${limit}`
      ).catch(() => escrow);
    }
    const onchain = await runtimeGet<any>(`/wallets/${encodeURIComponent(identity.walletId)}/activity?limit=${limit}`).catch(() => onchainFallback);
    let marketPositions: { ok?: boolean; recent?: any[] } = { ok: false, recent: [] };
    for (const pid of candidatePlayerIds(identity.profileId)) {
      marketPositions = await serverGet<{ ok?: boolean; recent?: any[] }>(
        `/markets/player/positions?playerId=${encodeURIComponent(pid)}&limit=${limit}`
      ).catch(() => ({ ok: false, recent: [] }));
      if (Array.isArray(marketPositions?.recent) && marketPositions.recent.length > 0) break;
    }
    if ((!Array.isArray(marketPositions?.recent) || marketPositions.recent.length === 0) && identity.walletId) {
      marketPositions = await serverGet<{ ok?: boolean; recent?: any[] }>(
        `/markets/player/positions?walletId=${encodeURIComponent(identity.walletId)}&limit=${limit}`
      ).catch(() => marketPositions);
    }
    const chainId = Number(onchain?.chainId ?? Number.NaN);
    const txBase = chainExplorerTxBase(Number.isFinite(chainId) ? chainId : null);
    const escrowActivity = (Array.isArray(escrow?.recent) ? escrow.recent : []).map((entry) => {
      const txHash = String(entry?.txHash || '');
      const at = Number(entry?.at ?? 0);
      return {
        ...entry,
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
    const onchainActivity = (Array.isArray(onchain?.recent) ? onchain.recent : []).map((entry: any) => {
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
    const marketActivity = (Array.isArray(marketPositions?.recent) ? marketPositions.recent : []).map((entry: any) => {
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
        clobOrderId: entry?.clobOrderId == null ? null : String(entry.clobOrderId),
        marketRoundType: entry?.marketRoundType == null ? null : String(entry.marketRoundType),
        marketCurrentSpotPrice: entry?.marketCurrentSpotPrice == null ? null : Number(entry.marketCurrentSpotPrice),
        marketLockPrice: entry?.marketLockPrice == null ? null : Number(entry.marketLockPrice),
        marketFinalPrice: entry?.marketFinalPrice == null ? null : Number(entry.marketFinalPrice)
      };
    });
    return {
      ok: true,
      chainId: Number.isFinite(chainId) ? chainId : null,
      explorerTxBaseUrl: txBase,
      walletAddress: String(onchain?.address || ''),
      activity: [...escrowActivity, ...onchainActivity, ...marketActivity]
        .sort((a, b) => Number(b?.at ?? 0) - Number(a?.at ?? 0))
        .slice(0, limit)
    };
  }

  async function ensurePlayerProvisioned(identity: IdentityRecord, subjectAliases: string[] = []): Promise<void> {
    const continuitySubjects = [externalSubjectFromIdentity(identity), ...subjectAliases];
    const continuity = await findMatchingContinuityLink(continuitySubjects, runtimeSubjectLink);
    const legacyIdentities = await sessionStore.findIdentitiesByEmail(identity.email).catch(() => []);
    const preferredExisting = preferEmailIdentityOverContinuity({ continuity: continuity.link, emailIdentities: legacyIdentities });
    if (preferredExisting?.profileId && preferredExisting?.walletId) {
      identity.profileId = preferredExisting.profileId;
      identity.walletId = preferredExisting.walletId;
      identity.username = preferredExisting.username ?? identity.username;
      identity.displayName = preferredExisting.displayName ?? identity.displayName;
      if (preferredExisting.source === 'email') {
        await upsertIdentitySubjectAliases(identity, continuitySubjects);
      }
      return;
    }
    if (continuity.hadLookupFailure) {
      if (identity.profileId && identity.walletId) return;
      throw new Error('continuity_lookup_unavailable');
    }
    const reusableLegacy = legacyIdentities.find((entry) => entry.profileId && entry.walletId) ?? null;
    if (reusableLegacy?.profileId && reusableLegacy?.walletId) {
      identity.profileId = reusableLegacy.profileId;
      identity.walletId = reusableLegacy.walletId;
      identity.username = reusableLegacy.username;
      identity.displayName = reusableLegacy.displayName;
      return;
    }
    const externalSubject = externalSubjectFromIdentity(identity);
    const created = await runtimePost<any>('/profiles/provision', {
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

  async function firebaseIdentityAuth(
    mode: 'signup' | 'login',
    email: string,
    password: string
  ): Promise<{ ok: true; result: FirebaseAuthResult } | { ok: false; reason: string; status: number }> {
    if (!config.firebaseWebApiKey) {
      return { ok: false, reason: 'email_auth_disabled', status: 403 };
    }
    const endpoint = mode === 'signup' ? 'accounts:signUp' : 'accounts:signInWithPassword';
    try {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(config.firebaseWebApiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      const payload = await response.json().catch(() => ({})) as any;
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
      return { ok: true, result: { localId, email: normalizedEmail, displayName: displayName || undefined } };
    } catch {
      return { ok: false, reason: 'firebase_unreachable', status: 503 };
    }
  }

  async function firebaseLookupIdToken(
    idToken: string
  ): Promise<{ ok: true; result: FirebaseLookupResult } | { ok: false; reason: string; status: number }> {
    if (!config.firebaseWebApiKey) return { ok: false, reason: 'email_auth_disabled', status: 403 };
    try {
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.firebaseWebApiKey)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) }
      );
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok) {
        const mapped = mapFirebaseAuthError(String(payload?.error?.message || ''));
        return { ok: false, reason: mapped.reason, status: mapped.status };
      }
      const user = Array.isArray(payload.users) ? payload.users[0] : null;
      const localId = String(user?.localId || '').trim();
      const email = String(user?.email || '').trim().toLowerCase();
      if (!localId || !email) return { ok: false, reason: 'firebase_invalid_payload', status: 502 };
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

  async function firebaseExchangeGoogleCredential(
    googleIdToken: string
  ): Promise<{ ok: true; result: FirebaseGoogleExchangeResult } | { ok: false; reason: string; status: number }> {
    if (!config.firebaseWebApiKey) return { ok: false, reason: 'firebase_google_auth_disabled', status: 403 };
    try {
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(config.firebaseWebApiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestUri: 'https://arena.local/auth/google',
            returnSecureToken: true,
            returnIdpCredential: true,
            postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`
          })
        }
      );
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok) {
        const mapped = mapFirebaseAuthError(String(payload?.error?.message || ''));
        return { ok: false, reason: mapped.reason, status: mapped.status };
      }
      const localId = String(payload.localId || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      if (!localId || !email) return { ok: false, reason: 'firebase_invalid_payload', status: 502 };
      return {
        ok: true,
        result: {
          localId,
          email,
          displayName: String(payload.displayName || '').trim() || undefined,
          picture: String(payload.photoUrl || '').trim() || undefined
        }
      };
    } catch {
      return { ok: false, reason: 'firebase_unreachable', status: 503 };
    }
  }

  async function googleTokenInfo(idToken: string): Promise<GoogleTokenInfo> {
    if (!config.googleClientId) {
      throw new Error('invalid_google_token');
    }
    const ticket = await googleAuthClient.verifyIdToken({
      idToken,
      audience: config.googleClientId
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('invalid_google_token');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      aud: Array.isArray(payload.aud) ? String(payload.aud[0] || '') : String(payload.aud || ''),
      exp: String(payload.exp || ''),
      iss: payload.iss,
      email_verified: payload.email_verified
    };
  }

  function isSameOriginRequest(req: import('node:http').IncomingMessage): boolean {
    const host = String(req.headers.host ?? '').trim().toLowerCase();
    if (!host) return false;
    const origin = String(req.headers.origin ?? '').trim();
    const referer = String(req.headers.referer ?? '').trim();
    const expected = `${isSecureRequest(req) ? 'https' : 'http'}://${host}`;
    const candidates = [origin, referer].filter(Boolean);
    if (candidates.length === 0) {
      const netlifyForwarded = typeof req.headers['x-nf-request-id'] === 'string';
      return netlifyForwarded || !config.isProduction;
    }
    for (const value of candidates) {
      try {
        const parsed = new URL(value);
        const normalized = parsed.origin.toLowerCase();
        if (normalized !== expected.toLowerCase() && !config.allowedAuthOrigins.has(normalized)) {
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
    if (!config.wsAuthSecret) return null;
    if (!identity.profileId || !identity.walletId) return null;
    return signWsAuthToken(config.wsAuthSecret, {
      role: 'human',
      clientId: identity.profileId,
      walletId: identity.walletId,
      exp: Date.now() + 1000 * 60
    });
  }

  function htmlRouteToFile(
    pathname: string,
    identity: IdentityRecord | null,
    res: import('node:http').ServerResponse
  ): string | null {
    const publicDir = config.publicDir ?? '';
    if (pathname === '/welcome') {
      if (identity) {
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
    if (pathname === '/admin' || pathname === '/admin/chief') {
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

  const chiefService = createChiefService({
    runtimeGet,
    runtimePost,
    serverGet,
    runtimeProfiles,
    purgeSessionsForProfile: (profileId) => sessionStore.purgeSessionsForProfile(profileId),
    log,
    dbGateway: chiefDbGateway,
    cooModeEnabled: Boolean(config.chiefCooModeEnabled),
    skillCatalogRoots: config.chiefSkillCatalogRoots ?? ['.agents/skills']
  });

  const chief2Service = createChief2Service({
    runtimeGet,
    runtimePost,
    serverGet,
    serverPost,
    adminActions: {
      userTeleport: async (params) => serverPost('/admin/teleport', {
        playerId: `u_${String(params.profileId || '').trim()}`,
        ...(typeof params.section === 'number' ? { section: params.section } : {}),
        ...(typeof params.x === 'number' ? { x: params.x } : {}),
        ...(typeof params.z === 'number' ? { z: params.z } : {})
      }),
      userWalletAdjust: async (params) => {
        const profiles = await runtimeProfiles();
        const profile = profiles.find((entry) => entry.id === params.profileId);
        if (!profile) throw new Error('profile_not_found');
        const walletId = profile.wallet?.id ?? profile.walletId;
        if (!walletId) throw new Error('wallet_not_found');
        if (params.direction === 'credit') {
          return runtimePost('/house/transfer', { toWalletId: walletId, amount: params.amount, reason: params.reason });
        }
        const houseStatus = await runtimeGet<any>('/house/status');
        const houseWalletId = String(houseStatus?.house?.wallet?.id || '').trim();
        if (!houseWalletId) throw new Error('house_wallet_missing');
        return runtimePost(`/wallets/${walletId}/transfer`, { toWalletId: houseWalletId, amount: params.amount });
      },
      userLogout: async (params) => sessionStore.purgeSessionsForProfile(params.profileId)
    },
    log
  });

  return {
    config,
    sessionStore,
    chiefService,
    chief2Service,
    extractSession,
    getIdentityFromReq,
    reconcileIdentityLink,
    requireRole,
    isSecureRequest,
    runtimeGet,
    runtimePost,
    runtimeProfiles,
    runtimeStatusOk,
    serverGet,
    serverPost,
    serverHealthOk,
    upstreamErrorJson,
    externalSubjectFromIdentity,
    externalSubjectFromSub,
    subjectHashForAdmin,
    runtimeSubjectLink,
    candidatePlayerIds,
    loadPlayerWalletSummary,
    loadPlayerRuntimeBotContext,
    loadPlayerActivity,
    ensurePlayerProvisioned,
    firebaseIdentityAuth,
    firebaseLookupIdToken,
    firebaseExchangeGoogleCredential,
    upsertIdentitySubjectAliases,
    googleTokenInfo,
    isSameOriginRequest,
    sanitizeUser,
    wsAuthForIdentity,
    htmlRouteToFile
  };
}
