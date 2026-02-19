export function showResultSplash(text, tone = 'neutral') {
  const el = document.createElement('div');
  const palette = tone === 'win'
    ? { bg: 'rgba(14, 49, 31, 0.95)', border: 'rgba(54, 209, 134, 0.9)', fg: '#d7ffe8' }
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
    padding: '14px 18px',
    borderRadius: '14px',
    border: `2px solid ${palette.border}`,
    background: palette.bg,
    color: palette.fg,
    fontFamily: '"Cormorant Garamond", serif',
    fontSize: '26px',
    fontWeight: '700',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    boxShadow: '0 16px 40px rgba(0,0,0,0.36)',
    opacity: '0',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });
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
