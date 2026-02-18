export function createToaster(container) {
  function dismissToast(toast) {
    if (!toast) return;
    toast.classList.add('toast-exit');
    window.setTimeout(() => toast.remove(), 240);
  }

  function showToast(message, type = 'info', duration = 4000) {
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    const body = document.createElement('div');
    body.className = 'toast__body';
    body.textContent = message;
    toast.appendChild(body);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'toast__dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss notification');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => dismissToast(toast));
    toast.appendChild(dismissBtn);

    container.appendChild(toast);

    window.setTimeout(() => {
      dismissToast(toast);
    }, duration);

    return toast;
  }

  return { showToast };
}
