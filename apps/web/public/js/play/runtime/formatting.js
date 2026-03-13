export function formatUsdAmount(value, options = {}) {
  const amount = Number(value || 0);
  const signed = options.signed === true;
  if (!Number.isFinite(amount)) {
    return signed ? '$0.00' : '$0.00';
  }
  if (signed) {
    const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
    return `${sign}$${Math.abs(amount).toFixed(2)}`;
  }
  return `$${amount.toFixed(2)}`;
}

export function validTxHash(txHash) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''));
}

export function txExplorerBase(chainId) {
  const id = Number(chainId);
  if (id === 1) return 'https://etherscan.io';
  if (id === 8453) return 'https://basescan.org';
  // Base-only runtime: keep unknown/test ids on Base explorer for consistent UX.
  return 'https://basescan.org';
}

export function txExplorerUrl(txHash, chainId = null) {
  const normalizedHash = String(txHash || '').trim();
  if (!validTxHash(normalizedHash)) {
    return '';
  }
  return `${txExplorerBase(chainId)}/tx/${normalizedHash}`;
}

export function renderDealerRevealStatus(statusEl, params) {
  if (!statusEl) return;
  const gameType = String(params.gameType || '');
  const playerPick = String(params.playerPick || '');
  const opponentPick = String(params.opponentPick || '');
  const round = formatUsdAmount(Number(params.delta || 0), { signed: true });
  const balance = Number(params.walletBalance);
  const balanceLabel = Number.isFinite(balance)
    ? ` · Balance: ${formatUsdAmount(balance)}`
    : '';
  const txHash = String(params.txHash || '').trim();
  const txUrl = txExplorerUrl(txHash, params.chainId);
  const txLink = txUrl
    ? ` · <a class="tx-link" href="${txUrl}" target="_blank" rel="noreferrer noopener">View onchain</a>`
    : '';

  let resultLine = '';
  if (gameType === 'rps' && playerPick && opponentPick) {
    const RPS_ICONS = { rock: '🪨', paper: '📄', scissors: '✂️' };
    const p = RPS_ICONS[playerPick] || playerPick;
    const h = RPS_ICONS[opponentPick] || opponentPick;
    resultLine = `You: ${p} vs House: ${h} · Round: ${round}`;
  } else if (gameType === 'dice_duel' && playerPick && opponentPick) {
    const DICE_ICONS = { d1: '⚀', d2: '⚁', d3: '⚂', d4: '⚃', d5: '⚄', d6: '⚅' };
    const p = DICE_ICONS[playerPick] || playerPick;
    const h = DICE_ICONS[opponentPick] || opponentPick;
    resultLine = `You: ${p} vs House: ${h} · Round: ${round}`;
  } else {
    const toss = String(params.coinflipResult || '').toUpperCase() || 'UNKNOWN';
    const COIN_ICONS = { HEADS: '🪙', TAILS: '🔄' };
    const icon = COIN_ICONS[toss] ? `${COIN_ICONS[toss]} ` : '';
    resultLine = `${icon}${toss} · Round: ${round}`;
  }

  statusEl.innerHTML = `${resultLine}${balanceLabel}${txLink}`;
}

export function formatWagerLabel(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Free';
  }
  return `Wager ${formatUsdAmount(value)} USDC`;
}

export function formatWagerInline(wager) {
  const value = Number(wager || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'free';
  }
  return `${formatUsdAmount(value)} USDC each`;
}

export function formatPredictionPrice(price) {
  const safe = Math.max(0, Math.min(1, Number(price || 0)));
  return `${Math.round(safe * 100)}%`;
}

export function formatPredictionClose(closeAt) {
  const ms = Number(closeAt || 0) - Date.now();
  if (!Number.isFinite(ms)) return 'Unknown';
  if (ms <= 0) return 'Closed';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m left`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}
