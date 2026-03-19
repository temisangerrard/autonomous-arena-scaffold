import { describe, expect, it } from 'vitest';
import type { BotStrategyPolicy } from '@arena/shared';
import { policyToBehaviorPatch } from './strategyCompiler.js';

function policy(overrides: Partial<BotStrategyPolicy> = {}): BotStrategyPolicy {
  return {
    id: 'policy-1',
    profile: 'supervised',
    enforcementMode: 'app_layer',
    sessionBudgetUsdc: 10,
    maxWagerPerGameUsdc: 2,
    allowedGames: ['coinflip'],
    mayInitiateChallenges: false,
    mayAcceptChallenges: true,
    expiresAt: null,
    compiledAt: 1,
    ...overrides
  };
}

describe('policyToBehaviorPatch', () => {
  it('keeps challenge participation enabled when policy allows accepting but not initiating', () => {
    const patch = policyToBehaviorPatch(policy());

    expect(patch.challengeEnabled).toBe(true);
    expect(patch.mode).toBe('passive');
  });
});
