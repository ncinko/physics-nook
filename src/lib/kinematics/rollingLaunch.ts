/**
 * A ball on the photogate lab's setup sketch: down a ramp, across the table,
 * off the edge, onto the floor.
 *
 * Pure and DOM-free, in the sketch's own SVG units, so the diagram component
 * only draws what this returns. The physics is the real physics at the
 * sketch's scale (the table is taken to be 0.9 m tall):
 *
 *   ramp    a solid sphere rolling without slipping: a = (5/7) g sin θ
 *   table   constant speed, less a little rolling resistance
 *   air     projectile: no horizontal acceleration, g downward
 *   floor   bounces with a low restitution, then rolls
 *
 * The sketch is illustrative, not the student's setup, so nothing here tells
 * anyone where their own ball will land.
 */

export interface Point {
  x: number;
  y: number;
}

/** The sketch's geometry, in SVG units (y points down). */
export const SCENE = {
  width: 580,
  tableLeft: 20,
  tableTop: 120,
  /** Underside of the tabletop slab. */
  tableBottom: 130,
  edge: 330,
  floor: 280,
  /** The ramp's sloped face, from its top to where it meets the table. */
  rampTop: { x: 30, y: 50 },
  rampBottom: { x: 140, y: 120 },
  radius: 8,
  gates: [
    { x: 215, label: 'A' },
    { x: 285, label: 'B' },
  ],
  /** Height of a gate's frame above the tabletop. */
  gateHeight: 36,
} as const;

/** Real metres per SVG unit, from a 0.9 m table drawn 160 units tall. */
export const METERS_PER_UNIT = 0.9 / (SCENE.floor - SCENE.tableTop);

/** Gravity in SVG units per second squared. */
export const GRAVITY = 9.8 / METERS_PER_UNIT;

/** Rolling resistance as a fraction of g. Small on a tabletop, larger on a floor. */
const TABLE_ROLLING_RESISTANCE = 0.01;
const FLOOR_ROLLING_RESISTANCE = 0.03;
/** Fraction of the normal speed a bounce keeps. A steel ball on a hard floor. */
const RESTITUTION = 0.3;
/** Slower impacts than this (0.35 m/s) settle onto the surface instead of bouncing. */
const SETTLE_SPEED = 0.35 / METERS_PER_UNIT;
/** Below this (5 mm/s) a rolling ball is at rest. */
const REST_SPEED = 0.005 / METERS_PER_UNIT;

const rampDx = SCENE.rampBottom.x - SCENE.rampTop.x;
const rampDy = SCENE.rampBottom.y - SCENE.rampTop.y;
const rampLength = Math.hypot(rampDx, rampDy);
/** Unit vector down the ramp. */
const DOWNHILL: Point = { x: rampDx / rampLength, y: rampDy / rampLength };
/** Unit normal out of the ramp face (up and to the right). */
const RAMP_NORMAL: Point = { x: DOWNHILL.y, y: -DOWNHILL.x };
const SIN_THETA = DOWNHILL.y;

export type BallMode =
  /** Waiting where it was put: at the top of the ramp until someone picks it up. */
  | 'parked'
  | 'held'
  | 'air'
  | 'ramp'
  | 'table'
  | 'floor'
  | 'rest'
  /** Rolled out of the picture. */
  | 'gone';

export interface Ball {
  mode: BallMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const ball = (mode: BallMode, x: number, y: number, vx = 0, vy = 0): Ball => ({ mode, x, y, vx, vy });

/** Height of the ramp face at `x`, or null off the ramp. */
const rampSurfaceY = (x: number): number | null =>
  x < SCENE.rampTop.x || x > SCENE.rampBottom.x
    ? null
    : SCENE.rampTop.y + ((x - SCENE.rampTop.x) / rampDx) * rampDy;

/** Signed distance from the ramp face's line to a point; positive outside. */
const rampDistance = (point: Point): number =>
  (point.x - SCENE.rampTop.x) * RAMP_NORMAL.x + (point.y - SCENE.rampTop.y) * RAMP_NORMAL.y;

/** Where a ball touching the ramp touches it, measured along the face. */
const rampContactX = (point: Point): number => point.x - SCENE.radius * RAMP_NORMAL.x;

/** A ball resting on the ramp with its contact point at `contactX`. */
const onRamp = (contactX: number, speed = 0): Ball => {
  const surfaceY = rampSurfaceY(contactX) ?? SCENE.rampBottom.y;
  return ball(
    'ramp',
    contactX + SCENE.radius * RAMP_NORMAL.x,
    surfaceY + SCENE.radius * RAMP_NORMAL.y,
    speed * DOWNHILL.x,
    speed * DOWNHILL.y,
  );
};

/** Where the ball starts: near the top of the ramp, held in place. */
export const startBall = (): Ball => ({ ...onRamp(SCENE.rampTop.x + 5), mode: 'parked' });

const onTable = (x: number) => x >= SCENE.rampBottom.x && x <= SCENE.edge;

/**
 * Drops the ball where it was let go. A spot inside something — the ramp, the
 * tabletop, the floor — is moved onto its surface; a spot in the air falls.
 */
export const releaseBall = (at: Point): Ball => {
  const r = SCENE.radius;
  const y = Math.min(Math.max(at.y, r), SCENE.floor - r);
  // Nothing fits between the ramp's back wall and the table's end.
  const minX = y < SCENE.tableBottom ? SCENE.rampTop.x + r : r;
  const x = Math.min(Math.max(at.x, minX), SCENE.width - r);

  const rampX = rampContactX({ x, y });
  // Within a hair of the face counts as on it, so a ball let go where it sat stays put.
  if (rampSurfaceY(rampX) !== null && rampDistance({ x, y }) < r + 0.5) return onRamp(rampX);

  if (
    x >= SCENE.tableLeft &&
    x <= SCENE.edge &&
    y > SCENE.tableTop - r &&
    y < SCENE.tableBottom + r / 2
  ) {
    // The ramp covers the table left of its foot; a ball put there sits on the ramp.
    if (!onTable(x)) return onRamp(SCENE.rampBottom.x - 1);
    return ball('rest', x, SCENE.tableTop - r);
  }

  if (y >= SCENE.floor - r) return ball('rest', x, SCENE.floor - r);
  return ball('air', x, y);
};

/** Rolling resistance slows a rolling ball toward zero, never past it. */
const roll = (current: Ball, resistance: number, dt: number): number => {
  const slowed = Math.abs(current.vx) - resistance * GRAVITY * dt;
  return slowed <= 0 ? 0 : Math.sign(current.vx) * slowed;
};

/**
 * Lands an airborne ball on a surface, bouncing it if it arrives fast enough.
 * The tangent is the normal turned a quarter clockwise: rightward for a floor,
 * downhill for the ramp.
 */
const land = (
  current: Ball,
  normal: Point,
  attach: (tangential: number) => Ball,
): Ball => {
  const normalSpeed = -(current.vx * normal.x + current.vy * normal.y);
  const tangent: Point = { x: -normal.y, y: normal.x };
  const tangential = current.vx * tangent.x + current.vy * tangent.y;

  if (normalSpeed > SETTLE_SPEED) {
    const bounced = normalSpeed * RESTITUTION;
    return {
      ...current,
      vx: tangential * tangent.x + bounced * normal.x,
      vy: tangential * tangent.y + bounced * normal.y,
    };
  }
  return attach(tangential);
};

const stepAir = (current: Ball, dt: number): Ball => {
  const r = SCENE.radius;
  const next = {
    ...current,
    x: current.x + current.vx * dt,
    y: current.y + current.vy * dt + 0.5 * GRAVITY * dt * dt,
    vy: current.vy + GRAVITY * dt,
  };

  if (next.x < -r || next.x > SCENE.width + r) return ball('gone', next.x, next.y);

  if (next.y >= SCENE.floor - r && next.vy > 0) {
    const grounded = { ...next, y: SCENE.floor - r };
    return land(grounded, { x: 0, y: -1 }, (t) => ball('floor', grounded.x, grounded.y, t));
  }

  const wasAbove = current.y <= SCENE.tableTop - r + 0.5;
  if (onTable(next.x) && wasAbove && next.y >= SCENE.tableTop - r && next.vy > 0) {
    const grounded = { ...next, y: SCENE.tableTop - r };
    return land(grounded, { x: 0, y: -1 }, (t) => ball('table', grounded.x, grounded.y, t));
  }

  const contactX = rampContactX(next);
  if (
    rampSurfaceY(contactX) !== null &&
    rampDistance(next) <= r &&
    rampDistance(current) >= r - 0.5
  ) {
    const touching = { ...next, x: contactX + r * RAMP_NORMAL.x };
    touching.y = (rampSurfaceY(contactX) ?? next.y) + r * RAMP_NORMAL.y;
    return land(touching, RAMP_NORMAL, (t) => onRamp(contactX, t));
  }

  return next;
};

const stepRamp = (current: Ball, dt: number): Ball => {
  const speed = current.vx * DOWNHILL.x + current.vy * DOWNHILL.y;
  const accel = (5 / 7) * GRAVITY * SIN_THETA;
  const nextSpeed = speed + accel * dt;
  const travelled = speed * dt + 0.5 * accel * dt * dt;
  const contactX = rampContactX(current) + travelled * DOWNHILL.x;

  if (contactX >= SCENE.rampBottom.x) {
    // Round the foot of the ramp onto the table, keeping the speed.
    return ball('table', SCENE.rampBottom.x + SCENE.radius * RAMP_NORMAL.x, SCENE.tableTop - SCENE.radius, nextSpeed);
  }
  if (contactX <= SCENE.rampTop.x) {
    // Rolled back up and over the top: airborne from there.
    return ball('air', current.x, current.y, nextSpeed * DOWNHILL.x, nextSpeed * DOWNHILL.y);
  }
  return onRamp(contactX, nextSpeed);
};

const stepTable = (current: Ball, dt: number): Ball => {
  const vx = roll(current, TABLE_ROLLING_RESISTANCE, dt);
  const x = current.x + vx * dt;

  if (x > SCENE.edge) return ball('air', x, current.y, vx, 0);
  if (x < SCENE.rampBottom.x) return onRamp(SCENE.rampBottom.x - 0.5, -Math.abs(vx));
  if (Math.abs(vx) < REST_SPEED) return ball('rest', x, current.y);
  return { ...current, x, vx };
};

const stepFloor = (current: Ball, dt: number): Ball => {
  const vx = roll(current, FLOOR_ROLLING_RESISTANCE, dt);
  const x = current.x + vx * dt;
  if (x < -SCENE.radius || x > SCENE.width + SCENE.radius) return ball('gone', x, current.y);
  if (Math.abs(vx) < REST_SPEED) return ball('rest', x, current.y);
  return { ...current, x, vx };
};

/** Largest single physics step; longer frames are split into these. */
export const MAX_STEP = 1 / 480;

/** Advances the ball by `dt` seconds. Balls that are not moving are returned as-is. */
export const stepBall = (current: Ball, dt: number): Ball => {
  let state = current;
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(MAX_STEP, remaining);
    remaining -= h;
    switch (state.mode) {
      case 'air':
        state = stepAir(state, h);
        break;
      case 'ramp':
        state = stepRamp(state, h);
        break;
      case 'table':
        state = stepTable(state, h);
        break;
      case 'floor':
        state = stepFloor(state, h);
        break;
      default:
        return state;
    }
  }
  return state;
};

export const isMoving = (current: Ball): boolean =>
  current.mode === 'air' ||
  current.mode === 'ramp' ||
  current.mode === 'table' ||
  current.mode === 'floor';

/** True while the ball is inside a gate's frame, cutting its beam. */
export const blocksGate = (current: Ball, gateX: number): boolean =>
  current.mode !== 'gone' &&
  Math.abs(current.x - gateX) <= SCENE.radius &&
  current.y <= SCENE.tableTop &&
  current.y >= SCENE.tableTop - SCENE.gateHeight;
