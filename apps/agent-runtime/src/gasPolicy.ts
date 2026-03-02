import { classifyEscrowApprovalNetwork, type EscrowApprovalNetwork } from '@arena/shared';

export type GasSponsorshipPolicy = {
  network: EscrowApprovalNetwork;
  sponsorshipEnabled: boolean;
  userMustFundGas: boolean;
  reason: string;
};

export function resolveGasSponsorshipPolicy(input: {
  chainId?: number | null;
  chainHint?: string | null;
  mainnetEnabled?: boolean | null;
}): GasSponsorshipPolicy {
  const network = classifyEscrowApprovalNetwork(input.chainId, input.chainHint);
  const mainnetEnabled = Boolean(input.mainnetEnabled);
  if (network === 'mainnet') {
    return {
      network,
      sponsorshipEnabled: mainnetEnabled,
      userMustFundGas: !mainnetEnabled,
      reason: mainnetEnabled ? 'mainnet:override_enabled' : 'mainnet:user_funded'
    };
  }
  return {
    network,
    sponsorshipEnabled: true,
    userMustFundGas: false,
    reason: network === 'sepolia' ? 'sepolia:sponsored' : 'default:sponsored'
  };
}
