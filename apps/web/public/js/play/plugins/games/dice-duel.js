export const diceDuelGamePlugin = {
  gameType: 'dice_duel',
  moveSchema: { moves: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] },
  renderMoveControls() {
    return '<button data-move="d1">1</button><button data-move="d2">2</button><button data-move="d3">3</button><button data-move="d4">4</button><button data-move="d5">5</button><button data-move="d6">6</button>';
  },
  validateMove(move) {
    return ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].includes(move);
  },
  describeStatus() {
    return 'Pick a dice face 1-6.';
  }
};
