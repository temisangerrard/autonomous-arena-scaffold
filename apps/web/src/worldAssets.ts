import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_CANDIDATES = [
  path.resolve(process.cwd()),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../')
];

const WORLD_FILE_BY_ALIAS: Record<string, string> = {
  train_world: 'train_station_mega_world.glb',
  'train-world': 'train_station_mega_world.glb',
  mega: 'train_station_mega_world.glb',
  plaza: 'train_station_mega_world.glb',
  base: 'train_station_mega_world.glb',
  world: 'train_station_mega_world.glb'
};

const WORLD_VERSION_BY_ALIAS: Record<string, string> = {
  train_world: '2026-02-17.2',
  'train-world': '2026-02-17.2',
  mega: '2026-02-17.2',
  plaza: '2026-02-17.2',
  base: '2026-02-17.2',
  world: '2026-02-17.2'
};

const WORLD_BUNDLES_BY_ALIAS: Record<string, {
  shell: { alias: string; filename: string; version: string; kind: 'shell' };
  zones: Array<{ alias: string; filename: string; version: string; kind: 'zone' | 'world'; replaceWorldRoot?: boolean }>;
  decor: Array<{ alias: string; filename: string; version: string; kind: 'decor' }>;
}> = {
  train_world: {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  },
  'train-world': {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  },
  mega: {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  },
  plaza: {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  },
  base: {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  },
  world: {
    shell: { alias: 'mega-shell', filename: 'train_station_world.glb', version: '2026-02-17.2', kind: 'shell' },
    zones: [{ alias: 'mega-world', filename: 'train_station_mega_world.glb', version: '2026-02-17.2', kind: 'world', replaceWorldRoot: true }],
    decor: []
  }
};

export function worldBundleForAssetAlias(alias: string): { alias: string; filename: string; version: string; kind: 'shell' | 'zone' | 'world' | 'decor'; replaceWorldRoot?: boolean } | null {
  const normalized = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
  for (const plan of Object.values(WORLD_BUNDLES_BY_ALIAS)) {
    if (plan.shell.alias === normalized) {
      return { ...plan.shell };
    }
    const zoneMatch = plan.zones.find((entry) => entry.alias === normalized);
    if (zoneMatch) return { ...zoneMatch };
    const decorMatch = plan.decor.find((entry) => entry.alias === normalized);
    if (decorMatch) return { ...decorMatch };
  }
  return null;
}

export function worldFilenameByAlias(): Record<string, string> {
  // Public mapping (safe to expose to clients).
  return { ...WORLD_FILE_BY_ALIAS };
}

export function worldVersionByAlias(): Record<string, string> {
  // Public cache-buster version mapping for deterministic client cache keys.
  return { ...WORLD_VERSION_BY_ALIAS };
}

export function worldBundlesByAlias(): typeof WORLD_BUNDLES_BY_ALIAS {
  return JSON.parse(JSON.stringify(WORLD_BUNDLES_BY_ALIAS));
}

export function worldFilenameForAlias(alias: string): string | null {
  const normalized = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
  if (WORLD_FILE_BY_ALIAS[normalized]) {
    return WORLD_FILE_BY_ALIAS[normalized];
  }
  return worldBundleForAssetAlias(normalized)?.filename ?? null;
}

export function resolveWorldAssetPath(alias: string): string | null {
  const filename = worldFilenameForAlias(alias);
  if (!filename) {
    return null;
  }

  for (const root of ROOT_CANDIDATES) {
    const candidate = path.join(root, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function availableWorldAliases(): string[] {
  return Object.keys(WORLD_FILE_BY_ALIAS);
}
