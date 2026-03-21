/**
 * Session leaderboard — tracks net USDC gain per player this session.
 * Updated client-side from resolved challenge events.
 */

export function updateLeaderboardFromResolution({ state, challenge }) {
  if (!challenge || challenge.status !== 'resolved') return;
  if (!state.leaderboard) state.leaderboard = {};

  const wager = Number(challenge.wager || 0);
  const winnerId = challenge.winnerId;
  const isDraw = !winnerId;

  for (const pid of [challenge.challengerId, challenge.opponentId]) {
    if (!pid || pid === 'system_house') continue;
    const displayName = state.players?.get?.(pid)?.displayName || pid.slice(0, 8);
    if (!state.leaderboard[pid]) {
      state.leaderboard[pid] = { displayName, netGain: 0 };
    }
    state.leaderboard[pid].displayName = displayName;
    if (!isDraw) {
      state.leaderboard[pid].netGain += pid === winnerId ? wager : -wager;
    }
  }
}

function makeEntry(rank, displayName, netGain, isMe) {
  const li = document.createElement('li');
  li.className = [
    'leaderboard-entry',
    isMe ? 'leaderboard-entry--me' : '',
    netGain > 0 ? 'leaderboard-entry--pos' : netGain < 0 ? 'leaderboard-entry--neg' : ''
  ].filter(Boolean).join(' ');

  const rankEl = document.createElement('span');
  rankEl.className = 'lb-rank';
  rankEl.textContent = String(rank);

  const nameEl = document.createElement('span');
  nameEl.className = 'lb-name';
  nameEl.textContent = displayName;

  const gainEl = document.createElement('span');
  gainEl.className = 'lb-gain';
  gainEl.textContent = netGain >= 0
    ? `+$${netGain.toFixed(2)}`
    : `-$${Math.abs(netGain).toFixed(2)}`;

  li.appendChild(rankEl);
  li.appendChild(nameEl);
  li.appendChild(gainEl);
  return li;
}

export function renderLeaderboard(state, el, currentPlayerId) {
  if (!el) return;
  const entries = Object.entries(state.leaderboard || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.netGain - a.netGain)
    .slice(0, 5);

  while (el.firstChild) el.removeChild(el.firstChild);

  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'No rounds yet';
    el.appendChild(empty);
    return;
  }

  entries.forEach((e, i) => {
    el.appendChild(makeEntry(i + 1, e.displayName, e.netGain, e.id === currentPlayerId));
  });
}
