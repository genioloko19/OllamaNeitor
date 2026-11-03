/** Sintetizador de logros con Web Audio API (sin archivos externos). */

let context = null;

function ensureContext() {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    context = new Ctx();
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

/** Acorde ascendente de 4 notas, estilo consola. */
export function playAchievement() {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);

  notes.forEach((frequency, index) => {
    const start = now + index * 0.085;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = index === notes.length - 1 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.6);
  });
}

export function playLevelUp() {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [392, 523.25, 659.25, 783.99, 1046.5];
  const master = ctx.createGain();
  master.gain.value = 0.11;
  master.connect(ctx.destination);
  notes.forEach((frequency, index) => {
    const start = now + index * 0.07;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.7, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.5);
  });
}
