export function sendGameMoveRuntime(params) {
  const {
    move,
    state,
    socket,
    resolveStationIdForSend,
    makePlayerSeed,
    showToast
  } = params;
  function moveAllowedForGameType(gameType, candidateMove) {
    if (gameType === 'rps') {
      return candidateMove === 'rock' || candidateMove === 'paper' || candidateMove === 'scissors';
    }
    if (gameType === 'coinflip') {
      return candidateMove === 'heads' || candidateMove === 'tails';
    }
    if (gameType === 'dice_duel') {
      return candidateMove === 'd1'
        || candidateMove === 'd2'
        || candidateMove === 'd3'
        || candidateMove === 'd4'
        || candidateMove === 'd5'
        || candidateMove === 'd6';
    }
    return false;
  }

  const isDealerMove = move === 'heads'
    || move === 'tails'
    || move === 'rock'
    || move === 'paper'
    || move === 'scissors'
    || move === 'd1'
    || move === 'd2'
    || move === 'd3'
    || move === 'd4'
    || move === 'd5'
    || move === 'd6';
  if (
    isDealerMove
    && state.ui.interactOpen
    && state.ui.interactionMode === 'station'
    && state.ui.dealer.state === 'ready'
    && state.ui.dealer.stationId
    && socket
    && socket.readyState === WebSocket.OPEN
  ) {
    let action = '';
    if (state.ui.dealer.gameType === 'rps') {
      action = 'rps_house_pick';
    } else if (state.ui.dealer.gameType === 'dice_duel') {
      action = 'dice_duel_pick';
    } else if (state.ui.dealer.gameType === 'coinflip') {
      action = 'coinflip_house_pick';
    } else {
      showToast('Dealer game mode unavailable. Re-open the station and retry.', 'warning');
      return;
    }
    if (!moveAllowedForGameType(state.ui.dealer.gameType, move)) {
      showToast(`Invalid ${String(move).toUpperCase()} for ${String(state.ui.dealer.gameType || 'dealer').toUpperCase()}.`, 'warning');
      return;
    }
    const routedStationId = resolveStationIdForSend(state.ui.dealer.stationId);
    if (!routedStationId) {
      showToast('Station unavailable.');
      return;
    }
    socket.send(
      JSON.stringify({
        type: 'station_interact',
        stationId: routedStationId,
        action,
        pick: move,
        playerSeed: makePlayerSeed()
      })
    );
    state.ui.dealer.state = 'dealing';
    const gameLabel = state.ui.dealer.gameType === 'rps'
      ? 'RPS'
      : state.ui.dealer.gameType === 'dice_duel'
        ? 'Dice Duel'
        : 'Coinflip';
    state.challengeMessage = `${gameLabel} dealing... ${move.toUpperCase()} selected.`;
    state.quickstart.moveSubmitted = true;
    return;
  }

  const challenge = state.activeChallenge;
  if (!challenge || !socket || socket.readyState !== WebSocket.OPEN) {
    state.challengeMessage = 'No active match right now.';
    return;
  }
  if (challenge.gameType === 'rps' && move !== 'rock' && move !== 'paper' && move !== 'scissors') {
    return;
  }
  if (challenge.gameType === 'coinflip' && move !== 'heads' && move !== 'tails') {
    return;
  }
  if (
    challenge.gameType === 'dice_duel'
    && move !== 'd1'
    && move !== 'd2'
    && move !== 'd3'
    && move !== 'd4'
    && move !== 'd5'
    && move !== 'd6'
  ) {
    return;
  }

  const iAmChallenger = challenge.challengerId === state.playerId;
  const iAmOpponent = challenge.opponentId === state.playerId;
  if (!iAmChallenger && !iAmOpponent) {
    return;
  }

  const myMove = iAmChallenger ? challenge.challengerMove : challenge.opponentMove;
  if (myMove) {
    state.challengeMessage = `Move already submitted (${myMove})`;
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'challenge_move',
      challengeId: challenge.id,
      move
    })
  );

  state.challengeMessage = `Submitted move: ${move}`;
  state.quickstart.moveSubmitted = true;
}
