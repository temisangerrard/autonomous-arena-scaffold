import type { HealthStatus } from '@arena/shared';

export function createHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: 'server',
    timestamp: new Date().toISOString()
  };
}
