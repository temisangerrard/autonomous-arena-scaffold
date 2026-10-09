import * as T from './vendor/three.module.min.js';

const C = {
  paving: '#d5cfb8',
  light: '#e7e0cd',
  brick: '#aa6750',
  brickDark: '#7d4e43',
  cream: '#e9d7b4',
  glass: '#567c7b',
  dark: '#365652',
  grass: '#8c9b69',
  leaf: '#799569',
  gold: '#d8aa4e',
  water: '#639fa1',
  silver: '#b4bcb1',
};

// Repeated primitives are batched by geometry and colour, not submitted per window.
export class Builder {
  constructor() {
    this.group = new T.Group();
    this.batches = new Map();
    this.obstacles = [];
    this.geometries = {
      box: new T.BoxGeometry(1, 1, 1),
      cylinder: new T.CylinderGeometry(1, 1, 1, 12),
      sphere: new T.IcosahedronGeometry(1, 1),
      cone: new T.ConeGeometry(1, 1, 12),
    };
  }
  shape(kind, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
    const key = `${kind}:${color}`;
    if (!this.batches.has(key))
      this.batches.set(key, { kind, color, matrices: [] });
    const object = new T.Object3D();
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.rotation.set(rx, ry, rz);
    object.updateMatrix();
    this.batches.get(key).matrices.push(object.matrix.clone());
  }
  box(x, y, z, w, h, d, color, ry = 0) {
    this.shape('box', x, y, z, w, h, d, color, 0, ry);
  }
  block(x, z, w, d) {
    this.obstacles.push({ x, z, w, d });
  }
  beam(a, b, radius, color) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      delta = end.clone().sub(start);
    const key = `cylinder:${color}`;
    if (!this.batches.has(key))
      this.batches.set(key, { kind: 'cylinder', color, matrices: [] });
    const matrix = new T.Matrix4().compose(
      start.add(end).multiplyScalar(0.5),
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        delta.clone().normalize()
      ),
      new T.Vector3(radius, delta.length(), radius)
    );
    this.batches.get(key).matrices.push(matrix);
  }
  label(text, x, y, z, width = 10, color = '#fff5d9', background = '#405e55') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 80);
    ctx.fillStyle = color;
    ctx.font = '600 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 41);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const plane = new T.Mesh(
      new T.PlaneGeometry(width, (width * 80) / 512),
      new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide })
    );
    plane.position.set(x, y, z);
    this.group.add(plane);
  }
  building(x, z, w, d, h, color, { glass = false, windows = true } = {}) {
    this.box(x + 1, -0.02, z - 1, w + 2.5, 0.03, d + 2.5, '#b7b9a1');
    this.box(x, h / 2, z, w, h, d, color);
    this.block(x, z, w, d);
    this.box(x, h + 0.15, z, w + 0.35, 0.3, d + 0.35, C.light);
    this.box(x, 0.35, z, w + 0.35, 0.7, d + 0.35, C.cream);
    if (!windows) return;
    const rows = Math.floor((h - 1) / 2.5),
      cols = Math.max(2, Math.floor(w / 2.1));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const wx = x - w / 2 + ((c + 0.5) * w) / cols,
          wy = 2 + r * 2.5;
        this.box(
          wx,
          wy,
          z + d / 2 + 0.035,
          (w / cols) * (glass ? 0.87 : 0.52),
          1.45,
          0.08,
          (r + c) % 5 === 0 ? '#d8c99a' : C.glass
        );
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < Math.floor(d / 2); c++) {
        this.box(
          x + w / 2 + 0.035,
          2 + r * 2.5,
          z - d / 2 + 1.1 + c * 2,
          0.08,
          1.45,
          1.1,
          C.glass
        );
      }
    if (glass)
      for (let c = 0; c <= cols; c++)
        this.box(
          x - w / 2 + (c * w) / cols,
          h / 2,
          z + d / 2 + 0.1,
          0.12,
          h,
          0.12,
          C.silver
        );
  }
  tree(x, z, scale = 1) {
    this.shape(
      'cylinder',
      x,
      1.15 * scale,
      z,
      0.16,
      2.3 * scale,
      0.16,
      '#80664e'
    );
    this.shape(
      'sphere',
      x,
      3.15 * scale,
      z,
      1.55 * scale,
      2 * scale,
      1.55 * scale,
      C.leaf
    );
    this.shape(
      'sphere',
      x + 0.6 * scale,
      3.4 * scale,
      z,
      1.2 * scale,
      1.4 * scale,
      1.2 * scale,
      '#96a876'
    );
    this.shape(
      'cylinder',
      x,
      0.025,
      z,
      1.5 * scale,
      0.04,
      1.5 * scale,
      '#a4aa85'
    );
    this.block(x, z, 0.5, 0.5);
  }
  lamp(x, z) {
    this.box(x, 1.7, z, 0.09, 3.4, 0.09, C.dark);
    this.box(x, 3.3, z, 0.65, 0.13, 0.65, C.dark);
    this.box(x, 3.13, z, 0.4, 0.2, 0.4, '#ffebaf');
  }
  bench(x, z, ry = 0) {
    for (const dz of [-0.32, 0, 0.32])
      this.box(
        x + Math.sin(ry) * dz,
        0.55,
        z + Math.cos(ry) * dz,
        2.2,
        0.12,
        0.25,
        '#9c7150',
        ry
      );
    this.box(
      x + Math.sin(ry) * -0.45,
      1,
      z + Math.cos(ry) * -0.45,
      2.2,
      0.7,
      0.1,
      '#9c7150',
      ry
    );
    for (const dx of [-0.8, 0.8])
      this.box(
        x + Math.cos(ry) * dx,
        0.25,
        z - Math.sin(ry) * dx,
        0.13,
        0.5,
        0.6,
        C.dark,
        ry
      );
  }
  finish() {
    for (const { kind, color, matrices } of this.batches.values()) {
      const mesh = new T.InstancedMesh(
        this.geometries[kind],
        new T.MeshStandardMaterial({ color, roughness: 0.85 }),
        matrices.length
      );
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    return { group: this.group, obstacles: this.obstacles };
  }
}

function ground(b) {
  b.box(0, -0.6, 0, 114, 1, 90, C.paving);
  // Paving joints are shallow geometry, shared across the district.
  for (let x = -54; x <= 54; x += 6)
    b.box(x, -0.085, 0, 0.04, 0.012, 86, '#c6c2ad');
  for (let z = -42; z <= 42; z += 6)
    b.box(0, -0.08, z, 110, 0.012, 0.04, '#c6c2ad');
  for (let x = -45; x <= 45; x += 15) {
    b.tree(x, 36, 1.1);
    b.bench(x + 4, 35);
    b.lamp(x - 4, 34);
  }
  // Tram platform remains accessible in each district.
  b.box(31, 0.05, 28, 21, 0.18, 5, '#b7b6a2');
  for (const z of [27, 29]) b.box(0, 0.08, z, 108, 0.04, 0.11, '#6c7871');
  b.box(30, 1.3, 28, 11, 2.3, 2.6, '#dfb746');
  b.box(30, 2.5, 28, 11.1, 0.15, 2.7, '#e7d7a5');
  for (let x = 25.5; x < 35; x += 1.6)
    b.box(x, 1.65, 29.32, 1.25, 0.95, 0.08, '#3e6061');
  b.box(35.55, 1.65, 28, 0.08, 1, 2.25, '#3e6061');
  b.block(30, 28, 11, 2.6);
  b.beam([28, 2.6, 28], [30, 3.8, 28], 0.06, C.dark);
  b.beam([30, 3.8, 28], [32, 2.6, 28], 0.06, C.dark);
  b.label('MANCHESTER', 30, 3.3, 29.5, 6, '#425b52', '#efcf65');
}
function water(b, x, z, w, d, { block = true } = {}) {
  b.box(x, -0.06, z, w, 0.1, d, C.water);
  if (block) b.block(x, z, w, d);
  // Flat ripples avoid reflections, render targets and expensive water shaders.
  for (let i = 0; i < 35; i++) {
    const rx = x - w / 2 + 1 + ((i * 17.31) % (w - 2)),
      rz = z - d / 2 + 1 + ((i * 9.27) % (d - 2));
    b.box(
      rx,
      0.012,
      rz,
      0.8 + (i % 4),
      0.012,
      0.035,
      i % 2 ? '#83b2ac' : '#70a7a6'
    );
  }
}
function bridge(b, z = -9) {
  b.box(-5, 0.05, z, 25, 0.22, 5, '#e2dac4');
  for (const side of [-2.4, 2.4]) {
    b.beam([-17, 1, z + side], [7, 1, z + side], 0.06, '#edf0db');
    for (let x = -17; x <= 7; x += 2)
      b.beam([x, 0.1, z + side], [x, 1.1, z + side], 0.04, '#edf0db');
    b.block(-5, z + side, 24, 0.08);
  }
  b.beam([-14, 0, z], [-12, 15, z], 0.2, '#e4e6d5');
  for (let x = -10; x < 8; x += 3)
    for (const side of [-2.3, 2.3])
      b.beam([-12, 14, z], [x, 0.2, z + side], 0.025, '#eff0db');
}
function quays(b) {
  water(b, -5, -26, 20, 24);
  water(b, -5, 14, 20, 39);
  // Three disconnected water rectangles leave a level bridge passage at z=-9.
  water(b, -5, -15.3, 20, 3.3);
  b.box(6.2, 0.12, 3, 2.1, 0.3, 72, C.light);
  b.box(-16.2, 0.12, 3, 2.1, 0.3, 72, C.light);
  bridge(b);
  // MediaCity: a cluster of glass offices with a distinctive tall, stepped profile.
  b.building(25, -25, 13, 11, 24, '#9eada3', { glass: true });
  b.building(40, -28, 10, 12, 33, '#b9bcb0', { glass: true });
  b.building(41, -12, 12, 10, 17, '#a9b9ae', { glass: true });
  b.box(40, 34, -28, 8, 2, 10, '#8d9e98');
  b.label('MEDIACITY', 25, 5, -19.3, 9);
  b.box(25, 0.08, 2, 12, 0.2, 12, '#99a878');
  for (const p of [
    [21, -2],
    [29, -2],
    [21, 7],
    [32, 8],
    [11, 12],
    [11, -20],
  ])
    b.tree(...p, 1.1);
  b.bench(28, 11);
  b.bench(13, 14, Math.PI / 2);
  // Lowry-inspired overlapping metallic volumes and a warm theatre drum.
  b.building(-33, -5, 20, 14, 8, C.silver, { windows: false });
  b.shape('cylinder', -35, 6, -3, 7.5, 12, 7.5, '#c19b65');
  b.block(-35, -3, 15, 15);
  b.box(-28, 7, 1, 11, 14, 11, '#bbc4bc', -0.2);
  b.shape('box', -31, 14, -4, 23, 0.6, 14, '#dde0d0', 0, -0.2, 0.13);
  b.label('THE LOWRY', -29, 6.5, 7, 10, '#364f4e', '#e1dbbf');
  for (let x = -44; x < -20; x += 3) b.box(x, 2, 4, 1.8, 3.3, 0.1, '#567c7b');
  b.building(-38, -29, 24, 11, 13, '#a87058');
  b.label('QUAYSIDE', -38, 3.5, -23.3, 9);
  for (const p of [
    [-25, 19],
    [-39, 18],
    [-45, 8],
    [23, 20],
    [44, 13],
  ])
    b.tree(...p);
  for (let z = -20; z < 26; z += 10) {
    b.lamp(8, z);
    b.lamp(-18, z);
  }
  b.bench(-22, 17);
  b.bench(-43, 14);
  b.label('SALFORD QUAYS', 18, 2.3, 23, 6);
  b.box(15.5, 1.1, 23, 0.08, 2.2, 0.08, C.dark);
  b.box(20.5, 1.1, 23, 0.08, 2.2, 0.08, C.dark);
}
function trafford(b) {
  b.building(0, -19, 64, 23, 13, '#a95146', { windows: false });
  b.box(0, 8.5, -6.9, 62, 3, 0.2, '#6e3235');
  b.label('OLD TRAFFORD', 0, 8.6, -6.6, 24, '#f8ecd3', '#8e3f3d');
  for (let x = -30; x <= 30; x += 5) {
    b.box(x, 5, -6.6, 3.9, 4.2, 0.12, C.glass);
    b.beam([x, 13, -5], [x, 18, -18], 0.16, '#eee6ce');
    b.beam([x, 18, -18], [x, 13, -31], 0.13, '#eee6ce');
  }
  b.box(0, 13.2, -10, 65, 0.4, 10, '#d2d2bf');
  b.box(0, 0.06, 8, 23, 0.2, 16, '#8b9c70');
  for (const z of [0.4, 15.6]) b.box(0, 0.18, z, 22, 0.03, 0.12, '#e9e6cb');
  for (const x of [-11, 11]) b.box(x, 0.18, 8, 0.12, 0.03, 15, '#e9e6cb');
  b.box(0, 0.18, 8, 0.12, 0.03, 15, '#e9e6cb');
  for (const x of [-11, 11]) {
    b.beam([x, 0, 5], [x, 2.5, 5], 0.09, C.light);
    b.beam([x, 2.5, 5], [x, 2.5, 11], 0.09, C.light);
    b.beam([x, 2.5, 11], [x, 0, 11], 0.09, C.light);
  }
  for (const x of [-40, 40]) {
    b.building(x, 5, 12, 10, 7, C.brick);
    b.tree(x, 17);
    b.lamp(x - 5, 15);
  }
}
function centre(b) {
  b.building(0, -21, 62, 18, 11, C.cream, { windows: false });
  for (let x = -28; x <= 28; x += 5.6) {
    b.box(x, 5, -11.9, 3.5, 6, 0.1, C.glass);
    b.shape('cylinder', x - 2.3, 5, -10.7, 0.48, 10, 0.48, '#f2e4c6');
    b.box(x - 2.3, 10, -10.7, 1.5, 0.5, 1.5, '#ece1c4');
  }
  b.shape('sphere', 0, 12, -19, 9, 7, 9, '#93a599');
  b.shape('cylinder', 0, 11, -19, 9.1, 0.5, 9.1, '#e7d4ac');
  b.shape('cylinder', 0, 19, -19, 0.3, 2, 0.3, '#ad975c');
  b.box(0, 11, -10, 64, 0.8, 2, '#c7b48c');
  b.label('THE TRAFFORD CENTRE', 0, 10.6, -8.8, 22, '#6f6550', '#f1e3c5');
  b.shape('cylinder', 0, 0.3, 8, 5.5, 0.6, 5.5, '#c4b798');
  b.shape('cylinder', 0, 0.65, 8, 4.8, 0.08, 4.8, C.water);
  b.shape('cylinder', 0, 1.4, 8, 0.8, 1.7, 0.8, '#d6c7a1');
  b.shape('cylinder', 0, 2.2, 8, 2, 0.25, 2, '#e5d8b7');
  b.block(0, 8, 11, 11);
  for (const x of [-22, 22])
    for (const z of [1, 14]) {
      b.tree(x, z, 1.4);
      b.bench(x + 5, z);
    }
}
function northern(b) {
  for (const x of [-31, 30])
    for (let z = -28; z <= 13; z += 14) {
      const h = 11 + (((z + 28) / 14) % 3) * 3;
      b.building(x, z, 19, 12, h, z % 3 ? C.brick : C.brickDark);
      b.box(x, 3, z + 6.15, 18, 1.5, 0.25, x < 0 ? '#667e75' : '#9b675c');
      b.label(
        x < 0
          ? ['RECORDS', 'COFFEE', 'STUDIO', 'NORTHERN'][
              Math.round((z + 28) / 14)
            ]
          : ['BOOKS', 'ARCADE', 'MADE HERE', 'SOCIAL'][
              Math.round((z + 28) / 14)
            ],
        x,
        3,
        z + 6.4,
        10
      );
      b.box(x, 2, z + 6.5, 19, 0.2, 1.6, x < 0 ? '#d2b26d' : '#a47463');
    }
  b.building(0, -32, 37, 12, 19, '#b67758');
  b.label('NORTHERN QUARTER', 0, 6, -25.8, 21);
  // A geometric mural is original artwork, not a reproduction of a real artist's work.
  for (let i = 0; i < 6; i++)
    b.shape(
      'sphere',
      -6 + i * 2.4,
      10 + Math.sin(i) * 2,
      -25.7,
      2.5,
      2.5,
      0.12,
      ['#d1ad62', '#719996', '#d09279'][i % 3]
    );
  for (let x = -12; x <= 12; x += 6) {
    b.shape('cylinder', x, 0.65, 4, 1.1, 0.12, 1.1, '#b78c63');
    b.bench(x, 6);
  }
  for (const x of [-17, 17])
    for (const z of [-16, 17]) {
      b.tree(x, z);
      b.lamp(x, z + 5);
    }
  for (let x = -20; x < 21; x += 3) {
    b.beam([x, 7, -18], [x + 3, 7, -18], 0.025, C.dark);
    b.shape(
      'cone',
      x,
      6.65,
      -18,
      0.35,
      0.7,
      0.08,
      x % 2 ? '#d8af65' : '#9c6860',
      0,
      0,
      Math.PI
    );
  }
}
function castlefield(b) {
  water(b, -5, -26, 20, 24);
  water(b, -5, 14, 20, 39);
  water(b, -5, -15.3, 20, 3.3);
  bridge(b);
  for (const x of [-35, 33]) b.building(x, -29, 25, 13, 15, C.brick);
  // Viaduct spans above the walkable waterfront.
  b.box(0, 9, -18, 108, 2, 7, '#865d49');
  for (let x = -49; x <= 49; x += 14) {
    if (x > -16 && x < 6) continue;
    b.box(x, 4, -18, 2.8, 8, 7, '#926550');
    b.block(x, -18, 2.8, 7);
    b.box(x, 10.5, -18, 2.9, 1, 7.2, '#ad8060');
  }
  for (let x = -52; x <= 52; x += 3)
    b.box(x, 11, -14.5, 0.1, 1.5, 0.1, '#596057');
  b.box(0, 11.7, -14.5, 106, 0.1, 0.1, '#596057');
  for (const p of [
    [25, 6],
    [38, 15],
    [-29, 17],
    [-40, 5],
  ]) {
    b.tree(...p, 1.3);
    b.bench(p[0] + 4, p[1]);
  }
  b.box(-5, 0.4, 13, 3, 0.8, 10, '#803d43');
  b.box(-5, 1.2, 13, 2.8, 0.9, 7, '#d8c69e');
  b.box(-5, 1.8, 13, 3, 0.3, 7.5, '#466962');
  b.label('CASTLEFIELD', 32, 3, -22.2, 12);
}
export function createDistrict(id) {
  const b = new Builder();
  ground(b);
  ({ quays, trafford, centre, northern, castlefield })[id](b);
  return b.finish();
}
export function disposeWorld(group) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) {
      materials.add(o.material);
      if (o.material.map) textures.add(o.material.map);
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
export function createAvatar() {
  const avatar = new T.Group();
  const mat = (color) => new T.MeshStandardMaterial({ color, roughness: 1 });
  const part = (geo, color, x, y, z) => {
    const m = new T.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    avatar.add(m);
    return m;
  };
  const jacket = part(
    new T.CapsuleGeometry(0.27, 0.45, 3, 8),
    '#a45543',
    0,
    1.05,
    0
  );
  part(new T.SphereGeometry(0.23, 10, 8), '#d5ae87', 0, 1.65, 0);
  part(
    new T.SphereGeometry(0.235, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    '#473e34',
    0,
    1.7,
    0
  );
  const legs = [-0.15, 0.15].map((x) =>
    part(new T.CapsuleGeometry(0.1, 0.43, 3, 6), '#3c5554', x, 0.42, 0)
  );
  const arms = [-0.37, 0.37].map((x) =>
    part(new T.CapsuleGeometry(0.085, 0.4, 3, 6), '#a45543', x, 1, 0)
  );
  part(new T.BoxGeometry(0.35, 0.42, 0.18), '#d0aa64', 0, 1.05, -0.26);
  const shadow = new T.Mesh(
    new T.CircleGeometry(0.7, 24),
    new T.MeshBasicMaterial({
      color: '#3f5953',
      transparent: true,
      opacity: 0.23,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  avatar.add(shadow);
  return {
    group: avatar,
    setOutfit(color) {
      jacket.material.color.set(color);
      arms.forEach((arm) => arm.material.color.set(color));
    },
    animate(time, moving) {
      legs.forEach(
        (l, i) =>
          (l.rotation.x = moving ? Math.sin(time * 10 + i * Math.PI) * 0.55 : 0)
      );
      arms.forEach(
        (l, i) =>
          (l.rotation.x = moving ? -Math.sin(time * 10 + i * Math.PI) * 0.4 : 0)
      );
    },
  };
}
export function createBee() {
  const g = new T.Group();
  const body = new T.Mesh(
    new T.SphereGeometry(0.4, 10, 8),
    new T.MeshStandardMaterial({ color: '#efc65c', roughness: 0.4 })
  );
  body.scale.set(1, 0.8, 1.3);
  g.add(body);
  const stripe = new T.Mesh(
    new T.TorusGeometry(0.34, 0.075, 5, 12),
    new T.MeshStandardMaterial({ color: '#725536' })
  );
  stripe.rotation.x = Math.PI / 2;
  g.add(stripe);
  const wingMat = new T.MeshStandardMaterial({
    color: '#fff3cd',
    transparent: true,
    opacity: 0.85,
  });
  for (const x of [-0.4, 0.4]) {
    const wing = new T.Mesh(new T.SphereGeometry(0.27, 8, 6), wingMat);
    wing.position.set(x, 0.23, 0);
    wing.scale.set(1, 0.15, 1.5);
    g.add(wing);
  }
  const ring = new T.Mesh(
    new T.TorusGeometry(0.85, 0.035, 4, 24),
    new T.MeshBasicMaterial({ color: '#ebc265' })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.4;
  g.add(ring);
  return g;
}
