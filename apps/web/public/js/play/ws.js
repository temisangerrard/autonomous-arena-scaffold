export function createPresence({
  queryParams,
  url = '/api/player/presence'
}) {
  let mutedUntilMs = 0;

  async function setPresence(state) {
    if (Date.now() < mutedUntilMs) {
      return;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state })
      });
      if (!response.ok) {
        // Avoid hammering a degraded backend/runtime and spamming 4xx/5xx network noise.
        mutedUntilMs = Date.now() + 120_000;
      }
    } catch {
      mutedUntilMs = Date.now() + 60_000;
      // ignore
    }
  }

  function setPresenceBestEffort(state) {
    try {
      const payload = JSON.stringify({ state });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      }
    } catch {
      // ignore
    }
    void setPresence(state);
  }

  function installOfflineBeacon() {
    window.addEventListener('pagehide', () => {
      if (queryParams.get('test') === '1') return;
      setPresenceBestEffort('offline');
    });
  }

  return { setPresence, setPresenceBestEffort, installOfflineBeacon };
}
