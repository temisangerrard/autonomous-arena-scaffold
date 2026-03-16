export function isStationId(id) {
  return typeof id === 'string' && id.startsWith('station_');
}

export function createLabelFor(state) {
  return function labelFor(id) {
    if (!id) {
      return 'Unknown';
    }
    if (id === state.playerId) {
      return 'You';
    }
    const player = state.players.get(id);
    const station = state.stations instanceof Map ? state.stations.get(id) : null;
    if (station?.displayName) {
      return station.displayName;
    }
    const ownerProfileId = String(player?.ownerProfileId || '').trim();
    const currentProfileId = String(state?.playerShellData?.player?.id || '').trim();
    const displayName = player?.displayName || state.nearbyNames.get(id) || id;
    const actorClass = String(player?.actorClass || '').trim().toLowerCase();
    if (ownerProfileId && currentProfileId && ownerProfileId === currentProfileId) {
      return 'Your Bot';
    }
    if (actorClass === 'owner_bot') {
      return `${displayName} (Player Bot)`;
    }
    if (actorClass === 'background_bot') {
      return `${displayName} (House Bot)`;
    }
    return displayName;
  };
}
