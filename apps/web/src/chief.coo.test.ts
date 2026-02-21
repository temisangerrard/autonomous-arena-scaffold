import { describe, expect, it, vi } from 'vitest';
import { createChiefService } from './chief.js';
import type { IdentityRecord } from './sessionStore.js';

const adminIdentity: IdentityRecord = {
  sub: 'admin_1',
  email: 'admin@example.com',
  name: 'Admin',
  picture: '',
  role: 'admin',
  profileId: 'profile_admin',
  walletId: 'wallet_admin',
  username: 'admin',
  displayName: 'Admin',
  createdAt: Date.now(),
  lastLoginAt: Date.now()
};

const playerIdentity: IdentityRecord = {
  ...adminIdentity,
  sub: 'player_1',
  role: 'player',
  profileId: 'profile_player',
  walletId: 'wallet_player'
};

function makeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn()
  };
}

describe('chief COO runbooks', () => {
  it('serves admin economy runbook without confirmation', async () => {
    const chief = createChiefService({
      runtimeGet: async <T>(path: string): Promise<T> => {
        if (path === '/status') {
          return {
            configuredBotCount: 3,
            connectedBotCount: 3,
            wallets: []
          } as T;
        }
        return {} as T;
      },
      runtimePost: async <T>(): Promise<T> => ({ reply: '' } as T),
      serverGet: async <T>(): Promise<T> => ({ recent: [] } as T),
      runtimeProfiles: vi.fn(async () => []),
      purgeSessionsForProfile: vi.fn(async () => 0),
      cooModeEnabled: true,
      skillCatalogRoots: [],
      log: makeLog()
    });

    const result = await chief.handleChat({
      identity: adminIdentity,
      request: { message: 'show economy health and risk alerts' }
    });

    expect(result.ok).toBe(true);
    expect(result.runbook).toBe('economy.daily.summary');
    expect(result.requiresConfirmation).toBe(false);
    expect(result.safetyClass).toBe('read_only');
    expect(result.actions[0]?.tool).toBe('runbook.economy.daily.summary');
  });

  it('requires confirmation for admin mutating runbook', async () => {
    const purgeSessionsForProfile = vi.fn(async () => 3);
    const chief = createChiefService({
      runtimeGet: async <T>(): Promise<T> => ({}) as T,
      runtimePost: async <T>(): Promise<T> => ({}) as T,
      serverGet: async <T>(): Promise<T> => ({ recent: [] } as T),
      runtimeProfiles: vi.fn(async () => [{
        id: 'profile_a',
        username: 'alice',
        displayName: 'Alice',
        walletId: 'wallet_a'
      }]),
      purgeSessionsForProfile,
      cooModeEnabled: true,
      skillCatalogRoots: [],
      log: makeLog()
    });

    const planned = await chief.handleChat({
      identity: adminIdentity,
      request: { message: 'logout player alice' }
    });

    expect(planned.ok).toBe(true);
    expect(planned.requiresConfirmation).toBe(true);
    expect(planned.runbook).toBe('player.logout');
    expect(planned.confirmToken).toBeTruthy();

    const confirmed = await chief.handleChat({
      identity: adminIdentity,
      request: { confirmToken: planned.confirmToken }
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.requiresConfirmation).toBe(false);
    expect(purgeSessionsForProfile).toHaveBeenCalledWith('profile_a');
  });

  it('keeps COO runbooks admin-only', async () => {
    const runtimePostSpy = vi.fn();
    const chief = createChiefService({
      runtimeGet: async <T>(): Promise<T> => ({ bots: [], wallets: [] } as T),
      runtimePost: async <T>(path: string, body: unknown): Promise<T> => {
        runtimePostSpy(path, body);
        return { reply: '' } as T;
      },
      serverGet: async <T>(): Promise<T> => ({ recent: [] } as T),
      runtimeProfiles: vi.fn(async () => []),
      purgeSessionsForProfile: vi.fn(async () => 0),
      cooModeEnabled: true,
      skillCatalogRoots: [],
      log: makeLog()
    });

    const result = await chief.handleChat({
      identity: playerIdentity,
      request: { message: 'show economy health and risk alerts' }
    });

    expect(result.runbook).toBeUndefined();
    expect(result.actions[0]?.tool).toBe('inspect.state');
    expect(runtimePostSpy).not.toHaveBeenCalled();
  });
});
