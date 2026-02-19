export function createEscrowApprovalController(params) {
  const {
    state,
    apiJson,
    formatUsdAmount,
    challengeReasonLabel,
    showToast
  } = params;

  function isEscrowApprovalReason(reason) {
    const raw = String(reason || '').toLowerCase();
    return raw === 'allowance_too_low'
      || raw === 'approve_failed'
      || raw === 'wallet_prepare_failed'
      || raw === 'player_allowance_low'
      || raw.includes('allowance');
  }

  async function ensureEscrowApproval(wager) {
    const amount = Math.max(0, Number(wager || 0));
    const approvalMode = String(state.escrowApproval?.mode || 'manual');
    if (!(amount > 0)) {
      state.ui.challenge.approvalState = 'idle';
      state.ui.challenge.approvalMessage = '';
      state.ui.challenge.approvalWager = 0;
      return true;
    }
    if (approvalMode === 'auto') {
      state.ui.challenge.approvalState = 'ready';
      state.ui.challenge.approvalWager = amount;
      state.ui.challenge.approvalMessage = `Testnet mode: approvals handled automatically for ${formatUsdAmount(amount)}.`;
      return true;
    }

    state.ui.challenge.approvalState = 'checking';
    state.ui.challenge.approvalMessage = `Preparing escrow approval for ${formatUsdAmount(amount)}...`;
    try {
      const payload = await apiJson('/api/player/wallet/prepare-escrow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      const first = Array.isArray(payload?.results) ? payload.results[0] : null;
      if (first?.ok) {
        state.ui.challenge.approvalState = 'ready';
        state.ui.challenge.approvalWager = amount;
        state.ui.challenge.approvalMessage = `Escrow approval ready for ${formatUsdAmount(amount)}.`;
        return true;
      }
      const reason = String(first?.reason || payload?.reason || 'wallet_prepare_failed');
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalWager = 0;
      state.ui.challenge.approvalMessage = challengeReasonLabel(reason);
      showToast(state.ui.challenge.approvalMessage);
      return false;
    } catch (error) {
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalWager = 0;
      state.ui.challenge.approvalMessage = challengeReasonLabel(
        String(error?.message || 'wallet_prepare_failed')
      );
      showToast(state.ui.challenge.approvalMessage);
      return false;
    }
  }

  return {
    isEscrowApprovalReason,
    ensureEscrowApproval
  };
}
