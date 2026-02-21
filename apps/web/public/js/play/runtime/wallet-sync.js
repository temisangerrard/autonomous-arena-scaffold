export function createWalletSyncController(params) {
  const {
    apiJson,
    state,
    dispatch,
    syncEscrowApprovalPolicy
  } = params;

  let walletSyncTimer = null;
  let walletSyncInFlight = null;
  let walletLastSyncAt = 0;
  let walletMutedUntilMs = 0;
  let walletFailureStreak = 0;

  async function syncWalletSummary(options = {}) {
    const keepLastOnFailure = options.keepLastOnFailure !== false;
    if (Date.now() < walletMutedUntilMs) {
      return false;
    }
    if (walletSyncInFlight) {
      return walletSyncInFlight;
    }
    walletSyncInFlight = (async () => {
      try {
        const summary = await apiJson('/api/player/wallet/summary');
        const bal = Number(summary?.onchain?.tokenBalance);
        const chainId = Number(summary?.onchain?.chainId);
        const nextBalance = Number.isFinite(bal)
          ? bal
          : (keepLastOnFailure ? state.walletBalance : null);
        dispatch({
          type: 'WALLET_SUMMARY_SET',
          chainId: Number.isFinite(chainId) ? chainId : state.walletChainId,
          balance: nextBalance
        });
        syncEscrowApprovalPolicy();
        walletLastSyncAt = Date.now();
        walletFailureStreak = 0;
        walletMutedUntilMs = 0;
        return true;
      } catch (error) {
        const status = Number(error?.status || 0);
        const retryAfterMs = Number(error?.retryAfterMs || 0);
        walletFailureStreak += 1;
        if (status === 429) {
          walletMutedUntilMs = Date.now() + Math.max(20_000, retryAfterMs || 60_000);
        } else if (status === 503 || status === 502 || status === 504) {
          // Runtime/onchain backoff: avoid repeated noise while upstream is degraded.
          const backoff = Math.min(120_000, 10_000 * walletFailureStreak);
          walletMutedUntilMs = Date.now() + backoff;
        } else {
          walletMutedUntilMs = 0;
        }
        if (!keepLastOnFailure) {
          dispatch({ type: 'WALLET_SUMMARY_SET', balance: null, chainId: state.walletChainId });
        }
        if (status !== 429) {
          console.warn('wallet summary sync failed', error);
        }
        return false;
      } finally {
        walletSyncInFlight = null;
      }
    })();
    return walletSyncInFlight;
  }

  function stopWalletSyncScheduler() {
    if (walletSyncTimer) {
      window.clearInterval(walletSyncTimer);
      walletSyncTimer = null;
    }
  }

  function startWalletSyncScheduler() {
    stopWalletSyncScheduler();
    void syncWalletSummary({ keepLastOnFailure: true });
    walletSyncTimer = window.setInterval(() => {
      if (!state.wsConnected || document.hidden) {
        return;
      }
      void syncWalletSummary({ keepLastOnFailure: true });
    }, 10_000);
  }

  return {
    syncWalletSummary,
    startWalletSyncScheduler,
    stopWalletSyncScheduler,
    getWalletLastSyncAt: () => walletLastSyncAt
  };
}
