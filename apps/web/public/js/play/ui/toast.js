export function createToaster(container) {
  function showToast(message, type = 'info', duration = 4000) {
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('toast-exit');
      window.setTimeout(() => toast.remove(), 300);
    }, duration);

    return toast;
  }

  return { showToast };
}

