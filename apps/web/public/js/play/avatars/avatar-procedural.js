import { AVATAR_WORLD_SCALE } from './avatar-scale.js';

const COLORS = {
  human: {
    primary: 0x4a90d9,
    secondary: 0x3a7bc8,
    accent: 0xffd700,
    skin: 0xf5d0b5,
    hair: 0x4a3728,
    pants: 0x2c3e50
  },
  agent: {
    primary: 0xd4a574,
    secondary: 0xc49464,
    accent: 0x50c878,
    skin: 0xe8c9a8,
    hair: 0x2c2c2c,
    pants: 0x34495e
  },
  local: {
    primary: 0x5dade2,
    secondary: 0x3498db,
    accent: 0xf39c12,
    skin: 0xfad7a0,
    hair: 0x5d4e37,
    pants: 0x2c3e50
  }
};

export function createNameTag(THREE, initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 28;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const radius = canvas.height / 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, radius);
    ctx.fillStyle = 'rgba(253, 248, 237, 0.93)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(198, 152, 49, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#3b2b12';
    ctx.font = 'italic 600 11px "Crimson Text", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const trimmed = String(text).slice(0, 18);
    ctx.fillText(trimmed, canvas.width / 2, canvas.height / 2 + 0.5);
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
  sprite.scale.set(0.95, 0.165, 1);
  sprite.position.set(0, 1.82, 0);

  return { sprite, setText: draw };
}

function createAvatar(THREE, colorScheme, initialName, isLocal = false) {
  const colors = colorScheme;
  const avatar = new THREE.Group();

  const bodyGeometry = new THREE.CapsuleGeometry(0.22, 0.45, 8, 16);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: colors.primary, roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.52;
  body.castShadow = true;

  const headGeometry = new THREE.SphereGeometry(0.18, 24, 20);
  headGeometry.scale(1, 1.08, 0.95);
  const headMaterial = new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.85, metalness: 0 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 1.08;
  head.castShadow = true;

  const hairGeometry = new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const hairMaterial = new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9 });
  const hair = new THREE.Mesh(hairGeometry, hairMaterial);
  hair.position.y = 1.12;
  hair.rotation.x = -0.1;

  const faceGroup = new THREE.Group();
  faceGroup.position.set(0, 1.08, 0);

  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  const eyePupilMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1, metalness: 0.2 });
  const eyeIrisMaterial = new THREE.MeshStandardMaterial({ color: isLocal ? 0x4a90d9 : 0x6b8e23, roughness: 0.3 });

  const leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeWhiteMaterial);
  leftEyeWhite.position.set(-0.06, 0.02, 0.15);
  leftEyeWhite.scale.set(1, 0.8, 0.5);
  const leftEyeIris = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeIrisMaterial);
  leftEyeIris.position.set(-0.06, 0.02, 0.17);
  const leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyePupilMaterial);
  leftEyePupil.position.set(-0.06, 0.02, 0.18);

  const rightEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeWhiteMaterial);
  rightEyeWhite.position.set(0.06, 0.02, 0.15);
  rightEyeWhite.scale.set(1, 0.8, 0.5);
  const rightEyeIris = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeIrisMaterial);
  rightEyeIris.position.set(0.06, 0.02, 0.17);
  const rightEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyePupilMaterial);
  rightEyePupil.position.set(0.06, 0.02, 0.18);

  const eyebrowMaterial = new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9 });
  const leftEyebrow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), eyebrowMaterial);
  leftEyebrow.position.set(-0.06, 0.06, 0.16);
  leftEyebrow.rotation.z = 0.1;
  const rightEyebrow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), eyebrowMaterial);
  rightEyebrow.position.set(0.06, 0.06, 0.16);
  rightEyebrow.rotation.z = -0.1;

  const mouthGeometry = new THREE.TorusGeometry(0.025, 0.004, 8, 12, Math.PI);
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0xcc8877, roughness: 0.8 });
  const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouth.position.set(0, -0.04, 0.16);
  mouth.rotation.x = Math.PI;
  mouth.rotation.z = Math.PI;

  faceGroup.add(
    leftEyeWhite, leftEyeIris, leftEyePupil,
    rightEyeWhite, rightEyeIris, rightEyePupil,
    leftEyebrow, rightEyebrow, mouth
  );

  const armMaterial = new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.65 });
  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 6, 10), armMaterial);
  leftArm.position.set(-0.28, 0.55, 0);
  leftArm.rotation.z = 0.15;
  leftArm.castShadow = true;
  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 6, 10), armMaterial);
  rightArm.position.set(0.28, 0.55, 0);
  rightArm.rotation.z = -0.15;
  rightArm.castShadow = true;

  const handMaterial = new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.85 });
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), handMaterial);
  leftHand.position.set(-0.32, 0.35, 0);
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), handMaterial);
  rightHand.position.set(0.32, 0.35, 0);

  const legMaterial = new THREE.MeshStandardMaterial({ color: colors.pants, roughness: 0.85 });
  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.38, 6, 10), legMaterial);
  leftLeg.position.set(-0.1, 0.02, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.38, 6, 10), legMaterial);
  rightLeg.position.set(0.1, 0.02, 0);
  rightLeg.castShadow = true;

  const footMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.9 });
  const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), footMaterial);
  leftFoot.position.set(-0.1, -0.18, 0.02);
  const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), footMaterial);
  rightFoot.position.set(0.1, -0.18, 0.02);

  if (isLocal) {
    const badgeGeometry = new THREE.CircleGeometry(0.05, 16);
    const badgeMaterial = new THREE.MeshStandardMaterial({
      color: colors.accent,
      roughness: 0.3,
      metalness: 0.5,
      emissive: colors.accent,
      emissiveIntensity: 0.3
    });
    const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
    badge.position.set(0, 0.7, 0.23);
    avatar.add(badge);
  }

  const nameTag = isLocal ? null : createNameTag(THREE, initialName);

  avatar.add(
    body, head, hair, faceGroup,
    leftArm, rightArm, leftHand, rightHand,
    leftLeg, rightLeg, leftFoot, rightFoot
  );
  if (nameTag?.sprite) {
    avatar.add(nameTag.sprite);
  }
  avatar.scale.setScalar(AVATAR_WORLD_SCALE);

  return {
    avatar,
    head,
    faceGroup,
    body,
    leftArm,
    rightArm,
    leftHand,
    rightHand,
    leftLeg,
    rightLeg,
    leftFoot,
    rightFoot,
    setName: nameTag?.setText || (() => {})
  };
}

export function createProceduralAvatar(THREE, role, initialName, isLocal = false) {
  const normalizedRole = String(role || '').toLowerCase();
  const colorScheme = isLocal
    ? COLORS.local
    : normalizedRole === 'agent'
      ? COLORS.agent
      : COLORS.human;
  return createAvatar(THREE, colorScheme, initialName, isLocal);
}

export function animateAvatar(parts, speed, t, phaseOffset = 0) {
  const gait = Math.min(1, speed / 4.5);
  const phase = t * 7 + phaseOffset;

  const breathe = Math.sin(t * 1.5) * 0.01;
  parts.body.scale.y = 1 + breathe;
  parts.body.position.y = 0.52 + breathe * 0.5;

  parts.head.position.y = 1.08 + Math.sin(phase * 0.5) * 0.03 * gait + breathe;

  const armSwing = Math.sin(phase) * 0.4 * gait;
  parts.leftArm.rotation.x = armSwing;
  parts.rightArm.rotation.x = -armSwing;

  if (parts.leftHand) parts.leftHand.position.y = 0.35 - Math.sin(phase) * 0.08 * gait;
  if (parts.rightHand) parts.rightHand.position.y = 0.35 + Math.sin(phase) * 0.08 * gait;

  const legSwing = Math.sin(phase) * 0.5 * gait;
  parts.leftLeg.rotation.x = legSwing;
  parts.rightLeg.rotation.x = -legSwing;

  if (parts.leftFoot) {
    parts.leftFoot.position.z = 0.02 + Math.sin(phase) * 0.04 * gait;
    parts.leftFoot.rotation.x = Math.sin(phase) * 0.2 * gait;
  }
  if (parts.rightFoot) {
    parts.rightFoot.position.z = 0.02 - Math.sin(phase) * 0.04 * gait;
    parts.rightFoot.rotation.x = -Math.sin(phase) * 0.2 * gait;
  }

  parts.body.rotation.z = Math.sin(phase * 0.5) * 0.03 * gait;
}
