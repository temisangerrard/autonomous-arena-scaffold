export function showResultSplash(text, tone = 'neutral', opts = {}) {
  const big = tone === 'win' && Boolean(opts.big);
  const el = document.createElement('div');
  const palette = tone === 'win'
    ? big
      ? { bg: 'rgba(14, 49, 31, 0.97)', border: 'rgba(228,188,92,0.9)', fg: '#fff8dc' }
      : { bg: 'rgba(14, 49, 31, 0.95)', border: 'rgba(54, 209, 134, 0.9)', fg: '#d7ffe8' }
    : tone === 'loss'
      ? { bg: 'rgba(57, 20, 25, 0.95)', border: 'rgba(244, 93, 113, 0.9)', fg: '#ffd7dc' }
      : { bg: 'rgba(37, 31, 18, 0.95)', border: 'rgba(228, 188, 92, 0.9)', fg: '#fff3cc' };
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    top: '18%',
    transform: 'translate(-50%, -50%) scale(0.95)',
    zIndex: '1200',
    minWidth: '340px',
    maxWidth: '88vw',
    minHeight: big ? '420px' : '',
    padding: big ? '28px 28px' : '14px 18px',
    borderRadius: '14px',
    border: `2px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    fontFamily: 'var(--font-primary, "Plus Jakarta Sans", sans-serif)',
    fontSize: big ? '32px' : '26px',
    fontWeight: '700',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    boxShadow: big
      ? '0 0 48px 8px rgba(228,188,92,0.35), 0 16px 40px rgba(0,0,0,0.48)'
      : '0 16px 40px rgba(0,0,0,0.36)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });
  if (big) {
    el.classList.add('result-splash--bigwin');
    if (!document.getElementById('result-splash-bigwin-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'result-splash-bigwin-style';
      styleEl.textContent = `
@keyframes resultSplashGoldPulse {
  0%   { box-shadow: 0 0 48px 8px rgba(228,188,92,0.35), 0 16px 40px rgba(0,0,0,0.48); }
  50%  { box-shadow: 0 0 80px 20px rgba(228,188,92,0.65), 0 16px 40px rgba(0,0,0,0.48); }
  100% { box-shadow: 0 0 48px 8px rgba(228,188,92,0.35), 0 16px 40px rgba(0,0,0,0.48); }
}
.result-splash--bigwin {
  animation: resultSplashGoldPulse 1.2s ease-in-out infinite;
}
      `.trim();
      document.head.appendChild(styleEl);
    }
  }
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -50%) scale(0.96)';
    window.setTimeout(() => el.remove(), 220);
  }, 2100);
}
