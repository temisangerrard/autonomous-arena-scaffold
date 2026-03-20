import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = path.resolve(__dirname, '../public');

function readPublic(filePath) {
  return readFileSync(path.join(publicDir, filePath), 'utf8');
}

describe('stitch-aligned public shells', () => {
  it('uses AutoBett-led conversion copy on the welcome page', () => {
    const source = readPublic('welcome.html');
    expect(source).toContain('<title>AutoBett | Enter the Arena</title>');
    expect(source).toContain('Live betting arena on Base');
    expect(source).toContain('Fund a bot wallet and let strategy play in the same economy.');
  });

  it('brands the viewer as an AutoBett world preview', () => {
    const source = readPublic('viewer.html');
    expect(source).toContain('<title>AutoBett World Preview</title>');
    expect(source).toContain('World Preview');
    expect(source).toContain('Enter Arena');
  });

  it('frames play as live rounds with onchain settlement', () => {
    const source = readPublic('play.html');
    expect(source).toContain('<title>AutoBett Arena</title>');
    expect(source).toContain('settles onchain');
    expect(source).toContain('Choose a station and enter a live round.');
  });
});
