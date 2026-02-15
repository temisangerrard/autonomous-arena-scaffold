const healthEl = document.getElementById('service-health');
const feedEl = document.getElementById('challenge-feed');
const refreshFeedButton = document.getElementById('refresh-feed');

const services = [
  { name: 'web', url: '/health' },
  { name: 'server', url: '/server/health' },
  { name: 'agent-runtime', url: '/runtime/health' }
];

function badge(name, ok, extra = '') {
  const color = ok ? '#1f7a64' : '#9a2f2f';
  const text = ok ? 'up' : 'down';
  return `<span style="padding:6px 10px; border-radius:999px; background:${color}; color:white; font-size:12px;">${name}: ${text}${extra ? ` (${extra})` : ''}</span>`;
}

async function loadHealth() {
  const statuses = await Promise.all(
    services.map(async (service) => {
      try {
        const response = await fetch(service.url);
        if (!response.ok) {
          return { name: service.name, ok: false, detail: response.status };
        }
        const payload = await response.json();
        return { name: service.name, ok: Boolean(payload.ok), detail: payload.timestamp || '' };
      } catch {
        return { name: service.name, ok: false, detail: 'unreachable' };
      }
    })
  );

  healthEl.innerHTML = statuses.map((status) => badge(status.name, status.ok, status.detail)).join('');
}

async function loadChallengeFeed() {
  try {
    const response = await fetch('/challenges/recent?limit=25');
    const payload = await response.json();
    const lines = (payload.recent || [])
      .slice()
      .reverse()
      .map((entry) => {
        const ts = new Date(entry.at).toLocaleTimeString();
        const pair = entry.challengerId && entry.opponentId ? ` ${entry.challengerId} vs ${entry.opponentId}` : '';
        const winner = entry.winnerId ? ` winner=${entry.winnerId}` : '';
        const reason = entry.reason ? ` reason=${entry.reason}` : '';
        return `${ts} ${entry.event}${pair}${winner}${reason}`;
      });

    feedEl.textContent = lines.join('\n') || 'No challenge events yet.';
  } catch (err) {
    feedEl.textContent = `Failed to load challenge feed: ${String(err)}`;
  }
}

refreshFeedButton?.addEventListener('click', () => {
  loadChallengeFeed();
});

loadHealth();
loadChallengeFeed();
setInterval(loadHealth, 5000);
setInterval(loadChallengeFeed, 4000);
