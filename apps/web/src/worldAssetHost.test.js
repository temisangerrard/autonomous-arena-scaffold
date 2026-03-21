import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverConfigPath = path.resolve(__dirname, './server/config.ts');
const arenaConfigPath = path.resolve(__dirname, '../public/js/play/runtime/network/arena-config.js');
const worldCommonPath = path.resolve(__dirname, '../public/js/world-common.js');
const netlifyBuildPath = path.resolve(__dirname, '../../../scripts/netlify-build.mjs');

const CANONICAL_WORLD_ASSET_BASE_URL = 'https://pub-302820e514cd451baaf272a33bd70765.r2.dev';

describe('world asset host', () => {
  it('uses the canonical Cloudflare R2 world asset host across server and static runtime config', () => {
    const serverSource = readFileSync(serverConfigPath, 'utf8');
    const arenaConfigSource = readFileSync(arenaConfigPath, 'utf8');
    const worldCommonSource = readFileSync(worldCommonPath, 'utf8');
    const netlifyBuildSource = readFileSync(netlifyBuildPath, 'utf8');

    expect(serverSource).toContain(`defaultWorldAssetBaseUrl: '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(arenaConfigSource).toContain(`const CANONICAL_WORLD_BASE_FALLBACK = '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(worldCommonSource).toContain(`const CANONICAL_WORLD_BASE_FALLBACK = '${CANONICAL_WORLD_ASSET_BASE_URL}'`);
    expect(netlifyBuildSource).toContain(`env('PUBLIC_WORLD_ASSET_BASE_URL', '${CANONICAL_WORLD_ASSET_BASE_URL}')`);
  });
});
