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

  it('shows local bot modal save feedback instead of relying only on the page status line', () => {
    const source = readFileSync(dashboardPath, 'utf8');

    expect(source).toContain("const botModalStatus = document.getElementById('bot-modal-status');");
    expect(source).toContain("botSave.textContent = 'Saving...';");
    expect(source).toContain("setBotModalStatus('Bot saved.', 'success');");
    expect(source).toContain("setBotModalStatus(`Bot save failed: ${String(error.message || error)}`, 'error');");
  });

  it('wires the dashboard agent session controls to the Cloudflare backend API', () => {
    const source = readFileSync(dashboardPath, 'utf8');

    expect(source).toContain('/session/deploy');
    expect(source).toContain("action === 'pause-agent' ? 'pause' : 'stop'");
    expect(source).toContain('Away mode only');
    expect(source).toContain("'btc_up_down'");
  });
});
