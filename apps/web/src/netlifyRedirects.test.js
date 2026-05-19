import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const redirectsPath = path.resolve(__dirname, '../public/_redirects');

describe('netlify redirects', () => {
  it('routes quick-play station discovery and station interactions through the unified backend without websocket proxies', () => {
    const redirects = readFileSync(redirectsPath, 'utf8');
    const backendOrigin = 'https://arena-backend.peppera.workers.dev';
    const quickPlayLine = `/api/game/stations/playable ${backendOrigin}/api/game/stations/playable 200`;
    const stationInteractLine = `/api/game/stations/interact ${backendOrigin}/api/game/stations/interact 200`;
    const genericApiLine = `/api/*        ${backendOrigin}/api/:splat       200`;
    const runtimeLine = `/runtime/*    ${backendOrigin}/runtime/:splat   200`;
    const worldAssetLine = '/assets/world/* https://pub-302820e514cd451baaf272a33bd70765.r2.dev/assets/world/:splat 200';

    expect(redirects).toContain(quickPlayLine);
    expect(redirects).toContain(stationInteractLine);
    expect(redirects).toContain(runtimeLine);
    expect(redirects).toContain(worldAssetLine);
    expect(redirects).not.toContain('/ws');
    expect(redirects).not.toContain('/presence*');
    expect(redirects.indexOf(quickPlayLine)).toBeGreaterThanOrEqual(0);
    expect(redirects.indexOf(genericApiLine)).toBeGreaterThanOrEqual(0);
    expect(redirects.indexOf(quickPlayLine)).toBeLessThan(redirects.indexOf(genericApiLine));
  });
});
