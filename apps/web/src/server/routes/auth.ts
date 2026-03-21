import { randomBytes } from 'node:crypto';
import { resolveAuthSubjects } from '../../authSubjects.js';
import { clearSessionCookie, readJsonBody, sendJson, setSessionCookieWithOptions } from '../../lib/http.js';
import { log } from '../../logger.js';
import { cookieSessionId, type IdentityRecord, type Role, type SessionRecord } from '../../sessionStore.js';
import type { RouteHandler } from '../types.js';

export const handleAuthRoutes: RouteHandler = async (req, res, requestUrl, context) => {
  const pathname = requestUrl.pathname;
  const sessionTtlMs = context.config.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 7;
  const identityTtlMs = context.config.identityTtlMs ?? 1000 * 60 * 60 * 24 * 30;
  const cookieName = context.config.cookieName ?? 'arena_sid';

  if (pathname === '/api/auth/local' && req.method === 'POST') {
    if (!context.config.localAuthEnabled) {
      sendJson(res, { ok: false, reason: 'local_auth_disabled' }, 403);
      return true;
    }
    if (!context.config.localAdminPassword) {
      sendJson(res, { ok: false, reason: 'local_auth_misconfigured' }, 500);
      return true;
    }
    const body = await readJsonBody<{ username?: string; password?: string }>(req);
    const username = body?.username?.trim() ?? '';
    const password = body?.password?.trim() ?? '';
    if (!username || !password) {
      sendJson(res, { ok: false, reason: 'credentials_required' }, 400);
      return true;
    }

    const normalizedUsername = username.toLowerCase();
    const normalizedAdminUsername = String(context.config.localAdminUsername ?? '').trim().toLowerCase();
    const isAdminLogin = normalizedAdminUsername.length > 0 && normalizedUsername === normalizedAdminUsername;
    if (password !== context.config.localAdminPassword) {
      sendJson(res, { ok: false, reason: 'invalid_credentials' }, 401);
      return true;
    }
    if (context.config.isProduction && !isAdminLogin) {
      sendJson(res, { ok: false, reason: 'invalid_credentials' }, 401);
      return true;
    }

    const now = Date.now();
    const sub = `local:${normalizedUsername}`;
    const existing = await context.sessionStore.getIdentity(sub);
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
    await context.sessionStore.setIdentity(identity, identityTtlMs);

    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs };
    await context.sessionStore.setSession(session, sessionTtlMs);
    await context.sessionStore.addSessionForSub(identity.sub, sid, sessionTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    setSessionCookieWithOptions(res, cookieName, sid, sessionTtlMs, { secure: context.isSecureRequest(req) });

    try {
      await context.ensurePlayerProvisioned(identity);
    } catch (error) {
      log.error({ err: error, sub: identity.sub, reason: 'local_provision_failed' }, 'failed to provision local user');
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    sendJson(res, { ok: true, user: context.sanitizeUser(identity), redirectTo: '/dashboard' });
    return true;
  }

  if (pathname === '/api/auth/email' && req.method === 'POST') {
    if (!context.config.emailAuthEnabled) {
      sendJson(res, { ok: false, reason: 'email_auth_disabled' }, 403);
      return true;
    }
    if (!context.isSameOriginRequest(req)) {
      sendJson(res, { ok: false, reason: 'origin_mismatch' }, 403);
      return true;
    }
    const body = await readJsonBody<{ email?: string; password?: string; mode?: string; name?: string }>(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '').trim();
    const mode = String(body?.mode || '').trim().toLowerCase();
    const requestedName = String(body?.name || '').trim();
    if (!email || !password || (mode !== 'signup' && mode !== 'login')) {
      sendJson(res, { ok: false, reason: 'email_credentials_required' }, 400);
      return true;
    }
    if (mode === 'signup' && password.length < 6) {
      sendJson(res, { ok: false, reason: 'weak_password' }, 400);
      return true;
    }
    const authResult = await context.firebaseIdentityAuth(mode === 'signup' ? 'signup' : 'login', email, password);
    if (!authResult.ok) {
      sendJson(res, { ok: false, reason: authResult.reason }, authResult.status);
      return true;
    }
    const now = Date.now();
    const token = authResult.result;
    const subjects = resolveAuthSubjects({ provider: 'firebase', firebaseLocalId: token.localId });
    const sub = subjects.canonical;
    const role: Role = context.config.adminEmails?.has(token.email.toLowerCase()) ? 'admin' : 'player';
    const existing = await context.sessionStore.getIdentity(sub);
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
    identity.name = mode === 'signup' && requestedName ? requestedName : identity.name || fallbackName;
    identity.role = role;
    identity.lastLoginAt = now;
    try {
      await context.ensurePlayerProvisioned(identity, subjects.aliases);
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    await context.upsertIdentitySubjectAliases(identity, subjects.aliases);
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs };
    await context.sessionStore.setSession(session, sessionTtlMs);
    await context.sessionStore.addSessionForSub(identity.sub, sid, sessionTtlMs);
    setSessionCookieWithOptions(res, cookieName, sid, sessionTtlMs, { secure: context.isSecureRequest(req) });
    sendJson(res, { ok: true, user: context.sanitizeUser(identity), redirectTo: '/dashboard' });
    return true;
  }

  if (pathname === '/api/auth/firebase' && req.method === 'POST') {
    if (!context.config.firebaseClientAuthEnabled) {
      sendJson(res, { ok: false, reason: 'firebase_client_auth_disabled' }, 403);
      return true;
    }
    if (!context.isSameOriginRequest(req)) {
      sendJson(res, { ok: false, reason: 'origin_mismatch' }, 403);
      return true;
    }
    const body = await readJsonBody<{ idToken?: string }>(req);
    const idToken = String(body?.idToken || '').trim();
    if (!idToken) {
      sendJson(res, { ok: false, reason: 'id_token_required' }, 400);
      return true;
    }
    const lookup = await context.firebaseLookupIdToken(idToken);
    if (!lookup.ok) {
      sendJson(res, { ok: false, reason: lookup.reason }, lookup.status);
      return true;
    }
    if (!lookup.result.emailVerified) {
      sendJson(res, { ok: false, reason: 'email_not_verified' }, 401);
      return true;
    }
    const now = Date.now();
    const token = lookup.result;
    const subjects = resolveAuthSubjects({ provider: 'firebase', firebaseLocalId: token.localId });
    const sub = subjects.canonical;
    const role: Role = context.config.adminEmails?.has(token.email.toLowerCase()) ? 'admin' : 'player';
    const existing = await context.sessionStore.getIdentity(sub);
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
      await context.ensurePlayerProvisioned(identity, subjects.aliases);
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    await context.upsertIdentitySubjectAliases(identity, subjects.aliases);
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs };
    await context.sessionStore.setSession(session, sessionTtlMs);
    await context.sessionStore.addSessionForSub(identity.sub, sid, sessionTtlMs);
    setSessionCookieWithOptions(res, cookieName, sid, sessionTtlMs, { secure: context.isSecureRequest(req) });
    sendJson(res, { ok: true, user: context.sanitizeUser(identity), redirectTo: '/dashboard' });
    return true;
  }

  if (pathname === '/api/auth/google' && req.method === 'POST') {
    if (!context.config.googleAuthEnabled) {
      sendJson(res, { ok: false, reason: 'google_auth_disabled' }, 403);
      return true;
    }
    if (!context.isSameOriginRequest(req)) {
      sendJson(res, { ok: false, reason: 'origin_mismatch' }, 403);
      return true;
    }
    const body = await readJsonBody<{ credential?: string }>(req);
    const credential = String(body?.credential || '').trim();
    if (!credential) {
      sendJson(res, { ok: false, reason: 'credential_required' }, 400);
      return true;
    }
    let token;
    try {
      token = await context.googleTokenInfo(credential);
    } catch {
      sendJson(res, { ok: false, reason: 'invalid_google_token' }, 401);
      return true;
    }
    const emailVerified = String(token.email_verified ?? '').toLowerCase();
    if (emailVerified && emailVerified !== 'true') {
      sendJson(res, { ok: false, reason: 'email_not_verified' }, 401);
      return true;
    }
    const now = Date.now();
    let firebaseLocalId = '';
    if (context.config.firebaseWebApiKey) {
      const exchange = await context.firebaseExchangeGoogleCredential(credential);
      if (!exchange.ok) {
        sendJson(res, { ok: false, reason: exchange.reason }, exchange.status);
        return true;
      }
      firebaseLocalId = exchange.result.localId;
      token.email = exchange.result.email || token.email;
      token.name = exchange.result.displayName || token.name;
      token.picture = exchange.result.picture || token.picture;
    }
    const subjects = resolveAuthSubjects({ provider: 'google', googleSub: token.sub, firebaseLocalId });
    const sub = subjects.canonical;
    const role: Role = context.config.adminEmails?.has(token.email.toLowerCase()) ? 'admin' : 'player';
    const existing = await context.sessionStore.getIdentity(sub);
    const fallbackName = token.name || token.email.split('@')[0] || 'Player';
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
    identity.name = token.name || identity.name || fallbackName;
    identity.picture = token.picture || identity.picture;
    identity.role = role;
    identity.lastLoginAt = now;
    try {
      await context.ensurePlayerProvisioned(identity);
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    await context.upsertIdentitySubjectAliases(identity, subjects.aliases);
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    const sid = randomBytes(24).toString('hex');
    const session: SessionRecord = { id: sid, sub: identity.sub, expiresAt: now + sessionTtlMs };
    await context.sessionStore.setSession(session, sessionTtlMs);
    await context.sessionStore.addSessionForSub(identity.sub, sid, sessionTtlMs);
    setSessionCookieWithOptions(res, cookieName, sid, sessionTtlMs, { secure: context.isSecureRequest(req) });
    sendJson(res, { ok: true, user: context.sanitizeUser(identity), redirectTo: '/dashboard' });
    return true;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const identity = await context.getIdentityFromReq(req).catch(() => null);
    if (identity?.profileId) {
      await context.runtimePost(`/owners/${identity.profileId}/presence`, { state: 'offline' }).catch(() => undefined);
    }
    const sid = cookieSessionId(req);
    if (sid) {
      const session = await context.sessionStore.getSession(sid);
      await context.sessionStore.deleteSession(sid);
      if (session?.sub) {
        await context.sessionStore.removeSessionForSub(session.sub, sid);
      }
    }
    clearSessionCookie(res, cookieName);
    sendJson(res, { ok: true });
    return true;
  }

  if (pathname === '/api/session') {
    const identity = await context.getIdentityFromReq(req);
    if (!identity) {
      const optional = String(requestUrl.searchParams.get('optional') || '').trim().toLowerCase();
      if (optional === '1' || optional === 'true') {
        sendJson(res, { ok: false, user: null, reason: 'unauthorized' }, 200);
        return true;
      }
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    await context.reconcileIdentityLink(identity).catch(() => undefined);
    sendJson(res, { ok: true, user: context.sanitizeUser(identity) });
    return true;
  }

  return false;
};

