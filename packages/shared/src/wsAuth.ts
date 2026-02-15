import { createHmac, timingSafeEqual } from 'node:crypto';

export type WsAuthRole = 'human' | 'agent';

export type WsAuthClaims = {
  v: 1;
  role: WsAuthRole;
  clientId?: string;
  agentId?: string;
  walletId?: string | null;
  iat: number;
  exp: number;
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(padLen)}`;
  return Buffer.from(padded, 'base64');
}

function hmacSha256(secret: string, payloadB64: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64, 'utf8').digest();
}

export function signWsAuthToken(secret: string, claims: Omit<WsAuthClaims, 'v' | 'iat'> & { iat?: number }): string {
  if (!secret) {
    throw new Error('ws_auth_secret_missing');
  }
  const now = claims.iat ?? Date.now();
  const payload: WsAuthClaims = {
    v: 1,
    role: claims.role,
    clientId: claims.clientId,
    agentId: claims.agentId,
    walletId: claims.walletId ?? null,
    iat: now,
    exp: claims.exp
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSha256(secret, payloadB64);
  const sigB64 = base64UrlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifyWsAuthToken(secret: string, token: string): { ok: true; claims: WsAuthClaims } | { ok: false; reason: string } {
  if (!secret) {
    return { ok: false, reason: 'ws_auth_secret_missing' };
  }
  const trimmed = String(token || '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'ws_auth_token_malformed' };
  }

  const [payloadB64, sigB64] = parts;
  let payloadRaw: Buffer;
  let sigRaw: Buffer;
  try {
    payloadRaw = base64UrlDecodeToBuffer(payloadB64);
    sigRaw = base64UrlDecodeToBuffer(sigB64);
  } catch {
    return { ok: false, reason: 'ws_auth_token_decode_failed' };
  }

  const expectedSig = hmacSha256(secret, payloadB64);
  if (sigRaw.length !== expectedSig.length || !timingSafeEqual(sigRaw, expectedSig)) {
    return { ok: false, reason: 'ws_auth_token_invalid_signature' };
  }

  let claims: WsAuthClaims;
  try {
    claims = JSON.parse(payloadRaw.toString('utf8')) as WsAuthClaims;
  } catch {
    return { ok: false, reason: 'ws_auth_token_invalid_json' };
  }

  if (!claims || claims.v !== 1) {
    return { ok: false, reason: 'ws_auth_token_invalid_version' };
  }
  if (claims.role !== 'human' && claims.role !== 'agent') {
    return { ok: false, reason: 'ws_auth_token_invalid_role' };
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { ok: false, reason: 'ws_auth_token_missing_exp' };
  }
  if (claims.exp <= Date.now()) {
    return { ok: false, reason: 'ws_auth_token_expired' };
  }

  return { ok: true, claims };
}

