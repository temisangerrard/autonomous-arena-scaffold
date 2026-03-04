import { setPendingBtn, clearPendingBtn, flashBtn } from './helpers.js';

export function mountCashierPanel(params) {
  const {
    state,
    stationUi,
    buildSessionHeaders,
    syncWalletSummary,
    formatUsdAmount,
    showToast
  } = params;

  stationUi.innerHTML = `
    <div class="station-ui__title">Cashier</div>
    <div class="station-ui__meta" id="station-balance">Loading balance...</div>
    <div class="station-ui__row">
      <label for="station-amount">Amount</label>
      <input id="station-amount" type="number" min="0" max="10000" step="1" value="10" />
    </div>
    <div class="station-ui__actions">
      <button id="station-refresh" class="btn-ghost" type="button">Refresh</button>
      <button id="station-fund" class="btn-gold" type="button">Fund</button>
      <button id="station-withdraw" class="btn-gold" type="button">Withdraw</button>
    </div>
    <div class="station-ui__row">
      <label for="station-to-wallet">To Wallet</label>
      <input id="station-to-wallet" type="text" placeholder="wallet_..." />
    </div>
    <div class="station-ui__actions">
      <button id="station-transfer" class="btn-ghost" type="button">Transfer</button>
    </div>
  `;

  const balanceEl = document.getElementById('station-balance');
  const amountEl = document.getElementById('station-amount');
  const toWalletEl = document.getElementById('station-to-wallet');
  const refreshBtn = document.getElementById('station-refresh');
  const fundBtn = document.getElementById('station-fund');
  const withdrawBtn = document.getElementById('station-withdraw');
  const transferBtn = document.getElementById('station-transfer');

  async function api(path, init) {
    const res = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: buildSessionHeaders(init?.headers)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = String(json?.reason || `http_${res.status}`);
      throw new Error(reason);
    }
    return json;
  }

  async function refresh() {
    try {
      const ok = await syncWalletSummary({ keepLastOnFailure: true });
      if (!ok || !Number.isFinite(Number(state.walletBalance))) {
        balanceEl.textContent = 'Balance: unavailable (onchain)';
        return;
      }
      balanceEl.textContent = `Balance: ${formatUsdAmount(Number(state.walletBalance))} USDC`;
    } catch (err) {
      balanceEl.textContent = `Balance unavailable (${String(err.message || err)})`;
    }
  }

  async function fund() {
    const amount = Math.max(0, Number(amountEl?.value || 0));
    await api('/api/player/wallet/fund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    await refresh();
    showToast(`Funded ${amount}.`);
  }

  async function withdraw() {
    const amount = Math.max(0, Number(amountEl?.value || 0));
    await api('/api/player/wallet/withdraw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    await refresh();
    showToast(`Withdrew ${amount}.`);
  }

  async function transfer() {
    const amount = Math.max(0, Number(amountEl?.value || 0));
    const toWalletId = String(toWalletEl?.value || '').trim();
    if (!toWalletId) {
      showToast('Enter a target wallet id.');
      return;
    }
    await api('/api/player/wallet/transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toWalletId, amount })
    });
    await refresh();
    showToast(`Transferred ${amount} to ${toWalletId}.`);
  }

  if (refreshBtn) refreshBtn.onclick = () => { void refresh(); };
  if (fundBtn) {
    fundBtn.onclick = () => {
      setPendingBtn(fundBtn, 'Funding…');
      fund()
        .then(() => { flashBtn(fundBtn, 'is-success'); clearPendingBtn(fundBtn, 'Fund'); })
        .catch((e) => { flashBtn(fundBtn, 'is-failed'); clearPendingBtn(fundBtn, 'Fund'); showToast(String(e.message || e)); });
    };
  }
  if (withdrawBtn) {
    withdrawBtn.onclick = () => {
      setPendingBtn(withdrawBtn, 'Withdrawing…');
      withdraw()
        .then(() => { flashBtn(withdrawBtn, 'is-success'); clearPendingBtn(withdrawBtn, 'Withdraw'); })
        .catch((e) => { flashBtn(withdrawBtn, 'is-failed'); clearPendingBtn(withdrawBtn, 'Withdraw'); showToast(String(e.message || e)); });
    };
  }
  if (transferBtn) {
    transferBtn.onclick = () => {
      setPendingBtn(transferBtn, 'Transferring…');
      transfer()
        .then(() => { flashBtn(transferBtn, 'is-success'); clearPendingBtn(transferBtn, 'Transfer'); })
        .catch((e) => { flashBtn(transferBtn, 'is-failed'); clearPendingBtn(transferBtn, 'Transfer'); showToast(String(e.message || e)); });
    };
  }
  void refresh();
}
