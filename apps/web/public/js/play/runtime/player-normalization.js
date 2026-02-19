export const PLAYER_Y_MIN = -6;
export const PLAYER_Y_MAX = 24;
export const PLAYER_RENDER_Y_MAX = 8;
export const PLAYER_SPEED_MAX = 24;

export function asFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeYaw(yaw, fallback = 0) {
  const raw = asFiniteNumber(yaw, fallback);
  const twoPi = Math.PI * 2;
  return ((raw % twoPi) + twoPi) % twoPi;
}

export function normalizeSnapshotPlayer(player, existing, worldBound) {
  const prev = existing || {};
  const x = clampNumber(asFiniteNumber(player?.x, prev.x ?? 0), -worldBound, worldBound);
  const z = clampNumber(asFiniteNumber(player?.z, prev.z ?? 0), -worldBound, worldBound);
  const y = clampNumber(asFiniteNumber(player?.y, prev.y ?? 0), PLAYER_Y_MIN, PLAYER_Y_MAX);
  const yaw = normalizeYaw(player?.yaw, prev.yaw ?? 0);
  const speed = clampNumber(asFiniteNumber(player?.speed, prev.speed ?? 0), 0, PLAYER_SPEED_MAX);
  return {
    x,
    y,
    z,
    yaw,
    speed,
    role: player?.role ?? prev.role ?? 'human',
    displayName: player?.displayName ?? prev.displayName ?? player?.id ?? 'Player'
  };
}

export function sanitizeRenderY(y) {
  return clampNumber(asFiniteNumber(y, 0), PLAYER_Y_MIN, PLAYER_RENDER_Y_MAX);
}
