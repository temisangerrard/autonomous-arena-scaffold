import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAutoplayConfigPayload,
  createPlayerDrawerController,
  deriveWalletReadinessLabel,
  deriveWalletSummaryView,
  limitDrawerActivity,
  seedDrawerDataFromRuntime,
  resolveFundingRoute
} from '../public/js/play/runtime/player-drawer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('player drawer helpers', () => {
  it('limits in-arena recent activity to the last five items', () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({ id: `entry_${index}`, at: index + 1 }));

    expect(limitDrawerActivity(entries).map((entry) => entry.id)).toEqual([
      'entry_6',
      'entry_5',
      'entry_4',
      'entry_3',
      'entry_2'
    ]);
  });

  it('prefers embedded funding when the wallet provider is coinbase embedded', () => {
    expect(resolveFundingRoute({
      walletProvider: 'coinbase_embedded',
      walletAddress: '0xabc',
      externalAddress: '0xdef'
    }).kind).toBe('embedded_onramp');

    expect(resolveFundingRoute({
      walletProvider: 'internal',
      walletAddress: '0xabc',
      externalAddress: null
    }).kind).toBe('external_onramp');
  });

  it('preserves existing bot behavior while updating autoplay only', () => {
    const payload = buildAutoplayConfigPayload({
      bot: {
        behavior: {
          personality: 'social',
          targetPreference: 'human_first',
          challengeCooldownMs: 2600,
          mode: 'active',
          baseWager: 1,
          maxWager: 3,
          sessionLossLimit: 5,
          sessionWinTarget: 12
        }
      },
      autoplay: {
        enabled: true,
        allowedGames: ['coinflip'],
        wagerMode: 'martingale',
        walletPercent: 5,
        martingaleMultiplier: 2,
        baseWager: 1,
        maxWager: 3,
        sessionLossLimit: 5,
        sessionWinTarget: 12,
        cooldownMs: 3000
      }
    });

    expect(payload).toEqual({
      personality: 'social',
      targetPreference: 'human_first',
      challengeCooldownMs: 2600,
      mode: 'active',
      baseWager: 1,
      maxWager: 3,
      sessionLossLimit: 5,
      sessionWinTarget: 12,
      autoplay: {
        enabled: true,
        allowedGames: ['coinflip'],
        wagerMode: 'martingale',
        walletPercent: 5,
        martingaleMultiplier: 2,
        baseWager: 1,
        maxWager: 3,
        sessionLossLimit: 5,
        sessionWinTarget: 12,
        cooldownMs: 3000
      }
    });
  });

  it('maps runtime readiness statuses to user-facing labels', () => {
    expect(deriveWalletReadinessLabel({ status: 'ready' })).toBe('Ready');
    expect(deriveWalletReadinessLabel({ status: 'insufficient_usdc' })).toBe('Low Funds');
    expect(deriveWalletReadinessLabel({ status: 'needs_approval' })).toBe('Needs Approval');
    expect(deriveWalletReadinessLabel({ status: 'all_checks_passed' })).toBe('Ready');
  });

  it('renders match-ledger style activity summaries for escrow matches', () => {
    const entries = limitDrawerActivity([
      {
        id: 'match_1',
        kind: 'match',
        title: 'Coinflip vs Wolverine',
        detail: 'Player Bot · Wager US$2.00 · Won',
        at: Date.now()
      }
    ]);

    expect(entries[0]).toMatchObject({
      id: 'match_1',
      kind: 'match',
      title: 'Coinflip vs Wolverine'
    });
  });

  it('renders activity cards with badges and value labels for runtime events', () => {
    const source = readFileSync(path.resolve(__dirname, '../public/js/play/runtime/player-drawer.js'), 'utf8');
    expect(source).toContain('player-drawer__activity-badge');
    expect(source).toContain('player-drawer__activity-amount');
    expect(source).toContain('player-drawer__activity-item--');
  });

  it('shows low funds as the control mode when bot readiness is insufficient', () => {
    const source = readFileSync(path.resolve(__dirname, '../public/js/play/runtime/player-drawer.js'), 'utf8');
    expect(source).toContain("if (status === 'insufficient_usdc') return 'Low Funds';");
  });

  it('derives wallet address from profile or onchain summary instead of missing wallet fields', () => {
    const view = deriveWalletSummaryView({
      player: {
        displayName: 'Temisan Agbajoh',
        profile: {
          wallet: {
            address: '0xabc123456789'
          }
        }
      },
      summary: {
        onchain: {
          tokenBalance: 5.6,
          tokenSymbol: 'USDC',
          address: '0xonchain999'
        },
        wallet: {
          walletProvider: 'coinbase_embedded'
        }
      },
      readiness: {
        status: 'ready'
      },
      funding: {
        kind: 'embedded_onramp',
        href: 'https://www.coinbase.com/buy',
        depositAddress: ''
      }
    });

    expect(view.balanceLabel).toBe('US$5.60');
    expect(view.walletAddress).toBe('0xabc123456789');
    expect(view.depositAddress).toBe('0xabc123456789');
    expect(view.readinessLabel).toBe('Ready');
  });

  it('seeds the drawer immediately from runtime state before network refresh completes', () => {
    const seeded = seedDrawerDataFromRuntime({
      state: {
        walletBalance: 12.5,
        walletChainId: 8453,
        walletTokenSymbol: 'USDC',
        walletProvider: 'coinbase_embedded',
        walletExternalAddress: '0xfeedbeefcafe'
      },
      dom: {
        topbarName: {
          textContent: 'Temisan Agbajoh'
        }
      }
    });

    expect(seeded.player.displayName).toBe('Temisan Agbajoh');
    expect(seeded.walletSummary.onchain.tokenBalance).toBe(12.5);
    expect(seeded.walletSummary.onchain.chainId).toBe(8453);
    expect(seeded.funding.depositAddress).toBe('0xfeedbeefcafe');
  });

  it('opens from warm player shell state without blocking api fetches', async () => {
    const apiCalls = [];
    const state = {
      walletBalance: 12.5,
      walletChainId: 8453,
      walletTokenSymbol: 'USDC',
      walletProvider: 'coinbase_embedded',
      walletExternalAddress: '0xfeedbeefcafe',
      playerShellData: {
        player: { displayName: 'Temisan Agbajoh', walletAddress: '0xfeedbeefcafe' },
        walletSummary: {
          onchain: { tokenBalance: 12.5, chainId: 8453, tokenSymbol: 'USDC' },
          wallet: { walletProvider: 'coinbase_embedded', externalWalletAddress: '0xfeedbeefcafe' }
        },
        funding: { depositAddress: '0xfeedbeefcafe', href: 'https://www.coinbase.com/buy' },
        activityPreview: [{ id: 'activity_1', at: Date.now() }],
        loadedAt: Date.now()
      },
      playerShellLoadedAt: Date.now()
    };
    const classList = { toggle() {} };
    const drawer = { classList, setAttribute() {} };
    const drawerBackdrop = { toggleAttribute() {}, classList, addEventListener() {} };
    const drawerClose = { addEventListener() {} };
    const drawerBody = { innerHTML: '', querySelector() { return null; } };
    const controller = createPlayerDrawerController({
      apiJson: async (url) => {
        apiCalls.push(url);
        return null;
      },
      state,
      syncWalletSummary: async () => true,
      showToast() {},
      windowRef: { addEventListener() {}, navigator: { clipboard: { writeText: async () => {} } }, open() {} },
      drawer,
      drawerBackdrop,
      drawerClose,
      drawerBody,
      dom: {
        topbarName: { textContent: 'Temisan Agbajoh' }
      }
    });

    controller.setOpen(true);
    await Promise.resolve();

    expect(apiCalls).toEqual([]);
  });

  it('refreshes stale player shell without refetching /api/player/me', async () => {
    const apiCalls = [];
    const now = Date.now();
    const state = {
      walletBalance: 12.5,
      walletChainId: 8453,
      walletTokenSymbol: 'USDC',
      walletProvider: 'coinbase_embedded',
      walletExternalAddress: '0xfeedbeefcafe',
      playerShellData: {
        player: { displayName: 'Temisan Agbajoh', walletAddress: '0xfeedbeefcafe' },
        walletSummary: {
          onchain: { tokenBalance: 12.5, chainId: 8453, tokenSymbol: 'USDC' },
          wallet: { walletProvider: 'coinbase_embedded', externalWalletAddress: '0xfeedbeefcafe' }
        },
        funding: { depositAddress: '0xfeedbeefcafe', href: 'https://www.coinbase.com/buy' },
        bot: { id: 'bot_1' },
        activityPreview: [{ id: 'activity_1', at: now - 10_000 }],
        loadedAt: now - 31_000
      },
      playerShellLoadedAt: now - 31_000
    };
    const classList = { toggle() {} };
    const controller = createPlayerDrawerController({
      apiJson: async (url) => {
        apiCalls.push(url);
        if (url === '/api/player/wallet/summary') {
          return {
            onchain: { tokenBalance: 15, chainId: 8453, tokenSymbol: 'USDC' },
            wallet: { walletProvider: 'coinbase_embedded', externalWalletAddress: '0xfeedbeefcafe' }
          };
        }
        if (url === '/api/player/activity?limit=5') {
          return { activity: [{ id: 'activity_2', at: now }] };
        }
        if (url === '/api/player/bots/bot_1/wallet') {
          return { readiness: { status: 'ready' } };
        }
        return null;
      },
      state,
      syncWalletSummary: async () => true,
      showToast() {},
      windowRef: { addEventListener() {}, navigator: { clipboard: { writeText: async () => {} } }, open() {} },
      drawer: { classList, setAttribute() {} },
      drawerBackdrop: { toggleAttribute() {}, classList, addEventListener() {} },
      drawerClose: { addEventListener() {} },
      drawerBody: { innerHTML: '', querySelector() { return null; } },
      dom: {
        topbarName: { textContent: 'Temisan Agbajoh' }
      }
    });

    controller.setOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCalls).toContain('/api/player/wallet/summary');
    expect(apiCalls).toContain('/api/player/activity?limit=5');
    expect(apiCalls).toContain('/api/player/bots/bot_1/wallet');
    expect(apiCalls).not.toContain('/api/player/me');
  });

  it('hydrates missing bot data from player bootstrap before wiring autoplay actions', async () => {
    const apiCalls = [];
    const now = Date.now();
    const state = {
      walletBalance: 12.5,
      walletChainId: 8453,
      walletTokenSymbol: 'USDC',
      walletProvider: 'coinbase_embedded',
      walletExternalAddress: '0xfeedbeefcafe',
      playerShellData: {
        player: { displayName: 'Temisan Agbajoh', walletAddress: '0xfeedbeefcafe' },
        walletSummary: {
          onchain: { tokenBalance: 12.5, chainId: 8453, tokenSymbol: 'USDC' },
          wallet: { walletProvider: 'coinbase_embedded', externalWalletAddress: '0xfeedbeefcafe' }
        },
        funding: { depositAddress: '0xfeedbeefcafe', href: 'https://www.coinbase.com/buy' },
        activityPreview: [{ id: 'activity_1', at: now - 10_000 }],
        loadedAt: now - 31_000
      },
      playerShellLoadedAt: now - 31_000
    };
    const classList = { toggle() {} };
    const controller = createPlayerDrawerController({
      apiJson: async (url) => {
        apiCalls.push(url);
        if (url === '/api/player/bootstrap') {
          return {
            playerShell: {
              bot: { id: 'bot_2', behavior: { autoplay: { enabled: true, allowedGames: ['rps'] } } }
            }
          };
        }
        if (url === '/api/player/wallet/summary') {
          return {
            onchain: { tokenBalance: 15, chainId: 8453, tokenSymbol: 'USDC' },
            wallet: { walletProvider: 'coinbase_embedded', externalWalletAddress: '0xfeedbeefcafe' }
          };
        }
        if (url === '/api/player/activity?limit=5') {
          return { activity: [{ id: 'activity_2', at: now }] };
        }
        if (url === '/api/player/bots/bot_2/wallet') {
          return { readiness: { status: 'ready' } };
        }
        return null;
      },
      state,
      syncWalletSummary: async () => true,
      showToast() {},
      windowRef: { addEventListener() {}, navigator: { clipboard: { writeText: async () => {} } }, open() {} },
      drawer: { classList, setAttribute() {} },
      drawerBackdrop: { toggleAttribute() {}, classList, addEventListener() {} },
      drawerClose: { addEventListener() {} },
      drawerBody: { innerHTML: '', querySelector() { return null; } },
      dom: {
        topbarName: { textContent: 'Temisan Agbajoh' }
      }
    });

    controller.setOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCalls).toContain('/api/player/bootstrap');
    expect(apiCalls).toContain('/api/player/bots/bot_2/wallet');
    expect(state.playerShellData.bot).toMatchObject({ id: 'bot_2' });
  });
});
