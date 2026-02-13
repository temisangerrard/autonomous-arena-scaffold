import { describe, expect, it } from 'vitest';
import { ChallengeService } from './ChallengeService.js';

describe('ChallengeService', () => {
  it('creates pending challenge and locks both players', () => {
    const now = 1000;
    const service = new ChallengeService(() => now, () => 0.2, 10000, 6000);

    const created = service.createChallenge('a', 'b');
    expect(created.event).toBe('created');

    const busy = service.createChallenge('a', 'c');
    expect(busy.event).toBe('busy');
  });

  it('accepts and resolves challenge on tick', () => {
    let now = 1000;
    const service = new ChallengeService(() => now, () => 0.1, 10000, 6000);

    const created = service.createChallenge('a', 'b');
    const challengeId = created.challengeId;
    expect(challengeId).toBeDefined();

    const accepted = service.respond(challengeId!, 'b', true);
    expect(accepted.event).toBe('accepted');

    now += 7000;
    const events = service.tick();
    expect(events.some((event) => event.event === 'resolved')).toBe(true);
    expect(events[0]?.challenge?.winnerId).toBe('a');
  });

  it('expires pending challenge on timeout', () => {
    let now = 1000;
    const service = new ChallengeService(() => now, () => 0.9, 10000, 6000);

    service.createChallenge('a', 'b');
    now += 10001;
    const events = service.tick();

    expect(events[0]?.event).toBe('expired');
  });

  it('declines challenge when opponent rejects', () => {
    const service = new ChallengeService(() => 1000, () => 0.5);
    const created = service.createChallenge('a', 'b');

    const declined = service.respond(created.challengeId!, 'b', false);
    expect(declined.event).toBe('declined');
  });
});
