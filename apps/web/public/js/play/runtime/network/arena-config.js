const CANONICAL_WORLD_BASE_FALLBACK = 'https://storage.googleapis.com/junipalee-arena-assets';

export function createArenaConfigRuntime(params) {
  const {
    queryParams,
    buildSessionHeaders,
    onConfigLoaded
  } = params;

  let arenaConfigPromise = null;

  async function loadArenaConfig() {
    if (arenaConfigPromise) return arenaConfigPromise;
    arenaConfigPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 4500);
          const cfgRes = await fetch('/api/config', {
            credentials: 'include',
            headers: buildSessionHeaders(),
            signal: controller.signal
          });
          window.clearTimeout(timeout);
          if (!cfgRes.ok) {
            if (attempt === 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 250));
              continue;
            }
            break;
          }
          const cfg = await cfgRes.json();
          if (cfg && typeof cfg === 'object') {
            window.__ARENA_CONFIG = cfg;
            window.ARENA_CONFIG = {
              ...(window.ARENA_CONFIG || {}),
              ...cfg
            };
            onConfigLoaded?.(cfg);
          }
          return cfg;
        } catch {
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
            continue;
          }
        }
      }
      const fallbackCfg = {
        worldAssetBaseUrl: CANONICAL_WORLD_BASE_FALLBACK
      };
      window.__ARENA_CONFIG = {
        ...(window.__ARENA_CONFIG || {}),
        ...fallbackCfg
      };
      window.ARENA_CONFIG = {
        ...(window.ARENA_CONFIG || {}),
        ...fallbackCfg
      };
      return fallbackCfg;
    })();
    return arenaConfigPromise;
  }

  async function resolveWsBaseUrl() {
    const explicit = queryParams.get('ws');
    if (explicit) {
      const host = String(window.location.hostname || '').toLowerCase();
      const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const isTestMode = queryParams.get('test') === '1';
      if (isLocalHost || isTestMode) {
        return explicit;
      }
    }
    const cfg = await loadArenaConfig();
    if (cfg?.gameWsUrl) return String(cfg.gameWsUrl);

    const wsPath = (window.ARENA_CONFIG && window.ARENA_CONFIG.gameWsPath)
      ? String(window.ARENA_CONFIG.gameWsPath)
      : '/ws';

    const serverOrigin = window.ARENA_CONFIG?.serverOrigin || '';
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocalHost) {
      return window.location.protocol === 'https:'
        ? `wss://${window.location.host}${wsPath}`
        : `ws://${window.location.host}${wsPath}`;
    }
    if (serverOrigin) {
      const origin = String(serverOrigin);
      const wsOrigin = origin.startsWith('https://')
        ? `wss://${origin.slice('https://'.length)}`
        : origin.startsWith('http://')
          ? `ws://${origin.slice('http://'.length)}`
          : origin;
      return `${wsOrigin}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;
    }

    const sameOrigin = window.location.protocol === 'https:'
      ? `wss://${window.location.host}${wsPath}`
      : `ws://${window.location.host}${wsPath}`;
    return sameOrigin;
  }

  return { loadArenaConfig, resolveWsBaseUrl };
}
