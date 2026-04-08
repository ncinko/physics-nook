import { Children, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface MovingPoint { x: number; y: number; vx: number; vy: number; }
interface SpinningBody extends MovingPoint { angle: number; spin: number; }
interface TreeApple extends SpinningBody { id: string; homeX: number; homeY: number; status: 'attached' | 'falling'; }
interface BranchSeg { x1: number; y1: number; x2: number; y2: number; width: number; tone: 'base' | 'shadow'; }
interface LeafSprite { x: number; y: number; length: number; width: number; rotate: number; color: string; layer: 'back' | 'front'; }
interface AppleSlotMeta { id: string; x: number; y: number; attachX: number; attachY: number; tilt: number; scaleX: number; scaleY: number; }
type DragTarget = 'swing' | 'treeApple' | 'cabApple' | 'slider' | 'pendulum' | null;
interface DragState { active: boolean; pointerId: number | null; target: DragTarget; appleId: string | null; lastPoint: { x: number; y: number }; lastAt: number; }

const STAGE = { width: 760, height: 356 };
const LEFT = { x: 20, y: 12, width: 348, height: 320 };
const RIGHT = { x: 392, y: 12, width: 348, height: 320 };
const GROUND_Y = LEFT.y + LEFT.height - 28;
const TREE = { trunkX: LEFT.x + 114, trunkY: LEFT.y + 110, trunkW: 34, trunkH: GROUND_Y - (LEFT.y + 110) };
const SWING_ANCHOR = { x: LEFT.x + 242, y: LEFT.y + 94 };
const SWING_LENGTH = 118;
const SWING_RADIUS = 18;
const SWING_BENCH = { width: 36, height: 10 };
const APPLE_RADIUS = 10;
const MAX_APPLE_SPIN = 540;
const MAX_SWING_SURFACE_VX = 210;
const MAX_SWING_SURFACE_VY = 115;
const PHYSICS_SCALE = 23;
const EARTH_G = 9.8;
const ACCEL_LIMIT = 9.8;
const ZERO_SNAP = 0.9;
const START_ACCEL_Y = -9.8;
const CABIN = { x: RIGHT.x + 78, y: RIGHT.y + 18, width: 212, height: 284 };
const INTERIOR = { x: CABIN.x + 16, y: CABIN.y + 16, width: CABIN.width - 32, height: CABIN.height - 32 };
const SLIDER = { x: CABIN.x + CABIN.width + 28, y: CABIN.y + 26, height: CABIN.height - 52, thumbR: 10, hitW: 40 };
const CAB_APPLE_HOME = { x: INTERIOR.x + 38, y: INTERIOR.y + 40 };
const CAB_PENDULUM_LENGTH = 94;
const CAB_PENDULUM_REST = { x: INTERIOR.x + INTERIOR.width * 0.5, y: INTERIOR.y + INTERIOR.height * 0.5 };
const CAB_PENDULUM_ANCHOR = { x: CAB_PENDULUM_REST.x, y: CAB_PENDULUM_REST.y - CAB_PENDULUM_LENGTH };
const CAB_PENDULUM_RADIUS = 12;
const PENDULUM_UNSTABLE_ALIGNMENT = -0.965;
const PENDULUM_NUDGE_OFFSET = 3.2;
const PENDULUM_NUDGE_SPEED = 0.9;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const NIGHT_STARS = (() => {
  const rand = mulberry32(90317);
  return Array.from({ length: 42 }, (_, index) => ({
    id: `star-${index}`,
    x: LEFT.x + 18 + rand() * (LEFT.width - 36),
    y: LEFT.y + 18 + rand() * 136,
    r: 0.65 + rand() * 1.55,
    alpha: 0.34 + rand() * 0.5,
    twinkle: 0.7 + rand() * 1.7,
    phase: rand() * Math.PI * 2,
  }));
})();

const SHOOTING_STARS = [
  { id: 'shoot-1', period: 13.5, duration: 1.15, offset: 2.1, startX: LEFT.x + 56, startY: LEFT.y + 38, dx: 86, dy: 44 },
  { id: 'shoot-2', period: 18.2, duration: 1.35, offset: 9.4, startX: LEFT.x + 196, startY: LEFT.y + 30, dx: 102, dy: 52 },
];
const MOON = {
  x: LEFT.x + LEFT.width - 74,
  y: LEFT.y + 44,
  r: 16,
  cutX: LEFT.x + LEFT.width - 80,
  cutY: LEFT.y + 40,
  cutR: 16,
};

const buildTreeArt = () => {
  const rand = mulberry32(21043);
  const branches: BranchSeg[] = [];
  const leaves: LeafSprite[] = [];
  const terminalTips: Array<{ x: number; y: number; width: number; angle: number }> = [];
  const foliageTips: Array<{ x: number; y: number; width: number; angle: number }> = [];
  const trunkCenterX = TREE.trunkX + TREE.trunkW * 0.52;
  const trunkTopY = TREE.trunkY + 14;

  const branch = (x: number, y: number, length: number, angle: number, width: number, depth: number) => {
    const bend = (rand() - 0.5) * 0.2;
    const x2 = x + Math.cos(angle + bend) * length;
    const y2 = y + Math.sin(angle + bend) * length;
    const segmentAngle = Math.atan2(y2 - y, x2 - x);
    branches.push({ x1: x, y1: y, x2, y2, width, tone: depth <= 1 ? 'shadow' : 'base' });

    if (depth === 0 || length < 16) {
      terminalTips.push({ x: x2, y: y2, width, angle: segmentAngle });
      foliageTips.push({ x: x2, y: y2, width, angle: segmentAngle });
      return;
    }

    const childCount = depth > 2 ? 2 + (rand() > 0.68 ? 1 : 0) : 2;
    for (let index = 0; index < childCount; index += 1) {
      const baseOffsets = childCount === 3 ? [-0.78, -0.06, 0.74] : [-0.58, 0.56];
      const offset = baseOffsets[index] + (rand() - 0.5) * 0.22;
      branch(
        x2,
        y2,
        length * (0.66 + rand() * 0.08),
        angle + offset,
        Math.max(2.1, width * (0.72 + rand() * 0.06)),
        depth - 1,
      );
    }
  };

  branch(trunkCenterX - 2, trunkTopY + 34, 64, -2.22, 10.5, 3);
  branch(trunkCenterX, trunkTopY + 24, 78, -1.78, 12.5, 4);
  branch(trunkCenterX + 2, trunkTopY + 20, 92, -1.28, 13, 4);
  branch(trunkCenterX + 3, trunkTopY + 38, 62, -0.94, 9.8, 3);
  branch(trunkCenterX - 4, trunkTopY + 52, 54, -2.42, 8.8, 2);

  const supportPoints = [
    { x1: trunkCenterX + 4, y1: LEFT.y + 146, x2: LEFT.x + 196, y2: LEFT.y + 118, width: 9.5, tone: 'base' as const },
    { x1: LEFT.x + 196, y1: LEFT.y + 118, x2: LEFT.x + 238, y2: LEFT.y + 96, width: 7.6, tone: 'base' as const },
    { x1: LEFT.x + 238, y1: LEFT.y + 96, x2: SWING_ANCHOR.x, y2: SWING_ANCHOR.y, width: 6.2, tone: 'shadow' as const },
  ];
  branches.push(...supportPoints);
  const viewerBranches = [
    { x1: trunkCenterX - 4, y1: trunkTopY + 34, x2: trunkCenterX - 7, y2: trunkTopY + 12, width: 7.2, tone: 'shadow' as const },
    { x1: trunkCenterX + 3, y1: trunkTopY + 38, x2: trunkCenterX + 1, y2: trunkTopY + 14, width: 6.5, tone: 'shadow' as const },
    { x1: trunkCenterX - 8, y1: trunkTopY + 46, x2: trunkCenterX - 12, y2: trunkTopY + 24, width: 5.7, tone: 'base' as const },
    { x1: trunkCenterX + 9, y1: trunkTopY + 50, x2: trunkCenterX + 6, y2: trunkTopY + 28, width: 5.5, tone: 'base' as const },
  ];
  branches.push(...viewerBranches);
  foliageTips.push(
    { x: LEFT.x + 184, y: LEFT.y + 122, width: 4.4, angle: -0.44 },
    { x: LEFT.x + 214, y: LEFT.y + 106, width: 4.2, angle: -0.48 },
    { x: LEFT.x + 252, y: LEFT.y + 92, width: 4, angle: -0.38 },
    { x: LEFT.x + 166, y: LEFT.y + 144, width: 4.6, angle: -0.2 },
    { x: LEFT.x + 222, y: LEFT.y + 140, width: 4.2, angle: 0.08 },
    { x: trunkCenterX - 7, y: trunkTopY + 12, width: 4.8, angle: -1.56 },
    { x: trunkCenterX + 1, y: trunkTopY + 14, width: 4.8, angle: -1.48 },
    { x: trunkCenterX - 12, y: trunkTopY + 24, width: 4.4, angle: -1.72 },
    { x: trunkCenterX + 6, y: trunkTopY + 28, width: 4.4, angle: -1.38 },
  );

  const leafColors = ['#16a34a', '#22c55e', '#4ade80', '#15803d', '#65a30d'];
  const pushLeaf = (
    x: number,
    y: number,
    rotate: number,
    length: number,
    width: number,
    layer: 'back' | 'front',
  ) => {
    leaves.push({
      x,
      y,
      length,
      width,
      rotate,
      color: leafColors[Math.floor(rand() * leafColors.length)],
      layer,
    });
  };

  for (const tip of foliageTips) {
    const dirX = Math.cos(tip.angle);
    const dirY = Math.sin(tip.angle);
    const perpX = -dirY;
    const perpY = dirX;
    const clusterCount = 3 + Math.floor(rand() * 3);
    for (let index = 0; index < clusterCount; index += 1) {
      const retreat = -1 + rand() * 14;
      const side = (rand() - 0.5) * (11 + rand() * 5);
      const lift = (rand() - 0.45) * 5;
      const rotate = (tip.angle * 180) / Math.PI + (rand() - 0.5) * 42 + Math.sign(side || (rand() - 0.5)) * 8;
      pushLeaf(
        tip.x - dirX * retreat + perpX * side - dirY * lift,
        tip.y - dirY * retreat + perpY * side + dirX * lift,
        rotate,
        11 + rand() * 7,
        3.8 + rand() * 2.2,
        rand() > 0.38 ? 'front' : 'back',
      );
    }

    const depthLeafCount = 2 + Math.floor(rand() * 2);
    for (let index = 0; index < depthLeafCount; index += 1) {
      const retreat = -2 + rand() * 11;
      const side = (rand() - 0.5) * (15 + rand() * 9);
      const viewerLift = 3 + rand() * 15;
      const forwardBulge = 3 + rand() * 8;
      const depthSwing = (rand() - 0.5) * 6;
      const rotate = (tip.angle * 180) / Math.PI + (rand() - 0.5) * 56 + Math.sign(side || (rand() - 0.5)) * 12;
      pushLeaf(
        tip.x - dirX * retreat + perpX * side + dirY * forwardBulge - dirY * depthSwing,
        tip.y - dirY * retreat + perpY * side - viewerLift + dirX * depthSwing,
        rotate,
        12.5 + rand() * 8,
        4.2 + rand() * 2.8,
        'front',
      );
    }
  }

  const sortedTips = [...terminalTips].sort((a, b) => a.x - b.x);
  const buckets = [
    sortedTips.slice(0, Math.max(1, Math.floor(sortedTips.length / 3))),
    sortedTips.slice(Math.max(1, Math.floor(sortedTips.length / 3)), Math.max(2, Math.floor((sortedTips.length * 2) / 3))),
    sortedTips.slice(Math.max(2, Math.floor((sortedTips.length * 2) / 3))),
  ];
  const selectedTips = buckets.map((bucket, index) => {
    const fallback = sortedTips[clamp(Math.floor(((index + 0.5) / 3) * sortedTips.length), 0, Math.max(0, sortedTips.length - 1))];
    return [...bucket].sort((a, b) => b.y - a.y || a.x - b.x)[0] ?? fallback;
  });
  const appleSlots: AppleSlotMeta[] = selectedTips.map((tip, index) => {
    return {
      id: `apple-${index + 1}`,
      attachX: tip.x,
      attachY: tip.y,
      x: tip.x + Math.cos(tip.angle) * 1.4 + (rand() - 0.5) * 2.2,
      y: tip.y + 12 + rand() * 3.5,
      tilt: -10 + rand() * 20,
      scaleX: 0.95 + rand() * 0.12,
      scaleY: 0.96 + rand() * 0.1,
    };
  });

  return { branches, leaves, appleSlots };
};

const TREE_ART = buildTreeArt();
const APPLE_SLOTS = TREE_ART.appleSlots;
const APPLE_VARIANTS = Object.fromEntries(APPLE_SLOTS.map((slot) => [slot.id, slot])) as Record<string, AppleSlotMeta>;
const CAB_APPLE_VARIANT = { tilt: -6, scaleX: 0.98, scaleY: 1.02 };
const CLOUDS = [
  { x: LEFT.x + 54, y: LEFT.y + 62, scale: 1.02, speed: 0.55 },
  { x: LEFT.x + 176, y: LEFT.y + 44, scale: 0.88, speed: 0.34 },
  { x: LEFT.x + 286, y: LEFT.y + 58, scale: 1.12, speed: 0.48 },
];

const emptyDrag = (): DragState => ({ active: false, pointerId: null, target: null, appleId: null, lastPoint: { x: 0, y: 0 }, lastAt: 0 });
const makeTreeApples = (): TreeApple[] => APPLE_SLOTS.map((slot) => ({ id: slot.id, homeX: slot.x, homeY: slot.y, x: slot.x, y: slot.y, vx: 0, vy: 0, angle: 0, spin: 0, status: 'attached' }));
const norm = (x: number, y: number) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m, m }; };
const sceneVelocity = (body: MovingPoint) => ({ x: body.vx * PHYSICS_SCALE, y: body.vy * PHYSICS_SCALE });
const dragVelocity = (delta: number, elapsed: number, maxPxPerSec: number) => clamp(delta / Math.max(elapsed, 0.001), -maxPxPerSec, maxPxPerSec) / PHYSICS_SCALE;
const DEG_PER_RAD = 180 / Math.PI;
const wrapAngle = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
const swingPoint = (point: { x: number; y: number }) => { const dx = point.x - SWING_ANCHOR.x; const dy = point.y - SWING_ANCHOR.y; const m = Math.hypot(dx, dy) || 1; const s = SWING_LENGTH / m; return { x: SWING_ANCHOR.x + dx * s, y: SWING_ANCHOR.y + dy * s }; };
const constrainSwing = (seat: MovingPoint) => { const p = swingPoint(seat); const r = norm(p.x - SWING_ANCHOR.x, p.y - SWING_ANCHOR.y); const t = { x: -r.y, y: r.x }; const speed = seat.vx * t.x + seat.vy * t.y; seat.x = p.x; seat.y = p.y; seat.vx = t.x * speed; seat.vy = t.y * speed; };
const cabPendulumPoint = (point: { x: number; y: number }) => {
  const dx = point.x - CAB_PENDULUM_ANCHOR.x;
  const dy = point.y - CAB_PENDULUM_ANCHOR.y;
  const m = Math.hypot(dx, dy) || 1;
  const s = CAB_PENDULUM_LENGTH / m;
  return { x: CAB_PENDULUM_ANCHOR.x + dx * s, y: CAB_PENDULUM_ANCHOR.y + dy * s };
};
const constrainCabPendulum = (bob: MovingPoint) => {
  const p = cabPendulumPoint(bob);
  const r = norm(p.x - CAB_PENDULUM_ANCHOR.x, p.y - CAB_PENDULUM_ANCHOR.y);
  const t = { x: -r.y, y: r.x };
  const speed = bob.vx * t.x + bob.vy * t.y;
  bob.x = p.x;
  bob.y = p.y;
  bob.vx = t.x * speed;
  bob.vy = t.y * speed;
};
const clampTreeApple = (p: { x: number; y: number }) => ({ x: clamp(p.x, LEFT.x + APPLE_RADIUS, LEFT.x + LEFT.width - APPLE_RADIUS), y: clamp(p.y, LEFT.y + APPLE_RADIUS, GROUND_Y - APPLE_RADIUS) });
const clampCabApple = (p: { x: number; y: number }) => ({ x: clamp(p.x, INTERIOR.x + APPLE_RADIUS, INTERIOR.x + INTERIOR.width - APPLE_RADIUS), y: clamp(p.y, INTERIOR.y + APPLE_RADIUS, INTERIOR.y + INTERIOR.height - APPLE_RADIUS) });
const snapAccel = (v: number) => { const c = clamp(v, -ACCEL_LIMIT, ACCEL_LIMIT); return Math.abs(c) < ZERO_SNAP ? 0 : c; };
const sliderAccel = (y: number) => snapAccel((((clamp((y - SLIDER.y) / SLIDER.height, 0, 1) * 2) - 1) * ACCEL_LIMIT));
const sliderY = (v: number) => SLIDER.y + ((clamp(v, -ACCEL_LIMIT, ACCEL_LIMIT) / ACCEL_LIMIT + 1) * 0.5) * SLIDER.height;
const onSlider = (p: { x: number; y: number }) => Math.abs(p.x - SLIDER.x) <= SLIDER.hitW / 2 && p.y >= SLIDER.y - 12 && p.y <= SLIDER.y + SLIDER.height + 12;
const apparentField = (accelY: number) => ({ x: 0, y: -accelY });
const nudgeCabPendulumFromUnstable = (bob: MovingPoint, field: { x: number; y: number }, preferredBias: number) => {
  const fieldMag = Math.hypot(field.x, field.y);
  if (fieldMag < 1e-4) return preferredBias;
  const fieldDir = { x: field.x / fieldMag, y: field.y / fieldMag };
  const radial = norm(bob.x - CAB_PENDULUM_ANCHOR.x, bob.y - CAB_PENDULUM_ANCHOR.y);
  const tangent = { x: -radial.y, y: radial.x };
  const alignment = radial.x * fieldDir.x + radial.y * fieldDir.y;
  const tangentialSpeed = bob.vx * tangent.x + bob.vy * tangent.y;
  if (alignment > PENDULUM_UNSTABLE_ALIGNMENT || Math.abs(tangentialSpeed) > 0.16) return preferredBias;
  const lean = bob.x - CAB_PENDULUM_ANCHOR.x;
  const bias = Math.abs(lean) > 0.35 ? Math.sign(lean) : preferredBias;
  bob.x += tangent.x * PENDULUM_NUDGE_OFFSET * bias;
  bob.y += tangent.y * PENDULUM_NUDGE_OFFSET * bias;
  bob.vx += tangent.x * PENDULUM_NUDGE_SPEED * bias;
  bob.vy += tangent.y * PENDULUM_NUDGE_SPEED * bias;
  constrainCabPendulum(bob);
  return -bias;
};

const nudgeAppleSpin = (apple: SpinningBody, delta: number) => {
  apple.spin = clamp(apple.spin + delta, -MAX_APPLE_SPIN, MAX_APPLE_SPIN);
};

const advanceAppleRotation = (apple: SpinningBody, dt: number) => {
  apple.spin *= Math.max(0, 1 - dt * 0.48);
  apple.angle = wrapAngle(apple.angle + apple.spin * dt);
};

const rollingSpinTarget = (apple: SpinningBody, relativeSurfaceVX: number) => {
  const angleRad = (apple.angle * Math.PI) / 180;
  const effectiveRadius = APPLE_RADIUS * (0.84 + 0.1 * Math.cos(angleRad * 2 - 0.45));
  return clamp((relativeSurfaceVX / effectiveRadius) * DEG_PER_RAD, -MAX_APPLE_SPIN, MAX_APPLE_SPIN);
};

const coupleAppleToSurface = (apple: SpinningBody, surfaceVX: number, dt: number, grip: number, settle = false) => {
  const relVX = apple.vx - surfaceVX;
  const gripStep = clamp(dt * grip, 0, 1);
  const targetSpin = rollingSpinTarget(apple, relVX);
  apple.spin += (targetSpin - apple.spin) * gripStep;
  apple.vx -= relVX * gripStep * 0.36;
  if (settle && Math.abs(relVX) < 5 && Math.abs(apple.vy) < 8) {
    apple.spin *= Math.max(0, 1 - dt * 5.2);
    apple.angle = wrapAngle(apple.angle + wrapAngle(-apple.angle) * Math.min(1, dt * 2.8));
  }
};

const swingBenchRect = (swing: MovingPoint) => ({
  left: swing.x - SWING_BENCH.width / 2,
  right: swing.x + SWING_BENCH.width / 2,
  top: swing.y,
  bottom: swing.y + SWING_BENCH.height,
});

const collideAppleCircle = (
  apple: SpinningBody,
  circle: MovingPoint,
  circleRadius: number,
  circleMass: number,
  restitution: number,
  clampApple: (point: { x: number; y: number }) => { x: number; y: number },
  constrainCircle?: (point: MovingPoint) => void,
  circleVelocityScale = 1,
) => {
  const appleMass = 1;
  const appleInvMass = 1 / appleMass;
  const circleInvMass = 1 / circleMass;
  const circleVX = circle.vx * circleVelocityScale;
  const circleVY = circle.vy * circleVelocityScale;
  let dx = apple.x - circle.x;
  let dy = apple.y - circle.y;
  let d = Math.hypot(dx, dy);
  const minD = APPLE_RADIUS + circleRadius - 3;
  if (d >= minD) return;
  if (d < 1e-5) { dx = 0; dy = -1; d = 1; }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = minD - d;
  const totalInvMass = appleInvMass + circleInvMass;
  apple.x += nx * overlap * (appleInvMass / totalInvMass);
  apple.y += ny * overlap * (appleInvMass / totalInvMass);
  circle.x -= nx * overlap * (circleInvMass / totalInvMass);
  circle.y -= ny * overlap * (circleInvMass / totalInvMass);
  const rel = (apple.vx - circleVX) * nx + (apple.vy - circleVY) * ny;
  if (rel < 0) {
    const impulse = -((1 + restitution) * rel) / totalInvMass;
    apple.vx += impulse * appleInvMass * nx;
    apple.vy += impulse * appleInvMass * ny;
    circle.vx -= (impulse * circleInvMass * nx) / circleVelocityScale;
    circle.vy -= (impulse * circleInvMass * ny) / circleVelocityScale;
  }
  const tx = -ny;
  const ty = nx;
  const tangential = (apple.vx - circleVX) * tx + (apple.vy - circleVY) * ty;
  nudgeAppleSpin(apple, tangential * 0.9);
  const c = clampApple(apple);
  apple.x = c.x;
  apple.y = c.y;
  constrainCircle?.(circle);
};

const collideAppleSwingBench = (apple: SpinningBody, swing: MovingPoint, dt: number) => {
  const bench = swingBenchRect(swing);
  const rawSwingSurface = sceneVelocity(swing);
  const swingSurface = {
    x: clamp(rawSwingSurface.x, -MAX_SWING_SURFACE_VX, MAX_SWING_SURFACE_VX),
    y: clamp(rawSwingSurface.y, -MAX_SWING_SURFACE_VY, MAX_SWING_SURFACE_VY),
  };
  const topSupport =
    apple.x >= bench.left - APPLE_RADIUS * 0.38 &&
    apple.x <= bench.right + APPLE_RADIUS * 0.38 &&
    apple.y + APPLE_RADIUS >= bench.top - 1.25 &&
    apple.y <= bench.top + SWING_BENCH.height &&
    apple.vy >= swingSurface.y - 22;

  if (topSupport && apple.y <= bench.top + APPLE_RADIUS * 0.3) {
    apple.y = bench.top - APPLE_RADIUS;
    const relDown = apple.vy - swingSurface.y;
    if (relDown > 0) {
      apple.vy = swingSurface.y - relDown * 0.14;
      swing.vy += (relDown * 0.01) / PHYSICS_SCALE;
    }
    const slip = apple.vx - swingSurface.x;
    apple.vx -= slip * clamp(dt * 6.2, 0, 0.34);
    swing.vx += (slip * 0.028) / PHYSICS_SCALE;
    coupleAppleToSurface(apple, swingSurface.x, dt, 8, true);
    nudgeAppleSpin(apple, slip * 0.42);
    constrainSwing(swing);
    return true;
  }

  const closestX = clamp(apple.x, bench.left, bench.right);
  const closestY = clamp(apple.y, bench.top, bench.bottom);
  let dx = apple.x - closestX;
  let dy = apple.y - closestY;
  let dist = Math.hypot(dx, dy);
  if (dist >= APPLE_RADIUS) return false;

  let nx = 0;
  let ny = 0;
  if (dist < 1e-5) {
    const distances = [
      { nx: 0, ny: -1, depth: Math.abs(apple.y - bench.top) },
      { nx: 0, ny: 1, depth: Math.abs(bench.bottom - apple.y) },
      { nx: -1, ny: 0, depth: Math.abs(apple.x - bench.left) },
      { nx: 1, ny: 0, depth: Math.abs(bench.right - apple.x) },
    ].sort((a, b) => a.depth - b.depth)[0];
    nx = distances.nx;
    ny = distances.ny;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  const overlap = APPLE_RADIUS - dist;
  apple.x += nx * overlap;
  apple.y += ny * overlap;

  const appleInvMass = 1;
  const swingInvMass = 1 / 4;
  const totalInvMass = appleInvMass + swingInvMass;
  const rel = (apple.vx - swingSurface.x) * nx + (apple.vy - swingSurface.y) * ny;
  if (rel < 0) {
    const restitution = Math.abs(ny) > 0.75 ? 0.05 : 0.12;
    const impulse = -((1 + restitution) * rel) / totalInvMass;
    apple.vx += impulse * appleInvMass * nx;
    apple.vy += impulse * appleInvMass * ny;
    swing.vx -= (impulse * swingInvMass * nx) / PHYSICS_SCALE;
    swing.vy -= (impulse * swingInvMass * ny) / PHYSICS_SCALE;
  }

  const tx = -ny;
  const ty = nx;
  const tangential = (apple.vx - swingSurface.x) * tx + (apple.vy - swingSurface.y) * ty;
  const friction = Math.abs(ny) > 0.75 ? 0.18 : 0.08;
  apple.vx -= tangential * tx * friction;
  apple.vy -= tangential * ty * friction;
  swing.vx += (tangential * tx * friction * 0.25) / PHYSICS_SCALE;
  swing.vy += (tangential * ty * friction * 0.25) / PHYSICS_SCALE;
  nudgeAppleSpin(apple, tangential * (Math.abs(ny) > 0.75 ? 1.2 : 0.7));
  constrainSwing(swing);
  return ny < -0.75;
};

const collideApplePendulum = (apple: SpinningBody, bob: MovingPoint) => collideAppleCircle(apple, bob, CAB_PENDULUM_RADIUS, 12, 0.16, clampCabApple, constrainCabPendulum, PHYSICS_SCALE);

export default function EquivalenceElevatorFieldSection({ children }: Props) {
  const [accelY, setAccelY] = useState(START_ACCEL_Y);
  const [darkMode, setDarkMode] = useState(false);
  const [, setFrame] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const accelRef = useRef(START_ACCEL_Y);
  const phaseRef = useRef(0);
  const cloudDriftRef = useRef(0);
  const swingRef = useRef<MovingPoint>({ x: SWING_ANCHOR.x, y: SWING_ANCHOR.y + SWING_LENGTH, vx: 0, vy: 0 });
  const treeApplesRef = useRef<TreeApple[]>(makeTreeApples());
  const cabAppleRef = useRef<SpinningBody>({ x: CAB_APPLE_HOME.x, y: CAB_APPLE_HOME.y, vx: 0, vy: 0, angle: 0, spin: 0 });
  const cabPendulumRef = useRef<MovingPoint>({ x: CAB_PENDULUM_REST.x, y: CAB_PENDULUM_REST.y, vx: 0, vy: 0 });
  const lastNonZeroAccelSignRef = useRef(Math.sign(START_ACCEL_Y) || -1);
  const pendulumNudgeBiasRef = useRef(1);
  const dragRef = useRef<DragState>(emptyDrag());

  const nodes = Children.toArray(children).filter((child) => !(typeof child === 'string' && child.trim().length === 0));
  const beforeFigure = nodes.slice(0, Math.min(2, nodes.length));
  const afterFigure = nodes.slice(Math.min(2, nodes.length));

  const setAcceleration = (value: number) => {
    const next = snapAccel(value);
    if (next !== 0) {
      const nextSign = Math.sign(next);
      if (nextSign !== lastNonZeroAccelSignRef.current) {
        pendulumNudgeBiasRef.current = nudgeCabPendulumFromUnstable(
          cabPendulumRef.current,
          apparentField(next),
          pendulumNudgeBiasRef.current,
        );
      }
      lastNonZeroAccelSignRef.current = nextSign;
    }
    accelRef.current = next;
    setAccelY(next);
  };
  const getPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * STAGE.width, y: ((event.clientY - rect.top) / rect.height) * STAGE.height };
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setDarkMode(root.getAttribute('data-theme') === 'dark');
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    let last: number | null = null;
    const tick = (time: number) => {
      const prev = last ?? time;
      const dt = clamp((time - prev) / 1000, 0.001, 0.024);
      last = time;
      const target = dragRef.current.active ? dragRef.current.target : null;
      const field = apparentField(accelRef.current);
      phaseRef.current = (phaseRef.current + dt * (2.2 + (Math.abs(accelRef.current) / ACCEL_LIMIT) * 3.4)) % (Math.PI * 2);
      cloudDriftRef.current = (cloudDriftRef.current + dt) % 1000;

      if (target !== 'swing') {
        const swing = swingRef.current;
        swing.vx += -0.38 * swing.vx * dt;
        swing.vy += (EARTH_G - 0.38 * swing.vy) * dt;
        swing.x += swing.vx * dt * PHYSICS_SCALE;
        swing.y += swing.vy * dt * PHYSICS_SCALE;
        constrainSwing(swing);
      }

      if (target !== 'pendulum') {
        const bob = cabPendulumRef.current;
        bob.vx += (field.x - 0.58 * bob.vx) * dt;
        bob.vy += (field.y - 0.58 * bob.vy) * dt;
        bob.x += bob.vx * dt * PHYSICS_SCALE;
        bob.y += bob.vy * dt * PHYSICS_SCALE;
        constrainCabPendulum(bob);
      }

      for (const apple of treeApplesRef.current) {
        if (apple.status === 'attached') {
          apple.x = apple.homeX; apple.y = apple.homeY; apple.vx = 0; apple.vy = 0; apple.angle = 0; apple.spin = 0; continue;
        }
        if (target === 'treeApple' && dragRef.current.appleId === apple.id) continue;
        apple.vx *= Math.max(0, 1 - dt * 0.035);
        apple.vy *= Math.max(0, 1 - dt * 0.035);
        apple.vy += EARTH_G * dt * PHYSICS_SCALE;
        apple.x += apple.vx * dt;
        apple.y += apple.vy * dt;
        const onBench = collideAppleSwingBench(apple, swingRef.current, dt);
        const l = LEFT.x + APPLE_RADIUS;
        const r = LEFT.x + LEFT.width - APPLE_RADIUS;
        const t = LEFT.y + APPLE_RADIUS;
        const b = GROUND_Y - APPLE_RADIUS;
        if (apple.x < l) {
          apple.x = l;
          apple.vx = Math.abs(apple.vx) < 0.5 ? 0 : Math.abs(apple.vx) * 0.58;
          nudgeAppleSpin(apple, -apple.vy * 0.4);
        } else if (apple.x > r) {
          apple.x = r;
          apple.vx = Math.abs(apple.vx) < 0.5 ? 0 : -Math.abs(apple.vx) * 0.58;
          nudgeAppleSpin(apple, apple.vy * 0.4);
        }
        if (apple.y < t) {
          apple.y = t;
          apple.vy = Math.abs(apple.vy) < 0.5 ? 0 : Math.abs(apple.vy) * 0.45;
          nudgeAppleSpin(apple, apple.vx * 0.6);
        }
        else if (apple.y > b) {
          apple.y = b;
          apple.vy = Math.abs(apple.vy) < 0.6 ? 0 : -Math.abs(apple.vy) * 0.28;
          apple.vx *= 0.92;
          nudgeAppleSpin(apple, apple.vx * 0.8);
          coupleAppleToSurface(apple, 0, dt, 10.2, true);
          if (Math.abs(apple.vy) < 0.6) { apple.vx = 0; apple.vy = 0; }
        }
        if (onBench) {
          const benchVX = clamp(sceneVelocity(swingRef.current).x, -MAX_SWING_SURFACE_VX, MAX_SWING_SURFACE_VX);
          coupleAppleToSurface(apple, benchVX, dt, 6.8, true);
        }
        advanceAppleRotation(apple, dt);
        if (Math.abs(apple.vx) < 0.01 && Math.abs(apple.vy) < 0.01 && Math.abs(apple.spin) < 2) apple.spin = 0;
      }

      if (target !== 'cabApple') {
        const apple = cabAppleRef.current;
        apple.vx *= Math.max(0, 1 - dt * 0.025);
        apple.vy *= Math.max(0, 1 - dt * 0.025);
        apple.vx += field.x * dt * PHYSICS_SCALE;
        apple.vy += field.y * dt * PHYSICS_SCALE;
        apple.x += apple.vx * dt;
        apple.y += apple.vy * dt;
        if (target !== 'pendulum') collideApplePendulum(apple, cabPendulumRef.current);
        const l = INTERIOR.x + APPLE_RADIUS;
        const r = INTERIOR.x + INTERIOR.width - APPLE_RADIUS;
        const t = INTERIOR.y + APPLE_RADIUS;
        const b = INTERIOR.y + INTERIOR.height - APPLE_RADIUS;
        if (apple.x < l) {
          apple.x = l;
          apple.vx = Math.abs(apple.vx) < 0.5 ? 0 : Math.abs(apple.vx) * 0.72;
          nudgeAppleSpin(apple, -apple.vy * 0.5);
        } else if (apple.x > r) {
          apple.x = r;
          apple.vx = Math.abs(apple.vx) < 0.5 ? 0 : -Math.abs(apple.vx) * 0.72;
          nudgeAppleSpin(apple, apple.vy * 0.5);
        }
        if (apple.y < t) {
          apple.y = t;
          apple.vy = Math.abs(apple.vy) < 0.5 ? 0 : Math.abs(apple.vy) * 0.72;
          nudgeAppleSpin(apple, apple.vx * 0.7);
        } else if (apple.y > b) {
          apple.y = b;
          apple.vy = Math.abs(apple.vy) < 0.5 ? 0 : -Math.abs(apple.vy) * 0.62;
          apple.vx *= 0.96;
          nudgeAppleSpin(apple, apple.vx * 0.9);
          coupleAppleToSurface(apple, 0, dt, 10.8, true);
        }
        advanceAppleRotation(apple, dt);
        if (Math.abs(apple.vx) < 0.01 && Math.abs(apple.vy) < 0.01 && Math.abs(field.y) < 0.12) {
          apple.vx = 0;
          apple.vy = 0;
          if (Math.abs(apple.spin) < 2) apple.spin = 0;
        }
      }

      setFrame((n) => n + 1);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => { if (frame !== null) window.cancelAnimationFrame(frame); };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const point = getPoint(event);
    const now = performance.now();
    if (onSlider(point)) {
      event.preventDefault();
      setAcceleration(sliderAccel(point.y));
      dragRef.current = { active: true, pointerId: event.pointerId, target: 'slider', appleId: null, lastPoint: point, lastAt: now };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    for (const apple of treeApplesRef.current) {
      if (Math.hypot(point.x - apple.x, point.y - apple.y) <= APPLE_RADIUS + 8) {
        event.preventDefault();
        apple.status = 'falling';
        apple.x = point.x;
        apple.y = point.y;
        apple.vx = 0;
        apple.vy = 0;
        apple.spin = 0;
        dragRef.current = { active: true, pointerId: event.pointerId, target: 'treeApple', appleId: apple.id, lastPoint: point, lastAt: now };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (Math.hypot(point.x - swingRef.current.x, point.y - swingRef.current.y) <= SWING_RADIUS + 10) {
      event.preventDefault();
      dragRef.current = { active: true, pointerId: event.pointerId, target: 'swing', appleId: null, lastPoint: point, lastAt: now };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (Math.hypot(point.x - cabPendulumRef.current.x, point.y - cabPendulumRef.current.y) <= CAB_PENDULUM_RADIUS + 8) {
      event.preventDefault();
      dragRef.current = { active: true, pointerId: event.pointerId, target: 'pendulum', appleId: null, lastPoint: point, lastAt: now };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (Math.hypot(point.x - cabAppleRef.current.x, point.y - cabAppleRef.current.y) <= APPLE_RADIUS + 8) {
      event.preventDefault();
      cabAppleRef.current.spin = 0;
      dragRef.current = { active: true, pointerId: event.pointerId, target: 'cabApple', appleId: null, lastPoint: point, lastAt: now };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || !dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = getPoint(event);
    const elapsed = Math.max((performance.now() - dragRef.current.lastAt) / 1000, 0.001);
    if (dragRef.current.target === 'slider') setAcceleration(sliderAccel(point.y));
    if (dragRef.current.target === 'swing') {
      const seat = swingRef.current;
      const next = swingPoint(point);
      seat.vx = dragVelocity(next.x - dragRef.current.lastPoint.x, elapsed, MAX_SWING_SURFACE_VX);
      seat.vy = dragVelocity(next.y - dragRef.current.lastPoint.y, elapsed, MAX_SWING_SURFACE_VY);
      seat.x = next.x; seat.y = next.y;
    }
    if (dragRef.current.target === 'pendulum') {
      const bob = cabPendulumRef.current;
      const next = cabPendulumPoint(point);
      bob.vx = ((next.x - dragRef.current.lastPoint.x) / elapsed) * 0.055;
      bob.vy = ((next.y - dragRef.current.lastPoint.y) / elapsed) * 0.055;
      bob.x = next.x; bob.y = next.y;
    }
    if (dragRef.current.target === 'treeApple') {
      const apple = treeApplesRef.current.find((item) => item.id === dragRef.current.appleId);
      if (apple) {
        const next = clampTreeApple(point);
        apple.x = next.x; apple.y = next.y;
        apple.vx = ((next.x - dragRef.current.lastPoint.x) / elapsed) * 0.055;
        apple.vy = ((next.y - dragRef.current.lastPoint.y) / elapsed) * 0.055;
        apple.spin = clamp((apple.vx * 2.4), -MAX_APPLE_SPIN, MAX_APPLE_SPIN);
        apple.angle = wrapAngle(apple.angle + apple.spin * elapsed * 0.4);
      }
    }
    if (dragRef.current.target === 'cabApple') {
      const next = clampCabApple(point);
      cabAppleRef.current.x = next.x; cabAppleRef.current.y = next.y;
      cabAppleRef.current.vx = ((next.x - dragRef.current.lastPoint.x) / elapsed) * 0.055;
      cabAppleRef.current.vy = ((next.y - dragRef.current.lastPoint.y) / elapsed) * 0.055;
      cabAppleRef.current.spin = clamp((cabAppleRef.current.vx * 2.4), -MAX_APPLE_SPIN, MAX_APPLE_SPIN);
      cabAppleRef.current.angle = wrapAngle(cabAppleRef.current.angle + cabAppleRef.current.spin * elapsed * 0.4);
    }
    dragRef.current = { ...dragRef.current, lastPoint: point, lastAt: performance.now() };
  };

  const finishPointer = (pointerId: number, element: SVGSVGElement | null) => {
    if (dragRef.current.pointerId !== pointerId) return;
    if (dragRef.current.target === 'slider') setAcceleration(accelRef.current);
    dragRef.current = emptyDrag();
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => finishPointer(event.pointerId, svgRef.current);
  const sY = sliderY(accelY);
  const zeroY = sliderY(0);
  const ratio = accelY / ACCEL_LIMIT;
  const dir = ratio === 0 ? 0 : ratio < 0 ? -1 : 1;
  const strength = Math.abs(ratio);
  const pulse = Math.sin(phaseRef.current) * 3.5 * strength;
  const arrowX = CABIN.x + CABIN.width + 58;
  const arrowCy = CABIN.y + CABIN.height / 2 + pulse * dir;
  const arrowTip = arrowCy + dir * 22;
  const arrowTail = arrowCy - dir * 15;
  const arrowColor = dir === -1 ? 'rgba(14,165,233,0.92)' : 'rgba(248,113,113,0.92)';
  const trail = ((phaseRef.current / (Math.PI * 2)) % 1) * 9;
  const cloudDrift = cloudDriftRef.current;
  const skyTime = cloudDriftRef.current;
  const cabPendulum = cabPendulumRef.current;

  const cloudX = (baseX: number, speed: number) => {
    const span = LEFT.width + 120;
    const shifted = ((baseX - LEFT.x + cloudDrift * speed * 6) % span + span) % span;
    return LEFT.x - 60 + shifted;
  };

  const shootingStars = darkMode ? SHOOTING_STARS.map((star) => {
    const local = (skyTime + star.offset) % star.period;
    if (local > star.duration) return null;
    const progress = local / star.duration;
    const x = star.startX + star.dx * progress;
    const y = star.startY + star.dy * progress;
    const length = 8 + (1 - progress) * 12;
    const mag = Math.hypot(star.dx, star.dy) || 1;
    const ux = star.dx / mag;
    const uy = star.dy / mag;
    const opacity = Math.sin(progress * Math.PI) * 0.78;
    return {
      ...star,
      x,
      y,
      ux,
      uy,
      opacity,
      headLength: length * 0.46,
      fadeLength: length,
    };
  }).filter((star): star is NonNullable<typeof star> => star !== null) : [];

  const leafSvg = (leaf: LeafSprite, key: string) => (
    <path
      key={key}
      d={`M ${leaf.x} ${leaf.y - leaf.width}
          A ${leaf.width} ${leaf.width} 0 0 0 ${leaf.x} ${leaf.y + leaf.width}
          Q ${leaf.x + leaf.length * 0.58} ${leaf.y + leaf.width * 0.95}, ${leaf.x + leaf.length} ${leaf.y}
          Q ${leaf.x + leaf.length * 0.58} ${leaf.y - leaf.width * 0.95}, ${leaf.x} ${leaf.y - leaf.width} Z`}
      fill={leaf.color}
      transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
    />
  );

  const appleSvg = (
    x: number,
    y: number,
    key: string,
    opacity = 1,
    rotation = 0,
    variant?: Partial<Pick<AppleSlotMeta, 'tilt' | 'scaleX' | 'scaleY'>>,
  ) => {
    const tilt = variant?.tilt ?? 0;
    const scaleX = variant?.scaleX ?? 1;
    const scaleY = variant?.scaleY ?? 1;

    return (
      <g key={key} opacity={opacity} style={{ cursor: 'grab' }} transform={`translate(${x} ${y}) rotate(${tilt + rotation}) scale(${scaleX} ${scaleY})`}>
        <path
          d="M 0 -9
             C -5.8 -12.4, -11.2 -7.2, -10.4 0.8
             C -9.6 9.4, -3.4 12.8, 0 11.4
             C 3.4 12.8, 9.6 9.4, 10.4 0.8
             C 11.2 -7.2, 5.8 -12.4, 0 -9 Z"
          fill="rgba(239,68,68,0.97)"
        />
        <path
          d="M -2.2 -8.4 C -1 -5.8, 1 -5.8, 2.2 -8.4"
          fill="none"
          stroke="rgba(190,24,93,0.38)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <ellipse cx="-3.4" cy="-3.1" rx="2.8" ry="1.9" fill="rgba(255,255,255,0.2)" transform="rotate(-24 -3.4 -3.1)" />
        <path d="M 0 -9 C 0.5 -15, 4.4 -17.2, 6.6 -12.6" fill="none" stroke="rgba(120,53,15,0.88)" strokeWidth="1.9" strokeLinecap="round" />
      </g>
    );
  };

  return (
    <section className="my-10">
      {beforeFigure}
      <div className="not-prose my-8">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
          className="block w-full select-none"
          style={{ touchAction: 'none', userSelect: 'none', cursor: dragRef.current.active ? 'grabbing' : 'default' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDragStart={(event) => event.preventDefault()}
          aria-label="Tree and elevator comparison for the equivalence principle"
        >
          <defs>
            <linearGradient id="equiv-orchard-sky" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(147,197,253,0.96)" />
              <stop offset="55%" stopColor="rgba(191,219,254,0.94)" />
              <stop offset="100%" stopColor="rgba(240,249,255,0.98)" />
            </linearGradient>
            <linearGradient id="equiv-orchard-sky-night" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(15,23,42,0.98)" />
              <stop offset="55%" stopColor="rgba(30,41,59,0.96)" />
              <stop offset="100%" stopColor="rgba(51,65,85,0.94)" />
            </linearGradient>
            <linearGradient id="equiv-orchard-grass" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(163,230,53,0.94)" />
              <stop offset="100%" stopColor="rgba(74,222,128,0.98)" />
            </linearGradient>
            <linearGradient id="equiv-orchard-grass-night" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(74,222,128,0.34)" />
              <stop offset="100%" stopColor="rgba(21,128,61,0.74)" />
            </linearGradient>
            <linearGradient id="equiv-tree-trunk" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(154,84,34,0.96)" />
              <stop offset="55%" stopColor="rgba(120,53,15,0.96)" />
              <stop offset="100%" stopColor="rgba(92,41,14,0.98)" />
            </linearGradient>
            <radialGradient id="equiv-canopy-main" cx="45%" cy="34%" r="70%">
              <stop offset="0%" stopColor="rgba(134,239,172,0.98)" />
              <stop offset="62%" stopColor="rgba(74,222,128,0.96)" />
              <stop offset="100%" stopColor="rgba(34,197,94,0.96)" />
            </radialGradient>
            <radialGradient id="equiv-canopy-deep" cx="50%" cy="42%" r="70%">
              <stop offset="0%" stopColor="rgba(74,222,128,0.95)" />
              <stop offset="100%" stopColor="rgba(21,128,61,0.96)" />
            </radialGradient>
            <radialGradient id="equiv-night-glow" cx="78%" cy="16%" r="55%">
              <stop offset="0%" stopColor="rgba(248,250,252,0.18)" />
              <stop offset="45%" stopColor="rgba(96,165,250,0.1)" />
              <stop offset="100%" stopColor="rgba(15,23,42,0)" />
            </radialGradient>
            <mask id="equiv-night-moon-crescent" maskUnits="userSpaceOnUse">
              <rect x={LEFT.x} y={LEFT.y} width={LEFT.width} height={LEFT.height} fill="black" />
              <circle cx={MOON.x} cy={MOON.y} r={MOON.r} fill="white" />
              <circle cx={MOON.cutX} cy={MOON.cutY} r={MOON.cutR} fill="black" />
            </mask>
          </defs>

          <rect x={LEFT.x} y={LEFT.y} width={LEFT.width} height={LEFT.height} rx="30" fill={darkMode ? 'url(#equiv-orchard-sky-night)' : 'url(#equiv-orchard-sky)'} stroke="rgba(148,163,184,0.24)" />
          {darkMode && (
            <>
              <rect x={LEFT.x} y={LEFT.y} width={LEFT.width} height={LEFT.height} rx="30" fill="url(#equiv-night-glow)" />
              <circle cx={MOON.x} cy={MOON.y} r={MOON.r} fill="rgba(241,245,249,0.82)" mask="url(#equiv-night-moon-crescent)" />
              {NIGHT_STARS.map((star) => (
                <circle
                  key={star.id}
                  cx={star.x}
                  cy={star.y}
                  r={star.r}
                  fill="rgba(248,250,252,0.96)"
                  opacity={clamp(star.alpha + Math.sin(skyTime * star.twinkle + star.phase) * 0.18, 0.18, 0.9)}
                />
              ))}
              {shootingStars.map((star) => (
                <g key={star.id} opacity={star.opacity}>
                  <line
                    x1={star.x - star.ux * star.fadeLength}
                    y1={star.y - star.uy * star.fadeLength}
                    x2={star.x - star.ux * star.headLength}
                    y2={star.y - star.uy * star.headLength}
                    stroke="rgba(224,231,255,0.2)"
                    strokeWidth="0.9"
                    strokeLinecap="round"
                  />
                  <line
                    x1={star.x - star.ux * star.headLength}
                    y1={star.y - star.uy * star.headLength}
                    x2={star.x}
                    y2={star.y}
                    stroke="rgba(224,231,255,0.78)"
                    strokeWidth="1.45"
                    strokeLinecap="round"
                  />
                  <circle cx={star.x} cy={star.y} r="1.65" fill="rgba(255,255,255,0.96)" />
                  <circle cx={star.x} cy={star.y} r="3.1" fill="rgba(255,255,255,0.16)" />
                </g>
              ))}
            </>
          )}
          <path d={`M ${LEFT.x} ${LEFT.y + 214} C ${LEFT.x + 72} ${LEFT.y + 180}, ${LEFT.x + 176} ${LEFT.y + 196}, ${LEFT.x + 242} ${LEFT.y + 176} C ${LEFT.x + 302} ${LEFT.y + 160}, ${LEFT.x + 332} ${LEFT.y + 176}, ${LEFT.x + LEFT.width} ${LEFT.y + 160} L ${LEFT.x + LEFT.width} ${LEFT.y + LEFT.height} L ${LEFT.x} ${LEFT.y + LEFT.height} Z`} fill={darkMode ? 'rgba(96,165,250,0.09)' : 'rgba(34,197,94,0.18)'} />
          {!darkMode && CLOUDS.map((cloud, index) => {
            const x = cloudX(cloud.x, cloud.speed);
            const y = cloud.y;
            const scale = cloud.scale;
            return (
              <g key={`cloud-${index}`} opacity="0.74" transform={`translate(${x} ${y}) scale(${scale})`}>
                <ellipse cx="0" cy="0" rx="30" ry="12" fill="rgba(255,255,255,0.9)" />
                <ellipse cx="22" cy="-5" rx="22" ry="10" fill="rgba(255,255,255,0.84)" />
                <ellipse cx="44" cy="1" rx="28" ry="11" fill="rgba(255,255,255,0.86)" />
              </g>
            );
          })}
          <path d={`M ${LEFT.x} ${GROUND_Y - 10} C ${LEFT.x + 80} ${GROUND_Y - 28}, ${LEFT.x + 188} ${GROUND_Y + 6}, ${LEFT.x + LEFT.width} ${GROUND_Y - 12} L ${LEFT.x + LEFT.width} ${LEFT.y + LEFT.height} L ${LEFT.x} ${LEFT.y + LEFT.height} Z`} fill={darkMode ? 'url(#equiv-orchard-grass-night)' : 'url(#equiv-orchard-grass)'} />
          {!darkMode && <ellipse cx={LEFT.x + 196} cy={GROUND_Y + 2} rx="124" ry="24" fill="rgba(21,128,61,0.14)" />}
          {!darkMode && <ellipse cx={TREE.trunkX + 58} cy={GROUND_Y - 4} rx="92" ry="20" fill="rgba(15,23,42,0.11)" />}
          {TREE_ART.leaves.map((leaf, index) => leaf.layer === 'back' ? leafSvg(leaf, `leaf-back-${index}`) : null)}
          <path
            d={`M ${TREE.trunkX + 4} ${GROUND_Y}
                C ${TREE.trunkX - 2} ${GROUND_Y - 30}, ${TREE.trunkX + 2} ${TREE.trunkY + 58}, ${TREE.trunkX + 14} ${TREE.trunkY + 12}
                C ${TREE.trunkX + 19} ${TREE.trunkY - 4}, ${TREE.trunkX + TREE.trunkW + 8} ${TREE.trunkY + 10}, ${TREE.trunkX + TREE.trunkW + 2} ${TREE.trunkY + 48}
                C ${TREE.trunkX + TREE.trunkW - 4} ${GROUND_Y - 30}, ${TREE.trunkX + TREE.trunkW + 5} ${GROUND_Y - 10}, ${TREE.trunkX + TREE.trunkW - 3} ${GROUND_Y}
                Z`}
            fill="url(#equiv-tree-trunk)"
          />
          <path d={`M ${TREE.trunkX + 10} ${TREE.trunkY + 12} L ${TREE.trunkX + 11} ${GROUND_Y - 16}`} stroke="rgba(245,158,11,0.16)" strokeWidth="3" strokeLinecap="round" />
          <path d={`M ${TREE.trunkX + 18} ${TREE.trunkY + 28} L ${TREE.trunkX + 16} ${GROUND_Y - 24}`} stroke="rgba(68,64,60,0.22)" strokeWidth="2.2" strokeLinecap="round" />
          <path d={`M ${TREE.trunkX + 25} ${TREE.trunkY + 18} L ${TREE.trunkX + 27} ${GROUND_Y - 34}`} stroke="rgba(68,64,60,0.18)" strokeWidth="1.8" strokeLinecap="round" />
          {TREE_ART.branches.map((segment, index) => (
            <line
              key={`branch-${index}`}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={segment.tone === 'base' ? '#7c3a0f' : '#6b2f10'}
              strokeWidth={segment.width}
              strokeLinecap="round"
            />
          ))}
          {TREE_ART.branches.map((segment, index) =>
            segment.width > 5.5 ? (
              <line
                key={`branch-highlight-${index}`}
                x1={segment.x1 - 0.8}
                y1={segment.y1 - 0.8}
                x2={segment.x2 - 0.8}
                y2={segment.y2 - 0.8}
                stroke="#b45309"
                strokeWidth={Math.max(1.2, segment.width * 0.22)}
                strokeLinecap="round"
                opacity="0.18"
              />
            ) : null,
          )}
          {TREE_ART.leaves.map((leaf, index) => leaf.layer === 'front' ? leafSvg(leaf, `leaf-front-${index}`) : null)}
          {treeApplesRef.current.map((apple) => apple.status === 'attached' ? (
            <g key={`${apple.id}-attached`}>
              <line
                x1={APPLE_VARIANTS[apple.id].attachX}
                y1={APPLE_VARIANTS[apple.id].attachY}
                x2={apple.homeX}
                y2={apple.homeY - 9}
                stroke="rgba(120,53,15,0.82)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              {appleSvg(apple.homeX, apple.homeY, apple.id, 1, apple.angle, APPLE_VARIANTS[apple.id])}
            </g>
          ) : appleSvg(apple.x, apple.y, apple.id, 1, apple.angle, APPLE_VARIANTS[apple.id]))}
          <line x1={SWING_ANCHOR.x - 12} y1={SWING_ANCHOR.y} x2={swingRef.current.x - 14} y2={swingRef.current.y + 6} stroke="rgba(148,163,184,0.92)" strokeWidth="2.6" strokeLinecap="round" />
          <line x1={SWING_ANCHOR.x + 12} y1={SWING_ANCHOR.y} x2={swingRef.current.x + 14} y2={swingRef.current.y + 6} stroke="rgba(148,163,184,0.92)" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx={SWING_ANCHOR.x} cy={SWING_ANCHOR.y} r="5" fill="rgba(120,53,15,0.82)" />
          <rect
            x={swingRef.current.x - SWING_BENCH.width / 2}
            y={swingRef.current.y}
            width={SWING_BENCH.width}
            height={SWING_BENCH.height}
            rx="4"
            fill="rgba(180,83,9,0.94)"
            style={{ cursor: 'grab' }}
          />

          <rect x={RIGHT.x} y={RIGHT.y} width={RIGHT.width} height={RIGHT.height} rx="30" fill="rgba(248,250,252,0.88)" stroke="rgba(148,163,184,0.24)" />
          <rect x={CABIN.x - 22} y={RIGHT.y + 8} width={CABIN.width + 44} height={RIGHT.height - 16} rx="28" fill="rgba(226,232,240,0.56)" />
          <line x1={CABIN.x - 12} y1={RIGHT.y + 14} x2={CABIN.x - 12} y2={RIGHT.y + RIGHT.height - 14} stroke="rgba(148,163,184,0.42)" strokeWidth="4" strokeLinecap="round" />
          <line x1={CABIN.x + CABIN.width + 12} y1={RIGHT.y + 14} x2={CABIN.x + CABIN.width + 12} y2={RIGHT.y + RIGHT.height - 14} stroke="rgba(148,163,184,0.42)" strokeWidth="4" strokeLinecap="round" />
          {dir !== 0 && (
            <g opacity={0.35 + strength * 0.65}>
              <circle cx={arrowX} cy={arrowCy} r={14 + strength * 6} fill={dir === -1 ? 'rgba(14,165,233,0.14)' : 'rgba(248,113,113,0.16)'} />
              {[0, 1, 2].map((index) => <line key={index} x1={arrowX - (7 - index)} y1={arrowCy - dir * (12 + index * 8 + trail)} x2={arrowX + (7 - index)} y2={arrowCy - dir * (12 + index * 8 + trail)} stroke={arrowColor} strokeWidth="2" strokeLinecap="round" opacity={0.38 - index * 0.1} />)}
              <line x1={arrowX} y1={arrowTail} x2={arrowX} y2={arrowTip} stroke={arrowColor} strokeWidth="3" strokeLinecap="round" />
              <path d={`M ${arrowX} ${arrowTip} L ${arrowX - 6} ${arrowTip - dir * 10} L ${arrowX + 6} ${arrowTip - dir * 10} Z`} fill={arrowColor} />
            </g>
          )}
          <rect x={CABIN.x} y={CABIN.y} width={CABIN.width} height={CABIN.height} rx="34" fill="rgba(255,255,255,0.92)" stroke="rgba(148,163,184,0.48)" strokeWidth="1.8" />
          <rect x={INTERIOR.x} y={INTERIOR.y} width={INTERIOR.width} height={INTERIOR.height} rx="26" fill="rgba(248,250,252,0.92)" stroke="rgba(148,163,184,0.24)" strokeWidth="1.2" />
          <line x1={CAB_PENDULUM_ANCHOR.x} y1={CAB_PENDULUM_ANCHOR.y} x2={cabPendulum.x} y2={cabPendulum.y} stroke="rgba(15,23,42,0.34)" strokeWidth="2.4" />
          <circle cx={CAB_PENDULUM_ANCHOR.x} cy={CAB_PENDULUM_ANCHOR.y} r="4.5" fill="rgba(15,23,42,0.26)" />
          <circle cx={cabPendulum.x} cy={cabPendulum.y} r={CAB_PENDULUM_RADIUS + 5} fill="rgba(13,148,136,0.08)" />
          <circle cx={cabPendulum.x} cy={cabPendulum.y} r={CAB_PENDULUM_RADIUS} fill="rgba(13,148,136,0.94)" style={{ cursor: 'grab' }} />
          <circle cx={cabPendulum.x - 3.2} cy={cabPendulum.y - 3.2} r="2.3" fill="rgba(255,255,255,0.22)" />
          <line x1={INTERIOR.x + 12} y1={INTERIOR.y + INTERIOR.height} x2={INTERIOR.x + INTERIOR.width - 12} y2={INTERIOR.y + INTERIOR.height} stroke="rgba(148,163,184,0.52)" strokeWidth="4" strokeLinecap="round" />
          <line x1={SLIDER.x} y1={SLIDER.y} x2={SLIDER.x} y2={SLIDER.y + SLIDER.height} stroke="rgba(71,85,105,0.34)" strokeWidth="5" strokeLinecap="round" style={{ cursor: 'grab' }} />
          <line x1={SLIDER.x - 10} y1={zeroY} x2={SLIDER.x + 10} y2={zeroY} stroke="rgba(15,23,42,0.42)" strokeWidth="2" strokeLinecap="round" />
          <text x={SLIDER.x + 14} y={zeroY + 4} fill="rgba(15,23,42,0.62)" fontSize="10" fontWeight="700">0</text>
          <circle cx={SLIDER.x} cy={sY} r={SLIDER.thumbR + 4} fill="rgba(255,255,255,0.42)" />
          <circle cx={SLIDER.x} cy={sY} r={SLIDER.thumbR} fill="rgba(59,130,246,0.94)" style={{ cursor: 'grab' }} />
          {appleSvg(cabAppleRef.current.x, cabAppleRef.current.y, 'cab-apple', 1, cabAppleRef.current.angle, CAB_APPLE_VARIANT)}
        </svg>
      </div>
      {afterFigure}
    </section>
  );
}
