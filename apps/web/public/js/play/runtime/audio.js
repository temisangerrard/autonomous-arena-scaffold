/**
 * World Audio Controller
 * Wraps Web Audio API for ambient loop + event SFX.
 * Initializes on first user gesture (browser autoplay policy).
 * Persists mute/volume to localStorage.
 */

const LS_MUTED = 'arena_audio_muted';
const LS_VOLUME = 'arena_audio_volume';

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

export function createAudioController() {
  let ctx = null;
  let masterGain = null;
  let ambientSource = null;
  let ambientBuffer = null;
  let ambientPlaying = false;

  let muted = readPref(LS_MUTED, 'false') === 'true';
  let volume = Math.min(1, Math.max(0, Number(readPref(LS_VOLUME, '0.35'))));

  // SFX buffers keyed by event name
  const sfxBuffers = new Map();

  function ensureContext() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : volume;
      masterGain.connect(ctx.destination);
    } catch {
      // Audio not available in this environment.
    }
  }

  async function fetchBuffer(url) {
    if (!ctx) return null;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      return await ctx.decodeAudioData(arrayBuffer);
    } catch {
      return null;
    }
  }

  async function loadAmbientLoop(url) {
    ensureContext();
    if (!ctx) return;
    ambientBuffer = await fetchBuffer(url);
    if (!ambientBuffer) return;
    if (!ambientPlaying) {
      startAmbientLoop();
    }
  }

  async function loadSfx(eventName, url) {
    ensureContext();
    if (!ctx) return;
    const buffer = await fetchBuffer(url);
    if (buffer) sfxBuffers.set(eventName, buffer);
  }

  function startAmbientLoop() {
    if (!ctx || !ambientBuffer || ambientPlaying) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => startAmbientLoop());
      return;
    }
    ambientSource = ctx.createBufferSource();
    ambientSource.buffer = ambientBuffer;
    ambientSource.loop = true;

    const ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.55; // Ambient is quieter than SFX
    ambientSource.connect(ambientGain);
    ambientGain.connect(masterGain);
    ambientSource.start();
    ambientPlaying = true;
  }

  function trigger(eventName) {
    if (!ctx || muted) return;
    const buffer = sfxBuffers.get(eventName);
    if (!buffer) return;
    try {
      if (ctx.state === 'suspended') { ctx.resume(); return; }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(masterGain);
      src.start();
    } catch { /* ignore */ }
  }

  function init() {
    ensureContext();
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (ambientBuffer && !ambientPlaying) {
      startAmbientLoop();
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    writePref(LS_MUTED, muted);
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, Number(value)));
    writePref(LS_VOLUME, volume);
    if (masterGain && !muted) masterGain.gain.value = volume;
  }

  function getMuted() { return muted; }
  function getVolume() { return volume; }

  return {
    init,
    loadAmbientLoop,
    loadSfx,
    trigger,
    setMuted,
    setVolume,
    getMuted,
    getVolume
  };
}
