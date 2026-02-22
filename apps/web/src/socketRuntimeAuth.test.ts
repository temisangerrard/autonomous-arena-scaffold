import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { connectSocketRuntime } from '../public/js/play/runtime/network/socket-runtime.js';

function makeDeps(overrides = {}) {
  return {
    resolveWsBaseUrl: async () => 'ws://example.test/ws',
    queryParams: new URLSearchParams(),
    buildSessionHeaders: () => ({}),
    scheduleConnectRetry: vi.fn(),
    dispatch: vi.fn(),
    state: {
      challengeStatus: 'none'
    },
    setSocket: vi.fn(),
    socketRef: { current: null },
    connectionState: { connectFailureCount: 0, presenceTimer: null },
    addFeedEvent: vi.fn(),
    presence: { setPresence: vi.fn() },
    startWalletSyncScheduler: vi.fn(),
    stopWalletSyncScheduler: vi.fn(),
    syncWalletSummary: vi.fn(),
    normalizeSnapshotPlayer: vi.fn(),
    copyStationFromPayload: vi.fn(),
    remapLocalStationProxies: vi.fn(),
    mergeStations: vi.fn(),
    remoteAvatars: new Map(),
    scene: { remove: vi.fn() },
    updateRpsVisibility: vi.fn(),
    resolveIncomingStationId: vi.fn((id) => id),
    dealerReasonLabel: vi.fn(() => ''),
    labelFor: vi.fn((id) => String(id || '')),
    deriveDealerGameType: vi.fn(() => 'coinflip'),
    showToast: vi.fn(),
    showResultSplash: vi.fn(),
    refreshWalletBalanceAndShowDelta: vi.fn(),
    handleChallenge: vi.fn(),
    localAvatarParts: { setName: vi.fn() },
    ...overrides
  };
}

describe('connectSocketRuntime auth gating', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalWebSocket = globalThis.WebSocket;
  let mockedLocalStorage: { removeItem: ReturnType<typeof vi.fn>; getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockedLocalStorage = {
      removeItem: vi.fn(),
      getItem: vi.fn(() => ''),
      setItem: vi.fn()
    };
    globalThis.window = {
      setTimeout,
      clearTimeout,
      localStorage: mockedLocalStorage,
      location: { href: '/play?world=mega' }
    } as unknown as Window & typeof globalThis;
    globalThis.localStorage = mockedLocalStorage as never;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
    globalThis.WebSocket = originalWebSocket;
  });

  test('treats /api/player/me 404 as transient and retries without forced logout', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 404,
      ok: false,
      json: async () => ({ ok: false, reason: 'profile_not_found' })
    })) as unknown as typeof fetch;

    const deps = makeDeps();
    await connectSocketRuntime(deps as never);

    expect(deps.scheduleConnectRetry).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/play?world=mega');
    expect(mockedLocalStorage.removeItem).toHaveBeenCalledTimes(0);
  });

  test('surfaces challenge_feed busy as declined status and warning toast', async () => {
    const listeners = new Map<string, (event?: unknown) => void>();
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      url = '';
      constructor(url: string) { this.url = url; }
      addEventListener(type: string, handler: (event?: unknown) => void) {
        listeners.set(type, handler);
      }
      send() {}
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

    const deps = makeDeps({
      queryParams: new URLSearchParams('test=1'),
      challengeReasonLabel: vi.fn((reason: string) => (reason === 'player_busy' ? 'Target is already in a match.' : ''))
    });
    await connectSocketRuntime(deps as never);

    const messageHandler = listeners.get('message');
    expect(messageHandler).toBeTypeOf('function');
    messageHandler?.({
      data: JSON.stringify({
        type: 'challenge_feed',
        event: 'busy',
        reason: 'player_busy'
      })
    });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: 'CHALLENGE_STATUS_SET',
      status: 'declined',
      message: 'Target is already in a match.'
    });
    expect(deps.showToast).toHaveBeenCalledWith('Target is already in a match.', 'warning');
  });
});
