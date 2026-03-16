import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

  it('stages shell bundle aliases for the streamed world manifest', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);
    const { stageWorldAssetPublishDir } = module;

    const root = mkdtempSync(path.join(os.tmpdir(), 'world-asset-test-'));
    const sourcePath = path.join(root, 'train_station_mega_world.glb');
    const stagingDir = path.join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(sourcePath, 'arena-world');

    const publishDir = await stageWorldAssetPublishDir({ sourcePath, stagingDir });
    const stagedShell = path.join(publishDir, 'assets', 'world', 'mega-shell.glb');

    expect(statSync(stagedShell).size).toBe(statSync(sourcePath).size);
  });

  it('stages the deferred mega world bundle alias', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);
    const { stageWorldAssetPublishDir } = module;

    const root = mkdtempSync(path.join(os.tmpdir(), 'world-asset-test-'));
    const sourcePath = path.join(root, 'train_station_mega_world.glb');
    const stagingDir = path.join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(sourcePath, 'arena-world');

    const publishDir = await stageWorldAssetPublishDir({ sourcePath, stagingDir });
    const stagedWorld = path.join(publishDir, 'assets', 'world', 'mega-world.glb');

    expect(statSync(stagedWorld).size).toBe(statSync(sourcePath).size);
  });

  it('writes a _headers file that allows cross-origin access to world assets', async () => {
    const module = await import(new URL('../../../scripts/publish-world-assets.mjs', import.meta.url).href);
    const { stageWorldAssetPublishDir } = module;

    const root = mkdtempSync(path.join(os.tmpdir(), 'world-asset-test-'));
    const sourcePath = path.join(root, 'train_station_mega_world.glb');
    const stagingDir = path.join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(sourcePath, 'arena-world');

    const publishDir = await stageWorldAssetPublishDir({ sourcePath, stagingDir });
    const headers = readFileSync(path.join(publishDir, '_headers'), 'utf8');

    expect(headers).toContain('/assets/world/*');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
  });
});
