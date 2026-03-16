import { describe, expect, it, vi } from 'vitest';
import { createOwnerPresenceLease, postOwnerPresence } from './ownerPresence.js';

describe('createOwnerPresenceLease', () => {
  it('creates a bounded websocket owner-presence lease', () => {
    const lease = createOwnerPresenceLease({
      profileId: 'profile_1',
      playerId: 'u_profile_1',
      serverId: 'srv_1',
      ttlMs: 90_000
    });

    expect(lease.profileId).toBe('profile_1');
    expect(lease.playerId).toBe('u_profile_1');
    expect(lease.serverId).toBe('srv_1');
    expect(lease.leaseId).toBeTruthy();
    expect(lease.ttlMs).toBe(90_000);
  });
});

describe('postOwnerPresence', () => {
  it('posts websocket lease metadata on online updates', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const lease = {
      profileId: 'profile_1',
      leaseId: 'lease_1',
      playerId: 'u_profile_1',
      serverId: 'srv_1',
      ttlMs: 45_000
    };

    await postOwnerPresence({
      runtimeUrl: 'https://runtime.example',
      internalToken: 'secret',
      lease,
      state: 'online',
      fetchImpl: fetchImpl as never
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://runtime.example/owners/profile_1/presence',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-internal-token': 'secret'
        }),
        body: JSON.stringify({
          state: 'online',
          leaseId: 'lease_1',
          ttlMs: 45_000,
          playerId: 'u_profile_1',
          serverId: 'srv_1'
        })
      })
    );
  });

  it('posts lease-aware offline updates', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const lease = {
      profileId: 'profile_1',
      leaseId: 'lease_1',
      playerId: 'u_profile_1',
      serverId: 'srv_1',
      ttlMs: 45_000
    };

    await postOwnerPresence({
      runtimeUrl: 'https://runtime.example',
      lease,
      state: 'offline',
      fetchImpl: fetchImpl as never
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://runtime.example/owners/profile_1/presence',
      expect.objectContaining({
        body: JSON.stringify({
          state: 'offline',
          leaseId: 'lease_1'
        })
      })
    );
  });
});
