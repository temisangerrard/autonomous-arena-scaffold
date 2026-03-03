import { describe, expect, it } from 'vitest';
import { findMatchingContinuityLink, preferEmailIdentityOverContinuity } from './identityContinuity.js';

describe('findMatchingContinuityLink', () => {
  it('falls back to a legacy google alias link when canonical firebase subject is missing', async () => {
    const result = await findMatchingContinuityLink(
      ['firebase:firebase-local-456', 'google:google-sub-123'],
      async (subject) => {
        if (subject === 'google:google-sub-123') {
          return {
            profileId: 'profile_7',
            walletId: 'wallet_22',
            linkedAt: 1,
            updatedAt: 2,
            continuitySource: 'postgres'
          };
        }
        return null;
      }
    );

    expect(result.link?.profileId).toBe('profile_7');
    expect(result.matchedSubject).toBe('google:google-sub-123');
    expect(result.hadLookupFailure).toBe(false);
  });

  it('prefers the canonical firebase subject when both canonical and alias links exist', async () => {
    const result = await findMatchingContinuityLink(
      ['firebase:firebase-local-456', 'google:google-sub-123'],
      async (subject) => ({
        profileId: subject.startsWith('firebase:') ? 'profile_firebase' : 'profile_google',
        walletId: subject.startsWith('firebase:') ? 'wallet_firebase' : 'wallet_google',
        linkedAt: 1,
        updatedAt: 2,
        continuitySource: 'postgres'
      })
    );

    expect(result.link?.profileId).toBe('profile_firebase');
    expect(result.matchedSubject).toBe('firebase:firebase-local-456');
  });

  it('prefers the most recent email identity over stale continuity when they disagree', () => {
    const chosen = preferEmailIdentityOverContinuity({
      continuity: {
        profileId: 'profile_old',
        walletId: 'wallet_old',
        linkedAt: 10,
        updatedAt: 100,
        continuitySource: 'postgres'
      },
      emailIdentities: [
        {
          sub: 'firebase:new',
          profileId: 'profile_new',
          walletId: 'wallet_new',
          username: 'tagbajoh',
          displayName: 'Temisan Agbajoh',
          lastLoginAt: 200
        }
      ]
    });

    expect(chosen?.source).toBe('email');
    expect(chosen?.profileId).toBe('profile_new');
    expect(chosen?.walletId).toBe('wallet_new');
  });
});
