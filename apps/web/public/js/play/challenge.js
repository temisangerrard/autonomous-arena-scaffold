export function normalizedChallengeGameType(value) {
  if (value === 'coinflip') return 'coinflip';
  if (value === 'dice_duel') return 'dice_duel';
  return 'rps';
}

export function normalizedChallengeWager(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(0, Math.min(10000, Number(fallback || 1)));
  }
  return Math.max(0, Math.min(10000, parsed));
}

export function createChallengeController(deps) {
  const {
    state,
    socketRef,
    showToast,
    labelFor,
    isStation,
    closestNearbyPlayerId,
    getUiTargetId,
    formatWagerInline
  } = deps;

  function currentIncomingChallenge() {
    const incomingId = String(state.incomingChallengeId || '');
    if (!incomingId) return null;
    const active = state.activeChallenge;
    if (!active || String(active.id || '') !== incomingId) return null;
    if (active.opponentId !== state.playerId) return null;
    return active;
  }

  async function sendChallenge(targetId = null, gameType = null, wager = null) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showToast('Not connected to server.');
      return;
    }
    if (state.outgoingChallengeId) {
      showToast('You already have a pending outgoing challenge.');
      return;
    }
    const resolvedTargetId = String(targetId || getUiTargetId() || closestNearbyPlayerId() || '').trim();
    if (!resolvedTargetId || isStation(resolvedTargetId) || resolvedTargetId === state.playerId) {
      showToast('Move near another player to challenge.');
      return;
    }
    if (!state.nearbyIds?.has(resolvedTargetId)) {
      showToast('Move closer to that player, then retry challenge.');
      return;
    }
    const resolvedGameType = normalizedChallengeGameType(
      gameType
      ?? state.ui?.challenge?.gameType
      ?? (document.getElementById('player-challenge-game') instanceof HTMLSelectElement
        ? document.getElementById('player-challenge-game').value
        : 'rps')
    );
    const resolvedWager = normalizedChallengeWager(
      wager
      ?? state.ui?.challenge?.wager
      ?? (document.getElementById('player-challenge-wager') instanceof HTMLInputElement
        ? document.getElementById('player-challenge-wager').value
        : 1),
      1
    );
    state.ui.challenge.gameType = resolvedGameType;
    state.ui.challenge.wager = resolvedWager;
    const approvedWager = Number(state.ui?.challenge?.approvalWager || 0);
    const approvalMode = String(state.escrowApproval?.mode || 'manual');
    const approvalReady = String(state.ui?.challenge?.approvalState || '') === 'ready' && approvedWager >= resolvedWager;
    if (resolvedWager > 0 && approvalMode !== 'auto' && !approvalReady) {
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalMessage = `Approve escrow for ${formatWagerInline(resolvedWager)} before sending.`;
      showToast(state.ui.challenge.approvalMessage);
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'challenge_send',
        targetId: resolvedTargetId,
        gameType: resolvedGameType,
        wager: resolvedWager
      })
    );
    state.challengeStatus = 'sent';
    state.challengeMessage = `Sending ${resolvedGameType.toUpperCase()} challenge to ${labelFor(resolvedTargetId)} (${formatWagerInline(resolvedWager)}).`;
  }

  function respondToIncoming(accept) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showToast('Not connected to server.');
      return;
    }
    if (state.respondingIncoming) {
      return;
    }
    const incoming = currentIncomingChallenge();
    if (!incoming) {
      showToast('No incoming challenge to respond to.');
      return;
    }
    state.respondingIncoming = true;
    state.challengeMessage = accept ? 'Accepting challenge...' : 'Declining challenge...';
    socket.send(
      JSON.stringify({
        type: 'challenge_response',
        challengeId: incoming.id,
        accept: Boolean(accept)
      })
    );
  }

  function canUseChallengeHotkeys() {
    if (!state.ui?.interactOpen) return false;
    if (state.ui?.interactionMode !== 'player') return false;
    return true;
  }

  function computeControlContext() {
    const active = state.activeChallenge;
    const inMatch = Boolean(
      active &&
      active.status === 'active' &&
      (active.challengerId === state.playerId || active.opponentId === state.playerId)
    );
    const incoming = currentIncomingChallenge();
    const playerTargetAvailable = Boolean(closestNearbyPlayerId());
    const dealerReady = state.ui.interactOpen
      && state.ui.interactionMode === 'station'
      && state.ui.dealer.state === 'ready';

    if (dealerReady) {
      const dealerGameType = state.ui?.dealer?.gameType;
      if (dealerGameType === 'rps') return 'dealer_ready_rps';
      if (dealerGameType === 'dice_duel') return 'dealer_ready_dice_duel';
      if (dealerGameType === 'coinflip') return 'dealer_ready_coinflip';
      return 'idle';
    }
    if (incoming) return 'incoming_challenge';
    if (inMatch && active?.gameType === 'rps') return 'active_rps';
    if (inMatch && active?.gameType === 'coinflip') return 'active_coinflip';
    if (inMatch && active?.gameType === 'dice_duel') return 'active_dice_duel';
    if (playerTargetAvailable && !state.outgoingChallengeId) return 'near_player_idle';
    return 'idle';
  }

  return {
    currentIncomingChallenge,
    sendChallenge,
    respondToIncoming,
    canUseChallengeHotkeys,
    computeControlContext
  };
}
