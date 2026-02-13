import { describe, expect, it } from 'vitest';
import { PolicyEngine, type PolicyContext } from './PolicyEngine.js';

const engine = new PolicyEngine();

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    self: { id: 'self', x: 0, z: 0 },
    others: [{ id: 'p1', x: 10, z: 0 }],
    nearbyIds: [],
    nowMs: 12345,
    ...overrides
  };
}

describe('PolicyEngine', () => {
  it('is deterministic for same inputs', () => {
    const memory = { seed: 42 };
    const first = engine.decide('social', context(), memory);
    const second = engine.decide('social', context(), memory);
    expect(second).toEqual(first);
  });

  it('aggressive moves toward nearest target', () => {
    const decision = engine.decide('aggressive', context(), { seed: 1 });
    expect(decision.moveX).toBeGreaterThan(0);
    expect(Math.abs(decision.moveZ)).toBeLessThan(0.01);
  });

  it('conservative moves away when target is too close', () => {
    const decision = engine.decide(
      'conservative',
      context({ others: [{ id: 'p1', x: 2, z: 0 }], nearbyIds: ['p1'] }),
      { seed: 2 }
    );
    expect(decision.moveX).toBeLessThan(0);
  });
});
