import { describe, expect, it, vi } from 'vitest';
import { createChiefService } from './chief.js';
import type { IdentityRecord } from './sessionStore.js';

const baseIdentity: IdentityRecord = {
  sub: 'user_1',
  email: 'u@example.com',
  name: 'User',
  picture: '',
  role: 'player',
  profileId: 'profile_1',
  walletId: 'wallet_1',
  username: 'user',
  displayName: 'User',
  createdAt: Date.now(),
  lastLoginAt: Date.now()
};

describe('chief service', () => {
  it('returns state explanation for status requests', async () => {
    const runtimeGet = async <T>(path: string): Promise<T> => {
      if (path === '/status') {
        return {
          configuredBotCount: 6,
          connectedBotCount: 5,
          bots: [{ id: 'agent_1', meta: { ownerProfileId: 'profile_1' }, behavior: { mode: 'active', targetPreference: 'human_first' } }],
          wallets: [{ id: 'wallet_1', balance: 22.5 }]
        } as T;
      }
      return {} as T;
    };
    const runtimePost = async <T>(_path: string, _body: unknown): Promise<T> => ({}) as T;
    const serverGet = async <T>(_path: string): Promise<T> => ({ recent: [{ id: 'c1' }] }) as T;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn()
    };
    const chief = createChiefService({
      runtimeGet,
      runtimePost,
      serverGet,
      runtimeProfiles: vi.fn(async () => []),
      purgeSessionsForProfile: vi.fn(async () => 0),
      log
    });

    const result = await chief.handleChat({
      identity: baseIdentity,
      request: { message: 'status' }
    });

    expect(result.ok).toBe(true);
    expect(result.intent).toBe('status_explain');
    expect(result.reply).toContain('bots configured=6 connected=5');
    expect(result.actions[0]?.tool).toBe('inspect.state');
  });

  it('requires confirmation for sensitive actions and executes after confirm token', async () => {
    const runtimeGet = async <T>(_path: string): Promise<T> => ({ bots: [], wallets: [] }) as T;
    const runtimePostSpy = vi.fn();
    const runtimePost = async <T>(_path: string, _body: unknown): Promise<T> => {
      runtimePostSpy(_path, _body);
      return {} as T;
    };
    const serverGet = async <T>(_path: string): Promise<T> => ({ recent: [] }) as T;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn()
    };
    const chief = createChiefService({
      runtimeGet,
      runtimePost,
      serverGet,
      runtimeProfiles: vi.fn(async () => []),
      purgeSessionsForProfile: vi.fn(async () => 0),
      log
    });

    const planned = await chief.handleChat({
      identity: baseIdentity,
      request: { message: 'withdraw 5' }
    });

    expect(planned.ok).toBe(true);
    expect(planned.requiresConfirmation).toBe(true);
    expect(planned.confirmToken).toBeTruthy();
    expect(runtimePostSpy).not.toHaveBeenCalled();

    const confirmed = await chief.handleChat({
      identity: baseIdentity,
      request: { confirmToken: planned.confirmToken }
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.requiresConfirmation).toBe(false);
    expect(runtimePostSpy).toHaveBeenCalledWith('/wallets/wallet_1/withdraw', { amount: 5 });
  });

  it('does not allow admin-only user inspection for player mode', async () => {
    const runtimeGet = async <T>(_path: string): Promise<T> => ({ bots: [], wallets: [] }) as T;
    const runtimePostSpy = vi.fn();
    const runtimePost = async <T>(_path: string, _body: unknown): Promise<T> => {
      runtimePostSpy(_path, _body);
      return { reply: '' } as T;
    };
    const serverGet = async <T>(_path: string): Promise<T> => ({ recent: [] }) as T;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn()
    };
    const chief = createChiefService({
      runtimeGet,
      runtimePost,
      serverGet,
      runtimeProfiles: vi.fn(async () => []),
      purgeSessionsForProfile: vi.fn(async () => 0),
      log
    });

    const result = await chief.handleChat({
      identity: baseIdentity,
      request: { message: 'inspect player alice' }
    });

    expect(result.mode).toBe('player');
    expect(result.actions.length).toBe(0);
    expect(result.reply.length).toBeGreaterThan(0);
    expect(runtimePostSpy).toHaveBeenCalledWith('/house/chat', expect.any(Object));
  });
});
