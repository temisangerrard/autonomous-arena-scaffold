import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hideNpcInfoPanel,
  showNpcInfoPanel
} from '../public/js/play/runtime/templates/interaction-card/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = resolve(__dirname, '../public/js/play/runtime/templates/interaction-card');

function readSource(...paths) {
  return paths.map((p) => readFileSync(resolve(templatesDir, p), 'utf8')).join('\n');
}

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
    const source = readSource('index.js');
    expect(source.includes('interactionPlayerRenderKey')).toBe(true);
    expect(source.includes('interactionPlayerRenderKey !== playerRenderKey')).toBe(true);
    expect(source.includes('const renderedTargetId = targetId;')).toBe(true);
    expect(source.includes('challengeController.sendChallenge(renderedTargetId, gameType, wager)')).toBe(true);
  });

  it('clears challenge timeout timers after server state advances', () => {
    const source = readSource('index.js');
    expect(source.includes("if (outgoingPending || state.challengeStatus === 'active')")).toBe(true);
    expect(source.includes("clearTimer('challenge:send')")).toBe(true);
    expect(source.includes('if (!state.respondingIncoming)')).toBe(true);
    expect(source.includes("clearTimer('challenge:respond')")).toBe(true);
  });

  it('uses longer dealer timeouts and clears preflight timeout on ready state', () => {
    const source = readSource('helpers.js', 'coinflip-panel.js');
    expect(source.includes('DEALER_PREFLIGHT_TIMEOUT_MS = 20_000')).toBe(true);
    expect(source.includes('DEALER_PICK_TIMEOUT_MS = 45_000')).toBe(true);
    expect(source.includes("startTimer('dealer:preflight'")).toBe(true);
    expect(source.includes("startTimer('dealer:pick'")).toBe(true);
    expect(source.includes("ds !== 'preflight'")).toBe(true);
    expect(source.includes("clearTimer('dealer:preflight')")).toBe(true);
  });

  it('renders the btc board as a btc-only trading rail', () => {
    const source = readSource('prediction-panel.js');
    expect(source.includes('prediction-tabs')).toBe(true);
    expect(source.includes('BTC 5m')).toBe(true);
    expect(source.includes('BTC 24h')).toBe(true);
    expect(source.includes('prediction-round-current')).toBe(true);
    expect(source.includes('prediction-round-next')).toBe(true);
    expect(source.includes('prediction-market-select')).toBe(false);
    expect(source.includes('BTC Up')).toBe(true);
    expect(source.includes('BTC Down')).toBe(true);
    expect(source.includes('Next-round commitments lock immediately.')).toBe(true);
    expect(source.includes('No current BTC market is live right now.')).toBe(true);
    expect(source.includes('No next BTC market is available right now.')).toBe(true);
    expect(source.includes('Get quote')).toBe(false);
    expect(source.includes('My positions')).toBe(false);
    expect(source.includes('prediction-buy-yes')).toBe(false);
    expect(source.includes('prediction-buy-no')).toBe(false);
  });

  it('uses local btc board prechecks before sending prediction orders', () => {
    const source = readSource('prediction-panel.js');
    expect(source.includes('function validatePredictionOrder')).toBe(true);
    expect(source.includes('function isAutoRefreshablePredictionFailure')).toBe(true);
    expect(source.includes("dispatchPrediction('prediction_markets_open')")).toBe(true);
    expect(source.includes('Insufficient USDC balance for this stake.')).toBe(true);
    expect(source.includes('Selected BTC market is no longer open.')).toBe(true);
    expect(source.includes('No current BTC market is live right now.')).toBe(true);
    expect(source.includes('No next BTC market is available right now.')).toBe(true);
  });

  it('keeps prediction orders in processing state when server response is delayed', () => {
    const source = readSource('prediction-panel.js');
    expect(source.includes("startTimer('prediction:buy'")).toBe(true);
    expect(source.includes("state.ui.prediction.lastReason = 'prediction_processing'")).toBe(true);
    expect(source.includes("state.ui.prediction.lastReasonText = 'Still confirming order…'")).toBe(true);
    expect(source.includes("showToast('Still confirming order…', 'warning')")).toBe(true);
  });

  it('surfaces prediction rail timing and availability states', () => {
    const source = readSource('prediction-panel.js');
    expect(source.includes('Closing soon')).toBe(true);
    expect(source.includes('Next round in')).toBe(true);
    expect(source.includes('Available for early commit')).toBe(true);
    expect(source.includes('Locks:')).toBe(true);
    expect(source.includes('Settles:')).toBe(true);
    expect(source.includes('BTC now:')).toBe(true);
    expect(source.includes('Lock:')).toBe(true);
    expect(source.includes('Final:')).toBe(true);
  });

  it('normalizes coinflip, rps, and dice cards around the same structure', () => {
    const source = readSource('coinflip-panel.js', 'rps-dice-panel.js');
    expect(source.includes('Coinflip')).toBe(true);
    expect(source.includes('Rock Paper Scissors')).toBe(true);
    expect(source.includes('Dice Duel')).toBe(true);
    expect(source.includes('Pick heads or tails after the round locks.')).toBe(true);
    expect(source.includes('Start the round, then throw your move.')).toBe(true);
    expect(source.includes('Pick the face you think will land.')).toBe(true);
    expect(source.includes('Start Round')).toBe(true);
  });

  it('excludes house challenges from the interaction card force-close guard', () => {
    const source = readSource('index.js');
    // Must detect house challenges before deciding to force-close the interaction card
    expect(source.includes("active.challengerId === 'system_house' || active.opponentId === 'system_house'")).toBe(true);
    expect(source.includes('!isHouseChallenge && state.ui.interactionMode !== \'station\'')).toBe(true);
  });

  it('renders escrow activity with explicit game outcomes and suppresses redundant lock rows', () => {
    const source = readFileSync(resolve(__dirname, '../public/js/dashboard.js'), 'utf8');
    expect(source.includes('const terminalEscrowChallenges = new Set(')).toBe(true);
    expect(source.includes('Game WIN')).toBe(true);
    expect(source.includes('Game LOSS')).toBe(true);
    expect(source.includes('Game PUSH')).toBe(true);
    expect(source.includes('Refund Failed')).toBe(true);
    expect(source.includes('Stake Locked')).toBe(true);
  });
});
