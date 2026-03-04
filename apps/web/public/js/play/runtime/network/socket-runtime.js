import { bootstrapSessionAuth } from './socket-auth.js';

export async function connectSocketRuntime(deps) {
  const {
    resolveWsBaseUrl,
    queryParams,
    buildSessionHeaders,
    scheduleConnectRetry,
    dispatch,
    state,
    setSocket,
    socketRef,
    connectionState,
    addFeedEvent,
    presence,
    startWalletSyncScheduler,
    stopWalletSyncScheduler,
    syncWalletSummary,
    normalizeSnapshotPlayer,
    copyStationFromPayload,
    remapLocalStationProxies,
    mergeStations,
    remoteAvatars,
    scene,
    updateRpsVisibility,
    resolveIncomingStationId,
    dealerReasonLabel,
    labelFor,
    deriveDealerGameType,
    showToast,
    showResultSplash,
    refreshWalletBalanceAndShowDelta,
    handleChallenge,
    localAvatarParts,
    challengeReasonLabel
  } = deps;

  const session = await bootstrapSessionAuth({
    queryParams,
    buildSessionHeaders,
    scheduleConnectRetry,
    dispatch,
    state
  });
  if (!session) return;

  const { sessionName, sessionWalletId, sessionClientId, sessionWsAuth } = session;

  const wsUrlObj = new URL(await resolveWsBaseUrl());
  wsUrlObj.searchParams.delete('sid');
  wsUrlObj.searchParams.delete('arena_sid');

  if (sessionName) {
    wsUrlObj.searchParams.set('name', sessionName);
    localStorage.setItem('arena_last_name', sessionName);
  }
  if (sessionWalletId) {
    wsUrlObj.searchParams.set('walletId', sessionWalletId);
  }
  if (sessionClientId) {
    wsUrlObj.searchParams.set('clientId', sessionClientId);
  }
  if (sessionWsAuth) {
    wsUrlObj.searchParams.set('wsAuth', sessionWsAuth);
  }
  const wsUrl = wsUrlObj.toString();
  const socket = new WebSocket(wsUrl);
  setSocket(socket);
  socketRef.current = socket;

  socket.addEventListener('open', () => {
    dispatch({ type: 'WS_CONNECTION_SET', connected: true });
    connectionState.connectFailureCount = 0;
    addFeedEvent('system', 'Connected to game server.');
    void presence.setPresence('online');
    if (connectionState.presenceTimer) {
      window.clearInterval(connectionState.presenceTimer);
    }
    connectionState.presenceTimer = window.setInterval(() => {
      void presence.setPresence('online');
    }, 25_000);
    startWalletSyncScheduler();
  });

  socket.addEventListener('close', (event) => {
    dispatch({ type: 'WS_CONNECTION_SET', connected: false });
    const code = Number(event?.code || 0);
    const reason = String(event?.reason || '');
    if (reason) {
      addFeedEvent('system', `Disconnected from game server (${code}: ${reason}).`);
    } else {
      addFeedEvent('system', 'Disconnected from game server.');
    }
    if (code === 4401 || code === 4403 || reason.startsWith('ws_auth_')) {
      showToast('Session auth expired or mismatched. Please sign in again.', 'warning');
    }
    if (connectionState.presenceTimer) {
      window.clearInterval(connectionState.presenceTimer);
      connectionState.presenceTimer = null;
    }
    stopWalletSyncScheduler();
    scheduleConnectRetry('Connection lost.');
  });

  socket.addEventListener('message', (event) => {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    console.warn('[socket] failed to parse incoming message', event.data);
    return;
  }

  if (payload.type === 'welcome') {
    state.playerId = payload.playerId;
    localAvatarParts.setName(`You (${payload.displayName || payload.playerId})`);
    if (payload.displayName) {
      localStorage.setItem('arena_last_name', payload.displayName);
    }
    void syncWalletSummary({ keepLastOnFailure: true });
    return;
  }

  if (payload.type === 'snapshot') {
    state.tick = payload.tick;
    const seen = new Set();

    for (const player of payload.players) {
      seen.add(player.id);
      const existing = state.players.get(player.id);
      const normalized = normalizeSnapshotPlayer(player, existing);
      if (!existing) {
        state.players.set(player.id, {
          id: player.id,
          x: normalized.x,
          y: normalized.y,
          z: normalized.z,
          yaw: normalized.yaw,
          speed: normalized.speed,
          role: normalized.role,
          displayName: normalized.displayName,
          displayX: normalized.x,
          displayY: normalized.y,
          displayZ: normalized.z,
          displayYaw: normalized.yaw
        });
      } else {
        existing.x = normalized.x;
        existing.y = normalized.y;
        existing.z = normalized.z;
        existing.yaw = normalized.yaw;
        existing.speed = normalized.speed;
        existing.role = normalized.role;
        existing.displayName = normalized.displayName;
      }
    }

    const stationSeen = new Set();
    if (Array.isArray(payload.stations)) {
      for (const station of payload.stations) {
        if (!station || typeof station.id !== 'string') continue;
        stationSeen.add(station.id);
        state.serverStations.set(station.id, copyStationFromPayload(station));
      }
    }
    for (const id of [...state.serverStations.keys()]) {
      if (!stationSeen.has(id)) {
        state.serverStations.delete(id);
      }
    }
    remapLocalStationProxies();
    mergeStations();

    for (const id of [...state.players.keys()]) {
      if (!seen.has(id)) {
        state.players.delete(id);
        const remote = remoteAvatars.get(id);
        if (remote) {
          scene.remove(remote.avatar);
          remoteAvatars.delete(id);
        }
      }
    }

    updateRpsVisibility();
    return;
  }

  if (payload.type === 'proximity' && typeof payload.otherId === 'string') {
    if (payload.event === 'enter') {
      state.nearbyIds.add(payload.otherId);
      if (typeof payload.otherName === 'string') {
        state.nearbyNames.set(payload.otherId, payload.otherName);
      }
      if (typeof payload.distance === 'number') {
        state.nearbyDistances.set(payload.otherId, payload.distance);
      }
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} entered range.`);
    }
    if (payload.event === 'exit') {
      state.nearbyIds.delete(payload.otherId);
      state.nearbyNames.delete(payload.otherId);
      state.nearbyDistances.delete(payload.otherId);
      addFeedEvent('proximity', `${payload.otherName || payload.otherId} left range.`);
    }
    return;
  }

  if (payload.type === 'station_ui' && typeof payload.stationId === 'string') {
    const localStationId = resolveIncomingStationId(payload.stationId);
    const view = payload.view || {};
    const ok = Boolean(view.ok);
    const reason = String(view.reason || '');
    const reasonCode = String(view.reasonCode || '');
    const reasonText = String(view.reasonText || '');
    const preflight = view.preflight && typeof view.preflight === 'object'
      ? {
          playerOk: Boolean(view.preflight.playerOk),
          houseOk: Boolean(view.preflight.houseOk)
        }
      : null;
    const stateName = String(view.state || '');
    const station = state.stations instanceof Map ? state.stations.get(localStationId) : null;
    if (station?.kind === 'dealer_prediction' || stateName.startsWith('prediction_')) {
      const prediction = state.ui.prediction || (state.ui.prediction = {
        stationId: '',
        state: 'idle',
        markets: [],
        positions: [],
        selectedRail: 'btc_5m',
        selectedRound: 'current',
        selectedMarketId: '',
        positionStatus: '',
        lastReason: '',
        lastReasonText: ''
      });
      prediction.stationId = localStationId || payload.stationId;
      if (!ok) {
        const resolvedReasonText = reasonText || dealerReasonLabel(reason, reasonCode) || 'Prediction request failed. Please retry.';
        prediction.state = 'error';
        prediction.lastReason = reason || 'prediction_request_failed';
        prediction.lastReasonText = resolvedReasonText;
        showToast(resolvedReasonText, 'warning');
        return;
      }
      if (stateName === 'prediction_list') {
        prediction.state = 'list';
        prediction.markets = Array.isArray(view.markets) ? view.markets : [];
        if (!prediction.selectedMarketId && prediction.markets[0]?.marketId) {
          prediction.selectedMarketId = String(prediction.markets[0].marketId);
        }
        if (!prediction.selectedRound && prediction.markets[0]?.roundType) {
          prediction.selectedRound = String(prediction.markets[0].roundType || 'current') === 'next' ? 'next' : 'current';
        }
        prediction.lastReason = '';
        prediction.lastReasonText = '';
        return;
      }
      if (stateName === 'prediction_order_pending') {
        prediction.state = 'pending';
        prediction.selectedMarketId = String(view.marketId || prediction.selectedMarketId || '');
        return;
      }
      if (stateName === 'prediction_order_filled') {
        prediction.state = 'filled';
        prediction.selectedMarketId = String(view.marketId || prediction.selectedMarketId || '');
        prediction.positionStatus = String(view.positionStatus || '');
        if (Array.isArray(view.positions) && view.positions.length > 0) {
          prediction.positions = view.positions;
        }
        showToast('Prediction order filled.');
        return;
      }
      if (stateName === 'prediction_settle') {
        prediction.state = 'settled';
        if (Array.isArray(view.positions)) {
          prediction.positions = view.positions;
        }
        return;
      }
      return;
    }
    if (station?.kind === 'world_interactable') {
      const method = String(view.method || '');
      const useLabel = String(view.reasonText || 'Use');
      state.ui.world.stationId = localStationId || payload.stationId;
      state.ui.world.interactionTag = String(view.reasonCode || station.interactionTag || '');
      state.ui.world.title = station.displayName || 'World Interaction';
      state.ui.world.detail = method || useLabel || 'Interaction ready.';
      state.ui.world.actionLabel = stateName === 'dealer_reveal' ? 'Used' : useLabel;
      if (!ok || stateName === 'dealer_error') {
        showToast(state.ui.world.detail || 'Interaction failed.');
      }
      return;
    }
    if (!ok || stateName === 'dealer_error') {
      const resolvedReasonText = reasonText || dealerReasonLabel(reason, reasonCode) || 'Station request failed. Please retry.';
      state.ui.dealer.state = 'error';
      state.ui.dealer.reason = reason || 'request_failed';
      state.ui.dealer.reasonCode = reasonCode;
      state.ui.dealer.reasonText = resolvedReasonText;
      state.ui.dealer.preflight = preflight;
      addFeedEvent(
        'system',
        `Station ${labelFor(localStationId || payload.stationId)}: ${resolvedReasonText}`
      );
      showToast(resolvedReasonText, 'warning');
      return;
    }
    if (stateName === 'dealer_ready' || stateName === 'dealer_ready_rps' || stateName === 'dealer_ready_dice' || stateName === 'dealer_ready_dice_duel') {
      state.quickstart.challengeSent = true;
      state.ui.dealer.stationId = localStationId || payload.stationId;
      state.ui.dealer.state = 'ready';
      state.ui.dealer.gameType = deriveDealerGameType(stateName, view, station);
      state.ui.dealer.reason = '';
      state.ui.dealer.reasonCode = '';
      state.ui.dealer.reasonText = '';
      state.ui.dealer.preflight = { playerOk: true, houseOk: true };
      state.ui.dealer.wager = Number(view.wager ?? state.ui.dealer.wager ?? 1);
      state.ui.dealer.commitHash = String(view.commitHash || '');
      state.ui.dealer.method = String(view.method || '');
      return;
    }
    if (stateName === 'dealer_dealing') {
      state.quickstart.matchActive = true;
      state.ui.dealer.state = 'dealing';
      return;
    }
    if (stateName === 'dealer_reveal' || stateName === 'dealer_reveal_rps' || stateName === 'dealer_reveal_dice' || stateName === 'dealer_reveal_dice_duel') {
      state.quickstart.matchResolved = true;
      state.ui.dealer.state = 'reveal';
      state.ui.dealer.gameType = deriveDealerGameType(stateName, view, station);
      state.ui.dealer.reason = '';
      state.ui.dealer.reasonCode = '';
      state.ui.dealer.reasonText = '';
      state.ui.dealer.challengeId = String(view.challengeId || '');
      state.ui.dealer.playerPick = String(view.playerPick || '');
      state.ui.dealer.opponentPick = String(view.opponentPick || '');
      state.ui.dealer.coinflipResult = String(view.coinflipResult || '');
      state.ui.dealer.diceResult = Number(view.diceResult || 0);
      state.ui.dealer.payoutDelta = Number(view.payoutDelta || 0);
      state.ui.dealer.escrowTx = view.escrowTx || null;
      const winnerId = String(view.winnerId || '');
      const won = winnerId && winnerId === state.playerId;
      const tone = won ? 'win' : (winnerId ? 'loss' : 'neutral');
      const title = won ? 'YOU WIN' : (winnerId ? 'YOU LOSE' : 'DRAW');
      const tossLine = state.ui.dealer.coinflipResult ? `\nTOSS: ${state.ui.dealer.coinflipResult.toUpperCase()}` : '';
      const delta = state.ui.dealer.payoutDelta;
      showResultSplash(`${title}${tossLine}\n${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, tone);
      void refreshWalletBalanceAndShowDelta(state.walletBalance, null);
      return;
    }
    return;
  }

  if (payload.type === 'provably_fair' && typeof payload.challengeId === 'string') {
    const phase = String(payload.phase || '');
    if (phase === 'commit') {
      addFeedEvent('system', `Provably fair commit for ${payload.challengeId}: ${String(payload.commitHash || '').slice(0, 10)}...`);
      return;
    }
    if (phase === 'reveal') {
      addFeedEvent('system', `Provably fair reveal for ${payload.challengeId}: seed=${String(payload.houseSeed || '').slice(0, 10)}...`);
      return;
    }
    return;
  }

  if (payload.type === 'challenge') {
    const challenge = payload.challenge || null;
    if (challenge && state.playerId) {
      const involvesMe =
        challenge.challengerId === state.playerId || challenge.opponentId === state.playerId;
      const activeId = state.activeChallenge?.id || '';
      const incomingId = state.incomingChallengeId || '';
      const outgoingId = state.outgoingChallengeId || '';
      const isKnown =
        challenge.id === activeId || challenge.id === incomingId || challenge.id === outgoingId;
      if (!involvesMe && !isKnown) {
        return;
      }
    }
    handleChallenge(payload);
    return;
  }

  if (payload.type === 'challenge_feed' && payload.event) {
    if (payload.event === 'busy') {
      const reason = String(payload.reason || '');
      const message = typeof challengeReasonLabel === 'function'
        ? String(challengeReasonLabel(reason) || '')
        : '';
      const fallback = reason === 'player_busy'
        ? 'Target is already in a match.'
        : (reason ? `Challenge unavailable: ${reason}` : 'Challenge unavailable right now.');
      const resolved = message || fallback;
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'declined',
        message: resolved
      });
      showToast(resolved, 'warning');
    }

    const challenge = payload.challenge || null;
    if (challenge && state.playerId) {
      const involvesMe =
        challenge.challengerId === state.playerId || challenge.opponentId === state.playerId;
      if (!involvesMe) {
        return;
      }
    }
    const line = payload.challenge
      ? `${payload.event} ${payload.challenge.gameType} ${labelFor(payload.challenge.challengerId)} vs ${labelFor(payload.challenge.opponentId)}${payload.challenge.winnerId ? ` winner=${labelFor(payload.challenge.winnerId)}` : ''}`
      : `${payload.event}${payload.reason ? ` (${payload.reason})` : ''}`;
    addFeedEvent('match', line);
    return;
  }

  if (payload.type === 'challenge_escrow' && typeof payload.challengeId === 'string') {
    const activeId = state.activeChallenge?.id || '';
    const incomingId = state.incomingChallengeId || '';
    const outgoingId = state.outgoingChallengeId || '';
    if (payload.challengeId !== activeId && payload.challengeId !== incomingId && payload.challengeId !== outgoingId) {
      return;
    }
    const phase = String(payload.phase || 'escrow');
    const ok = payload.ok !== false;
    const tx = typeof payload.txHash === 'string' ? payload.txHash : '';
    const phaseLabel =
      phase === 'lock' ? 'Stake lock' : phase === 'resolve' ? 'Payout' : phase === 'refund' ? 'Refund' : 'Escrow';
    const statusLabel = ok ? (phase === 'resolve' ? 'cleared' : 'sealed') : 'stalled';
    const payout =
      typeof payload.payout === 'number' ? ` payout=${Number(payload.payout).toFixed(2)}` : '';
    const fee =
      typeof payload.fee === 'number' ? ` fee=${Number(payload.fee).toFixed(2)}` : '';
    const reason = payload.reason ? ` (${payload.reason})` : '';
    addFeedEvent('escrow', `${phaseLabel} ${statusLabel}${payout}${fee}${reason}`, {
      txHash: tx || null,
      phase,
      ok
    });
    if (!ok && phase === 'lock') {
      dispatch({
        type: 'CHALLENGE_STATUS_SET',
        status: 'declined',
        message: `Escrow lock failed${reason}.`
      });
    }
  }
  });
}
