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
    updateRpsVisibility,
    audio = null
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
      audio?.trigger('challenge_incoming');
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'incoming',
        message: `Incoming ${challenge.gameType} challenge from ${labelFor(challenge.challengerId)} (${formatWagerInline(challenge.wager)}).`
      });
    }

    if (challenge.challengerId === state.playerId) {
      state.outgoingChallengeId = challenge.id;
      const sentMsg = `Challenge created. Waiting for ${labelFor(challenge.opponentId)}.`;
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'sent',
        message: sentMsg
      });
      dispatch({ type: 'PLAYER_CHALLENGE_MESSAGE_SET', message: sentMsg });
    }
  }

  if (payload.event === 'accepted' && challenge) {
    state.respondingIncoming = false;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    audio?.setActivityLevel(1.45);
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
    audio?.setActivityLevel(1.0);
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    const declinedMsg = `Challenge declined (${challenge.id})${reason ? ` · ${reason}` : ''}`;
    dispatch({ type: 'CHALLENGE_STATUS_SET', status: 'declined', message: declinedMsg });
    dispatch({ type: 'PLAYER_CHALLENGE_MESSAGE_SET', message: declinedMsg });
  }

  if (payload.event === 'expired' && challenge) {
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    audio?.setActivityLevel(1.0);
    const reason = payload.reason ? challengeReasonLabel(payload.reason) : '';
    const expiredMsg = `Challenge expired (${challenge.id})${reason ? ` · ${reason}` : ''}`;
    dispatch({ type: 'CHALLENGE_STATUS_SET', status: 'expired', message: expiredMsg });
    dispatch({ type: 'PLAYER_CHALLENGE_MESSAGE_SET', message: expiredMsg });
  }

  if (payload.event === 'resolved' && challenge) {
    const beforeBalance = state.walletBalance;
    state.respondingIncoming = false;
    state.activeChallenge = null;
    state.incomingChallengeId = null;
    state.outgoingChallengeId = null;
    audio?.setActivityLevel(1.0);
    const winnerLabel = challenge.winnerId ? labelFor(challenge.winnerId) : 'Draw';
    if (challenge.winnerId === state.playerId) {
      state.streak += 1;
      const _getStreakTier = (n) => {
        if (n >= 20) return { label: 'Legend', color: '#eab308', pulse: true };
        if (n >= 10) return { label: 'Unstoppable', color: '#ef4444', pulse: false };
        if (n >= 5)  return { label: 'On Fire', color: '#f97316', pulse: false };
        if (n >= 3)  return { label: 'Hot', color: '#f59e0b', pulse: false };
        return null;
      };
      const _streakMilestones = [3, 5, 10, 20];
      if (_streakMilestones.includes(state.streak)) {
        const _tier = _getStreakTier(state.streak);
        if (_tier) showToast(`${_tier.label} — ${state.streak} in a row!`);
      }
    } else if (challenge.winnerId) {
      state.streak = 0;
    }
    const resolvedMsg = challenge.winnerId ? `Resolved. Winner: ${winnerLabel}` : 'Resolved. Draw/refund.';
    dispatch({ type: 'CHALLENGE_STATUS_SET', status: 'resolved', message: resolvedMsg });
    dispatch({ type: 'PLAYER_CHALLENGE_MESSAGE_SET', message: resolvedMsg });
    state.quickstart.matchResolved = true;
    void refreshWalletBalanceAndShowDelta(beforeBalance, challenge);
  }

  if (payload.event === 'invalid' || payload.event === 'busy') {
    state.respondingIncoming = false;
    const invalidMsg = challengeReasonLabel(payload.reason);
    dispatch({ type: 'CHALLENGE_STATUS_SET', status: state.challengeStatus || 'none', message: invalidMsg });
    dispatch({ type: 'PLAYER_CHALLENGE_MESSAGE_SET', message: invalidMsg });
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
