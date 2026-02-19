export function isStationId(id) {
  return typeof id === 'string' && id.startsWith('station_');
}

export function createLabelFor(state) {
  return function labelFor(id) {
    if (!id) {
      return 'Unknown';
    }
    const player = state.players.get(id);
    const station = state.stations instanceof Map ? state.stations.get(id) : null;
    if (station?.displayName) {
      return station.displayName;
    }
    return player?.displayName || state.nearbyNames.get(id) || id;
  };
}
