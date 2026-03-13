export function createEscrowApprovalController(params) {
  const {
    state,
    apiJson,
    walletApprovalClient,
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

  function approvalCapAmount(payload) {
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    const explicit = Number(first?.approvalTargetAmount ?? first?.approvalCapUsdc ?? payload?.approvalTargetAmount ?? state.walletEscrowApprovalCapUsdc);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : null;
  }

  function buildApprovalCapMessage(payload, fallbackAmount) {
    const amount = approvalCapAmount(payload) ?? Math.max(0, Number(fallbackAmount || 0));
    if (!(amount > 0)) {
      return 'Escrow approval needed. Confirm the approval in your wallet, then retry.';
    }
    return `Approve a ${formatUsdAmount(amount)} cap in your wallet so wagers and autoplay can use escrow.`;
  }

  function approvalMetadata(payload) {
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    return {
      capUsdc: approvalCapAmount(payload),
      tokenAddress: first?.approvalTokenAddress ?? payload?.approvalTokenAddress ?? state.walletEscrowApprovalTokenAddress ?? null,
      spenderAddress: first?.approvalSpenderAddress ?? payload?.approvalSpenderAddress ?? state.walletEscrowApprovalSpenderAddress ?? null
    };
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
        const approvedCap = approvalCapAmount(payload) ?? amount;
        state.ui.challenge.approvalWager = approvedCap;
        state.ui.challenge.approvalMessage = `Escrow approval ready up to ${formatUsdAmount(approvedCap)}.`;
        return true;
      }
      let reason = String(first?.reason || payload?.reason || 'wallet_prepare_failed');
      if (
        reason === 'allowance_too_low'
        && String(state.walletProvider || '') === 'coinbase_embedded'
        && walletApprovalClient?.approveEscrowCap
      ) {
        const metadata = approvalMetadata(payload);
        if (metadata.capUsdc && metadata.tokenAddress && metadata.spenderAddress && state.walletExternalAddress) {
          try {
            state.ui.challenge.approvalState = 'checking';
            state.ui.challenge.approvalMessage = `Confirm the ${formatUsdAmount(metadata.capUsdc)} escrow cap in your wallet...`;
            const approvalRequest = {
              capUsdc: metadata.capUsdc,
              tokenAddress: metadata.tokenAddress,
              spenderAddress: metadata.spenderAddress,
              smartAccount: state.walletExternalAddress
            };
            if (Number.isFinite(Number(state.walletChainId))) {
              approvalRequest.chainId = Number(state.walletChainId);
            }
            await walletApprovalClient.approveEscrowCap(approvalRequest);
            const verified = await apiJson('/api/player/wallet/prepare-escrow', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ amount })
            });
            const verifiedFirst = Array.isArray(verified?.results) ? verified.results[0] : null;
            if (verifiedFirst?.ok) {
              const approvedCap = approvalCapAmount(verified) ?? metadata.capUsdc;
              state.ui.challenge.approvalState = 'ready';
              state.ui.challenge.approvalWager = approvedCap;
              state.ui.challenge.approvalMessage = `Escrow approval ready up to ${formatUsdAmount(approvedCap)}.`;
              return true;
            }
          } catch {
            reason = 'approve_failed';
          }
        }
      }
      state.ui.challenge.approvalState = 'required';
      state.ui.challenge.approvalWager = 0;
      state.ui.challenge.approvalMessage = isEscrowApprovalReason(reason)
        ? buildApprovalCapMessage(payload, amount)
        : challengeReasonLabel(reason);
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
