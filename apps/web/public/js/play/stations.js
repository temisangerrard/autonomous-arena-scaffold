function createStationTag(THREE, initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 28;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const radius = 7;
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, radius);
    ctx.fillStyle = 'rgba(255, 250, 235, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 130, 24, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#3a2a05';
    ctx.font = '700 11px "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const trimmed = String(text).slice(0, 20);
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
  sprite.scale.set(1.05, 0.18, 1);
  sprite.position.set(0, 1.55, 0);

  return { sprite, setText: draw };
}

function createStationMarker(THREE, station) {
  const group = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x7a5a12, roughness: 0.7, metalness: 0.2 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd0aa3b, roughness: 0.3, metalness: 0.6, emissive: 0x6a4b12, emissiveIntensity: 0.15 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 18), baseMat);
  base.position.y = 0.06;
  base.castShadow = false;
  base.receiveShadow = true;

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 10, 20), rimMat);
  rim.position.y = 0.12;
  rim.rotation.x = Math.PI / 2;

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.65, 12), pillarMat);
  pillar.position.y = 0.47;

  const iconColor = station.kind === 'cashier_bank'
    ? 0x2f6dff
    : station.kind === 'world_interactable'
      ? 0x2fbf8a
      : 0xf39c12;
  const iconMat = new THREE.MeshStandardMaterial({ color: iconColor, roughness: 0.25, metalness: 0.4, emissive: iconColor, emissiveIntensity: 0.18 });
  const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), iconMat);
  icon.position.y = 0.88;

  const tag = createStationTag(THREE, station.displayName);

  group.add(base, rim, pillar, icon, tag.sprite);
  group.position.set(station.x, 0, station.z);
  group.rotation.y = station.yaw || 0;

  return { group, icon, tag };
}

export function createStationSystem({ THREE, scene }) {
  const markers = new Map();

  function syncStations(state) {
    const seen = new Set();
    for (const station of state.stations.values()) {
      seen.add(station.id);
      let marker = markers.get(station.id);
      if (!marker) {
        marker = createStationMarker(THREE, station);
        markers.set(station.id, marker);
        scene.add(marker.group);
      }
      marker.group.position.set(station.x, 0, station.z);
      marker.group.rotation.y = station.yaw || 0;
      marker.tag.setText(station.displayName);
      marker.icon.rotation.y += 0.02;
    }

    for (const [id, marker] of markers.entries()) {
      if (seen.has(id)) continue;
      scene.remove(marker.group);
      markers.delete(id);
    }
  }

  return { markers, syncStations };
}
