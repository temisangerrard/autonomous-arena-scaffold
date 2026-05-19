export function renderQuickstart(state, quickstartPanel, quickstartList) {
  if (!quickstartPanel || !quickstartList) return;
  if (state.quickstart.dismissed) {
    quickstartPanel.style.display = 'none';
    return;
  }
  const connected = Boolean(state.playerId && state.wsConnected);
  const nearStation = state.nearbyStationIds.size > 0;
  const steps = [
    {
      done: connected,
      label: 'You\'re in the Arena',
      hint: connected ? 'Connected — walk around to explore.' : 'Connecting to server…'
    },
    {
      done: nearStation,
      label: 'Walk up to a dealer',
      hint: nearStation ? 'Dealer nearby — press E to open.' : 'Move toward any character until a prompt appears.'
    },
    {
      done: state.quickstart.challengeSent,
      label: 'Start a game',
      hint: state.quickstart.challengeSent ? 'Round started — pick your move!' : 'Open a station, set your wager, and hit Play.'
    },
    {
      done: state.quickstart.matchActive,
      label: 'Pick your side',
      hint: state.quickstart.matchActive ? 'Move locked in.' : 'Tap or click your choice — Heads/Tails, Rock/Paper/Scissors, or a dice number.'
    },
    {
      done: state.quickstart.matchResolved,
      label: 'Collect your winnings',
      hint: state.quickstart.matchResolved ? 'Result posted.' : 'The result reveals automatically and your balance updates instantly.'
    }
  ];
  const allDone = steps.every((s) => s.done);
  quickstartList.innerHTML = steps
    .map((step) => `
      <li class="qs-step${step.done ? ' qs-step--done' : ''}">
        <span class="qs-step__check" aria-hidden="true">${step.done ? '✓' : '○'}</span>
        <span class="qs-step__body">
          <span class="qs-step__label">${step.label}</span>
          <span class="qs-step__hint">${step.hint}</span>
        </span>
      </li>`)
    .join('');
  if (allDone) {
    quickstartList.insertAdjacentHTML('beforeend',
      '<li class="qs-complete">You\'ve got the hang of it. Go win some more. 🏆</li>'
    );
  }
}
