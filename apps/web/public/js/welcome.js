const AUTH_KEY = 'arena_auth_user';

const ctaRoot = document.getElementById('welcome-session-cta');
const hint = document.getElementById('welcome-hint');
const authError = document.getElementById('welcome-auth-error');
const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminUsername = document.getElementById('admin-username');
const adminPassword = document.getElementById('admin-password');
const adminStatus = document.getElementById('admin-login-status');

let config = {
  authEnabled: false,
  googleClientId: '',
  localAuthEnabled: true
};

function setStoredUser(user) {
  if (user) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}

async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  return payload;
}

function showAuthError(message) {
  if (authError) {
    authError.textContent = message || '';
  }
}

async function logout() {
  try {
    await requestJson('/api/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  } catch {
    // best-effort
  }
  setStoredUser(null);
  await render();
}

function continueTarget(user) {
  // Always go to dashboard; admin tools can be opened from there.
  return '/dashboard';
}

function renderSignedIn(user) {
  if (!ctaRoot || !hint) {
    return;
  }
  hint.textContent = `Signed in as ${user.name || user.email} (${user.role}).`;
  ctaRoot.innerHTML = `
    <a class="btn btn--primary" href="/play?world=mega">Enter Arena</a>
    <a class="btn btn--secondary" href="${continueTarget(user)}">Open Dashboard</a>
    <button id="welcome-logout" class="btn btn--ghost" type="button">Logout</button>
  `;
  ctaRoot.querySelector('#welcome-logout')?.addEventListener('click', () => {
    void logout();
  });
}

function renderSignedOut() {
  if (!ctaRoot || !hint) {
    return;
  }

  if (!config.authEnabled || !config.googleClientId) {
    hint.textContent = 'Google sign-in is not configured in this environment.';
    ctaRoot.innerHTML = '<a class="btn btn--primary" href="/play?world=mega">Enter Arena</a><a class="btn btn--secondary" href="/viewer?world=mega">Explore Viewer</a>';
    return;
  }

  hint.textContent = 'Sign in with Google to create your player bot and wallet.';
  ctaRoot.innerHTML = '<a class="btn btn--primary" href="/play?world=mega">Enter Arena</a><div id="google-signin-welcome"></div>';
  if (window.google?.accounts?.id) {
    void (async () => {
      const noncePayload = await requestJson('/api/auth/google/nonce').catch(() => null);
      const nonce = String(noncePayload?.nonce || '').trim();
      if (!nonce) {
        showAuthError('Sign-in setup failed. Refresh and try again.');
        return;
      }
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        nonce,
        callback: (response) => {
          void handleGoogleCredential(response.credential || '');
        }
      });
      window.google.accounts.id.renderButton(document.getElementById('google-signin-welcome'), {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 260
      });
    })();
  }
}

async function handleGoogleCredential(credential) {
  showAuthError('');
  try {
    const result = await requestJson('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential })
    });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    showAuthError(`Sign-in failed: ${String(error.message || error)}`);
  }
}

async function loadGoogleScriptIfNeeded() {
  if (!config.authEnabled || !config.googleClientId || window.google?.accounts?.id) {
    return;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  }).catch(() => undefined);
}

async function render() {
  showAuthError('');
  const session = await requestJson('/api/session').catch(() => null);
  const user = session?.user || null;

  if (user) {
    setStoredUser(user);
    renderSignedIn(user);
  } else {
    setStoredUser(null);
    await loadGoogleScriptIfNeeded();
    renderSignedOut();
  }
}

adminToggle?.addEventListener('click', () => {
  if (!adminPanel) {
    return;
  }
  const currentlyHidden = adminPanel.hasAttribute('hidden');
  if (currentlyHidden) {
    adminPanel.removeAttribute('hidden');
    adminToggle.textContent = 'Hide admin access';
  } else {
    adminPanel.setAttribute('hidden', 'true');
    adminToggle.textContent = 'Admin access';
  }
});

adminLoginBtn?.addEventListener('click', async () => {
  const username = String(adminUsername?.value || '').trim();
  const password = String(adminPassword?.value || '').trim();
  if (!username || !password) {
    if (adminStatus) {
      adminStatus.textContent = 'Username and password required.';
    }
    return;
  }

  try {
    if (adminStatus) {
      adminStatus.textContent = 'Signing in...';
    }
    const result = await requestJson('/api/auth/local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    setStoredUser(result.user || null);
    window.location.href = result.redirectTo || '/dashboard';
  } catch (error) {
    if (adminStatus) {
      adminStatus.textContent = `Login failed: ${String(error.message || error)}`;
    }
  }
});

(async function init() {
  try {
    config = await requestJson('/api/config');
  } catch {
    config = { authEnabled: false, googleClientId: '', localAuthEnabled: true };
  }

  if (!config.localAuthEnabled) {
    adminToggle?.setAttribute('hidden', 'true');
    adminPanel?.setAttribute('hidden', 'true');
  }

  await render();
})();
