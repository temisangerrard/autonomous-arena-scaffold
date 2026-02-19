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

  return {
    matchSpotlight,
    targetSpotlight
  };
}
