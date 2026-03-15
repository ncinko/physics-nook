import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type CollisionMode = 'elastic' | 'inelastic';

interface Props {
  mode: CollisionMode;
  children: ReactNode;
}

interface BallPalette {
  fill: string;
  stroke: string;
  glow: string;
}

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  palette: BallPalette;
}

interface SpawnState {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startedAt: number;
}

const MAX_BALLS = 24;

const MODE_CONFIG = {
  elastic: {
    restitution: 0.985,
    wallRestitution: 0.995,
    palette: [
      { fill: 'rgba(56, 189, 248, 0.28)', stroke: 'rgba(14, 116, 144, 0.6)', glow: 'rgba(56, 189, 248, 0.28)' },
      { fill: 'rgba(59, 130, 246, 0.24)', stroke: 'rgba(30, 64, 175, 0.56)', glow: 'rgba(59, 130, 246, 0.24)' },
      { fill: 'rgba(45, 212, 191, 0.22)', stroke: 'rgba(15, 118, 110, 0.54)', glow: 'rgba(45, 212, 191, 0.24)' },
      { fill: 'rgba(129, 140, 248, 0.22)', stroke: 'rgba(67, 56, 202, 0.52)', glow: 'rgba(129, 140, 248, 0.22)' },
    ],
    accent: 'rgba(59, 130, 246, 0.85)',
    background:
      'radial-gradient(circle at 18% 24%, rgba(56, 189, 248, 0.12), transparent 32%), radial-gradient(circle at 82% 72%, rgba(45, 212, 191, 0.12), transparent 34%)',
    veil:
      'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 82%, transparent) 0%, color-mix(in srgb, var(--bg-primary) 44%, transparent) 36%, color-mix(in srgb, var(--bg-primary) 74%, transparent) 100%)',
  },
  inelastic: {
    restitution: 0.78,
    wallRestitution: 0.94,
    palette: [
      { fill: 'rgba(251, 146, 60, 0.24)', stroke: 'rgba(194, 65, 12, 0.56)', glow: 'rgba(251, 146, 60, 0.22)' },
      { fill: 'rgba(248, 113, 113, 0.2)', stroke: 'rgba(185, 28, 28, 0.54)', glow: 'rgba(248, 113, 113, 0.2)' },
      { fill: 'rgba(245, 158, 11, 0.2)', stroke: 'rgba(180, 83, 9, 0.54)', glow: 'rgba(245, 158, 11, 0.2)' },
      { fill: 'rgba(251, 191, 36, 0.18)', stroke: 'rgba(161, 98, 7, 0.52)', glow: 'rgba(251, 191, 36, 0.18)' },
    ],
    accent: 'rgba(234, 88, 12, 0.82)',
    background:
      'radial-gradient(circle at 24% 28%, rgba(251, 146, 60, 0.12), transparent 30%), radial-gradient(circle at 78% 74%, rgba(248, 113, 113, 0.1), transparent 32%)',
    veil:
      'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 84%, transparent) 0%, color-mix(in srgb, var(--bg-primary) 50%, transparent) 34%, color-mix(in srgb, var(--bg-primary) 78%, transparent) 100%)',
  },
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

const emptySpawnState = (): SpawnState => ({
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  startedAt: 0,
});

const createRng = (seed: number) => {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let next = Math.imul(current ^ (current >>> 15), current | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const radiusToMass = (radius: number) => Math.max(0.9, (radius * radius) / 210);

const getSpawnStats = (heldMs: number) => {
  const charge = clamp(heldMs / 900, 0, 1);
  const radius = lerp(11, 30, charge);
  return {
    radius,
    mass: radiusToMass(radius),
  };
};

const getPointInElement = (element: HTMLDivElement, event: ReactPointerEvent<HTMLDivElement>) => {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const overlapsExistingBall = (balls: Ball[], x: number, y: number, radius: number) =>
  balls.some((ball) => Math.hypot(ball.x - x, ball.y - y) < ball.radius + radius + 6);

const findOpenSpot = (balls: Ball[], x: number, y: number, radius: number, width: number, height: number) => {
  const safeX = clamp(x, radius + 2, width - radius - 2);
  const safeY = clamp(y, radius + 2, height - radius - 2);

  if (!overlapsExistingBall(balls, safeX, safeY, radius)) {
    return { x: safeX, y: safeY };
  }

  for (let step = 12; step <= 84; step += 12) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const candidateX = clamp(safeX + Math.cos(angle) * step, radius + 2, width - radius - 2);
      const candidateY = clamp(safeY + Math.sin(angle) * step, radius + 2, height - radius - 2);

      if (!overlapsExistingBall(balls, candidateX, candidateY, radius)) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return null;
};

const seedBalls = (width: number, height: number, mode: CollisionMode) => {
  const config = MODE_CONFIG[mode];
  const rng = createRng(mode === 'elastic' ? 13 : 29);
  const balls: Ball[] = [];
  const minDim = Math.min(width, height);
  const targetCount = mode === 'elastic' ? 6 : 7;

  for (let i = 0; i < targetCount; i += 1) {
    const radius = lerp(Math.max(11, minDim * 0.032), Math.max(19, minDim * 0.068), rng());
    let placed = false;

    for (let attempt = 0; attempt < 80 && !placed; attempt += 1) {
      const x = lerp(radius + 8, width - radius - 8, rng());
      const y = lerp(radius + 12, height - radius - 12, rng());

      if (overlapsExistingBall(balls, x, y, radius)) {
        continue;
      }

      const centerAngle = Math.atan2(height * 0.5 - y, width * 0.5 - x);
      const angle = centerAngle + lerp(-0.85, 0.85, rng());
      const speed = lerp(Math.max(90, minDim * 0.16), Math.max(170, minDim * 0.32), rng());

      balls.push({
        id: i,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        mass: radiusToMass(radius),
        palette: config.palette[i % config.palette.length],
      });
      placed = true;
    }
  }

  return balls;
};

export default function CollisionFieldSection({ mode, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const ballsRef = useRef<Ball[]>([]);
  const spawnRef = useRef<SpawnState>(emptySpawnState());
  const nextBallIdRef = useRef(1000);

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
      const dpr = window.devicePixelRatio || 1;

      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (ballsRef.current.length === 0) {
        ballsRef.current = seedBalls(width, height, mode);
        return;
      }

      ballsRef.current = ballsRef.current.map((ball) => ({
        ...ball,
        x: clamp(ball.x, ball.radius, width - ball.radius),
        y: clamp(ball.y, ball.radius, height - ball.radius),
      }));
    };

    const draw = (timestamp: number) => {
      const { width, height } = sizeRef.current;
      context.clearRect(0, 0, width, height);

      for (const ball of ballsRef.current) {
        context.save();
        context.shadowBlur = ball.radius * 1.45;
        context.shadowColor = ball.palette.glow;
        context.fillStyle = ball.palette.fill;
        context.strokeStyle = ball.palette.stroke;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();

        context.shadowBlur = 0;
        context.fillStyle = 'rgba(255, 255, 255, 0.3)';
        context.beginPath();
        context.arc(ball.x - ball.radius * 0.28, ball.y - ball.radius * 0.28, ball.radius * 0.24, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      const spawn = spawnRef.current;
      if (!spawn.active) {
        return;
      }

      const heldMs = timestamp - spawn.startedAt;
      const { radius } = getSpawnStats(heldMs);

      context.save();
      context.strokeStyle = MODE_CONFIG[mode].accent;
      context.lineWidth = 1.5;
      context.setLineDash([7, 6]);
      context.beginPath();
      context.moveTo(spawn.startX, spawn.startY);
      context.lineTo(spawn.currentX, spawn.currentY);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = mode === 'elastic' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(234, 88, 12, 0.12)';
      context.strokeStyle = MODE_CONFIG[mode].accent;
      context.beginPath();
      context.arc(spawn.startX, spawn.startY, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.beginPath();
      context.arc(spawn.currentX, spawn.currentY, 3.5, 0, Math.PI * 2);
      context.fillStyle = MODE_CONFIG[mode].accent;
      context.fill();
      context.restore();
    };

    const step = (dt: number) => {
      const { width, height } = sizeRef.current;
      const config = MODE_CONFIG[mode];
      const balls = ballsRef.current;

      if (!width || !height) {
        return;
      }

      for (const ball of balls) {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.vx = Math.abs(ball.vx) * config.wallRestitution;
        } else if (ball.x + ball.radius >= width) {
          ball.x = width - ball.radius;
          ball.vx = -Math.abs(ball.vx) * config.wallRestitution;
        }

        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.vy = Math.abs(ball.vy) * config.wallRestitution;
        } else if (ball.y + ball.radius >= height) {
          ball.y = height - ball.radius;
          ball.vy = -Math.abs(ball.vy) * config.wallRestitution;
        }

        if (mode === 'inelastic') {
          const ambientDrag = Math.exp(-0.035 * dt);
          ball.vx *= ambientDrag;
          ball.vy *= ambientDrag;
        }
      }

      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
          const ballA = balls[i];
          const ballB = balls[j];
          const dx = ballB.x - ballA.x;
          const dy = ballB.y - ballA.y;
          const minDistance = ballA.radius + ballB.radius;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq >= minDistance * minDistance) {
            continue;
          }

          const distance = Math.max(Math.sqrt(distanceSq), 0.0001);
          const normalX = dx / distance;
          const normalY = dy / distance;
          const overlap = minDistance - distance;
          const inverseMassA = 1 / ballA.mass;
          const inverseMassB = 1 / ballB.mass;
          const inverseMassTotal = inverseMassA + inverseMassB;

          ballA.x -= normalX * overlap * (inverseMassA / inverseMassTotal);
          ballA.y -= normalY * overlap * (inverseMassA / inverseMassTotal);
          ballB.x += normalX * overlap * (inverseMassB / inverseMassTotal);
          ballB.y += normalY * overlap * (inverseMassB / inverseMassTotal);

          const relativeVelocityX = ballB.vx - ballA.vx;
          const relativeVelocityY = ballB.vy - ballA.vy;
          const velocityAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;

          if (velocityAlongNormal > 0) {
            continue;
          }

          const impulse =
            (-(1 + config.restitution) * velocityAlongNormal) / inverseMassTotal;
          const impulseX = impulse * normalX;
          const impulseY = impulse * normalY;

          ballA.vx -= impulseX * inverseMassA;
          ballA.vy -= impulseY * inverseMassA;
          ballB.vx += impulseX * inverseMassB;
          ballB.vy += impulseY * inverseMassB;
        }
      }
    };

    const animate = (timestamp: number) => {
      const previous = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.024);

      step(dt);
      draw(timestamp);
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
  }, [mode]);

  const releaseSpawn = (pointerId: number) => {
    const spawn = spawnRef.current;
    const { width, height } = sizeRef.current;

    if (!spawn.active || spawn.pointerId !== pointerId || !width || !height) {
      return;
    }

    const heldMs = performance.now() - spawn.startedAt;
    const { radius, mass } = getSpawnStats(heldMs);
    const position = findOpenSpot(ballsRef.current, spawn.startX, spawn.startY, radius, width, height);

    if (position) {
      const velocityScale = mode === 'elastic' ? 2.4 : 2.1;
      const velocityX = clamp((spawn.currentX - spawn.startX) * velocityScale, -360, 360);
      const velocityY = clamp((spawn.currentY - spawn.startY) * velocityScale, -360, 360);
      const palette = MODE_CONFIG[mode].palette[nextBallIdRef.current % MODE_CONFIG[mode].palette.length];

      ballsRef.current.push({
        id: nextBallIdRef.current,
        x: position.x,
        y: position.y,
        vx: velocityX,
        vy: velocityY,
        radius,
        mass,
        palette,
      });
      nextBallIdRef.current += 1;

      if (ballsRef.current.length > MAX_BALLS) {
        ballsRef.current.splice(0, ballsRef.current.length - MAX_BALLS);
      }
    }

    spawnRef.current = emptySpawnState();
  };

  const cancelSpawn = (pointerId: number) => {
    if (spawnRef.current.pointerId === pointerId) {
      spawnRef.current = emptySpawnState();
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const point = getPointInElement(container, event);
    spawnRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      startedAt: performance.now(),
    };
    container.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spawnRef.current.active || spawnRef.current.pointerId !== event.pointerId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const point = getPointInElement(container, event);
    spawnRef.current = {
      ...spawnRef.current,
      currentX: point.x,
      currentY: point.y,
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    event.preventDefault();
    releaseSpawn(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    cancelSpawn(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      ref={containerRef}
      className="relative isolate my-8 min-h-[18rem] overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label={`${mode} collision field; hold and drag to create more balls`}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: MODE_CONFIG[mode].background }} />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0" style={{ background: MODE_CONFIG[mode].veil }} />
      <div className="relative z-10 pb-20 md:pb-24 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0">
        {children}
      </div>
    </section>
  );
}
