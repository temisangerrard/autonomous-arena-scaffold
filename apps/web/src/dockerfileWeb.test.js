import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dockerfilePath = path.resolve(__dirname, '../../../Dockerfile.web');

describe('Dockerfile.web', () => {
  it('does not require gitignored world assets at build time', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    expect(dockerfile).not.toContain('COPY train_station_mega_world.glb ./');
  });
});
