import { describe, expect, it, vi } from 'vitest';
import { bindInteractionUi } from '../public/js/play/runtime/interaction-bindings.js';
import { mountCoinflipPanel, updateCoinflipLive } from '../public/js/play/runtime/templates/interaction-card/coinflip-panel.js';
import { mountRpsDicePanel, updateRpsDiceLive } from '../public/js/play/runtime/templates/interaction-card/rps-dice-panel.js';
import { mountBlackjackPanel, updateBlackjackLive } from '../public/js/play/runtime/templates/interaction-card/blackjack-panel.js';

function makeClassList() {
  const items = new Set();
  return {
    add: vi.fn((...names) => names.forEach((name) => items.add(name))),
    remove: vi.fn((...names) => names.forEach((name) => items.delete(name))),
    toggle: vi.fn((name, force) => {
      if (force === undefined) {
        if (items.has(name)) items.delete(name);
        else items.add(name);
        return items.has(name);
      }
      if (force) items.add(name);
      else items.delete(name);
      return force;
    }),
    contains: (name) => items.has(name)
  };
}

function makeElement(id, tagName = 'div') {
  return {
    id,
    tagName: String(tagName).toUpperCase(),
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    classList: makeClassList(),
    attributes: new Map(),
    onclick: null,
    addEventListener(type, handler) {
      this[`on${type}`] = handler;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
    querySelectorAll() {
      return [];
    },
    blur: vi.fn()
  };
}

function installPanelDom() {
  const elements = new Map();
  const stationUi = makeElement('station-ui');
  Object.defineProperty(stationUi, 'innerHTML', {
    get() {
      return this._html || '';
    },
    set(value) {
      this._html = String(value);
      const regex = /<([a-z]+)[^>]*id="([^"]+)"[^>]*>/g;
      let match;
      while ((match = regex.exec(this._html))) {
        const [, tag, id] = match;
        if (!elements.has(id)) {
          const el = makeElement(id, tag);
          if (String(tag).toLowerCase() === 'button' && globalThis.HTMLButtonElement) {
            Object.setPrototypeOf(el, globalThis.HTMLButtonElement.prototype);
          }
          elements.set(id, el);
        }
      }
      for (const [, el] of elements) {
        if (el.tagName === 'INPUT' && el.id === 'station-wager') {
          const valueMatch = this._html.match(/id="station-wager"[^>]*value="([^"]*)"/);
          el.value = valueMatch ? valueMatch[1] : '';
        }
      }
    }
  });

  const documentStub = {
    getElementById(id) {
      if (id === 'station-ui') return stationUi;
      return elements.get(id) || null;
    }
  };

  return { documentStub, stationUi, elements };
}

function withDocument(documentStub, run) {
  const originalDocument = globalThis.document;
  const originalHtmlButtonElement = globalThis.HTMLButtonElement;
  globalThis.document = documentStub;
  globalThis.HTMLButtonElement = function HTMLButtonElement() {};
  try {
    return run();
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLButtonElement = originalHtmlButtonElement;
  }
}

describe('interaction card controls', () => {
  it('closes the interaction card when the close button is tapped', () => {
    const interactionPrompt = makeElement('interaction-prompt', 'button');
    const interactionClose = makeElement('interaction-close', 'button');
    const setInteractOpen = vi.fn();

    bindInteractionUi({
      interactionPrompt,
      interactionClose,
      interactionHelpToggle: null,
      interactionHelp: null,
      getUiTargetId: () => 'station_npc_host_3',
      setInteractOpen
    });

    interactionClose.onclick?.();

    expect(setInteractOpen).toHaveBeenCalledWith(false);
  });

  it('starts a new coinflip round from the Play Again button after reveal', () => {
    const { documentStub, stationUi } = installPanelDom();
    const sendStationInteract = vi.fn(() => true);
    const state = {
      ui: {
        dealer: {
          state: 'idle',
          wager: 1,
          gameType: 'coinflip',
          playerPick: 'heads',
          opponentPick: '',
          coinflipResult: 'heads',
          payoutDelta: 1,
          escrowTx: {}
        }
      },
      walletBalance: 0,
      walletChainId: 8453
    };
    const station = { id: 'station_dealer_coinflip_a', kind: 'dealer_coinflip' };

    withDocument(documentStub, () => {
      mountCoinflipPanel({
        state,
        stationUi,
        station,
        sendStationInteract,
        makePlayerSeed: () => 'seed-a',
        showToast: vi.fn()
      });
      state.ui.dealer.state = 'reveal';
      updateCoinflipLive({
        state,
        station,
        renderDealerRevealStatus: vi.fn(),
        setPendingBtn: vi.fn(),
        clearPendingBtn: vi.fn(),
        flashBtn: vi.fn(),
        clearTimer: vi.fn()
      });
      documentStub.getElementById('station-house-start').onclick?.();
    });

    expect(sendStationInteract).toHaveBeenCalledWith(station, 'coinflip_house_start', { wager: 1 });
  });

  it('starts a new rps round from the Play Again button after reveal', () => {
    const { documentStub, stationUi } = installPanelDom();
    const sendStationInteract = vi.fn(() => true);
    const state = {
      ui: {
        dealer: {
          state: 'idle',
          wager: 2,
          gameType: 'rps',
          playerPick: 'rock',
          opponentPick: 'scissors',
          coinflipResult: '',
          payoutDelta: 2,
          escrowTx: {}
        }
      },
      walletBalance: 0,
      walletChainId: 8453
    };
    const station = { id: 'station_dealer_rps_a', kind: 'dealer_rps' };

    withDocument(documentStub, () => {
      mountRpsDicePanel({
        state,
        stationUi,
        station,
        sendStationInteract,
        makePlayerSeed: () => 'seed-b',
        showToast: vi.fn()
      });
      state.ui.dealer.state = 'reveal';
      updateRpsDiceLive({
        state,
        station,
        renderDealerRevealStatus: vi.fn(),
        clearPendingBtn: vi.fn(),
        flashBtn: vi.fn(),
        clearTimer: vi.fn()
      });
      documentStub.getElementById('station-house-start').onclick?.();
    });

    expect(sendStationInteract).toHaveBeenCalledWith(station, 'rps_house_start', { wager: 2 });
  });

  it('starts a new blackjack hand from the Play Again button after reveal', () => {
    const { documentStub, stationUi } = installPanelDom();
    const sendStationInteract = vi.fn(() => true);
    const state = {
      ui: {
        dealer: {
          state: 'idle',
          wager: 3,
          gameType: 'blackjack',
          playerHand: ['10♠', '8♥'],
          dealerHand: ['9♣', '7♦'],
          playerHandValue: 18,
          dealerHandValue: 16,
          dealerShowValue: 9,
          isSoft: false,
          payoutDelta: 0,
          escrowTx: {}
        }
      },
      walletBalance: 0,
      walletChainId: 8453
    };
    const station = { id: 'station_dealer_blackjack_a', kind: 'dealer_blackjack' };

    withDocument(documentStub, () => {
      mountBlackjackPanel({
        state,
        stationUi,
        station,
        sendStationInteract,
        makePlayerSeed: () => 'seed-c',
        showToast: vi.fn()
      });
      state.ui.dealer.state = 'reveal';
      updateBlackjackLive({
        state,
        station,
        renderDealerRevealStatus: vi.fn(),
        clearPendingBtn: vi.fn(),
        flashBtn: vi.fn(),
        clearTimer: vi.fn()
      });
      documentStub.getElementById('bj-deal-btn').onclick?.();
    });

    expect(sendStationInteract).toHaveBeenCalledWith(station, 'blackjack_start', { wager: 3, playerSeed: 'seed-c' });
  });
});
