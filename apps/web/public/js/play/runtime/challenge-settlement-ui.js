import { formatWinningOutcomeLine } from './formatting.js';

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
    const iAmChallenger = challenge.challengerId === state.playerId;
    const winningOutcome = formatWinningOutcomeLine({
      gameType: challenge.gameType,
      playerPick: iAmChallenger ? challenge.challengerMove : challenge.opponentMove,
      opponentPick: iAmChallenger ? challenge.opponentMove : challenge.challengerMove,
      coinflipResult: challenge.coinflipResult,
      diceResult: challenge.diceResult
    });
    const detail = winningOutcome ? `\n${winningOutcome.toUpperCase()}` : '';
    if (won) {
      showResultSplash(`YOU WIN${detail}\n+${Math.abs(delta).toFixed(2)}`, 'win');
    } else if (lost) {
      showResultSplash(`YOU LOSE${detail}\n-${Math.abs(delta).toFixed(2)}`, 'loss');
    } else {
      showResultSplash(`DRAW${detail}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, 'neutral');
    }
  }
}
