/* ── Button action feedback helpers ──────────────────────── */
const _actionTimers = new Map();

function _startTimer(key, onTimeout, ms) {
  _clearTimer(key);
  _actionTimers.set(key, setTimeout(() => { _actionTimers.delete(key); onTimeout(); }, ms));
}

function _clearTimer(key) {
  const id = _actionTimers.get(key);
  if (id !== undefined) { clearTimeout(id); _actionTimers.delete(key); }
}

/** Disable a button, store its current text, show pending label, add .is-pending */
function setPendingBtn(el, pendingText) {
  if (!el) return;
  if (!el.dataset.origText) el.dataset.origText = el.textContent.trim();
  el.textContent = pendingText;
  el.classList.add('is-pending');
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
}

/** Re-enable a button, restore original text, remove feedback classes */
function clearPendingBtn(el, fallback) {
  if (!el) return;
  const orig = el.dataset.origText;
  el.textContent = (orig && orig.length > 0) ? orig : (fallback || el.textContent);
  delete el.dataset.origText;
  el.classList.remove('is-pending', 'is-success', 'is-failed');
  el.disabled = false;
  el.removeAttribute('aria-busy');
}

/** Briefly flash .is-success or .is-failed on a button */
function flashBtn(el, cls, ms = 700) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

export function renderInteractionCardTemplate(params) {
  const {
    state,
    interactionCard,
    interactionTitle,
    interactionHelpToggle,
    interactionHelp,
    interactionNpcInfo,
    stationUi,
    stateful,
    setInteractOpen,
    getUiTargetId,
    isStation,
    labelFor,
    challengeController,
    normalizedChallengeGameType,
    normalizedChallengeWager,
    formatWagerInline,
    formatUsdAmount,
    formatPredictionPrice,
    formatPredictionClose,
    buildSessionHeaders,
    syncWalletSummary,
    showToast,
    ensureEscrowApproval,
    sendStationInteract,
    renderGuideStationDetail,
    setStationStatus,
    renderDealerRevealStatus,
    makePlayerSeed,
    socket
  } = params;

  let interactionStationRenderKey = String(stateful?.interactionStationRenderKey || '');

  try {
  if (!interactionCard || !interactionTitle) {
    return;
  }
  const active = state.activeChallenge;
  const inMatch = Boolean(active && active.status === 'active');
  if (inMatch && state.ui.interactionMode !== 'station') {
    setInteractOpen(false);
    return;
  }
  if (!state.ui.interactOpen) {
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    setInteractOpen(false);
    return;
  }
  const station = isStation(targetId) && state.stations instanceof Map ? state.stations.get(targetId) : null;
  const targetPlayer = state.players.get(targetId);
  const showHelpToggle = Boolean(
    station
    && station.kind !== 'dealer_coinflip'
    && station.kind !== 'dealer_rps'
    && station.kind !== 'dealer_dice_duel'
    && station.kind !== 'dealer_prediction'
  );
  if (interactionHelpToggle) {
    interactionHelpToggle.hidden = !showHelpToggle;
  }
  if (interactionHelp) {
    if (!showHelpToggle) {
      interactionHelp.hidden = true;
      interactionHelpToggle?.setAttribute('aria-expanded', 'false');
    } else if (station?.kind === 'cashier_bank') {
      interactionHelp.innerHTML = 'Cashier lets you <strong>fund</strong>, <strong>withdraw</strong>, or <strong>transfer</strong>. Use small test amounts first.';
    } else {
      interactionHelp.innerHTML = 'This station supports local interactions. Press <strong>Inspect</strong> for context or <strong>Use</strong> for the primary action.';
    }
  }
  if (station && state.ui.interactionMode !== 'station') {
    state.ui.interactionMode = 'station';
  }
  if (!station && targetPlayer && state.ui.interactionMode !== 'player') {
    state.ui.interactionMode = 'player';
  }
  const stationRenderKey = station
    ? `${station.id}:${station.kind}:${station.proxyStationId || ''}:${station.proxyMissing ? 'missing' : 'ready'}`
    : '';

  if (interactionNpcInfo) {
    interactionNpcInfo.hidden = true;
  }
  if (!stationUi) {
    return;
  }

  if (station && state.ui.interactionMode === 'station') {
    interactionTitle.textContent = station.displayName || 'Station';
    stationUi.hidden = false;
    stationUi.style.display = 'grid';
    if (stationUi && interactionStationRenderKey !== stationRenderKey) {
      interactionStationRenderKey = stationRenderKey;
      stationUi.dataset.predictionMode = '';
      if (station.source === 'host' && station.proxyMissing) {
        stationUi.innerHTML = `
          <div class="station-ui__title">${station.displayName || 'Station'}</div>
          <div class="station-ui__meta station-ui__meta--warning">
            Station unavailable right now. Server station mapping is missing; retry shortly.
          </div>
        `;
        return;
      }
      // Returns true if the dealer state belongs to this station (handles proxy id mismatch)
      function dealerStationMatches(st) {
        const dsid = String(state.ui.dealer.stationId || '');
        return dsid === st.id || dsid === String(st.proxyStationId || '');
      }

      function resolvePredictionRouteStation(fromStation) {
        const allPredictionStations = state.stations instanceof Map
          ? [...state.stations.values()].filter((entry) => entry && entry.kind === 'dealer_prediction')
          : [];
        if (allPredictionStations.length === 0) return null;
        const explicitProxy = String(fromStation?.proxyStationId || '').trim();
        if (explicitProxy) {
          const proxied = allPredictionStations.find((entry) => entry.id === explicitProxy);
          if (proxied) return proxied;
        }
        const me = state.playerId ? state.players.get(state.playerId) : null;
        const originX = Number(me?.x ?? me?.displayX ?? fromStation?.x ?? 0);
        const originZ = Number(me?.z ?? me?.displayZ ?? fromStation?.z ?? 0);
        let best = allPredictionStations[0] || null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const entry of allPredictionStations) {
          const dist = Math.hypot(Number(entry.x || 0) - originX, Number(entry.z || 0) - originZ);
          const score = dist + (entry.source === 'server' ? 0 : 1000);
          if (score < bestScore) {
            best = entry;
            bestScore = score;
          }
        }
        return best;
      }

      function mountPredictionPanel(options = {}) {
        const routeStation = options.routeStation || station;
        const kioskMode = Boolean(options.kioskMode);
        const unavailable = !routeStation;
        stationUi.classList.remove('station-ui--npc');
        stationUi.dataset.predictionMode = kioskMode ? 'kiosk' : 'dealer';
        stationUi.innerHTML = `
          <div class="prediction-panel">
            <div class="prediction-header">
              <span class="prediction-header__source">Polymarket</span>
              <span class="prediction-header__label">${kioskMode ? 'Market board' : 'Live markets'}</span>
            </div>
            <div class="station-ui__row">
              <label for="prediction-market-select">Question</label>
              <select id="prediction-market-select"></select>
            </div>
            <div class="prediction-market-preview" id="prediction-market-preview" aria-live="polite"></div>
            <div class="station-ui__row">
              <label for="prediction-stake">Stake <span class="game-panel__currency">USDC</span></label>
              <input id="prediction-stake" type="number" min="1" max="10000" step="1" value="1" class="game-panel__wager-input" />
            </div>
            <div class="prediction-sides">
              <button id="prediction-buy-yes" class="prediction-side prediction-side--yes" type="button">YES</button>
              <button id="prediction-buy-no" class="prediction-side prediction-side--no" type="button">NO</button>
            </div>
            <div class="station-ui__meta" id="prediction-status">${unavailable ? 'No prediction dealer mapped from this station yet.' : 'Fetching markets…'}</div>
            <div class="station-ui__meta" id="prediction-quote-view" hidden></div>
            <div class="station-ui__meta" id="prediction-positions-view" hidden></div>
            <div class="station-ui__actions">
              <button id="prediction-quote" class="btn-ghost" type="button">Get quote</button>
              <button id="prediction-positions" class="btn-ghost" type="button">My positions</button>
              <button id="prediction-refresh" class="btn-ghost" type="button">Refresh</button>
            </div>
          </div>
        `;

        const selectEl = document.getElementById('prediction-market-select');
        const stakeEl = document.getElementById('prediction-stake');
        const refreshBtn = document.getElementById('prediction-refresh');
        const positionsBtn = document.getElementById('prediction-positions');
        const quoteBtn = document.getElementById('prediction-quote');
        const buyYesBtn = document.getElementById('prediction-buy-yes');
        const buyNoBtn = document.getElementById('prediction-buy-no');

        function currentMarketId() {
          if (selectEl instanceof HTMLSelectElement && selectEl.value) {
            state.ui.prediction.selectedMarketId = selectEl.value;
          }
          return String(state.ui.prediction.selectedMarketId || '');
        }

        function currentStake() {
          return Math.max(1, Math.min(10_000, Number(stakeEl?.value || 1)));
        }

        function dispatchPrediction(action, extra = {}) {
          if (!routeStation) {
            showToast('Prediction dealer is unavailable right now.');
            return false;
          }
          return sendStationInteract(routeStation, action, extra);
        }

        if (selectEl instanceof HTMLSelectElement) {
          selectEl.onchange = () => {
            state.ui.prediction.selectedMarketId = String(selectEl.value || '');
          };
        }
        if (refreshBtn) {
          refreshBtn.onclick = () => {
            dispatchPrediction('prediction_markets_open');
          };
        }
        if (positionsBtn) {
          positionsBtn.onclick = () => {
            dispatchPrediction('prediction_positions_open');
          };
        }
        function clearPredictionBuyBtns() {
          clearPendingBtn(buyYesBtn, 'YES');
          clearPendingBtn(buyNoBtn, 'NO');
          clearPendingBtn(quoteBtn, 'Get quote');
        }

        if (quoteBtn) {
          quoteBtn.onclick = () => {
            const marketId = currentMarketId();
            if (!marketId) { showToast('Pick a market first.'); return; }
            setPendingBtn(quoteBtn, 'Getting quote…');
            _startTimer('prediction:quote', () => {
              clearPendingBtn(quoteBtn, 'Get quote');
              showToast('No response from prediction server.', 'error');
            }, 5000);
            const sent = dispatchPrediction('prediction_market_quote', { marketId, side: 'yes', stake: currentStake() });
            if (!sent) {
              _clearTimer('prediction:quote');
              clearPendingBtn(quoteBtn, 'Get quote');
            }
          };
        }
        if (buyYesBtn) {
          buyYesBtn.onclick = () => {
            const marketId = currentMarketId();
            if (!marketId) { showToast('Pick a market first.'); return; }
            state.ui.prediction.state = 'pending';
            setPendingBtn(buyYesBtn, 'Confirming…');
            buyNoBtn && (buyNoBtn.disabled = true);
            _startTimer('prediction:buy', () => {
              clearPredictionBuyBtns();
              state.ui.prediction.state = 'error';
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = dispatchPrediction('prediction_market_buy_yes', { marketId, stake: currentStake() });
            if (!sent) {
              _clearTimer('prediction:buy');
              clearPredictionBuyBtns();
              state.ui.prediction.state = 'error';
            }
          };
        }
        if (buyNoBtn) {
          buyNoBtn.onclick = () => {
            const marketId = currentMarketId();
            if (!marketId) { showToast('Pick a market first.'); return; }
            state.ui.prediction.state = 'pending';
            setPendingBtn(buyNoBtn, 'Confirming…');
            buyYesBtn && (buyYesBtn.disabled = true);
            _startTimer('prediction:buy', () => {
              clearPredictionBuyBtns();
              state.ui.prediction.state = 'error';
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = dispatchPrediction('prediction_market_buy_no', { marketId, stake: currentStake() });
            if (!sent) {
              _clearTimer('prediction:buy');
              clearPredictionBuyBtns();
              state.ui.prediction.state = 'error';
            }
          };
        }
        if (!Array.isArray(state.ui.prediction.markets) || state.ui.prediction.markets.length === 0) {
          dispatchPrediction('prediction_markets_open');
        }
      }

      if (station.kind === 'dealer_coinflip') {
        state.ui.dealer.gameType = 'coinflip';
        const curWager = Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)));
        stationUi.innerHTML = `
          <div class="game-panel">
            <div class="game-panel__wager-row">
              <label class="game-panel__wager-label" for="station-wager">Wager <span class="game-panel__currency">USDC</span></label>
              <input class="game-panel__wager-input" id="station-wager" type="number" min="0" max="10000" step="1" value="${curWager}" />
            </div>
            <div class="game-panel__stage" id="station-stage">
              <button id="station-house-start" class="game-panel__play-btn" type="button">
                <span class="game-panel__play-icon">▶</span> Play
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
          _clearTimer('dealer:pick');
          state.ui.dealer.state = 'error';
          state.ui.dealer.reasonText = 'No server response. Try again.';
          clearPendingBtn(startBtn, '▶ Play');
          flashBtn(startBtn, 'is-failed');
          clearPendingBtn(headsBtn, 'Heads');
          clearPendingBtn(tailsBtn, 'Tails');
          setPicksLocked(false);
          setGameStatus('No server response. Try again.', 'error');
          showToast('Station timed out. Retry.', 'error');
        }

        function sendStart() {
          const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
          if (!sendStationInteract(station, 'coinflip_house_start', { wager })) return;
          state.ui.dealer.state = 'preflight';
          state.ui.dealer.wager = wager;
          setPendingBtn(startBtn, 'Locking in…');
          setPicksLocked(true);
          setGameStatus('Locking in…', 'loading');
          _startTimer('dealer:preflight', onCoinflipTimeout, 7000);
        }

        function sendPick(pick) {
          if (!sendStationInteract(station, 'coinflip_house_pick', { pick, playerSeed: makePlayerSeed() })) return;
          _clearTimer('dealer:preflight');
          state.ui.dealer.state = 'dealing';
          setPicksLocked(true);
          setGameStatus(`Flipping… you picked ${pick.toUpperCase()}`, 'loading');
          _startTimer('dealer:pick', onCoinflipTimeout, 7000);
        }

        if (startBtn) startBtn.onclick = () => sendStart();
        if (headsBtn) headsBtn.onclick = () => { setPendingBtn(headsBtn, 'Heads…'); sendPick('heads'); };
        if (tailsBtn) tailsBtn.onclick = () => { setPendingBtn(tailsBtn, 'Tails…'); sendPick('tails'); };

        const ds = state.ui.dealer.state;
        const stationReady = ds === 'ready' && dealerStationMatches(station);
        if (stationReady) {
          if (stageEl) stageEl.style.display = 'none';
          if (pickActions) pickActions.style.display = 'flex';
          setPicksLocked(false);
          setGameStatus('Choose your side — Heads or Tails!', 'prompt');
        } else if (ds === 'preflight') {
          if (pickActions) pickActions.style.display = 'none';
          setGameStatus('Locking in…', 'loading');
        } else if (ds === 'dealing') {
          if (stageEl) stageEl.style.display = 'none';
          if (pickActions) pickActions.style.display = 'flex';
          setPicksLocked(true);
          setGameStatus('Flipping…', 'loading');
        } else if (ds === 'error') {
          if (startBtn) startBtn.disabled = false;
          setPicksLocked(false);
          setGameStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
        }
      } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
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
            <div class="game-panel__wager-row">
              <label class="game-panel__wager-label" for="station-wager">Wager <span class="game-panel__currency">USDC</span></label>
              <input class="game-panel__wager-input" id="station-wager" type="number" min="0" max="10000" step="1" value="${curWager}" />
            </div>
            <div class="game-panel__stage" id="station-stage">
              <button id="station-house-start" class="game-panel__play-btn" type="button">
                <span class="game-panel__play-icon">▶</span> Play
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

        function onRpsTimeout() {
          _clearTimer('dealer:pick');
          state.ui.dealer.state = 'error';
          state.ui.dealer.reasonText = 'No server response. Try again.';
          clearPendingBtn(startBtn, '▶ Play');
          flashBtn(startBtn, 'is-failed');
          for (const id of (isRps
            ? ['station-house-r', 'station-house-p', 'station-house-s']
            : ['station-house-d1', 'station-house-d2', 'station-house-d3', 'station-house-d4', 'station-house-d5', 'station-house-d6'])) {
            const b = document.getElementById(id);
            if (b) { clearPendingBtn(b); b.disabled = false; }
          }
          setGameStatus('No server response. Try again.', 'error');
          showToast('Station timed out. Retry.', 'error');
        }

        if (startBtn) {
          startBtn.onclick = () => {
            const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
            if (!sendStationInteract(station, startAction, { wager })) return;
            state.ui.dealer.state = 'preflight';
            state.ui.dealer.wager = wager;
            state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
            setPendingBtn(startBtn, 'Locking in…');
            setGameStatus('Locking in…', 'loading');
            _startTimer('dealer:preflight', onRpsTimeout, 7000);
          };
        }

        const picks = isRps ? ['rock', 'paper', 'scissors'] : ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
        for (const pick of picks) {
          const btnId = isRps ? `station-house-${pick.charAt(0)}` : `station-house-${pick}`;
          const btn = document.getElementById(btnId);
          if (!(btn instanceof HTMLButtonElement)) continue;
          btn.onclick = () => {
            if (!sendStationInteract(station, pickAction, { pick, playerSeed: makePlayerSeed() })) return;
            _clearTimer('dealer:preflight');
            state.ui.dealer.state = 'dealing';
            setPendingBtn(btn, isRps ? `${pick.charAt(0).toUpperCase()}…` : `${pick.replace('d', '')}…`);
            setAllPicksLocked(true);
            setGameStatus(`You picked ${isRps ? pick : pick.replace('d', '')} — rolling…`, 'loading');
            _startTimer('dealer:pick', onRpsTimeout, 7000);
          };
        }

        const ds = state.ui.dealer.state;
        const stationReady = ds === 'ready' && dealerStationMatches(station);
        if (stationReady) {
          if (stageEl) stageEl.style.display = 'none';
          if (pickActions) pickActions.style.display = 'flex';
          setAllPicksLocked(false);
          setGameStatus(isRps ? 'Pick Rock, Paper, or Scissors!' : 'Pick your number!', 'prompt');
        } else if (ds === 'preflight') {
          setGameStatus('Locking in…', 'loading');
        } else if (ds === 'dealing') {
          if (stageEl) stageEl.style.display = 'none';
          if (pickActions) pickActions.style.display = 'flex';
          setAllPicksLocked(true);
          setGameStatus('Rolling…', 'loading');
        } else if (ds === 'reveal') {
          if (startBtn) startBtn.disabled = false;
          if (pickActions) pickActions.style.display = 'none';
          if (stageEl) stageEl.style.display = 'flex';
          setGameStatus('Round over — play again?');
        } else if (ds === 'error') {
          if (startBtn) startBtn.disabled = false;
          if (pickActions) pickActions.style.display = 'none';
          if (stageEl) stageEl.style.display = 'flex';
          setGameStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
        }
      } else if (station.kind === 'dealer_prediction') {
        mountPredictionPanel({ routeStation: station, kioskMode: false });
      } else if (station.kind === 'cashier_bank') {
        stationUi.innerHTML = `
          <div class="station-ui__title">Cashier</div>
          <div class="station-ui__meta" id="station-balance">Loading balance...</div>
          <div class="station-ui__row">
            <label for="station-amount">Amount</label>
            <input id="station-amount" type="number" min="0" max="10000" step="1" value="10" />
          </div>
          <div class="station-ui__actions">
            <button id="station-refresh" class="btn-ghost" type="button">Refresh</button>
            <button id="station-fund" class="btn-gold" type="button">Fund</button>
            <button id="station-withdraw" class="btn-gold" type="button">Withdraw</button>
          </div>
          <div class="station-ui__row">
            <label for="station-to-wallet">To Wallet</label>
            <input id="station-to-wallet" type="text" placeholder="wallet_..." />
          </div>
          <div class="station-ui__actions">
            <button id="station-transfer" class="btn-ghost" type="button">Transfer</button>
          </div>
        `;

        const balanceEl = document.getElementById('station-balance');
        const amountEl = document.getElementById('station-amount');
        const toWalletEl = document.getElementById('station-to-wallet');
        const refreshBtn = document.getElementById('station-refresh');
        const fundBtn = document.getElementById('station-fund');
        const withdrawBtn = document.getElementById('station-withdraw');
        const transferBtn = document.getElementById('station-transfer');

        async function api(path, init) {
          const res = await fetch(path, {
            credentials: 'include',
            ...init,
            headers: buildSessionHeaders(init?.headers)
          });
          const json = await res.json().catch(() => null);
          if (!res.ok) {
            const reason = String(json?.reason || `http_${res.status}`);
            throw new Error(reason);
          }
          return json;
        }

        async function refresh() {
          try {
            const ok = await syncWalletSummary({ keepLastOnFailure: true });
            if (!ok || !Number.isFinite(Number(state.walletBalance))) {
              balanceEl.textContent = 'Balance: unavailable (onchain)';
              return;
            }
            balanceEl.textContent = `Balance: ${formatUsdAmount(Number(state.walletBalance))} USDC`;
          } catch (err) {
            balanceEl.textContent = `Balance unavailable (${String(err.message || err)})`;
          }
        }

        async function fund() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          await api('/api/player/wallet/fund', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ amount })
          });
          await refresh();
          showToast(`Funded ${amount}.`);
        }

        async function withdraw() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          await api('/api/player/wallet/withdraw', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ amount })
          });
          await refresh();
          showToast(`Withdrew ${amount}.`);
        }

        async function transfer() {
          const amount = Math.max(0, Number(amountEl?.value || 0));
          const toWalletId = String(toWalletEl?.value || '').trim();
          if (!toWalletId) {
            showToast('Enter a target wallet id.');
            return;
          }
          await api('/api/player/wallet/transfer', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ toWalletId, amount })
          });
          await refresh();
          showToast(`Transferred ${amount} to ${toWalletId}.`);
        }

        if (refreshBtn) {
          refreshBtn.onclick = () => { void refresh(); };
        }
        if (fundBtn) {
          fundBtn.onclick = () => {
            setPendingBtn(fundBtn, 'Funding…');
            fund()
              .then(() => { flashBtn(fundBtn, 'is-success'); clearPendingBtn(fundBtn, 'Fund'); })
              .catch((e) => { flashBtn(fundBtn, 'is-failed'); clearPendingBtn(fundBtn, 'Fund'); showToast(String(e.message || e)); });
          };
        }
        if (withdrawBtn) {
          withdrawBtn.onclick = () => {
            setPendingBtn(withdrawBtn, 'Withdrawing…');
            withdraw()
              .then(() => { flashBtn(withdrawBtn, 'is-success'); clearPendingBtn(withdrawBtn, 'Withdraw'); })
              .catch((e) => { flashBtn(withdrawBtn, 'is-failed'); clearPendingBtn(withdrawBtn, 'Withdraw'); showToast(String(e.message || e)); });
          };
        }
        if (transferBtn) {
          transferBtn.onclick = () => {
            setPendingBtn(transferBtn, 'Transferring…');
            transfer()
              .then(() => { flashBtn(transferBtn, 'is-success'); clearPendingBtn(transferBtn, 'Transfer'); })
              .catch((e) => { flashBtn(transferBtn, 'is-failed'); clearPendingBtn(transferBtn, 'Transfer'); showToast(String(e.message || e)); });
          };
        }
        void refresh();
      } else if (station.kind === 'world_interactable') {
        const isMarketBoardStation = String(station.interactionTag || '').includes('world_baked');
        if (isMarketBoardStation) {
          const routeStation = resolvePredictionRouteStation(station);
          if (interactionTitle) {
            interactionTitle.innerHTML = `Market Terminal<span class="interaction-card__subtitle">live board</span>`;
          }
          mountPredictionPanel({ routeStation, kioskMode: true });
        } else {
          const localInteraction = station.localInteraction || {};
          const detail = state.ui.world.stationId === station.id
            ? state.ui.world.detail
            : (localInteraction.inspect || 'Interact with this world object.');
          const actionLabel = state.ui.world.stationId === station.id
            ? state.ui.world.actionLabel
            : (localInteraction.useLabel || 'Use');
          const npcName = localInteraction.title || station.displayName;
          // Show name + role subtitle in card header; strip outer station-ui box styling
          if (interactionTitle) {
            const tag = station.interactionTag ? station.interactionTag.replace(/_/g, ' ') : 'host';
            interactionTitle.innerHTML = `${npcName}<span class="interaction-card__subtitle">${tag}</span>`;
          }
          stationUi.classList.add('station-ui--npc');
          stationUi.innerHTML = `
            <div class="npc-speech__bubble" id="world-interaction-detail">${detail}</div>
            <div class="station-ui__actions">
              <button id="world-interaction-use" class="btn-gold" type="button">${actionLabel}</button>
            </div>
          `;
          const useBtn = document.getElementById('world-interaction-use');
          const detailEl = document.getElementById('world-interaction-detail');
          if (useBtn) {
            useBtn.onclick = () => {
              if (renderGuideStationDetail(station, 'use')) {
                if (detailEl) {
                  detailEl.textContent = state.ui.world.detail || 'Interaction complete.';
                }
                setPendingBtn(useBtn, 'Done');
                // Auto-clear after 4s (guide interaction is local, no server ack)
                _startTimer('world:use', () => { clearPendingBtn(useBtn, actionLabel); }, 4000);
                return;
              }
              setPendingBtn(useBtn, 'Opening…');
              _startTimer('world:use', () => {
                clearPendingBtn(useBtn, actionLabel);
                showToast('No server response. Try again.', 'error');
              }, 4000);
              const sent = sendStationInteract(station, 'interact_use', {
                interactionTag: String(station.interactionTag || '')
              });
              if (!sent) {
                _clearTimer('world:use');
                clearPendingBtn(useBtn, actionLabel);
                return;
              }
              if (detailEl) {
                detailEl.textContent = 'Using interaction...';
              }
            };
          }
          if (state.ui.world.stationId !== station.id) {
            renderGuideStationDetail(station, 'inspect');
          }
        }
      } else {
        stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
      }
    }

    if (station.kind === 'dealer_coinflip') {
      function dealerStationMatchesLive(st) {
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
      if (ds === 'ready' && dealerStationMatchesLive(station)) {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (stageEl) stageEl.style.display = 'none';
        if (pickActions) pickActions.style.display = 'flex';
        setLiveStatus('Choose your side — Heads or Tails!', 'prompt');
      } else if (ds === 'preflight') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'none';
        setLiveStatus('Locking in…', 'loading');
      } else if (ds === 'dealing') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (stageEl) stageEl.style.display = 'none';
        if (pickActions) pickActions.style.display = 'flex';
        setLiveStatus('Flipping…', 'loading');
      } else if (ds === 'error') {
        _clearTimer('dealer:preflight'); _clearTimer('dealer:pick');
        clearPendingBtn(startBtn, '▶ Play'); flashBtn(startBtn, 'is-failed');
        clearPendingBtn(headsBtn, 'Heads'); clearPendingBtn(tailsBtn, 'Tails');
        if (pickActions) pickActions.style.display = 'none';
        setLiveStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
      } else if (ds === 'reveal') {
        _clearTimer('dealer:preflight'); _clearTimer('dealer:pick');
        clearPendingBtn(startBtn, '▶ Play'); flashBtn(startBtn, 'is-success');
        clearPendingBtn(headsBtn, 'Heads'); clearPendingBtn(tailsBtn, 'Tails');
        if (pickActions) pickActions.style.display = 'none';
        if (stageEl) stageEl.style.display = 'flex';
        if (statusEl) {
          statusEl.className = 'game-panel__status';
          const delta = Number(state.ui.dealer.payoutDelta || 0);
          const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
          renderDealerRevealStatus(statusEl, {
            coinflipResult: state.ui.dealer.coinflipResult,
            delta,
            txHash: tx,
            walletBalance: state.walletBalance,
            chainId: state.walletChainId
          });
        }
      }
    }
    if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
      function dealerStationMatchesLiveRps(st) {
        const dsid = String(state.ui.dealer.stationId || '');
        return dsid === st.id || dsid === String(st.proxyStationId || '');
      }
      const isRpsLive = station.kind === 'dealer_rps';
      const pickActions = document.getElementById('station-pick-actions');
      const stageEl = document.getElementById('station-stage');
      const statusEl = document.getElementById('station-status');
      const startBtn = document.getElementById('station-house-start');

      const allPickIds = isRpsLive
        ? ['station-house-r', 'station-house-p', 'station-house-s']
        : ['station-house-d1', 'station-house-d2', 'station-house-d3', 'station-house-d4', 'station-house-d5', 'station-house-d6'];

      function setAllPicksBtnDisabled(disabled) {
        for (const id of allPickIds) {
          const btn = document.getElementById(id);
          if (btn instanceof HTMLButtonElement) btn.disabled = disabled;
        }
      }

      function setLiveStatusRps(text, tone) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
      }

      const ds = state.ui.dealer.state;
      if (ds === 'ready' && dealerStationMatchesLiveRps(station)) {
        if (startBtn) startBtn.disabled = false;
        setAllPicksBtnDisabled(false);
        if (stageEl) stageEl.style.display = 'none';
        if (pickActions) pickActions.style.display = 'flex';
        setLiveStatusRps(isRpsLive ? 'Pick Rock, Paper, or Scissors!' : 'Pick your number!', 'prompt');
      } else if (ds === 'preflight') {
        if (startBtn) startBtn.disabled = true;
        setAllPicksBtnDisabled(true);
        if (pickActions) pickActions.style.display = 'none';
        setLiveStatusRps('Locking in…', 'loading');
      } else if (ds === 'dealing') {
        if (startBtn) startBtn.disabled = true;
        setAllPicksBtnDisabled(true);
        if (stageEl) stageEl.style.display = 'none';
        if (pickActions) pickActions.style.display = 'flex';
        setLiveStatusRps(isRpsLive ? 'Waiting for result…' : 'Rolling…', 'loading');
      } else if (ds === 'error') {
        _clearTimer('dealer:preflight'); _clearTimer('dealer:pick');
        clearPendingBtn(startBtn, '▶ Play'); flashBtn(startBtn, 'is-failed');
        for (const id of allPickIds) { const b = document.getElementById(id); if (b) clearPendingBtn(b); }
        setAllPicksBtnDisabled(false);
        if (pickActions) pickActions.style.display = 'none';
        if (stageEl) stageEl.style.display = 'flex';
        setLiveStatusRps(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
      } else if (ds === 'reveal') {
        _clearTimer('dealer:preflight'); _clearTimer('dealer:pick');
        clearPendingBtn(startBtn, '▶ Play'); flashBtn(startBtn, 'is-success');
        for (const id of allPickIds) { const b = document.getElementById(id); if (b) clearPendingBtn(b); }
        setAllPicksBtnDisabled(false);
        if (pickActions) pickActions.style.display = 'none';
        if (stageEl) stageEl.style.display = 'flex';
        if (statusEl) {
          statusEl.className = 'game-panel__status';
          const delta = Number(state.ui.dealer.payoutDelta || 0);
          const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
          renderDealerRevealStatus(statusEl, {
            coinflipResult: state.ui.dealer.coinflipResult,
            delta,
            txHash: tx,
            walletBalance: state.walletBalance,
            chainId: state.walletChainId
          });
        }
      }
    }
    if (station.kind === 'dealer_prediction' || stationUi.dataset.predictionMode === 'kiosk') {
      const prediction = state.ui.prediction || {};
      const markets = Array.isArray(prediction.markets) ? prediction.markets : [];
      const positions = Array.isArray(prediction.positions) ? prediction.positions : [];
      const selectedMarketId = String(prediction.selectedMarketId || markets[0]?.marketId || '');
      const selectEl = document.getElementById('prediction-market-select');
      const previewEl = document.getElementById('prediction-market-preview');
      const statusEl = document.getElementById('prediction-status');
      const quoteEl = document.getElementById('prediction-quote-view');
      const positionsEl = document.getElementById('prediction-positions-view');
      const tickerEl = document.getElementById('prediction-market-strip');
      if (selectEl instanceof HTMLSelectElement) {
        selectEl.innerHTML = '';
        markets.forEach((market) => {
          const marketId = String(market.marketId || '');
          const question = String(market.question || marketId);
          const compactQuestion = question.length > 64 ? `${question.slice(0, 61)}...` : question;
          const yes = formatPredictionPrice(Number(market.yesPrice || 0));
          const close = formatPredictionClose(Number(market.closeAt || 0));
          const option = document.createElement('option');
          option.value = marketId;
          option.textContent = `${compactQuestion} · YES ${yes} · ${close}`;
          option.title = `${question} · YES ${yes} · ${close}`;
          selectEl.appendChild(option);
        });
        if (selectedMarketId) {
          selectEl.value = selectedMarketId;
        }
      }
      if (previewEl) {
        const selected = markets.find((market) => String(market.marketId || '') === selectedMarketId) || markets[0];
        if (!selected) {
          previewEl.hidden = true;
          previewEl.textContent = '';
        } else {
          const question = String(selected.question || selected.marketId || 'Untitled market');
          const yes = formatPredictionPrice(Number(selected.yesPrice || 0));
          const close = formatPredictionClose(Number(selected.closeAt || 0));
          previewEl.hidden = false;
          previewEl.textContent = `${question} · YES ${yes} · ${close}`;
          previewEl.title = question;
        }
      }
      if (statusEl) {
        const mode = String(prediction.state || 'idle');
        const _buyYes = document.getElementById('prediction-buy-yes');
        const _buyNo  = document.getElementById('prediction-buy-no');
        const _quote  = document.getElementById('prediction-quote');
        if (mode === 'pending') {
          setStationStatus(statusEl, 'Submitting order...', 'neutral');
        } else if (mode === 'error') {
          _clearTimer('prediction:buy'); _clearTimer('prediction:quote');
          if (_buyYes) { flashBtn(_buyYes, 'is-failed'); clearPendingBtn(_buyYes, 'YES'); }
          if (_buyNo)  { flashBtn(_buyNo,  'is-failed'); clearPendingBtn(_buyNo,  'NO');  }
          if (_quote)  { clearPendingBtn(_quote,  'Get quote'); }
          setStationStatus(statusEl, String(prediction.lastReasonText || 'Prediction request failed.'), 'warning');
        } else if (mode === 'filled') {
          _clearTimer('prediction:buy'); _clearTimer('prediction:quote');
          if (_buyYes) { flashBtn(_buyYes, 'is-success'); clearPendingBtn(_buyYes, 'YES'); }
          if (_buyNo)  { flashBtn(_buyNo,  'is-success'); clearPendingBtn(_buyNo,  'NO');  }
          if (_quote)  { clearPendingBtn(_quote,  'Get quote'); }
          setStationStatus(statusEl, 'Order filled.', 'success');
        } else {
          _clearTimer('prediction:quote');
          if (_quote) clearPendingBtn(_quote, 'Get quote');
          if (markets.length === 0) {
            setStationStatus(statusEl, 'No active markets. Refresh and sync from admin if needed.', 'warning');
          } else {
            setStationStatus(statusEl, 'Quote a side or place an order.');
          }
        }
      }
      if (quoteEl) {
        const quote = prediction.quote;
        if (quote && quote.marketId) {
          quoteEl.hidden = false;
          quoteEl.textContent = `${String(quote.side || '').toUpperCase()} @ ${formatPredictionPrice(Number(quote.price || 0))} · ${Number(quote.shares || 0).toFixed(2)} shares · payout ${formatUsdAmount(Number(quote.potentialPayout || 0))}`;
        } else {
          quoteEl.hidden = true;
          quoteEl.textContent = '';
        }
      }
      if (positionsEl) {
        if (positions.length === 0) {
          positionsEl.hidden = true;
          positionsEl.innerHTML = '';
        } else {
          positionsEl.hidden = false;
          positionsEl.innerHTML = positions
            .slice(0, 4)
            .map((entry) => {
              const question = String(entry.question || entry.marketId || '').slice(0, 44);
              return `<div class="prediction-position">${question}<span class="prediction-position__side prediction-position__side--${String(entry.side || '').toLowerCase()}">${String(entry.side || '').toUpperCase()}</span> · ${formatUsdAmount(Number(entry.stake || 0))} · ${String(entry.status || 'open')}</div>`;
            })
            .join('');
        }
      }
      if (tickerEl) {
        tickerEl.innerHTML = markets.length === 0
          ? '<span class="prediction-pill">No active markets</span>'
          : markets
              .slice(0, 3)
              .map((entry) => {
                const question = String(entry.question || entry.marketId || '').slice(0, 42);
                const yes = formatPredictionPrice(Number(entry.yesPrice || 0));
                return `<span class="prediction-pill"><strong>${question}</strong><span>YES ${yes}</span></span>`;
              })
              .join('');
      }
    }
    return;
  }

  stationUi.hidden = true;
  stationUi.style.display = 'none';
  stationUi.innerHTML = '';
  stationUi.dataset.predictionMode = '';
  stationUi.classList.remove('station-ui--npc');
  interactionStationRenderKey = '';
  if (interactionNpcInfo && targetPlayer && state.ui.interactionMode === 'player') {
    interactionTitle.textContent = `Challenge: ${labelFor(targetId)}`;
    interactionNpcInfo.hidden = false;
    interactionNpcInfo.style.display = 'grid';
    const incoming = challengeController.currentIncomingChallenge();
    const outgoingPending = Boolean(state.outgoingChallengeId);
    const targetNearby = state.nearbyIds instanceof Set && state.nearbyIds.has(targetId);
    const canSendBase = state.wsConnected && !state.respondingIncoming && !outgoingPending && targetId !== state.playerId && targetNearby;
    const selectedGame = normalizedChallengeGameType(state.ui?.challenge?.gameType || 'rps');
    const selectedWager = normalizedChallengeWager(state.ui?.challenge?.wager ?? 1, 1);
    const approvalMode = String(state.escrowApproval?.mode || 'manual');
    const approvalModeAuto = approvalMode === 'auto';
    const approvalState = String(state.ui?.challenge?.approvalState || 'idle');
    const approvalMessage = String(state.ui?.challenge?.approvalMessage || '').trim();
    const approvalReady = approvalState === 'ready' && Number(state.ui?.challenge?.approvalWager || 0) >= selectedWager;
    const canSend = canSendBase && (selectedWager <= 0 || approvalModeAuto || approvalReady);
    const approvalHint = selectedWager > 0
      ? (approvalModeAuto
          ? 'Super Agent Approval Active (Testnet). Wagered challenges are prepared automatically.'
          : (approvalMessage || (approvalReady
              ? `Escrow approval ready for ${formatUsdAmount(selectedWager)}.`
              : `Approve escrow to place wager (${formatUsdAmount(selectedWager)}).`)))
      : 'Free wager selected. No escrow approval needed.';
    const incomingLabel = incoming
      ? `${labelFor(incoming.challengerId)} challenged you (${incoming.gameType.toUpperCase()}, ${formatWagerInline(incoming.wager)}).`
      : '';
    interactionNpcInfo.innerHTML = `
      <div class="station-ui__title">${labelFor(targetId)}</div>
      <div class="station-ui__row">
        <label for="player-challenge-game">Game</label>
        <select id="player-challenge-game">
          <option value="rps" ${selectedGame === 'rps' ? 'selected' : ''}>Rock Paper Scissors</option>
          <option value="coinflip" ${selectedGame === 'coinflip' ? 'selected' : ''}>Coin Flip</option>
          <option value="dice_duel" ${selectedGame === 'dice_duel' ? 'selected' : ''}>Dice Duel</option>
        </select>
      </div>
      <div class="station-ui__row">
        <label for="player-challenge-wager">Wager (each, USDC)</label>
        <input id="player-challenge-wager" type="number" min="0" max="10000" step="1" value="${selectedWager}" />
      </div>
      ${approvalModeAuto
        ? '<div class="station-ui__meta">Super Agent Approval Active (Testnet)</div>'
        : `<div class="station-ui__actions">
          <button id="player-challenge-approve" class="btn-ghost" type="button" ${(selectedWager > 0 && approvalState !== 'checking') ? '' : 'disabled'}>
            ${approvalState === 'checking' ? 'Approving...' : 'Approve Escrow'}
          </button>
        </div>`}
      <div class="station-ui__actions">
        <button id="player-challenge-send" class="btn-gold" type="button" ${canSend ? '' : 'disabled'}>Send Challenge (C)</button>
      </div>
      <div class="station-ui__actions">
        <button id="player-challenge-accept" class="btn-ghost" type="button" ${(incoming && !state.respondingIncoming) ? '' : 'disabled'}>Accept (Y)</button>
        <button id="player-challenge-decline" class="btn-ghost" type="button" ${(incoming && !state.respondingIncoming) ? '' : 'disabled'}>Decline (N)</button>
      </div>
      <div class="station-ui__meta">${incomingLabel || `${targetNearby ? 'Pick a game and send a challenge.' : 'Move closer to this player, then send challenge.'} ${outgoingPending ? 'You already have a pending outgoing challenge.' : ''}`}</div>
      <div class="station-ui__meta">${approvalHint}</div>
    `;
    const gameEl = document.getElementById('player-challenge-game');
    const wagerEl = document.getElementById('player-challenge-wager');
    const approveBtn = document.getElementById('player-challenge-approve');
    const sendBtn = document.getElementById('player-challenge-send');
    const acceptBtn = document.getElementById('player-challenge-accept');
    const declineBtn = document.getElementById('player-challenge-decline');
    if (gameEl instanceof HTMLSelectElement) {
      gameEl.onchange = () => {
        state.ui.challenge.gameType = normalizedChallengeGameType(gameEl.value);
      };
    }
    if (wagerEl instanceof HTMLInputElement) {
      wagerEl.oninput = () => {
        const wager = normalizedChallengeWager(wagerEl.value, 1);
        state.ui.challenge.wager = wager;
        if (wager <= 0) {
          state.ui.challenge.approvalState = 'idle';
          state.ui.challenge.approvalMessage = '';
          state.ui.challenge.approvalWager = 0;
          return;
        }
        if (approvalModeAuto) {
          state.ui.challenge.approvalState = 'ready';
          state.ui.challenge.approvalWager = wager;
          state.ui.challenge.approvalMessage = 'Testnet mode: approvals handled automatically.';
          return;
        }
        if (Number(state.ui.challenge.approvalWager || 0) < wager) {
          state.ui.challenge.approvalState = 'required';
        }
      };
    }
    if (approveBtn instanceof HTMLButtonElement) {
      approveBtn.onclick = () => {
        const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
        void ensureEscrowApproval(wager);
      };
    }
    if (sendBtn instanceof HTMLButtonElement) {
      sendBtn.onclick = () => {
        const gameType = gameEl instanceof HTMLSelectElement ? gameEl.value : state.ui.challenge.gameType;
        const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
        setPendingBtn(sendBtn, 'Sending…');
        _startTimer('challenge:send', () => {
          clearPendingBtn(sendBtn, 'Send Challenge (C)');
          showToast('No server response. Try again.', 'error');
        }, 7000);
        const sent = challengeController.sendChallenge(getUiTargetId(), gameType, wager);
        if (!sent) {
          _clearTimer('challenge:send');
          clearPendingBtn(sendBtn, 'Send Challenge (C)');
        }
      };
    }
    if (acceptBtn instanceof HTMLButtonElement) {
      acceptBtn.onclick = () => {
        setPendingBtn(acceptBtn, 'Accepting…');
        _startTimer('challenge:respond', () => {
          clearPendingBtn(acceptBtn, 'Accept (Y)');
          showToast('No server response. Try again.', 'error');
        }, 7000);
        const sent = challengeController.respondToIncoming(true);
        if (!sent) {
          _clearTimer('challenge:respond');
          clearPendingBtn(acceptBtn, 'Accept (Y)');
        }
      };
    }
    if (declineBtn instanceof HTMLButtonElement) {
      declineBtn.onclick = () => {
        setPendingBtn(declineBtn, 'Declining…');
        _startTimer('challenge:respond', () => {
          clearPendingBtn(declineBtn, 'Decline (N)');
          showToast('No server response. Try again.', 'error');
        }, 7000);
        const sent = challengeController.respondToIncoming(false);
        if (!sent) {
          _clearTimer('challenge:respond');
          clearPendingBtn(declineBtn, 'Decline (N)');
        }
      };
    }
  }
  } finally {
    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
    }
  }
}
