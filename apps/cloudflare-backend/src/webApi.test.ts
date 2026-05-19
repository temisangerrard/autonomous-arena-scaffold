import { describe, expect, it } from 'vitest';
import { handleWebApi, type WebApiEnv } from './webApi.js';

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function makeD1() {
  const identity = {
    sub: 'firebase:player_1',
    email: 'player@example.com',
    name: 'Player One',
    picture: '',
    role: 'player',
    profile_id: 'profile_1',
    wallet_id: 'wallet_1',
    username: 'player',
    display_name: 'Player One',
    created_at: 1,
    last_login_at: 2,
  };

  return {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (query.includes('FROM web_sessions')) {
            return { session_id: 'session_1', sub: 'firebase:player_1', expires_at: Date.now() + 60_000 };
          }
          if (query.includes('FROM web_identities')) {
            return identity;
          }
          return null;
        },
        async run() {
          return {};
        },
        async all() {
          return { results: [] };
        },
      };
    },
  } as WebApiEnv['STATE_DB'];
}

describe('handleWebApi player auth', () => {
  it('derives the public websocket URL from the game server upstream when no override is set', async () => {
    const env: WebApiEnv = {
      STATE_DB: makeD1(),
      SERVER_UPSTREAM: 'https://arena-server.example.test',
    };
    const request = new Request('https://autobett.xyz/api/config');

    const response = await handleWebApi(request, env, '/api/config');
    const payload = await response?.json() as { gameWsUrl?: string };

    expect(response?.status).toBe(200);
    expect(payload.gameWsUrl).toBe('wss://arena-server.example.test/ws');
  });

  it('returns signed websocket auth claims for the active player identity', async () => {
    const env: WebApiEnv = {
      STATE_DB: makeD1(),
      GAME_WS_AUTH_SECRET: 'shared-ws-secret',
    };
    const request = new Request('https://autobett.xyz/api/player/me', {
      headers: { cookie: 'arena_sid=session_1' },
    });

    const response = await handleWebApi(request, env, '/api/player/me');
    const payload = await response?.json() as { wsAuth?: string };

    expect(response?.status).toBe(200);
    expect(payload.wsAuth).toBeTypeOf('string');
    const [claimsB64, signatureB64] = String(payload.wsAuth).split('.');
    expect(signatureB64).toBe(await hmacSha256('shared-ws-secret', claimsB64 || ''));
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(claimsB64 || ''))) as Record<string, unknown>;
    expect(claims.role).toBe('human');
    expect(claims.clientId).toBe('profile_1');
    expect(claims.walletId).toBe('wallet_1');
  });
});
