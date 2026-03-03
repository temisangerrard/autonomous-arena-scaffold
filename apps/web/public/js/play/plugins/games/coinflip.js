export const coinflipGamePlugin = {
  gameType: 'coinflip',
  moveSchema: { moves: ['heads', 'tails'] },
  validateMove(move) {
    return move === 'heads' || move === 'tails';
  },
  describeStatus() {
    return 'Pick heads or tails.';
  }
};
