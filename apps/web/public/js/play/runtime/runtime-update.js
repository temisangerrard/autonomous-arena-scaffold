export function createRuntimeUpdate(params) {
  const {
    state,
    localAvatarParts,
    avatarGroundOffset,
    animateAvatar,
    cameraController,
    movementSystem,
    syncRemoteAvatars,
    worldStations,
    applyDisplaySeparationRuntime,
    syncStations,
    syncNearbyStations,
    refreshNearbyDistances,
    renderMatchSpotlightRuntime,
    matchSpotlight,
    renderTargetSpotlightRuntime,
    targetSpotlight,
    getUiTargetId,
    renderTopHud,
    hud,
    topbarName,
    topbarWallet,
    topbarStreak,
    topbarBot,
    featureDirectioningV2,
    renderNextActionLine,
    challengeStatusLine,
    labelFor,
    renderWorldMapPanel,
    worldMapCanvas,
    mapCoords,
    worldBound,
    renderInteractionPromptLine,
    interactionPrompt,
    setInteractOpen,
    challengeController,
    isStation,
    renderInteractionCardTemplate,
    interactionCard,
    interactionTitle,
    interactionHelpToggle,
    interactionHelp,
    interactionNpcInfo,
    stationUi,
    interactionCardState,
    normalizedChallengeGameType,
    normalizedChallengeWager,
    formatWagerInline,
    formatUsdAmount,
    formatPredictionPrice,
    formatPredictionClose,
    buildSessionHeaders,
    syncWalletSummary,
    showToast,
    ensureEscrowApproval,
    sendStationInteract,
    renderGuideStationDetail,
    setStationStatus,
    renderDealerRevealStatus,
    makePlayerSeed,
    getSocket,
    renderMobileControlsRuntime,
    computeMobileControlVisibility,
    isTouchLikeDevice,
    windowRef,
    mobileControls,
    worldMapPanel,
    describeInteractionPhase,
    interactionCardElement,
    mobileInteract,
    mobileSend,
    mobileAccept,
    mobileDecline,
    mobileMoves,
    mobileMove1,
    mobileMove2,
    mobileMove3,
    mobileMoveH,
    mobileMoveT,
    mobileMoveD1,
    mobileMoveD2,
    mobileMoveD3,
    mobileMoveD4,
    mobileMoveD5,
    mobileMoveD6,
    featureMobileV2,
    renderQuickstartModule,
    quickstartPanel,
    quickstartList,
    updateLocalAvatarRuntime,
    asFiniteNumber,
    normalizeYaw,
    sanitizeRenderY
  } = params;

  return function update(nowMs) {
    updateLocalAvatarRuntime({
      state,
      asFiniteNumber,
      normalizeYaw,
      sanitizeRenderY,
      localAvatarParts,
      avatarGroundOffset,
      animateAvatar,
      cameraController,
      nowMs: performance.now()
    });
    movementSystem.send(nowMs);
    syncRemoteAvatars(state, state.playerId);
    worldStations.updateHosts();
    applyDisplaySeparationRuntime(state);
    syncStations(state);
    syncNearbyStations();
    refreshNearbyDistances();
    renderMatchSpotlightRuntime(state, matchSpotlight);
    renderTargetSpotlightRuntime({
      state,
      targetSpotlight,
      getUiTargetId
    });

    renderTopHud(state, { hud, topbarName, topbarWallet, topbarStreak, topbarBot });
    if (featureDirectioningV2) {
      renderNextActionLine(state, challengeStatusLine, labelFor);
    } else if (challengeStatusLine) {
      if (!state.wsConnected) {
        challengeStatusLine.textContent = state.challengeMessage || 'Disconnected from game server. Reconnecting...';
      } else {
        challengeStatusLine.textContent =
          state.challengeMessage ||
          (state.challengeStatus === 'none'
            ? 'Find a nearby target and start a challenge.'
            : `Status: ${state.challengeStatus}`);
      }
    }

    renderWorldMapPanel({
      state,
      worldMapCanvas,
      mapCoords,
      worldBound
    });
    renderInteractionPromptLine({
      state,
      interactionPrompt,
      getUiTargetId,
      setInteractOpen,
      challengeController,
      isStation,
      labelFor
    });
    renderInteractionCardTemplate({
      state,
      interactionCard,
      interactionTitle,
      interactionHelpToggle,
      interactionHelp,
      interactionNpcInfo,
      stationUi,
      stateful: interactionCardState,
      setInteractOpen,
      getUiTargetId,
      isStation,
      labelFor,
      challengeController,
      normalizedChallengeGameType,
      normalizedChallengeWager,
      formatWagerInline,
      formatUsdAmount,
      formatPredictionPrice,
      formatPredictionClose,
      buildSessionHeaders,
      syncWalletSummary,
      showToast,
      ensureEscrowApproval,
      sendStationInteract,
      renderGuideStationDetail,
      setStationStatus,
      renderDealerRevealStatus,
      makePlayerSeed,
      socket: getSocket()
    });
    renderMobileControlsRuntime({
      computeMobileControlVisibility,
      isTouchLikeDevice,
      windowRef,
      mobileControls,
      worldMapPanel,
      getUiTargetId,
      challengeController,
      describeInteractionPhase,
      state,
      interactionCard: interactionCardElement,
      mobileInteract,
      mobileSend,
      mobileAccept,
      mobileDecline,
      mobileMoves,
      mobileMove1,
      mobileMove2,
      mobileMove3,
      mobileMoveH,
      mobileMoveT,
      mobileMoveD1,
      mobileMoveD2,
      mobileMoveD3,
      mobileMoveD4,
      mobileMoveD5,
      mobileMoveD6,
      featureMobileV2
    });
    renderQuickstartModule(state, quickstartPanel, quickstartList);
  };
}
