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
      label: 'Enter the Arena',
      hint: connected ? 'You\'re in.' : 'Connecting…'
    },
    {
      done: nearStation,
      label: 'Find a dealer',
      hint: nearStation ? 'Station nearby.' : 'Walk toward a character — press E when prompted.'
    },
    {
      done: state.quickstart.challengeSent,
      label: 'Play your first round',
      hint: state.quickstart.challengeSent ? 'Round started.' : 'Set a wager and hit Play inside the station panel.'
    },
    {
      done: state.quickstart.matchActive,
      label: 'Lock in your move',
      hint: state.quickstart.matchActive ? 'Move submitted.' : 'Pick your side — the house locks in instantly.'
    },
    {
      done: state.quickstart.matchResolved,
      label: 'Collect your result',
      hint: state.quickstart.matchResolved ? 'Payout settled on-chain.' : 'The escrow reveals and settles automatically.'
    }
  ];
  const allDone = steps.every((s) => s.done);
  quickstartList.innerHTML = steps
    .map((step) => `
      <li class="qs-step${step.done ? ' qs-step--done' : ''}">
        <span class="qs-step__check">${step.done ? 'OK' : '--'}</span>
        <span class="qs-step__body">
          <span class="qs-step__label">${step.label}</span>
          <span class="qs-step__hint">${step.hint}</span>
        </span>
      </li>`)
    .join('');
  if (allDone) {
    quickstartList.insertAdjacentHTML('beforeend',
      '<li class="qs-complete">You know how this works now. Good luck out there.</li>'
    );
  }
}
