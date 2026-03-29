import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authRoutesPath = path.resolve(__dirname, '../src/server/routes/auth.ts');
const playMenuPath = path.resolve(__dirname, '../public/js/play/menu.js');
const authShellPath = path.resolve(__dirname, '../public/js/auth-shell.js');
const welcomePath = path.resolve(__dirname, '../public/js/welcome.js');

describe('logout flow', () => {
  it('forces runtime owner presence offline from the logout endpoint before clearing the session', () => {
    const source = readFileSync(authRoutesPath, 'utf8');

    expect(source).toContain("if (pathname === '/api/logout' && req.method === 'POST')");
    expect(source).toContain("await context.runtimePost(`/owners/${identity.profileId}/presence`, { state: 'offline' })");
    expect(source).toContain("state: 'offline'");
  });

  it('sends offline presence before logout from the in-game menu', () => {
    const source = readFileSync(playMenuPath, 'utf8');

    expect(source).toContain("fetch('/api/player/presence'");
    expect(source).toContain("body: JSON.stringify({ state: 'offline' })");
    expect(source).toContain("await fetch('/api/logout'");
  });

  it('sends offline presence before shell and welcome logouts', () => {
    const authShell = readFileSync(authShellPath, 'utf8');
    const welcome = readFileSync(welcomePath, 'utf8');

    expect(authShell).toContain("await fetchJson('/api/player/presence'");
    expect(authShell).toContain("body: JSON.stringify({ state: 'offline' })");
    expect(welcome).toContain("await requestJson('/api/player/presence'");
    expect(welcome).toContain("body: JSON.stringify({ state: 'offline' })");
  });
});
