import { describe, expect, it } from 'vitest';
import { createSessionStore, type IdentityRecord } from './sessionStore.js';

describe('sessionStore email lookup', () => {
  it('finds legacy identities by normalized email in memory mode', async () => {
    const store = await createSessionStore({
      redisUrl: '',
      isProduction: false,
      webStateFile: '/tmp/arena-web-session-store-test.json'
    });

    const identity: IdentityRecord = {
      sub: 'google:legacy-user',
      email: 'Test@Example.com',
      name: 'Test User',
      picture: '',
      role: 'player',
      profileId: 'profile_9',
      walletId: 'wallet_12',
      username: 'test',
      displayName: 'Test',
      createdAt: 1,
      lastLoginAt: 2
    };
    await store.setIdentity(identity, 60_000);

    const matches = await store.findIdentitiesByEmail('test@example.com');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.sub).toBe('google:legacy-user');
    expect(matches[0]?.walletId).toBe('wallet_12');
  });
});
