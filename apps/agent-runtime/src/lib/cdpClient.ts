export type CdpClientConfig = {
  apiKeyId: string;
  apiKeySecret: string;
  projectId: string;
};

export type CdpClientConfigured = {
  apiKeyId: boolean;
  apiKeySecret: boolean;
  projectId: boolean;
};

export type CdpClientState = {
  available: boolean;
  reason?: 'cdp_env_missing' | 'cdp_client_init_failed';
  configured: CdpClientConfigured;
  client: unknown | null;
};

export async function initializeCdpClient(
  env: Record<string, string | undefined>,
  deps: {
    sdkFactory?: (params: CdpClientConfig) => Promise<unknown>;
  } = {}
): Promise<CdpClientState> {
  const apiKeyId = String(env.CDP_API_KEY_ID || '').trim();
  const apiKeySecret = String(env.CDP_API_KEY_SECRET || '').trim();
  const projectId = String(env.CDP_PROJECT_ID || '').trim();
  const configured: CdpClientConfigured = {
    apiKeyId: Boolean(apiKeyId),
    apiKeySecret: Boolean(apiKeySecret),
    projectId: Boolean(projectId)
  };
  if (!configured.apiKeyId || !configured.apiKeySecret || !configured.projectId) {
    return {
      available: false,
      reason: 'cdp_env_missing',
      configured,
      client: null
    };
  }

  try {
    const sdkFactory = deps.sdkFactory ?? defaultSdkFactory;
    const client = await sdkFactory({
      apiKeyId,
      apiKeySecret,
      projectId
    });
    if (!client) {
      return {
        available: false,
        reason: 'cdp_client_init_failed',
        configured,
        client: null
      };
    }
    return {
      available: true,
      configured,
      client
    };
  } catch {
    return {
      available: false,
      reason: 'cdp_client_init_failed',
      configured,
      client: null
    };
  }
}

async function defaultSdkFactory(params: CdpClientConfig): Promise<unknown> {
  // Placeholder object keeps initialization centralized and testable.
  // Replace this with an actual CDP SDK constructor when the SDK package is added.
  return { provider: 'cdp', ...params };
}

