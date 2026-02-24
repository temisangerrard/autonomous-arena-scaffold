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

  it('clears challenge timeout timers after server state advances', () => {
    const source = readFileSync(new URL('../public/js/play/runtime/templates/interaction-card.js', import.meta.url), 'utf8');
    expect(source.includes("if (outgoingPending || state.challengeStatus === 'active')")).toBe(true);
    expect(source.includes("_clearTimer('challenge:send');")).toBe(true);
    expect(source.includes('if (!state.respondingIncoming)')).toBe(true);
    expect(source.includes("_clearTimer('challenge:respond');")).toBe(true);
  });

  it('uses longer dealer timeouts and clears preflight timeout on ready state', () => {
    const source = readFileSync(new URL('../public/js/play/runtime/templates/interaction-card.js', import.meta.url), 'utf8');
    expect(source.includes('const DEALER_PREFLIGHT_TIMEOUT_MS = 20_000;')).toBe(true);
    expect(source.includes('const DEALER_PICK_TIMEOUT_MS = 45_000;')).toBe(true);
    expect(source.includes("_startTimer('dealer:preflight', onCoinflipTimeout, DEALER_PREFLIGHT_TIMEOUT_MS);")).toBe(true);
    expect(source.includes("_startTimer('dealer:pick', onCoinflipTimeout, DEALER_PICK_TIMEOUT_MS);")).toBe(true);
    expect(source.includes("if (ds !== 'preflight') {")).toBe(true);
    expect(source.includes("_clearTimer('dealer:preflight');")).toBe(true);
  });
});
