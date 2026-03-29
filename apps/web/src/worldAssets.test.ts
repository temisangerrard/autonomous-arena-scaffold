import { describe, expect, it } from 'vitest';
import {
  availableWorldAliases,
  resolveWorldAssetPath,
  worldBundlesByAlias,
  worldFilenameForAlias,
  worldVersionByAlias
} from './worldAssets.js';

describe('resolveWorldAssetPath', () => {
  it('maps train-world aliases to mega world file', () => {
    // Mapping should not depend on whether the GLB exists in the repo checkout (CI won't have it).
    expect(worldFilenameForAlias('train_world')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('train-world')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('mega.glb')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('mega-shell')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('mega-world')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('base')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('plaza')).toBe('mega-world.glb');
    expect(worldFilenameForAlias('world')).toBe('mega-world.glb');
  });

  it('returns null for unknown aliases', () => {
    expect(resolveWorldAssetPath('unknown')).toBeNull();
  });

  it('uses a single-bundle plan for the canonical world', () => {
    const bundles = worldBundlesByAlias();
    const megaBundle = bundles.mega;

    expect(megaBundle).toBeDefined();
    if (!megaBundle) {
      throw new Error('Expected canonical mega bundle to exist');
    }

    expect(megaBundle.shell).toMatchObject({
      alias: 'mega-shell',
      filename: 'mega-world.glb'
    });
    expect(megaBundle.zones).toEqual([]);
    expect(megaBundle.decor).toEqual([]);
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
