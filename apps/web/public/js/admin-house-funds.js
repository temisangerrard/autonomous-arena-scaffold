export function buildHouseFundsView(onchain = {}) {
  const raw = onchain?.houseFunds || {};
  const total = Number(raw.totalVisibleUsdc || 0);
  const historicalOutflows = Number(raw.historicalTreasuryOutflowsUsdc || 0);
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  return {
    totalLabel: `${total.toFixed(2)} USDC`,
    historicalOutflowsLabel: `${historicalOutflows.toFixed(2)} USDC`,
    note: 'Current visible house funds are separate from historical treasury withdrawals already moved out.',
    sources: sources.map((entry) => ({
      ...entry,
      balanceLabel: `${Number(entry?.balanceUsdc || 0).toFixed(2)} USDC`,
      actionLabel:
        entry?.action === 'withdraw_treasury' ? 'Withdraw Treasury'
        : entry?.action === 'transfer_wallet' ? 'Send On-Chain'
        : 'Runtime Only'
    }))
  };
}
