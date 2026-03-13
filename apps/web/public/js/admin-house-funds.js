export function buildHouseFundsView(onchain = {}) {
  const raw = onchain?.houseFunds || {};
  const total = Number(raw.totalVisibleUsdc || 0);
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  return {
    totalLabel: `${total.toFixed(2)} USDC`,
    note: 'Visible house-controlled funds may exist across multiple house-controlled sources.',
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
