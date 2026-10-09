// Short original synthesized cues. Audio starts only after a visitor's gesture.
export function createSound() {
  let context = null,
    enabled = false;
  async function toggle() {
    if (enabled) {
      enabled = false;
      await context?.suspend();
      return false;
    }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    try {
      context ||= new Audio();
      await context.resume();
      enabled = true;
    } catch {
      enabled = false;
    }
    return enabled;
  }
  function note(frequency = 440, duration = 0.4, delay = 0) {
    if (!enabled || !context || context.state !== 'running' || document.hidden)
      return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.055, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  function chord() {
    [261.63, 329.63, 392].forEach((f, i) => note(f, 0.9, i * 0.12));
  }
  function applause() {
    if (!enabled || !context || context.state !== 'running') return;
    const buffer = context.createBuffer(
        1,
        context.sampleRate * 0.7,
        context.sampleRate
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] =
        (Math.random() * 2 - 1) *
        Math.exp((-i / data.length) * 3) *
        Math.pow(Math.sin((i / context.sampleRate) * 75), 8) *
        0.2;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    source.onended = () => source.disconnect();
  }
  function visibility() {
    if (document.hidden) context?.suspend();
    else if (enabled) context?.resume().catch(() => {});
  }
  document.addEventListener('visibilitychange', visibility);
  return {
    toggle,
    note,
    chord,
    applause,
    get enabled() {
      return enabled;
    },
    dispose() {
      enabled = false;
      document.removeEventListener('visibilitychange', visibility);
      context?.close().catch(() => {});
    },
  };
}
