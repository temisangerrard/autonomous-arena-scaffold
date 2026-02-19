export function installRuntimeTestHooks(params) {
  const {
    state,
    movementSystem,
    describeInteractionPhase,
    update,
    render,
    frame,
    queryParams
  } = params;

  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      update(performance.now());
    }
    render();
  };

  window.render_game_to_text = () => {
    const local = state.playerId ? state.players.get(state.playerId) : null;
    const desired = movementSystem.computeDesiredMove();
    return JSON.stringify({
      mode: 'play',
      wsConnected: state.wsConnected,
      playerId: state.playerId,
      worldAlias: state.worldAlias,
      worldLoaded: state.worldLoaded,
      tick: state.tick,
      coords: 'origin at world center, +X right, +Z forward, +Y up',
      cameraYaw: state.cameraYaw,
      cameraDistance: state.cameraDistance,
      desiredMove: desired,
      interactionPhase: describeInteractionPhase(state),
      targetId: state.ui?.targetId || '',
      interactionMode: state.ui?.interactionMode || 'none',
      escrowApprovalMode: state.escrowApproval?.mode || 'manual',
      escrowApprovalNetwork: state.escrowApproval?.network || 'unknown',
      player: local
        ? {
            x: local.x,
            y: local.y,
            z: local.z,
            yaw: local.yaw,
            displayX: local.displayX,
            displayY: local.displayY,
            displayZ: local.displayZ,
            displayYaw: local.displayYaw,
            displayName: local.displayName
          }
        : null,
      nearbyIds: [...state.nearbyIds],
      nearbyStationIds: [...state.nearbyStationIds],
      challengeStatus: state.challengeStatus,
      activeChallenge: state.activeChallenge
        ? {
            id: state.activeChallenge.id,
            gameType: state.activeChallenge.gameType,
            challengerId: state.activeChallenge.challengerId,
            opponentId: state.activeChallenge.opponentId,
            challengerMove: state.activeChallenge.challengerMove,
            opponentMove: state.activeChallenge.opponentMove,
            wager: state.activeChallenge.wager
          }
        : null
    });
  };

  if (queryParams.get('test') === '1') {
    // Deterministic stepping hook for automated tests (avoid relying on rAF timing).
    let testNow = performance.now();
    window.advanceTime = async (ms) => {
      const stepMs = 1000 / 60;
      const steps = Math.max(1, Math.round(ms / stepMs));
      for (let i = 0; i < steps; i += 1) {
        testNow += stepMs;
        frame(testNow);
      }
    };
    return;
  }

  requestAnimationFrame(frame);
}
