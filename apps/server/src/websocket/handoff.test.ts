import { describe, expect, it } from 'vitest';
import { decideConnectionCollision, resolvePreferredPlayerId } from './handoff.js';

describe('resolvePreferredPlayerId', () => {
  it('uses the owner profile client id for owner-controlled agent actors', () => {
    expect(resolvePreferredPlayerId({
      role: 'agent',
      requestedAgentId: 'agent_profile_1',
      normalizedClientId: 'profile_1'
    })).toBe('u_profile_1');
  });

  it('falls back to agent id for background agents', () => {
    expect(resolvePreferredPlayerId({
      role: 'agent',
      requestedAgentId: 'agent_bg_3'
    })).toBe('agent_bg_3');
  });
});

describe('decideConnectionCollision', () => {
  it('lets a human replace an owner bot on the same actor id', () => {
    expect(decideConnectionCollision({
      incomingRole: 'human',
      existingRole: 'agent',
      preferredId: 'u_profile_1'
    })).toBe('replace_existing');
  });

  it('rejects an owner bot reconnect while the human owns the actor', () => {
    expect(decideConnectionCollision({
      incomingRole: 'agent',
      existingRole: 'human',
      preferredId: 'u_profile_1'
    })).toBe('reject_incoming');
  });

  it('replaces same-role reconnects', () => {
    expect(decideConnectionCollision({
      incomingRole: 'human',
      existingRole: 'human',
      preferredId: 'u_profile_1'
    })).toBe('replace_existing');
  });
});
