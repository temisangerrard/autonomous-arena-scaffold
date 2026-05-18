import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer,
  DEALER_PREFLIGHT_TIMEOUT_MS,
  DEALER_PICK_TIMEOUT_MS
} from './helpers.js';

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let _diceAnimInterval = null;

function clearDiceAnimInterval() {
  if (_diceAnimInterval !== null) {
    clearInterval(_diceAnimInterval);
    _diceAnimInterval = null;
  }
}

export function mountRpsDicePanel(params) {
  const { state, stationUi, station, sendStationInteract, makePlayerSeed, showToast } = params;
  const isRps = station.kind === 'dealer_rps';

  state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
  const startAction = isRps ? 'rps_house_start' : 'dice_duel_start';
  const pickAction = isRps ? 'rps_house_pick' : 'dice_duel_pick';
  const curWager = Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)));

  const pickButtonsHtml = isRps
    ? `<button id="station-house-r" class="game-panel__pick-btn" data-pick="rock" type="button"><span class="game-panel__pick-icon">🪨</span><span class="game-panel__pick-label">Rock</span></button>
       <button id="station-house-p" class="game-panel__pick-btn" data-pick="paper" type="button"><span class="game-panel__pick-icon">📄</span><span class="game-panel__pick-label">Paper</span></button>
       <button id="station-house-s" class="game-panel__pick-btn" data-pick="scissors" type="button"><span class="game-panel__pick-icon">✂️</span><span class="game-panel__pick-label">Scissors</span></button>`
    : `<button id="station-house-d1" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d1" type="button">⚀</button>
       <button id="station-house-d2" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d2" type="button">⚁</button>
       <button id="station-house-d3" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d3" type="button">⚂</button>
       <button id="station-house-d4" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d4" type="button">⚃</button>
       <button id="station-house-d5" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d5" type="button">⚄</button>
       <button id="station-house-d6" class="game-panel__pick-btn game-panel__pick-btn--die" data-pick="d6" type="button">⚅</button>`;

  stationUi.innerHTML = `
    <div class="game-panel">
      <div class="game-header-card">
        <div class="game-panel__title">${isRps ? 'Rock Paper Scissors' : 'Dice Duel'}</div>
        <div class="game-panel__rule">${isRps ? 'Start the round, then throw your move.' : 'Pick the face you think will land.'}</div>
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
      <div class="game-panel__picks${isRps ? '' : ' game-panel__picks--dice'}" id="station-pick-actions" style="display:none;">
        ${pickButtonsHtml}
      </div>
      <div class="game-panel__status" id="station-status">Choose your wager and press Play.</div>
    </div>
  `;

  const wagerEl = document.getElementById('station-wager');
  const startBtn = document.getElementById('station-house-start');
  const pickActions = document.getElementById('station-pick-actions');
  const stageEl = document.getElementById('station-stage');
  const statusEl = document.getElementById('station-status');

  function setGameStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  function setAllPicksLocked(locked) {
    if (!pickActions) return;
    for (const btn of pickActions.querySelectorAll('button')) {
      btn.disabled = locked;
    }
  }

  function injectLockAnim() {
    if (!stageEl || !document.createElement) return;
    if (stageEl.querySelector?.('.rps-think, .dice-roll')) return;
    if (isRps) {
      const el = document.createElement('div');
      el.className = 'rps-think';
      el.appendChild?.(document.createElement('span'));
      el.appendChild?.(document.createElement('span'));
      el.appendChild?.(document.createElement('span'));
      stageEl.appendChild?.(el);
    } else {
      const el = document.createElement('div');
      el.className = 'dice-roll';
      el.id = 'dice-anim';
      el.textContent = DICE_FACES[0];
      stageEl.appendChild?.(el);
      let faceIdx = 0;
      clearDiceAnimInterval();
      _diceAnimInterval = setInterval(() => {
        faceIdx = (faceIdx + 1) % DICE_FACES.length;
        const animEl = document.getElementById('dice-anim');
        if (animEl) animEl.textContent = DICE_FACES[faceIdx];
        else clearDiceAnimInterval();
      }, 250);
    }
    stageEl.style.display = 'flex';
  }

  function clearLockAnim() {
    clearDiceAnimInterval();
    if (!stageEl) return;
    const rpsEl = stageEl.querySelector?.('.rps-think');
    if (rpsEl) rpsEl.remove?.();
    const diceEl = stageEl.querySelector?.('.dice-roll');
    if (diceEl) diceEl.remove?.();
  }

  function onRpsTimeout() {
    clearLockAnim();
    clearTimer('dealer:pick');
    state.ui.dealer.state = 'error';
    state.ui.dealer.reasonText = 'No server response. Try again.';
    clearPendingBtn(startBtn, '▶ Play');
    flashBtn(startBtn, 'is-failed');
    const ids = isRps ? ['station-house-r', 'station-house-p', 'station-house-s'] : ['station-house-d1', 'station-house-d2', 'station-house-d3', 'station-house-d4', 'station-house-d5', 'station-house-d6'];
    for (const id of ids) {
      const b = document.getElementById(id);
      if (b) { clearPendingBtn(b); b.disabled = false; }
    }
    setGameStatus('No server response. Try again.', 'error');
    showToast?.('Station timed out. Retry.', 'error');
  }

  if (startBtn) {
    startBtn.onclick = () => {
      void (async () => {
      const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
      if (!await sendStationInteract(station, startAction, { wager })) return;
      state.ui.dealer.state = 'preflight';
      state.ui.dealer.wager = wager;
      state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
      setPendingBtn(startBtn, 'Locking in…');
      setGameStatus('Locking in…', 'loading');
      injectLockAnim();
      startTimer('dealer:preflight', onRpsTimeout, DEALER_PREFLIGHT_TIMEOUT_MS);
      })();
    };
  }

  const picks = isRps ? ['rock', 'paper', 'scissors'] : ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  for (const pick of picks) {
    const btnId = isRps ? `station-house-${pick.charAt(0)}` : `station-house-${pick}`;
    const btn = document.getElementById(btnId);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.onclick = () => {
      void (async () => {
      if (!await sendStationInteract(station, pickAction, { pick, playerSeed: makePlayerSeed() })) return;
      clearLockAnim();
      clearTimer('dealer:preflight');
      state.ui.dealer.state = 'dealing';
      setPendingBtn(btn, isRps ? `${pick.charAt(0).toUpperCase()}…` : `${pick.replace('d', '')}…`);
      setAllPicksLocked(true);
      setGameStatus(`You picked ${isRps ? pick : pick.replace('d', '')} — rolling…`, 'loading');
      startTimer('dealer:pick', onRpsTimeout, DEALER_PICK_TIMEOUT_MS);
      })();
    };
  }
}

export function updateRpsDiceLive(params) {
  const { state, station, renderDealerRevealStatus, clearPendingBtn, flashBtn, clearTimer } = params;
  const isRps = station.kind === 'dealer_rps';

  function dealerStationMatches(st) {
    const dsid = String(state.ui.dealer.stationId || '');
    return dsid === st.id || dsid === String(st.proxyStationId || '');
  }

  const pickActions = document.getElementById('station-pick-actions');
  const stageEl = document.getElementById('station-stage');
  const statusEl = document.getElementById('station-status');
  const startBtn = document.getElementById('station-house-start');
  const allPickIds = isRps ? ['station-house-r', 'station-house-p', 'station-house-s'] : ['station-house-d1', 'station-house-d2', 'station-house-d3', 'station-house-d4', 'station-house-d5', 'station-house-d6'];

  function setAllPicksBtnDisabled(disabled) {
    for (const id of allPickIds) {
      const btn = document.getElementById(id);
      if (btn instanceof HTMLButtonElement) btn.disabled = disabled;
    }
  }

  function setLiveStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  function clearLockAnimLive() {
    clearDiceAnimInterval();
    if (!stageEl) return;
    const rpsEl = stageEl.querySelector?.('.rps-think');
    if (rpsEl) rpsEl.remove?.();
    const diceEl = stageEl.querySelector?.('.dice-roll');
    if (diceEl) diceEl.remove?.();
  }

  const ds = state.ui.dealer.state;
  if (ds !== 'preflight') clearTimer('dealer:preflight');
  if (ds !== 'reveal' && statusEl) delete statusEl.dataset.revealKey;

  if (ds === 'ready' && dealerStationMatches(station)) {
    clearLockAnimLive();
    if (startBtn) { startBtn.disabled = false; delete startBtn.dataset.panelState; }
    setAllPicksBtnDisabled(false);
    if (stageEl) stageEl.style.display = 'none';
    if (pickActions) pickActions.style.display = 'flex';
    setLiveStatus(isRps ? 'Pick Rock, Paper, or Scissors!' : 'Pick your number!', 'prompt');
  } else if (ds === 'preflight') {
    if (startBtn) { startBtn.disabled = true; delete startBtn.dataset.panelState; }
    setAllPicksBtnDisabled(true);
    if (pickActions) pickActions.style.display = 'none';
    setLiveStatus('Locking in…', 'loading');
  } else if (ds === 'dealing') {
    clearLockAnimLive();
    if (startBtn) { startBtn.disabled = true; delete startBtn.dataset.panelState; }
    setAllPicksBtnDisabled(true);
    if (stageEl) stageEl.style.display = 'none';
    if (pickActions) pickActions.style.display = 'flex';
    setLiveStatus(isRps ? 'Waiting for result…' : 'Rolling…', 'loading');
  } else if (ds === 'error') {
    clearLockAnimLive();
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (startBtn) delete startBtn.dataset.panelState;
    clearPendingBtn(startBtn, '▶ Play');
    flashBtn(startBtn, 'is-failed');
    for (const id of allPickIds) { const b = document.getElementById(id); if (b) clearPendingBtn(b); }
    setAllPicksBtnDisabled(false);
    if (pickActions) pickActions.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    setLiveStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
  } else if (ds === 'reveal') {
    clearLockAnimLive();
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (startBtn && startBtn.dataset.panelState !== 'reveal') {
      clearPendingBtn(startBtn, '▶ Play Again');
      startBtn.innerHTML = '<span class="game-panel__play-icon">▶</span> Play Again';
      flashBtn(startBtn, 'is-success');
      startBtn.dataset.panelState = 'reveal';
    }
    for (const id of allPickIds) { const b = document.getElementById(id); if (b) clearPendingBtn(b); }
    setAllPicksBtnDisabled(false);
    if (pickActions) pickActions.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    if (statusEl) {
      const delta = Number(state.ui.dealer.payoutDelta || 0);
      const tone = delta > 0 ? 'success' : delta < 0 ? 'error' : '';
      const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
      const revealKey = `${state.ui.dealer.playerPick}|${state.ui.dealer.opponentPick}|${delta}|${tx}`;
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
