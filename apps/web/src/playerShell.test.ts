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
        id: 'bot_1',
        controlMode: 'bot_active',
        actorClass: 'owner'
      },
      readiness: {
        status: 'ready'
      },
      activity: [
        {
          id: 'match_1',
          kind: 'escrow',
          at: 10,
          challengeId: 'challenge_1',
          gameType: 'coinflip',
          wager: 2,
          opponentLabel: 'Wolverine',
          opponentClass: 'player_bot',
          outcome: 'resolved',
          winnerId: 'u_profile_1',
          txUrl: 'https://example.test/tx/1'
        },
        ...Array.from({ length: 7 }, (_, index) => ({ id: `entry_${index}`, at: index + 1 }))
      ],
      loadedAt: 123
    });

    expect(shell.player.displayName).toBe('Temisan Agbajoh');
    expect(shell.player.walletAddress).toBe('0xabc');
    expect(shell.bot?.controlMode).toBe('bot_active');
    expect(shell.bot?.actorClass).toBe('owner');
    expect(shell.activityPreview).toHaveLength(PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT);
    expect(shell.activityPreview[0]?.id).toBe('match_1');
    expect(shell.activityPreview[0]?.activityType).toBe('match');
    expect(shell.activityPreview[0]?.title).toContain('Coinflip');
    expect(shell.activityPreview[0]?.detail).toContain('Wolverine');
    expect(shell.loadedAt).toBe(123);
  });
});
