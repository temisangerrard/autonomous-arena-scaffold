import { WORLD_BOUND } from '../state.js';

export function renderMinimap(state, worldMapCanvas, mapCoords) {
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) {
    return;
  }
  const ctx = worldMapCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const { width, height } = worldMapCanvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,251,0.98)';
  ctx.fillRect(0, 0, width, height);

  for (const player of state.players.values()) {
    const x = ((player.x + WORLD_BOUND) / (WORLD_BOUND * 2)) * width;
    const y = ((player.z + WORLD_BOUND) / (WORLD_BOUND * 2)) * height;
    const isSelf = player.id === state.playerId;
    ctx.beginPath();
    ctx.arc(x, y, isSelf ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? '#2f6dff' : '#4f8a63';
    ctx.fill();
  }

  if (state.stations instanceof Map) {
    for (const station of state.stations.values()) {
      const x = ((station.x + WORLD_BOUND) / (WORLD_BOUND * 2)) * width;
      const y = ((station.z + WORLD_BOUND) / (WORLD_BOUND * 2)) * height;
      ctx.fillStyle = station.kind === 'cashier_bank' ? 'rgba(47,109,255,.9)' : 'rgba(243,156,18,.9)';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  }

  if (state.playerId) {
    const self = state.players.get(state.playerId);
    if (self && mapCoords) {
      mapCoords.textContent = `x:${Math.round(self.x)} z:${Math.round(self.z)}`;
    }
  }
}
