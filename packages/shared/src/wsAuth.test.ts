import { describe, expect, it } from 'vitest';
import { signWsAuthToken, verifyWsAuthToken } from './wsAuth.js';

describe('wsAuth', () => {
  it('signs + verifies a token', () => {
    const secret = 'test_secret';
    const token = signWsAuthToken(secret, {
      role: 'human',
      clientId: 'profile_1',
      walletId: 'wallet_1',
      exp: Date.now() + 60_000
    });
    const verified = verifyWsAuthToken(secret, token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.role).toBe('human');
      expect(verified.claims.clientId).toBe('profile_1');
      expect(verified.claims.walletId).toBe('wallet_1');
    }
  });

  it('rejects expired tokens', () => {
    const secret = 'test_secret';
    const token = signWsAuthToken(secret, {
      role: 'human',
      clientId: 'profile_1',
      walletId: 'wallet_1',
      exp: Date.now() - 1
    });
    const verified = verifyWsAuthToken(secret, token);
    expect(verified.ok).toBe(false);
  });
});

