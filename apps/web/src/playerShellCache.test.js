import { describe, expect, it } from 'vitest';
import {
  mergePlayerShell,
  playerShellFromBootstrap,
  shouldRefreshPlayerShell
} from '../public/js/shared/player-shell.js';

describe('player shell cache helpers', () => {
  it('hydrates from bootstrap payload and profile fallback', () => {
    const shell = playerShellFromBootstrap({
      user: {
        profileId: 'profile_1',
        walletId: 'wallet_1'
      },
      profile: {
        id: 'profile_1',
        displayName: 'Temisan Agbajoh',
        username: 'temisan',
        wallet: { id: 'wallet_1', address: '0xabc' }
      },
      playerShell: {
        walletSummary: {
          onchain: { tokenBalance: 5.5 }
        }
      }
    });

    expect(shell.player.displayName).toBe('Temisan Agbajoh');
    expect(shell.walletSummary.onchain.tokenBalance).toBe(5.5);
  });

  it('merges refreshed slices without dropping cached ones', () => {
    const merged = mergePlayerShell(
      {
        player: { displayName: 'Temisan' },
        walletSummary: { onchain: { tokenBalance: 1 } },
        bot: { id: 'bot_1' },
        readiness: { status: 'ready' },
        activityPreview: [{ id: 'old', at: 1 }],
        loadedAt: 100
      },
      {
        walletSummary: { onchain: { tokenBalance: 2 } },
        activityPreview: [{ id: 'new', at: 2 }],
        loadedAt: 200
      }
    );

    expect(merged.player.displayName).toBe('Temisan');
    expect(merged.walletSummary.onchain.tokenBalance).toBe(2);
    expect(merged.bot.id).toBe('bot_1');
    expect(merged.activityPreview[0].id).toBe('new');
    expect(merged.loadedAt).toBe(200);
  });

  it('marks stale data after the ttl window', () => {
    expect(shouldRefreshPlayerShell(Date.now() - 31_000, Date.now(), 30_000)).toBe(true);
    expect(shouldRefreshPlayerShell(Date.now() - 5_000, Date.now(), 30_000)).toBe(false);
  });
});
