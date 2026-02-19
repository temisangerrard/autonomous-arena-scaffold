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
      if (station.source === 'host' && station.proxyMissing) {
        stationUi.innerHTML = `
          <div class="station-ui__title">${station.displayName || 'Station'}</div>
          <div class="station-ui__meta station-ui__meta--warning">
            Station unavailable right now. Server station mapping is missing; retry shortly.
          </div>
        `;
        return;
      }
      if (station.kind === 'dealer_coinflip') {
        state.ui.dealer.gameType = 'coinflip';
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: Coinflip</div>
          <div class="station-ui__row">
            <label for="station-wager">Wager (each, USDC)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-start" class="btn-gold" type="button">Start Round</button>
          </div>
          <div class="station-ui__actions" id="station-pick-actions" style="display:none;">
            <button id="station-house-heads" class="btn-gold" type="button">Heads</button>
            <button id="station-house-tails" class="btn-gold" type="button">Tails</button>
          </div>
          <div class="station-ui__meta" id="station-status">Start to receive house commit hash, then pick a side. Wagers are in USDC (displayed as $). Press Esc to close this panel and return to movement.</div>
        `;

        const wagerEl = document.getElementById('station-wager');
        const startBtn = document.getElementById('station-house-start');
        const headsBtn = document.getElementById('station-house-heads');
        const tailsBtn = document.getElementById('station-house-tails');
        const pickActions = document.getElementById('station-pick-actions');
        const statusEl = document.getElementById('station-status');

        function sendStart() {
          if (!sendStationInteract(station, 'coinflip_house_start', {
            wager: Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)))
          })) {
            return;
          }
          const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
          state.ui.dealer.state = 'preflight';
          state.ui.dealer.wager = wager;
          setStationStatus(statusEl, 'Preflight check... validating player + house wallets. Press Esc to close panel.');
          if (startBtn) startBtn.disabled = true;
          if (headsBtn) headsBtn.disabled = true;
          if (tailsBtn) tailsBtn.disabled = true;
        }

        function sendPick(pick) {
          if (!sendStationInteract(station, 'coinflip_house_pick', {
            pick,
            playerSeed: makePlayerSeed()
          })) {
            return;
          }
          state.ui.dealer.state = 'dealing';
          setStationStatus(statusEl, `Flipping... ${pick.toUpperCase()} selected.`);
          if (startBtn) startBtn.disabled = true;
          if (headsBtn) headsBtn.disabled = true;
          if (tailsBtn) tailsBtn.disabled = true;
        }

        if (startBtn) {
          startBtn.onclick = () => sendStart();
        }
        if (headsBtn) {
          headsBtn.onclick = () => sendPick('heads');
        }
        if (tailsBtn) {
          tailsBtn.onclick = () => sendPick('tails');
        }
        if (state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
          if (pickActions) pickActions.style.display = 'flex';
          setStationStatus(statusEl, `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails (Esc closes panel).`);
        }
        if (state.ui.dealer.state === 'preflight') {
          if (pickActions) pickActions.style.display = 'none';
          setStationStatus(statusEl, 'Preflight check... (Esc closes panel)');
        }
        if (state.ui.dealer.state === 'dealing') {
          if (pickActions) pickActions.style.display = 'flex';
          setStationStatus(statusEl, 'Dealing...');
        }
        if (state.ui.dealer.state === 'error') {
          if (pickActions) pickActions.style.display = 'none';
          const msg = state.ui.dealer.reasonText || 'Insufficient gas. Top up ETH, then retry.';
          setStationStatus(statusEl, msg, 'warning');
          if (startBtn) startBtn.disabled = false;
          if (headsBtn) headsBtn.disabled = false;
          if (tailsBtn) tailsBtn.disabled = false;
        }
      } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
        const isRps = station.kind === 'dealer_rps';
        state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
        const gameLabel = isRps ? 'RPS' : 'Dice Duel';
        const startAction = isRps ? 'rps_house_start' : 'dice_duel_start';
        const pickAction = isRps ? 'rps_house_pick' : 'dice_duel_pick';
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: ${gameLabel}</div>
          <div class="station-ui__row">
            <label for="station-wager">Wager (each, USDC)</label>
            <input id="station-wager" type="number" min="0" max="10000" step="1" value="${Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)))}" />
          </div>
          <div class="station-ui__actions">
            <button id="station-house-start" class="btn-gold" type="button">Start Round</button>
          </div>
          <div class="station-ui__actions" id="station-pick-actions" style="display:none;">
            ${isRps
              ? '<button id="station-house-r" class="btn-gold" type="button">Rock</button><button id="station-house-p" class="btn-gold" type="button">Paper</button><button id="station-house-s" class="btn-gold" type="button">Scissors</button>'
              : '<button id="station-house-d1" class="btn-gold" type="button">1</button><button id="station-house-d2" class="btn-gold" type="button">2</button><button id="station-house-d3" class="btn-gold" type="button">3</button><button id="station-house-d4" class="btn-gold" type="button">4</button><button id="station-house-d5" class="btn-gold" type="button">5</button><button id="station-house-d6" class="btn-gold" type="button">6</button>'
            }
          </div>
          <div class="station-ui__meta" id="station-status">Start to receive commit hash, then pick your move. Press Esc to close.</div>
        `;

        const wagerEl = document.getElementById('station-wager');
        const startBtn = document.getElementById('station-house-start');
        const pickActions = document.getElementById('station-pick-actions');
        const statusEl = document.getElementById('station-status');

        if (startBtn) {
          startBtn.onclick = () => {
            const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
            if (!sendStationInteract(station, startAction, { wager })) {
              return;
            }
            state.ui.dealer.state = 'preflight';
            state.ui.dealer.wager = wager;
            state.ui.dealer.gameType = isRps ? 'rps' : 'dice_duel';
            setStationStatus(statusEl, 'Preflight check...');
          };
        }

        const picks = isRps ? ['rock', 'paper', 'scissors'] : ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
        for (const pick of picks) {
          const id = isRps
            ? `station-house-${pick.charAt(0)}`
            : `station-house-${pick}`;
          const btn = document.getElementById(id);
          if (!(btn instanceof HTMLButtonElement)) continue;
          btn.onclick = () => {
            if (!sendStationInteract(station, pickAction, {
              pick,
              playerSeed: makePlayerSeed()
            })) {
              return;
            }
            state.ui.dealer.state = 'dealing';
            setStationStatus(statusEl, `Dealing ${gameLabel}...`);
          };
        }

        if (pickActions && state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
          pickActions.style.display = 'flex';
        }
      } else if (station.kind === 'dealer_prediction') {
        stationUi.innerHTML = `
          <div class="station-ui__title">Dealer: Prediction Markets</div>
          <div class="station-ui__row">
            <label for="prediction-market-select">Market</label>
            <select id="prediction-market-select"></select>
          </div>
          <div class="station-ui__row">
            <label for="prediction-stake">Stake (USDC)</label>
            <input id="prediction-stake" type="number" min="1" max="10000" step="1" value="1" />
          </div>
          <div class="station-ui__actions">
            <button id="prediction-refresh" class="btn-ghost" type="button">Refresh Markets</button>
            <button id="prediction-positions" class="btn-ghost" type="button">My Positions</button>
          </div>
          <div class="station-ui__actions">
            <button id="prediction-quote" class="btn-ghost" type="button">Quote</button>
            <button id="prediction-buy-yes" class="btn-gold" type="button">Buy YES</button>
            <button id="prediction-buy-no" class="btn-gold" type="button">Buy NO</button>
          </div>
          <div class="station-ui__meta" id="prediction-status">Load markets, then quote or place a side.</div>
          <div class="station-ui__meta" id="prediction-quote-view"></div>
          <div class="station-ui__meta" id="prediction-positions-view"></div>
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

        function sendQuote(side) {
          const marketId = currentMarketId();
          if (!marketId) {
            showToast('Pick a market first.');
            return;
          }
          sendStationInteract(station, 'prediction_market_quote', {
            marketId,
            side,
            stake: currentStake()
          });
        }

        if (selectEl instanceof HTMLSelectElement) {
          selectEl.onchange = () => {
            state.ui.prediction.selectedMarketId = String(selectEl.value || '');
          };
        }
        if (refreshBtn) {
          refreshBtn.onclick = () => {
            sendStationInteract(station, 'prediction_markets_open');
          };
        }
        if (positionsBtn) {
          positionsBtn.onclick = () => {
            sendStationInteract(station, 'prediction_positions_open');
          };
        }
        if (quoteBtn) {
          quoteBtn.onclick = () => sendQuote('yes');
        }
        if (buyYesBtn) {
          buyYesBtn.onclick = () => {
            const marketId = currentMarketId();
            if (!marketId) {
              showToast('Pick a market first.');
              return;
            }
            state.ui.prediction.state = 'pending';
            sendStationInteract(station, 'prediction_market_buy_yes', {
              marketId,
              stake: currentStake()
            });
          };
        }
        if (buyNoBtn) {
          buyNoBtn.onclick = () => {
            const marketId = currentMarketId();
            if (!marketId) {
              showToast('Pick a market first.');
              return;
            }
            state.ui.prediction.state = 'pending';
            sendStationInteract(station, 'prediction_market_buy_no', {
              marketId,
              stake: currentStake()
            });
          };
        }
        if (!Array.isArray(state.ui.prediction.markets) || state.ui.prediction.markets.length === 0) {
          sendStationInteract(station, 'prediction_markets_open');
        }
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
          fundBtn.onclick = () => { void fund().catch((e) => showToast(String(e.message || e))); };
        }
        if (withdrawBtn) {
          withdrawBtn.onclick = () => { void withdraw().catch((e) => showToast(String(e.message || e))); };
        }
        if (transferBtn) {
          transferBtn.onclick = () => { void transfer().catch((e) => showToast(String(e.message || e))); };
        }
        void refresh();
      } else if (station.kind === 'world_interactable') {
        const detail = state.ui.world.stationId === station.id
          ? state.ui.world.detail
          : 'Interact with this world object.';
        const actionLabel = state.ui.world.stationId === station.id
          ? state.ui.world.actionLabel
          : 'Use';
        stationUi.innerHTML = `
          <div class="station-ui__title">${station.displayName}</div>
          <div class="station-ui__meta" id="world-interaction-detail">${detail}</div>
          <div class="station-ui__actions">
            <button id="world-interaction-open" class="btn-ghost" type="button">Inspect</button>
            <button id="world-interaction-use" class="btn-gold" type="button">${actionLabel}</button>
          </div>
        `;
        const openBtn = document.getElementById('world-interaction-open');
        const useBtn = document.getElementById('world-interaction-use');
        const detailEl = document.getElementById('world-interaction-detail');
        if (openBtn) {
          openBtn.onclick = () => {
            if (renderGuideStationDetail(station, 'inspect')) {
              return;
            }
            void sendStationInteract(station, 'interact_open');
          };
        }
        if (useBtn) {
          useBtn.onclick = () => {
            if (renderGuideStationDetail(station, 'use')) {
              if (detailEl) {
                detailEl.textContent = state.ui.world.detail || 'Interaction complete.';
              }
              return;
            }
            void sendStationInteract(station, 'interact_use', {
              interactionTag: String(station.interactionTag || '')
            });
            if (detailEl) {
              detailEl.textContent = 'Using interaction...';
            }
          };
        }
        if (state.ui.world.stationId !== station.id) {
          if (!renderGuideStationDetail(station, 'inspect')) {
            if (socket && socket.readyState === WebSocket.OPEN) {
              void sendStationInteract(station, 'interact_open');
            }
          }
        }
      } else {
        stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
      }
    }

    if (station.kind === 'dealer_coinflip') {
      const pickActions = document.getElementById('station-pick-actions');
      const statusEl = document.getElementById('station-status');
      const startBtn = document.getElementById('station-house-start');
      const headsBtn = document.getElementById('station-house-heads');
      const tailsBtn = document.getElementById('station-house-tails');
      if (state.ui.dealer.state === 'ready' && state.ui.dealer.stationId === station.id) {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'flex';
        setStationStatus(statusEl, `Commit ${state.ui.dealer.commitHash.slice(0, 12)}... received. Pick heads or tails (Esc closes panel).`);
      } else if (state.ui.dealer.state === 'preflight') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'none';
        setStationStatus(statusEl, 'Preflight check... (Esc closes panel)');
      } else if (state.ui.dealer.state === 'dealing') {
        if (startBtn) startBtn.disabled = true;
        if (headsBtn) headsBtn.disabled = true;
        if (tailsBtn) tailsBtn.disabled = true;
        if (pickActions) pickActions.style.display = 'flex';
        setStationStatus(statusEl, 'Dealing...');
      } else if (state.ui.dealer.state === 'error') {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'none';
        const msg = state.ui.dealer.reasonText || 'Insufficient gas. Top up ETH, then retry.';
        setStationStatus(statusEl, msg, 'warning');
      } else if (state.ui.dealer.state === 'reveal') {
        if (startBtn) startBtn.disabled = false;
        if (headsBtn) headsBtn.disabled = false;
        if (tailsBtn) tailsBtn.disabled = false;
        if (pickActions) pickActions.style.display = 'none';
        if (statusEl) {
          statusEl.classList.remove('station-ui__meta--warning', 'station-ui__meta--success');
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
    if (station.kind === 'dealer_prediction') {
      const prediction = state.ui.prediction || {};
      const markets = Array.isArray(prediction.markets) ? prediction.markets : [];
      const positions = Array.isArray(prediction.positions) ? prediction.positions : [];
      const selectedMarketId = String(prediction.selectedMarketId || markets[0]?.marketId || '');
      const selectEl = document.getElementById('prediction-market-select');
      const statusEl = document.getElementById('prediction-status');
      const quoteEl = document.getElementById('prediction-quote-view');
      const positionsEl = document.getElementById('prediction-positions-view');
      if (selectEl instanceof HTMLSelectElement) {
        const options = markets.map((market) => {
          const marketId = String(market.marketId || '');
          const question = String(market.question || marketId);
          const yes = formatPredictionPrice(Number(market.yesPrice || 0));
          const close = formatPredictionClose(Number(market.closeAt || 0));
          return `<option value="${marketId}">${question.slice(0, 64)} · YES ${yes} · ${close}</option>`;
        });
        selectEl.innerHTML = options.join('');
        if (selectedMarketId) {
          selectEl.value = selectedMarketId;
        }
      }
      if (statusEl) {
        const mode = String(prediction.state || 'idle');
        if (mode === 'pending') {
          setStationStatus(statusEl, 'Submitting order...', 'neutral');
        } else if (mode === 'error') {
          setStationStatus(statusEl, String(prediction.lastReasonText || 'Prediction request failed.'), 'warning');
        } else if (mode === 'filled') {
          setStationStatus(statusEl, 'Order filled.', 'success');
        } else if (markets.length === 0) {
          setStationStatus(statusEl, 'No active markets. Refresh and sync from admin if needed.', 'warning');
        } else {
          setStationStatus(statusEl, 'Quote a side or place an order.');
        }
      }
      if (quoteEl) {
        const quote = prediction.quote;
        if (quote && quote.marketId) {
          quoteEl.textContent = `Quote ${String(quote.side || '').toUpperCase()} · Price ${formatPredictionPrice(Number(quote.price || 0))} · Shares ${Number(quote.shares || 0).toFixed(4)} · Payout ${formatUsdAmount(Number(quote.potentialPayout || 0))}`;
        } else {
          quoteEl.textContent = '';
        }
      }
      if (positionsEl) {
        positionsEl.innerHTML = positions.length === 0
          ? ''
          : positions
              .slice(0, 4)
              .map((entry) => {
                const question = String(entry.question || entry.marketId || '').slice(0, 46);
                return `${question} · ${String(entry.side || '').toUpperCase()} · ${formatUsdAmount(Number(entry.stake || 0))} · ${String(entry.status || 'open')}`;
              })
              .join('<br/>');
      }
    }
    return;
  }

  stationUi.hidden = true;
  stationUi.style.display = 'none';
  stationUi.innerHTML = '';
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
        void challengeController.sendChallenge(getUiTargetId(), gameType, wager);
      };
    }
    if (acceptBtn instanceof HTMLButtonElement) {
      acceptBtn.onclick = () => challengeController.respondToIncoming(true);
    }
    if (declineBtn instanceof HTMLButtonElement) {
      declineBtn.onclick = () => challengeController.respondToIncoming(false);
    }
  }
  } finally {
    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
    }
  }
}
