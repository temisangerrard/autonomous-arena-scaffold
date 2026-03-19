import { describe, expect, test, vi } from 'vitest';
import { loadMainWorldRuntime } from '../public/js/play/runtime/world-loader.js';

function makeLoadingNode() {
  return {
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    },
    setAttribute: vi.fn(),
    style: {},
    textContent: ''
  };
}

describe('world loader runtime', () => {
  test('shows a neutral preparing message before world download progress starts', async () => {
    let releaseLoad;
    const pendingLoad = new Promise((resolve) => {
      releaseLoad = resolve;
    });

    const worldLoading = makeLoadingNode();
    const worldLoadingBar = { style: { width: '' } };
    const worldLoadingText = { textContent: '' };
    const dispatch = vi.fn();

    const promise = loadMainWorldRuntime({
      loadArenaConfig: vi.fn(async () => {}),
      worldLoading,
      worldLoadingBar,
      worldLoadingText,
      dispatch,
      loadWorldWithProgress: vi.fn(async () => await pendingLoad),
      scene: {},
      state: { worldAlias: 'mega', playerId: null, worldLoaded: false },
      getWorldRoot: () => null,
      setWorldRoot: vi.fn(),
      setDisconnectedFallbackCamera: vi.fn(),
      setupWorldNpcStations: vi.fn(),
      addFeedEvent: vi.fn()
    });

    await Promise.resolve();

    expect(worldLoadingText.textContent).toBe('Preparing world…');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'WORLD_LOAD_STAGE_SET',
      stage: 'connecting',
      message: 'Preparing world…'
    });

    releaseLoad({
      worldRoot: { name: 'shell-root' },
      shellMetrics: { downloadMs: 1, parseMs: 1, totalMs: 2 },
      bundlePlan: { shell: { alias: 'mega-shell' }, zones: [], decor: [] },
      backgroundLoads: Promise.resolve([])
    });
    await promise;
  });

  test('enters after shell load and swaps to the streamed mega world when ready', async () => {
    let resolveBackground;
    const backgroundLoads = new Promise((resolve) => {
      resolveBackground = resolve;
    });

    const worldLoading = makeLoadingNode();
    const worldLoadingBar = { style: { width: '' } };
    const worldLoadingText = { textContent: '' };
    const dispatch = vi.fn();
    const setWorldRoot = vi.fn();
    const setupWorldNpcStations = vi.fn();
    const addFeedEvent = vi.fn();
    const state = { worldAlias: 'mega', playerId: null, worldLoaded: false };
    const worldRoot = { name: 'world-root' };
    const megaRoot = { name: 'mega-root' };

    const promise = loadMainWorldRuntime({
      loadArenaConfig: vi.fn(async () => {}),
      worldLoading,
      worldLoadingBar,
      worldLoadingText,
      dispatch,
      loadWorldWithProgress: vi.fn(async (_scene, _alias, onProgress) => {
        onProgress?.({ loaded: 5, total: 10 });
        return {
          worldRoot,
          shellRoot: { name: 'shell-root' },
          shellMetrics: { downloadMs: 12, parseMs: 8, totalMs: 20 },
          bundlePlan: {
            shell: { alias: 'mega-shell' },
            zones: [{ alias: 'mega-world' }],
            decor: []
          },
          backgroundLoads
        };
      }),
      scene: {},
      state,
      getWorldRoot: () => worldRoot,
      setWorldRoot,
      setDisconnectedFallbackCamera: vi.fn(),
      setupWorldNpcStations,
      addFeedEvent
    });

    await promise;

    expect(state.worldLoaded).toBe(true);
    expect(setWorldRoot).toHaveBeenCalledWith(worldRoot);
    expect(setupWorldNpcStations).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORLD_LOADED' }));
    expect(worldLoadingText.textContent).toBe('Streaming nearby world details…');

    resolveBackground([
      { status: 'fulfilled', value: { alias: 'mega-world', kind: 'world', replaceWorldRoot: true, root: megaRoot } }
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(setupWorldNpcStations).toHaveBeenCalledTimes(2);
    expect(setWorldRoot).toHaveBeenLastCalledWith(megaRoot);
    expect(addFeedEvent).toHaveBeenCalledWith('system', expect.stringContaining('World streaming complete'));
  });
});
