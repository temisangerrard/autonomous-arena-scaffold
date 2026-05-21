import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = path.resolve(__dirname, '../public');

function readPublic(filePath) {
  return readFileSync(path.join(publicDir, filePath), 'utf8');
}

describe('stitch-aligned public shells', () => {
  it('uses Autonomous Arena conversion copy on the welcome page', () => {
    const source = readPublic('welcome.html');
    expect(source).toContain('<title>Autonomous Arena | Enter the Arena</title>');
    expect(source).toContain('live betting arena');
    expect(source).toContain('Leave an agent with a strategy when you want the arena working for you.');
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
    expect(source).toContain('the dealer locks in the market state on entry');
    expect(source).toContain('Choose a station and enter a live round.');
  });
});
