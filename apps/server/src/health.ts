import type { HealthStatus } from '@arena/shared';

export function createHealthStatus(): HealthStatus {
  const timestamp = new Date().toISOString();
  return {
    ok: true,
    service: 'server',
    timestamp
  };
}
