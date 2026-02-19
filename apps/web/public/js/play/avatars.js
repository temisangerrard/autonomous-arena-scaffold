/**
 * Avatar System - Redesigned for better visual appeal
 * Features:
 * - Smoother proportions with rounded shapes
 * - Better color schemes for human vs agent
 * - Improved walking animation
 * - Subtle idle animations
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export const AVATAR_GROUND_OFFSET = -0.7;
export const AVATAR_WORLD_SCALE = 0.82;

// Reference world size used to calculate dynamic avatar scaling.
// Avatars were originally designed for a world of this approximate size.
const REFERENCE_WORLD_SIZE = 120;

/**
 * Compute avatar scale factor based on loaded world's bounding box.
 * Larger worlds get proportionally larger avatars to maintain visual presence.
 * @param {THREE.Box3} worldBox - The world's bounding box
 * @param {number} [baseScale=AVATAR_WORLD_SCALE] - Base avatar scale
 * @returns {number} Scale factor for avatars
 */
export function computeAvatarScaleForWorld(worldBox, baseScale = AVATAR_WORLD_SCALE) {
  if (!worldBox || !worldBox.getSize) {
    return baseScale;
  }
  // getSize returns a Vector3-like object with x, y, z
  const size = { x: 0, y: 0, z: 0 };
  worldBox.getSize(size);
  // Use the larger of x/z dimensions as the world "footprint"
  const worldFootprint = Math.max(size.x || 1, size.z || 1);
  // Scale avatars relative to reference world size
  const scaleFactor = worldFootprint / REFERENCE_WORLD_SIZE;
  // Clamp to reasonable range (0.5x to 3x of base scale)
  const clampedFactor = Math.max(0.5, Math.min(3, scaleFactor));
  return baseScale * clampedFactor;
}

// Color palettes
const COLORS = {
  human: {
    primary: 0x4a90d9,      // Soft blue
    secondary: 0x3a7bc8,    // Darker blue
    accent: 0xffd700,       // Gold
    skin: 0xf5d0b5,         // Warm skin tone
    hair: 0x4a3728,         // Brown hair
    pants: 0x2c3e50         // Dark slate
  },
  agent: {
    primary: 0xd4a574,      // Warm bronze
    secondary: 0xc49464,    // Darker bronze
    accent: 0x50c878,       // Emerald green
    skin: 0xe8c9a8,         // Lighter skin
    hair: 0x2c2c2c,         // Dark hair
    pants: 0x34495e         // Charcoal
  },
  local: {
    primary: 0x5dade2,      // Bright cyan-blue
    secondary: 0x3498db,    // Deeper blue
    accent: 0xf39c12,       // Orange-gold
    skin: 0xfad7a0,         // Peachy skin
    hair: 0x5d4e37,         // Medium brown
    pants: 0x2c3e50         // Dark slate
  }
};

export const CHARACTER_MODEL_CONFIGS = [
  { file: 'anime_girl_mia_ter_excited_preview.glb', targetHeight: 1.72, yawOffset: 0 },
  { file: 'arab_man.glb', targetHeight: 1.74, yawOffset: 0 },
  { file: 'mordecai_-_fortnite_skin.glb', targetHeight: 1.68, yawOffset: 0 },
  { file: 'neutral_idle_fbi.glb', targetHeight: 1.72, yawOffset: 0 },
  { file: 'obelix.glb', targetHeight: 1.62, yawOffset: 0 },
  { file: 'ophelia_ramirez_life_and_times_of_juniper_lee.glb', targetHeight: 1.7, yawOffset: 0 },
  { file: 'rigby_-_fortnite_sidekick.glb', targetHeight: 1.66, yawOffset: 0 },
  { file: 'spyro_reignited_trilogy_gavin.glb', targetHeight: 1.7, yawOffset: 0 }
];

export function hashIdToCharacterIndex(id, modulo = CHARACTER_MODEL_CONFIGS.length) {
  const raw = String(id || '');
  const size = Math.max(1, Number(modulo || 1));
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}

export function characterModelConfigForId(id) {
  return CHARACTER_MODEL_CONFIGS[hashIdToCharacterIndex(id)] || CHARACTER_MODEL_CONFIGS[0];
}

export function createCharacterGlbPool(THREE) {
  const loader = new GLTFLoader();
  const prefabCache = new Map();
  const fileAvailabilityCache = new Map();
  let characterAssetsEnabled = null;

  async function isCharacterFileAvailable(file) {
    if (!file) return false;
    if (fileAvailabilityCache.has(file)) {
      return fileAvailabilityCache.get(file);
    }
    try {
      const response = await fetch(`/assets/characters/${file}`, {
        method: 'HEAD',
        cache: 'no-store'
      });
      const ok = Boolean(response?.ok);
      fileAvailabilityCache.set(file, ok);
      return ok;
    } catch {
      fileAvailabilityCache.set(file, false);
      return false;
    }
  }

  async function resolveAvailableConfig(entityId, configOverride = null) {
    if (configOverride?.file && (await isCharacterFileAvailable(configOverride.file))) {
      return configOverride;
    }
    const preferred = characterModelConfigForId(entityId);
    if (preferred?.file && (await isCharacterFileAvailable(preferred.file))) {
      return preferred;
    }
    for (const cfg of CHARACTER_MODEL_CONFIGS) {
      if (await isCharacterFileAvailable(cfg.file)) {
        return cfg;
      }
    }
    return null;
  }

  async function probeCharacterAssets() {
    if (characterAssetsEnabled != null) {
      return characterAssetsEnabled;
    }
    const available = await resolveAvailableConfig('probe', null);
    characterAssetsEnabled = Boolean(available);
    return characterAssetsEnabled;
  }

  async function loadPrefab(url) {
    if (prefabCache.has(url)) {
      return prefabCache.get(url);
    }
    const promise = loader.loadAsync(url).then((gltf) => gltf).catch((error) => {
      const status = Number(error?.target?.status || 0);
      if (status === 404) {
        const file = String(url).split('/').pop();
        if (file) fileAvailabilityCache.set(file, false);
        characterAssetsEnabled = false;
      }
      return null;
    });
    prefabCache.set(url, promise);
    return promise;
  }

  async function instantiateById(entityId, configOverride = null) {
    if (!(await probeCharacterAssets())) {
      return null;
    }
    const cfg = await resolveAvailableConfig(entityId, configOverride);
    if (!cfg) {
      characterAssetsEnabled = false;
      return null;
    }
    const url = `/assets/characters/${cfg.file}`;
    const gltf = await loadPrefab(url);
    if (!gltf) {
      return null;
    }

    const root = cloneSkeleton(gltf.scene);
    const preBox = new THREE.Box3().setFromObject(root);
    const preSize = preBox.getSize(new THREE.Vector3());
    const rawHeight = Math.max(0.0001, preSize.y || 1);
    const scale = ((Number(cfg.targetHeight) || 1.7) * AVATAR_WORLD_SCALE) / rawHeight;
    root.scale.setScalar(scale);

    const postBox = new THREE.Box3().setFromObject(root);
    const postCenter = postBox.getCenter(new THREE.Vector3());
    root.position.x -= postCenter.x;
    root.position.z -= postCenter.z;
    root.position.y -= postBox.min.y;

    const anchor = new THREE.Group();
    anchor.add(root);
    anchor.rotation.y = Number(cfg.yawOffset) || 0;

    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = true;
      }
    });

    return {
      gltf,
      root,
      anchor,
      yawOffset: Number(cfg.yawOffset) || 0,
      rawHeight,
      config: cfg
    };
  }

  return {
    loadPrefab,
    instantiateById,
    configForId: characterModelConfigForId
  };
}

function createNameTag(THREE, initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Rounded rectangle background
    const radius = 6;
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, radius);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Text with shadow
    ctx.fillStyle = '#333';
    ctx.font = '600 11px "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const trimmed = String(text).slice(0, 16);
    ctx.fillText(trimmed, canvas.width / 2, canvas.height / 2);
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
  sprite.scale.set(0.8, 0.15, 1);
  sprite.position.set(0, 1.75, 0);

  return {
    sprite,
    setText: draw
  };
}

function createAvatar(THREE, colorScheme, initialName, isLocal = false) {
  const colors = colorScheme;
  const avatar = new THREE.Group();

  // Body - smooth capsule shape
  const bodyGeometry = new THREE.CapsuleGeometry(0.22, 0.45, 8, 16);
  const bodyMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.primary, 
    roughness: 0.6,
    metalness: 0.1
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.52;
  body.castShadow = true;

  // Head - slightly oval sphere
  const headGeometry = new THREE.SphereGeometry(0.18, 24, 20);
  headGeometry.scale(1, 1.08, 0.95);
  const headMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.skin, 
    roughness: 0.85,
    metalness: 0
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 1.08;
  head.castShadow = true;

  // Hair - simple cap on top
  const hairGeometry = new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const hairMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.hair, 
    roughness: 0.9 
  });
  const hair = new THREE.Mesh(hairGeometry, hairMaterial);
  hair.position.y = 1.12;
  hair.rotation.x = -0.1;

  // Face group
  const faceGroup = new THREE.Group();
  faceGroup.position.set(0, 1.08, 0);

  // Eyes - larger, more expressive
  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffffff, 
    roughness: 0.2 
  });
  const eyePupilMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x1a1a1a, 
    roughness: 0.1,
    metalness: 0.2
  });
  const eyeIrisMaterial = new THREE.MeshStandardMaterial({ 
    color: isLocal ? 0x4a90d9 : 0x6b8e23, 
    roughness: 0.3 
  });

  // Left eye
  const leftEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeWhiteMaterial);
  leftEyeWhite.position.set(-0.06, 0.02, 0.15);
  leftEyeWhite.scale.set(1, 0.8, 0.5);
  
  const leftEyeIris = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeIrisMaterial);
  leftEyeIris.position.set(-0.06, 0.02, 0.17);
  
  const leftEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyePupilMaterial);
  leftEyePupil.position.set(-0.06, 0.02, 0.18);

  // Right eye
  const rightEyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeWhiteMaterial);
  rightEyeWhite.position.set(0.06, 0.02, 0.15);
  rightEyeWhite.scale.set(1, 0.8, 0.5);
  
  const rightEyeIris = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeIrisMaterial);
  rightEyeIris.position.set(0.06, 0.02, 0.17);
  
  const rightEyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyePupilMaterial);
  rightEyePupil.position.set(0.06, 0.02, 0.18);

  // Eyebrows - simple curved lines
  const eyebrowMaterial = new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9 });
  const leftEyebrow = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.008, 0.01),
    eyebrowMaterial
  );
  leftEyebrow.position.set(-0.06, 0.06, 0.16);
  leftEyebrow.rotation.z = 0.1;
  
  const rightEyebrow = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.008, 0.01),
    eyebrowMaterial
  );
  rightEyebrow.position.set(0.06, 0.06, 0.16);
  rightEyebrow.rotation.z = -0.1;

  // Mouth - subtle smile
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

  // Arms - rounded capsules
  const armMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.secondary, 
    roughness: 0.65 
  });
  
  const leftArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, 0.28, 6, 10),
    armMaterial
  );
  leftArm.position.set(-0.28, 0.55, 0);
  leftArm.rotation.z = 0.15;
  leftArm.castShadow = true;

  const rightArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, 0.28, 6, 10),
    armMaterial
  );
  rightArm.position.set(0.28, 0.55, 0);
  rightArm.rotation.z = -0.15;
  rightArm.castShadow = true;

  // Hands - small spheres
  const handMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.skin, 
    roughness: 0.85 
  });
  
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), handMaterial);
  leftHand.position.set(-0.32, 0.35, 0);
  
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), handMaterial);
  rightHand.position.set(0.32, 0.35, 0);

  // Legs - darker pants
  const legMaterial = new THREE.MeshStandardMaterial({ 
    color: colors.pants, 
    roughness: 0.85 
  });
  
  const leftLeg = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.075, 0.38, 6, 10),
    legMaterial
  );
  leftLeg.position.set(-0.1, 0.02, 0);
  leftLeg.castShadow = true;

  const rightLeg = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.075, 0.38, 6, 10),
    legMaterial
  );
  rightLeg.position.set(0.1, 0.02, 0);
  rightLeg.castShadow = true;

  // Feet - small rounded boxes
  const footMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x2c2c2c, 
    roughness: 0.9 
  });
  
  const leftFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.04, 0.12),
    footMaterial
  );
  leftFoot.position.set(-0.1, -0.18, 0.02);
  
  const rightFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.04, 0.12),
    footMaterial
  );
  rightFoot.position.set(0.1, -0.18, 0.02);

  // Accent badge (for local player)
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

  // Name tag
  const nameTag = createNameTag(THREE, initialName);

  // Assemble avatar
  avatar.add(
    body, head, hair, faceGroup,
    leftArm, rightArm, leftHand, rightHand,
    leftLeg, rightLeg, leftFoot, rightFoot,
    nameTag.sprite
  );
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
    setName: nameTag.setText
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
  
  // Idle breathing animation
  const breathe = Math.sin(t * 1.5) * 0.01;
  parts.body.scale.y = 1 + breathe;
  parts.body.position.y = 0.52 + breathe * 0.5;
  
  // Head bob while walking
  parts.head.position.y = 1.08 + Math.sin(phase * 0.5) * 0.03 * gait + breathe;
  
  // Arm swing
  const armSwing = Math.sin(phase) * 0.4 * gait;
  parts.leftArm.rotation.x = armSwing;
  parts.rightArm.rotation.x = -armSwing;
  
  // Hand follows arm
  if (parts.leftHand) {
    parts.leftHand.position.y = 0.35 - Math.sin(phase) * 0.08 * gait;
  }
  if (parts.rightHand) {
    parts.rightHand.position.y = 0.35 + Math.sin(phase) * 0.08 * gait;
  }
  
  // Leg swing
  const legSwing = Math.sin(phase) * 0.5 * gait;
  parts.leftLeg.rotation.x = legSwing;
  parts.rightLeg.rotation.x = -legSwing;
  
  // Foot follows leg
  if (parts.leftFoot) {
    parts.leftFoot.position.z = 0.02 + Math.sin(phase) * 0.04 * gait;
    parts.leftFoot.rotation.x = Math.sin(phase) * 0.2 * gait;
  }
  if (parts.rightFoot) {
    parts.rightFoot.position.z = 0.02 - Math.sin(phase) * 0.04 * gait;
    parts.rightFoot.rotation.x = -Math.sin(phase) * 0.2 * gait;
  }
  
  // Subtle body tilt while walking
  parts.body.rotation.z = Math.sin(phase * 0.5) * 0.03 * gait;
}

export function createAvatarSystem({ THREE, scene, worldScale = AVATAR_WORLD_SCALE }) {
  const glbPool = createCharacterGlbPool(THREE);
  const clock = new THREE.Clock();
  const MIN_RENDER_Y = -6;
  const MAX_RENDER_Y = 8;
  let currentWorldScale = worldScale;

  function isNpcModelEligible(player) {
    if (!player) return false;
    const id = String(player.id || '').trim();
    if (!id) return false;
    // Keep synthetic/system entities on procedural fallback.
    if (id === 'system_house') return false;
    return true;
  }

  const localAvatarParts = createProceduralAvatar(THREE, 'local', 'You', true);
  scene.add(localAvatarParts.avatar);
  const remoteAvatars = new Map();

  function syncRemoteAvatars(state, playerId) {
    for (const player of state.players.values()) {
      if (player.id === playerId) continue;

      let remote = remoteAvatars.get(player.id);
      if (!remote) {
        remote = {
          ...createProceduralAvatar(THREE, player.role, player.displayName, false),
          proceduralAvatar: null,
          glbRoot: null,
          glbAnchor: null,
          glbYawOffset: 0,
          glbRawHeight: 0,
          glbConfig: null,
          mixer: null
        };
        remote.proceduralAvatar = remote.avatar;
        remote.avatar.position.y = 1.2;
        remoteAvatars.set(player.id, remote);
        scene.add(remote.avatar);

        if (isNpcModelEligible(player)) {
          void glbPool.instantiateById(player.id).then((loaded) => {
            const active = remoteAvatars.get(player.id);
            if (!active || !loaded || active.glbRoot) return;
            if (active.proceduralAvatar) {
              scene.remove(active.proceduralAvatar);
            }
            active.glbRoot = loaded.root;
            active.glbAnchor = loaded.anchor;
            active.glbYawOffset = loaded.yawOffset || 0;
            active.glbRawHeight = loaded.rawHeight || 1;
            active.glbConfig = loaded.config || null;
            active.avatar = loaded.anchor;
            scene.add(loaded.anchor);
            if (Array.isArray(loaded.gltf.animations) && loaded.gltf.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(loaded.anchor);
              const pickByName = (name) => loaded.gltf.animations.find((clip) => String(clip.name || '').toLowerCase() === name) || null;
              const clip = pickByName('idle') || loaded.gltf.animations[0] || null;
              if (clip) {
                mixer.clipAction(clip).play();
              }
              active.mixer = mixer;
            }
          });
        }
      }

      remote.setName(player.displayName);
      if (!Number.isFinite(player.displayX) || !Number.isFinite(player.displayY) || !Number.isFinite(player.displayZ) || !Number.isFinite(player.displayYaw)) {
        player.displayX = Number.isFinite(player.x) ? player.x : 0;
        player.displayY = Number.isFinite(player.y) ? player.y : 0;
        player.displayZ = Number.isFinite(player.z) ? player.z : 0;
        player.displayYaw = Number.isFinite(player.yaw) ? player.yaw : 0;
      }

      // Snap large corrections to avoid visual ghost-through during authoritative pushes.
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
      remote.avatar.rotation.y = player.displayYaw + (remote.glbYawOffset || 0);

      if (remote.glbRoot) {
        if (remote.mixer) {
          remote.mixer.update(clock.getDelta());
        }
      } else {
        animateAvatar(remote, player.speed, performance.now() * 0.004, player.id.length * 0.61);
      }
    }
  }

  /**
   * Update the world scale factor for all avatars.
   * Call this after loading a new world to resize avatars appropriately.
   * @param {number} newScale - The new scale factor
   */
  function updateWorldScale(newScale) {
    if (!Number.isFinite(newScale) || newScale <= 0) return;
    currentWorldScale = newScale;

    // Update local avatar
    if (localAvatarParts?.avatar) {
      localAvatarParts.avatar.scale.setScalar(currentWorldScale);
    }

    // Update all remote avatars
    for (const remote of remoteAvatars.values()) {
      if (remote.glbRoot && remote.glbRawHeight && remote.glbConfig) {
        // GLB models: recalculate scale based on new world scale
        const rawHeight = remote.glbRawHeight;
        const scale = ((Number(remote.glbConfig.targetHeight) || 1.7) * currentWorldScale) / rawHeight;
        remote.glbRoot.scale.setScalar(scale);
      } else if (remote.proceduralAvatar) {
        // Procedural avatars
        remote.proceduralAvatar.scale.setScalar(currentWorldScale);
      }
    }
  }

  /**
   * Get current world scale factor.
   * @returns {number}
   */
  function getWorldScale() {
    return currentWorldScale;
  }

  return { localAvatarParts, remoteAvatars, syncRemoteAvatars, updateWorldScale, getWorldScale };
}
