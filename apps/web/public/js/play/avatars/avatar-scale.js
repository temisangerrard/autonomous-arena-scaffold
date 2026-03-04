export const AVATAR_GROUND_OFFSET = -0.7;
export const AVATAR_WORLD_SCALE = 1.22;

const REFERENCE_WORLD_SIZE = 120;

/**
 * Compute avatar scale factor based on loaded world's bounding box.
 * @param {THREE.Box3} worldBox - The world's bounding box
 * @param {number} [baseScale=AVATAR_WORLD_SCALE] - Base avatar scale
 * @returns {number} Scale factor for avatars
 */
export function computeAvatarScaleForWorld(worldBox, baseScale = AVATAR_WORLD_SCALE) {
  if (!worldBox || !worldBox.min || !worldBox.max) {
    return baseScale;
  }
  const sizeX = Number(worldBox.max.x) - Number(worldBox.min.x);
  const sizeZ = Number(worldBox.max.z) - Number(worldBox.min.z);
  const worldFootprint = Math.max(Number.isFinite(sizeX) ? sizeX : 1, Number.isFinite(sizeZ) ? sizeZ : 1);
  const scaleFactor = worldFootprint / REFERENCE_WORLD_SIZE;
  const clampedFactor = Math.max(1, Math.min(3, scaleFactor));
  return baseScale * clampedFactor;
}
