import { describe, expect, it } from 'vitest';
import { buildPlayerShell, PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT } from './playerShell.js';

describe('buildPlayerShell', () => {
  it('builds a warm player shell with limited preview activity', () => {
    const shell = buildPlayerShell({
      user: {
        profileId: 'profile_1',
        walletId: 'wallet_1'
      },
      profile: {
        id: 'profile_1',
        displayName: 'Temisan Agbajoh',
        username: 'temisan',
        walletId: 'wallet_1',
        wallet: {
          id: 'wallet_1',
          address: '0xabc'
        }
      },
      walletSummary: {
        onchain: {
          address: '0xabc',
          tokenBalance: 4.2
        }
      },
      funding: {
        walletProvider: 'coinbase_embedded',
        depositAddress: '0xabc'
      },
      bot: {
        id: 'bot_1'
      },
      readiness: {
        status: 'ready'
      },
      activity: Array.from({ length: 8 }, (_, index) => ({ id: `entry_${index}`, at: index + 1 })),
      loadedAt: 123
    });

    expect(shell.player.displayName).toBe('Temisan Agbajoh');
    expect(shell.player.walletAddress).toBe('0xabc');
    expect(shell.activityPreview).toHaveLength(PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT);
    expect(shell.activityPreview[0]?.id).toBe('entry_7');
    expect(shell.loadedAt).toBe(123);
  });
});
