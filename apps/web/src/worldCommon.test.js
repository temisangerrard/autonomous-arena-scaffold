import { describe, expect, test } from 'vitest';
import {
  classifyRendererProfile,
  getWorldBundlePlan,
  normalizeWorldManifest
} from '../public/js/play/runtime/world-manifest.js';

describe('world common', () => {
  test('normalizes legacy world manifests into a shell-first bundle plan', () => {
    const manifest = normalizeWorldManifest({
      filenameByAlias: { mega: 'train_station_mega_world.glb' },
      versionByAlias: { mega: '2026-03-28.1' }
    });

    const plan = getWorldBundlePlan(manifest, 'mega');
    expect(plan.shell).toMatchObject({
      alias: 'mega-shell',
      filename: 'train_station_mega_world.glb',
      version: '2026-03-28.1'
    });
    expect(plan.zones).toEqual([]);
    expect(plan.decor).toEqual([]);
  });

  test('preserves explicit shell, zone, and decor bundles from the manifest payload', () => {
    const manifest = normalizeWorldManifest({
      bundlesByAlias: {
        mega: {
          shell: { alias: 'mega-shell', filename: 'mega-shell.glb', version: 'shell-v1' },
          zones: [{ alias: 'mega-zone-plaza', filename: 'mega-zone-plaza.glb', version: 'zone-v1' }],
          decor: [{ alias: 'mega-decor-skyline', filename: 'mega-decor-skyline.glb', version: 'decor-v1' }]
        }
      }
    });

    const plan = getWorldBundlePlan(manifest, 'mega');
    expect(plan.shell.filename).toBe('mega-shell.glb');
    expect(plan.zones).toHaveLength(1);
    expect(plan.decor).toHaveLength(1);
  });

  test('classifies constrained touch devices as mobile render targets', () => {
    const profile = classifyRendererProfile({
      innerWidth: 390,
      devicePixelRatio: 3,
      maxTouchPoints: 5,
      hardwareConcurrency: 4,
      deviceMemory: 4,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    });

    expect(profile.lowTier).toBe(true);
    expect(profile.maxPixelRatio).toBe(1.25);
    expect(profile.antialias).toBe(false);
    expect(profile.shadowMapEnabled).toBe(false);
    expect(profile.cameraFar).toBe(800);
  });
});
