import { describe, expect, it, vi } from 'vitest';
import { createEscrowApprovalController } from '../public/js/play/runtime/escrow-approval.js';

function makeState() {
  return {
    walletEscrowApprovalCapUsdc: 25,
    escrowApproval: { mode: 'manual' },
    ui: {
      challenge: {
        approvalState: 'idle',
        approvalMessage: '',
        approvalWager: 0
      }
    }
  };
}

describe('escrow approval controller', () => {
  it('uses the configured cap in the manual approval message when allowance is low', async () => {
    const state = makeState();
    const controller = createEscrowApprovalController({
      state,
      apiJson: vi.fn(async () => ({
        ok: false,
        reason: 'allowance_too_low',
        results: [{
          ok: false,
          reason: 'allowance_too_low',
          approvalTargetAmount: '25',
          approvalCapUsdc: 25
        }]
      })),
      formatUsdAmount: (value) => `$${Number(value).toFixed(2)}`,
      challengeReasonLabel: (reason) => reason,
      showToast: vi.fn()
    });

    const ok = await controller.ensureEscrowApproval(3);

    expect(ok).toBe(false);
    expect(state.ui.challenge.approvalState).toBe('required');
    expect(state.ui.challenge.approvalMessage).toContain('$25.00');
    expect(state.ui.challenge.approvalMessage).toContain('cap');
  });

  it('runs the Coinbase approval flow and re-checks allowance when the wallet is embedded', async () => {
    const state = makeState();
    state.walletProvider = 'coinbase_embedded';
    state.walletExternalAddress = '0x2222222222222222222222222222222222222222';
    state.walletEscrowApprovalTokenAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    state.walletEscrowApprovalSpenderAddress = '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d';

    const apiJson = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: 'allowance_too_low',
        results: [{
          ok: false,
          reason: 'allowance_too_low',
          approvalTargetAmount: '25',
          approvalCapUsdc: 25,
          approvalTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          approvalSpenderAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d'
        }]
      })
      .mockResolvedValueOnce({
        ok: true,
        results: [{ ok: true, approvalTargetAmount: '25', approvalCapUsdc: 25 }]
      });
    const walletApprovalClient = {
      approveEscrowCap: vi.fn(async () => ({ transactionHash: '0xabc' }))
    };

    const controller = createEscrowApprovalController({
      state,
      apiJson,
      walletApprovalClient,
      formatUsdAmount: (value) => `$${Number(value).toFixed(2)}`,
      challengeReasonLabel: (reason) => reason,
      showToast: vi.fn()
    });

    const ok = await controller.ensureEscrowApproval(3);

    expect(ok).toBe(true);
    expect(walletApprovalClient.approveEscrowCap).toHaveBeenCalledWith({
      capUsdc: 25,
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      spenderAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d',
      smartAccount: '0x2222222222222222222222222222222222222222'
    });
    expect(state.ui.challenge.approvalState).toBe('ready');
    expect(state.ui.challenge.approvalMessage).toContain('$25.00');
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

});
