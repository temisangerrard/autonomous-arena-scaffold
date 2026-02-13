import type { HealthStatus, ServiceName } from '@arena/shared';

export async function fetchHealth(baseUrl: string, service: ServiceName): Promise<HealthStatus> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed for ${service}: ${response.status}`);
  }
  const payload = (await response.json()) as HealthStatus;
  if (payload.service !== service || !payload.ok) {
    throw new Error(`Unexpected health payload for ${service}`);
  }
  return payload;
}
