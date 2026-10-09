import { FURNITURE } from './furniture.js';
import { Builder } from './world.js';
export const ROOMS = {
  lounge: {
    name: 'Living room',
    floor: 0,
    doors: { west: 'kitchen', east: 'games', north: 'bedroom' },
  },
  kitchen: { name: 'Kitchen & dining', floor: 0, doors: { east: 'lounge' } },
  games: { name: 'Games room', floor: 0, doors: { west: 'lounge' } },
  bedroom: {
    name: 'Main bedroom',
    floor: 1,
    doors: {
      south: 'lounge',
      west: 'guest',
      east: 'bathroom',
      north: 'balcony',
    },
  },
  guest: { name: 'Guest bedroom', floor: 1, doors: { east: 'bedroom' } },
  bathroom: { name: 'Bathroom & spa', floor: 1, doors: { west: 'bedroom' } },
  balcony: { name: 'Quays terrace', floor: 1, doors: { south: 'bedroom' } },
};
export const PORTALS = {
  west: { x: -6.3, z: 0 },
  east: { x: 6.3, z: 0 },
  north: { x: 0, z: -5.3 },
  south: { x: 0, z: 5.3 },
};
export const OPPOSITE = {
  west: 'east',
  east: 'west',
  north: 'south',
  south: 'north',
};
export function pathTo(from, to) {
  const q = [[from]],
    seen = new Set([from]);
  while (q.length) {
    const path = q.shift(),
      last = path.at(-1);
    if (last === to) return path.slice(1);
    for (const next of Object.values(ROOMS[last].doors))
      if (!seen.has(next)) {
        seen.add(next);
        q.push([...path, next]);
      }
  }
  return [];
}
export function buildHomeRoom(id, life) {
  const installed = (life.furniture || [])
    .filter((o) => o.room === id)
    .map((o) => FURNITURE.find((i) => i.id === o.id))
    .filter(Boolean);
  const piece = (kind) => installed.filter((i) => i.kind === kind).at(-1);
  const b = new Builder(),
    room = ROOMS[id],
    blocks = [];
  const box = (...args) => b.box(...args),
    block = (x, z, w, d) => blocks.push({ x, z, w, d });
  const tile = id === 'bathroom',
    outside = id === 'balcony';
  box(
    0,
    -0.2,
    0,
    13,
    0.4,
    11,
    tile ? '#bdc7c3' : outside ? '#baad90' : '#b38b65'
  );
  for (let x = -6; x <= 6; x += 0.65)
    box(x, 0.01, 0, 0.025, 0.01, 10.8, tile ? '#e4e8dc' : '#997353');
  // Back and side walls are cut away at the front; doors remain real gaps.
  for (const side of ['north', 'west', 'east', 'south']) {
    const horizontal = side === 'north' || side === 'south',
      length = horizontal ? 13 : 11,
      door = room.doors[side],
      height = outside ? 1 : side === 'north' ? 3.8 : 1.05;
    const coord =
      side === 'north'
        ? -5.5
        : side === 'south'
          ? 5.5
          : side === 'west'
            ? -6.5
            : 6.5;
    for (const [centre, size] of door
      ? [
          [-(length + 2.6) / 4, (length - 2.6) / 2],
          [(length + 2.6) / 4, (length - 2.6) / 2],
        ]
      : [[0, length]])
      box(
        horizontal ? centre : coord,
        height / 2,
        horizontal ? coord : centre,
        horizontal ? size : 0.15,
        height,
        horizontal ? 0.15 : size,
        '#e3d6bd'
      );
    if (door) {
      const p = PORTALS[side];
      box(
        p.x,
        0.025,
        p.z,
        horizontal ? 2.6 : 0.3,
        0.04,
        horizontal ? 0.3 : 2.6,
        '#d5aa64'
      );
      if (side === 'north')
        b.label(
          ROOMS[door].floor !== room.floor
            ? 'STAIRS · ' + ROOMS[door].name.toUpperCase()
            : ROOMS[door].name.toUpperCase(),
          0,
          3.6,
          -5.35,
          3.3
        );
    }
  }
  const sofa = () => {
    box(
      -3,
      0.65,
      -2.6,
      4.2,
      1.1,
      1.7,
      piece('sofa')?.color ||
        (life.hiddenDecor.includes('sofa') ? '#b29277' : '#4e796d')
    );
    box(-3, 1.3, -3.4, 4.3, 1.3, 0.25, piece('sofa')?.color || '#4e796d');
    block(-3, -2.6, 4.4, 2);
  };
  const bed = (x) => {
    box(x, 0.5, -2.9, 3.6, 1, 4, '#805d48');
    box(x, 1.08, -2.9, 3.5, 0.22, 3.9, '#eadcc2');
    box(
      x,
      1.24,
      -2.2,
      3.55,
      0.14,
      2.6,
      piece('bed')?.color || (id === 'guest' ? '#76969b' : '#b07165')
    );
    box(x, 1.35, -4.85, 3.8, 2, 0.2, '#a37b56');
    for (const px of [x - 0.8, x + 0.8])
      box(px, 1.25, -4.1, 1.4, 0.18, 0.75, '#fff0d5');
    block(x, -2.9, 3.9, 4.2);
  };
  if (id === 'lounge') {
    sofa();
    box(3, 1.1, -3.8, 3.4, 2.1, 0.2, '#304548');
    box(3, 0.4, -3.8, 3.8, 0.8, 0.8, '#886448');
    block(3, -3.8, 4, 1);
    for (let i = 0; i < 6; i++)
      box(0, 0.1 + i * 0.12, -2.4 - i * 0.4, 2, 0.2 + i * 0.24, 0.4, '#c7b296');
  }
  if (id === 'kitchen') {
    box(-4, 0.7, -3.9, 3.8, 1.4, 1.6, '#59786a');
    box(-4, 1.48, -3.9, 4, 0.15, 1.8, '#eadac1');
    box(-4, 1.58, -3.9, 1.4, 0.03, 1, '#303e3c');
    block(-4, -3.9, 4.2, 2);
    box(3, 0.9, -2, 3.4, 0.18, 2.4, '#bc9568');
    block(3, -2, 3.8, 2.8);
    for (const x of [1, 5])
      for (const z of [-3, -1]) box(x, 0.5, z, 0.75, 1, 0.75, '#668073');
    box(-5, 1.8, 2.8, 1.5, 3.6, 1.5, '#dadfce');
    block(-5, 2.8, 1.8, 1.8);
  }
  if (id === 'games') {
    box(-3, 0.9, -2.7, 4, 1.8, 2.4, '#7c5443');
    box(-3, 1.84, -2.7, 3.7, 0.1, 2.1, '#547c68');
    block(-3, -2.7, 4.2, 2.6);
    for (let i = 0; i < 4; i++)
      b.shape(
        'sphere',
        -4 + i * 0.6,
        2,
        -2.7,
        0.14,
        0.14,
        0.14,
        ['#f6dd9e', '#c7775c', '#fff3d2', '#45443c'][i]
      );
    box(4, 1.4, -3.5, 1.8, 2.8, 1.3, '#6d597a');
    box(4, 2, -2.82, 1.4, 1, 0.04, '#9ec7ad');
    block(4, -3.5, 2, 1.5);
  }
  if (id === 'bedroom' || id === 'guest') {
    bed(-3.6);
    box(4, 1.5, -3.7, 2.8, 3, 1.6, '#b28f66');
    block(4, -3.7, 3, 1.8);
    box(4, 0.7, 3, 2.6, 1.4, 1.4, '#719181');
    block(4, 3, 2.8, 1.6);
  }
  if (id === 'bathroom') {
    box(-3, 0.5, -3, 4, 1, 2.3, '#edf0df');
    box(-3, 1.04, -3, 3.5, 0.04, 1.8, '#8ab4b0');
    block(-3, -3, 4.2, 2.5);
    box(4, 0.2, -3, 2.6, 0.4, 2.6, '#f1e9d8');
    box(5.3, 1.6, -3, 0.08, 3.2, 2.6, '#8cb1ad');
    block(4, -3, 2.8, 2.8);
    box(3, 0.8, 3, 3, 1.6, 1.2, '#6a8b7d');
    block(3, 3, 3.2, 1.4);
  }
  if (outside) {
    box(0, -2, -14, 90, 0.1, 30, '#76a8a9');
    for (let i = 0; i < 9; i++)
      b.building(-30 + i * 7, -30, 4, 5, 5 + (i % 3) * 3, '#aab5a8', {
        glass: true,
      });
    for (const x of [-4, 4]) {
      box(x, 0.45, -2, 1.8, 0.9, 3, piece('loungers')?.color || '#e6d4b2');
      block(x, -2, 2, 3.2);
    }
    box(0, 1.1, -3, 1.6, 0.2, 0.6, '#776a55');
  }
  if ((piece('rug') || !life.hiddenDecor.includes('rug')) && !tile && !outside)
    box(-1, 0.025, 2.2, 5, 0.04, 3, piece('rug')?.color || '#bc8067');
  if (piece('plant') || !life.hiddenDecor.includes('plant')) {
    b.shape('cylinder', -5.4, 0.5, 3.7, 0.5, 1, 0.5, '#b78664');
    b.shape(
      'sphere',
      -5.4,
      1.9,
      3.7,
      0.8,
      1.1,
      0.8,
      piece('plant')?.color || '#709071'
    );
    block(-5.4, 3.7, 1, 1);
  }
  if ((piece('lamp') || !life.hiddenDecor.includes('lamp')) && !outside) {
    box(5.5, 1.3, 4.1, 0.08, 2.6, 0.08, '#807254');
    b.shape(
      'cone',
      5.5,
      2.7,
      4.1,
      0.6,
      0.6,
      0.6,
      piece('lamp')?.color || '#edc987'
    );
  }
  if (piece('rug')) {
    for (const z of [1, 1.15, 3.25, 3.4])
      box(-1, 0.052, z, 4.7, 0.014, 0.045, '#e7d3ae');
  }
  if (piece('sofa') && id === 'lounge') {
    for (const x of [-4.2, -2.9, -1.6])
      box(x, 1.3, -2.9, 0.9, 0.55, 0.3, '#b6c9cb');
  }
  if (piece('bed')) {
    box(-3.6, 1.8, -4.7, 3.7, 0.08, 0.08, '#d2b372');
  }
  if (piece('lamp')) {
    b.beam([5.5, 2.5, 4.1], [4.8, 3, 4.1], 0.05, '#c4a462');
    b.shape('cone', 4.8, 2.85, 4.1, 0.4, 0.4, 0.4, '#d4af60');
  }
  if (piece('art')) {
    box(3, 2.6, -5.32, 2.7, 1.8, 0.12, '#c8a369');
    box(3, 2.6, -5.23, 2.5, 1.6, 0.04, piece('art').color);
    box(3, 2.6, -5.19, 0.12, 1.4, 0.02, '#efdac0');
  }
  return { group: b.finish().group, blocks };
}
