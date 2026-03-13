import type { WalletRecord, WalletReadiness, WalletReadinessStatus } from '@arena/shared';
import { resolveGasSponsorshipPolicy } from './gasPolicy.js';

/**
 * Compute a single unified wallet readiness state for autoplay or manual play.
 *
 * Returns a WalletReadiness describing whether the wallet can participate in a wager.
 * Callers should surface this directly in the UI instead of interpreting raw wallet fields.
 */
export function computeWalletReadiness(input: {
  wallet: WalletRecord | null;
  minWager: number;
  /** Whether Coinbase paymaster is enabled (covers approval) */
  coinbasePaymasterEnabled?: boolean;
  /** Approval cap from Coinbase escrow config (USDC) */
  coinbaseEscrowApprovalCapUsdc?: number;
  chainId?: number | null;
  chainHint?: string | null;
  mainnetGasSponsorEnabled?: boolean;
}): WalletReadiness {
  const { wallet, minWager } = input;

  if (!wallet) {
    return {
      status: 'insufficient_usdc',
      reason: 'no_wallet',
      gasSponsored: false
    };
  }

  const provider = wallet.walletProvider === 'coinbase_embedded' ? 'coinbase_embedded' : 'internal';
  const gasPolicy = resolveGasSponsorshipPolicy({
    chainId: input.chainId,
    chainHint: input.chainHint,
    mainnetEnabled: input.mainnetGasSponsorEnabled
  });
  const gasSponsored = gasPolicy.sponsorshipEnabled;

  // Provider support check: only internal and coinbase_embedded supported for autonomous play
  if (provider !== 'internal' && provider !== 'coinbase_embedded') {
    return {
      status: 'unsupported_provider',
      reason: `unsupported_wallet_provider:${provider}`,
      gasSponsored
    };
  }

  // Gas check: if not sponsored, user must have funded gas (non-zero external wallet or gas flag)
  if (!gasSponsored && gasPolicy.userMustFundGas) {
    // For coinbase_embedded, paymaster can cover; for internal, gas must be pre-funded
    if (provider === 'internal') {
      return {
        status: 'needs_gas',
        reason: 'gas_not_sponsored_user_must_fund',
        gasSponsored
      };
    }
  }

  // Coinbase embedded: check paymaster / escrow approval
  if (provider === 'coinbase_embedded') {
    const paymasterEnabled = Boolean(input.coinbasePaymasterEnabled);
    const approvalCap = Number(input.coinbaseEscrowApprovalCapUsdc ?? 0);
    if (!paymasterEnabled && approvalCap < minWager) {
      return {
        status: 'needs_approval',
        reason: 'coinbase_paymaster_disabled_and_cap_insufficient',
        minUsdc: minWager,
        gasSponsored
      };
    }
  }

  // Balance check
  if (wallet.balance < minWager) {
    return {
      status: 'insufficient_usdc',
      reason: 'balance_below_min_wager',
      minUsdc: minWager,
      gasSponsored
    };
  }

  return {
    status: 'ready',
    reason: 'all_checks_passed',
    gasSponsored
  };
}

/**
 * Derive a human-readable status label for UI badge rendering.
 */
export function walletReadinessLabel(status: WalletReadinessStatus): string {
  switch (status) {
    case 'ready': return 'Ready';
    case 'needs_approval': return 'Needs Approval';
    case 'needs_gas': return 'Needs Gas';
    case 'insufficient_usdc': return 'Insufficient Funds';
    case 'unsupported_provider': return 'Unsupported Wallet';
    default: return 'Unknown';
  }
}
