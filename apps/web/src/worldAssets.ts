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

export function worldFilenameByAlias(): Record<string, string> {
  // Public mapping (safe to expose to clients).
  return { ...WORLD_FILE_BY_ALIAS };
}

export function worldVersionByAlias(): Record<string, string> {
  // Public cache-buster version mapping for deterministic client cache keys.
  return { ...WORLD_VERSION_BY_ALIAS };
}

export function worldFilenameForAlias(alias: string): string | null {
  const normalized = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
  return WORLD_FILE_BY_ALIAS[normalized] ?? null;
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
