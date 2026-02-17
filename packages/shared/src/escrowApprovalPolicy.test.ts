import { describe, expect, it } from 'vitest';
import { classifyEscrowApprovalNetwork, resolveEscrowApprovalPolicy } from './escrowApprovalPolicy.js';

describe('escrowApprovalPolicy', () => {
  it('detects sepolia networks', () => {
    expect(classifyEscrowApprovalNetwork(11155111, null)).toBe('sepolia');
    expect(classifyEscrowApprovalNetwork(84532, null)).toBe('sepolia');
    expect(classifyEscrowApprovalNetwork(null, 'sepolia')).toBe('sepolia');
  });

  it('detects mainnet networks', () => {
    expect(classifyEscrowApprovalNetwork(1, null)).toBe('mainnet');
    expect(classifyEscrowApprovalNetwork(8453, null)).toBe('mainnet');
    expect(classifyEscrowApprovalNetwork(null, 'mainnet')).toBe('mainnet');
  });

  it('resolves auto mode for sepolia and manual for mainnet', () => {
    const sepolia = resolveEscrowApprovalPolicy({
      chainId: 11155111,
      modeSepolia: 'auto',
      modeMainnet: 'manual',
      defaultMode: 'manual'
    });
    const mainnet = resolveEscrowApprovalPolicy({
      chainId: 1,
      modeSepolia: 'auto',
      modeMainnet: 'manual',
      defaultMode: 'auto'
    });

    expect(sepolia.mode).toBe('auto');
    expect(mainnet.mode).toBe('manual');
  });

  it('uses default mode when network is unknown', () => {
    const resolved = resolveEscrowApprovalPolicy({
      chainId: 999999,
      modeSepolia: 'auto',
      modeMainnet: 'manual',
      defaultMode: 'manual'
    });
    expect(resolved.mode).toBe('manual');
    expect(resolved.network).toBe('unknown');
  });
});

