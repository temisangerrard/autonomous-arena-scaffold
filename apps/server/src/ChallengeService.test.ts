import { describe, expect, it } from 'vitest';
import { ChallengeService } from './ChallengeService.js';

describe('ChallengeService', () => {
  it('generates prefixed monotonic challenge IDs', () => {
    const service = new ChallengeService(() => 1000, () => 0.2, 10_000, 6_000, 'srv_a_boot1');
    const c1 = service.createChallenge('a', 'b', 'rps', 2);
    const c2 = service.createChallenge('c', 'd', 'coinflip', 1);
    expect(c1.challengeId).toBeDefined();
    expect(c2.challengeId).toBeDefined();
    expect(c1.challengeId).toMatch(/^c_srv_a_boot1_[a-z0-9]+$/);
    expect(c2.challengeId).toMatch(/^c_srv_a_boot1_[a-z0-9]+$/);
    expect(c1.challengeId).not.toBe(c2.challengeId);
  });

  it('does not collide across services with different prefixes', () => {
    const serviceA = new ChallengeService(() => 1000, () => 0.2, 10_000, 6_000, 'srv_a_boot1');
    const serviceB = new ChallengeService(() => 1000, () => 0.2, 10_000, 6_000, 'srv_b_boot1');
    const cA = serviceA.createChallenge('a', 'b', 'rps', 1);
    const cB = serviceB.createChallenge('x', 'y', 'rps', 1);
    expect(cA.challengeId).toBeDefined();
    expect(cB.challengeId).toBeDefined();
    expect(cA.challengeId).not.toBe(cB.challengeId);
  });

  it('creates pending challenge and locks both players', () => {
    const now = 1000;
    const service = new ChallengeService(() => now, () => 0.2, 10000, 6000);

    const created = service.createChallenge('a', 'b', 'rps', 2);
    expect(created.event).toBe('created');

    const busy = service.createChallenge('a', 'c', 'coinflip', 1);
    expect(busy.event).toBe('busy');
  });

  it('accepts and resolves coinflip when both players choose sides', () => {
    const now = 1000;
    const service = new ChallengeService(() => now, () => 0.1, 10000, 6000);

    const created = service.createChallenge('a', 'b', 'coinflip', 3);
    const challengeId = created.challengeId;
    expect(challengeId).toBeDefined();

    const accepted = service.respond(challengeId!, 'b', true);
    expect(accepted.event).toBe('accepted');
    service.submitMove(challengeId!, 'a', 'heads');
    const resolved = service.submitMove(challengeId!, 'b', 'tails');
    expect(resolved.event).toBe('resolved');
    expect(resolved.challenge?.coinflipResult).toBe('heads');
    expect(resolved.challenge?.winnerId).toBe('a');
  });

  it('resolves rps when both players submit moves', () => {
    const service = new ChallengeService(() => 1000, () => 0.9);
    const created = service.createChallenge('a', 'b', 'rps', 1);

    service.respond(created.challengeId!, 'b', true);
    service.submitMove(created.challengeId!, 'a', 'rock');
    const resolved = service.submitMove(created.challengeId!, 'b', 'scissors');

    expect(resolved.event).toBe('resolved');
    expect(resolved.challenge?.winnerId).toBe('a');
  });

  it('declines challenge when opponent rejects', () => {
    const service = new ChallengeService(() => 1000, () => 0.5);
    const created = service.createChallenge('a', 'b', 'rps', 1);

    const declined = service.respond(created.challengeId!, 'b', false);
    expect(declined.event).toBe('declined');
  });

  it('resolves dice duel with deterministic station-style seeds', () => {
    const service = new ChallengeService(() => 1000, () => 0.4);
    const created = service.createChallenge('a', 'b', 'dice_duel', 1);
    expect(created.challenge).toBeTruthy();
    if (!created.challenge) {
      return;
    }
    created.challenge.provablyFair = {
      commitHash: 'c',
      playerSeed: 'player_seed',
      revealSeed: 'house_seed',
      method: 'sha256(reveal|player|id|dice_duel)'
    };
    service.respond(created.challenge.id, 'b', true);
    service.submitMove(created.challenge.id, 'a', 'd1');
    const resolved = service.submitMove(created.challenge.id, 'b', 'd6');
    expect(resolved.event).toBe('resolved');
    expect([null, 'a', 'b']).toContain(resolved.challenge?.winnerId ?? null);
    expect([1, 2, 3, 4, 5, 6]).toContain(resolved.challenge?.diceResult ?? 0);
  });
});
