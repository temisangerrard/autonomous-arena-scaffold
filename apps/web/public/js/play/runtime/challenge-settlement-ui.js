export async function refreshWalletBalanceAndShowDelta(params) {
  const {
    beforeBalance,
    challenge = null,
    syncWalletSummary,
    state,
    showResultSplash
  } = params;

  const synced = await syncWalletSummary({ keepLastOnFailure: true });
  const after = Number(state.walletBalance);
  if (challenge && synced && Number.isFinite(after)) {
    const settledByOutcome = challenge.winnerId === state.playerId
      ? Number(challenge.wager || 0)
      : challenge.winnerId
        ? -Number(challenge.wager || 0)
        : 0;
    const delta = Number.isFinite(settledByOutcome)
      ? Number(settledByOutcome.toFixed(2))
      : Number((after - Number(beforeBalance || 0)).toFixed(2));
    const won = challenge.winnerId === state.playerId;
    const lost = Boolean(challenge.winnerId && challenge.winnerId !== state.playerId);
    const toss = challenge.gameType === 'coinflip' && challenge.coinflipResult
      ? `\nTOSS: ${String(challenge.coinflipResult).toUpperCase()}`
      : '';
    if (won) {
      showResultSplash(`YOU WIN${toss}\n+${Math.abs(delta).toFixed(2)}`, 'win');
    } else if (lost) {
      showResultSplash(`YOU LOSE${toss}\n-${Math.abs(delta).toFixed(2)}`, 'loss');
    } else {
      showResultSplash(`DRAW${toss}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, 'neutral');
    }
  }
}
