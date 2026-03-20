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
    <div class="cashier-panel">
      <div class="cashier-balance-card">
        <span class="cashier-label">Arena Reserve</span>
        <div class="cashier-balance-row">
          <span class="cashier-balance-amount" id="station-balance-amount">\u2014</span>
          <span class="cashier-balance-unit">USDC</span>
        </div>
      </div>
      <div class="cashier-actions">
        <button id="station-fund" class="cashier-action-btn cashier-action-btn--primary" type="button">
          <span class="material-symbols-outlined cashier-action-btn__icon">add_circle</span>
          <span class="cashier-action-btn__label">Fund</span>
        </button>
        <button id="station-withdraw" class="cashier-action-btn" type="button">
          <span class="material-symbols-outlined cashier-action-btn__icon">outbound</span>
          <span class="cashier-action-btn__label">Withdraw</span>
        </button>
        <button id="station-transfer-open" class="cashier-action-btn" type="button">
          <span class="material-symbols-outlined cashier-action-btn__icon">send</span>
          <span class="cashier-action-btn__label">Send</span>
        </button>
      </div>
      <div class="cashier-amount-field">
        <label class="cashier-amount-field__label" for="station-amount">Amount (USDC)</label>
        <div class="cashier-amount-field__wrap">
          <input id="station-amount" class="cashier-amount-input" type="number" min="0" max="10000" step="1" value="10"/>
          <span class="cashier-amount-field__unit">USDC</span>
        </div>
      </div>
      <div class="cashier-transfer-row" id="cashier-transfer-row" style="display:none;">
        <label class="cashier-amount-field__label" for="station-to-wallet">Recipient Wallet ID</label>
        <input id="station-to-wallet" class="cashier-amount-input cashier-transfer-input" type="text" placeholder="wallet_id\u2026"/>
        <button id="station-transfer" class="cashier-confirm-btn" type="button">Confirm Transfer</button>
      </div>
      <button id="station-refresh" class="cashier-refresh-btn" type="button">
        <span class="material-symbols-outlined">refresh</span> Sync Balance
      </button>
      <div class="station-ui__meta" id="station-balance"></div>
    </div>
  `;

  const balanceEl = document.getElementById('station-balance');
  const balanceAmountEl = document.getElementById('station-balance-amount');
  const amountEl = document.getElementById('station-amount');
  const toWalletEl = document.getElementById('station-to-wallet');
  const refreshBtn = document.getElementById('station-refresh');
  const fundBtn = document.getElementById('station-fund');
  const withdrawBtn = document.getElementById('station-withdraw');
  const transferOpenBtn = document.getElementById('station-transfer-open');
  const transferRowEl = document.getElementById('cashier-transfer-row');
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
        if (balanceAmountEl) balanceAmountEl.textContent = '\u2014';
        if (balanceEl) balanceEl.textContent = 'Balance unavailable (onchain)';
        return;
      }
      const formatted = formatUsdAmount(Number(state.walletBalance));
      if (balanceAmountEl) balanceAmountEl.textContent = formatted;
      if (balanceEl) balanceEl.textContent = '';
    } catch (err) {
      if (balanceAmountEl) balanceAmountEl.textContent = '\u2014';
      if (balanceEl) balanceEl.textContent = `Balance unavailable (${String(err.message || err)})`;
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

  if (transferOpenBtn) {
    transferOpenBtn.onclick = () => {
      if (!transferRowEl) return;
      const isVisible = transferRowEl.style.display !== 'none';
      transferRowEl.style.display = isVisible ? 'none' : 'flex';
    };
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
