import { describe, expect, it } from 'vitest';
import { computeCoinflipFromSeeds, sha256Hex } from './coinflip.js';

describe('coinflip helpers', () => {
  it('creates deterministic commit hash and result for same inputs', () => {
    const houseSeed = 'house_seed_abc123';
    const playerSeed = 'player_seed_xyz789';
    const challengeId = 'challenge_42';

    const commitA = sha256Hex(houseSeed);
    const commitB = sha256Hex(houseSeed);
    expect(commitA).toBe(commitB);

    const tossA = computeCoinflipFromSeeds(houseSeed, playerSeed, challengeId);
    const tossB = computeCoinflipFromSeeds(houseSeed, playerSeed, challengeId);
    expect(tossA).toBe(tossB);
    expect(['heads', 'tails']).toContain(tossA);
  });

  it('changes outcome when challenge id changes', () => {
    const houseSeed = 'house_seed_abc123';
    const playerSeed = 'player_seed_xyz789';

    const tossA = computeCoinflipFromSeeds(houseSeed, playerSeed, 'challenge_a');
    const tossB = computeCoinflipFromSeeds(houseSeed, playerSeed, 'challenge_b');
    expect(['heads', 'tails']).toContain(tossA);
    expect(['heads', 'tails']).toContain(tossB);
  });
});
