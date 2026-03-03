import { describe, expect, it } from 'vitest';
import type { BotRecord, Profile, WalletRecord } from '@arena/shared';
import { rebindProfileWallet } from './profileWalletBinding.js';

describe('rebindProfileWallet', () => {
  it('swaps wallets between profiles and rewrites subject links', () => {
    const profiles = new Map<string, Profile>([
      ['profile_tag', { id: 'profile_tag', username: 'tagbajoh', displayName: 'Temisan Agbajoh', createdAt: 1, walletId: 'wallet_wrong', ownedBotIds: ['bot_tag'] }],
      ['profile_other', { id: 'profile_other', username: 'other', displayName: 'Other', createdAt: 1, walletId: 'wallet_final', ownedBotIds: ['bot_other'] }]
    ]);
    const wallets = new Map<string, WalletRecord>([
      ['wallet_wrong', { id: 'wallet_wrong', ownerProfileId: 'profile_tag', address: '0x43D138d69F98E557337dc91432D71594f3dd42DE', encryptedPrivateKey: 'a', balance: 0, dailyTxCount: 0, txDayStamp: '2026-03-03', createdAt: 1, lastTxAt: null }],
      ['wallet_final', { id: 'wallet_final', ownerProfileId: 'profile_other', address: '0xdaeEDe8252FA59C51687ff34B1634b2cD62E8E98', encryptedPrivateKey: 'b', balance: 5, dailyTxCount: 0, txDayStamp: '2026-03-03', createdAt: 1, lastTxAt: null }]
    ]);
    const subjectLinks = new Map([
      ['firebase:tag', { subject: 'firebase:tag', profileId: 'profile_tag', walletId: 'wallet_wrong', linkedAt: 1, updatedAt: 2, continuitySource: 'postgres' as const }],
      ['google:tag', { subject: 'google:tag', profileId: 'profile_tag', walletId: 'wallet_wrong', linkedAt: 1, updatedAt: 2, continuitySource: 'postgres' as const }],
      ['firebase:other', { subject: 'firebase:other', profileId: 'profile_other', walletId: 'wallet_final', linkedAt: 1, updatedAt: 2, continuitySource: 'postgres' as const }]
    ]);
    const botRegistry = new Map<string, BotRecord>([
      ['bot_tag', { id: 'bot_tag', ownerProfileId: 'profile_tag', displayName: 'Tag Bot', createdAt: 1, managedBySuperAgent: true, duty: 'owner', patrolSection: 1, walletId: 'wallet_wrong' }],
      ['bot_other', { id: 'bot_other', ownerProfileId: 'profile_other', displayName: 'Other Bot', createdAt: 1, managedBySuperAgent: true, duty: 'owner', patrolSection: 2, walletId: 'wallet_final' }]
    ]);

    const result = rebindProfileWallet({
      profileId: 'profile_tag',
      walletId: 'wallet_final',
      profiles,
      wallets,
      subjectLinks,
      botRegistry,
      subjects: ['firebase:tag', 'google:tag']
    });

    expect(result.ok).toBe(true);
    expect(profiles.get('profile_tag')?.walletId).toBe('wallet_final');
    expect(profiles.get('profile_other')?.walletId).toBe('wallet_wrong');
    expect(wallets.get('wallet_final')?.ownerProfileId).toBe('profile_tag');
    expect(wallets.get('wallet_wrong')?.ownerProfileId).toBe('profile_other');
    expect(subjectLinks.get('firebase:tag')?.walletId).toBe('wallet_final');
    expect(subjectLinks.get('google:tag')?.walletId).toBe('wallet_final');
    expect(subjectLinks.get('firebase:other')?.walletId).toBe('wallet_wrong');
    expect(botRegistry.get('bot_tag')?.walletId).toBe('wallet_final');
    expect(botRegistry.get('bot_other')?.walletId).toBe('wallet_wrong');
  });
});
