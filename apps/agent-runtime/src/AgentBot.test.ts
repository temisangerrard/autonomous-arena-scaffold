import { describe, expect, it, vi, afterEach } from 'vitest';
import { AgentBot, type AgentBehaviorConfig } from './AgentBot.js';
import type { AutoplayStrategyConfig } from '@arena/shared';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeAutoplay(overrides: Partial<AutoplayStrategyConfig> = {}): AutoplayStrategyConfig {
  return {
    enabled: true,
    allowedGames: ['rps', 'coinflip', 'dice_duel'],
    wagerMode: 'fixed',
    baseWager: 10,
    maxWager: 100,
    cooldownMs: 5000,
    ...overrides
  };
}

function makeBehavior(overrides: Partial<AgentBehaviorConfig> = {}): AgentBehaviorConfig {
  return {
    personality: 'social',
    mode: 'active',
    challengeEnabled: true,
    challengeCooldownMs: 5000,
    targetPreference: 'any',
    baseWager: 5,
    maxWager: 50,
    ...overrides
  };
}

function makeBot(behaviorOverrides: Partial<AgentBehaviorConfig> = {}, id = 'bot_abc'): AgentBot {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (AgentBot as any)({
    id,
    wsBaseUrl: 'ws://localhost:4000/ws',
    displayName: 'TestBot',
    behavior: makeBehavior(behaviorOverrides)
  });
}

// Helper to access private members in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function priv(bot: AgentBot): any {
  return bot;
}

// ─── computeNextWager ─────────────────────────────────────────────────────────

describe('computeNextWager — fixed mode', () => {
  it('returns baseWager clamped to maxWager', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ wagerMode: 'fixed', baseWager: 25, maxWager: 100 }) });
    expect(priv(bot).computeNextWager()).toBe(25);
  });

  it('clamps to maxWager when base exceeds max', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ wagerMode: 'fixed', baseWager: 200, maxWager: 50 }) });
    expect(priv(bot).computeNextWager()).toBe(50);
  });

  it('returns at least 1', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ wagerMode: 'fixed', baseWager: 0, maxWager: 0 }) });
    expect(priv(bot).computeNextWager()).toBeGreaterThanOrEqual(1);
  });
});

describe('computeNextWager — percent_wallet mode', () => {
  it('computes wager as percentage of wallet balance', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'percent_wallet', walletPercent: 10, baseWager: 1, maxWager: 1000 })
    });
    bot.getWalletBalance = () => 500;
    // 10% of 500 = 50, clamped to [1, max(50, baseWager=1)] → 50
    expect(priv(bot).computeNextWager()).toBe(50);
  });

  it('uses baseWager when wallet balance yields less', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'percent_wallet', walletPercent: 1, baseWager: 20, maxWager: 1000 })
    });
    bot.getWalletBalance = () => 10; // 1% of 10 = 0.1 → floor=0 → max(0, 20) = 20
    expect(priv(bot).computeNextWager()).toBe(20);
  });

  it('falls back to baseWager when getWalletBalance is null', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'percent_wallet', walletPercent: 10, baseWager: 15, maxWager: 1000 })
    });
    bot.getWalletBalance = null;
    // balance = baseW = 15, 10% of 15 = 1 → max(1, 15) = 15
    expect(priv(bot).computeNextWager()).toBe(15);
  });

  it('clamps walletPercent to [0.01, 100]', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'percent_wallet', walletPercent: 999, baseWager: 1, maxWager: 10000 })
    });
    bot.getWalletBalance = () => 200;
    // 100% of 200 = 200, floor = 200, clamped to maxWager=10000 → 200
    expect(priv(bot).computeNextWager()).toBe(200);
  });

  it('returns 0 when wallet balance is empty', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'percent_wallet', walletPercent: 10, baseWager: 20, maxWager: 1000 })
    });
    bot.getWalletBalance = () => 0;
    expect(priv(bot).computeNextWager()).toBe(0);
  });
});

describe('computeNextWager — martingale mode', () => {
  it('starts at baseWager when currentWager is 0', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 100 })
    });
    // autoplaySession.currentWager starts at 0 → falls back to baseWager=10
    expect(priv(bot).computeNextWager()).toBe(10);
  });

  it('returns current wager when already set by a previous loss', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 200 })
    });
    bot.restoreAutoplaySession({ currentWager: 40 });
    expect(priv(bot).computeNextWager()).toBe(40);
  });

  it('clamps to maxWager', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 30 })
    });
    bot.restoreAutoplaySession({ currentWager: 200 });
    expect(priv(bot).computeNextWager()).toBe(30);
  });
});

describe('computeNextWager — legacy (no autoplay config)', () => {
  it('aggressive bot returns base wager (clamped)', () => {
    const bot = makeBot({ personality: 'aggressive', baseWager: 5, maxWager: 20 });
    expect(priv(bot).computeNextWager()).toBe(5);
  });

  it('social bot returns base wager', () => {
    const bot = makeBot({ personality: 'social', baseWager: 3, maxWager: 10 });
    expect(priv(bot).computeNextWager()).toBe(3);
  });
});

// ─── pickAutoplayGame ─────────────────────────────────────────────────────────

describe('pickAutoplayGame', () => {
  it('returns a game from the allowed list', () => {
    const allowed = ['rps', 'coinflip', 'dice_duel'] as const;
    const bot = makeBot({ autoplay: makeAutoplay({ allowedGames: [...allowed] }) });
    const game = priv(bot).pickAutoplayGame() as string;
    expect(allowed).toContain(game);
  });

  it('defaults to all three games when allowedGames is empty', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ allowedGames: [] }) });
    const game = priv(bot).pickAutoplayGame() as string;
    expect(['rps', 'coinflip', 'dice_duel']).toContain(game);
  });

  it('only returns from a restricted list', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ allowedGames: ['coinflip'] }) });
    expect(priv(bot).pickAutoplayGame()).toBe('coinflip');
  });
});

// ─── enforceSessionRiskStops ──────────────────────────────────────────────────

describe('enforceSessionRiskStops', () => {
  it('pauses and marks stop_loss_hit when PnL hits the loss limit', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ sessionLossLimit: 50 })
    });
    bot.restoreAutoplaySession({ sessionNetPnl: -50 });
    priv(bot).sessionNetPnl = -50;
    priv(bot).enforceSessionRiskStops();
    const session = bot.getAutoplaySession();
    expect(session.pauseReason).toBe('stop_loss_hit');
  });

  it('pauses and marks take_profit_hit when PnL hits the win target', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ sessionWinTarget: 100 })
    });
    priv(bot).sessionNetPnl = 100;
    priv(bot).enforceSessionRiskStops();
    const session = bot.getAutoplaySession();
    expect(session.pauseReason).toBe('take_profit_hit');
  });

  it('does nothing when limits are not set', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ sessionLossLimit: 0, sessionWinTarget: 0 }) });
    priv(bot).sessionNetPnl = -999;
    priv(bot).enforceSessionRiskStops();
    expect(bot.getAutoplaySession().pauseReason).toBeNull();
  });

  it('does nothing when limits are not breached', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ sessionLossLimit: 100, sessionWinTarget: 200 }) });
    priv(bot).sessionNetPnl = -50;
    priv(bot).enforceSessionRiskStops();
    expect(bot.getAutoplaySession().pauseReason).toBeNull();
  });
});

// ─── updateAutoplayWagerAfterResult ───────────────────────────────────────────

describe('updateAutoplayWagerAfterResult', () => {
  it('resets martingale wager to base on win', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 200 })
    });
    bot.restoreAutoplaySession({ currentWager: 80, consecutiveLosses: 3 });
    priv(bot).updateAutoplayWagerAfterResult(true, 80);
    const session = bot.getAutoplaySession();
    expect(session.currentWager).toBe(10);
    expect(session.consecutiveLosses).toBe(0);
  });

  it('doubles martingale wager on loss (multiplier 2)', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 200, martingaleMultiplier: 2 })
    });
    bot.restoreAutoplaySession({ currentWager: 10 });
    priv(bot).updateAutoplayWagerAfterResult(false, 10);
    const session = bot.getAutoplaySession();
    expect(session.currentWager).toBe(20);
    expect(session.consecutiveLosses).toBe(1);
  });

  it('clamps martingale wager to maxWager on repeated losses', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ wagerMode: 'martingale', baseWager: 10, maxWager: 50, martingaleMultiplier: 2 })
    });
    bot.restoreAutoplaySession({ currentWager: 40 });
    priv(bot).updateAutoplayWagerAfterResult(false, 40);
    const session = bot.getAutoplaySession();
    expect(session.currentWager).toBe(50);
  });

  it('applies cooling_down pause after each game when cooldownMs > 0', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ cooldownMs: 3000 })
    });
    priv(bot).updateAutoplayWagerAfterResult(true, 10);
    expect(bot.getAutoplaySession().pauseReason).toBe('cooling_down');
  });

  it('does not apply cooldown when cooldownMs is 0', () => {
    const bot = makeBot({
      autoplay: makeAutoplay({ cooldownMs: 0 })
    });
    priv(bot).updateAutoplayWagerAfterResult(true, 10);
    expect(bot.getAutoplaySession().pauseReason).toBeNull();
  });

  it('does nothing when no autoplay config is set', () => {
    const bot = makeBot(); // no autoplay
    // should not throw and session remains default
    priv(bot).updateAutoplayWagerAfterResult(false, 10);
    expect(bot.getAutoplaySession().consecutiveLosses).toBe(0);
  });

  it('increments consecutiveLosses on loss (non-martingale)', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ wagerMode: 'fixed', cooldownMs: 0 }) });
    priv(bot).updateAutoplayWagerAfterResult(false, 10);
    expect(bot.getAutoplaySession().consecutiveLosses).toBe(1);
  });

  it('resets consecutiveLosses on win (non-martingale)', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ wagerMode: 'fixed', cooldownMs: 0 }) });
    bot.restoreAutoplaySession({ consecutiveLosses: 5 });
    priv(bot).updateAutoplayWagerAfterResult(true, 10);
    expect(bot.getAutoplaySession().consecutiveLosses).toBe(0);
  });
});

// ─── resetAutoplaySession / restoreAutoplaySession ────────────────────────────

describe('resetAutoplaySession', () => {
  it('resets all session fields to defaults', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ baseWager: 20 }) });
    bot.restoreAutoplaySession({ sessionNetPnl: -100, consecutiveLosses: 5, currentWager: 80 });
    bot.resetAutoplaySession();
    const session = bot.getAutoplaySession();
    expect(session.sessionNetPnl).toBe(0);
    expect(session.consecutiveLosses).toBe(0);
    expect(session.currentWager).toBe(20); // baseWager from autoplay config
    expect(session.pauseReason).toBeNull();
  });

  it('falls back to behavior.baseWager when no autoplay config', () => {
    const bot = makeBot({ baseWager: 7 }); // no autoplay
    bot.resetAutoplaySession();
    expect(bot.getAutoplaySession().currentWager).toBe(7);
  });
});

describe('restoreAutoplaySession', () => {
  it('merges partial session state', () => {
    const bot = makeBot({ autoplay: makeAutoplay() });
    bot.restoreAutoplaySession({ sessionNetPnl: 42, consecutiveLosses: 3 });
    const session = bot.getAutoplaySession();
    expect(session.sessionNetPnl).toBe(42);
    expect(session.consecutiveLosses).toBe(3);
    expect(session.pauseReason).toBeNull(); // unchanged default
  });
});

// ─── shouldAcceptChallenge ────────────────────────────────────────────────────

describe('shouldAcceptChallenge', () => {
  it('aggressive bots always accept', () => {
    const bot = makeBot({ personality: 'aggressive' });
    for (let i = 0; i < 20; i++) {
      expect(priv(bot).shouldAcceptChallenge()).toBe(true);
    }
  });

  it('passive bots always accept (NPC stations)', () => {
    const bot = makeBot({ personality: 'social', mode: 'passive' });
    for (let i = 0; i < 20; i++) {
      expect(priv(bot).shouldAcceptChallenge()).toBe(true);
    }
  });
});

// ─── pickChallengeTarget ──────────────────────────────────────────────────────

describe('pickChallengeTarget', () => {
  it('returns null when no nearby players', () => {
    const bot = makeBot({ targetPreference: 'any' });
    // nearbyIds is empty by default
    expect(priv(bot).pickChallengeTarget()).toBeNull();
  });

  it('returns null for human_only when no humans nearby', () => {
    const bot = makeBot({ targetPreference: 'human_only' });
    // Add agent players to nearbyIds (not human)
    const bPriv = priv(bot);
    bPriv.nearbyIds = new Set(['agent_x']);
    bPriv.playersById = new Map([['agent_x', { id: 'agent_x', x: 1, z: 1, role: 'agent' }]]);
    bPriv.playerId = 'self';
    expect(bPriv.pickChallengeTarget()).toBeNull();
  });

  it('always picks a human when targetPreference is human_only', () => {
    const bot = makeBot({ targetPreference: 'human_only' });
    const bPriv = priv(bot);
    bPriv.nearbyIds = new Set(['human_a', 'agent_b']);
    bPriv.playersById = new Map([
      ['human_a', { id: 'human_a', x: 2, z: 2, role: 'human' }],
      ['agent_b', { id: 'agent_b', x: 3, z: 3, role: 'agent' }]
    ]);
    bPriv.playerId = 'self';
    const target = bPriv.pickChallengeTarget() as string | null;
    expect(target).toBe('human_a');
  });

  it('human_first returns a candidate from the nearby set', () => {
    const bot = makeBot({ targetPreference: 'human_first' });
    const bPriv = priv(bot);
    bPriv.nearbyIds = new Set(['human_a', 'agent_b']);
    bPriv.playersById = new Map([
      ['human_a', { id: 'human_a', x: 2, z: 2, role: 'human' }],
      ['agent_b', { id: 'agent_b', x: 3, z: 3, role: 'agent' }]
    ]);
    bPriv.playerId = 'self';
    const target = bPriv.pickChallengeTarget() as string | null;
    // With humans present, human_first must return either human or agent — never null
    expect(target).not.toBeNull();
    expect(['human_a', 'agent_b']).toContain(target);
  });

  it('returns agent when human_first has no humans and agents available', () => {
    const bot = makeBot({ targetPreference: 'human_first' });
    const bPriv = priv(bot);
    bPriv.nearbyIds = new Set(['agent_x']);
    bPriv.playersById = new Map([['agent_x', { id: 'agent_x', x: 1, z: 1, role: 'agent' }]]);
    bPriv.playerId = 'self';
    const target = bPriv.pickChallengeTarget() as string | null;
    expect(target).toBe('agent_x');
  });

  it('returns any candidate for "any" preference (rotated[0] path)', () => {
    const bot = makeBot({ targetPreference: 'any' });
    const bPriv = priv(bot);
    bPriv.nearbyIds = new Set(['player_z']);
    bPriv.playersById = new Map([['player_z', { id: 'player_z', x: 5, z: 5, role: 'human' }]]);
    bPriv.playerId = 'self';
    expect(bPriv.pickChallengeTarget()).toBe('player_z');
  });

  it('excludes self from candidates', () => {
    const bot = makeBot({ targetPreference: 'any' });
    const bPriv = priv(bot);
    bPriv.playerId = 'self_id';
    bPriv.nearbyIds = new Set(['self_id']);
    bPriv.playersById = new Map([['self_id', { id: 'self_id', x: 0, z: 0, role: 'human' }]]);
    expect(bPriv.pickChallengeTarget()).toBeNull();
  });
});

// ─── getStatus ────────────────────────────────────────────────────────────────

describe('getStatus', () => {
  it('returns snapshot of bot state', () => {
    const bot = makeBot();
    const status = bot.getStatus();
    expect(status.id).toBe('bot_abc');
    expect(status.connected).toBe(false);
    expect(status.playerId).toBeNull();
    expect(status.nearbyCount).toBe(0);
    expect(status.autoplaySession).toBeNull(); // no autoplay config
  });

  it('includes autoplay session when autoplay is configured', () => {
    const bot = makeBot({ autoplay: makeAutoplay() });
    const status = bot.getStatus();
    expect(status.autoplaySession).not.toBeNull();
    expect(status.autoplaySession?.pauseReason).toBeNull();
  });

  it('reflects updated stats', () => {
    const bot = makeBot();
    priv(bot).stats.challengesSent = 5;
    priv(bot).stats.challengesWon = 2;
    const status = bot.getStatus();
    expect(status.stats.challengesSent).toBe(5);
    expect(status.stats.challengesWon).toBe(2);
  });
});

// ─── updateBehavior / updateDisplayName ───────────────────────────────────────

describe('updateBehavior', () => {
  it('patches behavior fields', () => {
    const bot = makeBot({ personality: 'social' });
    bot.updateBehavior({ personality: 'aggressive', challengeEnabled: false });
    expect(bot.getStatus().behavior.personality).toBe('aggressive');
    expect(bot.getStatus().behavior.challengeEnabled).toBe(false);
  });
});

describe('updateDisplayName', () => {
  it('does nothing when the new name is the same', () => {
    const bot = makeBot();
    const before = bot.isConnected();
    bot.updateDisplayName('TestBot'); // same as initial
    expect(bot.isConnected()).toBe(before);
  });

  it('does nothing when the new name is blank', () => {
    const bot = makeBot();
    bot.updateDisplayName('   ');
    // no reconnect triggered — bot stays in same state
    expect(bot.isConnected()).toBe(false);
  });
});

// ─── shouldAcceptChallenge — remaining personality branches ──────────────────

describe('shouldAcceptChallenge — social and conservative', () => {
  it('social bot returns a boolean (probabilistic path covered)', () => {
    const bot = makeBot({ personality: 'social', mode: 'active' });
    const result = priv(bot).shouldAcceptChallenge();
    expect(typeof result).toBe('boolean');
  });

  it('conservative bot returns a boolean (probabilistic path covered)', () => {
    const bot = makeBot({ personality: 'conservative', mode: 'active' });
    const result = priv(bot).shouldAcceptChallenge();
    expect(typeof result).toBe('boolean');
  });
});

// ─── maybeSubmitGameMove (with mock WS) ───────────────────────────────────────

function makeMockWs(sentMessages: unknown[]): WebSocket {
  return {
    OPEN: 1,       // WebSocket class constant
    readyState: 1, // current state = OPEN
    send: (data: string) => sentMessages.push(JSON.parse(data))
  } as unknown as WebSocket;
}

describe('maybeSubmitGameMove', () => {
  it('skips when challenge id is already submitted', () => {
    const sent: unknown[] = [];
    const bot = makeBot({ targetPreference: 'any' });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set(['ch_1']);

    const challenge = {
      id: 'ch_1',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'rps',
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    // Should have returned early — no new setTimeout scheduled
    expect(bPriv.submittedMoveByChallenge.has('ch_1')).toBe(true);
  });

  it('skips when the move is already in the challenge payload', () => {
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_2',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'rps',
      wager: 10,
      status: 'active',
      challengerMove: 'rock', // already submitted
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    // should mark as submitted (registers existing move) and not schedule send
    expect(bPriv.submittedMoveByChallenge.has('ch_2')).toBe(true);
  });

  it('skips when bot is not a participant', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_3',
      challengerId: 'someone_else',
      opponentId: 'another',
      gameType: 'rps',
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    expect(bPriv.submittedMoveByChallenge.has('ch_3')).toBe(false);
  });

  it('marks challenge as submitted and schedules a move send', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_4',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'coinflip' as const,
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    // Should be marked submitted before setTimeout fires
    expect(bPriv.submittedMoveByChallenge.has('ch_4')).toBe(true);
  });
});

// ─── handleChallengeEvent — resolved outcome tracking ─────────────────────────

describe('handleChallengeEvent — resolved', () => {
  it('increments challengesWon and sessionNetPnl on win', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ cooldownMs: 0, sessionLossLimit: 0, sessionWinTarget: 0 }) });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set(['ch_win']);

    bPriv.handleChallengeEvent({
      event: 'resolved',
      challenge: {
        id: 'ch_win',
        challengerId: 'self',
        opponentId: 'opp',
        gameType: 'rps',
        wager: 20,
        status: 'resolved',
        winnerId: 'self'
      }
    });

    expect((bPriv.stats as Record<string, number>).challengesWon).toBe(1);
    expect(bPriv.sessionNetPnl).toBe(20);
  });

  it('increments challengesLost and decrements sessionNetPnl on loss', () => {
    const bot = makeBot({ autoplay: makeAutoplay({ cooldownMs: 0, sessionLossLimit: 0, sessionWinTarget: 0 }) });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set(['ch_loss']);

    bPriv.handleChallengeEvent({
      event: 'resolved',
      challenge: {
        id: 'ch_loss',
        challengerId: 'opp',
        opponentId: 'self',
        gameType: 'rps',
        wager: 15,
        status: 'resolved',
        winnerId: 'opp'
      }
    });

    expect((bPriv.stats as Record<string, number>).challengesLost).toBe(1);
    expect(bPriv.sessionNetPnl).toBe(-15);
  });

  it('ignores resolved events where bot did not participate', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';

    bPriv.handleChallengeEvent({
      event: 'resolved',
      challenge: {
        id: 'ch_other',
        challengerId: 'a',
        opponentId: 'b',
        gameType: 'coinflip',
        wager: 100,
        status: 'resolved',
        winnerId: 'a'
      }
    });

    expect((bPriv.stats as Record<string, number>).challengesWon).toBe(0);
    expect((bPriv.stats as Record<string, number>).challengesLost).toBe(0);
  });
});

// ─── handleChallengeEvent — declined / expired ────────────────────────────────

describe('handleChallengeEvent — declined / expired', () => {
  it('removes challenge from submitted set and sets target cooldown on declined', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set(['ch_dec']);

    bPriv.handleChallengeEvent({
      event: 'declined',
      challenge: {
        id: 'ch_dec',
        challengerId: 'self',
        opponentId: 'opp',
        gameType: 'rps',
        wager: 10,
        status: 'declined',
        winnerId: undefined
      }
    });

    expect(bPriv.submittedMoveByChallenge.has('ch_dec')).toBe(false);
    expect(bPriv.targetCooldownUntil.has('opp')).toBe(true);
  });

  it('handles expired event symmetrically', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set(['ch_exp']);

    bPriv.handleChallengeEvent({
      event: 'expired',
      challenge: {
        id: 'ch_exp',
        challengerId: 'opp',
        opponentId: 'self',
        gameType: 'coinflip',
        wager: 5,
        status: 'expired',
        winnerId: undefined
      }
    });

    expect(bPriv.submittedMoveByChallenge.has('ch_exp')).toBe(false);
    expect(bPriv.targetCooldownUntil.has('opp')).toBe(true);
  });
});

// ─── maybeSubmitGameMove — WS early exit and setTimeout send ─────────────────

describe('maybeSubmitGameMove — early exit and move dispatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early when ws is null (covers line 751 return)', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.playerId = 'self';
    bPriv.ws = null; // no WS
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_early',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'rps',
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    // Should not have been added to submitted set
    expect(bPriv.submittedMoveByChallenge.has('ch_early')).toBe(false);
  });

  it('sends a valid rps move via setTimeout', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_rps',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'rps' as const,
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    vi.runAllTimers();
    expect(sent.length).toBe(1);
    expect((sent[0] as Record<string, string>).type).toBe('challenge_move');
    expect(['rock', 'paper', 'scissors']).toContain((sent[0] as Record<string, string>).move);
  });

  it('sends a valid coinflip move via setTimeout', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_coin',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'coinflip' as const,
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    vi.runAllTimers();
    expect(sent.length).toBe(1);
    expect(['heads', 'tails']).toContain((sent[0] as Record<string, string>).move);
  });

  it('sends a valid dice_duel move via setTimeout', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    const challenge = {
      id: 'ch_dice',
      challengerId: 'opp',
      opponentId: 'self',
      gameType: 'dice_duel' as const,
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    };
    bPriv.maybeSubmitGameMove(challenge);
    vi.runAllTimers();
    expect(sent.length).toBe(1);
    expect(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']).toContain((sent[0] as Record<string, string>).move);
  });
});

// ─── handleChallengeEvent — guard and invalid/busy events ────────────────────

describe('handleChallengeEvent — guard and invalid/busy', () => {
  it('returns early when ws is not open (covers line 606)', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = null;
    bPriv.playerId = 'self';
    // Should not throw; no-op
    bPriv.handleChallengeEvent({ event: 'invalid' });
    expect((bPriv.stats as Record<string, number>).challengesSent).toBe(0);
  });

  it('sets suppressedUntil on invalid event', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    const before = Date.now();
    bPriv.handleChallengeEvent({ event: 'invalid', reason: 'other_reason' });
    expect(bPriv.challengeSuppressedUntil).toBeGreaterThanOrEqual(before + 2000);
  });

  it('sets target cooldown on invalid event with target_not_nearby reason', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.nearbyIds = new Set(['target_z']);
    bPriv.playersById = new Map([['target_z', { id: 'target_z', x: 1, z: 1, role: 'human' }]]);
    bPriv.handleChallengeEvent({ event: 'invalid', reason: 'target_not_nearby' });
    expect(bPriv.targetCooldownUntil.has('target_z')).toBe(true);
  });

  it('handles busy event the same as invalid', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    const before = Date.now();
    bPriv.handleChallengeEvent({ event: 'busy', reason: 'player_busy' });
    expect(bPriv.challengeSuppressedUntil).toBeGreaterThanOrEqual(before + 2000);
  });
});

// ─── handleChallengeEvent — created: ws closes before response fires ──────────

describe('handleChallengeEvent — created: ws closes before response', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send response if ws closes before setTimeout fires (line 630)', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot({ personality: 'aggressive', challengeEnabled: true });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';

    bPriv.handleChallengeEvent({
      event: 'created',
      challenge: {
        id: 'ch_close2',
        challengerId: 'opp',
        opponentId: 'self',
        gameType: 'rps',
        wager: 10,
        status: 'pending',
        winnerId: undefined,
        challengerMove: null,
        opponentMove: null
      }
    });

    // Simulate WS closing before timer fires
    bPriv.ws = null;
    vi.runAllTimers();
    expect(sent.length).toBe(0);
  });
});

// ─── handleChallengeEvent — created (incoming and outgoing) ──────────────────

describe('handleChallengeEvent — created', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments challengesReceived and sends challenge_response when bot is opponent', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot({ personality: 'aggressive', challengeEnabled: true });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';

    bPriv.handleChallengeEvent({
      event: 'created',
      challenge: {
        id: 'ch_inc',
        challengerId: 'opp',
        opponentId: 'self', // bot is the opponent
        gameType: 'rps',
        wager: 10,
        status: 'pending',
        winnerId: undefined,
        challengerMove: null,
        opponentMove: null
      }
    });

    expect((bPriv.stats as Record<string, number>).challengesReceived).toBe(1);
    vi.runAllTimers();
    expect(sent.length).toBe(1);
    expect((sent[0] as Record<string, unknown>).type).toBe('challenge_response');
    expect((sent[0] as Record<string, unknown>).accept).toBe(true);
    expect((bPriv.stats as Record<string, number>).challengesAccepted).toBe(1);
  });

  it('declines challenge_response when challengeEnabled is false', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot({ personality: 'aggressive', challengeEnabled: false });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';

    bPriv.handleChallengeEvent({
      event: 'created',
      challenge: {
        id: 'ch_dec2',
        challengerId: 'opp',
        opponentId: 'self',
        gameType: 'rps',
        wager: 10,
        status: 'pending',
        winnerId: undefined,
        challengerMove: null,
        opponentMove: null
      }
    });

    vi.runAllTimers();
    expect((sent[0] as Record<string, unknown>).accept).toBe(false);
    expect((bPriv.stats as Record<string, number>).challengesDeclined).toBe(1);
  });

  it('sets target cooldown when bot is the challenger', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';

    bPriv.handleChallengeEvent({
      event: 'created',
      challenge: {
        id: 'ch_out',
        challengerId: 'self', // bot sent the challenge
        opponentId: 'opp',
        gameType: 'coinflip',
        wager: 5,
        status: 'pending',
        winnerId: undefined
      }
    });

    expect(bPriv.targetCooldownUntil.has('opp')).toBe(true);
  });

  it('calls maybeSubmitGameMove when event is accepted', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs(sent);
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    bPriv.handleChallengeEvent({
      event: 'accepted',
      challenge: {
        id: 'ch_acc',
        challengerId: 'self',
        opponentId: 'opp',
        gameType: 'rps' as const,
        wager: 10,
        status: 'active',
        winnerId: undefined,
        challengerMove: null,
        opponentMove: null
      }
    });

    // submittedMoveByChallenge should be marked (maybeSubmitGameMove was called)
    expect(bPriv.submittedMoveByChallenge.has('ch_acc')).toBe(true);
    vi.runAllTimers();
    expect(sent.length).toBe(1);
    expect((sent[0] as Record<string, string>).type).toBe('challenge_move');
  });
});

// ─── maybeSubmitGameMove — ws closed before timeout fires ─────────────────────

describe('maybeSubmitGameMove — ws closes before timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send move if ws is closed by the time setTimeout fires', () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);
    const mockWs = makeMockWs(sent);
    bPriv.ws = mockWs;
    bPriv.playerId = 'self';
    bPriv.submittedMoveByChallenge = new Set();

    bPriv.maybeSubmitGameMove({
      id: 'ch_close',
      challengerId: 'self',
      opponentId: 'opp',
      gameType: 'rps' as const,
      wager: 10,
      status: 'active',
      challengerMove: null,
      opponentMove: null
    });

    // Simulate WS closing before the timer fires
    bPriv.ws = null;
    vi.runAllTimers();

    // No message should have been sent
    expect(sent.length).toBe(0);
  });
});

// ─── stop() — timer and ws cleanup ───────────────────────────────────────────

describe('stop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears decisionTimer and reconnectTimer and nulls ws', () => {
    vi.useFakeTimers();
    const closed: boolean[] = [];
    const bot = makeBot();
    const bPriv = priv(bot);

    // Inject a mock timer and ws
    bPriv.decisionTimer = setInterval(() => {}, 9999) as unknown as NodeJS.Timeout;
    bPriv.reconnectTimer = setTimeout(() => {}, 9999) as unknown as NodeJS.Timeout;
    bPriv.ws = { close: () => closed.push(true), OPEN: 1, readyState: 1, send: () => {} } as unknown as WebSocket;
    bPriv.running = true;
    bPriv.connected = true;

    bot.stop();

    expect(bPriv.running).toBe(false);
    expect(bPriv.connected).toBe(false);
    expect(bPriv.decisionTimer).toBeNull();
    expect(bPriv.reconnectTimer).toBeNull();
    expect(bPriv.ws).toBeNull();
    expect(closed).toHaveLength(1);
  });

  it('is safe to call when nothing is running', () => {
    const bot = makeBot();
    expect(() => bot.stop()).not.toThrow();
    expect(bot.isConnected()).toBe(false);
  });
});

// ─── ensureActive() paths ─────────────────────────────────────────────────────

describe('ensureActive', () => {
  it('returns early when already connected', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.running = true;
    bPriv.connected = true;
    // Should not throw or attempt to create a new WS
    bot.ensureActive();
    expect(bPriv.connected).toBe(true);
  });

  it('returns early when ws is already set (connection in-flight)', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.running = true;
    bPriv.connected = false;
    bPriv.ws = makeMockWs([]);
    bot.ensureActive();
    // ws should still be the same mock (no new connect)
    expect(bPriv.ws).not.toBeNull();
  });

  it('returns early when reconnectTimer is pending', () => {
    vi.useFakeTimers();
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.running = true;
    bPriv.connected = false;
    bPriv.ws = null;
    bPriv.reconnectTimer = setTimeout(() => {}, 9999) as unknown as NodeJS.Timeout;
    bot.ensureActive();
    // Should not have set ws (reconnect already pending)
    expect(bPriv.ws).toBeNull();
    vi.useRealTimers();
  });
});

// ─── updateDisplayName() — reconnect path ─────────────────────────────────────

describe('updateDisplayName — reconnect when connected', () => {
  it('stops and restarts the bot when name changes while connected', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    // Simulate connected state without actually opening a WS
    bPriv.connected = true;
    bPriv.running = true;
    // Inject a mock ws to avoid real connection
    bPriv.ws = { close: () => {}, OPEN: 1, readyState: 1, send: () => {} } as unknown as WebSocket;

    bot.updateDisplayName('NewName');

    // stop() was called (connected → false, ws → null), start() re-sets running
    expect(bPriv.running).toBe(true); // start() was called
  });
});

// ─── maybeSendChallenge() — early exit paths ─────────────────────────────────

describe('maybeSendChallenge', () => {
  it('returns early when mode is passive', () => {
    const bot = makeBot({ mode: 'passive', challengeEnabled: true });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    const sent: unknown[] = [];
    bPriv.ws = makeMockWs(sent);
    bPriv.maybeSendChallenge();
    expect(sent).toHaveLength(0);
  });

  it('returns early when challengeEnabled is false', () => {
    const bot = makeBot({ mode: 'active', challengeEnabled: false });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    const sent: unknown[] = [];
    bPriv.ws = makeMockWs(sent);
    bPriv.maybeSendChallenge();
    expect(sent).toHaveLength(0);
  });

  it('returns early when ws is not open', () => {
    const bot = makeBot({ mode: 'active', challengeEnabled: true });
    const bPriv = priv(bot);
    bPriv.ws = null;
    bPriv.playerId = 'self';
    // Should not throw
    expect(() => bPriv.maybeSendChallenge()).not.toThrow();
  });

  it('returns early when suppressed', () => {
    const bot = makeBot({ mode: 'active', challengeEnabled: true, challengeCooldownMs: 1000 });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.challengeSuppressedUntil = Date.now() + 99999;
    const sent: unknown[] = [];
    bPriv.ws = makeMockWs(sent);
    bPriv.maybeSendChallenge();
    expect(sent).toHaveLength(0);
  });

  it('returns early when on cooldown', () => {
    const bot = makeBot({ mode: 'active', challengeEnabled: true, challengeCooldownMs: 60000 });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.lastChallengeSentAt = Date.now(); // just sent one
    const sent: unknown[] = [];
    bPriv.ws = makeMockWs(sent);
    bPriv.maybeSendChallenge();
    expect(sent).toHaveLength(0);
  });

  it('returns early when autoplay is paused (not cooling_down)', () => {
    const bot = makeBot({
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: 0,
      autoplay: makeAutoplay({ cooldownMs: 0 })
    });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    bPriv.autoplaySession.pauseReason = 'stop_loss_hit';
    const sent: unknown[] = [];
    bPriv.ws = makeMockWs(sent);
    bPriv.maybeSendChallenge();
    expect(sent).toHaveLength(0);
  });

  it('clears cooling_down pause after cooldown expires', () => {
    const bot = makeBot({
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: 0,
      autoplay: makeAutoplay({ cooldownMs: 1000 })
    });
    const bPriv = priv(bot);
    bPriv.ws = makeMockWs([]);
    bPriv.playerId = 'self';
    // Set cooling_down with lastGameAt far in the past
    bPriv.autoplaySession.pauseReason = 'cooling_down';
    bPriv.autoplaySession.lastGameAt = Date.now() - 10000; // 10s ago > 1s cooldown
    bPriv.maybeSendChallenge();
    // Pause should be cleared
    expect(bPriv.autoplaySession.pauseReason).toBeNull();
  });
});

// ─── getId / isConnected ──────────────────────────────────────────────────────

describe('getId / isConnected', () => {
  it('returns the configured id', () => {
    const bot = makeBot({}, 'unique_bot_99');
    expect(bot.getId()).toBe('unique_bot_99');
  });

  it('starts disconnected', () => {
    const bot = makeBot();
    expect(bot.isConnected()).toBe(false);
  });
});
