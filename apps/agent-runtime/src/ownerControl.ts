export type OwnerControlState = 'human_active' | 'bot_active' | 'idle_offline';

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
