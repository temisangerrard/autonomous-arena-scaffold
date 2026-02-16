export function createPresence({
  queryParams,
  url = '/api/player/presence'
}) {
  async function setPresence(state) {
    try {
      const headers = { 'content-type': 'application/json' };
      const sid = String(localStorage.getItem('arena_sid_fallback') || '').trim();
      if (sid) {
        headers['x-arena-sid'] = sid;
      }
      await fetch(url, {
        method: 'POST',
        headers,
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
