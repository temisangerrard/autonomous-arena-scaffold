import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer,
  DEALER_PREFLIGHT_TIMEOUT_MS,
  DEALER_PICK_TIMEOUT_MS
} from './helpers.js';

export function mountCoinflipPanel(params) {
  const { state, stationUi, station, sendStationInteract, makePlayerSeed, showToast } = params;

  state.ui.dealer.gameType = 'coinflip';
  const curWager = Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)));
  stationUi.innerHTML = `
    <div class="game-panel">
      <div class="game-header-card">
        <div class="game-panel__title">Coinflip</div>
        <div class="game-panel__rule">Pick your side before time runs out.</div>
      </div>
      <div class="game-panel__wager-row">
        <label class="game-panel__wager-label" for="station-wager">Wager <span class="game-panel__currency">USDC</span></label>
        <input class="game-panel__wager-input" id="station-wager" type="number" min="0" max="10000" step="1" value="${curWager}" />
      </div>
      <div class="game-panel__stage" id="station-stage">
        <button id="station-house-start" class="game-panel__play-btn" type="button">
          <span class="game-panel__play-icon">▶</span> Start Round
        </button>
      </div>
      <div class="game-panel__picks" id="station-pick-actions" style="display:none;">
        <button id="station-house-heads" class="game-panel__pick-btn" data-pick="heads" type="button">
          <span class="game-panel__pick-icon">🪙</span><span class="game-panel__pick-label">Heads</span>
        </button>
        <button id="station-house-tails" class="game-panel__pick-btn" data-pick="tails" type="button">
          <span class="game-panel__pick-icon">🔄</span><span class="game-panel__pick-label">Tails</span>
        </button>
      </div>
      <div class="game-panel__status" id="station-status">Choose your wager and press Play.</div>
    </div>
  `;

  const wagerEl = document.getElementById('station-wager');
  const startBtn = document.getElementById('station-house-start');
  const headsBtn = document.getElementById('station-house-heads');
  const tailsBtn = document.getElementById('station-house-tails');
  const pickActions = document.getElementById('station-pick-actions');
  const stageEl = document.getElementById('station-stage');
  const statusEl = document.getElementById('station-status');

  function dealerStationMatches(st) {
    const dsid = String(state.ui.dealer.stationId || '');
    return dsid === st.id || dsid === String(st.proxyStationId || '');
  }

  function setGameStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  function setPicksLocked(locked) {
    if (headsBtn) headsBtn.disabled = locked;
    if (tailsBtn) tailsBtn.disabled = locked;
  }

  function onCoinflipTimeout() {
    clearTimer('dealer:pick');
    state.ui.dealer.state = 'error';
    state.ui.dealer.reasonText = 'No server response. Try again.';
    clearPendingBtn(startBtn, '▶ Play');
    flashBtn(startBtn, 'is-failed');
    clearPendingBtn(headsBtn, 'Heads');
    clearPendingBtn(tailsBtn, 'Tails');
    setPicksLocked(false);
    setGameStatus('No server response. Try again.', 'error');
    showToast?.('Station timed out. Retry.', 'error');
  }

  function sendStart() {
    const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
    if (!sendStationInteract(station, 'coinflip_house_start', { wager })) return;
    state.ui.dealer.state = 'preflight';
    state.ui.dealer.wager = wager;
    setPendingBtn(startBtn, 'Locking in…');
    setPicksLocked(true);
    setGameStatus('Locking in…', 'loading');
    startTimer('dealer:preflight', onCoinflipTimeout, DEALER_PREFLIGHT_TIMEOUT_MS);
  }

  function sendPick(pick) {
    if (!sendStationInteract(station, 'coinflip_house_pick', { pick, playerSeed: makePlayerSeed() })) return;
    clearTimer('dealer:preflight');
    state.ui.dealer.state = 'dealing';
    setPicksLocked(true);
    setGameStatus(`Flipping… you picked ${pick.toUpperCase()}`, 'loading');
    startTimer('dealer:pick', onCoinflipTimeout, DEALER_PICK_TIMEOUT_MS);
  }

  if (startBtn) startBtn.onclick = () => sendStart();
  if (headsBtn) headsBtn.onclick = () => { setPendingBtn(headsBtn, 'Heads…'); sendPick('heads'); };
  if (tailsBtn) tailsBtn.onclick = () => { setPendingBtn(tailsBtn, 'Tails…'); sendPick('tails'); };
}

export function updateCoinflipLive(params) {
  const { state, station, renderDealerRevealStatus, setPendingBtn, clearPendingBtn, flashBtn, clearTimer } = params;

  function dealerStationMatches(st) {
    const dsid = String(state.ui.dealer.stationId || '');
    return dsid === st.id || dsid === String(st.proxyStationId || '');
  }

  const pickActions = document.getElementById('station-pick-actions');
  const stageEl = document.getElementById('station-stage');
  const statusEl = document.getElementById('station-status');
  const startBtn = document.getElementById('station-house-start');
  const headsBtn = document.getElementById('station-house-heads');
  const tailsBtn = document.getElementById('station-house-tails');

  function setLiveStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  const ds = state.ui.dealer.state;
  if (ds !== 'preflight') clearTimer('dealer:preflight');
  if (ds !== 'reveal' && statusEl) delete statusEl.dataset.revealKey;

  if (ds === 'ready' && dealerStationMatches(station)) {
    if (startBtn) { startBtn.disabled = false; delete startBtn.dataset.panelState; }
    if (headsBtn) headsBtn.disabled = false;
    if (tailsBtn) tailsBtn.disabled = false;
    if (stageEl) stageEl.style.display = 'none';
    if (pickActions) pickActions.style.display = 'flex';
    setLiveStatus('Choose your side — Heads or Tails!', 'prompt');
  } else if (ds === 'preflight') {
    if (startBtn) { startBtn.disabled = true; delete startBtn.dataset.panelState; }
    if (headsBtn) headsBtn.disabled = true;
    if (tailsBtn) tailsBtn.disabled = true;
    if (pickActions) pickActions.style.display = 'none';
    setLiveStatus('Locking in…', 'loading');
  } else if (ds === 'dealing') {
    if (startBtn) { startBtn.disabled = true; delete startBtn.dataset.panelState; }
    if (headsBtn) headsBtn.disabled = true;
    if (tailsBtn) tailsBtn.disabled = true;
    if (stageEl) stageEl.style.display = 'none';
    if (pickActions) pickActions.style.display = 'flex';
    setLiveStatus('Flipping…', 'loading');
  } else if (ds === 'error') {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (startBtn) delete startBtn.dataset.panelState;
    clearPendingBtn(startBtn, '▶ Play');
    flashBtn(startBtn, 'is-failed');
    clearPendingBtn(headsBtn, 'Heads');
    clearPendingBtn(tailsBtn, 'Tails');
    if (pickActions) pickActions.style.display = 'none';
    setLiveStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
  } else if (ds === 'reveal') {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (startBtn && startBtn.dataset.panelState !== 'reveal') {
      clearPendingBtn(startBtn, '▶ Play Again');
      startBtn.innerHTML = '<span class="game-panel__play-icon">▶</span> Play Again';
      flashBtn(startBtn, 'is-success');
      startBtn.dataset.panelState = 'reveal';
    }
    clearPendingBtn(headsBtn, 'Heads');
    clearPendingBtn(tailsBtn, 'Tails');
    if (pickActions) pickActions.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    if (statusEl) {
      const delta = Number(state.ui.dealer.payoutDelta || 0);
      const tone = delta > 0 ? 'success' : delta < 0 ? 'error' : '';
      const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
      const revealKey = `${state.ui.dealer.playerPick}|${state.ui.dealer.coinflipResult}|${delta}|${tx}`;
      if (statusEl.dataset.revealKey !== revealKey) {
        statusEl.dataset.revealKey = revealKey;
        statusEl.className = `game-panel__status${tone ? ` game-panel__status--${tone}` : ''}`;
        renderDealerRevealStatus(statusEl, {
          gameType: state.ui.dealer.gameType,
          playerPick: state.ui.dealer.playerPick,
          opponentPick: state.ui.dealer.opponentPick,
          coinflipResult: state.ui.dealer.coinflipResult,
          delta,
          txHash: tx,
          walletBalance: state.walletBalance,
          chainId: state.walletChainId
        });
      }
    }
  }
}
