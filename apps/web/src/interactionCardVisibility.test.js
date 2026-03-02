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

  it('renders the btc board as a btc-only trading rail', () => {
    const source = readFileSync(new URL('../public/js/play/runtime/templates/interaction-card.js', import.meta.url), 'utf8');
    expect(source.includes('BTC Up')).toBe(true);
    expect(source.includes('BTC Down')).toBe(true);
    expect(source.includes('If your side wins without opposite liquidity, your stake is refunded.')).toBe(true);
    expect(source.includes('No BTC market is live right now.')).toBe(true);
    expect(source.includes('Get quote')).toBe(false);
    expect(source.includes('My positions')).toBe(false);
    expect(source.includes('prediction-buy-yes')).toBe(false);
    expect(source.includes('prediction-buy-no')).toBe(false);
  });

  it('uses local btc board prechecks before sending prediction orders', () => {
    const source = readFileSync(new URL('../public/js/play/runtime/templates/interaction-card.js', import.meta.url), 'utf8');
    expect(source.includes('function validatePredictionOrder')).toBe(true);
    expect(source.includes('Insufficient USDC balance for this stake.')).toBe(true);
    expect(source.includes('Selected BTC market is no longer open.')).toBe(true);
    expect(source.includes('No BTC market is live right now.')).toBe(true);
  });
});
