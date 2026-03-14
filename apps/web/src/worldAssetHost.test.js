import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, './server.ts');
const arenaConfigPath = path.resolve(__dirname, '../public/js/play/runtime/network/arena-config.js');
const worldCommonPath = path.resolve(__dirname, '../public/js/world-common.js');
const netlifyBuildPath = path.resolve(__dirname, '../../../scripts/netlify-build.mjs');

const CANONICAL_WORLD_ASSET_BASE_URL = 'https://arena-world-assets.netlify.app';

describe('world asset host', () => {
  it('uses the canonical Netlify world asset host across server and static runtime config', () => {
    const serverSource = readFileSync(serverPath, 'utf8');
    const arenaConfigSource = readFileSync(arenaConfigPath, 'utf8');
    const worldCommonSource = readFileSync(worldCommonPath, 'utf8');
    const netlifyBuildSource = readFileSync(netlifyBuildPath, 'utf8');

    expect(serverSource).toContain(`const defaultWorldAssetBaseUrl = '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(arenaConfigSource).toContain(`const CANONICAL_WORLD_BASE_FALLBACK = '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(worldCommonSource).toContain(`const CANONICAL_WORLD_BASE_FALLBACK = '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(netlifyBuildSource).toContain(`env('PUBLIC_WORLD_ASSET_BASE_URL', '${CANONICAL_WORLD_ASSET_BASE_URL}')`);
  });
});
