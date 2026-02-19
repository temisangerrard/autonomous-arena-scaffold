export function updateLocalAvatarRuntime(params) {
  const {
    state,
    asFiniteNumber,
    normalizeYaw,
    sanitizeRenderY,
    localAvatarParts,
    avatarGroundOffset,
    animateAvatar,
    cameraController,
    nowMs
  } = params;

  if (!state.playerId) {
    return;
  }

  const local = state.players.get(state.playerId);
  if (!local) {
    return;
  }

  if (!Number.isFinite(local.displayX) || !Number.isFinite(local.displayY) || !Number.isFinite(local.displayZ) || !Number.isFinite(local.displayYaw)) {
    local.displayX = asFiniteNumber(local.x, 0);
    local.displayY = asFiniteNumber(local.y, 0);
    local.displayZ = asFiniteNumber(local.z, 0);
    local.displayYaw = normalizeYaw(local.yaw, 0);
  }

  const localError = Math.hypot(local.x - local.displayX, local.z - local.displayZ);
  if (localError > 0.9) {
    local.displayX = local.x;
    local.displayY = local.y;
    local.displayZ = local.z;
  } else {
    local.displayX += (local.x - local.displayX) * 0.36;
    local.displayY += (local.y - local.displayY) * 0.36;
    local.displayZ += (local.z - local.displayZ) * 0.36;
  }
  local.displayYaw += (local.yaw - local.displayYaw) * 0.32;

  const renderY = sanitizeRenderY(local.displayY);
  localAvatarParts.avatar.position.set(local.displayX, renderY + avatarGroundOffset, local.displayZ);
  localAvatarParts.avatar.rotation.y = local.displayYaw;

  animateAvatar(localAvatarParts, local.speed, nowMs * 0.004);

  const active = state.activeChallenge;
  const inMatch = active && active.status === 'active' && (active.challengerId === state.playerId || active.opponentId === state.playerId);
  const opponentId =
    inMatch && active
      ? (active.challengerId === state.playerId ? active.opponentId : active.challengerId)
      : null;
  const opponent = opponentId ? state.players.get(opponentId) : null;

  cameraController.update({
    local,
    opponent,
    inMatch: Boolean(inMatch && opponent)
  });
}

export function applyDisplaySeparationRuntime(state) {
  const ids = [...state.players.keys()];
  if (ids.length < 2) return;
  const minDist = 1.5;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = state.players.get(ids[i]);
        const b = state.players.get(ids[j]);
        if (!a || !b) continue;
        let dx = (b.displayX ?? b.x) - (a.displayX ?? a.x);
        let dz = (b.displayZ ?? b.z) - (a.displayZ ?? a.z);
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist) continue;
        let dist = Math.sqrt(distSq);
        if (dist < 0.0001) {
          dx = 1;
          dz = 0;
          dist = 1;
        }
        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        a.displayX -= nx * push;
        a.displayZ -= nz * push;
        b.displayX += nx * push;
        b.displayZ += nz * push;
      }
    }
  }
}

export function renderMatchSpotlightRuntime(state, matchSpotlight) {
  const challenge = state.activeChallenge;
  if (!challenge || challenge.status !== 'active') {
    matchSpotlight.visible = false;
    return;
  }

  const a = state.players.get(challenge.challengerId);
  const b = state.players.get(challenge.opponentId);
  if (!a || !b) {
    matchSpotlight.visible = false;
    return;
  }

  matchSpotlight.visible = true;
  matchSpotlight.position.x = (a.displayX + b.displayX) * 0.5;
  matchSpotlight.position.z = (a.displayZ + b.displayZ) * 0.5;
  matchSpotlight.rotation.z += 0.01;
}

export function renderTargetSpotlightRuntime(params) {
  const {
    state,
    targetSpotlight,
    getUiTargetId
  } = params;
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    targetSpotlight.visible = false;
    return;
  }
  const targetId = getUiTargetId();
  if (!targetId) {
    targetSpotlight.visible = false;
    return;
  }
  const target = state.players.get(targetId);
  const station = target ? null : (state.stations instanceof Map ? state.stations.get(targetId) : null);
  if (!target && !station) {
    targetSpotlight.visible = false;
    return;
  }
  targetSpotlight.visible = true;
  targetSpotlight.position.x = target ? target.displayX : Number(station?.x || 0);
  targetSpotlight.position.z = target ? target.displayZ : Number(station?.z || 0);
  targetSpotlight.rotation.z += 0.015;
}
