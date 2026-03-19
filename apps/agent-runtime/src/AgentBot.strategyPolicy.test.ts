import { describe, expect, it, vi, afterEach } from 'vitest';
import type { BotStrategyPolicy } from '@arena/shared';
import { AgentBot, type AgentBehaviorConfig } from './AgentBot.js';

function strategyPolicy(overrides: Partial<BotStrategyPolicy> = {}): BotStrategyPolicy {
  return {
    id: 'policy-1',
    profile: 'supervised',
    enforcementMode: 'app_layer',
    sessionBudgetUsdc: 10,
    maxWagerPerGameUsdc: 2,
    allowedGames: ['coinflip'],
    mayInitiateChallenges: false,
    mayAcceptChallenges: false,
    expiresAt: null,
    compiledAt: 1,
    ...overrides
  };
}

function behavior(overrides: Partial<AgentBehaviorConfig> = {}): AgentBehaviorConfig {
  return {
    personality: 'conservative',
    mode: 'passive',
    challengeEnabled: true,
    challengeCooldownMs: 1000,
    targetPreference: 'human_only',
    baseWager: 1,
    maxWager: 2,
    strategyPolicy: strategyPolicy(),
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentBot strategy policy acceptance', () => {
  it('declines incoming challenges when the strategy policy disallows acceptance', () => {
    vi.useFakeTimers();

    const send = vi.fn();
    const bot = new AgentBot({
      id: 'bot-1',
      wsBaseUrl: 'ws://arena.example/ws',
      displayName: 'Bot 1',
      behavior: behavior()
    });

    (bot as any).ws = { OPEN: 1, readyState: 1, send };
    (bot as any).playerId = 'bot-1';

    (bot as any).handleChallengeEvent({
      event: 'created',
      challenge: {
        id: 'challenge-1',
        challengerId: 'player-2',
        opponentId: 'bot-1',
        gameType: 'coinflip',
        wager: 1,
        status: 'pending'
      }
    });

    vi.runAllTimers();

    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(JSON.parse(firstCall![0])).toMatchObject({
      type: 'challenge_response',
      challengeId: 'challenge-1',
      accept: false
    });
  });
});
