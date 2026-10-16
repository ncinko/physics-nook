// Helpers for sliders that sweep a spring constant across several decades, from
// a soft cushion up to something that behaves like a rigid floor or rope.

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Map a 0..1 slider position onto [min, max] logarithmically. */
export const logSliderToValue = (position: number, min: number, max: number) =>
  min * Math.pow(max / min, clamp(position, 0, 1));

/** Inverse of `logSliderToValue`. */
export const valueToLogSlider = (value: number, min: number, max: number) =>
  clamp(Math.log(Math.max(value, min) / min) / Math.log(max / min), 0, 1);

/** Compact label for values spanning several decades: 0.7, 12, 480, 1.5k, 100k. */
export const formatMagnitude = (value: number) => {
  if (value >= 10000) {
    return `${Math.round(value / 1000)}k`;
  }
  if (value >= 1000) {
    return `${Number((value / 1000).toFixed(1))}k`;
  }
  if (value >= 100) {
    return `${Math.round(value)}`;
  }
  if (value >= 10) {
    return `${Number(value.toFixed(1))}`;
  }
  return `${Number(value.toFixed(2))}`;
};

/**
 * Substeps per frame that keep an explicit spring integrator stable: the
 * natural frequency times the substep stays under `maxPhase` radians.
 */
export const stableSubsteps = (stiffness: number, mass: number, dt: number, maxPhase = 0.2, cap = 240) => {
  const omega = Math.sqrt(Math.max(stiffness, 0) / Math.max(mass, 1e-6));
  return clamp(Math.ceil((omega * dt) / maxPhase), 1, cap);
};

/**
 * Damping ratio that equals `baseRatio` at `baseStiffness` and climbs to
 * `maxRatio` (critical damping by default) over `decades` factors of ten, so a
 * very stiff spring stops dead instead of ringing like a perfectly elastic one.
 */
export const dampingRatio = (
  stiffness: number,
  baseStiffness: number,
  baseRatio: number,
  decades = 2,
  maxRatio = 1,
) => {
  const decadesAbove = Math.log10(Math.max(stiffness, 1e-9) / baseStiffness);
  return baseRatio + (maxRatio - baseRatio) * clamp(decadesAbove / decades, 0, 1);
};
