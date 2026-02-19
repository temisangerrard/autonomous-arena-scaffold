export function createFeedEventsController(params) {
  const {
    state,
    feedPanel,
    txExplorerUrl,
    renderChallengeFeed
  } = params;

  function renderFeed() {
    renderChallengeFeed({
      feedPanel,
      challengeFeed: state.challengeFeed,
      walletChainId: state.walletChainId,
      txExplorerUrl
    });
  }

  function addFeedEvent(type, text, meta = null) {
    const message = String(text || '').trim();
    if (!message) {
      return;
    }

    const at = Date.now();
    const last = state.challengeFeed[0];
    const sameTx =
      (last?.meta?.txHash || null) ===
      (meta && typeof meta === 'object' && 'txHash' in meta ? meta.txHash || null : null);
    if (last && last.type === type && last.text === message && sameTx && at - last.at < 5000) {
      return;
    }

    state.challengeFeed.unshift({
      type,
      text: message,
      at,
      meta
    });
    if (state.challengeFeed.length > 14) {
      state.challengeFeed.pop();
    }

    renderFeed();
  }

  return {
    addFeedEvent,
    renderFeed
  };
}
