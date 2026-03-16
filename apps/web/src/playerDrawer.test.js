import { describe, expect, it } from 'vitest';
import {
  buildAutoplayConfigPayload,
  deriveWalletReadinessLabel,
  deriveWalletSummaryView,
  limitDrawerActivity,
  seedDrawerDataFromRuntime,
  resolveFundingRoute
} from '../public/js/play/runtime/player-drawer.js';

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
        games: ['coinflip', 'blackjack'],
        wagerMode: 'martingale',
        walletPct: 5,
        martingaleMult: 2,
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
        games: ['coinflip', 'blackjack'],
        wagerMode: 'martingale',
        walletPct: 5,
        martingaleMult: 2,
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
    expect(seeded.summary.onchain.tokenBalance).toBe(12.5);
    expect(seeded.summary.onchain.chainId).toBe(8453);
    expect(seeded.funding.depositAddress).toBe('0xfeedbeefcafe');
  });
});
