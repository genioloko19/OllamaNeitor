/** Confeti con la paleta del tema activo. */

export function celebrate() {
  if (!window.confetti) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const styles = getComputedStyle(document.documentElement);
  const colors = ['--accent', '--accent-2', '--accent-3', '--accent-4', '--warning']
    .map((name) => styles.getPropertyValue(name).trim())
    .filter(Boolean);
  window.confetti({
    particleCount: 90,
    spread: 72,
    startVelocity: 34,
    origin: { y: 0.18 },
    colors,
    disableForReducedMotion: true,
    scalar: 0.9
  });
}

export function fireworks() {
  if (!window.confetti) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const styles = getComputedStyle(document.documentElement);
  const colors = ['--accent', '--accent-2', '--accent-3', '--warning']
    .map((name) => styles.getPropertyValue(name).trim())
    .filter(Boolean);
  const end = Date.now() + 900;
  (function frame() {
    window.confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors });
    window.confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
