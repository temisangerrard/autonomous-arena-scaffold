/**
 * WebSocket authentication utilities
 */
import { verifyWsAuthToken } from '@arena/shared';
import { log } from '../logger.js';
import { config } from '../config.js';

export type PlayerRole = 'human' | 'agent';

export type ValidatedIdentity = {
  sub: string;
  role: string;
  walletId: string | null;
  displayName: string | null;
};

/**
 * Extract a cookie value from a cookie header
 */
export function extractCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === name) return decodeURIComponent(value);
  }
  return null;
}

/**
 * Validate a session cookie against the web auth service
 */
export async function validateSession(
  cookieHeader: string | undefined,
  fallbackSid?: string | null
): Promise<ValidatedIdentity | null> {
  if (!config.webAuthUrl) return null; // Auth not configured — skip validation
  const cookieSid = extractCookie(cookieHeader, 'arena_sid');
  const headerSid = String(fallbackSid || '').trim();
  const sid = cookieSid || headerSid;
  if (!sid) return null;

  try {
    const headers: Record<string, string> = {
      cookie: `arena_sid=${encodeURIComponent(sid)}`
    };
    if (headerSid) {
      headers['x-arena-sid'] = headerSid;
    }
    const response = await fetch(`${config.webAuthUrl}/api/session`, {
      headers
    });
    if (!response.ok) return null;
    const data = await response.json() as { ok?: boolean; user?: { sub?: string; role?: string; walletId?: string | null; displayName?: string | null } };
    if (!data.ok || !data.user?.sub) return null;
    return {
      sub: data.user.sub,
      role: data.user.role ?? 'player',
      walletId: data.user.walletId ?? null,
      displayName: data.user.displayName ?? null
    };
  } catch (err) {
    log.warn({ err }, 'session validation failed');
    return null;
  }
}

/**
 * Verify WebSocket auth token from URL params
 */
export function verifyWsAuth(
  token: string,
  expectedRole: PlayerRole
): { ok: boolean; claims?: Record<string, unknown>; reason?: string } {
  if (!config.wsAuthSecret) {
    return { ok: true }; // No auth configured
  }
  
  const verified = verifyWsAuthToken(config.wsAuthSecret, token);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  
  const claims = verified.claims;
  if (claims.role !== expectedRole) {
    return { ok: false, reason: 'ws_auth_role_mismatch' };
  }
  
  return { ok: true, claims };
}

/**
 * Validate human client WebSocket auth claims
 */
export function validateHumanAuthClaims(
  claims: Record<string, unknown>,
  normalizedClientId: string | undefined,
  walletId: string | undefined
): { ok: boolean; reason?: string } {
  const claimClientId = String(claims.clientId || '').trim();
  const claimWalletId = claims.walletId ? String(claims.walletId).trim() : '';
  
  if (!claimClientId || !claimWalletId) {
    return { ok: false, reason: 'ws_auth_missing_claims' };
  }
  
  if (normalizedClientId && normalizedClientId !== claimClientId) {
    return { ok: false, reason: 'ws_auth_client_mismatch' };
  }
  
  if (walletId && walletId !== claimWalletId) {
    return { ok: false, reason: 'ws_auth_wallet_mismatch' };
  }
  
  return { ok: true };
}

/**
 * Validate agent WebSocket auth claims
 */
export function validateAgentAuthClaims(
  claims: Record<string, unknown>,
  requestedAgentId: string | undefined,
  walletId: string | undefined
): { ok: boolean; reason?: string } {
  const claimAgentId = String(claims.agentId || '').trim();
  
  if (!claimAgentId || (requestedAgentId && requestedAgentId !== claimAgentId)) {
    return { ok: false, reason: 'ws_auth_agent_mismatch' };
  }
  
  if (claims.walletId && walletId && String(claims.walletId) !== walletId) {
    return { ok: false, reason: 'ws_auth_wallet_mismatch' };
  }
  
  return { ok: true };
}
