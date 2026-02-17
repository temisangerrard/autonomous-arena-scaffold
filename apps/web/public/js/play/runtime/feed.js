export function createFeedSystem(state, feedPanel, txExplorerUrl) {
  function add(type, text, meta = null) {
    const message = String(text || '').trim();
    if (!message) return;
    const at = Date.now();
    const last = state.challengeFeed[0];
    const sameTx = (last?.meta?.txHash || null) === (meta?.txHash || null);
    if (last && last.type === type && last.text === message && sameTx && at - last.at < 5000) {
      return;
    }
    state.challengeFeed.unshift({ type, text: message, at, meta });
    if (state.challengeFeed.length > 14) {
      state.challengeFeed.pop();
    }
    render();
  }

  function render() {
    if (!feedPanel) return;
    feedPanel.innerHTML = '';
    for (const entry of state.challengeFeed) {
      const item = document.createElement('div');
      item.className = `feed-item feed-item--${entry.type}`;
      item.textContent = entry.text;
      const txHash = typeof entry?.meta?.txHash === 'string' ? entry.meta.txHash : '';
      if (txHash) {
        const txLink = document.createElement('a');
        txLink.href = txExplorerUrl(txHash, state.walletChainId);
        txLink.textContent = ' view tx';
        txLink.target = '_blank';
        txLink.rel = 'noreferrer noopener';
        item.appendChild(txLink);
      }
      feedPanel.appendChild(item);
    }
  }

  return { add, render };
}
