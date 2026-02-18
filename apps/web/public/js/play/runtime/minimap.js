import { WORLD_BOUND } from '../state.js';

const minimapStateByCanvas = new WeakMap();

function mapPointToWorld(canvas, x, y) {
  return {
    worldX: (x / canvas.width) * (WORLD_BOUND * 2) - WORLD_BOUND,
    worldZ: (y / canvas.height) * (WORLD_BOUND * 2) - WORLD_BOUND
  };
}

function bindMinimapHover(worldMapCanvas) {
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) return;
  if (worldMapCanvas.dataset.hoverBound === '1') return;
  worldMapCanvas.dataset.hoverBound = '1';

  worldMapCanvas.addEventListener('mousemove', (event) => {
    const state = minimapStateByCanvas.get(worldMapCanvas);
    if (!state || !(state.players instanceof Map)) return;

    const rect = worldMapCanvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * worldMapCanvas.width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * worldMapCanvas.height;
    const { worldX, worldZ } = mapPointToWorld(worldMapCanvas, x, y);
    let nearest = null;
    let nearestDistance = 7.5;

    for (const player of state.players.values()) {
      const dx = Number(player.x) - worldX;
      const dz = Number(player.z) - worldZ;
      const distance = Math.hypot(dx, dz);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = player;
      }
    }

    worldMapCanvas.title = nearest
      ? String(nearest.displayName || nearest.id || 'Player')
      : 'Arena minimap';
  });

  worldMapCanvas.addEventListener('mouseleave', () => {
    worldMapCanvas.title = 'Arena minimap';
  });
}

export function renderMinimap(state, worldMapCanvas, mapCoords) {
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) {
    return;
  }
  minimapStateByCanvas.set(worldMapCanvas, state);
  bindMinimapHover(worldMapCanvas);

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
      mapCoords.textContent = `X:${Math.round(self.x)} Z:${Math.round(self.z)}`;
    }
  }
}
