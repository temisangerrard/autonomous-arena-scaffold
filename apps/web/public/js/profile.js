const runtimeBase = 'http://localhost:4100';
const statusLine = document.getElementById('status-line');
const profilesBody = document.getElementById('profiles-body');
const existingProfile = document.getElementById('existing-profile');
const newUsername = document.getElementById('new-username');
const newDisplayName = document.getElementById('new-display-name');
const createProfileBtn = document.getElementById('create-profile');
const useProfileBtn = document.getElementById('use-profile');
const refreshProfilesBtn = document.getElementById('refresh-profiles');
const activeSession = document.getElementById('active-session');
const enterArenaLink = document.getElementById('enter-arena');
const walletIdEl = document.getElementById('wallet-id');
const walletBalanceEl = document.getElementById('wallet-balance');
const fund10Btn = document.getElementById('fund-10');
const withdraw5Btn = document.getElementById('withdraw-5');

let profiles = [];
let session = JSON.parse(localStorage.getItem('arena_profile_session') || 'null');
function readAuthUser() {
  try {
    return JSON.parse(localStorage.getItem('arena_auth_user') || 'null');
  } catch {
    return null;
  }
}

function setStatus(text) {
  statusLine.textContent = text;
}

function saveSession(next) {
  session = next;
  localStorage.setItem('arena_profile_session', JSON.stringify(next));
  renderSession();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET failed ${res.status}`);
  return res.json();
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.reason || `status_${res.status}`);
  }
  return data;
}

function renderSession() {
  if (!session?.profileId || !session?.walletId) {
    activeSession.textContent = 'No active session.';
    walletIdEl.textContent = '-';
    walletBalanceEl.textContent = '0.00';
    enterArenaLink.href = '/play?world=mega';
    return;
  }

  activeSession.textContent = `Active: ${session.displayName} (@${session.username})`;
  walletIdEl.textContent = session.walletId;
  walletBalanceEl.textContent = Number(session.balance || 0).toFixed(2);

  const params = new URLSearchParams({
    world: 'mega',
    name: session.displayName,
    walletId: session.walletId,
    profileId: session.profileId
  });
  enterArenaLink.href = `/play?${params.toString()}`;
}

function renderProfiles() {
  profilesBody.innerHTML = '';
  existingProfile.innerHTML = '';

  for (const profile of profiles) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${profile.displayName}<div class="muted">@${profile.username}</div></td>
      <td>${profile.wallet?.id || '-'}</td>
      <td>${Number(profile.wallet?.balance || 0).toFixed(2)}</td>
      <td>${(profile.ownedBotIds || []).length}</td>
    `;
    profilesBody.appendChild(tr);

    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = `${profile.displayName} (@${profile.username})`;
    existingProfile.appendChild(opt);
  }

  if (session?.profileId && profiles.some((p) => p.id === session.profileId)) {
    existingProfile.value = session.profileId;
  }
}

async function loadProfiles() {
  const data = await getJson(`${runtimeBase}/profiles`);
  profiles = data.profiles || [];

  if (session?.profileId) {
    const fresh = profiles.find((p) => p.id === session.profileId);
    if (fresh) {
      saveSession({
        profileId: fresh.id,
        username: fresh.username,
        displayName: fresh.displayName,
        walletId: fresh.wallet?.id,
        balance: Number(fresh.wallet?.balance || 0)
      });
    }
  }

  renderProfiles();
}

createProfileBtn?.addEventListener('click', async () => {
  try {
    const created = await postJson(`${runtimeBase}/profiles/create`, {
      username: newUsername.value.trim(),
      displayName: newDisplayName.value.trim(),
      personality: 'social',
      targetPreference: 'human_first'
    });

    const profile = created.profile;
    saveSession({
      profileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      walletId: profile.walletId,
      balance: Number(created.wallet?.balance || 0)
    });

    newUsername.value = '';
    newDisplayName.value = '';
    await loadProfiles();
    setStatus(`Profile created: ${profile.displayName}`);
  } catch (error) {
    setStatus(`Create failed: ${String(error.message || error)}`);
  }
});

useProfileBtn?.addEventListener('click', () => {
  const selected = profiles.find((p) => p.id === existingProfile.value);
  if (!selected) {
    setStatus('Select a profile first.');
    return;
  }
  saveSession({
    profileId: selected.id,
    username: selected.username,
    displayName: selected.displayName,
    walletId: selected.wallet?.id,
    balance: Number(selected.wallet?.balance || 0)
  });
  setStatus(`Using profile ${selected.displayName}`);
});

refreshProfilesBtn?.addEventListener('click', async () => {
  try {
    await loadProfiles();
    setStatus('Profiles refreshed.');
  } catch (error) {
    setStatus(`Refresh failed: ${String(error.message || error)}`);
  }
});

fund10Btn?.addEventListener('click', async () => {
  if (!session?.walletId) {
    setStatus('No active profile wallet.');
    return;
  }
  try {
    await postJson(`${runtimeBase}/wallets/${session.walletId}/fund`, { amount: 10 });
    await loadProfiles();
    setStatus('Wallet funded +10');
  } catch (error) {
    setStatus(`Fund failed: ${String(error.message || error)}`);
  }
});

withdraw5Btn?.addEventListener('click', async () => {
  if (!session?.walletId) {
    setStatus('No active profile wallet.');
    return;
  }
  try {
    await postJson(`${runtimeBase}/wallets/${session.walletId}/withdraw`, { amount: 5 });
    await loadProfiles();
    setStatus('Wallet withdrew -5');
  } catch (error) {
    setStatus(`Withdraw failed: ${String(error.message || error)}`);
  }
});

(async function init() {
  const authUser = readAuthUser();
  if (authUser?.email && !newUsername.value) {
    newUsername.value = String(authUser.email).split('@')[0] || '';
  }
  if (authUser?.name && !newDisplayName.value) {
    newDisplayName.value = authUser.name;
  }
  renderSession();
  try {
    await loadProfiles();
    setStatus('Runtime connected.');
  } catch (error) {
    setStatus(`Unable to load profiles: ${String(error.message || error)}`);
  }
})();

window.addEventListener('arena-auth-updated', () => {
  const authUser = readAuthUser();
  if (authUser?.email && !newUsername.value) {
    newUsername.value = String(authUser.email).split('@')[0] || '';
  }
  if (authUser?.name && !newDisplayName.value) {
    newDisplayName.value = authUser.name;
  }
});
