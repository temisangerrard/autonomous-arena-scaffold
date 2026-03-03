import { describe, expect, it } from 'vitest';
import type { IdentityRecord } from './sessionStore.js';
import { rewriteEmailIdentityBindings } from './adminWalletRelink.js';

describe('rewriteEmailIdentityBindings', () => {
  it('pins all identities for an email to the target profile and wallet and returns conflicting profiles', () => {
    const identities: IdentityRecord[] = [
      {
        sub: 'firebase:one', email: 'tagbajoh@gmail.com', name: 'Temisan', picture: '', role: 'player',
        profileId: 'profile_old', walletId: 'wallet_old', username: 'tagbajoh', displayName: 'Temisan', createdAt: 1, lastLoginAt: 10
      },
      {
        sub: 'google:two', email: 'tagbajoh@gmail.com', name: 'Temisan', picture: '', role: 'player',
        profileId: 'profile_other', walletId: 'wallet_other', username: 'tagbajoh', displayName: 'Temisan Old', createdAt: 1, lastLoginAt: 20
      }
    ];

    const result = rewriteEmailIdentityBindings({
      identities,
      profileId: 'profile_tag',
      walletId: 'wallet_final',
      username: 'tagbajoh',
      displayName: 'Temisan Agbajoh'
    });

    expect(result.updated).toHaveLength(2);
    expect(result.updated.every((entry) => entry.profileId === 'profile_tag')).toBe(true);
    expect(result.updated.every((entry) => entry.walletId === 'wallet_final')).toBe(true);
    expect(result.conflictingProfileIds).toEqual(['profile_old', 'profile_other']);
  });
});
