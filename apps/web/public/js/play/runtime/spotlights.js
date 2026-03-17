export function createRuntimeSpotlights(params) {
  const {
    THREE,
    scene
  } = params;

  const matchSpotlight = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 40),
    new THREE.MeshStandardMaterial({
      color: 0xd7b24d,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      emissive: 0x5a3f08,
      emissiveIntensity: 0.5
    })
  );
  matchSpotlight.rotation.x = -Math.PI / 2;
  matchSpotlight.position.y = 0.04;
  matchSpotlight.visible = false;
  scene.add(matchSpotlight);

  const targetSpotlight = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.2, 34),
    new THREE.MeshStandardMaterial({
      color: 0xf2d27a,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      emissive: 0x6a4a10,
      emissiveIntensity: 0.55
    })
  );
  targetSpotlight.rotation.x = -Math.PI / 2;
  targetSpotlight.position.y = 0.03;
  targetSpotlight.visible = false;
  scene.add(targetSpotlight);

  // Active celebration bursts: array of { points, velocities, material, startMs, lifetimeMs }
  const activeBursts = [];

  function triggerCelebrationBurst(x, z, wager = 0) {
    // Only burst for meaningful wagers to avoid spam.
    if (wager < 0.5) return;

    const count = 40;
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.3;
      positions[i * 3 + 2] = z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      velocities.push({
        vx: Math.cos(angle) * speed * 0.6,
        vy: 2.5 + Math.random() * 3,
        vz: Math.sin(angle) * speed * 0.6
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: wager >= 5 ? 0xffd700 : 0x80e890,
      size: 0.12,
      transparent: true,
      opacity: 1,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    activeBursts.push({
      points,
      velocities,
      posArray: positions,
      geometry,
      material,
      startMs: performance.now(),
      lifetimeMs: 2000
    });
  }

  function updateBursts(nowMs) {
    for (let b = activeBursts.length - 1; b >= 0; b--) {
      const burst = activeBursts[b];
      const elapsed = nowMs - burst.startMs;
      const t = Math.min(1, elapsed / burst.lifetimeMs);

      if (t >= 1) {
        scene.remove(burst.points);
        burst.geometry.dispose();
        burst.material.dispose();
        activeBursts.splice(b, 1);
        continue;
      }

      const dt = 0.016; // ~60fps step
      const gravity = -4;
      const pos = burst.posArray;
      for (let i = 0; i < burst.velocities.length; i++) {
        const v = burst.velocities[i];
        v.vy += gravity * dt;
        pos[i * 3] += v.vx * dt;
        pos[i * 3 + 1] += v.vy * dt;
        pos[i * 3 + 2] += v.vz * dt;
      }
      burst.geometry.attributes.position.needsUpdate = true;
      burst.material.opacity = 1 - t;
    }
  }

  return {
    matchSpotlight,
    targetSpotlight,
    triggerCelebrationBurst,
    updateBursts
  };
}
