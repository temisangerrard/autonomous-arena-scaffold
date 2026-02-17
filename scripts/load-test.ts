#!/usr/bin/env npx tsx
/**
 * Load Testing Script for Autonomous Arena
 * 
 * Usage:
 *   npm run load-test                 # Run with defaults
 *   npm run load-test:heavy           # Run heavy load test
 * 
 * Environment:
 *   LOAD_TEST_TARGET_URL              # Target server URL (default: http://localhost:4000)
 *   LOAD_TEST_DURATION                # Test duration in seconds (default: 30)
 *   LOAD_TEST_VIRTUAL_USERS           # Number of virtual users (default: 10)
 *   LOAD_TEST_RAMP_UP                 # Ramp-up time in seconds (default: 5)
 */

const TARGET_URL = process.env.LOAD_TEST_TARGET_URL || 'http://localhost:4000';
const DURATION = parseInt(process.env.LOAD_TEST_DURATION || '30', 10);
const VIRTUAL_USERS = parseInt(process.env.LOAD_TEST_VIRTUAL_USERS || '10', 10);
const RAMP_UP = parseInt(process.env.LOAD_TEST_RAMP_UP || '5', 10);

interface Metric {
  name: string;
  values: number[];
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface TestResult {
  timestamp: number;
  endpoint: string;
  duration: number;
  status: number;
  success: boolean;
  error?: string;
}

class LoadTestRunner {
  private results: TestResult[] = [];
  private activeUsers = 0;
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private startTime = 0;

  async run(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Autonomous Arena Load Test                       ║
╠══════════════════════════════════════════════════════════════╣
║ Target: ${TARGET_URL.padEnd(52)}║
║ Duration: ${String(DURATION + 's').padEnd(50)}║
║ Virtual Users: ${String(VIRTUAL_USERS).padEnd(48)}║
║ Ramp-up: ${String(RAMP_UP + 's').padEnd(50)}║
╚══════════════════════════════════════════════════════════════╝
    `);

    this.startTime = Date.now();
    
    // Start virtual users with ramp-up
    const userInterval = (RAMP_UP * 1000) / VIRTUAL_USERS;
    const userPromises: Promise<void>[] = [];

    for (let i = 0; i < VIRTUAL_USERS; i++) {
      const delay = i * userInterval;
      userPromises.push(this.startVirtualUser(i, delay));
    }

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, DURATION * 1000));
    
    // Wait for all users to finish their current request
    await Promise.allSettled(userPromises);

    this.printResults();
  }

  private async startVirtualUser(userId: number, delay: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delay));
    this.activeUsers++;

    const endTime = this.startTime + DURATION * 1000;
    
    while (Date.now() < endTime) {
      await this.executeUserJourney(userId);
      // Small think time between requests
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
    }

    this.activeUsers--;
  }

  private async executeUserJourney(userId: number): Promise<void> {
    // Simulate typical user journey: health -> presence -> challenges
    const endpoints = [
      { method: 'GET', path: '/health', weight: 3 },
      { method: 'GET', path: '/presence', weight: 2 },
      { method: 'GET', path: '/challenges/recent', weight: 2 },
    ];

    // Weighted random selection
    const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;
    let selected = endpoints[0];
    
    for (const endpoint of endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        selected = endpoint;
        break;
      }
    }

    await this.makeRequest(selected.method, selected.path);
  }

  private async makeRequest(method: string, path: string): Promise<void> {
    const start = Date.now();
    this.totalRequests++;

    try {
      const response = await fetch(`${TARGET_URL}${path}`, {
        method,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ArenaLoadTest/1.0'
        }
      });

      const duration = Date.now() - start;
      
      const result: TestResult = {
        timestamp: start,
        endpoint: path,
        duration,
        status: response.status,
        success: response.ok
      };

      if (response.ok) {
        this.successfulRequests++;
      } else {
        this.failedRequests++;
        result.error = `HTTP ${response.status}`;
      }

      this.results.push(result);

    } catch (error) {
      const duration = Date.now() - start;
      this.failedRequests++;
      
      this.results.push({
        timestamp: start,
        endpoint: path,
        duration,
        status: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private calculateMetric(name: string, values: number[]): Metric {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0] || 0;
    const max = sorted[sorted.length - 1] || 0;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    return { name, values, min, max, avg, p50, p95, p99 };
  }

  private printResults(): void {
    const totalDuration = (Date.now() - this.startTime) / 1000;
    const rps = this.totalRequests / totalDuration;
    
    const durations = this.results.map(r => r.duration);
    const successDurations = this.results.filter(r => r.success).map(r => r.duration);
    
    const responseTime = this.calculateMetric('Response Time', durations);
    const successResponseTime = this.calculateMetric('Successful Response Time', successDurations);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      Load Test Results                        ║
╠══════════════════════════════════════════════════════════════╣
║ Summary:                                                      ║
║   Total Duration: ${String(totalDuration.toFixed(2) + 's').padEnd(43)}║
║   Total Requests: ${String(this.totalRequests).padEnd(43)}║
║   Successful: ${String(this.successfulRequests).padEnd(47)}║
║   Failed: ${String(this.failedRequests).padEnd(51)}║
║   Requests/sec: ${String(rps.toFixed(2)).padEnd(47)}║
║                                                               ║
║ Response Times (all requests):                                ║
║   Min: ${String(responseTime.min + 'ms').padEnd(53)}║
║   Max: ${String(responseTime.max + 'ms').padEnd(53)}║
║   Avg: ${String(responseTime.avg.toFixed(2) + 'ms').padEnd(53)}║
║   p50: ${String(responseTime.p50 + 'ms').padEnd(52)}║
║   p95: ${String(responseTime.p95 + 'ms').padEnd(52)}║
║   p99: ${String(responseTime.p99 + 'ms').padEnd(52)}║
║                                                               ║
║ Response Times (successful only):                             ║
║   Min: ${String(successResponseTime.min + 'ms').padEnd(53)}║
║   Max: ${String(successResponseTime.max + 'ms').padEnd(53)}║
║   Avg: ${String(successResponseTime.avg.toFixed(2) + 'ms').padEnd(53)}║
║   p50: ${String(successResponseTime.p50 + 'ms').padEnd(52)}║
║   p95: ${String(successResponseTime.p95 + 'ms').padEnd(52)}║
║   p99: ${String(successResponseTime.p99 + 'ms').padEnd(52)}║
╚══════════════════════════════════════════════════════════════╝
    `);

    // Print error summary if there were failures
    if (this.failedRequests > 0) {
      const errors = new Map<string, number>();
      for (const result of this.results) {
        if (!result.success && result.error) {
          errors.set(result.error, (errors.get(result.error) || 0) + 1);
        }
      }

      console.log('\nError Summary:');
      for (const [error, count] of errors) {
        console.log(`  ${error}: ${count}`);
      }
    }

    // Print per-endpoint stats
    const endpointStats = new Map<string, { count: number; durations: number[]; errors: number }>();
    for (const result of this.results) {
      const stat = endpointStats.get(result.endpoint) || { count: 0, durations: [], errors: 0 };
      stat.count++;
      stat.durations.push(result.duration);
      if (!result.success) stat.errors++;
      endpointStats.set(result.endpoint, stat);
    }

    console.log('\nPer-Endpoint Stats:');
    for (const [endpoint, stat] of endpointStats) {
      const avgDuration = stat.durations.reduce((sum, d) => sum + d, 0) / stat.durations.length;
      const errorRate = ((stat.errors / stat.count) * 100).toFixed(1);
      console.log(`  ${endpoint}: ${stat.count} requests, avg ${avgDuration.toFixed(0)}ms, ${errorRate}% errors`);
    }

    // Exit with error code if failure rate is too high
    const failureRate = this.failedRequests / this.totalRequests;
    if (failureRate > 0.1) {
      console.error(`\n❌ Load test failed: ${(failureRate * 100).toFixed(1)}% failure rate exceeds 10% threshold`);
      process.exit(1);
    } else {
      console.log('\n✅ Load test passed');
    }
  }
}

// Run the load test
const runner = new LoadTestRunner();
runner.run().catch(error => {
  console.error('Load test failed with error:', error);
  process.exit(1);
});