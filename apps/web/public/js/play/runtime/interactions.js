export function describeInteractionPhase(state) {
  if (state.activeChallenge?.status === 'resolved') return 'resolved';
  if (state.activeChallenge?.status === 'active') {
    const iAmChallenger = state.activeChallenge.challengerId === state.playerId;
    const myMove = iAmChallenger ? state.activeChallenge.challengerMove : state.activeChallenge.opponentMove;
    return myMove ? 'move_submitted' : 'move_pending';
  }
  if (state.outgoingChallengeId) return 'challenge_sent';
  if (state.ui?.targetId) return 'targeted';
  if (state.nearbyIds.size > 0 || state.nearbyStationIds.size > 0) return 'nearby';
  return 'idle';
}
