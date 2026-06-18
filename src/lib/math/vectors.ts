export interface Vector2 {
  x: number;
  y: number;
}

export const ZERO_VECTOR: Vector2 = { x: 0, y: 0 };

export const add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });

export const subtract = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (vector: Vector2, scalar: number): Vector2 => ({
  x: vector.x * scalar,
  y: vector.y * scalar,
});

export const dot = (a: Vector2, b: Vector2) => a.x * b.x + a.y * b.y;

export const magnitude = (vector: Vector2) => Math.hypot(vector.x, vector.y);

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export const directionDegrees = (vector: Vector2) => {
  if (magnitude(vector) === 0) {
    return 0;
  }

  const rawDegrees = toDegrees(Math.atan2(vector.y, vector.x));
  return (rawDegrees + 360) % 360;
};

export const vectorFromMagnitudeAndDirection = (
  vectorMagnitude: number,
  angleDegrees: number,
): Vector2 => ({
  x: vectorMagnitude * Math.cos(toRadians(angleDegrees)),
  y: vectorMagnitude * Math.sin(toRadians(angleDegrees)),
});

export const normalize = (vector: Vector2, fallback: Vector2 = { x: 1, y: 0 }): Vector2 => {
  const length = magnitude(vector);

  if (length === 0) {
    return fallback;
  }

  return scale(vector, 1 / length);
};

export const clampMagnitude = (vector: Vector2, maxMagnitude: number): Vector2 => {
  const length = magnitude(vector);

  if (length <= maxMagnitude || length === 0) {
    return vector;
  }

  return scale(vector, maxMagnitude / length);
};

export const project = (vector: Vector2, axis: Vector2): Vector2 => {
  const unit = normalize(axis);
  return scale(unit, dot(vector, unit));
};

export const reject = (vector: Vector2, axis: Vector2): Vector2 =>
  subtract(vector, project(vector, axis));

export const cleanScalar = (value: number, epsilon = 1e-10) =>
  Math.abs(value) < epsilon ? 0 : value;

export const formatScalar = (value: number, digits = 1) =>
  cleanScalar(value).toFixed(digits);

export const formatVector = (vector: Vector2, digits = 1) =>
  `<${formatScalar(vector.x, digits)}, ${formatScalar(vector.y, digits)}>`;
