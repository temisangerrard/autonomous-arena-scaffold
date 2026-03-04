import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('input bindings source regression', () => {
  it('removes V target cycling and keeps Tab cycling', () => {
    const indexSource = readFileSync(new URL('../public/js/play/input/index.js', import.meta.url), 'utf8');
    const actionSource = readFileSync(new URL('../public/js/play/input/action-keys.js', import.meta.url), 'utf8');
    expect(indexSource.includes("event.code === 'KeyV'")).toBe(false);
    expect(actionSource.includes("event.code === 'KeyV'")).toBe(false);
    expect(actionSource.includes("event.code === 'Tab'")).toBe(true);
    expect(actionSource.includes('actions.cycleNearbyTarget?.(!event.shiftKey)')).toBe(true);
  });

  it('removes the mobile target button wiring and markup', () => {
    const inputSource = readFileSync(new URL('../public/js/play/input/index.js', import.meta.url), 'utf8');
    const domSource = readFileSync(new URL('../public/js/play/dom.js', import.meta.url), 'utf8');
    const htmlSource = readFileSync(new URL('../public/play.html', import.meta.url), 'utf8');
    expect(inputSource.includes('mobileTarget')).toBe(false);
    expect(domSource.includes('mobileTarget')).toBe(false);
    expect(htmlSource.includes('id="mobile-target"')).toBe(false);
  });
});
