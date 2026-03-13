import { describe, expect, it } from 'vitest';
import { buildHouseFundsView } from '../public/js/admin-house-funds.js';

describe('admin house funds helper', () => {
  it('builds a consolidated total and preserves source actions', () => {
    const view = buildHouseFundsView({
      houseFunds: {
        totalVisibleUsdc: '8.500000',
        historicalTreasuryOutflowsUsdc: '1.000000',
        sources: [
          {
            sourceType: 'contract_treasury',
            label: 'On-chain treasury',
            balanceUsdc: '1.000000',
            walletId: null,
            address: '0xescrow',
            action: 'withdraw_treasury',
            description: 'Treasury funds'
          },
          {
            sourceType: 'house_wallet_onchain',
            label: 'House wallet (on-chain)',
            balanceUsdc: '4.500000',
            walletId: 'wallet_house',
            address: '0xhouse',
            action: 'transfer_wallet',
            description: 'Wallet funds'
          },
          {
            sourceType: 'runtime_wallet',
            label: 'House wallet (runtime)',
            balanceUsdc: '3.000000',
            walletId: 'wallet_house',
            address: '0xhouse',
            action: 'runtime_only',
            description: 'Runtime funds'
          }
        ]
      }
    });

    expect(view.totalLabel).toBe('8.50 USDC');
    expect(view.historicalOutflowsLabel).toBe('1.00 USDC');
    expect(view.note).toContain('historical treasury withdrawals');
    expect(view.sources).toEqual([
      expect.objectContaining({ sourceType: 'contract_treasury', actionLabel: 'Withdraw Treasury' }),
      expect.objectContaining({ sourceType: 'house_wallet_onchain', actionLabel: 'Send On-Chain' }),
      expect.objectContaining({ sourceType: 'runtime_wallet', actionLabel: 'Runtime Only' })
    ]);
  });
});
