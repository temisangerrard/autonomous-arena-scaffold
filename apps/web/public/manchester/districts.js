export const DISTRICTS = [
  {
    id: 'quays',
    activity: 'The Lowry · Visit the theatre ↗',
    module: './theatre.js',
    name: 'Salford Quays',
    heading: 'Meet me<br>at the Quays.',
    subtitle: 'Waterfront wanderings. A little northern soul.',
    label: 'SALFORD QUAYS & MEDIACITY',
    detail: 'Waterfront · The Lowry & discovery trail',
    coordinates: '53.47° N · 2.30° W',
    spawn: [12, 26],
  },
  {
    id: 'trafford',
    activity: 'Old Trafford · Take penalties ↗',
    module: './penalties.js',
    name: 'Old Trafford',
    heading: 'Made of<br>match days.',
    subtitle: 'Red brick. Big dreams. Your home ground.',
    label: 'OLD TRAFFORD · TRAFFORD',
    detail: 'Football · Five-shot challenge',
    coordinates: '53.46° N · 2.29° W',
    spawn: [8, 27],
  },
  {
    id: 'centre',
    activity: 'Trafford Centre · Find your look ↗',
    module: './wardrobe.js',
    name: 'Trafford Centre',
    heading: 'A grand<br>day out.',
    subtitle: 'Take the long way past the fountain.',
    label: 'THE TRAFFORD CENTRE',
    detail: 'Shopping · Avatar fitting room',
    coordinates: '53.47° N · 2.35° W',
    spawn: [9, 27],
  },
  {
    id: 'northern',
    activity: 'Northern Quarter · Play a session ↗',
    module: './rhythm.js',
    name: 'Northern Quarter',
    heading: 'Find your<br>own rhythm.',
    subtitle: 'Independent spirit. Colour on every corner.',
    label: 'NORTHERN QUARTER · MANCHESTER',
    detail: 'Music · Four-pad rhythm challenge',
    coordinates: '53.48° N · 2.23° W',
    spawn: [4, 26],
  },
  {
    id: 'castlefield',
    activity: 'Castlefield · Work the lock ↗',
    module: './canal.js',
    name: 'Castlefield',
    heading: 'Under<br>the arches.',
    subtitle: 'Canal-side calm. Another side of the city.',
    label: 'CASTLEFIELD · MANCHESTER',
    detail: 'Canals · Interactive lock journey',
    coordinates: '53.47° N · 2.25° W',
    spawn: [15, 26],
  },
];
export const TRAIL_POINTS = [
  { x: 7, z: 17, name: 'Promenade' },
  { x: 27, z: 6, name: 'MediaCity gardens' },
  { x: 10, z: -10, name: 'The waterside' },
  { x: -18, z: -9, name: 'Across the bridge' },
  { x: -30, z: 14, name: 'The Lowry' },
];
export function canWalk(x, z, obstacles) {
  if (Math.abs(x) > 53 || Math.abs(z) > 41) return false;
  return !obstacles.some(
    (b) =>
      x > b.x - b.w / 2 - 0.45 &&
      x < b.x + b.w / 2 + 0.45 &&
      z > b.z - b.d / 2 - 0.45 &&
      z < b.z + b.d / 2 + 0.45
  );
}
