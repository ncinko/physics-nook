// Shared helper so canvas-based interactives read the active theme's CSS custom
// properties (light / dark / pastel) instead of hardcoded colors.
//
// `getCssColor` and `onThemeChange` are generic primitives any domain can reuse.
// `themeColors()` is the convenience palette used by the field/charge canvases.

export const getCssColor = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export interface ThemeColors {
  bg: string;
  surface: string;
  grid: string;
  text: string;
  muted: string;
  positive: string;
  negative: string;
  probe: string;
}

export const themeColors = (): ThemeColors => ({
  bg: getCssColor('--sim-bg', '#f9fafb'),
  surface: getCssColor('--surface-elevated', '#ffffff'),
  grid: getCssColor('--grid-line', '#d1d5db'),
  text: getCssColor('--text-primary', '#111827'),
  muted: getCssColor('--text-muted', '#6b7280'),
  positive: getCssColor('--accent-red', '#dc2626'),
  negative: getCssColor('--accent-blue', '#2563eb'),
  probe: getCssColor('--accent-green', '#22c55e'),
});

// Run `redraw` whenever the active theme changes, so static canvases (no
// animation loop) repaint with the new palette. Returns a cleanup function.
export const onThemeChange = (redraw: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const observer = new MutationObserver(redraw);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });
  return () => observer.disconnect();
};
