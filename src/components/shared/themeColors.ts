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

export type Rgb = [number, number, number];

/**
 * Resolve any CSS color string to `[r, g, b]` using the browser's own parser,
 * so callers can accept whatever form a theme variable happens to take (hex,
 * `rgb()`, `color-mix()`, a named color) rather than only hex.
 *
 * Canvas interactives that build pixel data need real numbers, not strings.
 */
export const cssColorToRgb = (color: string, fallback: Rgb): Rgb => {
  if (typeof document === 'undefined' || !color) return fallback;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  // An unparseable color leaves fillStyle at its default, which would silently
  // read back as black; painting the fallback first makes that case detectable.
  ctx.fillStyle = `rgb(${fallback[0]}, ${fallback[1]}, ${fallback[2]})`;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
};

/** Perceived brightness in 0..1, for deciding what reads as a light theme. */
export const relativeLuminance = ([r, g, b]: Rgb): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Linear blend from `color` toward `target`, `amount` in 0..1. */
export const mixRgb = (color: Rgb, target: Rgb, amount: number): Rgb => [
  Math.round(color[0] + (target[0] - color[0]) * amount),
  Math.round(color[1] + (target[1] - color[1]) * amount),
  Math.round(color[2] + (target[2] - color[2]) * amount),
];

const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG contrast ratio between two colors, 1 (identical) to 21 (black/white). */
export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const l = ([r, g, b2]: Rgb) =>
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b2);
  const la = l(a);
  const lb = l(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Nudge `color` away from `background` until it clears `target` contrast, so a
 * theme whose accents sit close to its own background still yields a legible
 * ramp. Returns `color` untouched when it already has the contrast.
 */
export const ensureContrast = (
  color: Rgb,
  background: Rgb,
  target = 4.5,
  maxShift = 0.75,
): Rgb => {
  const away: Rgb = relativeLuminance(background) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let out = color;
  for (let amount = 0; amount <= maxShift + 1e-9; amount += 0.05) {
    out = mixRgb(color, away, amount);
    if (contrastRatio(out, background) >= target) break;
  }
  return out;
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
