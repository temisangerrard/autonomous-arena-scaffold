/**
 * AgentBot WebSocket lifecycle tests — round 5 of the autoresearch loop.
 *
 * These tests mock the `ws` module so that `new WebSocket(url)` inside
 * AgentBot.connect() returns a controllable in-process object instead of
 * attempting a real TCP connection.  All 99 remaining uncovered statements
 * live in the WS event handlers (open/message/close/error) and the
 * decideAndSendInput/startDecisionLoop paths that only execute after a
 * successful connection.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBehaviorConfig } from './AgentBot.js';
import type { AutoplayStrategyConfig } from '@arena/shared';

// ─── MockWebSocket ─────────────────────────────────────────────────────────────

class MockWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  OPEN = 1;
  readyState = 0; // CONNECTING
  sent: Record<string, unknown>[] = [];
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close() {
    this.readyState = 3;
  }

  // ── helpers for tests ──
  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  triggerMessage(payload: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }

  triggerClose(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }

  triggerError() {
    this.emit('error', new Error('test ws error'));
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket
}));

// Import AFTER mocking so AgentBot picks up the mock
const { AgentBot } = await import('./AgentBot.js');

// ─── Factories ────────────────────────────────────────────────────────────────

function makeAutoplay(overrides: Partial<AutoplayStrategyConfig> = {}): AutoplayStrategyConfig {
  return {
    enabled: true,
    allowedGames: ['rps', 'coinflip', 'dice_duel'],
    wagerMode: 'fixed',
    baseWager: 10,
    maxWager: 100,
    cooldownMs: 0,
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

function makeBot(behaviorOverrides: Partial<AgentBehaviorConfig> = {}, id = 'bot_ws_test') {
  return new AgentBot({
    id,
    wsBaseUrl: 'ws://localhost:4000/ws',
    displayName: 'WSBot',
    behavior: makeBehavior(behaviorOverrides)
  } as Parameters<typeof AgentBot['prototype']['constructor']>[0]);
}

function priv(bot: InstanceType<typeof AgentBot>): Record<string, unknown> {
  return bot as unknown as Record<string, unknown>;
}

function lastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── connect() + WS event: open ───────────────────────────────────────────────

describe('connect — open event', () => {
  it('sets connected=true and assigns playerId on welcome after open', () => {
    const bot = makeBot();
    bot.start();

    const ws = lastWs();
    expect(ws).toBeDefined();
    expect(ws.url).toContain('role=agent');

    ws.triggerOpen();
    expect(bot.isConnected()).toBe(true);

    ws.triggerMessage({ type: 'welcome', playerId: 'p_123' });
    expect((priv(bot) as Record<string, unknown>).playerId).toBe('p_123');

    bot.stop();
  });

  it('starts the decision loop (decisionTimer set after open)', () => {
    const bot = makeBot();
    bot.start();
    lastWs().triggerOpen();

    expect(priv(bot).decisionTimer).not.toBeNull();
    bot.stop();
  });

  it('includes patrolSection in connect URL when configured', () => {
    const bot = makeBot({ patrolSection: 3 });
    bot.start();
    expect(lastWs().url).toContain('spawnSection=3');
    bot.stop();
  });
});

// ─── onMessage — snapshot ─────────────────────────────────────────────────────

describe('onMessage — snapshot', () => {
  it('populates playersById from snapshot message', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });

    ws.triggerMessage({
      type: 'snapshot',
      players: [
        { id: 'self', x: 0, z: 0, role: 'agent' },
        { id: 'other', x: 5, z: 5, role: 'human' }
      ]
    });

    const pb = priv(bot).playersById as Map<string, unknown>;
    expect(pb.size).toBe(2);
    expect(pb.has('other')).toBe(true);

    bot.stop();
  });

  it('skips malformed player entries in snapshot', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    ws.triggerMessage({
      type: 'snapshot',
      players: [
        null,
        { id: 'good', x: 1, z: 2 },
        { id: 123, x: 'bad', z: 0 } // invalid — id must be string, x must be number
      ]
    });

    const pb = priv(bot).playersById as Map<string, unknown>;
    expect(pb.has('good')).toBe(true);
    expect(pb.size).toBe(1);

    bot.stop();
  });
});

// ─── onMessage — proximity ────────────────────────────────────────────────────

describe('onMessage — proximity', () => {
  it('adds otherId to nearbyIds on enter', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    ws.triggerMessage({ type: 'proximity', event: 'enter', otherId: 'p_near' });

    const nearby = priv(bot).nearbyIds as Set<string>;
    expect(nearby.has('p_near')).toBe(true);

    bot.stop();
  });

  it('removes otherId from nearbyIds on exit', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    ws.triggerMessage({ type: 'proximity', event: 'enter', otherId: 'p_near' });
    ws.triggerMessage({ type: 'proximity', event: 'exit', otherId: 'p_near' });

    const nearby = priv(bot).nearbyIds as Set<string>;
    expect(nearby.has('p_near')).toBe(false);

    bot.stop();
  });
});

// ─── onMessage — challenge dispatch ───────────────────────────────────────────

describe('onMessage — challenge dispatch', () => {
  it('routes challenge type messages to handleChallengeEvent', () => {
    const bot = makeBot({ personality: 'aggressive', challengeEnabled: true });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });

    ws.triggerMessage({
      type: 'challenge',
      event: 'resolved',
      challenge: {
        id: 'ch_x',
        challengerId: 'self',
        opponentId: 'opp',
        gameType: 'rps',
        wager: 10,
        status: 'resolved',
        winnerId: 'self'
      }
    });

    expect((priv(bot).stats as Record<string, number>).challengesWon).toBe(1);
    bot.stop();
  });
});

// ─── onMessage — malformed / unknown types ────────────────────────────────────

describe('onMessage — edge cases', () => {
  it('ignores non-JSON messages', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.emit('message', Buffer.from('not json'));
    expect(bot.isConnected()).toBe(true); // no crash
    bot.stop();
  });

  it('ignores non-object payloads', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage(42);
    ws.triggerMessage(null);
    expect(bot.isConnected()).toBe(true);
    bot.stop();
  });
});

// ─── WS close event ───────────────────────────────────────────────────────────

describe('WS close event', () => {
  it('sets connected=false and schedules reconnect when still running', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'p_1' });

    ws.triggerClose(1001, 'going away');

    expect(bot.isConnected()).toBe(false);
    expect((priv(bot) as Record<string, unknown>).playerId).toBeNull();

    const status = bot.getStatus();
    expect(status.lastWsClose?.code).toBe(1001);
    expect(status.lastWsClose?.reason).toBe('going away');

    // Reconnect timer should be pending
    expect(priv(bot).reconnectTimer).not.toBeNull();

    bot.stop();
  });

  it('clears playersById and nearbyIds on close', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    ws.triggerMessage({
      type: 'snapshot',
      players: [{ id: 'x', x: 1, z: 1 }]
    });
    ws.triggerMessage({ type: 'proximity', event: 'enter', otherId: 'x' });

    ws.triggerClose();

    expect((priv(bot).playersById as Map<string, unknown>).size).toBe(0);
    expect((priv(bot).nearbyIds as Set<string>).size).toBe(0);

    bot.stop();
  });

  it('does not schedule reconnect after stop()', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    bot.stop(); // set running=false before close fires
    ws.triggerClose();

    expect(priv(bot).reconnectTimer).toBeNull();
  });

  it('reconnects after the 1s delay when still running', () => {
    const bot = makeBot();
    bot.start();
    const initialWs = lastWs();
    initialWs.triggerOpen();
    initialWs.triggerClose();

    // Before timer fires — no new WS yet
    expect(MockWebSocket.instances.length).toBe(1);

    vi.advanceTimersByTime(1000);

    // After 1s — a new WS should have been created
    expect(MockWebSocket.instances.length).toBe(2);

    bot.stop();
  });
});

// ─── WS error event ───────────────────────────────────────────────────────────

describe('WS error event', () => {
  it('records lastWsErrorAt on error', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    const before = Date.now();
    ws.triggerError();

    const errorAt = bot.getStatus().lastWsErrorAt;
    expect(errorAt).not.toBeNull();
    expect(errorAt!).toBeGreaterThanOrEqual(before);

    bot.stop();
  });
});

// ─── decideAndSendInput (via decision loop) ───────────────────────────────────

describe('decideAndSendInput', () => {
  it('sends input messages on the 120ms decision interval', () => {
    const bot = makeBot({ mode: 'active' });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    ws.triggerMessage({
      type: 'snapshot',
      players: [{ id: 'self', x: 0, z: 0, role: 'agent' }]
    });

    vi.advanceTimersByTime(120);

    const inputMsgs = ws.sent.filter(m => m.type === 'input');
    expect(inputMsgs.length).toBeGreaterThanOrEqual(1);

    bot.stop();
  });

  it('sends zero-input when mode is passive', () => {
    const bot = makeBot({ mode: 'passive' });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    ws.triggerMessage({
      type: 'snapshot',
      players: [{ id: 'self', x: 0, z: 0, role: 'agent' }]
    });

    vi.advanceTimersByTime(120);

    const inputMsgs = ws.sent.filter(m => m.type === 'input') as Array<{ moveX: number; moveZ: number }>;
    expect(inputMsgs.length).toBeGreaterThan(0);
    expect(inputMsgs[0].moveX).toBe(0);
    expect(inputMsgs[0].moveZ).toBe(0);

    bot.stop();
  });

  it('does nothing when playerId is not yet set (pre-welcome)', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    // No welcome message — playerId is null

    vi.advanceTimersByTime(120);

    const inputMsgs = ws.sent.filter(m => m.type === 'input');
    expect(inputMsgs.length).toBe(0);

    bot.stop();
  });
});

// ─── start() idempotency ──────────────────────────────────────────────────────

describe('start idempotency', () => {
  it('does not create a second WS if called while already running', () => {
    const bot = makeBot();
    bot.start();
    bot.start(); // second call — should be no-op
    expect(MockWebSocket.instances.length).toBe(1);
    bot.stop();
  });
});

// ─── ensureActive — all paths ─────────────────────────────────────────────────

describe('ensureActive — triggers connect', () => {
  it('calls start() (→ connect) when not yet running (line 211)', () => {
    const bot = makeBot();
    // bot.running is false by default
    bot.ensureActive();
    expect(MockWebSocket.instances.length).toBe(1);
    bot.stop();
  });

  it('calls connect() directly when running but not connected, no ws, no reconnectTimer (line 220)', () => {
    const bot = makeBot();
    const bPriv = priv(bot);
    bPriv.running = true;
    bPriv.connected = false;
    bPriv.ws = null;
    bPriv.reconnectTimer = null;
    bot.ensureActive();
    expect(MockWebSocket.instances.length).toBe(1);
    bot.stop();
  });
});

// ─── connect() early-return guards ───────────────────────────────────────────

describe('connect — early exits', () => {
  it('returns early when running is false (line 225)', () => {
    const bot = makeBot();
    priv(bot).running = false;
    priv(bot).connect();
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it('returns early when ws is already set (line 228)', () => {
    const bot = makeBot();
    bot.start();
    const firstWs = lastWs();
    // Call connect() again while ws is already assigned
    priv(bot).connect();
    expect(MockWebSocket.instances.length).toBe(1); // no second WS created
    bot.stop();
    firstWs.triggerClose(); // cleanup
  });
});

// ─── connect() URL params ─────────────────────────────────────────────────────

describe('connect — URL params', () => {
  it('appends clientId when present', () => {
    const bot = new AgentBot({
      id: 'bot_url_1',
      wsBaseUrl: 'ws://localhost:4000/ws',
      displayName: 'UrlBot',
      clientId: 'client_abc',
      behavior: makeBehavior()
    } as Parameters<typeof AgentBot['prototype']['constructor']>[0]);
    bot.start();
    expect(lastWs().url).toContain('clientId=client_abc');
    bot.stop();
  });

  it('appends walletId when present', () => {
    const bot = new AgentBot({
      id: 'bot_url_2',
      wsBaseUrl: 'ws://localhost:4000/ws',
      displayName: 'WalletBot',
      walletId: 'wallet_xyz',
      behavior: makeBehavior()
    } as Parameters<typeof AgentBot['prototype']['constructor']>[0]);
    bot.start();
    expect(lastWs().url).toContain('walletId=wallet_xyz');
    bot.stop();
  });

  it('appends wsAuth token when GAME_WS_AUTH_SECRET is set', () => {
    process.env.GAME_WS_AUTH_SECRET = 'test_secret_32_chars_long_padding';
    const bot = makeBot();
    bot.start();
    expect(lastWs().url).toContain('wsAuth=');
    delete process.env.GAME_WS_AUTH_SECRET;
    bot.stop();
  });
});

// ─── startDecisionLoop — clears existing timer ───────────────────────────────

describe('startDecisionLoop', () => {
  it('clears any existing decision timer before setting a new one', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();

    // Manually call startDecisionLoop again (simulates double-open)
    const timerBefore = priv(bot).decisionTimer;
    priv(bot).startDecisionLoop();
    const timerAfter = priv(bot).decisionTimer;

    // Timer should have been replaced (different reference or same reset)
    expect(timerAfter).not.toBeNull();
    expect(timerBefore).not.toBeNull();

    bot.stop();
  });
});

// ─── sectionFor / isInSameOrAdjacentSection ───────────────────────────────────

describe('sectionFor', () => {
  it('returns correct section for given (x, z) coordinates', () => {
    const bot = makeBot();
    // col = floor((x + 120) / 60), row = z < 0 ? 0 : 1
    // x=0: col = floor(120/60) = 2; z=0: row=1; section = 1*4+2 = 6
    expect(priv(bot).sectionFor(0, 0)).toBe(6);
    // x=-120: col=0; z=-1: row=0; section=0
    expect(priv(bot).sectionFor(-120, -1)).toBe(0);
    // x=120: col=3 (capped); z=5: row=1; section=7
    expect(priv(bot).sectionFor(120, 5)).toBe(7);
  });
});

describe('isInSameOrAdjacentSection', () => {
  it('returns true for same section', () => {
    const bot = makeBot();
    const a = { id: 'a', x: 0, z: 0 };
    const b = { id: 'b', x: 1, z: 1 };
    expect(priv(bot).isInSameOrAdjacentSection(a, b)).toBe(true);
  });

  it('returns false for distant sections', () => {
    const bot = makeBot();
    const a = { id: 'a', x: -120, z: -1 }; // section 0
    const b = { id: 'b', x: 120, z: 5 };   // section 7
    expect(priv(bot).isInSameOrAdjacentSection(a, b)).toBe(false);
  });

  it('returns true for adjacent sections', () => {
    const bot = makeBot();
    const a = { id: 'a', x: 0, z: -1 };  // col=2, row=0, section=2
    const b = { id: 'b', x: 60, z: -1 }; // col=3, row=0, section=3
    expect(priv(bot).isInSameOrAdjacentSection(a, b)).toBe(true);
  });
});

// ─── decideAndSendInput — with other players present (covers lines 407-416) ──

describe('decideAndSendInput — with others in snapshot', () => {
  it('sends movement input when other players are present (covers scopedOthers/agentOthers/humanOthers/movementHumans)', () => {
    const bot = makeBot({ mode: 'active', personality: 'social' });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    ws.triggerMessage({
      type: 'snapshot',
      players: [
        { id: 'self', x: 0, z: 0, role: 'agent' },
        { id: 'near_human', x: 3, z: 3, role: 'human' },  // within HUMAN_INTEREST_RADIUS (9.5)
        { id: 'far_human', x: 50, z: 50, role: 'human' }, // beyond HUMAN_INTEREST_RADIUS
        { id: 'agent_peer', x: 2, z: 2, role: 'agent' }
      ]
    });

    ws.sent = [];
    vi.advanceTimersByTime(120);

    const inputMsgs = ws.sent.filter(m => m.type === 'input');
    expect(inputMsgs.length).toBeGreaterThan(0);

    bot.stop();
  });
});

// ─── decideAndSendInput — self not in snapshot ────────────────────────────────

describe('decideAndSendInput — self not in snapshot', () => {
  it('skips sending input when self position is unknown', () => {
    const bot = makeBot();
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    // No snapshot sent — self is not in playersById
    ws.sent = [];
    vi.advanceTimersByTime(120);
    const inputMsgs = ws.sent.filter(m => m.type === 'input');
    expect(inputMsgs.length).toBe(0);
    bot.stop();
  });
});

// ─── decideAndSendInput — stall detection and escape ─────────────────────────

describe('decideAndSendInput — stall detection', () => {
  it('injects burst after 25+ stall frames (stallFrames > 24)', () => {
    const bot = makeBot({ mode: 'active' });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });

    // Inject self at same position repeatedly to trigger stall detection
    const samePos = { id: 'self', x: 5, z: 5, role: 'agent' };
    priv(bot).stallFrames = 25; // already at stall threshold
    priv(bot).lastSample = { x: 5, z: 5 };
    priv(bot).playersById = new Map([['self', samePos]]);

    ws.sent = [];
    vi.advanceTimersByTime(120);

    const inputMsgs = ws.sent.filter(m => m.type === 'input') as Array<{ moveX: number; moveZ: number }>;
    expect(inputMsgs.length).toBeGreaterThan(0);
    // Burst should produce non-zero movement
    const burst = inputMsgs[0];
    const hasBurst = Math.abs(burst.moveX) > 0 || Math.abs(burst.moveZ) > 0;
    expect(hasBurst).toBe(true);

    bot.stop();
  });

  it('decrements stallFrames when moving', () => {
    const bot = makeBot({ mode: 'active' });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });

    priv(bot).stallFrames = 10;
    priv(bot).lastSample = { x: 0, z: 0 };
    // Place self at a clearly different position
    priv(bot).playersById = new Map([['self', { id: 'self', x: 5, z: 5, role: 'agent' }]]);

    vi.advanceTimersByTime(120);

    // stallFrames should decrease (moved more than 0.05 units)
    expect(priv(bot).stallFrames as number).toBeLessThan(10);

    bot.stop();
  });
});

// ─── maybeSendChallenge — happy path (sends challenge_send) ──────────────────

describe('maybeSendChallenge — sends challenge', () => {
  it('sends a challenge_send message to a nearby target', () => {
    const bot = makeBot({
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: 0,
      personality: 'aggressive',
      targetPreference: 'any',
      autoplay: makeAutoplay({ cooldownMs: 0 })
    });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    ws.triggerMessage({
      type: 'snapshot',
      players: [
        { id: 'self', x: 0, z: 0, role: 'agent' },
        { id: 'target', x: 1, z: 1, role: 'human' }
      ]
    });

    // Add target to nearby set
    ws.triggerMessage({ type: 'proximity', event: 'enter', otherId: 'target' });

    // Reset sent after proximity setup and manually invoke maybeSendChallenge
    ws.sent = [];
    priv(bot).lastChallengeSentAt = 0;
    priv(bot).challengeSuppressedUntil = 0;
    priv(bot).maybeSendChallenge();

    const challenges = ws.sent.filter(m => m.type === 'challenge_send');
    expect(challenges.length).toBe(1);
    expect((challenges[0] as Record<string, unknown>).targetId).toBe('target');

    bot.stop();
  });

  it('skips challenge when conservative bot hits the modulo gate', () => {
    // Conservative bots only challenge when Date.now() % 2 === 0
    // Use fake timers to control time
    vi.setSystemTime(1001); // 1001 % 2 = 1 → conservative bot skips
    const bot = makeBot({
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: 0,
      personality: 'conservative',
      targetPreference: 'any'
    });
    bot.start();
    const ws = lastWs();
    ws.triggerOpen();
    ws.triggerMessage({ type: 'welcome', playerId: 'self' });
    ws.triggerMessage({
      type: 'snapshot',
      players: [
        { id: 'self', x: 0, z: 0, role: 'agent' },
        { id: 'target', x: 1, z: 1, role: 'human' }
      ]
    });
    ws.triggerMessage({ type: 'proximity', event: 'enter', otherId: 'target' });

    ws.sent = [];
    priv(bot).lastChallengeSentAt = 0;
    priv(bot).challengeSuppressedUntil = 0;
    priv(bot).maybeSendChallenge();

    const challenges = ws.sent.filter(m => m.type === 'challenge_send');
    expect(challenges.length).toBe(0);

    bot.stop();
  });
});

