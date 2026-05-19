import { describe, expect, it } from 'vitest';
import {
  buildContinuityImportPlan,
  buildContinuityImportSql,
  parseLegacyAuthStateDocument,
  type ExistingD1Snapshot,
} from './continuityMigration.js';

describe('parseLegacyAuthStateDocument', () => {
  it('accepts legacy persisted auth state documents', () => {
    const parsed = parseLegacyAuthStateDocument({
      version: 1,
      identities: [
        {
          sub: 'firebase:one',
          email: 'player@example.com',
          name: 'Player',
          picture: '',
          role: 'player',
          profileId: 'profile_1',
          walletId: 'wallet_1',
          username: 'player',
          displayName: 'Player',
          createdAt: 10,
          lastLoginAt: 20,
        },
      ],
      sessions: [
        {
          id: 'sess_1',
          sub: 'firebase:one',
          expiresAt: 100,
        },
      ],
    });

    expect(parsed.identities).toHaveLength(1);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.identities[0]?.email).toBe('player@example.com');
  });
});

describe('buildContinuityImportPlan', () => {
  const emptyExisting: ExistingD1Snapshot = {
    webIdentities: [],
    subjectLinks: [],
    runtimeProfiles: [],
    runtimeWallets: [],
  };

  it('rewrites conflicting identities for an email to the most recent mapped profile', async () => {
    const plan = await buildContinuityImportPlan({
      source: parseLegacyAuthStateDocument({
        identities: [
          {
            sub: 'firebase:new',
            email: 'tagbajoh@gmail.com',
            name: 'Temisan',
            picture: '',
            role: 'player',
            profileId: 'profile_new',
            walletId: 'wallet_new',
            username: 'tagbajoh',
            displayName: 'Temisan',
            createdAt: 1,
            lastLoginAt: 50,
          },
          {
            sub: 'google:old',
            email: 'tagbajoh@gmail.com',
            name: 'Temisan',
            picture: '',
            role: 'player',
            profileId: 'profile_old',
            walletId: 'wallet_old',
            username: 'tagbajoh',
            displayName: 'Temisan Old',
            createdAt: 1,
            lastLoginAt: 10,
          },
        ],
        sessions: [],
      }),
      existing: emptyExisting,
      now: 1000,
    });

    expect(plan.importedIdentities).toHaveLength(2);
    expect(plan.importedIdentities.every((entry) => entry.profileId === 'profile_new')).toBe(true);
    expect(plan.importedIdentities.every((entry) => entry.walletId === 'wallet_new')).toBe(true);
    expect(plan.summary.emailGroupsRewritten).toBe(1);
    expect(plan.summary.conflictingProfileCount).toBe(1);
  });

  it('falls back to an existing continuity subject link when source identities lack mappings', async () => {
    const plan = await buildContinuityImportPlan({
      source: parseLegacyAuthStateDocument({
        identities: [
          {
            sub: 'firebase:one',
            email: 'player@example.com',
            name: 'Player',
            picture: '',
            role: 'player',
            profileId: null,
            walletId: null,
            username: null,
            displayName: null,
            createdAt: 1,
            lastLoginAt: 2,
          },
        ],
        sessions: [],
      }),
      existing: {
        ...emptyExisting,
        subjectLinks: [
          {
            subject: 'firebase:one',
            profileId: 'profile_1',
            walletId: 'wallet_1',
            linkedAt: 5,
            updatedAt: 9,
          },
        ],
      },
      now: 1000,
    });

    expect(plan.importedIdentities[0]?.profileId).toBe('profile_1');
    expect(plan.importedIdentities[0]?.walletId).toBe('wallet_1');
  });

  it('creates placeholder runtime records for missing profiles and wallets', async () => {
    const plan = await buildContinuityImportPlan({
      source: parseLegacyAuthStateDocument({
        identities: [
          {
            sub: 'firebase:one',
            email: 'player@example.com',
            name: 'Player',
            picture: '',
            role: 'player',
            profileId: 'profile_1',
            walletId: 'wallet_1',
            username: 'player',
            displayName: 'Player',
            createdAt: 10,
            lastLoginAt: 20,
          },
        ],
        sessions: [],
      }),
      existing: emptyExisting,
      now: 1000,
    });

    expect(plan.summary.runtimeProfilesCreated).toBe(1);
    expect(plan.summary.runtimeWalletsCreated).toBe(1);
    expect(plan.summary.placeholderWalletCount).toBe(1);
    expect(plan.runtimeProfiles.find((entry) => entry.profileId === 'profile_1')).toBeTruthy();
    expect(plan.runtimeWallets.find((entry) => entry.walletId === 'wallet_1')).toBeTruthy();
  });
});

describe('buildContinuityImportSql', () => {
  it('emits idempotent upserts for imported records', async () => {
    const plan = await buildContinuityImportPlan({
      source: parseLegacyAuthStateDocument({
        identities: [
          {
            sub: 'firebase:one',
            email: 'player@example.com',
            name: 'Player',
            picture: '',
            role: 'player',
            profileId: 'profile_1',
            walletId: 'wallet_1',
            username: 'player',
            displayName: 'Player',
            createdAt: 10,
            lastLoginAt: 20,
          },
        ],
        sessions: [
          {
            id: 'sess_1',
            sub: 'firebase:one',
            expiresAt: Date.now() + 60_000,
          },
        ],
      }),
      existing: {
        webIdentities: [],
        subjectLinks: [],
        runtimeProfiles: [],
        runtimeWallets: [],
      },
      includeSessions: true,
      now: 1000,
    });

    const sql = buildContinuityImportSql(plan);
    expect(sql).toContain('INSERT OR REPLACE INTO web_identities');
    expect(sql).toContain('INSERT OR REPLACE INTO auth_subject_links');
    expect(sql).toContain('INSERT OR REPLACE INTO web_sessions');
  });
});
