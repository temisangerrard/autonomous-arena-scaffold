export const rpsGamePlugin = {
  gameType: 'rps',
  moveSchema: { moves: ['rock', 'paper', 'scissors'] },
  validateMove(move) {
    return move === 'rock' || move === 'paper' || move === 'scissors';
  },
  describeStatus(ctx) {
    return ctx?.activeChallenge ? 'Choose Rock, Paper, or Scissors.' : 'RPS ready.';
  }
};
