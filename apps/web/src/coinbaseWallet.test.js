import { describe, expect, it, vi } from 'vitest';
import {
  appendBuilderCodeSuffix,
  buildApproveEscrowCall,
  createCoinbaseWalletApprovalClient,
  resolveSmartAccountAddress,
  resolveBuilderCodeContext,
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

  it('derives the default builder code suffix', () => {
    expect(resolveBuilderCodeContext({})).toEqual({
      code: 'bc_uukadkll',
      enabled: true,
      suffixHex: '0x0b62635f75756b61646b6c6c0080218021802180218021802180218021'
    });
  });

  it('appends the builder code suffix to an encoded call exactly once', () => {
    const { suffixHex } = resolveBuilderCodeContext({});
    const once = appendBuilderCodeSuffix('0xabcdef', suffixHex);
    const twice = appendBuilderCodeSuffix(once, suffixHex);

    expect(once).toBe('0xabcdef0b62635f75756b61646b6c6c0080218021802180218021802180218021');
    expect(twice).toBe(once);
  });

  it('includes builder code attribution on Coinbase smart-wallet user operations', async () => {
    const sendUserOperation = vi.fn(async () => ({ userOperationHash: '0xuserop' }));
    const getUserOperation = vi.fn(async () => ({ status: 'complete', transactionHash: '0xabc' }));
    const sdk = {
      initialize: vi.fn(),
      authenticateWithJWT: vi.fn(async () => {}),
      getCurrentUser: vi.fn(async () => ({
        evmSmartAccounts: ['0x2222222222222222222222222222222222222222']
      })),
      sendUserOperation,
      getUserOperation
    };
    const walletClient = createCoinbaseWalletApprovalClient({
      windowRef: { ARENA_CONFIG: { cdpProjectId: 'project_test' } },
      getFirebaseIdToken: async () => 'token_test',
      loadSdk: async () => sdk,
      loadViem: async () => ({
        encodeFunctionData: () => '0xabcdef'
      })
    });

    await walletClient.approveEscrowCap({
      smartAccount: '0x2222222222222222222222222222222222222222',
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      spenderAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d',
      capUsdc: 25,
      chainId: 8453
    });

    expect(sendUserOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [
          {
            to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            data: '0xabcdef'
              + '0b62635f75756b61646b6c6c0080218021802180218021802180218021'
          }
        ]
      })
    );
  });
});
