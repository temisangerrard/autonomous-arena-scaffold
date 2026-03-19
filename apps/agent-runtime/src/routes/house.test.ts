import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { SimpleRouter } from '../lib/http.js';
import { registerHouseRoutes } from './house.js';

function makeJsonRequest(body: Record<string, unknown>) {
  const stream = Readable.from([JSON.stringify(body)]);
  return stream as unknown as import('node:http').IncomingMessage;
}

function makeResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = String(chunk || '');
    }
  };
  return response as unknown as import('node:http').ServerResponse & {
    headers: Record<string, string>;
    body: string;
  };
}

describe('registerHouseRoutes owner presence', () => {
  it('forwards websocket lease metadata on online presence updates', async () => {
    const router = new SimpleRouter();
    const setOwnerOnline = vi.fn();
    const setOwnerOffline = vi.fn();

    registerHouseRoutes(router, {
      isInternalAuthorized: () => true,
      runtimeStatus: () => ({ house: {} }),
      askOpenRouterHouse: async () => null,
      ensureSeedBalances: () => {},
      schedulePersistState: vi.fn(),
      transferFromHouse: () => ({ ok: true, amount: 1 }),
      refillHouse: () => ({ ok: true, amount: 1 }),
      setOwnerOnline,
      setOwnerOffline,
      ownerPresence: new Map(),
      getHouseConfig: () => ({ npcWalletFloor: 0, npcWalletTopupAmount: 0, superAgentWalletFloor: 0 }),
      setHouseConfig: () => {}
    });

    const matched = router.match('POST', '/owners/profile_1/presence');
    expect(matched).not.toBeNull();
    const req = makeJsonRequest({
      state: 'online',
      leaseId: 'lease_1',
      ttlMs: 45_000,
      playerId: 'u_profile_1',
      serverId: 'srv_1'
    });
    const res = makeResponse();

    await matched?.handler(req, res, matched?.params);

    expect(setOwnerOnline).toHaveBeenCalledWith('profile_1', {
      leaseId: 'lease_1',
      ttlMs: 45_000,
      playerId: 'u_profile_1',
      serverId: 'srv_1',
      source: 'ws_session'
    });
    expect(setOwnerOffline).not.toHaveBeenCalled();
  });

  it('uses lease-aware offline presence updates', async () => {
    const router = new SimpleRouter();
    const setOwnerOnline = vi.fn();
    const setOwnerOffline = vi.fn();

    registerHouseRoutes(router, {
      isInternalAuthorized: () => true,
      runtimeStatus: () => ({ house: {} }),
      askOpenRouterHouse: async () => null,
      ensureSeedBalances: () => {},
      schedulePersistState: vi.fn(),
      transferFromHouse: () => ({ ok: true, amount: 1 }),
      refillHouse: () => ({ ok: true, amount: 1 }),
      setOwnerOnline,
      setOwnerOffline,
      ownerPresence: new Map(),
      getHouseConfig: () => ({ npcWalletFloor: 0, npcWalletTopupAmount: 0, superAgentWalletFloor: 0 }),
      setHouseConfig: () => {}
    });

    const matched = router.match('POST', '/owners/profile_1/presence');
    expect(matched).not.toBeNull();
    const req = makeJsonRequest({
      state: 'offline',
      leaseId: 'lease_1'
    });
    const res = makeResponse();

    await matched?.handler(req, res, matched?.params);

    expect(setOwnerOnline).not.toHaveBeenCalled();
    expect(setOwnerOffline).toHaveBeenCalledWith('profile_1', {
      leaseId: 'lease_1'
    });
  });
});
