export function renderWorldMapPanel(params) {
  const {
    state,
    worldMapCanvas,
    mapCoords,
    worldBound
  } = params;
  if (!(worldMapCanvas instanceof HTMLCanvasElement)) {
    return;
  }
  const ctx = worldMapCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const { width, height } = worldMapCanvas;
  ctx.clearRect(0, 0, width, height);

  // Soft paper-like field background.
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, 'rgba(255,255,251,0.98)');
  bg.addColorStop(1, 'rgba(243,234,208,0.95)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle centre crosshair — helps orient the map.
  ctx.strokeStyle = 'rgba(168, 130, 24, 0.22)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();

  // Compass labels: N top-centre, S bottom-centre, W left, E right.
  ctx.font = 'bold 9px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(91, 72, 20, 0.55)';
  ctx.textAlign = 'center';
  ctx.fillText('N', width / 2, 10);
  ctx.fillText('S', width / 2, height - 3);
  ctx.textAlign = 'left';
  ctx.fillText('W', 3, height / 2 - 2);
  ctx.textAlign = 'right';
  ctx.fillText('E', width - 3, height / 2 - 2);
  ctx.textAlign = 'left';

  for (const player of state.players.values()) {
    const x = ((player.x + worldBound) / (worldBound * 2)) * width;
    const y = ((player.z + worldBound) / (worldBound * 2)) * height;

    const isSelf = player.id === state.playerId;
    const role = player.role ?? 'human';

    ctx.beginPath();
    ctx.arc(x, y, isSelf ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? '#2f6dff' : role === 'agent' ? '#b4792a' : '#4f8a63';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const STATION_LABELS = {
    station_world_info_a: 'INFO',
    station_cashier_bank: 'CASH',
    station_dealer_coinflip_a: 'FLIP',
    station_dealer_rps_a: 'RPS',
    station_dealer_dice_a: 'DICE',
    station_dealer_blackjack_a: 'BJ',
    station_dealer_prediction_a: 'PRED'
  };

  if (state.stations instanceof Map) {
    for (const station of state.stations.values()) {
      const x = ((station.x + worldBound) / (worldBound * 2)) * width;
      const y = ((station.z + worldBound) / (worldBound * 2)) * height;
      const size = 6;
      ctx.beginPath();
      ctx.rect(x - size / 2, y - size / 2, size, size);
      ctx.fillStyle = station.kind === 'cashier_bank'
        ? 'rgba(47, 109, 255, 0.92)'
        : station.kind === 'dealer_prediction'
          ? 'rgba(95, 141, 255, 0.92)'
        : station.kind === 'dealer_blackjack'
          ? 'rgba(155, 89, 182, 0.92)'
        : station.kind === 'world_interactable'
          ? 'rgba(120, 196, 163, 0.92)'
          : 'rgba(243, 156, 18, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Station label — offset right of the square, avoid canvas edges.
      const label = STATION_LABELS[station.id] || station.displayName?.slice(0, 4).toUpperCase() || '';
      if (label) {
        ctx.font = '7px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(60, 42, 10, 0.85)';
        ctx.textAlign = 'left';
        const lx = Math.min(x + size / 2 + 2, width - 24);
        const ly = y + 3;
        ctx.fillText(label, lx, ly);
      }
    }
  }

  if (state.playerId) {
    const self = state.players.get(state.playerId);
    if (self && mapCoords) {
      mapCoords.textContent = `x:${Math.round(self.x)} z:${Math.round(self.z)}`;
    }
  }
}
