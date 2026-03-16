export type OwnerControlState = 'human_active' | 'bot_active' | 'idle_offline';
export type OwnerPresenceSource = 'ws_session' | 'legacy_browser';

export type OwnerPresenceLease = {
  leaseId: string | null;
  until: number;
  playerId: string | null;
  serverId: string | null;
  source: OwnerPresenceSource;
};

function normalizeLeaseId(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function shouldAcceptOwnerPresenceOnline(params: {
  current?: OwnerPresenceLease | null;
  leaseId?: string | null;
}): boolean {
  const incomingLeaseId = normalizeLeaseId(params.leaseId);
  if (incomingLeaseId) {
    return true;
  }
  return !params.current?.leaseId;
}

export function createOwnerPresenceLease(params: {
  leaseId?: string | null;
  ttlMs: number;
  playerId?: string | null;
  serverId?: string | null;
  source?: OwnerPresenceSource | null;
}, now = Date.now()): OwnerPresenceLease {
  const boundedTtl = Math.max(10_000, Math.min(5 * 60_000, Number(params.ttlMs || 90_000)));
  const leaseId = normalizeLeaseId(params.leaseId);
  const source: OwnerPresenceSource = params.source === 'legacy_browser' || !leaseId
    ? 'legacy_browser'
    : 'ws_session';
  return {
    leaseId,
    until: now + boundedTtl,
    playerId: String(params.playerId || '').trim() || null,
    serverId: String(params.serverId || '').trim() || null,
    source
  };
}

export function shouldReleaseOwnerPresence(params: {
  current?: OwnerPresenceLease | null;
  leaseId?: string | null;
}): boolean {
  const current = params.current;
  if (!current) {
    return false;
  }
  const incomingLeaseId = normalizeLeaseId(params.leaseId);
  if (current.leaseId) {
    return Boolean(incomingLeaseId && incomingLeaseId === current.leaseId);
  }
  return current.source !== 'ws_session';
}

export function ownerAutoplayBehaviorPatch(params: {
  autoplayEnabled: boolean;
  targetPreference?: 'any' | 'human_only' | 'human_first';
}) {
  if (!params.autoplayEnabled) {
    return {
      mode: 'passive' as const,
      challengeEnabled: false,
      targetPreference: 'human_only' as const
    };
  }
  return {
    mode: 'active' as const,
    challengeEnabled: true,
    targetPreference: params.targetPreference === 'any' || params.targetPreference === 'human_only' || params.targetPreference === 'human_first'
      ? params.targetPreference
      : 'human_first'
  };
}

export function deriveOwnerControlState(params: {
  ownerOnline: boolean;
  autoplayEnabled: boolean;
  challengeEnabled: boolean;
  connected: boolean;
}): OwnerControlState {
  if (params.ownerOnline) {
    return 'human_active';
  }
  if (params.autoplayEnabled && params.challengeEnabled && params.connected) {
    return 'bot_active';
  }
  return 'idle_offline';
}

export function shouldOwnerBotReconnect(params: {
  ownerOnline: boolean;
  autoplayEnabled: boolean;
  readinessStatus?: string | null;
}): boolean {
  if (params.ownerOnline || !params.autoplayEnabled) {
    return false;
  }
  const readiness = String(params.readinessStatus || '').trim().toLowerCase();
  if (!readiness) {
    return true;
  }
  return readiness === 'ready' || readiness === 'all_checks_passed';
}
