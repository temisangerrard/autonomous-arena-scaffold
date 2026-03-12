import { describe, expect, it } from 'vitest';
import { txExplorerBase, txExplorerUrl } from '../public/js/play/runtime/formatting.js';

describe('txExplorerBase', () => {
  it('defaults unknown chains to Base explorer', () => {
    expect(txExplorerBase(null)).toBe('https://basescan.org');
    expect(txExplorerBase(undefined)).toBe('https://basescan.org');
    expect(txExplorerBase(999999)).toBe('https://basescan.org');
  });

  it('builds valid tx URLs against Base explorer by default', () => {
    const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(txExplorerUrl(txHash, null)).toBe(`https://basescan.org/tx/${txHash}`);
  });
});
