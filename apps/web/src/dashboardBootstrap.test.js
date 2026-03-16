import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.resolve(__dirname, '../public/js/dashboard.js');

describe('dashboard warm bootstrap flow', () => {
  it('hydrates summary state from playerShell before deep fetches resolve', () => {
    const source = readFileSync(dashboardPath, 'utf8');

    expect(source).toContain("api('/api/player/bootstrap?world=mega')");
    expect(source).toContain('applyPlayerShellSnapshot(bootstrap);');
    expect(source).toContain('renderEscrowHistory(activityEntries);');
    expect(source).toContain('renderContext();');
  });
});
