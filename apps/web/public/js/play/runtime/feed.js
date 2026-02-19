export function renderChallengeFeed(params) {
  const {
    feedPanel,
    challengeFeed,
    walletChainId,
    txExplorerUrl
  } = params;

  if (!feedPanel) {
    return;
  }
  feedPanel.innerHTML = '';

  if (challengeFeed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.textContent = 'No challenge activity yet.';
    feedPanel.appendChild(empty);
    return;
  }

  for (const entry of challengeFeed) {
    const item = document.createElement('div');
    item.className = `feed-item feed-item--${entry.type}`;

    const top = document.createElement('div');
    top.className = 'feed-item__top';

    const kind = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'feed-dot';
    if (entry.type === 'escrow') {
      dot.classList.add('gold');
    } else if (entry.text.includes('declined') || entry.text.includes('failed') || entry.text.includes('expired')) {
      dot.classList.add('red');
    } else {
      dot.classList.add('green');
    }
    kind.appendChild(dot);
    kind.appendChild(document.createTextNode(` ${entry.type}`));

    const time = document.createElement('span');
    time.textContent = new Date(entry.at).toLocaleTimeString();

    const body = document.createElement('div');
    body.className = 'feed-item__body';
    body.textContent = entry.text;

    top.appendChild(kind);
    top.appendChild(time);
    item.appendChild(top);
    item.appendChild(body);
    const txHash = typeof entry?.meta?.txHash === 'string' ? entry.meta.txHash : '';
    if (txHash) {
      const txRow = document.createElement('div');
      txRow.className = 'feed-item__tx';

      const txBadge = document.createElement('span');
      txBadge.className = 'tx-chip';
      txBadge.textContent = `${txHash.slice(0, 8)}...${txHash.slice(-6)}`;

      txRow.appendChild(txBadge);
      const txUrl = txExplorerUrl(txHash, walletChainId);
      if (txUrl) {
        const txLink = document.createElement('a');
        txLink.className = 'tx-link';
        txLink.href = txUrl;
        txLink.target = '_blank';
        txLink.rel = 'noreferrer noopener';
        txLink.textContent = 'view tx';
        txRow.appendChild(txLink);
      }
      item.appendChild(txRow);
    }
    feedPanel.appendChild(item);
  }
}
