export type ChallengeStatus = 'pending' | 'active' | 'resolved' | 'declined' | 'expired';

export type Challenge = {
  id: string;
  challengerId: string;
  opponentId: string;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  resolvedAt: number | null;
  winnerId: string | null;
};

export type ChallengeEvent = {
  type: 'challenge';
  event:
    | 'created'
    | 'accepted'
    | 'declined'
    | 'expired'
    | 'resolved'
    | 'invalid'
    | 'busy';
  challengeId?: string;
  challenge?: Challenge;
  to?: string[];
  reason?: string;
};

export type ChallengeLog = {
  at: number;
  event: ChallengeEvent['event'];
  challengeId: string | null;
  challengerId: string | null;
  opponentId: string | null;
  winnerId: string | null;
  reason: string | null;
};

export class ChallengeService {
  private readonly challenges = new Map<string, Challenge>();
  private readonly activeByPlayer = new Map<string, string>();
  private readonly recentLogs: ChallengeLog[] = [];
  private challengeCounter = 1;

  constructor(
    private readonly now: () => number,
    private readonly random: () => number,
    private readonly pendingTimeoutMs = 10_000,
    private readonly activeResolveMs = 6_000
  ) {}

  createChallenge(challengerId: string, opponentId: string): ChallengeEvent {
    if (challengerId === opponentId) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'self_challenge' });
    }

    if (this.activeByPlayer.has(challengerId) || this.activeByPlayer.has(opponentId)) {
      return this.withLog({
        type: 'challenge',
        event: 'busy',
        to: [challengerId],
        reason: 'player_busy'
      });
    }

    const challenge: Challenge = {
      id: `c_${this.challengeCounter++}`,
      challengerId,
      opponentId,
      status: 'pending',
      createdAt: this.now(),
      expiresAt: this.now() + this.pendingTimeoutMs,
      acceptedAt: null,
      resolvedAt: null,
      winnerId: null
    };

    this.challenges.set(challenge.id, challenge);
    this.activeByPlayer.set(challengerId, challenge.id);
    this.activeByPlayer.set(opponentId, challenge.id);

    return this.withLog({
      type: 'challenge',
      event: 'created',
      challengeId: challenge.id,
      challenge,
      to: [challengerId, opponentId]
    });
  }

  respond(challengeId: string, responderId: string, accept: boolean): ChallengeEvent {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.status !== 'pending') {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'challenge_not_pending' });
    }

    if (challenge.opponentId !== responderId) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'not_opponent' });
    }

    if (!accept) {
      challenge.status = 'declined';
      this.clearPlayerLocks(challenge);
      return this.withLog({
        type: 'challenge',
        event: 'declined',
        challengeId,
        challenge,
        to: [challenge.challengerId, challenge.opponentId]
      });
    }

    challenge.status = 'active';
    challenge.acceptedAt = this.now();
    challenge.expiresAt = this.now() + this.activeResolveMs;

    return this.withLog({
      type: 'challenge',
      event: 'accepted',
      challengeId,
      challenge,
      to: [challenge.challengerId, challenge.opponentId]
    });
  }

  tick(): ChallengeEvent[] {
    const now = this.now();
    const events: ChallengeEvent[] = [];

    for (const challenge of this.challenges.values()) {
      if (challenge.status === 'pending' && now >= challenge.expiresAt) {
        challenge.status = 'expired';
        this.clearPlayerLocks(challenge);
        events.push(
          this.withLog({
            type: 'challenge',
            event: 'expired',
            challengeId: challenge.id,
            challenge,
            to: [challenge.challengerId, challenge.opponentId]
          })
        );
        continue;
      }

      if (challenge.status === 'active' && now >= challenge.expiresAt) {
        challenge.status = 'resolved';
        challenge.resolvedAt = now;
        challenge.winnerId = this.random() < 0.5 ? challenge.challengerId : challenge.opponentId;
        this.clearPlayerLocks(challenge);
        events.push(
          this.withLog({
            type: 'challenge',
            event: 'resolved',
            challengeId: challenge.id,
            challenge,
            to: [challenge.challengerId, challenge.opponentId]
          })
        );
      }
    }

    return events;
  }

  clearDisconnectedPlayer(playerId: string): ChallengeEvent[] {
    const challengeId = this.activeByPlayer.get(playerId);
    if (!challengeId) {
      return [];
    }

    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      this.activeByPlayer.delete(playerId);
      return [];
    }

    if (challenge.status === 'pending') {
      challenge.status = 'expired';
      this.clearPlayerLocks(challenge);
      return [
        this.withLog({
          type: 'challenge',
          event: 'expired',
          challengeId: challenge.id,
          challenge,
          to: [challenge.challengerId, challenge.opponentId],
          reason: 'player_disconnected'
        })
      ];
    }

    return [];
  }

  getRecent(limit = 50): ChallengeLog[] {
    return this.recentLogs.slice(Math.max(0, this.recentLogs.length - limit));
  }

  private clearPlayerLocks(challenge: Challenge): void {
    this.activeByPlayer.delete(challenge.challengerId);
    this.activeByPlayer.delete(challenge.opponentId);
  }

  private withLog(event: ChallengeEvent): ChallengeEvent {
    this.recentLogs.push({
      at: this.now(),
      event: event.event,
      challengeId: event.challenge?.id ?? event.challengeId ?? null,
      challengerId: event.challenge?.challengerId ?? null,
      opponentId: event.challenge?.opponentId ?? null,
      winnerId: event.challenge?.winnerId ?? null,
      reason: event.reason ?? null
    });

    if (this.recentLogs.length > 400) {
      this.recentLogs.splice(0, this.recentLogs.length - 400);
    }

    return event;
  }
}
