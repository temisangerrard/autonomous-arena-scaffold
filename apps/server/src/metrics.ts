/**
 * Metrics Collection and Export
 * 
 * Provides Prometheus-compatible metrics for:
 * - HTTP request metrics
 * - WebSocket connections
 * - Challenge/game metrics
 * - Database performance
 * - System health
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { log as rootLog } from './logger.js';

const log = rootLog.child({ module: 'metrics' });

/**
 * Metric types
 */
type MetricLabels = Record<string, string>;

type CounterMetric = {
  type: 'counter';
  name: string;
  help: string;
  value: number;
  labels: MetricLabels;
};

type GaugeMetric = {
  type: 'gauge';
  name: string;
  help: string;
  value: number;
  labels: MetricLabels;
};

type HistogramMetric = {
  type: 'histogram';
  name: string;
  help: string;
  buckets: { le: string; value: number }[];
  sum: number;
  count: number;
  labels: MetricLabels;
};

/**
 * In-memory metrics store
 */
class MetricsStore {
  private counters = new Map<string, CounterMetric>();
  private gauges = new Map<string, GaugeMetric>();
  private histograms = new Map<string, HistogramMetric>();
  private startTime = Date.now();

  private labelKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  private metricKey(name: string, labels: MetricLabels): string {
    const labelStr = this.labelKey(labels);
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  // Counter operations
  incrementCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.metricKey(name, labels);
    const existing = this.counters.get(key);
    
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, {
        type: 'counter',
        name,
        help: '',
        value,
        labels
      });
    }
  }

  // Gauge operations
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.metricKey(name, labels);
    this.gauges.set(key, {
      type: 'gauge',
      name,
      help: '',
      value,
      labels
    });
  }

  incrementGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.metricKey(name, labels);
    const existing = this.gauges.get(key);
    
    if (existing) {
      existing.value += value;
    } else {
      this.gauges.set(key, {
        type: 'gauge',
        name,
        help: '',
        value,
        labels
      });
    }
  }

  decrementGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
    this.incrementGauge(name, labels, -value);
  }

  // Histogram operations
  observeHistogram(name: string, value: number, labels: MetricLabels = {}, buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): void {
    const key = this.metricKey(name, labels);
    const existing = this.histograms.get(key);
    
    if (existing) {
      existing.sum += value;
      existing.count += 1;
      for (const bucket of existing.buckets) {
        const le = parseFloat(bucket.le);
        if (value <= le) {
          bucket.value += 1;
        }
      }
    } else {
      const bucketValues = buckets.map(le => ({
        le: String(le),
        value: value <= le ? 1 : 0
      }));
      // Add +Inf bucket
      bucketValues.push({ le: '+Inf', value: 1 });
      
      this.histograms.set(key, {
        type: 'histogram',
        name,
        help: '',
        buckets: bucketValues,
        sum: value,
        count: 1,
        labels
      });
    }
  }

  // Export to Prometheus format
  exportPrometheus(): string {
    const lines: string[] = [];
    
    // Process uptime
    lines.push('# HELP arena_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE arena_process_uptime_seconds gauge');
    lines.push(`arena_process_uptime_seconds ${(Date.now() - this.startTime) / 1000}`);
    lines.push('');

    // Export counters
    const counterNames = new Set<string>();
    for (const counter of this.counters.values()) {
      if (!counterNames.has(counter.name)) {
        lines.push(`# HELP arena_${counter.name}_total Total count of ${counter.name}`);
        lines.push(`# TYPE arena_${counter.name}_total counter`);
        counterNames.add(counter.name);
      }
      const labelStr = this.labelKey(counter.labels);
      lines.push(`arena_${counter.name}_total{${labelStr}} ${counter.value}`);
    }
    if (this.counters.size > 0) lines.push('');

    // Export gauges
    const gaugeNames = new Set<string>();
    for (const gauge of this.gauges.values()) {
      if (!gaugeNames.has(gauge.name)) {
        lines.push(`# HELP arena_${gauge.name} Current value of ${gauge.name}`);
        lines.push(`# TYPE arena_${gauge.name} gauge`);
        gaugeNames.add(gauge.name);
      }
      const labelStr = this.labelKey(gauge.labels);
      lines.push(`arena_${gauge.name}{${labelStr}} ${gauge.value}`);
    }
    if (this.gauges.size > 0) lines.push('');

    // Export histograms
    const histogramNames = new Set<string>();
    for (const histogram of this.histograms.values()) {
      if (!histogramNames.has(histogram.name)) {
        lines.push(`# HELP arena_${histogram.name} Histogram of ${histogram.name}`);
        lines.push(`# TYPE arena_${histogram.name} histogram`);
        histogramNames.add(histogram.name);
      }
      
      const labelStr = this.labelKey(histogram.labels);
      const labelPrefix = labelStr ? `${labelStr},` : '';
      
      for (const bucket of histogram.buckets) {
        lines.push(`arena_${histogram.name}_bucket{${labelPrefix}le="${bucket.le}"} ${bucket.value}`);
      }
      lines.push(`arena_${histogram.name}_sum{${labelStr}} ${histogram.sum}`);
      lines.push(`arena_${histogram.name}_count{${labelStr}} ${histogram.count}`);
    }

    return lines.join('\n');
  }

  // Export to JSON for API
  exportJson(): {
    uptime: number;
    counters: Array<{ name: string; value: number; labels: MetricLabels }>;
    gauges: Array<{ name: string; value: number; labels: MetricLabels }>;
    histograms: Array<{ name: string; sum: number; count: number; labels: MetricLabels }>;
  } {
    return {
      uptime: Date.now() - this.startTime,
      counters: [...this.counters.values()].map(c => ({
        name: c.name,
        value: c.value,
        labels: c.labels
      })),
      gauges: [...this.gauges.values()].map(g => ({
        name: g.name,
        value: g.value,
        labels: g.labels
      })),
      histograms: [...this.histograms.values()].map(h => ({
        name: h.name,
        sum: h.sum,
        count: h.count,
        labels: h.labels
      }))
    };
  }

  // Reset all metrics (for testing)
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }
}

// Global metrics store
export const metrics = new MetricsStore();

/**
 * Predefined metric names
 */
export const METRIC_NAMES = {
  // HTTP metrics
  httpRequestsTotal: 'http_requests_total',
  httpRequestDuration: 'http_request_duration_seconds',
  httpRequestsInFlight: 'http_requests_in_flight',
  
  // WebSocket metrics
  wsConnectionsTotal: 'ws_connections_total',
  wsConnectionsActive: 'ws_connections_active',
  wsMessagesReceived: 'ws_messages_received_total',
  wsMessagesSent: 'ws_messages_sent_total',
  
  // Challenge metrics
  challengesCreated: 'challenges_created_total',
  challengesResolved: 'challenges_resolved_total',
  challengesActive: 'challenges_active',
  challengeDuration: 'challenge_duration_seconds',
  
  // Escrow metrics
  escrowLocksTotal: 'escrow_locks_total',
  escrowResolvesTotal: 'escrow_resolves_total',
  escrowRefundsTotal: 'escrow_refunds_total',
  escrowValueLocked: 'escrow_value_locked',
  
  // Player metrics
  playersConnected: 'players_connected',
  playersTotal: 'players_total',
  
  // Agent metrics
  agentsConnected: 'agents_connected',
  agentsTotal: 'agents_total',
  
  // Database metrics
  dbQueryDuration: 'db_query_duration_seconds',
  dbConnectionsActive: 'db_connections_active',
  dbErrorsTotal: 'db_errors_total',
  
  // Rate limiting
  rateLimitExceeded: 'rate_limit_exceeded_total',
  
  // System
  memoryUsage: 'process_memory_bytes',
  cpuUsage: 'process_cpu_seconds_total',
} as const;

/**
 * HTTP request timing middleware
 */
export function trackHttpRequest(req: IncomingMessage & { startTime?: number }, res: ServerResponse): void {
  req.startTime = Date.now();
  
  // Track in-flight requests
  metrics.incrementGauge(METRIC_NAMES.httpRequestsInFlight, { method: req.method || 'GET' });
  
  const originalEnd = res.end.bind(res);
  
  // Override end to track metrics
  res.end = function(chunk?: unknown, encoding?: unknown, cb?: unknown): ServerResponse {
    const duration = (Date.now() - (req.startTime || Date.now())) / 1000;
    const route = (req.url || '/').split('?')[0] || '/';
    
    // Record metrics
    metrics.observeHistogram(METRIC_NAMES.httpRequestDuration, duration, {
      method: req.method || 'GET',
      route: route.slice(0, 50),
      status: String(res.statusCode)
    });
    
    metrics.incrementCounter(METRIC_NAMES.httpRequestsTotal, {
      method: req.method || 'GET',
      route: route.slice(0, 50),
      status: String(res.statusCode)
    });
    
    metrics.decrementGauge(METRIC_NAMES.httpRequestsInFlight, { method: req.method || 'GET' });
    
    // Call original end with proper arguments based on overloads
    if (typeof chunk === 'function') {
      return originalEnd(chunk as () => void);
    }
    if (typeof encoding === 'function') {
      return originalEnd(chunk as BufferEncoding | undefined, encoding as () => void);
    }
    return originalEnd(chunk as BufferEncoding | undefined, (encoding as BufferEncoding) || 'utf-8', cb as (() => void) | undefined);
  };
}

/**
 * Update system metrics periodically
 */
export function startSystemMetricsCollection(): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    const memUsage = process.memoryUsage();
    
    metrics.setGauge(METRIC_NAMES.memoryUsage, memUsage.heapUsed, { type: 'heap_used' });
    metrics.setGauge(METRIC_NAMES.memoryUsage, memUsage.heapTotal, { type: 'heap_total' });
    metrics.setGauge(METRIC_NAMES.memoryUsage, memUsage.rss, { type: 'rss' });
    metrics.setGauge(METRIC_NAMES.memoryUsage, memUsage.external, { type: 'external' });
    
    // CPU usage (approximate)
    const cpuUsage = process.cpuUsage();
    metrics.setGauge(METRIC_NAMES.cpuUsage, (cpuUsage.user + cpuUsage.system) / 1_000_000, {});
  }, 10_000);
  
  interval.unref();
  return interval;
}

/**
 * Handler for /metrics endpoint (Prometheus format)
 */
export function handleMetricsEndpoint(req: IncomingMessage, res: ServerResponse): void {
  void req;
  try {
    const prometheusOutput = metrics.exportPrometheus();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(prometheusOutput);
  } catch (error) {
    log.error({ error }, 'failed to export metrics');
    res.statusCode = 500;
    res.end('# Error exporting metrics\n');
  }
}

/**
 * Handler for /metrics.json endpoint (JSON format)
 */
export function handleMetricsJsonEndpoint(req: IncomingMessage, res: ServerResponse): void {
  void req;
  try {
    const jsonData = metrics.exportJson();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(jsonData, null, 2));
  } catch (error) {
    log.error({ error }, 'failed to export metrics as JSON');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'failed_to_export_metrics' }));
  }
}

/**
 * Record challenge metrics
 */
export function recordChallengeCreated(gameType: string, wager: number): void {
  void wager;
  metrics.incrementCounter(METRIC_NAMES.challengesCreated, { game_type: gameType });
  metrics.incrementGauge(METRIC_NAMES.challengesActive, { game_type: gameType });
}

export function recordChallengeResolved(gameType: string, durationMs: number, wager: number): void {
  void wager;
  metrics.incrementCounter(METRIC_NAMES.challengesResolved, { game_type: gameType });
  metrics.decrementGauge(METRIC_NAMES.challengesActive, { game_type: gameType });
  metrics.observeHistogram(METRIC_NAMES.challengeDuration, durationMs / 1000, { game_type: gameType });
}

/**
 * Record WebSocket metrics
 */
export function recordWsConnection(role: 'human' | 'agent'): void {
  metrics.incrementCounter(METRIC_NAMES.wsConnectionsTotal, { role });
  metrics.incrementGauge(METRIC_NAMES.wsConnectionsActive, { role });
}

export function recordWsDisconnection(role: 'human' | 'agent'): void {
  metrics.decrementGauge(METRIC_NAMES.wsConnectionsActive, { role });
}

export function recordWsMessage(direction: 'in' | 'out', type: string): void {
  if (direction === 'in') {
    metrics.incrementCounter(METRIC_NAMES.wsMessagesReceived, { type });
  } else {
    metrics.incrementCounter(METRIC_NAMES.wsMessagesSent, { type });
  }
}

/**
 * Record escrow metrics
 */
export function recordEscrowLock(amount: number): void {
  metrics.incrementCounter(METRIC_NAMES.escrowLocksTotal);
  metrics.incrementGauge(METRIC_NAMES.escrowValueLocked, {}, amount);
}

export function recordEscrowResolve(amount: number, fee: number): void {
  void fee;
  metrics.incrementCounter(METRIC_NAMES.escrowResolvesTotal);
  metrics.decrementGauge(METRIC_NAMES.escrowValueLocked, {}, amount);
}

export function recordEscrowRefund(amount: number): void {
  metrics.incrementCounter(METRIC_NAMES.escrowRefundsTotal);
  metrics.decrementGauge(METRIC_NAMES.escrowValueLocked, {}, amount);
}

/**
 * Record rate limit events
 */
export function recordRateLimitExceeded(endpoint: string): void {
  metrics.incrementCounter(METRIC_NAMES.rateLimitExceeded, { endpoint });
}

/**
 * Record database metrics
 */
export function recordDbQuery(durationMs: number, query: string, success: boolean): void {
  metrics.observeHistogram(METRIC_NAMES.dbQueryDuration, durationMs / 1000, {
    query: query.slice(0, 30),
    success: String(success)
  });
  
  if (!success) {
    metrics.incrementCounter(METRIC_NAMES.dbErrorsTotal, { query: query.slice(0, 30) });
  }
}
