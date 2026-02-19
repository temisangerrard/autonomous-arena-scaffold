export function createEscrowPolicyController(params) {
  const {
    windowRef,
    state
  } = params;

  const SEPOLIA_CHAIN_IDS = new Set([11155111, 84532]);
  const MAINNET_CHAIN_IDS = new Set([1, 8453]);

  function normalizeApprovalMode(value, fallback = 'manual') {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'auto') return 'auto';
    if (raw === 'manual') return 'manual';
    return fallback;
  }

  function classifyApprovalNetwork(chainId, chainHint = '') {
    const id = Number(chainId);
    if (Number.isFinite(id)) {
      if (SEPOLIA_CHAIN_IDS.has(id)) return 'sepolia';
      if (MAINNET_CHAIN_IDS.has(id)) return 'mainnet';
    }
    const hint = String(chainHint || '').toLowerCase();
    if (hint.includes('sepolia') || hint.includes('testnet')) return 'sepolia';
    if (hint.includes('mainnet') || hint === 'main' || hint === 'prod') return 'mainnet';
    return 'unknown';
  }

  function resolveEscrowApprovalForClient(chainId = null) {
    const policy = windowRef.ARENA_CONFIG?.escrowApprovalPolicy || {};
    const fallback = policy?.effective || {};
    const modeSepolia = normalizeApprovalMode(policy.modeSepolia, 'auto');
    const modeMainnet = normalizeApprovalMode(policy.modeMainnet, 'manual');
    const defaultMode = normalizeApprovalMode(policy.defaultMode, normalizeApprovalMode(fallback.mode, 'manual'));
    const network = classifyApprovalNetwork(
      chainId,
      policy.chainHint || fallback.network || ''
    );
    const mode = network === 'sepolia'
      ? modeSepolia
      : network === 'mainnet'
        ? modeMainnet
        : defaultMode;
    return {
      mode,
      network,
      reason: network === 'unknown' ? 'fallback:default_mode' : `network:${network}`,
      source: chainId == null ? 'config' : 'chain',
      autoApproveMaxWager: Number.isFinite(Number(policy.autoApproveMaxWager))
        ? Number(policy.autoApproveMaxWager)
        : null,
      autoApproveDailyCap: Number.isFinite(Number(policy.autoApproveDailyCap))
        ? Number(policy.autoApproveDailyCap)
        : null
    };
  }

  function syncEscrowApprovalPolicy() {
    state.escrowApproval = resolveEscrowApprovalForClient(state.walletChainId);
  }

  return {
    syncEscrowApprovalPolicy
  };
}
