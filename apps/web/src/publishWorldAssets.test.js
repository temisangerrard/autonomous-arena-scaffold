import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('publish world assets script', () => {
  it('uses the canonical Netlify asset host', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);

    expect(module.canonicalWorldAssetBaseUrl).toBe('https://arena-world-assets.netlify.app');
  });

  it('requires an explicit Netlify world asset site target', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);

    expect(() => module.resolveWorldAssetDeployTarget({})).toThrow(/NETLIFY_WORLD_ASSETS_SITE_ID/);
  });

  it('stages mega.glb in a Netlify publish directory', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);
    const {
      stageWorldAssetPublishDir
    } = module;

    const root = mkdtempSync(path.join(os.tmpdir(), 'world-asset-test-'));
    const sourcePath = path.join(root, 'train_station_mega_world.glb');
    const stagingDir = path.join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(sourcePath, 'arena-world');

    const publishDir = await stageWorldAssetPublishDir({ sourcePath, stagingDir });
    const stagedAsset = path.join(publishDir, 'assets', 'world', 'mega.glb');

    expect(statSync(stagedAsset).size).toBe(statSync(sourcePath).size);
  });
});
