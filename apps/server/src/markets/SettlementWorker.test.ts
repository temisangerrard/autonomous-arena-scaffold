import { describe, expect, it, vi } from 'vitest';
import { SettlementWorker } from './SettlementWorker.js';

describe('SettlementWorker', () => {
  it('refreshes market outcomes before settling resolved markets', async () => {
    const calls: string[] = [];
    const marketService = {
      async refreshMarketOutcomes() {
        calls.push('refresh');
      },
      async settleResolvedMarkets() {
        calls.push('settle');
        return { settled: 0 };
      }
    };
    const worker = new SettlementWorker(marketService as never, 30_000);

    await worker.tick();

    expect(calls).toEqual(['refresh', 'settle']);
  });

  it('does not run overlapping ticks', async () => {
    const release = vi.fn();
    let unblock!: () => void;
    const marketService = {
      async refreshMarketOutcomes() {
        await new Promise<void>((resolve) => {
          unblock = () => {
            release();
            resolve();
          };
        });
      },
      async settleResolvedMarkets() {
        return { settled: 0 };
      }
    };
    const worker = new SettlementWorker(marketService as never, 30_000);

    const first = worker.tick();
    const second = worker.tick();
    unblock();
    await Promise.all([first, second]);

    expect(release).toHaveBeenCalledTimes(1);
  });
});
