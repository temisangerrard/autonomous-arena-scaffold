export const rpsGamePlugin = {
  gameType: 'rps',
  moveSchema: { moves: ['rock', 'paper', 'scissors'] },
  renderMoveControls() {
    return '<button data-move="rock">Rock</button><button data-move="paper">Paper</button><button data-move="scissors">Scissors</button>';
  },
  validateMove(move) {
    return move === 'rock' || move === 'paper' || move === 'scissors';
  },
  describeStatus(ctx) {
    return ctx?.activeChallenge ? 'Choose Rock, Paper, or Scissors.' : 'RPS ready.';
  }
};
