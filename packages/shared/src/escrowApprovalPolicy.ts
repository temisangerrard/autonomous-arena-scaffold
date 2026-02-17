export type EscrowApprovalMode = 'auto' | 'manual';
export type EscrowApprovalNetwork = 'sepolia' | 'mainnet' | 'unknown';

export type EscrowApprovalPolicyInput = {
  chainId?: number | null;
  chainHint?: string | null;
  modeSepolia?: EscrowApprovalMode | string | null;
  modeMainnet?: EscrowApprovalMode | string | null;
  defaultMode?: EscrowApprovalMode | string | null;
  autoApproveMaxWager?: number | null;
  autoApproveDailyCap?: number | null;
};

export type EscrowApprovalPolicyResolved = {
  mode: EscrowApprovalMode;
  network: EscrowApprovalNetwork;
  reason: string;
  autoApproveMaxWager: number | null;
  autoApproveDailyCap: number | null;
};

const SEPOLIA_CHAIN_IDS = new Set([11155111, 84532]);
const MAINNET_CHAIN_IDS = new Set([1, 8453]);

function normalizeMode(value: unknown, fallback: EscrowApprovalMode): EscrowApprovalMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  if (raw === 'manual') return 'manual';
  return fallback;
}

function asOptionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function classifyEscrowApprovalNetwork(
  chainId?: number | null,
  chainHint?: string | null
): EscrowApprovalNetwork {
  const normalizedChainId = Number(chainId);
  if (Number.isFinite(normalizedChainId)) {
    if (SEPOLIA_CHAIN_IDS.has(normalizedChainId)) return 'sepolia';
    if (MAINNET_CHAIN_IDS.has(normalizedChainId)) return 'mainnet';
  }

  const hint = String(chainHint || '').trim().toLowerCase();
  if (hint.includes('sepolia') || hint.includes('testnet')) return 'sepolia';
  if (hint.includes('mainnet') || hint === 'main' || hint === 'prod') return 'mainnet';
  return 'unknown';
}

export function resolveEscrowApprovalPolicy(input: EscrowApprovalPolicyInput): EscrowApprovalPolicyResolved {
  const defaultMode = normalizeMode(input.defaultMode, 'manual');
  const modeSepolia = normalizeMode(input.modeSepolia, 'auto');
  const modeMainnet = normalizeMode(input.modeMainnet, 'manual');
  const network = classifyEscrowApprovalNetwork(input.chainId, input.chainHint);

  if (network === 'sepolia') {
    return {
      mode: modeSepolia,
      network,
      reason: `network:${network}`,
      autoApproveMaxWager: asOptionalPositiveNumber(input.autoApproveMaxWager),
      autoApproveDailyCap: asOptionalPositiveNumber(input.autoApproveDailyCap)
    };
  }

  if (network === 'mainnet') {
    return {
      mode: modeMainnet,
      network,
      reason: `network:${network}`,
      autoApproveMaxWager: asOptionalPositiveNumber(input.autoApproveMaxWager),
      autoApproveDailyCap: asOptionalPositiveNumber(input.autoApproveDailyCap)
    };
  }

  return {
    mode: defaultMode,
    network,
    reason: 'fallback:default_mode',
    autoApproveMaxWager: asOptionalPositiveNumber(input.autoApproveMaxWager),
    autoApproveDailyCap: asOptionalPositiveNumber(input.autoApproveDailyCap)
  };
}

