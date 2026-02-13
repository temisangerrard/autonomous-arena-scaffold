import { describe, expect, it } from 'vitest';
import { availableWorldAliases, resolveWorldAssetPath } from './worldAssets.js';

describe('resolveWorldAssetPath', () => {
  it('maps train-world aliases to mega world file', () => {
    expect(resolveWorldAssetPath('train_world')?.endsWith('train_station_mega_world.glb')).toBe(true);
    expect(resolveWorldAssetPath('train-world')?.endsWith('train_station_mega_world.glb')).toBe(true);
    expect(resolveWorldAssetPath('mega.glb')?.endsWith('train_station_mega_world.glb')).toBe(true);
  });

  it('returns null for unknown aliases', () => {
    expect(resolveWorldAssetPath('unknown')).toBeNull();
  });

  it('returns aliases list with primary entries', () => {
    expect(availableWorldAliases()).toContain('train_world');
    expect(availableWorldAliases()).toContain('plaza');
  });
});
