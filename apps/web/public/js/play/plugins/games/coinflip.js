export const coinflipGamePlugin = {
  gameType: 'coinflip',
  moveSchema: { moves: ['heads', 'tails'] },
  renderMoveControls() {
    return '<button data-move="heads">Heads</button><button data-move="tails">Tails</button>';
  },
  validateMove(move) {
    return move === 'heads' || move === 'tails';
  },
  describeStatus() {
    return 'Pick heads or tails.';
  }
};
