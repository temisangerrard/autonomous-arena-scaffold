export function createTargetingController(params) {
  const {
    state,
    isStation
  } = params;

  function closestNearbyTargetId() {
    const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
    if (state.nearbyIds.size === 0 && nearbyStations.size === 0) {
      return '';
    }
    let bestId = '';
    let bestDist = Number.POSITIVE_INFINITY;
    for (const id of [...state.nearbyIds, ...nearbyStations]) {
      const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
      if (distance < bestDist) {
        bestDist = distance;
        bestId = id;
      }
    }
    return bestId || [...state.nearbyIds][0] || [...nearbyStations][0] || '';
  }

  function closestNearbyPlayerId() {
    if (state.nearbyIds.size === 0) {
      return '';
    }
    let bestId = '';
    let bestDist = Number.POSITIVE_INFINITY;
    for (const id of state.nearbyIds) {
      const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
      if (distance < bestDist) {
        bestDist = distance;
        bestId = id;
      }
    }
    return bestId || [...state.nearbyIds][0] || '';
  }

  function closestNearbyStationId() {
    const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
    if (nearbyStations.size === 0) {
      return '';
    }
    let bestId = '';
    let bestDist = Number.POSITIVE_INFINITY;
    let bestRank = Number.POSITIVE_INFINITY;
    const sourceRank = (stationId) => {
      const station = state.stations instanceof Map ? state.stations.get(stationId) : null;
      if (station?.source === 'host') return 0;
      if (station?.source === 'server') return 1;
      if (station?.source === 'baked') return 2;
      return 3;
    };
    for (const id of nearbyStations) {
      const distance = Number(state.nearbyDistances.get(id) ?? Number.POSITIVE_INFINITY);
      const rank = sourceRank(id);
      if (rank < bestRank || (rank === bestRank && distance < bestDist)) {
        bestRank = rank;
        bestDist = distance;
        bestId = id;
      }
    }
    return bestId || [...nearbyStations][0] || '';
  }

  function getUiTargetId() {
    if (state.ui?.interactOpen && state.ui?.interactionMode === 'station') {
      const preferred = state.ui?.targetId || '';
      if (preferred && isStation(preferred) && state.nearbyStationIds.has(preferred)) {
        return preferred;
      }
      const stationId = closestNearbyStationId();
      if (stationId) {
        state.ui.targetId = stationId;
        return stationId;
      }
    }
    if (state.ui?.interactOpen && state.ui?.interactionMode === 'player') {
      const preferred = state.ui?.targetId || '';
      if (preferred && !isStation(preferred) && state.nearbyIds.has(preferred)) {
        return preferred;
      }
      const playerId = closestNearbyPlayerId();
      if (playerId) {
        state.ui.targetId = playerId;
        return playerId;
      }
    }
    const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
    const preferred = state.ui?.targetId || '';
    if (preferred && (state.nearbyIds.has(preferred) || nearbyStations.has(preferred))) {
      return preferred;
    }
    const closest = closestNearbyTargetId();
    if (closest) {
      state.ui.targetId = closest;
    }
    return closest;
  }

  function cycleNearbyTarget(next = true) {
    const nearbyStations = state.nearbyStationIds instanceof Set ? state.nearbyStationIds : new Set();
    const ids = [...state.nearbyIds, ...nearbyStations];
    if (ids.length === 0) {
      state.ui.targetId = '';
      return;
    }
    ids.sort((a, b) => Number(state.nearbyDistances.get(a) ?? 9999) - Number(state.nearbyDistances.get(b) ?? 9999));
    const current = state.ui.targetId && ids.includes(state.ui.targetId) ? state.ui.targetId : ids[0];
    const idx = Math.max(0, ids.indexOf(current));
    const nextIdx = (idx + (next ? 1 : -1) + ids.length) % ids.length;
    state.ui.targetId = ids[nextIdx] || ids[0];
    if (state.ui.interactOpen) {
      state.ui.interactionMode = isStation(state.ui.targetId) ? 'station' : 'player';
    }
  }

  function refreshNearbyDistances() {
    const selfId = state.playerId;
    if (!selfId) {
      return;
    }
    const self = state.players.get(selfId);
    if (!self) {
      return;
    }
    for (const id of state.nearbyIds) {
      const other = state.players.get(id);
      if (!other) {
        continue;
      }
      state.nearbyDistances.set(id, Math.hypot(other.x - self.x, other.z - self.z));
    }
  }

  function syncNearbyStations() {
    const selfId = state.playerId;
    if (!selfId) return;
    const self = state.players.get(selfId);
    if (!self) return;
    if (!(state.stations instanceof Map)) {
      state.stations = new Map();
    }
    if (!(state.nearbyStationIds instanceof Set)) {
      state.nearbyStationIds = new Set();
    }

    const next = new Set();
    for (const station of state.stations.values()) {
      const distance = Math.hypot(station.x - self.x, station.z - self.z);
      const threshold = Number.isFinite(Number(station.radius)) && Number(station.radius) > 0
        ? Number(station.radius)
        : 8;
      if (distance <= threshold) {
        next.add(station.id);
        state.nearbyDistances.set(station.id, distance);
      }
    }

    for (const id of state.nearbyStationIds) {
      if (!next.has(id)) {
        state.nearbyDistances.delete(id);
      }
    }
    state.nearbyStationIds = next;
  }

  return {
    closestNearbyTargetId,
    closestNearbyPlayerId,
    closestNearbyStationId,
    getUiTargetId,
    cycleNearbyTarget,
    refreshNearbyDistances,
    syncNearbyStations
  };
}
