/**
 * World Points of Interest
 * Four named vantage points in the current arena footprint.
 * Each POI has a floating label sprite and a proximity HUD panel (DOM).
 * Enters "active" glow when live data is available nearby.
 */

const POI_DEFS = [
  {
    id: 'prediction_overlook',
    label: 'PREDICTION OVERLOOK',
    x: 0,
    y: 3.5,
    z: 58,
    radius: 6,
    hudTitle: 'Prediction Markets',
    getContent: (state) => {
      const pred = state.ui?.prediction;
      const markets = pred?.markets ?? [];
      if (markets.length === 0) return 'No open markets right now.';
      const m = markets[0];
      const yesP = ((m.yesPrice || 0) * 100).toFixed(0);
      const noP = ((m.noPrice || 0) * 100).toFixed(0);
      return `${m.question || 'Live market'}\nYES ${yesP}\u00A2  \u00B7  NO ${noP}\u00A2`;
    }
  },
  {
    id: 'high_roller_corner',
    label: 'HIGH-ROLLER CORNER',
    x: 45,
    y: 3.5,
    z: -35,
    radius: 6,
    hudTitle: 'High-Roller Stats',
    getContent: (state) => {
      const feed = state.feedSummary;
      if (!feed) return 'No big wins recorded yet today.';
      const parts = [];
      if (feed.biggestWinToday) {
        const { displayName, wager } = feed.biggestWinToday;
        parts.push(`Top Win: ${displayName}  +$${Number(wager || 0).toFixed(2)}`);
      }
      if (feed.hottestStreak) {
        const { displayName, streak } = feed.hottestStreak;
        parts.push(`Hot Streak: ${displayName}  ${streak}W`);
      }
      return parts.length ? parts.join('\n') : 'Be the first on the board.';
    }
  },
  {
    id: 'bot_spectator_rail',
    label: 'BOT SPECTATOR RAIL',
    x: -50,
    y: 3.5,
    z: 0,
    radius: 6,
    hudTitle: 'Agent Activity',
    getContent: (state) => {
      const bots = [...(state.players?.values() ?? [])].filter(
        (p) => p.role === 'agent' || p.actorClass === 'owner_bot' || p.actorClass === 'background_bot'
      );
      if (bots.length === 0) return 'No agents currently online.';
      const lines = bots.slice(0, 4).map((b) => {
        const cls = b.actorClass === 'owner_bot' ? 'OWNER' : 'AGENT';
        return `${b.displayName || b.id}  [${cls}]`;
      });
      if (bots.length > 4) lines.push(`+${bots.length - 4} more`);
      return lines.join('\n');
    }
  },
  {
    id: 'cashier_overlook',
    label: 'CASHIER OVERLOOK',
    x: 42,
    y: 3.5,
    z: 25,
    radius: 6,
    hudTitle: 'Treasury Flow',
    getContent: (state) => {
      const feed = state.feedSummary;
      if (!feed) return 'Treasury data loading...';
      if (feed.treasurySnapshot) {
        const { lockedTotal, resolvedToday } = feed.treasurySnapshot;
        return `Locked in escrow:  $${Number(lockedTotal || 0).toFixed(2)}\nResolved today:   $${Number(resolvedToday || 0).toFixed(2)}`;
      }
      return 'Cashier station: track all house flows here.';
    }
  }
];

function createPoiLabel(THREE, scene, poi) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 36;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(active) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = active ? 'rgba(47,143,94,0.85)' : 'rgba(30,28,20,0.82)';
    ctx.beginPath();
    ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, canvas.height / 2);
    ctx.fill();
    ctx.strokeStyle = active ? '#f2d27a' : 'rgba(47,143,94,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = active ? '#1a1000' : '#2f8f5e';
    ctx.font = 'bold 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(poi.label, canvas.width / 2, canvas.height / 2 + 0.5);
    texture.needsUpdate = true;
  }

  draw(false);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  sprite.scale.set(3.2, 0.45, 1);
  sprite.position.set(poi.x, poi.y + 1.2, poi.z);
  scene.add(sprite);

  return { redraw: draw };
}

function createHudPanel(poi) {
  const panel = document.createElement('div');
  panel.dataset.poiId = poi.id;
  panel.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:120px',
    'transform:translateX(-50%)',
    'background:rgba(18,16,10,0.92)',
    'border:1px solid rgba(47,143,94,0.45)',
    'border-radius:8px',
    'padding:12px 20px',
    'font-family:"IBM Plex Mono",monospace',
    'font-size:12px',
    'color:#2f8f5e',
    'white-space:pre-line',
    'pointer-events:none',
    'z-index:800',
    'display:none',
    'max-width:340px',
    'text-align:center'
  ].join(';');

  const titleEl = document.createElement('strong');
  titleEl.style.cssText = 'color:#9ad4b4;display:block;margin-bottom:6px';
  titleEl.textContent = poi.hudTitle;

  const bodyEl = document.createElement('span');

  panel.appendChild(titleEl);
  panel.appendChild(bodyEl);
  document.body.appendChild(panel);

  return {
    show(content) {
      bodyEl.textContent = content;
      panel.style.display = 'block';
    },
    hide() {
      panel.style.display = 'none';
    }
  };
}

export function createWorldPoi({ THREE, scene }) {
  const pois = POI_DEFS.map((def) => {
    const label = createPoiLabel(THREE, scene, def);
    const hud = createHudPanel(def);
    return { def, label, hud, lastActive: false };
  });

  function update(state) {
    const playerId = state.playerId;
    const player = playerId ? state.players?.get(playerId) : null;
    const px = player?.displayX ?? player?.x ?? 0;
    const pz = player?.displayZ ?? player?.z ?? 0;

    for (const poi of pois) {
      const { def, label, hud } = poi;
      const dx = px - def.x;
      const dz = pz - def.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const inRadius = dist < def.radius;

      // Active glow when there is any live data
      const hasLiveData = Boolean(
        state.feedSummary ||
        (state.ui?.prediction?.markets?.length ?? 0) > 0 ||
        [...(state.players?.values() ?? [])].some((p) => p.role === 'agent')
      );

      if (hasLiveData !== poi.lastActive) {
        poi.lastActive = hasLiveData;
        label.redraw(hasLiveData);
      }

      if (inRadius) {
        hud.show(def.getContent(state));
      } else {
        hud.hide();
      }
    }
  }

  return { update };
}
