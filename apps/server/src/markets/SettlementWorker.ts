import type { MarketService } from './MarketService.js';

export class SettlementWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly marketService: MarketService,
    private readonly intervalMs = Math.max(15_000, Number(process.env.PREDICTION_SETTLEMENT_INTERVAL_MS || 30_000))
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.marketService.settleResolvedMarkets();
    } finally {
      this.inFlight = false;
    }
  }
}
