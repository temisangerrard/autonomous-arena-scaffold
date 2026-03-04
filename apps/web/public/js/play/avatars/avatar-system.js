import { AVATAR_GROUND_OFFSET, AVATAR_WORLD_SCALE } from './avatar-scale.js';
import { createProceduralAvatar, animateAvatar } from './avatar-procedural.js';

const MIN_RENDER_Y = -6;
const MAX_RENDER_Y = 8;

export function createAvatarSystem({ THREE, scene, worldScale = AVATAR_WORLD_SCALE }) {
  const clock = new THREE.Clock();
  let currentWorldScale = worldScale;

  const localAvatarParts = createProceduralAvatar(THREE, 'local', 'You', true);
  scene.add(localAvatarParts.avatar);
  const remoteAvatars = new Map();

  function syncRemoteAvatars(state, playerId) {
    for (const player of state.players.values()) {
      if (player.id === playerId) continue;

      let remote = remoteAvatars.get(player.id);
      if (!remote) {
        remote = createProceduralAvatar(THREE, player.role, player.displayName, false);
        remote.avatar.scale.setScalar(currentWorldScale);
        remote.avatar.position.y = 1.2;
        remoteAvatars.set(player.id, remote);
        scene.add(remote.avatar);
      }

      remote.setName(player.displayName);
      if (!Number.isFinite(player.displayX) || !Number.isFinite(player.displayY) || !Number.isFinite(player.displayZ) || !Number.isFinite(player.displayYaw)) {
        player.displayX = Number.isFinite(player.x) ? player.x : 0;
        player.displayY = Number.isFinite(player.y) ? player.y : 0;
        player.displayZ = Number.isFinite(player.z) ? player.z : 0;
        player.displayYaw = Number.isFinite(player.yaw) ? player.yaw : 0;
      }

      const positionError = Math.hypot(player.x - player.displayX, player.z - player.displayZ);
      if (positionError > 0.9) {
        player.displayX = player.x;
        player.displayY = player.y;
        player.displayZ = player.z;
      } else {
        const lerpFactor = 0.22;
        player.displayX += (player.x - player.displayX) * lerpFactor;
        player.displayY += (player.y - player.displayY) * lerpFactor;
        player.displayZ += (player.z - player.displayZ) * lerpFactor;
      }
      player.displayYaw += (player.yaw - player.displayYaw) * 0.2;

      const renderY = Math.min(MAX_RENDER_Y, Math.max(MIN_RENDER_Y, Number(player.displayY) || 0));
      remote.avatar.position.set(player.displayX, renderY + AVATAR_GROUND_OFFSET, player.displayZ);
      remote.avatar.rotation.y = player.displayYaw;

      animateAvatar(remote, player.speed, performance.now() * 0.004, player.id.length * 0.61);
    }
  }

  function updateWorldScale(newScale) {
    if (!Number.isFinite(newScale) || newScale <= 0) return;
    currentWorldScale = newScale;
    if (localAvatarParts?.avatar) {
      localAvatarParts.avatar.scale.setScalar(currentWorldScale);
    }
    for (const remote of remoteAvatars.values()) {
      remote.avatar.scale.setScalar(currentWorldScale);
    }
  }

  function getWorldScale() {
    return currentWorldScale;
  }

  return { localAvatarParts, remoteAvatars, syncRemoteAvatars, updateWorldScale, getWorldScale };
}
