export function setInteractOpenState(params) {
  const {
    state,
    interactionCard,
    interactionHelp,
    interactionHelpToggle,
    interactionCardState,
    closestNearbyStationId,
    closestNearbyPlayerId
  } = params;

  const { nextOpen } = params;
  state.ui.interactOpen = Boolean(nextOpen);
  document.body.classList.toggle('interaction-focus', state.ui.interactOpen);
  if (!interactionCard) {
    return;
  }
  interactionCard.classList.toggle('open', state.ui.interactOpen);
  interactionCard.setAttribute('aria-hidden', state.ui.interactOpen ? 'false' : 'true');
  if (state.ui.interactOpen) {
    const stationFirst = closestNearbyStationId();
    if (stationFirst) {
      state.ui.targetId = stationFirst;
      state.ui.interactionMode = 'station';
    } else if (closestNearbyPlayerId()) {
      state.ui.targetId = closestNearbyPlayerId();
      state.ui.interactionMode = 'player';
    } else {
      state.ui.interactionMode = 'none';
    }
    try {
      document.activeElement?.blur?.();
    } catch {
      // ignore
    }
    state.ui.dealer.state = 'idle';
    state.ui.dealer.escrowTx = null;
    state.ui.world.stationId = '';
    state.ui.world.detail = '';
    state.ui.world.actionLabel = 'Use';
    if (interactionHelp) {
      interactionHelp.hidden = true;
      interactionHelpToggle?.setAttribute('aria-expanded', 'false');
    }
  } else {
    interactionCardState.interactionStationRenderKey = '';
    state.ui.interactionMode = 'none';
    state.ui.dealer.state = 'idle';
    state.ui.dealer.escrowTx = null;
    state.ui.world.stationId = '';
    state.ui.world.detail = '';
    state.ui.world.actionLabel = 'Use';
    if (interactionHelp) {
      interactionHelp.hidden = true;
      interactionHelpToggle?.setAttribute('aria-expanded', 'false');
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && interactionCard.contains(active)) {
      active.blur?.();
    }
  }
}

export function renderInteractionPromptLine(params) {
  const {
    state,
    interactionPrompt,
    getUiTargetId,
    setInteractOpen,
    challengeController,
    isStation,
    labelFor
  } = params;

  if (!interactionPrompt) {
    return;
  }
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    interactionPrompt.classList.remove('visible');
    return;
  }
  if (state.ui?.interactOpen) {
    interactionPrompt.classList.remove('visible');
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    interactionPrompt.classList.remove('visible');
    setInteractOpen(false);
    return;
  }
  const incoming = challengeController.currentIncomingChallenge();
  if (isStation(targetId)) {
    const station = state.stations instanceof Map ? state.stations.get(targetId) : null;
    const local = station?.localInteraction;
    if (local?.title) {
      // Named NPC host — show character name as the call-to-action
      interactionPrompt.innerHTML = `<span class="prompt-name">${local.title}</span><span class="prompt-hint"> — press E to talk</span>`;
    } else {
      interactionPrompt.innerHTML = `<span class="prompt-name">${labelFor(targetId)}</span><span class="prompt-hint"> — press E to open</span>`;
    }
  } else {
    const hint = incoming ? ' · Y/N respond' : '';
    interactionPrompt.innerHTML = `<span class="prompt-name">${labelFor(targetId)}</span><span class="prompt-hint"> — E interact · C challenge${hint}</span>`;
  }
  interactionPrompt.classList.add('visible');
}
