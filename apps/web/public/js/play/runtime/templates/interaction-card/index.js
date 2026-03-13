/**
 * Interaction card orchestrator – dispatches to panel modules by station kind.
 * Uses plugin registry for station metadata when available.
 */
import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer,
  hideNpcInfoPanel,
  showNpcInfoPanel
} from './helpers.js';
import { mountCoinflipPanel, updateCoinflipLive } from './coinflip-panel.js';
import { mountRpsDicePanel, updateRpsDiceLive } from './rps-dice-panel.js';
import { mountPredictionPanel, updatePredictionLive } from './prediction-panel.js';
import { mountCashierPanel } from './cashier-panel.js';
import { mountWorldPanel } from './world-panel.js';

export { showNpcInfoPanel, hideNpcInfoPanel, setPendingBtn, clearPendingBtn, flashBtn, clearTimer } from './helpers.js';

export function resolvePredictionRouteStation(state, fromStation) {
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

function getStationHelpContent(station) {
  if (!station) return null;
  if (station.kind === 'cashier_bank') {
    return 'Cashier lets you <strong>fund</strong>, <strong>withdraw</strong>, or <strong>transfer</strong>. Use small test amounts first.';
  }
  return 'This station supports local interactions. Press <strong>Inspect</strong> for context or <strong>Use</strong> for the primary action.';
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
    pluginRegistry
  } = params;

  let interactionStationRenderKey = String(stateful?.interactionStationRenderKey || '');
  let interactionPlayerRenderKey = String(stateful?.interactionPlayerRenderKey || '');

  const baseParams = {
    state,
    stationUi,
    sendStationInteract,
    makePlayerSeed,
    showToast,
    buildSessionHeaders,
    syncWalletSummary,
    formatUsdAmount,
    formatPredictionClose,
    setStationStatus,
    renderDealerRevealStatus
  };

  try {
    if (!interactionCard || !interactionTitle) return;

    const active = state.activeChallenge;
    const inMatch = Boolean(active && active.status === 'active');
    if (inMatch && state.ui.interactionMode !== 'station') {
      setInteractOpen(false);
      return;
    }
    if (!state.ui.interactOpen) return;

    const targetId = getUiTargetId();
    if (!targetId) {
      setInteractOpen(false);
      return;
    }

    const station = isStation(targetId) && state.stations instanceof Map ? state.stations.get(targetId) : null;
    const targetPlayer = state.players.get(targetId);

    const dealerKinds = ['dealer_coinflip', 'dealer_rps', 'dealer_dice_duel', 'dealer_prediction'];
    const showHelpToggle = Boolean(station && !dealerKinds.includes(station.kind));
    if (interactionHelpToggle) interactionHelpToggle.hidden = !showHelpToggle;
    if (interactionHelp) {
      if (!showHelpToggle) {
        interactionHelp.hidden = true;
        interactionHelpToggle?.setAttribute('aria-expanded', 'false');
      } else {
        const helpContent = getStationHelpContent(station);
        interactionHelp.innerHTML = helpContent || 'Use this station.';
      }
    }

    if (station && state.ui.interactionMode !== 'station') state.ui.interactionMode = 'station';
    if (!station && targetPlayer && state.ui.interactionMode !== 'player') state.ui.interactionMode = 'player';

    const stationRenderKey = station
      ? `${station.id}:${station.kind}:${station.proxyStationId || ''}:${station.proxyMissing ? 'missing' : 'ready'}`
      : '';

    hideNpcInfoPanel(interactionNpcInfo);
    if (!stationUi) return;

    if (station && state.ui.interactionMode === 'station') {
      interactionPlayerRenderKey = '';
      interactionTitle.textContent = station.displayName || 'Station';
      stationUi.hidden = false;
      stationUi.style.display = 'grid';

      if (interactionStationRenderKey !== stationRenderKey) {
        interactionStationRenderKey = stationRenderKey;
        stationUi.dataset.predictionMode = '';

        if (station.source === 'host' && station.proxyMissing) {
          stationUi.innerHTML = `
            <div class="station-ui__title">${station.displayName || 'Station'}</div>
            <div class="station-ui__meta station-ui__meta--warning">
              Station unavailable right now. Server station mapping is missing; retry shortly.
            </div>
          `;
          if (stateful && typeof stateful === 'object') {
            stateful.interactionStationRenderKey = interactionStationRenderKey;
            stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
          }
          return;
        }

        function dealerStationMatches(st) {
          const dsid = String(state.ui.dealer.stationId || '');
          return dsid === st.id || dsid === String(st.proxyStationId || '');
        }

        const resolvePredictionRouteStationForMount = (fromStation) =>
          resolvePredictionRouteStation(state, fromStation);

        if (station.kind === 'dealer_coinflip') {
          mountCoinflipPanel({ ...baseParams, station });
        } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
          mountRpsDicePanel({ ...baseParams, station });
        } else if (station.kind === 'dealer_prediction') {
          mountPredictionPanel({ ...baseParams, station, kioskMode: false });
        } else if (station.kind === 'cashier_bank') {
          mountCashierPanel(baseParams);
        } else if (station.kind === 'world_interactable') {
          mountWorldPanel({
            ...baseParams,
            station,
            interactionTitle,
            resolvePredictionRouteStation: resolvePredictionRouteStationForMount,
            mountPredictionPanel: (opts) => mountPredictionPanel({ ...baseParams, ...opts })
          });
        } else {
          stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
        }
      }

      if (station.kind === 'dealer_coinflip') {
        updateCoinflipLive({
          ...baseParams,
          station,
          setPendingBtn,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
        updateRpsDiceLive({
          ...baseParams,
          station,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      } else if (station.kind === 'dealer_prediction' || stationUi.dataset.predictionMode === 'kiosk') {
        updatePredictionLive({
          ...baseParams,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      }

      if (stateful && typeof stateful === 'object') {
        stateful.interactionStationRenderKey = interactionStationRenderKey;
        stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
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
      showNpcInfoPanel(interactionNpcInfo);

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
      const approvalCap = Number(state.walletEscrowApprovalCapUsdc || 0);
      const approvalCapLabel = approvalCap > 0 ? `Approve ${formatUsdAmount(approvalCap)} Cap` : 'Approve Escrow';
      const approvalReady = approvalState === 'ready' && Number(state.ui?.challenge?.approvalWager || 0) >= selectedWager;
      const canSend = canSendBase && (selectedWager <= 0 || approvalModeAuto || approvalReady);
      const approvalHint = selectedWager > 0
        ? (approvalModeAuto
            ? 'Super Agent Approval Active (Testnet). Wagered challenges are prepared automatically.'
            : (approvalMessage || (approvalReady
                ? `Escrow approval ready for wagers up to ${formatUsdAmount(Number(state.ui?.challenge?.approvalWager || selectedWager))}.`
                : (approvalCap > 0
                    ? `Approve a ${formatUsdAmount(approvalCap)} escrow cap to enable wagers and autoplay.`
                    : `Approve escrow to place wager (${formatUsdAmount(selectedWager)}).`))))
        : 'Free wager selected. No escrow approval needed.';
      const incomingLabel = incoming
        ? `${labelFor(incoming.challengerId)} challenged you (${incoming.gameType.toUpperCase()}, ${formatWagerInline(incoming.wager)}).`
        : '';

      const playerRenderKey = [
        targetId,
        selectedGame,
        selectedWager,
        approvalMode,
        approvalState,
        approvalMessage,
        Number(state.ui?.challenge?.approvalWager || 0),
        incoming?.id || '',
        incoming?.challengerId || '',
        incoming?.gameType || '',
        incoming?.wager || '',
        outgoingPending ? 'outgoing' : 'idle',
        targetNearby ? 'nearby' : 'far',
        canSend ? 'send' : 'blocked'
      ].join('|');

      if (interactionPlayerRenderKey !== playerRenderKey) {
        interactionPlayerRenderKey = playerRenderKey;
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
                ${approvalState === 'checking' ? 'Checking...' : approvalCapLabel}
              </button>
            </div>`}
          <div class="station-ui__actions">
            <button id="player-challenge-send" class="btn-gold" type="button" ${canSend ? '' : 'disabled'}>Send Challenge (C)</button>
          </div>
          ${incoming ? `<div class="station-ui__actions">
            <button id="player-challenge-accept" class="btn-ghost" type="button" ${!state.respondingIncoming ? '' : 'disabled'}>Accept (Y)</button>
            <button id="player-challenge-decline" class="btn-ghost" type="button" ${!state.respondingIncoming ? '' : 'disabled'}>Decline (N)</button>
          </div>` : ''}
          <div class="station-ui__meta">${incomingLabel || `${targetNearby ? 'Pick a game and send a challenge.' : 'Move closer to this player, then send challenge.'} ${outgoingPending ? 'You already have a pending outgoing challenge.' : ''}`}</div>
          <div class="station-ui__meta">${approvalHint}</div>
        `;

        const renderedTargetId = targetId;
        const gameEl = document.getElementById('player-challenge-game');
        const wagerEl = document.getElementById('player-challenge-wager');
        const approveBtn = document.getElementById('player-challenge-approve');
        const sendBtn = document.getElementById('player-challenge-send');
        const acceptBtn = document.getElementById('player-challenge-accept');
        const declineBtn = document.getElementById('player-challenge-decline');

        if (outgoingPending || state.challengeStatus === 'active') {
          clearTimer('challenge:send');
          clearPendingBtn(sendBtn, 'Send Challenge (C)');
        }
        if (!state.respondingIncoming) {
          clearTimer('challenge:respond');
          clearPendingBtn(acceptBtn, 'Accept (Y)');
          clearPendingBtn(declineBtn, 'Decline (N)');
        }

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
            startTimer('challenge:send', () => {
              clearPendingBtn(sendBtn, 'Send Challenge (C)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.sendChallenge(renderedTargetId, gameType, wager);
            if (!sent) {
              clearTimer('challenge:send');
              clearPendingBtn(sendBtn, 'Send Challenge (C)');
            }
          };
        }
        if (acceptBtn instanceof HTMLButtonElement) {
          acceptBtn.onclick = () => {
            setPendingBtn(acceptBtn, 'Accepting…');
            startTimer('challenge:respond', () => {
              clearPendingBtn(acceptBtn, 'Accept (Y)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.respondToIncoming(true);
            if (!sent) {
              clearTimer('challenge:respond');
              clearPendingBtn(acceptBtn, 'Accept (Y)');
            }
          };
        }
        if (declineBtn instanceof HTMLButtonElement) {
          declineBtn.onclick = () => {
            setPendingBtn(declineBtn, 'Declining…');
            startTimer('challenge:respond', () => {
              clearPendingBtn(declineBtn, 'Decline (N)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.respondToIncoming(false);
            if (!sent) {
              clearTimer('challenge:respond');
              clearPendingBtn(declineBtn, 'Decline (N)');
            }
          };
        }
      }
    } else {
      interactionPlayerRenderKey = '';
    }

    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
      stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
    }
  } finally {
    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
      stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
    }
  }
}
