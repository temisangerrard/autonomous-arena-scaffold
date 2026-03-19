import { randomUUID } from 'node:crypto';

export type OwnerPresenceLease = {
  profileId: string;
  leaseId: string;
  playerId: string;
  serverId: string;
  ttlMs: number;
};

type OwnerPresenceState = 'online' | 'offline';

export function createOwnerPresenceLease(params: {
  profileId: string;
  playerId: string;
  serverId: string;
  ttlMs?: number;
}): OwnerPresenceLease {
  return {
    profileId: String(params.profileId || '').trim(),
    leaseId: randomUUID(),
    playerId: String(params.playerId || '').trim(),
    serverId: String(params.serverId || '').trim(),
    ttlMs: Math.max(10_000, Math.min(5 * 60_000, Number(params.ttlMs || 45_000)))
  };
}

export async function postOwnerPresence(params: {
  runtimeUrl: string;
  internalToken?: string;
  lease: OwnerPresenceLease;
  state: OwnerPresenceState;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const runtimeUrl = String(params.runtimeUrl || '').trim().replace(/\/+$/, '');
  if (!runtimeUrl || !params.lease.profileId) {
    return;
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const body = params.state === 'online'
    ? {
        state: 'online',
        leaseId: params.lease.leaseId,
        ttlMs: params.lease.ttlMs,
        playerId: params.lease.playerId,
        serverId: params.lease.serverId
      }
    : {
        state: 'offline',
        leaseId: params.lease.leaseId
      };
  const response = await fetchImpl(`${runtimeUrl}/owners/${encodeURIComponent(params.lease.profileId)}/presence`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.internalToken ? { 'x-internal-token': params.internalToken } : {})
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`owner_presence_${params.state}_http_${response.status}`);
  }
}
