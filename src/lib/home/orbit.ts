// Keplerian orbit helpers for the landing-page astronomy miniature.

export const TAU = Math.PI * 2;
export const MAX_ECCENTRICITY = 0.8;

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Solve M = E - e*sin(E) for the eccentric anomaly E (Newton-Raphson). */
export function solveEccentricAnomaly(meanAnomaly: number, e: number): number {
  let E = meanAnomaly;
  for (let i = 0; i < 8; i += 1) {
    E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  }
  return E;
}

/** Screen position (y down) of the planet on an ellipse centred at (cx, cy). Sun sits at cx + a*e. */
export function orbitPoint(meanAnomaly: number, e: number, a: number, cx: number, cy: number) {
  const E = solveEccentricAnomaly(meanAnomaly, e);
  return { x: cx + a * Math.cos(E), y: cy - a * Math.sqrt(1 - e * e) * Math.sin(E) };
}

/**
 * The miniature holds the semi-minor axis b fixed so the ellipse always fits its
 * frame; the semi-major axis then follows from the eccentricity: a = b / sqrt(1 - e^2).
 */
export function semiMajorAxis(e: number, b: number): number {
  return b / Math.sqrt(1 - e * e);
}

/** Eccentricity implied by dragging the empty focus to screen x (focus offset c = b*e/sqrt(1-e^2)). */
export function eccentricityFromFocusX(x: number, cx: number, b: number): number {
  const d = Math.max(0, (cx - x) / b);
  return clamp(d / Math.sqrt(1 + d * d), 0, MAX_ECCENTRICITY);
}
