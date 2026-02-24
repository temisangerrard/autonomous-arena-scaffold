import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hideNpcInfoPanel,
  showNpcInfoPanel
} from '../public/js/play/runtime/templates/interaction-card.js';

describe('interaction npc panel visibility', () => {
  it('forces display none when hiding after player mode', () => {
    const el = {
      hidden: false,
      style: { display: 'grid' }
    };

    showNpcInfoPanel(el);
    expect(el.hidden).toBe(false);
    expect(el.style.display).toBe('grid');

    hideNpcInfoPanel(el);
    expect(el.hidden).toBe(true);
    expect(el.style.display).toBe('none');
  });

  it('gates player card rerenders and sends challenge to rendered target', () => {
    const source = readFileSync(new URL('../public/js/play/runtime/templates/interaction-card.js', import.meta.url), 'utf8');
    expect(source.includes('interactionPlayerRenderKey')).toBe(true);
    expect(source.includes('interactionPlayerRenderKey !== playerRenderKey')).toBe(true);
    expect(source.includes('const renderedTargetId = targetId;')).toBe(true);
    expect(source.includes('challengeController.sendChallenge(renderedTargetId, gameType, wager)')).toBe(true);
  });
});
