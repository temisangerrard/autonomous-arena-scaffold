export function createStationRouting(params) {
  const {
    state,
    hostStationProxyMap
  } = params;

  const MAX_BAKED_PROXY_DISTANCE = 12;
  const localStationToProxy = new Map();
  const proxyToLocalStations = new Map();

  function copyStationFromPayload(station) {
    return {
      id: String(station.id || ''),
      kind: String(station.kind || ''),
      displayName: String(station.displayName || station.id || ''),
      x: Number(station.x || 0),
      z: Number(station.z || 0),
      yaw: Number(station.yaw || 0),
      radius: Number(station.radius || 0),
      interactionTag: String(station.interactionTag || ''),
      actions: Array.isArray(station.actions) ? station.actions.map((action) => String(action)) : []
    };
  }

  function nearestServerStationForKind(kind, x, z) {
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const station of state.serverStations.values()) {
      if (station.kind !== kind) continue;
      const dist = Math.hypot(Number(station.x || 0) - Number(x || 0), Number(station.z || 0) - Number(z || 0));
      if (dist < bestDist) {
        bestDist = dist;
        best = station;
      }
    }
    return best;
  }

  function rebuildLocalStationProxyIndex() {
    localStationToProxy.clear();
    proxyToLocalStations.clear();
    for (const station of [...state.hostStations.values(), ...state.bakedStations.values()]) {
      const proxyId = String(station.proxyStationId || '').trim();
      if (!proxyId) continue;
      localStationToProxy.set(station.id, proxyId);
      if (!proxyToLocalStations.has(proxyId)) {
        proxyToLocalStations.set(proxyId, []);
      }
      proxyToLocalStations.get(proxyId).push(station.id);
    }
  }

  function remapLocalStationProxies() {
    for (const station of state.hostStations.values()) {
      const explicitProxyId = hostStationProxyMap[station.id] || '';
      if (explicitProxyId) {
        const target = state.serverStations.get(explicitProxyId) || null;
        station.proxyStationId = target && target.kind === station.kind ? target.id : '';
        station.proxyMissing = !station.proxyStationId;
        station.proxyEligible = Boolean(station.proxyStationId);
        station.proxyDistance = station.proxyStationId
          ? Math.hypot(
              Number(station.x || 0) - Number(target?.x || 0),
              Number(station.z || 0) - Number(target?.z || 0)
            )
          : null;
        station.fallbackReason = station.proxyStationId ? '' : 'no_matching_station';
        if (!station.proxyStationId) {
          console.warn('host station proxy missing', {
            hostStationId: station.id,
            expectedProxyId: explicitProxyId,
            kind: station.kind
          });
        }
      } else {
        station.proxyStationId = '';
        station.proxyMissing = false;
        station.proxyEligible = true;
        station.proxyDistance = null;
        station.fallbackReason = '';
      }
    }
    for (const station of state.bakedStations.values()) {
      const nearest = nearestServerStationForKind(station.kind, station.x, station.z);
      const distance = nearest
        ? Math.hypot(
            Number(station.x || 0) - Number(nearest.x || 0),
            Number(station.z || 0) - Number(nearest.z || 0)
          )
        : Number.POSITIVE_INFINITY;
      const withinRange = Boolean(nearest) && distance <= MAX_BAKED_PROXY_DISTANCE;
      station.proxyEligible = withinRange;
      station.proxyDistance = Number.isFinite(distance) ? distance : null;
      station.proxyStationId = withinRange && nearest ? nearest.id : '';
      station.proxyMissing = !station.proxyStationId;
      station.fallbackReason = station.proxyStationId
        ? ''
        : (nearest ? 'proxy_too_far' : 'no_matching_station');
    }
    rebuildLocalStationProxyIndex();
  }

  function mergeStations() {
    const merged = new Map();
    for (const station of state.serverStations.values()) {
      merged.set(station.id, { ...station, source: 'server' });
    }
    for (const station of state.hostStations.values()) {
      merged.set(station.id, station);
    }
    for (const station of state.bakedStations.values()) {
      merged.set(station.id, station);
    }
    state.stations = merged;
  }

  function resolveStationIdForSend(stationOrId) {
    const stationObj = stationOrId && typeof stationOrId === 'object' ? stationOrId : null;
    const id = stationObj ? String(stationObj.id || '') : String(stationOrId || '');
    if (!id) return '';

    const station = stationObj || (state.stations instanceof Map ? state.stations.get(id) : null);
    if (station?.source === 'baked' && station?.kind !== 'world_interactable' && !station?.proxyStationId) {
      return '';
    }
    const mappedProxyId = localStationToProxy.get(id) || '';
    if (mappedProxyId) {
      // Prefer the mapped proxy even when it's absent from the snapshot —
      // world_interactable stations are filtered out of the snapshot on some
      // server configs but the server still handles their station_interact calls.
      return mappedProxyId;
    }

    // For host/baked stations, prefer the nearest live server station of the same kind
    // relative to the player's current position to avoid stale/far proxy mismatches.
    if (station?.kind && station?.source !== 'baked') {
      const me = state.playerId ? state.players.get(state.playerId) : null;
      const originX = Number(
        me?.x
        ?? me?.displayX
        ?? station.x
        ?? 0
      );
      const originZ = Number(
        me?.z
        ?? me?.displayZ
        ?? station.z
        ?? 0
      );
      const nearest = nearestServerStationForKind(station.kind, originX, originZ);
      if (nearest?.id) {
        return nearest.id;
      }
    }

    return id;
  }

  function resolveIncomingStationId(stationId) {
    const incomingId = String(stationId || '');
    if (!incomingId) return '';
    if (state.stations.has(incomingId)) return incomingId;

    const activeTarget = String(state.ui?.targetId || '');
    if (activeTarget && localStationToProxy.get(activeTarget) === incomingId) {
      return activeTarget;
    }
    const dealerTarget = String(state.ui?.dealer?.stationId || '');
    if (dealerTarget && localStationToProxy.get(dealerTarget) === incomingId) {
      return dealerTarget;
    }
    const options = proxyToLocalStations.get(incomingId);
    if (Array.isArray(options) && options.length > 0) {
      return options[0];
    }
    return incomingId;
  }

  return {
    copyStationFromPayload,
    remapLocalStationProxies,
    mergeStations,
    resolveStationIdForSend,
    resolveIncomingStationId
  };
}
