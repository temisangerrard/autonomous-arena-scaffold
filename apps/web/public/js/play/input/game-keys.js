export function handleGameKeyDown(event, state, actions) {
  const context = actions.computeControlContext?.() ?? '';
  const sendMove = actions.sendGameMove;

  if (event.code === 'KeyH') {
    if (context !== 'active_coinflip' && context !== 'dealer_ready_coinflip') return false;
    event.preventDefault();
    sendMove?.('heads');
    return true;
  }
  if (event.code === 'KeyT') {
    if (context !== 'active_coinflip' && context !== 'dealer_ready_coinflip') return false;
    event.preventDefault();
    sendMove?.('tails');
    return true;
  }
  if (event.code === 'Digit1') {
    if (context === 'active_dice_duel' || context === 'dealer_ready_dice_duel') {
      event.preventDefault();
      sendMove?.('d1');
      return true;
    }
    event.preventDefault();
    sendMove?.('rock');
    return true;
  }
  if (event.code === 'Digit2') {
    if (context === 'active_dice_duel' || context === 'dealer_ready_dice_duel') {
      event.preventDefault();
      sendMove?.('d2');
      return true;
    }
    event.preventDefault();
    sendMove?.('paper');
    return true;
  }
  if (event.code === 'Digit3') {
    if (context === 'active_dice_duel' || context === 'dealer_ready_dice_duel') {
      event.preventDefault();
      sendMove?.('d3');
      return true;
    }
    event.preventDefault();
    sendMove?.('scissors');
    return true;
  }
  if (event.code === 'Digit4') {
    if (context !== 'active_dice_duel' && context !== 'dealer_ready_dice_duel') return false;
    event.preventDefault();
    sendMove?.('d4');
    return true;
  }
  if (event.code === 'Digit5') {
    if (context !== 'active_dice_duel' && context !== 'dealer_ready_dice_duel') return false;
    event.preventDefault();
    sendMove?.('d5');
    return true;
  }
  if (event.code === 'Digit6') {
    if (context !== 'active_dice_duel' && context !== 'dealer_ready_dice_duel') return false;
    event.preventDefault();
    sendMove?.('d6');
    return true;
  }
  if (event.code === 'KeyC' && actions.canUseChallengeHotkeys?.()) {
    event.preventDefault();
    actions.sendChallenge?.();
    return true;
  }
  if (event.code === 'KeyY' && actions.canUseChallengeHotkeys?.()) {
    event.preventDefault();
    actions.respondToIncoming?.(true);
    return true;
  }
  if (event.code === 'KeyN' && actions.canUseChallengeHotkeys?.()) {
    event.preventDefault();
    actions.respondToIncoming?.(false);
    return true;
  }
  return false;
}
