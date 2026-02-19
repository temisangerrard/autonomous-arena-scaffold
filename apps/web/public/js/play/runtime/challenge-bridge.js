export function createChallengeBridge(params) {
  const {
    state,
    dispatch,
    labelFor,
    formatWagerInline,
    refreshWalletBalanceAndShowDelta,
    isEscrowApprovalReason,
    showToast,
    addFeedEvent,
    handleChallengeEvent,
    challengeReasonLabelForMode
  } = params;

  function updateRpsVisibility() {
    // Mobile controls are context-driven; kept for backwards compatibility hooks.
  }

  function challengeReasonLabel(reason) {
    const autoApproval = String(state.escrowApproval?.mode || 'manual') === 'auto';
    return challengeReasonLabelForMode(reason, autoApproval);
  }

  function handleChallenge(payload) {
    handleChallengeEvent({
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
    });
  }

  return {
    handleChallenge,
    challengeReasonLabel,
    updateRpsVisibility
  };
}
