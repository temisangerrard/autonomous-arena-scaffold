import type { PlayerRole } from './auth.js';

export function resolvePreferredPlayerId(params: {
  role: PlayerRole;
  normalizedClientId?: string;
  requestedAgentId?: string;
}): string | undefined {
  if (params.normalizedClientId) {
    return `u_${params.normalizedClientId}`;
  }
  if (params.role === 'agent') {
    return params.requestedAgentId;
  }
  return undefined;
}

export function decideConnectionCollision(params: {
  incomingRole: PlayerRole;
  existingRole: PlayerRole;
  preferredId: string;
}): 'replace_existing' | 'reject_incoming' {
  void params.preferredId;
  if (params.incomingRole === 'agent' && params.existingRole === 'human') {
    return 'reject_incoming';
  }
  return 'replace_existing';
}
