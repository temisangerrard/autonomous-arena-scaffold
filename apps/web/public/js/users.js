const bodyEl = document.getElementById('users-body');
const statusEl = document.getElementById('users-status');
const refreshBtn = document.getElementById('refresh-users');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function api(url, init = {}) {
  const response = await fetch(url, { credentials: 'include', ...init });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  return payload;
}

function formatLastSeen(ts) {
  const at = Number(ts ?? 0);
  if (!Number.isFinite(at) || at <= 0) return '-';
  return new Date(at).toLocaleString();
}

function render(users) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  for (const user of users) {
    const online = Boolean(user.online);
    const dotClass = online ? 'online' : 'offline';
    const walletBalance = Number(user.walletBalance ?? 0);
    const lastSeen = formatLastSeen(user.lastSeen);
    const coords = (typeof user.x === 'number' && typeof user.z === 'number')
      ? `x:${Number(user.x).toFixed(1)} z:${Number(user.z).toFixed(1)}`
      : '-';

    const tr = document.createElement('tr');
    tr.dataset.profileId = String(user.profileId || '');

    tr.innerHTML = `
      <td>
        <div style="font-weight:650;">${escapeHtml(user.displayName || user.username || user.profileId)}</div>
        <div class="mono" style="color:var(--text-secondary);">
          @${escapeHtml(user.username || '-') }<br>
          profile ${escapeHtml(user.profileId)}<br>
          player ${escapeHtml(user.playerId)}
        </div>
      </td>
      <td>
        <div class="mono">${escapeHtml(user.subjectHash || '-')}</div>
        <div class="mono" style="color:var(--text-secondary); margin-top:6px;">
          ${escapeHtml(user.continuitySource || 'unknown')}
        </div>
      </td>
      <td>
        <div class="mono">${escapeHtml(user.walletId || '-')}</div>
        <div class="mono" style="color:var(--text-secondary);">${escapeHtml(user.walletAddress || '')}</div>
        <div style="margin-top:6px;"><span class="pill">Balance ${walletBalance.toFixed(2)}</span></div>
      </td>
      <td>
        <div class="pill"><span class="dot ${dotClass}"></span>${online ? 'Online' : 'Offline'}</div>
        <div class="mono" style="color:var(--text-secondary); margin-top:6px;">
          ${escapeHtml(user.serverId || '-') }<br>
          ${escapeHtml(coords)}<br>
          last ${escapeHtml(lastSeen)}
        </div>
      </td>
      <td>
        <div class="actions">
          <select data-field="teleport-section">
            <option value="">Teleport: section…</option>
            <option value="0">S1</option>
            <option value="1">S2</option>
            <option value="2">S3</option>
            <option value="3">S4</option>
            <option value="4">S5</option>
            <option value="5">S6</option>
            <option value="6">S7</option>
            <option value="7">S8</option>
          </select>
          <button type="button" class="secondary" data-action="teleport-section">Teleport To Section</button>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <input data-field="teleport-x" type="number" step="0.5" placeholder="x">
            <input data-field="teleport-z" type="number" step="0.5" placeholder="z">
          </div>
          <button type="button" class="secondary" data-action="teleport-coords">Teleport To Coords</button>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <select data-field="wallet-direction">
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
            <input data-field="wallet-amount" type="number" min="0" step="0.01" placeholder="amount">
          </div>
          <input data-field="wallet-reason" type="text" placeholder="reason (optional)">
          <button type="button" data-action="wallet-adjust">Adjust Wallet</button>

          <button type="button" class="secondary" data-action="force-logout">Force Logout</button>
        </div>
      </td>
    `;

    bodyEl.appendChild(tr);
  }
}

async function refresh() {
  setStatus('Loading users…');
  const payload = await api('/api/admin/users');
  render(payload.users || []);
  setStatus(`Loaded ${Number(payload.users?.length || 0)} users.`);
}

bodyEl?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;
  const row = target.closest('tr');
  const profileId = row?.dataset.profileId || '';
  if (!profileId) return;

  const getField = (name) => row?.querySelector(`[data-field="${name}"]`);

  try {
    setStatus('Working…');
    if (action === 'teleport-section') {
      const sel = getField('teleport-section');
      const section = Number(sel?.value ?? NaN);
      if (!Number.isFinite(section)) {
        setStatus('Pick a section (S1..S8).');
        return;
      }
      await api(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section })
      });
      await refresh();
      setStatus('Teleported.');
      return;
    }

    if (action === 'teleport-coords') {
      const x = Number(getField('teleport-x')?.value ?? NaN);
      const z = Number(getField('teleport-z')?.value ?? NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        setStatus('Enter numeric x and z.');
        return;
      }
      await api(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x, z })
      });
      await refresh();
      setStatus('Teleported.');
      return;
    }

    if (action === 'wallet-adjust') {
      const direction = String(getField('wallet-direction')?.value || 'credit');
      const amount = Math.max(0, Number(getField('wallet-amount')?.value ?? 0));
      const reason = String(getField('wallet-reason')?.value || '').trim();
      if (amount <= 0) {
        setStatus('Amount must be > 0.');
        return;
      }
      await api(`/api/admin/users/${encodeURIComponent(profileId)}/wallet/adjust`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction, amount, reason })
      });
      await refresh();
      setStatus('Wallet adjusted.');
      return;
    }

    if (action === 'force-logout') {
      const payload = await api(`/api/admin/users/${encodeURIComponent(profileId)}/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      await refresh();
      setStatus(`Forced logout (sessions deleted: ${payload.sessionsDeleted ?? 0}).`);
      return;
    }
  } catch (err) {
    setStatus(`Failed: ${String(err?.message || err)}`);
  }
});

refreshBtn?.addEventListener('click', () => {
  void refresh();
});

void refresh();
setInterval(() => void refresh().catch(() => undefined), 15000);
