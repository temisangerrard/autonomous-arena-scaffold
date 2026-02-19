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

  async function syncWalletSummary(options = {}) {
    const keepLastOnFailure = options.keepLastOnFailure !== false;
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
        return true;
      } catch (error) {
        if (!keepLastOnFailure) {
          dispatch({ type: 'WALLET_SUMMARY_SET', balance: null, chainId: state.walletChainId });
        }
        console.warn('wallet summary sync failed', error);
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
