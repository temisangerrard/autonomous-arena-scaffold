import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const redirectsPath = path.resolve(__dirname, '../public/_redirects');

describe('netlify redirects', () => {
  it('routes quick-play station discovery directly to the game server before the generic api proxy', () => {
    const redirects = readFileSync(redirectsPath, 'utf8');
    const quickPlayLine = '/api/game/stations/playable https://arena-server-broken-haze-6531.fly.dev/stations/playable 200';
    const genericApiLine = '/api/*        https://arena-web.fly.dev/api/:splat       200';
    const worldAssetLine = '/assets/world/* https://arena-world-assets.netlify.app/assets/world/:splat 200';

    expect(redirects).toContain(quickPlayLine);
    expect(redirects).toContain(worldAssetLine);
    expect(redirects.indexOf(quickPlayLine)).toBeGreaterThanOrEqual(0);
    expect(redirects.indexOf(genericApiLine)).toBeGreaterThanOrEqual(0);
    expect(redirects.indexOf(quickPlayLine)).toBeLessThan(redirects.indexOf(genericApiLine));
  });
});
