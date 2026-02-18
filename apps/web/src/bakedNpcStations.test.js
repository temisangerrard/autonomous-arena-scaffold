import { describe, expect, it } from 'vitest';
import { fallbackKindForSection, nearestSectionIndexForPosition } from '../public/js/play/runtime/baked-npc-stations.js';

describe('baked npc section assignment', () => {
  it('maps positions to deterministic nearest section', () => {
    expect(nearestSectionIndexForPosition(-79, -44)).toBe(0);
    expect(nearestSectionIndexForPosition(-24, -31)).toBe(1);
    expect(nearestSectionIndexForPosition(79, 54)).toBe(7);
  });

  it('assigns non-generic section fallback jobs', () => {
    const jobs = [];
    for (let section = 0; section < 8; section += 1) {
      jobs.push(fallbackKindForSection(section, 0));
    }
    expect(jobs).toContain('dealer_coinflip');
    expect(jobs).toContain('dealer_rps');
    expect(jobs).toContain('dealer_dice_duel');
    expect(jobs).toContain('cashier_bank');
  });
});
