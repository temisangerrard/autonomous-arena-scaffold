import {
  isRequestBackoffActive,
  setRequestBackoffFromError,
  clearRequestBackoff
} from '../../shared/request-backoff.js';
import { mergePlayerShell } from '../../shared/player-shell.js';

const WALLET_SUMMARY_BACKOFF_KEY = 'play_wallet_summary';

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

  function getRequestStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  async function syncWalletSummary(options = {}) {
    const keepLastOnFailure = options.keepLastOnFailure !== false;
    const now = Date.now();
    const requestStorage = getRequestStorage();
    if (isRequestBackoffActive(requestStorage, WALLET_SUMMARY_BACKOFF_KEY, now)) {
      return false;
    }
    if (now < walletMutedUntilMs) {
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
          balance: nextBalance,
          tokenSymbol: summary?.onchain?.tokenSymbol ?? state.walletTokenSymbol ?? null,
          tokenDecimals: Number.isFinite(Number(summary?.onchain?.tokenDecimals)) ? Number(summary.onchain.tokenDecimals) : (state.walletTokenDecimals ?? null),
          mode: summary?.onchain?.mode ?? state.walletMode ?? null,
          synced: Boolean(summary?.onchain?.synced),
          walletProvider: summary?.wallet?.walletProvider ?? state.walletProvider ?? null,
          walletExternalAddress: summary?.wallet?.externalWalletAddress ?? state.walletExternalAddress ?? null,
          escrowApprovalCapUsdc: summary?.wallet?.escrowApproval?.capUsdc ?? state.walletEscrowApprovalCapUsdc ?? null,
          escrowApprovalTokenAddress: summary?.wallet?.escrowApproval?.tokenAddress ?? state.walletEscrowApprovalTokenAddress ?? null,
          escrowApprovalSpenderAddress: summary?.wallet?.escrowApproval?.spenderAddress ?? state.walletEscrowApprovalSpenderAddress ?? null
        });
        if (state.playerShellData) {
          state.playerShellData = mergePlayerShell(state.playerShellData, {
            walletSummary: summary,
            funding: {
              ...(state.playerShellData?.funding || {}),
              walletProvider: summary?.wallet?.walletProvider ?? state.walletProvider ?? null,
              depositAddress: summary?.wallet?.externalWalletAddress
                ?? state.playerShellData?.funding?.depositAddress
                ?? summary?.onchain?.address
                ?? '',
              chainId: Number.isFinite(Number(summary?.onchain?.chainId)) ? Number(summary.onchain.chainId) : null,
              tokenSymbol: summary?.onchain?.tokenSymbol ?? 'USDC'
            },
            loadedAt: Date.now()
          });
          state.playerShellLoadedAt = Number(state.playerShellData.loadedAt || Date.now());
        }
        clearRequestBackoff(requestStorage, WALLET_SUMMARY_BACKOFF_KEY);
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
        const sharedBackoffUntil = setRequestBackoffFromError(
          requestStorage,
          WALLET_SUMMARY_BACKOFF_KEY,
          error
        );
        if (Number.isFinite(sharedBackoffUntil) && sharedBackoffUntil > 0) {
          walletMutedUntilMs = Math.max(walletMutedUntilMs, sharedBackoffUntil);
        }
        if (!keepLastOnFailure) {
          dispatch({
            type: 'WALLET_SUMMARY_SET',
            balance: null,
            chainId: state.walletChainId,
            tokenSymbol: state.walletTokenSymbol ?? null,
            tokenDecimals: state.walletTokenDecimals ?? null,
            mode: state.walletMode ?? null,
            synced: false,
            walletProvider: state.walletProvider ?? null,
            walletExternalAddress: state.walletExternalAddress ?? null,
            escrowApprovalCapUsdc: state.walletEscrowApprovalCapUsdc ?? null,
            escrowApprovalTokenAddress: state.walletEscrowApprovalTokenAddress ?? null,
            escrowApprovalSpenderAddress: state.walletEscrowApprovalSpenderAddress ?? null
          });
        }
        if (status !== 429 && status !== 502 && status !== 503 && status !== 504) {
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
