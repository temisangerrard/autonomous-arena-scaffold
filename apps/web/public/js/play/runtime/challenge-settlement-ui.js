import { formatWinningOutcomeLine } from './formatting.js';

export async function refreshWalletBalanceAndShowDelta(params) {
  const {
    beforeBalance,
    challenge = null,
    syncWalletSummary,
    state,
    showResultSplash,
    audio = null
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
    const BIG_WIN_THRESHOLD = 250;
    const isBigWin = won && Math.abs(delta) >= BIG_WIN_THRESHOLD;
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
      if (isBigWin) {
        audio?.trigger('bigwin');
        showResultSplash(`YOU WIN${detail}\n+${Math.abs(delta).toFixed(2)}`, 'win', { big: true });
      } else {
        audio?.trigger('win');
        showResultSplash(`YOU WIN${detail}\n+${Math.abs(delta).toFixed(2)}`, 'win', { big: false });
      }
    } else if (lost) {
      showResultSplash(`YOU LOSE${detail}\n-${Math.abs(delta).toFixed(2)}`, 'loss');
      audio?.trigger('loss');
    } else {
      showResultSplash(`DRAW${detail}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, 'neutral');
      audio?.trigger('resolve');
    }
  }
}
