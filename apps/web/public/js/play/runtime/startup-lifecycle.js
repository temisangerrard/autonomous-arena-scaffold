export function startRuntimeLifecycle(params) {
  const {
    documentRef,
    state,
    startWalletSyncScheduler,
    syncWalletSummary,
    stopWalletSyncScheduler,
    loadMainWorldRuntime,
    loadArenaConfig,
    worldLoading,
    worldLoadingBar,
    worldLoadingText,
    dispatch,
    loadWorldWithProgress,
    scene,
    setDisconnectedFallbackCamera,
    worldStations,
    addFeedEvent,
    THREE,
    computeAvatarScaleForWorld,
    updateWorldScale
  } = params;

  documentRef.addEventListener('visibilitychange', () => {
    if (!documentRef.hidden && state.wsConnected) {
      startWalletSyncScheduler();
      void syncWalletSummary({ keepLastOnFailure: true });
      return;
    }
    if (documentRef.hidden) {
      stopWalletSyncScheduler();
    }
  });

  void loadMainWorldRuntime({
    loadArenaConfig,
    worldLoading,
    worldLoadingBar,
    worldLoadingText,
    dispatch,
    loadWorldWithProgress,
    scene,
    state,
    getWorldRoot: () => worldStations.getWorldRoot(),
    setWorldRoot: (nextRoot) => {
      worldStations.setWorldRoot(nextRoot);
      // Scale avatars based on world size after world loads
      try {
        if (nextRoot && THREE && computeAvatarScaleForWorld && updateWorldScale) {
          const worldBox = new THREE.Box3().setFromObject(nextRoot);
          const avatarScale = computeAvatarScaleForWorld(worldBox);
          updateWorldScale(avatarScale);
          console.debug('[avatars] World-based avatar scale applied:', avatarScale.toFixed(3));
        }
      } catch (err) {
        console.warn('[avatars] Failed to apply world-based avatar scale:', err);
      }
    },
    setDisconnectedFallbackCamera,
    setupWorldNpcStations: () => worldStations.setupWorldNpcStations(),
    addFeedEvent
  });
}
