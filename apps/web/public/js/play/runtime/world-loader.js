export async function loadMainWorldRuntime(params) {
  const {
    loadArenaConfig,
    worldLoading,
    worldLoadingBar,
    worldLoadingText,
    dispatch,
    loadWorldWithProgress,
    scene,
    state,
    getWorldRoot,
    setWorldRoot,
    setDisconnectedFallbackCamera,
    setupWorldNpcStations,
    addFeedEvent
  } = params;

  try {
    await loadArenaConfig();
  } catch {
    // ignore; loader will fall back, but we prefer a best-effort config load.
  }
  if (worldLoading) {
    worldLoading.classList.add('open');
    worldLoading.setAttribute('aria-hidden', 'false');
  }
  if (worldLoadingBar) {
    worldLoadingBar.style.width = '0%';
  }
  if (worldLoadingText) {
    worldLoadingText.textContent = 'Preparing world…';
  }
  dispatch({ type: 'WORLD_LOAD_STAGE_SET', stage: 'connecting', message: 'Preparing world…' });
  try {
    const loadResult = await loadWorldWithProgress(scene, state.worldAlias, (evt) => {
      const loaded = Number(evt?.loaded || 0);
      const total = Number(evt?.total || 0);
      if (worldLoadingBar && total > 0) {
        const ratio = Math.max(0, Math.min(1, loaded / total));
        worldLoadingBar.style.width = `${(ratio * 100).toFixed(1)}%`;
      }
      if (worldLoadingText) {
        if (total > 0) {
          const mb = (loaded / (1024 * 1024)).toFixed(0);
          const totalMb = (total / (1024 * 1024)).toFixed(0);
          worldLoadingText.textContent = `Downloading world ${mb}/${totalMb} MB…`;
          dispatch({
            type: 'WORLD_LOAD_STAGE_SET',
            stage: 'downloading',
            loaded,
            total,
            message: `Downloading world ${mb}/${totalMb} MB…`
          });
        } else if (loaded > 0) {
          const mb = (loaded / (1024 * 1024)).toFixed(0);
          worldLoadingText.textContent = `Downloading world ${mb} MB…`;
          dispatch({
            type: 'WORLD_LOAD_STAGE_SET',
            stage: 'downloading',
            loaded,
            total,
            message: `Downloading world ${mb} MB…`
          });
        } else {
          worldLoadingText.textContent = 'Downloading world…';
          dispatch({ type: 'WORLD_LOAD_STAGE_SET', stage: 'downloading', loaded, total, message: 'Downloading world…' });
        }
      }
    });
    const nextWorldRoot = loadResult?.worldRoot || loadResult;
    setWorldRoot(nextWorldRoot);
    if (worldLoadingText) {
      worldLoadingText.textContent = 'Processing world data…';
    }
    dispatch({ type: 'WORLD_LOAD_STAGE_SET', stage: 'processing', message: 'Processing world data…' });
    state.worldLoaded = true;
    const shellMetrics = loadResult?.shellMetrics || null;
    if (!state.playerId && getWorldRoot()) {
      setDisconnectedFallbackCamera();
    }
    setupWorldNpcStations();
    if (worldLoadingText) {
      worldLoadingText.textContent = 'Entering world…';
    }
    dispatch({ type: 'WORLD_LOADED', message: 'Entering world…' });
    addFeedEvent('system', `World loaded: ${state.worldAlias}`);
    if (shellMetrics) {
      console.info('[world-metrics] shell_ready', {
        alias: state.worldAlias,
        downloadMs: Math.round(Number(shellMetrics.downloadMs || 0)),
        parseMs: Math.round(Number(shellMetrics.parseMs || 0)),
        firstInteractiveMs: Math.round(Number(shellMetrics.totalMs || 0))
      });
      addFeedEvent(
        'system',
        `World shell ready in ${Math.round(Number(shellMetrics.totalMs || 0))}ms`
      );
    }
    if (worldLoading) {
      worldLoading.classList.remove('open');
      worldLoading.setAttribute('aria-hidden', 'true');
    }
    if (loadResult?.backgroundLoads && typeof loadResult.backgroundLoads.then === 'function') {
      if (worldLoadingText) {
        worldLoadingText.textContent = 'Streaming nearby world details…';
      }
      void loadResult.backgroundLoads.then((results) => {
        const replacement = results.find((entry) => (
          entry?.status === 'fulfilled'
          && entry.value
          && entry.value.replaceWorldRoot
          && entry.value.root
        ));
        if (replacement?.status === 'fulfilled') {
          const currentRoot = getWorldRoot();
          const nextRoot = replacement.value.root;
          if (currentRoot && currentRoot.parent && currentRoot !== nextRoot) {
            currentRoot.parent.remove(currentRoot);
          }
          if (nextRoot && scene?.add && !nextRoot.parent) {
            scene.add(nextRoot);
          }
          setWorldRoot(nextRoot);
        }
        const failed = results.filter((entry) => entry.status === 'rejected');
        setupWorldNpcStations();
        if (failed.length > 0) {
          console.warn('[world-metrics] background_stream_partial_failure', {
            alias: state.worldAlias,
            failed: failed.length
          });
          addFeedEvent('system', `World streaming completed with ${failed.length} deferred load issue(s).`);
          return;
        }
        addFeedEvent('system', `World streaming complete: ${state.worldAlias}`);
      });
    }
    return;
  } catch (err) {
    console.error('Failed to load world', err);
  }

  addFeedEvent('system', 'Failed to load world asset.');
  if (worldLoadingText) {
    worldLoadingText.textContent = 'World failed to load. Check your network and try refresh.';
  }
  dispatch({
    type: 'WORLD_FAILED',
    message: 'World failed to load. Check your network and try refresh.'
  });
}
