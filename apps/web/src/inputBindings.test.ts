import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('input bindings source regression', () => {
  it('removes V target cycling and keeps Tab cycling', () => {
    const source = readFileSync(new URL('../public/js/play/input.js', import.meta.url), 'utf8');
    expect(source.includes("event.code === 'KeyV'")).toBe(false);
    expect(source.includes("event.code === 'Tab'")).toBe(true);
    expect(source.includes('actions.cycleNearbyTarget?.(!event.shiftKey);')).toBe(true);
  });

  it('removes the mobile target button wiring and markup', () => {
    const inputSource = readFileSync(new URL('../public/js/play/input.js', import.meta.url), 'utf8');
    const domSource = readFileSync(new URL('../public/js/play/dom.js', import.meta.url), 'utf8');
    const htmlSource = readFileSync(new URL('../public/play.html', import.meta.url), 'utf8');
    expect(inputSource.includes('mobileTarget')).toBe(false);
    expect(domSource.includes('mobileTarget')).toBe(false);
    expect(htmlSource.includes('id="mobile-target"')).toBe(false);
  });
});
