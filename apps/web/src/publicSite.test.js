import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

function readPublic(file) {
  return readFileSync(path.join(publicDir, file), 'utf8');
}

describe('public marketing site', () => {
  it('has share images and keeps docs/social links footer-only on the homepage', () => {
    const source = readPublic('index.html');
    const nav = source.match(/<nav class="land-nav">[\s\S]*?<\/nav>/)?.[0] || '';
    const footer = source.match(/<footer class="land-footer">[\s\S]*?<\/footer>/)?.[0] || '';

    expect(source).toContain('property="og:image"');
    expect(source).toContain('name="twitter:image"');
    expect(source).toContain('/img/social/arena-og.png');
    expect(source).toContain('/img/social/arena-twitter.png');
    expect(nav).toContain('/field-notes');
    expect(nav).not.toContain('/architecture');
    expect(nav).not.toContain('/pitch');
    expect(nav).not.toContain('twitter.com/autobettarena');
    expect(footer).toContain('/architecture');
    expect(footer).toContain('/pitch');
    expect(footer).toContain('/field-notes');
    expect(footer).toContain('twitter.com/autobettarena');
    expect(source).not.toContain('id="service-health"');
  });

  it('keeps the welcome header aligned with the public site', () => {
    const source = readPublic('welcome.html');
    const nav = source.match(/<nav class="land-nav">[\s\S]*?<\/nav>/)?.[0] || '';
    const footer = source.match(/<footer class="land-footer">[\s\S]*?<\/footer>/)?.[0] || '';

    expect(source).toContain('property="og:image"');
    expect(source).toContain('name="twitter:image"');
    expect(nav).toContain('Autonomous <span>Arena</span>');
    expect(nav).toContain('/play?world=mega">Play');
    expect(nav).toContain('/viewer?world=mega">Preview');
    expect(nav).toContain('/field-notes">Field Notes');
    expect(nav).toContain('#welcome-session-cta');
    expect(nav).not.toContain('/architecture');
    expect(nav).not.toContain('/pitch');
    expect(nav).not.toContain('twitter.com/autobettarena');
    expect(nav).not.toContain('/dashboard');
    expect(footer).toContain('/architecture');
    expect(footer).toContain('/pitch');
    expect(footer).toContain('/field-notes');
    expect(footer).toContain('twitter.com/autobettarena');
  });

  it('publishes social card image assets', () => {
    expect(statSync(path.join(publicDir, 'img/social/arena-og.png')).size).toBeGreaterThan(10_000);
    expect(statSync(path.join(publicDir, 'img/social/arena-twitter.png')).size).toBeGreaterThan(10_000);
  });

  it('publishes sitemap entries for docs and Field Notes', () => {
    const sitemap = readPublic('sitemap.xml');
    for (const url of [
      'https://autobett.xyz/architecture',
      'https://autobett.xyz/pitch',
      'https://autobett.xyz/field-notes',
      'https://autobett.xyz/field-notes/what-is-a-prediction-arena',
      'https://autobett.xyz/field-notes/btc-up-down-local-market',
      'https://autobett.xyz/field-notes/agents-play-while-youre-away',
      'https://autobett.xyz/field-notes/coin-flip-dice-rps-dealer-games',
      'https://autobett.xyz/field-notes/micropayments-for-game-agents'
    ]) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });
});
