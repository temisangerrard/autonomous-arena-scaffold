import { describe, expect, it } from 'vitest';
import {
  buildApproveEscrowCall,
  resolveSmartAccountAddress,
  waitForUserOperationReceipt
} from '../public/js/lib/coinbase-wallet.js';

describe('coinbase wallet approval helpers', () => {
  it('prefers the expected smart account address when it is present on the CDP user', () => {
    const user = {
      evmSmartAccounts: [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222'
      ]
    };

    expect(resolveSmartAccountAddress(user, '0x2222222222222222222222222222222222222222')).toBe(
      '0x2222222222222222222222222222222222222222'
    );
  });

  it('builds an ERC20 approve call for the capped USDC amount', () => {
    const call = buildApproveEscrowCall({
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      spenderAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d',
      capUsdc: 25,
      encodeFunctionData: ({ functionName, args }) => `${functionName}:${args.join(':')}`
    });

    expect(call).toEqual({
      to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      data: 'approve:0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d:25000000'
    });
  });

  it('waits until the user operation is complete and returns the transaction hash', async () => {
    const getUserOperation = async () => ({
      status: 'complete',
      transactionHash: '0xabc'
    });

    await expect(waitForUserOperationReceipt({
      getUserOperation,
      userOperationHash: '0xuserop',
      evmSmartAccount: '0x2222222222222222222222222222222222222222',
      network: 'base',
      maxAttempts: 1,
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      transactionHash: '0xabc',
      status: 'complete'
    });
  });
});
