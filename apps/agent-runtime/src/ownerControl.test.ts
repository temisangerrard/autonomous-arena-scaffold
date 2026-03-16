import { describe, expect, it } from 'vitest';
import { deriveOwnerControlState, shouldOwnerBotReconnect } from './ownerControl.js';

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
