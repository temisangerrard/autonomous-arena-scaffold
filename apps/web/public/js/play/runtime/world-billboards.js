/**
 * World Billboards — live rotating screens fed from state.feedSummary.
 * Two sprites placed in the 3D world; canvas textures updated on a dirty-flag
 * basis so we don't re-render every frame.
 */

const BILLBOARD_W = 512;
const BILLBOARD_H = 128;
const ROTATE_INTERVAL_MS = 6000;

// Slide definitions: functions that render onto a canvas context.
function slideNone(ctx, w, h) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(47,143,94,0.5)';
  ctx.font = 'bold 18px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ARENA LIVE', w / 2, h / 2);
}

function slideData(ctx, w, h, { header, line1, line2 }) {
  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#111118');
  grad.addColorStop(1, '#0f2419');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Gold border strip at top
  ctx.fillStyle = '#2f8f5e';
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);

  // Header chip
  ctx.fillStyle = 'rgba(47,143,94,0.18)';
  ctx.beginPath();
  ctx.roundRect(12, 10, 180, 22, 4);
  ctx.fill();
  ctx.fillStyle = '#2f8f5e';
  ctx.font = 'bold 11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(header).toUpperCase(), 20, 21);

  // Line 1 — main content
  ctx.fillStyle = '#f4f4f2';
  ctx.font = 'bold 22px "Plus Jakarta Sans", "IBM Plex Mono", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const trimmed1 = String(line1 || '').slice(0, 48);
  ctx.fillText(trimmed1, w / 2, 38);

  // Line 2 — secondary
  if (line2) {
    ctx.fillStyle = 'rgba(180,160,90,0.85)';
    ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillText(String(line2).slice(0, 60), w / 2, 68);
  }
}

function buildSlides(feedSummary) {
  const slides = [];
  if (!feedSummary) return slides;

  if (feedSummary.biggestWinToday) {
    const { displayName, wager, gameType } = feedSummary.biggestWinToday;
    slides.push({ header: 'Biggest Win Today', line1: `${displayName} +$${Number(wager || 0).toFixed(2)}`, line2: gameType ? gameType.toUpperCase() : '' });
  }
  if (feedSummary.hottestStreak) {
    const { displayName, streak, gameType } = feedSummary.hottestStreak;
    slides.push({ header: 'Hot Streak', line1: `${displayName} — ${streak}W`, line2: gameType ? gameType.toUpperCase() : '' });
  }
  if (feedSummary.latestMatch) {
    const { winner, loser, wager, gameType } = feedSummary.latestMatch;
    slides.push({ header: 'Latest Match', line1: `${winner} beat ${loser}`, line2: `$${Number(wager || 0).toFixed(2)} · ${(gameType || '').toUpperCase()}` });
  }
  if (feedSummary.predictionHeadline) {
    const { question, yesPrice, noPrice } = feedSummary.predictionHeadline;
    const yesP = (Number(yesPrice || 0) * 100).toFixed(0);
    const noP = (Number(noPrice || 0) * 100).toFixed(0);
    slides.push({ header: 'Prediction Market', line1: question || 'Live market open', line2: `YES ${yesP}¢  ·  NO ${noP}¢` });
  }
  return slides;
}

function makeBillboardSprite(THREE, scene, x, y, z, rotY = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = BILLBOARD_W;
  canvas.height = BILLBOARD_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  slideNone(ctx, BILLBOARD_W, BILLBOARD_H);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  // Aspect ratio: 512/128 = 4, scale in world units
  sprite.scale.set(8, 2, 1);
  sprite.position.set(x, y, z);
  scene.add(sprite);

  return {
    draw(slide) {
      if (!ctx) return;
      if (slide) {
        slideData(ctx, BILLBOARD_W, BILLBOARD_H, slide);
      } else {
        slideNone(ctx, BILLBOARD_W, BILLBOARD_H);
      }
      texture.needsUpdate = true;
    }
  };
}

export function createWorldBillboards({ THREE, scene }) {
  // Billboard 1: near center cluster
  const b1 = makeBillboardSprite(THREE, scene, 0, 5.5, 15);
  // Billboard 2: near prediction station at z=50
  const b2 = makeBillboardSprite(THREE, scene, 0, 5.5, 44);

  let slideIndex = 0;
  let lastRotateMs = 0;
  let lastFeedKey = '';

  let slides = [];

  function update(state, nowMs) {
    // Rebuild slides when feedSummary changes.
    const feedKey = JSON.stringify(state.feedSummary ?? null);
    if (feedKey !== lastFeedKey) {
      lastFeedKey = feedKey;
      slides = buildSlides(state.feedSummary);
      slideIndex = 0;
      lastRotateMs = nowMs;
      const slide = slides[0] || null;
      b1.draw(slide);
      b2.draw(slide);
      return;
    }

    if (nowMs - lastRotateMs > ROTATE_INTERVAL_MS && slides.length > 1) {
      lastRotateMs = nowMs;
      slideIndex = (slideIndex + 1) % slides.length;
      const slide = slides[slideIndex];
      b1.draw(slide);
      b2.draw(slide);
    }
  }

  return { update };
}
