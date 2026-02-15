import { describe, expect, it } from 'vitest';
import { ChallengeService } from './ChallengeService.js';

describe('ChallengeService', () => {
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
});
