import { describe, expect, it } from 'vitest';
import { resolveGasSponsorshipPolicy } from './gasPolicy.js';

describe('resolveGasSponsorshipPolicy', () => {
  it('disables sponsorship on Base mainnet by default', () => {
    expect(resolveGasSponsorshipPolicy({ chainId: 8453 })).toMatchObject({
      network: 'mainnet',
      sponsorshipEnabled: false,
      userMustFundGas: true
    });
  });

  it('keeps sponsorship enabled on Sepolia rails', () => {
    expect(resolveGasSponsorshipPolicy({ chainId: 11155111 })).toMatchObject({
      network: 'sepolia',
      sponsorshipEnabled: true,
      userMustFundGas: false
    });
  });

  it('allows explicit mainnet override when needed', () => {
    expect(resolveGasSponsorshipPolicy({ chainId: 8453, mainnetEnabled: true })).toMatchObject({
      network: 'mainnet',
      sponsorshipEnabled: true,
      userMustFundGas: false
    });
  });
});
