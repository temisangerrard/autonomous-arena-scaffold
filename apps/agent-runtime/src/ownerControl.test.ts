import { describe, expect, it } from 'vitest';
import {
  createOwnerPresenceLease,
  deriveOwnerControlState,
  ownerAutoplayBehaviorPatch,
  shouldAcceptOwnerPresenceOnline,
  shouldOwnerBotReconnect,
  shouldReleaseOwnerPresence
} from './ownerControl.js';

describe('deriveOwnerControlState', () => {
  it('marks owner bots as human-controlled while the owner is online', () => {
    expect(deriveOwnerControlState({
      ownerOnline: true,
      autoplayEnabled: true,
      challengeEnabled: false,
      connected: false
    })).toBe('human_active');
  });

  it('marks opted-in roaming owner bots as bot-active when offline and connected', () => {
    expect(deriveOwnerControlState({
      ownerOnline: false,
      autoplayEnabled: true,
      challengeEnabled: true,
      connected: true
    })).toBe('bot_active');
  });

  it('marks offline opted-out owner bots as idle', () => {
    expect(deriveOwnerControlState({
      ownerOnline: false,
      autoplayEnabled: false,
      challengeEnabled: false,
      connected: false
    })).toBe('idle_offline');
  });
});

describe('shouldOwnerBotReconnect', () => {
  it('only reconnects opted-in owner bots while the owner is offline', () => {
    expect(shouldOwnerBotReconnect({
      ownerOnline: false,
      autoplayEnabled: true,
      readinessStatus: 'ready'
    })).toBe(true);

    expect(shouldOwnerBotReconnect({
      ownerOnline: true,
      autoplayEnabled: true,
      readinessStatus: 'ready'
    })).toBe(false);

    expect(shouldOwnerBotReconnect({
      ownerOnline: false,
      autoplayEnabled: false,
      readinessStatus: 'ready'
    })).toBe(false);
  });
});

describe('ownerAutoplayBehaviorPatch', () => {
  it('forces owner bots back to active challenge mode when autoplay is enabled offline', () => {
    expect(ownerAutoplayBehaviorPatch({
      autoplayEnabled: true,
      targetPreference: 'human_first'
    })).toMatchObject({
      mode: 'active',
      challengeEnabled: true,
      targetPreference: 'human_first'
    });
  });

  it('parks owner bots when autoplay is disabled', () => {
    expect(ownerAutoplayBehaviorPatch({
      autoplayEnabled: false,
      targetPreference: 'any'
    })).toMatchObject({
      mode: 'passive',
      challengeEnabled: false,
      targetPreference: 'human_only'
    });
  });
});

describe('owner presence leases', () => {
  it('prefers websocket leases over legacy browser heartbeats', () => {
    const current = createOwnerPresenceLease({
      leaseId: 'lease_a',
      ttlMs: 45_000,
      playerId: 'u_profile_1',
      serverId: 'srv_1'
    }, 1_000);

    expect(shouldAcceptOwnerPresenceOnline({
      current,
      leaseId: null
    })).toBe(false);

    expect(shouldAcceptOwnerPresenceOnline({
      current,
      leaseId: 'lease_b'
    })).toBe(true);
  });

  it('requires the active lease id before clearing websocket-owned presence', () => {
    const current = createOwnerPresenceLease({
      leaseId: 'lease_b',
      ttlMs: 45_000,
      playerId: 'u_profile_1',
      serverId: 'srv_1'
    }, 1_000);

    expect(shouldReleaseOwnerPresence({
      current,
      leaseId: 'lease_a'
    })).toBe(false);

    expect(shouldReleaseOwnerPresence({
      current,
      leaseId: 'lease_b'
    })).toBe(true);
  });

  it('allows lease-less release for legacy presence records', () => {
    const current = createOwnerPresenceLease({
      ttlMs: 45_000,
      source: 'legacy_browser'
    }, 1_000);

    expect(shouldReleaseOwnerPresence({
      current,
      leaseId: null
    })).toBe(true);
  });
});
