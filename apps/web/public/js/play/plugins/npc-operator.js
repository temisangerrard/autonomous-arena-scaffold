export const dealerOperatorNpcPlugin = {
  npcRole: 'dealer_operator',
  stationKinds: ['dealer_coinflip', 'dealer_rps', 'dealer_dice_duel', 'dealer_prediction'],
  decidePrompt(ctx) {
    const stationName = ctx?.stationName || 'dealer station';
    return `I can run ${stationName}. Open interaction and pick your wager.`;
  },
  decideAutoAction() {
    return null;
  }
};
