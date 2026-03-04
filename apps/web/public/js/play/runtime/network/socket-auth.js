/**
 * Bootstrap session auth for WebSocket connection.
 * Fetches /api/player/me or uses query/localStorage fallbacks (test mode).
 * @returns {Promise<{ sessionName: string, sessionWalletId: string, sessionClientId: string, sessionWsAuth: string } | null>}
 *   Session params to attach to WS URL, or null if auth failed (caller should retry).
 */
export async function bootstrapSessionAuth({
  queryParams,
  buildSessionHeaders,
  scheduleConnectRetry,
  dispatch,
  state
}) {
  const skipProfileFetch = queryParams.get('test') === '1';
  let sessionName = '';
  let sessionWalletId = '';
  let sessionClientId = '';
  let sessionWsAuth = '';

  if (!skipProfileFetch) {
    try {
      const fetchPlayerMe = async (url) => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3500);
        try {
          return await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            headers: buildSessionHeaders(),
            signal: controller.signal
          });
        } finally {
          window.clearTimeout(timeout);
        }
      };
      let meResponse = await fetchPlayerMe(`/api/player/me?t=${Date.now()}`);
      if (meResponse.status === 401 || meResponse.status === 403) {
        const recheck = await fetchPlayerMe(`/api/player/me?optional=1&t=${Date.now()}`);
        const recheckPayload = await recheck.json().catch(() => ({}));
        if (recheck.ok && recheckPayload?.user) {
          meResponse = await fetchPlayerMe(`/api/player/me?t=${Date.now()}&retry=1`);
        } else {
          scheduleConnectRetry('Session check failed. Retrying...');
          return null;
        }
      }
      if (!meResponse.ok) {
        scheduleConnectRetry(`Auth backend returned ${meResponse.status}.`);
        return null;
      }
      const mePayload = await meResponse.json();
      const profile = mePayload?.profile;
      if (profile?.displayName) sessionName = String(profile.displayName);
      if (profile?.wallet?.id || profile?.walletId) sessionWalletId = String(profile.wallet?.id || profile.walletId);
      if (profile?.id) sessionClientId = String(profile.id);
      if (mePayload?.wsAuth) sessionWsAuth = String(mePayload.wsAuth);
      if (mePayload?.bot && mePayload.bot.connected === false) {
        dispatch({
          type: 'CHALLENGE_STATUS_SET',
          status: state.challengeStatus || 'none',
          message: 'Offline bot is currently disconnected. Controls still work, but that bot will not appear until runtime reconnects.'
        });
      }
    } catch {
      scheduleConnectRetry('Auth backend unavailable.');
      return null;
    }
  } else {
    sessionName = queryParams.get('name') || localStorage.getItem('arena_last_name') || '';
    sessionWalletId = queryParams.get('walletId') || localStorage.getItem('arena_wallet_id') || '';
    sessionClientId = queryParams.get('clientId') || localStorage.getItem('arena_client_id') || '';
    sessionWsAuth = queryParams.get('wsAuth') || '';
  }

  return { sessionName, sessionWalletId, sessionClientId, sessionWsAuth };
}
