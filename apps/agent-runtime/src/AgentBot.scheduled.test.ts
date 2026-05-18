import { describe, expect, it } from 'vitest';
import type { AgentBehaviorConfig } from './AgentBot.js';
import { AgentBot } from './AgentBot.js';

function makeBehavior(overrides: Partial<AgentBehaviorConfig> = {}): AgentBehaviorConfig {
  return {
    personality: 'social',
    mode: 'active',
    challengeEnabled: true,
    challengeCooldownMs: 5000,
    targetPreference: 'any',
    baseWager: 2,
    maxWager: 10,
    autoplay: {
      enabled: true,
      allowedGames: ['coinflip', 'rps'],
      wagerMode: 'fixed',
      baseWager: 3,
      maxWager: 9,
      cooldownMs: 1000
    },
    ...overrides
  };
}

function makeBot(behaviorOverrides: Partial<AgentBehaviorConfig> = {}) {
  return new AgentBot({
    id: 'bot_scheduled',
    wsBaseUrl: 'ws://localhost:4000/ws',
    displayName: 'Scheduled Bot',
    behavior: makeBehavior(behaviorOverrides)
  });
}

describe('AgentBot scheduled autoplay planning', () => {
  it('returns a station-game plan when autoplay is enabled and the wallet can fund the wager', () => {
    const bot = makeBot();
    bot.getWalletBalance = () => 25;
    bot.getWalletReadiness = () => ({ status: 'ready' } as never);

    const plan = bot.getScheduledAutoplayPlan();

    expect(plan).not.toBeNull();
    expect(plan?.wager).toBe(3);
    expect(['coinflip', 'rps']).toContain(String(plan?.gameType));
  });

  it('returns null when autoplay is paused or the wallet is not ready', () => {
    const bot = makeBot();
    bot.getWalletBalance = () => 1;
    bot.getWalletReadiness = () => ({ status: 'insufficient_funds' } as never);

    expect(bot.getScheduledAutoplayPlan()).toBeNull();
  });
});
