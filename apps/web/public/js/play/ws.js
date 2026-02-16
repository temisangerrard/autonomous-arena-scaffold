export function createPresence({
  queryParams,
  url = '/api/player/presence'
}) {
  async function setPresence(state) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state })
      });
    } catch {
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
