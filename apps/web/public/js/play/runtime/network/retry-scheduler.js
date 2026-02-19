export function createRetryScheduler(params) {
  const {
    connectionState,
    dispatch,
    onRetry
  } = params;

  let connectRetryTimer = null;

  function scheduleConnectRetry(message) {
    if (connectRetryTimer) {
      return;
    }
    connectionState.connectFailureCount += 1;
    const delayMs = Math.min(15_000, 600 + Math.pow(2, Math.min(5, connectionState.connectFailureCount)) * 250);
    dispatch({
      type: 'CHALLENGE_STATUS_SET',
      status: 'none',
      message: message
        ? `${message} Retrying in ${(delayMs / 1000).toFixed(1)}s...`
        : `Retrying in ${(delayMs / 1000).toFixed(1)}s...`
    });
    connectRetryTimer = window.setTimeout(() => {
      connectRetryTimer = null;
      void onRetry();
    }, delayMs);
  }

  return {
    scheduleConnectRetry
  };
}
