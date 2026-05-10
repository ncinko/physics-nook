import { Pause, Play, RotateCcw, Target } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';

type Size = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type ProjectileState = {
  id: number;
  launchIndex: number;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  path: Point[];
  landed: boolean;
  maxHeight: number;
};

type DragMode = 'aim' | 'target' | null;

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const VIEWPORT_WIDTH_M = 100;
const GRID_STEP_M = 10;
const TRAIL_FADE_LAUNCHES = 10;
const HIT_TOLERANCE_M = 0.2;
const HIT_SPRITE_CHANCE = 0.25;
const HIT_SPRITE_DURATION_MS = 1700;
const HIT_SPRITE_SRC = '/images/resetti.png';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

const makeProjectile = (
  angleDeg: number,
  speed: number,
  id: number,
  launchIndex: number,
): ProjectileState => {
  const angle = toRadians(angleDeg);
  return {
    id,
    launchIndex,
    t: 0,
    x: 0,
    y: 0,
    vx: speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
    path: [{ x: 0, y: 0 }],
    landed: false,
    maxHeight: 0,
  };
};

const cloneProjectile = (projectile: ProjectileState): ProjectileState => ({
  ...projectile,
  path: [...projectile.path],
});

const cloneProjectiles = (projectiles: ProjectileState[]) => projectiles.map(cloneProjectile);

const getTrailOpacity = (launchIndex: number, currentLaunchIndex: number) => {
  const age = Math.max(0, currentLaunchIndex - launchIndex);
  return clamp(1 - age / TRAIL_FADE_LAUNCHES, 0, 1);
};

const pruneTrajectories = (trajectories: ProjectileState[], currentLaunchIndex: number) =>
  trajectories.filter((trajectory) => currentLaunchIndex - trajectory.launchIndex < TRAIL_FADE_LAUNCHES);

export default function ProjectileLauncher() {
  const [size, setSize] = useState<Size>({ width: 860, height: 480 });
  const [angleDeg, setAngleDeg] = useState(42);
  const [speed, setSpeed] = useState(24);
  const [gravity, setGravity] = useState(9.8);
  const [drag, setDrag] = useState(0);
  const [targetX, setTargetX] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [activeProjectiles, setActiveProjectiles] = useState<ProjectileState[]>([]);
  const [landedTrajectories, setLandedTrajectories] = useState<ProjectileState[]>([]);
  const [focusedProjectileId, setFocusedProjectileId] = useState<number | null>(null);
  const [launchCount, setLaunchCount] = useState(0);
  const [showHitSprite, setShowHitSprite] = useState(false);
  const [hitSpriteReady, setHitSpriteReady] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitSpriteRef = useRef<HTMLImageElement | null>(null);
  const activeProjectilesRef = useRef<ProjectileState[]>([]);
  const landedTrajectoriesRef = useRef<ProjectileState[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const dragModeRef = useRef<DragMode>(null);
  const nextProjectileIdRef = useRef(1);
  const launchCountRef = useRef(0);
  const hitSpriteTimeoutRef = useRef<number | null>(null);

  const initialComponents = useMemo(() => {
    const angle = toRadians(angleDeg);
    return {
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  }, [angleDeg, speed]);

  const currentTrajectory = useMemo(() => {
    if (focusedProjectileId === null) {
      return null;
    }

    return (
      activeProjectiles.find((projectile) => projectile.id === focusedProjectileId) ??
      landedTrajectories.find((projectile) => projectile.id === focusedProjectileId) ??
      null
    );
  }, [activeProjectiles, focusedProjectileId, landedTrajectories]);

  const readoutMetrics = useMemo(() => {
    if (!currentTrajectory) {
      return { time: 0, range: 0, maxHeight: 0, miss: 0 };
    }

    return {
      time: currentTrajectory.t,
      range: currentTrajectory.x,
      maxHeight: currentTrajectory.maxHeight,
      miss: Math.abs(targetX - currentTrajectory.x),
    };
  }, [currentTrajectory, targetX]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const width = Math.max(340, Math.floor(element.clientWidth));
      const height = Math.max(340, Math.min(560, Math.round(width * 0.56)));
      setSize({ width, height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const image = new Image();
    hitSpriteRef.current = image;
    image.onload = () => setHitSpriteReady(true);
    image.src = HIT_SPRITE_SRC;

    return () => {
      image.onload = null;
      if (hitSpriteTimeoutRef.current !== null) {
        window.clearTimeout(hitSpriteTimeoutRef.current);
      }
    };
  }, []);

  const triggerHitSprite = useCallback(() => {
    if (hitSpriteTimeoutRef.current !== null) {
      window.clearTimeout(hitSpriteTimeoutRef.current);
    }

    setShowHitSprite(true);
    hitSpriteTimeoutRef.current = window.setTimeout(() => {
      setShowHitSprite(false);
      hitSpriteTimeoutRef.current = null;
    }, HIT_SPRITE_DURATION_MS);
  }, []);

  const launch = () => {
    const nextLaunchCount = launchCountRef.current + 1;
    const projectile = makeProjectile(
      angleDeg,
      speed,
      nextProjectileIdRef.current,
      nextLaunchCount,
    );
    const nextActiveProjectiles = [...activeProjectilesRef.current, projectile];
    const nextLandedTrajectories = pruneTrajectories(
      landedTrajectoriesRef.current,
      nextLaunchCount,
    );

    nextProjectileIdRef.current += 1;
    launchCountRef.current = nextLaunchCount;
    activeProjectilesRef.current = nextActiveProjectiles;
    landedTrajectoriesRef.current = nextLandedTrajectories;

    setLaunchCount(nextLaunchCount);
    setActiveProjectiles(cloneProjectiles(nextActiveProjectiles));
    setLandedTrajectories(cloneProjectiles(nextLandedTrajectories));
    setFocusedProjectileId(projectile.id);
    setPlaying(true);
  };

  const clear = () => {
    if (hitSpriteTimeoutRef.current !== null) {
      window.clearTimeout(hitSpriteTimeoutRef.current);
      hitSpriteTimeoutRef.current = null;
    }

    activeProjectilesRef.current = [];
    landedTrajectoriesRef.current = [];
    launchCountRef.current = 0;
    nextProjectileIdRef.current = 1;
    lastFrameRef.current = null;
    setActiveProjectiles([]);
    setLandedTrajectories([]);
    setFocusedProjectileId(null);
    setLaunchCount(0);
    setShowHitSprite(false);
    setPlaying(false);
  };

  const step = useCallback(
    (dt: number) => {
      const projectiles = activeProjectilesRef.current;
      if (projectiles.length === 0) {
        return;
      }

      const stillActive: ProjectileState[] = [];
      const newlyLanded: ProjectileState[] = [];

      projectiles.forEach((state) => {
        const previousX = state.x;
        const previousY = state.y;
        const previousT = state.t;
        const ax = -drag * state.vx;
        const ay = -gravity - drag * state.vy;

        state.vx += ax * dt;
        state.vy += ay * dt;
        state.x += state.vx * dt;
        state.y += state.vy * dt;
        state.t += dt;
        state.maxHeight = Math.max(state.maxHeight, state.y);
        state.path.push({ x: state.x, y: Math.max(0, state.y) });

        if (state.y <= 0 && state.t > 0.02) {
          const fraction =
            previousY === state.y
              ? 1
              : clamp(previousY / (previousY - state.y), 0, 1);
          state.x = lerp(previousX, state.x, fraction);
          state.y = 0;
          state.t = lerp(previousT, state.t, fraction);
          state.vx = 0;
          state.vy = 0;
          state.landed = true;
          state.path[state.path.length - 1] = { x: state.x, y: 0 };
          if (Math.abs(targetX - state.x) <= HIT_TOLERANCE_M && Math.random() < HIT_SPRITE_CHANCE) {
            triggerHitSprite();
          }
          newlyLanded.push(state);
          return;
        }

        stillActive.push(state);
      });

      activeProjectilesRef.current = stillActive;

      if (newlyLanded.length > 0) {
        landedTrajectoriesRef.current = pruneTrajectories(
          [...landedTrajectoriesRef.current, ...newlyLanded],
          launchCountRef.current,
        );
      }
    },
    [drag, gravity, targetX, triggerHitSprite],
  );

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = (timestamp - lastFrameRef.current) / 1000;
        const dt = Math.min(0.05, elapsed);
        const substeps = Math.max(1, Math.ceil(dt / (1 / 180)));
        for (let index = 0; index < substeps; index += 1) {
          step(dt / substeps);
        }
        setActiveProjectiles(cloneProjectiles(activeProjectilesRef.current));
        setLandedTrajectories(cloneProjectiles(landedTrajectoriesRef.current));

        if (activeProjectilesRef.current.length === 0) {
          setPlaying(false);
          rafRef.current = null;
          lastFrameRef.current = null;
          return;
        }
      }

      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [playing, step]);

  const getWorldViewport = useCallback(() => {
    const scale = (size.width - 84) / VIEWPORT_WIDTH_M;

    return {
      scale,
      rangeMax: VIEWPORT_WIDTH_M,
      heightMax: Math.max(0, (size.height - 76) / scale),
    };
  }, [size.height, size.width]);

  const worldToScreen = useCallback(
    (point: Point) => {
      const { scale } = getWorldViewport();
      return {
        x: 48 + point.x * scale,
        y: size.height - 42 - point.y * scale,
      };
    },
    [getWorldViewport, size.height],
  );

  const screenToWorld = useCallback(
    (x: number, y: number) => {
      const { scale } = getWorldViewport();
      return {
        x: (x - 48) / scale,
        y: (size.height - 42 - y) / scale,
      };
    },
    [getWorldViewport, size.height],
  );

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = getCssColor('--sim-bg', '#f8fafc');
    const panel = getCssColor('--bg-primary', '#ffffff');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const blue = getCssColor('--accent-blue', '#2563eb');
    const red = getCssColor('--accent-red', '#ef4444');
    const green = '#16a34a';
    const amber = '#d97706';
    const launcher = '#c2410c';

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

    const { rangeMax, heightMax, scale } = getWorldViewport();
    const groundY = size.height - 42;
    const stepMeters = GRID_STEP_M;

    if (showGrid) {
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let x = 0; x <= rangeMax; x += stepMeters) {
        const sx = worldToScreen({ x, y: 0 }).x;
        ctx.beginPath();
        ctx.moveTo(sx, 18);
        ctx.lineTo(sx, groundY + 6);
        ctx.stroke();
      }
      for (let y = 0; y <= heightMax; y += stepMeters) {
        const sy = worldToScreen({ x: 0, y }).y;
        ctx.beginPath();
        ctx.moveTo(34, sy);
        ctx.lineTo(size.width - 18, sy);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = green;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, groundY);
    ctx.lineTo(size.width - 18, groundY);
    ctx.stroke();

    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(48, 18);
    ctx.lineTo(48, groundY + 10);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.font = `12px ${FONT}`;
    for (let x = 0; x <= rangeMax; x += stepMeters * 2) {
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.fillText(`${x.toFixed(0)} m`, sx - 8, groundY + 20);
    }

    const target = worldToScreen({ x: targetX, y: 0 });
    ctx.strokeStyle = red;
    ctx.fillStyle = red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(target.x, target.y - 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - 44);
    ctx.lineTo(target.x + 18, target.y - 35);
    ctx.lineTo(target.x, target.y - 26);
    ctx.closePath();
    ctx.fill();

    if (showHitSprite && hitSpriteReady && hitSpriteRef.current) {
      const spriteSize = 24;
      const spriteGap = 10;
      const spriteX =
        target.x + spriteGap + spriteSize <= size.width - 18
          ? target.x + spriteGap
          : target.x - spriteGap - spriteSize;
      const spriteY = target.y - 44;
      ctx.drawImage(hitSpriteRef.current, spriteX, spriteY, spriteSize, spriteSize);
    }

    const drawPath = (path: Point[], color: string, alpha = 1, width = 2.5, dash: number[] = []) => {
      if (path.length < 2) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      path.forEach((point, index) => {
        const screen = worldToScreen(point);
        if (index === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      });
      ctx.stroke();
      ctx.restore();
    };

    landedTrajectories.forEach((trajectory) => {
      drawPath(
        trajectory.path,
        blue,
        getTrailOpacity(trajectory.launchIndex, launchCount),
        2.3,
        [8, 6],
      );
    });

    activeProjectiles.forEach((projectile) => {
      drawPath(projectile.path, blue, projectile.id === focusedProjectileId ? 1 : 0.68, 2.6);
    });

    const origin = worldToScreen({ x: 0, y: 0 });
    const launchTip = worldToScreen({
      x: initialComponents.vx * 0.72,
      y: initialComponents.vy * 0.72,
    });
    drawArrow(ctx, origin.x, origin.y, launchTip.x, launchTip.y, launcher, 3);
    ctx.fillStyle = launcher;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText('v0', launchTip.x + 8, launchTip.y - 8);

    activeProjectiles.forEach((projectile) => {
      const ball = worldToScreen({ x: projectile.x, y: projectile.y });
      ctx.save();
      ctx.globalAlpha = projectile.id === focusedProjectileId ? 1 : 0.72;
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    const focusedActiveProjectile =
      focusedProjectileId === null
        ? null
        : activeProjectiles.find((projectile) => projectile.id === focusedProjectileId) ?? null;

    if (focusedActiveProjectile) {
      const ball = worldToScreen({ x: focusedActiveProjectile.x, y: focusedActiveProjectile.y });
      drawArrow(
        ctx,
        ball.x,
        ball.y,
        ball.x + focusedActiveProjectile.vx * scale * 0.35,
        ball.y - focusedActiveProjectile.vy * scale * 0.35,
        blue,
        2,
      );
      drawArrow(ctx, ball.x, ball.y, ball.x, ball.y + gravity * scale * 0.52, amber, 2);
      ctx.fillStyle = text;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText('v', ball.x + 12, ball.y - 10);
      ctx.fillText('a', ball.x + 10, ball.y + 26);
    }

    ctx.fillStyle = text;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const focusedLandedProjectile =
      focusedProjectileId === null
        ? null
        : landedTrajectories.find((projectile) => projectile.id === focusedProjectileId) ?? null;

    if (focusedLandedProjectile) {
      const landing = worldToScreen({ x: focusedLandedProjectile.x, y: 0 });
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = red;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(landing.x, landing.y - 12);
      ctx.lineTo(target.x, target.y - 12);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = panel;
      ctx.strokeStyle = red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(landing.x, landing.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [
    activeProjectiles,
    focusedProjectileId,
    getWorldViewport,
    gravity,
    initialComponents.vx,
    initialComponents.vy,
    landedTrajectories,
    launchCount,
    showGrid,
    showHitSprite,
    hitSpriteReady,
    size.height,
    size.width,
    targetX,
    worldToScreen,
  ]);

  useEffect(() => {
    drawScene();
  }, [drawScene]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const target = worldToScreen({ x: targetX, y: 0 });
    const targetDistance = Math.hypot(px - target.x, py - (target.y - 26));

    dragModeRef.current = targetDistance < 30 ? 'target' : 'aim';
    event.currentTarget.setPointerCapture(event.pointerId);
    handlePointerMove(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!dragModeRef.current) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const point = screenToWorld(px, py);

    if (dragModeRef.current === 'target') {
      setTargetX(clamp(point.x, 4, VIEWPORT_WIDTH_M - 4));
      return;
    }

    setAngleDeg(clamp(toDegrees(Math.atan2(point.y, point.x)), 0, 88));
    setSpeed(clamp(Math.hypot(point.x, point.y) * 1.4, 2, 60));
  };

  const stopDragging = () => {
    dragModeRef.current = null;
  };

  return (
    <div ref={wrapperRef} className="flex h-full min-h-[42rem] flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]">
      <div className="grid gap-3 md:grid-cols-4">
        <Readout label="time" value={`${readoutMetrics.time.toFixed(2)} s`} />
        <Readout label="range" value={`${readoutMetrics.range.toFixed(1)} m`} />
        <Readout label="max height" value={`${readoutMetrics.maxHeight.toFixed(1)} m`} />
        <Readout label="miss" value={`${readoutMetrics.miss.toFixed(1)} m`} />
      </div>

      <canvas
        ref={canvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Projectile launcher with draggable launch vector and target flag"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={stopDragging}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Control label={`Angle ${angleDeg.toFixed(1)} deg`}>
            <input className="w-full accent-[var(--accent-blue)]" type="range" min={0} max={88} step={0.1} value={angleDeg} onChange={(event) => setAngleDeg(Number(event.currentTarget.value))} />
          </Control>
          <Control label={`Speed ${speed.toFixed(1)} m/s`}>
            <input className="w-full accent-[var(--accent-blue)]" type="range" min={2} max={60} step={0.1} value={speed} onChange={(event) => setSpeed(Number(event.currentTarget.value))} />
          </Control>
          <Control label={`Gravity ${gravity.toFixed(1)} m/s^2`}>
            <input className="w-full accent-[var(--accent-blue)]" type="range" min={1} max={20} step={0.1} value={gravity} onChange={(event) => setGravity(Number(event.currentTarget.value))} />
          </Control>
          <Control label={`Air drag ${drag.toFixed(2)} s^-1`}>
            <input className="w-full accent-[var(--accent-blue)]" type="range" min={0} max={0.7} step={0.01} value={drag} onChange={(event) => setDrag(Number(event.currentTarget.value))} />
          </Control>
        </div>

        <div className="flex flex-col gap-3 border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button type="button" title="Launch" onClick={launch} className={buttonClass}>
              <Play className="h-4 w-4" />
              Launch
            </button>
            <button type="button" title={playing ? 'Pause' : 'Resume'} onClick={() => setPlaying((value) => (activeProjectiles.length > 0 ? !value : value))} className={buttonClass} disabled={activeProjectiles.length === 0}>
              <Pause className="h-4 w-4" />
              {playing ? 'Pause' : 'Resume'}
            </button>
            <button type="button" title="Clear trajectories" onClick={clear} className={buttonClass}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]">
            <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.currentTarget.checked)} className="accent-[var(--accent-blue)]" />
            Grid
          </label>
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Target className="h-4 w-4 text-[var(--accent-red)]" />
            Drag the flag to set a target.
          </div>
        </div>
      </div>
    </div>
  );
}

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50';

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <span className="mb-2 block text-sm font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  lineWidth = 2,
) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = Math.max(11, lineWidth * 4.5);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
