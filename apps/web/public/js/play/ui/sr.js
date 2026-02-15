export function createAnnouncer(el) {
  function announce(message) {
    if (!el) return;
    el.textContent = '';
    window.setTimeout(() => {
      el.textContent = message;
    }, 100);
  }

  return { announce };
}

