export const AVATAR_GROUND_OFFSET = -0.7;

function createNameTag(THREE, initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 18;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 251, 241, 0.94)';
    ctx.fillRect(0, 2, canvas.width, 14);
    ctx.strokeStyle = 'rgba(183, 136, 24, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, 2, canvas.width, 14);
    ctx.fillStyle = '#4a3812';
    ctx.font = '700 8px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const trimmed = String(text).slice(0, 14);
    ctx.fillText(trimmed, canvas.width / 2, 9);
    texture.needsUpdate = true;
  }

  draw(initialText);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  sprite.scale.set(0.62, 0.12, 1);
  sprite.position.set(0, 1.62, 0);

  return {
    sprite,
    setText: draw
  };
}

function createAvatar(THREE, color, initialName) {
  const avatar = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.52, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.75 })
  );
  torso.position.y = 0.55;

  const headGeometry = new THREE.SphereGeometry(0.22, 12, 10);
  headGeometry.scale(1, 1.1, 1);
  const head = new THREE.Mesh(
    headGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffd7b3, roughness: 0.95 })
  );
  head.position.y = 1.16;

  const faceGroup = new THREE.Group();
  faceGroup.position.set(0, 1.16, 0);

  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyePupilMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.2 });

  const leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeWhiteMaterial);
  leftEyeWhite.position.set(-0.07, 0.03, 0.18);
  const leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), eyePupilMaterial);
  leftEyePupil.position.set(-0.07, 0.03, 0.22);

  const rightEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeWhiteMaterial);
  rightEyeWhite.position.set(0.07, 0.03, 0.18);
  const rightEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), eyePupilMaterial);
  rightEyePupil.position.set(0.07, 0.03, 0.22);

  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xf0c8a8, roughness: 0.9 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), noseMaterial);
  nose.position.set(0, -0.02, 0.22);
  nose.scale.set(0.8, 1, 0.6);

  faceGroup.add(leftEyeWhite, leftEyePupil, rightEyeWhite, rightEyePupil, nose);

  const shoulderMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.7).getHex(),
    roughness: 0.6
  });

  const leftShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), shoulderMaterial);
  leftShoulder.position.set(-0.32, 0.85, 0);
  leftShoulder.scale.set(1.2, 0.8, 1);

  const rightShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), shoulderMaterial);
  rightShoulder.position.set(0.32, 0.85, 0);
  rightShoulder.scale.set(1.2, 0.8, 1);

  const emblemMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.4,
    metalness: 0.3
  });
  const emblemGeometry = new THREE.ConeGeometry(0.06, 0.12, 3);
  const chestEmblem = new THREE.Mesh(emblemGeometry, emblemMaterial);
  chestEmblem.position.set(0, 0.65, 0.28);
  chestEmblem.rotation.x = Math.PI / 2;

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3d4a, roughness: 0.9 });
  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), legMaterial);
  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), legMaterial);
  leftLeg.position.set(-0.14, -0.02, 0);
  rightLeg.position.set(0.14, -0.02, 0);

  const nameTag = createNameTag(THREE, initialName);

  avatar.add(torso, head, faceGroup, leftShoulder, rightShoulder, chestEmblem, leftLeg, rightLeg, nameTag.sprite);
  return {
    avatar,
    head,
    faceGroup,
    leftShoulder,
    rightShoulder,
    leftLeg,
    rightLeg,
    setName: nameTag.setText
  };
}

export function animateAvatar(parts, speed, t, phaseOffset = 0) {
  const gait = Math.min(1, speed / 5);
  const gaitPhase = t * 8 + phaseOffset;
  parts.head.position.y = 1.16 + Math.sin(gaitPhase * 0.5) * 0.05 * gait;
  parts.leftLeg.rotation.x = Math.sin(gaitPhase) * 0.55 * gait;
  parts.rightLeg.rotation.x = Math.sin(gaitPhase + Math.PI) * 0.55 * gait;
}

export function createAvatarSystem({ THREE, scene }) {
  const localAvatarParts = createAvatar(THREE, 0x3a7bff, 'You');
  scene.add(localAvatarParts.avatar);
  const remoteAvatars = new Map();

  function syncRemoteAvatars(state, playerId) {
    for (const player of state.players.values()) {
      if (player.id === playerId) continue;

      let remote = remoteAvatars.get(player.id);
      if (!remote) {
        const color = player.role === 'agent' ? 0xc8813f : 0x6f8f72;
        remote = createAvatar(THREE, color, player.displayName);
        remote.avatar.position.y = 1.2;
        remoteAvatars.set(player.id, remote);
        scene.add(remote.avatar);
      }

      remote.setName(player.displayName);

      player.displayX += (player.x - player.displayX) * 0.28;
      player.displayY += (player.y - player.displayY) * 0.28;
      player.displayZ += (player.z - player.displayZ) * 0.28;
      player.displayYaw += (player.yaw - player.displayYaw) * 0.25;

      remote.avatar.position.set(player.displayX, player.displayY + AVATAR_GROUND_OFFSET, player.displayZ);
      remote.avatar.rotation.y = player.displayYaw;

      animateAvatar(remote, player.speed, performance.now() * 0.004, player.id.length * 0.61);
    }
  }

  return { localAvatarParts, remoteAvatars, syncRemoteAvatars };
}

