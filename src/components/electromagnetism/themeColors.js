// Small shared helper so the electromagnetism canvases read the active theme's
// CSS custom properties (light / dark / pastel) instead of hardcoded colors.

export const getCssColor = (name, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export const themeColors = () => ({
  bg: getCssColor('--sim-bg', '#f9fafb'),
  surface: getCssColor('--surface-elevated', '#ffffff'),
  grid: getCssColor('--grid-line', '#d1d5db'),
  text: getCssColor('--text-primary', '#111827'),
  muted: getCssColor('--text-muted', '#6b7280'),
  positive: getCssColor('--accent-red', '#dc2626'),
  negative: getCssColor('--accent-blue', '#2563eb'),
  probe: getCssColor('--accent-green', '#22c55e'),
});

// Run `redraw` once now and again whenever the active theme changes, so static
// canvases (no animation loop) repaint with the new palette. Returns a cleanup.
export const onThemeChange = (redraw) => {
  if (typeof window === 'undefined') return () => {};
  const observer = new MutationObserver(redraw);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });
  return () => observer.disconnect();
};
