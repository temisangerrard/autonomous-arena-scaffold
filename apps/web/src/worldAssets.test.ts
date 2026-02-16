import { describe, expect, it } from 'vitest';
import {
  availableWorldAliases,
  resolveWorldAssetPath,
  worldFilenameForAlias,
  worldVersionByAlias
} from './worldAssets.js';

describe('resolveWorldAssetPath', () => {
  it('maps train-world aliases to mega world file', () => {
    // Mapping should not depend on whether the GLB exists in the repo checkout (CI won't have it).
    expect(worldFilenameForAlias('train_world')).toBe('train_station_mega_world.glb');
    expect(worldFilenameForAlias('train-world')).toBe('train_station_mega_world.glb');
    expect(worldFilenameForAlias('mega.glb')).toBe('train_station_mega_world.glb');
  });

  it('returns null for unknown aliases', () => {
    expect(resolveWorldAssetPath('unknown')).toBeNull();
  });

  it('returns aliases list with primary entries', () => {
    expect(availableWorldAliases()).toContain('train_world');
    expect(availableWorldAliases()).toContain('plaza');
  });

  it('returns cache versions for every world alias', () => {
    const versions = worldVersionByAlias();
    const aliases = availableWorldAliases();
    for (const alias of aliases) {
      expect(typeof versions[alias]).toBe('string');
      expect(versions[alias]?.length).toBeGreaterThan(0);
    }
  });
});
