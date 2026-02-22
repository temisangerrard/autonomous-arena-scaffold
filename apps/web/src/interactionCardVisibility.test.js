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
});
