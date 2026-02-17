export function renderQuickstart(state, quickstartPanel, quickstartList) {
  if (!quickstartPanel || !quickstartList) return;
  if (state.quickstart.dismissed) {
    quickstartPanel.style.display = 'none';
    return;
  }
  const steps = [
    { done: Boolean(state.playerId && state.wsConnected), text: 'Connected to arena server' },
    { done: state.nearbyStationIds.size > 0, text: 'Find a nearby station' },
    { done: state.quickstart.challengeSent, text: 'Start a dealer round (E)' },
    { done: state.quickstart.matchActive, text: 'Dealer confirms your pick' },
    { done: state.quickstart.matchResolved, text: 'Result revealed and payout posted' }
  ];
  quickstartList.innerHTML = steps
    .map((step) => `<li class="${step.done ? 'done' : ''}">${step.done ? '✓' : '○'} ${step.text}</li>`)
    .join('');
}
