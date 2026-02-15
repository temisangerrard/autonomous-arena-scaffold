import { AVATAR_GROUND_OFFSET } from './avatars.js';

export function createCameraController({ THREE, camera, state }) {
  const tmpDesired = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Flattened movement basis derived from the *actual camera direction*.
  const forwardFlat = new THREE.Vector3(0, 0, 1);
  const rightFlat = new THREE.Vector3(1, 0, 0);

  function ensureInitializedFromLocal(local) {
    if (state.cameraYawInitialized) return;
    if (!local) return;
    state.cameraYaw = local.displayYaw;
    state.cameraYawInitialized = true;
  }

  function update({ local, opponent, inMatch }) {
    ensureInitializedFromLocal(local);

    if (!local) return;

    if (inMatch && opponent) {
      const cx = (local.displayX + opponent.displayX) * 0.5;
      const cz = (local.displayZ + opponent.displayZ) * 0.5;
      const dx = opponent.displayX - local.displayX;
      const dz = opponent.displayZ - local.displayZ;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const nx = dx / len;
      const nz = dz / len;
      const sideX = -nz;
      const sideZ = nx;

      tmpDesired.set(
        cx + sideX * 4.2 - nx * 1.1,
        Math.max(local.displayY, opponent.displayY) + AVATAR_GROUND_OFFSET + 3.3,
        cz + sideZ * 4.2 - nz * 1.1
      );
      camera.position.lerp(tmpDesired, 0.12);
      camera.lookAt(cx, local.displayY + AVATAR_GROUND_OFFSET + 1.0, cz);
      return;
    }

    const yaw = state.cameraYaw;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const followDistance = state.cameraDistance;
    const followHeight = 1.8 + state.cameraPitch * 2.6;

    tmpDesired.set(
      local.displayX - forwardX * followDistance,
      local.displayY + AVATAR_GROUND_OFFSET + followHeight,
      local.displayZ - forwardZ * followDistance
    );
    camera.position.lerp(tmpDesired, 0.14);
    camera.lookAt(local.displayX, local.displayY + AVATAR_GROUND_OFFSET + 1.15, local.displayZ);
  }

  function resetBehindPlayer(local) {
    if (!local) return;
    state.cameraYaw = local.displayYaw;
    state.cameraYawInitialized = true;
  }

  function getMoveBasis() {
    // Direction camera faces in world space.
    camera.getWorldDirection(tmpDir);
    tmpDir.y = 0;
    if (tmpDir.lengthSq() < 1e-6) {
      // Fallback to yaw if direction is degenerate (should be rare).
      forwardFlat.set(Math.sin(state.cameraYaw), 0, Math.cos(state.cameraYaw)).normalize();
    } else {
      forwardFlat.copy(tmpDir).normalize();
    }
    // Right-hand basis on ground plane (+X should be "camera right").
    // NOTE: If this sign is wrong, A/D will feel inverted even when W/S are correct.
    rightFlat.crossVectors(forwardFlat, up).normalize();
    return { forwardFlat, rightFlat };
  }

  return {
    update,
    resetBehindPlayer,
    getMoveBasis
  };
}
