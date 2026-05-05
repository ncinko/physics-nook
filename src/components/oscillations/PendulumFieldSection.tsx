import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  secretLinkHref?: string;
  secretLinkLabel?: string;
}

type PendulumPhysicsMode = 'rigid' | 'string';

interface PendulumConfig {
  anchorRatio: number;
  lengthRatio: number;
  color: string;
  glow: string;
}

interface PendulumGeometry extends PendulumConfig {
  anchorX: number;
  anchorY: number;
  length: number;
  bobRadius: number;
}

interface Point {
  x: number;
  y: number;
}

interface PendulumState {
  angle: number;
  angularVelocity: number;
  bobX: number;
  bobY: number;
  velocityX: number;
  velocityY: number;
  taut: boolean;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  pendulumIndex: number;
  lastAngle: number;
  lastPoint: Point;
  lastAt: number;
}

interface TextBounds {
  left: number;
  right: number;
}

const PENDULUM_PHYSICS_MODE: PendulumPhysicsMode = 'string';
const INITIAL_ANGLES = [0.62, -0.38];
const GRAVITY = 720;
const ANGULAR_DAMPING = 0.08;
const SLACK_DRAG = 0.22;
const MAX_ANGULAR_SPEED = 5.8;
const MAX_DRAG_SPEED = 920;
const STRING_TAUT_EPSILON = 0.75;
const STRING_RELAXATION_PASSES = 18;
const STRING_RELAXATION_STEPS = 2;
const STRING_SEGMENT_TARGET = 18;
const STRING_MIN_SEGMENTS = 12;
const STRING_MAX_SEGMENTS = 40;
const STRING_VERTICAL_RESOLUTION_BOOST = 0.65;
const STRING_RENDER_SMOOTHING_PASSES = 2;
const PENDULUM_STAGE_OVERFLOW = 420;
const TEXT_EDGE_OFFSET = 100;
const CEILING_EDGE_PADDING = 100;

const PENDULUMS: PendulumConfig[] = [
  {
    anchorRatio: 0.18,
    lengthRatio: 2,
    color: 'rgba(59, 130, 246, 0.95)',
    glow: 'rgba(59, 130, 246, 0.18)',
  },
  {
    anchorRatio: 0.82,
    lengthRatio: 4,
    color: 'rgba(234, 88, 12, 0.95)',
    glow: 'rgba(234, 88, 12, 0.16)',
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

const clampVectorMagnitude = (x: number, y: number, maxMagnitude: number) => {
  const magnitude = Math.hypot(x, y);

  if (magnitude <= maxMagnitude || magnitude === 0) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return { x: x * scale, y: y * scale };
};

const emptyDragState = (): DragState => ({
  active: false,
  pointerId: null,
  pendulumIndex: -1,
  lastAngle: 0,
  lastPoint: { x: 0, y: 0 },
  lastAt: 0,
});

const getPointInElement = (element: HTMLDivElement, event: ReactPointerEvent<HTMLDivElement>) => {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const getFallbackTextBounds = (width: number): TextBounds => {
  const outerWidth = Math.max(Math.min(width, 896), 32);
  const outerLeft = (width - outerWidth) / 2;
  const textWidth = Math.max(Math.min(outerWidth - 32, 65 * 8.6), 0);
  const textLeft = outerLeft + 16;

  return {
    left: textLeft,
    right: textLeft + textWidth,
  };
};

const getGeometry = (width: number, height: number, textBounds: TextBounds): PendulumGeometry[] =>
  PENDULUMS.map((pendulum) => {
    const nearTextEdge =
      pendulum.anchorRatio < 0.5 ? textBounds.left - TEXT_EDGE_OFFSET : textBounds.right + TEXT_EDGE_OFFSET;
    const anchorX = clamp(nearTextEdge, width * 0.12, width * 0.88);
    const anchorY = 34;
    const baseLength = clamp(height * 0.19, 96, 102);
    const length = baseLength * pendulum.lengthRatio;
    const bobRadius = clamp(Math.min(width, height) * 0.036, 14, 18);

    return {
      ...pendulum,
      anchorX,
      anchorY,
      length,
      bobRadius,
    };
  });

const getBobPositionFromAngle = (pendulum: PendulumGeometry, angle: number): Point => ({
  x: pendulum.anchorX + pendulum.length * Math.sin(angle),
  y: pendulum.anchorY + pendulum.length * Math.cos(angle),
});

const getAngleFromPoint = (pendulum: PendulumGeometry, point: Point) =>
  Math.atan2(point.x - pendulum.anchorX, point.y - pendulum.anchorY);

const getDistanceFromAnchor = (pendulum: PendulumGeometry, point: Point) =>
  Math.hypot(point.x - pendulum.anchorX, point.y - pendulum.anchorY);

const isStringTautAtPoint = (pendulum: PendulumGeometry, point: Point) =>
  getDistanceFromAnchor(pendulum, point) >= pendulum.length - STRING_TAUT_EPSILON;

const clampPointToStringLength = (pendulum: PendulumGeometry, point: Point): Point => {
  const dx = point.x - pendulum.anchorX;
  const dy = point.y - pendulum.anchorY;
  const distance = Math.hypot(dx, dy);

  if (distance <= pendulum.length || distance === 0) {
    return point;
  }

  const scale = pendulum.length / distance;
  return {
    x: pendulum.anchorX + dx * scale,
    y: pendulum.anchorY + dy * scale,
  };
};

const lockStringEndpoints = (points: Point[], anchor: Point, bob: Point) => {
  points[0].x = anchor.x;
  points[0].y = anchor.y;
  points[points.length - 1].x = bob.x;
  points[points.length - 1].y = bob.y;
};

const constrainStringSegment = (points: Point[], index: number, segmentLength: number) => {
  const start = points[index];
  const end = points[index + 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return;
  }

  const correctionScale = (distance - segmentLength) / distance;

  if (index === 0) {
    end.x -= dx * correctionScale;
    end.y -= dy * correctionScale;
    return;
  }

  if (index === points.length - 2) {
    start.x += dx * correctionScale;
    start.y += dy * correctionScale;
    return;
  }

  const correctionX = dx * correctionScale * 0.5;
  const correctionY = dy * correctionScale * 0.5;

  start.x += correctionX;
  start.y += correctionY;
  end.x -= correctionX;
  end.y -= correctionY;
};

const getSlackStringPoints = (pendulum: PendulumGeometry, bob: Point) => {
  const anchor = { x: pendulum.anchorX, y: pendulum.anchorY };
  const spanX = bob.x - anchor.x;
  const straightDistance = Math.hypot(spanX, bob.y - anchor.y);

  if (straightDistance >= pendulum.length - STRING_TAUT_EPSILON) {
    return [anchor, bob];
  }

  const verticalAlignment = 1 - clamp(Math.abs(spanX) / (pendulum.length * 0.3), 0, 1);
  const resolutionBoost = 1 + verticalAlignment * STRING_VERTICAL_RESOLUTION_BOOST;
  const segmentCount = Math.round(
    clamp((pendulum.length / STRING_SEGMENT_TARGET) * resolutionBoost, STRING_MIN_SEGMENTS, STRING_MAX_SEGMENTS),
  );
  const segmentLength = pendulum.length / segmentCount;
  const slack = pendulum.length - straightDistance;
  const bendDirection = Math.abs(spanX) > 0.5 ? Math.sign(spanX) : pendulum.anchorRatio < 0.5 ? 1 : -1;
  const verticalSag = clamp(slack * 0.88, 10, pendulum.length * 0.32);
  const lateralSag =
    Math.abs(spanX) < pendulum.bobRadius * 0.65
      ? bendDirection * clamp(slack * 0.46, 8, pendulum.length * 0.18)
      : 0;
  const gravityPull = clamp(slack * 0.06, 0.35, 2.4);
  const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const t = index / segmentCount;
    const arch = 4 * t * (1 - t);

    return {
      x: lerp(anchor.x, bob.x, t) + lateralSag * arch,
      y: lerp(anchor.y, bob.y, t) + verticalSag * arch,
    };
  });

  lockStringEndpoints(points, anchor, bob);

  for (let pass = 0; pass < STRING_RELAXATION_PASSES; pass += 1) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const t = index / segmentCount;
      points[index].y += gravityPull * (0.6 + 0.4 * (1 - Math.abs(0.5 - t) * 2));
    }

    lockStringEndpoints(points, anchor, bob);

    for (let sweep = 0; sweep < STRING_RELAXATION_STEPS; sweep += 1) {
      for (let index = 0; index < points.length - 1; index += 1) {
        constrainStringSegment(points, index, segmentLength);
      }

      lockStringEndpoints(points, anchor, bob);

      for (let index = points.length - 2; index >= 0; index -= 1) {
        constrainStringSegment(points, index, segmentLength);
      }

      lockStringEndpoints(points, anchor, bob);
    }
  }

  return points;
};

const getRenderStringPoints = (points: Point[]) => {
  if (points.length <= 2) {
    return points;
  }

  let smoothedPoints = points.map((point) => ({ ...point }));

  for (let pass = 0; pass < STRING_RENDER_SMOOTHING_PASSES; pass += 1) {
    const nextPoints = smoothedPoints.map((point, index) => {
      if (index === 0 || index === smoothedPoints.length - 1) {
        return { ...point };
      }

      return {
        x: (smoothedPoints[index - 1].x + point.x * 2 + smoothedPoints[index + 1].x) / 4,
        y: (smoothedPoints[index - 1].y + point.y * 2 + smoothedPoints[index + 1].y) / 4,
      };
    });

    smoothedPoints = nextPoints;
  }

  return smoothedPoints;
};

const traceSmoothString = (context: CanvasRenderingContext2D, points: Point[]) => {
  if (points.length <= 1) {
    return;
  }

  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
    return;
  }

  const renderPoints = getRenderStringPoints(points);

  for (let index = 1; index < renderPoints.length - 1; index += 1) {
    const midpointX = (renderPoints[index].x + renderPoints[index + 1].x) / 2;
    const midpointY = (renderPoints[index].y + renderPoints[index + 1].y) / 2;
    context.quadraticCurveTo(renderPoints[index].x, renderPoints[index].y, midpointX, midpointY);
  }

  const lastIndex = renderPoints.length - 1;
  context.quadraticCurveTo(
    renderPoints[lastIndex - 1].x,
    renderPoints[lastIndex - 1].y,
    renderPoints[lastIndex].x,
    renderPoints[lastIndex].y,
  );
};

const applyTautPose = (
  state: PendulumState,
  pendulum: PendulumGeometry,
  angle: number,
  angularVelocity: number,
) => {
  const bob = getBobPositionFromAngle(pendulum, angle);
  const tangentialSpeed = angularVelocity * pendulum.length;

  state.angle = angle;
  state.angularVelocity = angularVelocity;
  state.bobX = bob.x;
  state.bobY = bob.y;
  state.velocityX = Math.cos(angle) * tangentialSpeed;
  state.velocityY = -Math.sin(angle) * tangentialSpeed;
  state.taut = true;
};

const catchString = (
  state: PendulumState,
  pendulum: PendulumGeometry,
  point: Point,
  velocityX: number,
  velocityY: number,
) => {
  const dx = point.x - pendulum.anchorX;
  const dy = point.y - pendulum.anchorY;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.0001) {
    applyTautPose(state, pendulum, 0, 0);
    return;
  }

  const radialX = dx / distance;
  const radialY = dy / distance;
  const tangentX = radialY;
  const tangentY = -radialX;
  const tangentialSpeed = velocityX * tangentX + velocityY * tangentY;
  const angle = Math.atan2(radialX, radialY);

  applyTautPose(state, pendulum, angle, tangentialSpeed / pendulum.length);
};

const syncStateToGeometry = (
  state: PendulumState,
  previousPendulum: PendulumGeometry | undefined,
  nextPendulum: PendulumGeometry,
) => {
  if (PENDULUM_PHYSICS_MODE === 'rigid' || state.taut || !previousPendulum) {
    applyTautPose(state, nextPendulum, state.angle, state.angularVelocity);
    return;
  }

  state.bobX += nextPendulum.anchorX - previousPendulum.anchorX;
  state.bobY += nextPendulum.anchorY - previousPendulum.anchorY;

  const bobPoint = { x: state.bobX, y: state.bobY };

  if (isStringTautAtPoint(nextPendulum, bobPoint)) {
    catchString(state, nextPendulum, bobPoint, state.velocityX, state.velocityY);
  }
};

const drawString = (
  context: CanvasRenderingContext2D,
  pendulum: PendulumGeometry,
  state: PendulumState,
) => {
  const bob = { x: state.bobX, y: state.bobY };

  context.beginPath();
  context.moveTo(pendulum.anchorX, pendulum.anchorY);

  if (state.taut || isStringTautAtPoint(pendulum, bob)) {
    context.lineTo(bob.x, bob.y);
    return;
  }

  const stringPoints = getSlackStringPoints(pendulum, bob);
  traceSmoothString(context, stringPoints);
};

export default function PendulumFieldSection({
  children,
  secretLinkHref,
  secretLinkLabel = 'Open pendulum peg challenge',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textColumnRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, canvasHeight: 0 });
  const geometryRef = useRef<PendulumGeometry[]>([]);
  const textBoundsRef = useRef<TextBounds>({ left: 0, right: 0 });
  const dprRef = useRef(1);
  const stateRef = useRef<PendulumState[]>(
    INITIAL_ANGLES.map((angle) => ({
      angle,
      angularVelocity: 0,
      bobX: 0,
      bobY: 0,
      velocityX: 0,
      velocityY: 0,
      taut: true,
    })),
  );
  const dragRef = useRef<DragState>(emptyDragState());

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      const canvasHeight = height + PENDULUM_STAGE_OVERFLOW;
      const dpr = window.devicePixelRatio || 1;
      const textRect = textColumnRef.current?.getBoundingClientRect();
      const textBounds = textRect
        ? {
            left: textRect.left - rect.left,
            right: textRect.right - rect.left,
          }
        : getFallbackTextBounds(width);
      const previousGeometry = geometryRef.current;
      const nextGeometry = getGeometry(width, height, textBounds);

      sizeRef.current = { width, height, canvasHeight };
      textBoundsRef.current = textBounds;
      geometryRef.current = nextGeometry;
      dprRef.current = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(canvasHeight * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${canvasHeight}px`;
      canvas.style.top = `${-PENDULUM_STAGE_OVERFLOW}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, PENDULUM_STAGE_OVERFLOW * dpr);

      stateRef.current.forEach((state, index) => {
        syncStateToGeometry(state, previousGeometry[index], nextGeometry[index]);
      });
    };

    const draw = () => {
      const { width } = sizeRef.current;
      const geometry = geometryRef.current;
      const dpr = dprRef.current;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, PENDULUM_STAGE_OVERFLOW * dpr);

      if (geometry.length === 0) {
        return;
      }

      context.strokeStyle = 'rgba(15, 23, 42, 0.18)';
      context.lineWidth = 3;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(geometry[0].anchorX - CEILING_EDGE_PADDING, 30);
      context.lineTo(geometry[geometry.length - 1].anchorX + CEILING_EDGE_PADDING, 30);
      context.stroke();

      geometry.forEach((pendulum, index) => {
        const state = stateRef.current[index];

        context.save();
        context.strokeStyle = pendulum.color.replace('0.95', '0.28');
        context.lineWidth = 2;
        drawString(context, pendulum, state);
        context.stroke();
        context.restore();

        context.save();
        context.shadowBlur = 8;
        context.shadowColor = pendulum.glow.replace('0.18', '0.08').replace('0.16', '0.08');
        context.fillStyle = pendulum.color.replace('0.95', '0.28');
        context.beginPath();
        context.arc(state.bobX, state.bobY, pendulum.bobRadius, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = 'rgba(255, 255, 255, 0.16)';
        context.beginPath();
        context.arc(
          state.bobX - pendulum.bobRadius * 0.34,
          state.bobY - pendulum.bobRadius * 0.34,
          pendulum.bobRadius * 0.28,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.restore();

        context.fillStyle = 'rgba(15, 23, 42, 0.24)';
        context.beginPath();
        context.arc(pendulum.anchorX, pendulum.anchorY, 5, 0, Math.PI * 2);
        context.fill();
      });
    };

    const step = (dt: number) => {
      const geometry = geometryRef.current;

      if (geometry.length !== stateRef.current.length) {
        return;
      }

      stateRef.current.forEach((pendulum, index) => {
        if (dragRef.current.active && dragRef.current.pendulumIndex === index) {
          return;
        }

        const bob = geometry[index];

        if (PENDULUM_PHYSICS_MODE === 'rigid') {
          const angularAcceleration =
            -(GRAVITY / bob.length) * Math.sin(pendulum.angle) -
            ANGULAR_DAMPING * pendulum.angularVelocity;

          pendulum.angularVelocity += angularAcceleration * dt;
          pendulum.angle += pendulum.angularVelocity * dt;

          if (Math.abs(pendulum.angle) < 0.001 && Math.abs(pendulum.angularVelocity) < 0.001) {
            applyTautPose(pendulum, bob, 0, 0);
            return;
          }

          applyTautPose(pendulum, bob, pendulum.angle, pendulum.angularVelocity);
          return;
        }

        if (pendulum.taut) {
          const angularAcceleration =
            -(GRAVITY / bob.length) * Math.sin(pendulum.angle) -
            ANGULAR_DAMPING * pendulum.angularVelocity;

          pendulum.angularVelocity += angularAcceleration * dt;
          pendulum.angle += pendulum.angularVelocity * dt;
          applyTautPose(pendulum, bob, pendulum.angle, pendulum.angularVelocity);

          const tensionPerMass =
            bob.length * pendulum.angularVelocity * pendulum.angularVelocity +
            GRAVITY * Math.cos(pendulum.angle);

          if (tensionPerMass <= 0) {
            pendulum.taut = false;
            return;
          }

          if (Math.abs(pendulum.angle) < 0.001 && Math.abs(pendulum.angularVelocity) < 0.001) {
            applyTautPose(pendulum, bob, 0, 0);
          }

          return;
        }

        pendulum.velocityX += -SLACK_DRAG * pendulum.velocityX * dt;
        pendulum.velocityY += (GRAVITY - SLACK_DRAG * pendulum.velocityY) * dt;
        pendulum.bobX += pendulum.velocityX * dt;
        pendulum.bobY += pendulum.velocityY * dt;

        const bobPoint = { x: pendulum.bobX, y: pendulum.bobY };

        if (isStringTautAtPoint(bob, bobPoint)) {
          catchString(pendulum, bob, bobPoint, pendulum.velocityX, pendulum.velocityY);
        }
      });
    };

    const animate = (timestamp: number) => {
      const previous = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.024);

      step(dt);
      draw();
      animationRef.current = window.requestAnimationFrame(animate);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    animationRef.current = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();

      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      animationRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const point = getPointInElement(container, event);
    const geometry =
      geometryRef.current.length > 0
        ? geometryRef.current
        : getGeometry(
            sizeRef.current.width,
            sizeRef.current.height,
            textBoundsRef.current.left === 0 && textBoundsRef.current.right === 0
              ? getFallbackTextBounds(sizeRef.current.width)
              : textBoundsRef.current,
          );

    let targetIndex = -1;

    geometry.forEach((pendulum, index) => {
      const state = stateRef.current[index];

      if (Math.hypot(point.x - state.bobX, point.y - state.bobY) <= pendulum.bobRadius + 6) {
        targetIndex = index;
      }
    });

    if (targetIndex === -1) {
      return;
    }

    event.preventDefault();
    const pendulum = geometry[targetIndex];
    const state = stateRef.current[targetIndex];
    const clampedPoint =
      PENDULUM_PHYSICS_MODE === 'string' ? clampPointToStringLength(pendulum, point) : point;
    const angle = clamp(getAngleFromPoint(pendulum, clampedPoint), -1.08, 1.08);

    if (PENDULUM_PHYSICS_MODE === 'rigid') {
      applyTautPose(state, pendulum, angle, 0);
    } else {
      state.angle = angle;
      state.angularVelocity = 0;
      state.bobX = clampedPoint.x;
      state.bobY = clampedPoint.y;
      state.velocityX = 0;
      state.velocityY = 0;
      state.taut = isStringTautAtPoint(pendulum, clampedPoint);
    }

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      pendulumIndex: targetIndex,
      lastAngle: angle,
      lastPoint: clampedPoint,
      lastAt: performance.now(),
    };
    container.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const rawPoint = getPointInElement(container, event);
    const now = performance.now();
    const dt = Math.max((now - dragRef.current.lastAt) / 1000, 0.001);
    const pendulum = geometryRef.current[dragRef.current.pendulumIndex];
    const state = stateRef.current[dragRef.current.pendulumIndex];

    if (!pendulum || !state) {
      return;
    }

    const point = PENDULUM_PHYSICS_MODE === 'string' ? clampPointToStringLength(pendulum, rawPoint) : rawPoint;
    const nextAngle = clamp(getAngleFromPoint(pendulum, point), -1.08, 1.08);

    if (PENDULUM_PHYSICS_MODE === 'rigid') {
      const angularVelocity = clamp(
        (nextAngle - dragRef.current.lastAngle) / dt,
        -MAX_ANGULAR_SPEED,
        MAX_ANGULAR_SPEED,
      );

      applyTautPose(state, pendulum, nextAngle, angularVelocity);
    } else {
      const nextVelocity = clampVectorMagnitude(
        (point.x - dragRef.current.lastPoint.x) / dt,
        (point.y - dragRef.current.lastPoint.y) / dt,
        MAX_DRAG_SPEED,
      );

      state.angle = nextAngle;
      state.angularVelocity = 0;
      state.bobX = point.x;
      state.bobY = point.y;
      state.velocityX = nextVelocity.x;
      state.velocityY = nextVelocity.y;
      state.taut = isStringTautAtPoint(pendulum, point);
    }

    dragRef.current = {
      ...dragRef.current,
      lastAngle: nextAngle,
      lastPoint: point,
      lastAt: now,
    };
  };

  const finishDrag = (pointerId: number) => {
    if (dragRef.current.pointerId !== pointerId) {
      return;
    }

    if (PENDULUM_PHYSICS_MODE === 'string') {
      const pendulumIndex = dragRef.current.pendulumIndex;
      const pendulum = geometryRef.current[pendulumIndex];
      const state = stateRef.current[pendulumIndex];

      if (!pendulum || !state) {
        dragRef.current = emptyDragState();
        return;
      }

      const bobPoint = { x: state.bobX, y: state.bobY };

      if (isStringTautAtPoint(pendulum, bobPoint)) {
        catchString(state, pendulum, bobPoint, state.velocityX, state.velocityY);
      } else {
        state.taut = false;
      }
    }

    dragRef.current = emptyDragState();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    finishDrag(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    finishDrag(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      ref={containerRef}
      className="relative isolate my-8 min-h-[30rem] max-w-none overflow-visible"
      style={{ touchAction: 'none', marginInline: 'calc(50% - 50vw)' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label={
        PENDULUM_PHYSICS_MODE === 'string'
          ? 'Interactive pendulum background; drag a bob anywhere and release to watch the string tighten'
          : 'Interactive pendulum background; drag a bob to set its angle'
      }
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 w-full opacity-[0.58]"
        aria-hidden="true"
      />
      {secretLinkHref ? (
        <a
          href={secretLinkHref}
          className="absolute right-0 bottom-0 z-20 flex h-14 w-14 items-center justify-center border-t border-l border-[color-mix(in_srgb,var(--grid-line)_82%,transparent)] bg-[linear-gradient(225deg,color-mix(in_srgb,var(--surface-elevated)_80%,transparent),color-mix(in_srgb,var(--bg-primary)_14%,transparent))] text-[color:var(--text-muted)] opacity-70 shadow-[-10px_-10px_32px_-24px_rgba(15,118,110,0.55)] transition-all duration-200 hover:text-[var(--accent-blue)] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] sm:h-16 sm:w-16"
          aria-label={secretLinkLabel}
          title={secretLinkLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="sr-only">{secretLinkLabel}</span>
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border border-current" />
        </a>
      ) : null}
      <div className="relative z-10 mx-auto w-full max-w-4xl px-4 py-6">
        <div
          ref={textColumnRef}
          className="mx-auto max-w-[65ch] [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
