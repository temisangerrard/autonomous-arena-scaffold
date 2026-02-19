export function handleChallengeEvent(params) {
  const {
    payload,
    state,
    dispatch,
    labelFor,
    formatWagerInline,
    challengeReasonLabel,
    refreshWalletBalanceAndShowDelta,
    isEscrowApprovalReason,
    showToast,
    addFeedEvent,
    updateRpsVisibility
  } = params;

  const challenge = payload.challenge;
  if (payload?.approvalMode === 'auto' || payload?.approvalMode === 'manual') {
    state.escrowApproval.mode = payload.approvalMode;
  }
  if (challenge) {
    state.activeChallenge = challenge;
  }

  if (payload.event === 'created' && challenge) {
    state.respondingIncoming = false;
    if (challenge.opponentId === state.playerId) {
      state.incomingChallengeId = challenge.id;
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'incoming',
        message: `Incoming ${challenge.gameType} challenge from ${labelFor(challenge.challengerId)} (${formatWagerInline(challenge.wager)}).`
      });
    }

    if (challenge.challengerId === state.playerId) {
      state.outgoingChallengeId = challenge.id;
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'sent',
        message: `Challenge created. Waiting for ${labelFor(challenge.opponentId)}.`
      });
    }
  }

  if (payload.event === 'accepted' && challenge) {
    state.respondingIncoming = false;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: 'active',
      message: `${challenge.gameType.toUpperCase()} active.`
    });
    state.quickstart.matchActive = true;
  }

  if (payload.event === 'move_submitted' && challenge) {
    dispatch({ type: 'CHALLENGE_STATUS_SET', status: 'active', message: state.challengeMessage || '' });
  }

  if (payload.event === 'declined' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: 'declined',
      message: `Challenge declined (${challenge.id})${reason ? ` · ${reason}` : ''}`
    });
  }

  if (payload.event === 'expired' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: 'expired',
      message: `Challenge expired (${challenge.id})${reason ? ` · ${reason}` : ''}`
    });
  }

  if (payload.event === 'resolved' && challenge) {
    const beforeBalance = state.walletBalance;
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    const winnerLabel = challenge.winnerId ? labelFor(challenge.winnerId) : 'Draw';
    if (challenge.winnerId === state.playerId) {
      state.streak += 1;
    } else if (challenge.winnerId) {
      state.streak = 0;
    }
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: 'resolved',
      message: challenge.winnerId ? `Resolved. Winner: ${winnerLabel}` : 'Resolved. Draw/refund.'
    });
    state.quickstart.matchResolved = true;
    void refreshWalletBalanceAndShowDelta(beforeBalance, challenge);
  }

  if (payload.event === 'invalid' || payload.event === 'busy') {
    state.respondingIncoming = false;
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: state.challengeStatus || 'none',
      message: challengeReasonLabel(payload.reason)
    });
    const approvalStatus = String(payload?.approvalStatus || '');
    if (approvalStatus === 'failed' || isEscrowApprovalReason(payload.reason)) {
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalMessage = state.challengeMessage;
      state.ui.challenge.approvalWager = 0;
    }
    showToast(state.challengeMessage);
  }

  addFeedEvent('match', `challenge:${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`);
  updateRpsVisibility();
}
