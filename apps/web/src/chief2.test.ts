import { describe, expect, it, vi } from 'vitest';
import { createChief2Service } from './chief2/index.js';
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

describe('chief2 service', () => {
  it('returns non-empty deterministic status reply', async () => {
    const service = createChief2Service({
      runtimeGet: async <T>(path: string): Promise<T> => {
        if (path === '/status') {
          return {
            configuredBotCount: 8,
            connectedBotCount: 7,
            disconnectedBotIds: ['agent_8'],
            wsAuthMismatchLikely: false,
            house: { sponsorGas: { status: 'yellow', balanceEth: '0.0004' } }
          } as T;
        }
        return { ok: true } as T;
      },
      runtimePost: async <T>(_path: string, _body: unknown): Promise<T> => ({ ok: true } as T),
      serverGet: async <T>(_path: string): Promise<T> => ({ ok: true } as T),
      serverPost: async <T>(_path: string, _body: unknown): Promise<T> => ({ ok: true } as T),
      adminActions: {
        userTeleport: vi.fn(async () => ({ ok: true })),
        userWalletAdjust: vi.fn(async () => ({ ok: true })),
        userLogout: vi.fn(async () => ({ ok: true }))
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });

    const res = await service.command(adminIdentity, { message: 'status' });
    expect(res.ok).toBe(true);
    expect(res.reply.length).toBeGreaterThan(0);
    expect(res.executionGraph.steps.length).toBeGreaterThan(0);
    expect(res.requiresConfirmation).toBe(false);
  });

  it('requires and validates confirmation for sensitive actions', async () => {
    const runtimePostSpy = vi.fn<(path: string, body: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    const service = createChief2Service({
      runtimeGet: async <T>(_path: string): Promise<T> => ({ ok: true } as T),
      runtimePost: async <T>(path: string, body: unknown): Promise<T> => {
        runtimePostSpy(path, body);
        return { ok: true } as T;
      },
      serverGet: async <T>(_path: string): Promise<T> => ({ ok: true } as T),
      serverPost: async <T>(_path: string, _body: unknown): Promise<T> => ({ ok: true } as T),
      adminActions: {
        userTeleport: vi.fn(async () => ({ ok: true })),
        userWalletAdjust: vi.fn(async () => ({ ok: true })),
        userLogout: vi.fn(async () => ({ ok: true }))
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });

    const planned = await service.command(adminIdentity, { message: 'reconcile bots to 12' });
    expect(planned.requiresConfirmation).toBe(true);
    expect(planned.confirmToken).toBeTruthy();

    const confirmed = await service.command(adminIdentity, { confirmToken: planned.confirmToken });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.requiresConfirmation).toBe(false);
    expect(runtimePostSpy).toHaveBeenCalledWith('/agents/reconcile', { count: 12 });
  });
});
