import { createHash } from 'node:crypto';

export type PolymarketNormalizedMarket = {
  id: string;
  slug: string;
  question: string;
  category: string;
  closeAt: number;
  resolveAt: number | null;
  status: 'open' | 'closed' | 'resolved' | 'cancelled';
  outcome: 'yes' | 'no' | null;
  yesPrice: number;
  noPrice: number;
  oracleMarketId: string;
  raw: Record<string, unknown>;
};

export class PolymarketFeed {
  constructor(
    private readonly baseUrl = process.env.POLYMARKET_GAMMA_URL?.trim() || 'https://gamma-api.polymarket.com/markets',
    private readonly timeoutMs = Math.max(2000, Number(process.env.POLYMARKET_TIMEOUT_MS || 7000))
  ) {}

  private asEpochMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
      }
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeStatus(raw: Record<string, unknown>, closeAt: number): PolymarketNormalizedMarket['status'] {
    const now = Date.now();
    const closed = Boolean(raw.closed) || Boolean(raw.isClosed);
    const resolved = Boolean(raw.resolved) || Boolean(raw.isResolved) || Boolean(raw.hasWinner);
    const cancelled = Boolean(raw.cancelled) || Boolean(raw.isCancelled);
    if (cancelled) return 'cancelled';
    if (resolved) return 'resolved';
    if (closed || closeAt <= now) return 'closed';
    return 'open';
  }

  private normalizeOutcome(raw: Record<string, unknown>): 'yes' | 'no' | null {
    const winner = String(raw.winner ?? raw.outcome ?? '').trim().toLowerCase();
    if (winner === 'yes') return 'yes';
    if (winner === 'no') return 'no';
    return null;
  }

  private normalizePrice(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n > 1) return Math.max(0, Math.min(1, n / 100));
    return Math.max(0, Math.min(1, n));
  }

  private normalizeOne(raw: Record<string, unknown>): PolymarketNormalizedMarket | null {
    const question = String(raw.question ?? raw.title ?? '').trim();
    if (!question) return null;
    const slug = String(raw.slug ?? raw.market_slug ?? '').trim() || question.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120);
    const rawId = String(raw.id ?? raw.marketId ?? raw.conditionId ?? slug).trim();
    const id = rawId || createHash('sha1').update(slug).digest('hex').slice(0, 20);

    const endDate = this.asEpochMs(raw.endDate ?? raw.end_date_iso ?? raw.endTimestamp ?? raw.closeTime) ?? (Date.now() + 24 * 60 * 60 * 1000);
    const resolveAt = this.asEpochMs(raw.resolveDate ?? raw.resolutionDate ?? raw.resolvedAt ?? raw.endDateIso);

    const yesPrice = this.normalizePrice(raw.yesPrice ?? raw.bestBidYes ?? raw.lastTradePriceYes ?? raw.outcomeYesPrice, 0.5);
    const noPrice = this.normalizePrice(raw.noPrice ?? raw.bestBidNo ?? raw.lastTradePriceNo ?? raw.outcomeNoPrice, 1 - yesPrice);

    return {
      id: `poly_${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`,
      slug,
      question,
      category: String(raw.category ?? raw.group ?? 'general').trim() || 'general',
      closeAt: endDate,
      resolveAt,
      status: this.normalizeStatus(raw, endDate),
      outcome: this.normalizeOutcome(raw),
      yesPrice,
      noPrice,
      oracleMarketId: rawId,
      raw
    };
  }

  async fetchMarkets(limit = 60): Promise<PolymarketNormalizedMarket[]> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(200, limit))),
      active: 'true',
      closed: 'false'
    });
    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`oracle_http_${response.status}`);
    }
    const payload = await response.json().catch(() => []);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : [];

    const normalized: PolymarketNormalizedMarket[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const out = this.normalizeOne(row as Record<string, unknown>);
      if (out) normalized.push(out);
    }
    return normalized;
  }
}
