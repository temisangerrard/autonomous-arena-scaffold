import type {
  ChallengeStatus,
  GameType,
  RpsMove,
  CoinflipMove,
  GameMove,
  Challenge,
  ChallengeEvent,
  ChallengeLog
} from '@arena/shared';

// Re-export types for backward compatibility
export type {
  ChallengeStatus,
  GameType,
  RpsMove,
  CoinflipMove,
  GameMove,
  Challenge,
  ChallengeEvent,
  ChallengeLog
};

export class ChallengeService {
  private readonly challenges = new Map<string, Challenge>();
  private readonly activeByPlayer = new Map<string, string>();
  private readonly recentLogs: ChallengeLog[] = [];
  private challengeCounter = 1;
  private readonly coinflipResultOverride = new Map<string, CoinflipMove>();

  constructor(
    private readonly now: () => number,
    private readonly random: () => number,
    private readonly pendingTimeoutMs = 15_000,
    private readonly activeResolveMs = 45_000
  ) {}

  private isHouse(playerId: string): boolean {
    return playerId === 'system_house';
  }

  createChallenge(
    challengerId: string,
    opponentId: string,
    gameType: GameType,
    wager: number
  ): ChallengeEvent {
    if (challengerId === opponentId) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'self_challenge' });
    }

    const challengerBusy = this.activeByPlayer.has(challengerId);
    const opponentBusy = this.isHouse(opponentId) ? false : this.activeByPlayer.has(opponentId);
    if (challengerBusy || opponentBusy) {
      return this.withLog({
        type: 'challenge',
        event: 'busy',
        to: [challengerId],
        reason: 'player_busy'
      });
    }

    const safeWager = Math.max(0, Math.min(10_000, Number.isFinite(wager) ? wager : 1));

    const challenge: Challenge = {
      id: `c_${this.challengeCounter++}`,
      challengerId,
      opponentId,
      status: 'pending',
      gameType,
      wager: safeWager,
      createdAt: this.now(),
      expiresAt: this.now() + this.pendingTimeoutMs,
      acceptedAt: null,
      resolvedAt: null,
      winnerId: null,
      challengerMove: null,
      opponentMove: null,
      coinflipResult: null
    };

    this.challenges.set(challenge.id, challenge);
    this.activeByPlayer.set(challengerId, challenge.id);
    if (!this.isHouse(opponentId)) {
      this.activeByPlayer.set(opponentId, challenge.id);
    }

    return this.withLog({
      type: 'challenge',
      event: 'created',
      challengeId: challenge.id,
      challenge,
      to: [challengerId, opponentId]
    });
  }

  getChallenge(challengeId: string): Challenge | null {
    return this.challenges.get(challengeId) ?? null;
  }

  setCoinflipResultOverride(challengeId: string, result: CoinflipMove): void {
    if (!challengeId) {
      return;
    }
    if (result !== 'heads' && result !== 'tails') {
      return;
    }
    this.coinflipResultOverride.set(challengeId, result);
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

    // Both games require explicit moves; timeout resolves if one side is missing.
    challenge.expiresAt = this.now() + this.activeResolveMs;

    return this.withLog({
      type: 'challenge',
      event: 'accepted',
      challengeId,
      challenge,
      to: [challenge.challengerId, challenge.opponentId]
    });
  }

  abortChallenge(challengeId: string, status: 'declined' | 'expired', reason: string): ChallengeEvent {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || (challenge.status !== 'pending' && challenge.status !== 'active')) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'challenge_not_open' });
    }

    challenge.status = status;
    this.clearPlayerLocks(challenge);
    return this.withLog({
      type: 'challenge',
      event: status,
      challengeId,
      challenge,
      to: [challenge.challengerId, challenge.opponentId],
      reason
    });
  }

  submitMove(challengeId: string, playerId: string, move: GameMove): ChallengeEvent {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.status !== 'active') {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'challenge_not_active' });
    }

    if (challenge.gameType === 'rps' && !this.isRpsMove(move)) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'invalid_rps_move' });
    }
    if (challenge.gameType === 'coinflip' && !this.isCoinflipMove(move)) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'invalid_coinflip_move' });
    }

    if (playerId === challenge.challengerId) {
      challenge.challengerMove = move;
    } else if (playerId === challenge.opponentId) {
      challenge.opponentMove = move;
    } else {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'not_participant' });
    }

    if (!challenge.challengerMove || !challenge.opponentMove) {
      return this.withLog({
        type: 'challenge',
        event: 'move_submitted',
        challengeId,
        challenge,
        to: [challenge.challengerId, challenge.opponentId]
      });
    }

    if (challenge.gameType === 'rps') {
      return this.resolveRps(challenge);
    }

    return this.resolveCoinflip(challenge);
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
        if (challenge.gameType === 'rps') {
          if (challenge.challengerMove && !challenge.opponentMove) {
            challenge.winnerId = challenge.challengerId;
          } else if (!challenge.challengerMove && challenge.opponentMove) {
            challenge.winnerId = challenge.opponentId;
          } else {
            challenge.winnerId = null;
          }

          challenge.status = 'resolved';
          challenge.resolvedAt = now;
          this.clearPlayerLocks(challenge);
          events.push(
            this.withLog({
              type: 'challenge',
              event: 'resolved',
              challengeId: challenge.id,
              challenge,
              to: [challenge.challengerId, challenge.opponentId],
              reason: 'timeout_resolution'
            })
          );
          continue;
        }

        if (challenge.gameType === 'coinflip') {
          if (challenge.challengerMove && !challenge.opponentMove) {
            challenge.winnerId = challenge.challengerId;
          } else if (!challenge.challengerMove && challenge.opponentMove) {
            challenge.winnerId = challenge.opponentId;
          } else {
            challenge.winnerId = null;
          }

          challenge.status = 'resolved';
          challenge.resolvedAt = now;
          const override = this.coinflipResultOverride.get(challenge.id);
          if (override) {
            challenge.coinflipResult = override;
            this.coinflipResultOverride.delete(challenge.id);
          } else {
            challenge.coinflipResult = this.random() < 0.5 ? 'heads' : 'tails';
          }
          this.clearPlayerLocks(challenge);
          events.push(
            this.withLog({
              type: 'challenge',
              event: 'resolved',
              challengeId: challenge.id,
              challenge,
              to: [challenge.challengerId, challenge.opponentId],
              reason: 'timeout_resolution'
            })
          );
        }
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

    if (challenge.status === 'pending' || challenge.status === 'active') {
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

  private resolveCoinflip(challenge: Challenge): ChallengeEvent {
    if (!this.isCoinflipMove(challenge.challengerMove) || !this.isCoinflipMove(challenge.opponentMove)) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'missing_coinflip_moves' });
    }

    challenge.status = 'resolved';
    challenge.resolvedAt = this.now();
    const override = this.coinflipResultOverride.get(challenge.id);
    if (override) {
      challenge.coinflipResult = override;
      this.coinflipResultOverride.delete(challenge.id);
    } else {
      challenge.coinflipResult = this.random() < 0.5 ? 'heads' : 'tails';
    }

    if (challenge.challengerMove === challenge.opponentMove) {
      challenge.winnerId = null;
    } else if (challenge.challengerMove === challenge.coinflipResult) {
      challenge.winnerId = challenge.challengerId;
    } else if (challenge.opponentMove === challenge.coinflipResult) {
      challenge.winnerId = challenge.opponentId;
    } else {
      challenge.winnerId = null;
    }

    this.clearPlayerLocks(challenge);
    return this.withLog({
      type: 'challenge',
      event: 'resolved',
      challengeId: challenge.id,
      challenge,
      to: [challenge.challengerId, challenge.opponentId]
    });
  }

  private resolveRps(challenge: Challenge): ChallengeEvent {
    const challenger = challenge.challengerMove;
    const opponent = challenge.opponentMove;

    if (!this.isRpsMove(challenger) || !this.isRpsMove(opponent)) {
      return this.withLog({ type: 'challenge', event: 'invalid', reason: 'missing_moves' });
    }

    const winner = this.rpsWinner(challenger, opponent, challenge.challengerId, challenge.opponentId);

    challenge.status = 'resolved';
    challenge.resolvedAt = this.now();
    challenge.winnerId = winner;
    this.clearPlayerLocks(challenge);

    return this.withLog({
      type: 'challenge',
      event: 'resolved',
      challengeId: challenge.id,
      challenge,
      to: [challenge.challengerId, challenge.opponentId],
      reason: winner ? 'rps_result' : 'rps_tie'
    });
  }

  private rpsWinner(
    challengerMove: RpsMove,
    opponentMove: RpsMove,
    challengerId: string,
    opponentId: string
  ): string | null {
    if (challengerMove === opponentMove) {
      return null;
    }

    const challengerWins =
      (challengerMove === 'rock' && opponentMove === 'scissors') ||
      (challengerMove === 'paper' && opponentMove === 'rock') ||
      (challengerMove === 'scissors' && opponentMove === 'paper');

    return challengerWins ? challengerId : opponentId;
  }

  private clearPlayerLocks(challenge: Challenge): void {
    this.activeByPlayer.delete(challenge.challengerId);
    if (!this.isHouse(challenge.opponentId)) {
      this.activeByPlayer.delete(challenge.opponentId);
    }
  }

  private isRpsMove(move: GameMove | null): move is RpsMove {
    return move === 'rock' || move === 'paper' || move === 'scissors';
  }

  private isCoinflipMove(move: GameMove | null): move is CoinflipMove {
    return move === 'heads' || move === 'tails';
  }

  private withLog(event: ChallengeEvent): ChallengeEvent {
    this.recentLogs.push({
      at: this.now(),
      event: event.event,
      challengeId: event.challenge?.id ?? event.challengeId ?? null,
      challengerId: event.challenge?.challengerId ?? null,
      opponentId: event.challenge?.opponentId ?? null,
      gameType: event.challenge?.gameType ?? null,
      winnerId: event.challenge?.winnerId ?? null,
      reason: event.reason ?? null
    });

    if (this.recentLogs.length > 400) {
      this.recentLogs.splice(0, this.recentLogs.length - 400);
    }

    return event;
  }
}
