export const diceDuelGamePlugin = {
  gameType: 'dice_duel',
  moveSchema: { moves: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] },
  validateMove(move) {
    return ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].includes(move);
  },
  describeStatus() {
    return 'Pick a dice face 1-6.';
  }
};
