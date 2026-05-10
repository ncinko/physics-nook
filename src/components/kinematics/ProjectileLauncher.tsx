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
const INITIAL_PROJECTILE: ProjectileState = {
  t: 0,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  path: [],
  landed: false,
  maxHeight: 0,
};

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

const makeProjectile = (angleDeg: number, speed: number): ProjectileState => {
  const angle = toRadians(angleDeg);
  return {
    ...INITIAL_PROJECTILE,
    vx: speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
  };
};

const niceStep = (target: number) => {
  const power = 10 ** Math.floor(Math.log10(Math.max(0.0001, target)));
  const candidates = [1, 2, 5, 10].map((value) => value * power);
  return candidates.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  );
};

export default function ProjectileLauncher() {
  const [size, setSize] = useState<Size>({ width: 860, height: 480 });
  const [angleDeg, setAngleDeg] = useState(42);
  const [speed, setSpeed] = useState(24);
  const [gravity, setGravity] = useState(9.8);
  const [drag, setDrag] = useState(0);
  const [targetX, setTargetX] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapshot, setSnapshot] = useState<ProjectileState>(() => makeProjectile(42, 24));
  const [previousPath, setPreviousPath] = useState<Point[]>([]);
  const [metrics, setMetrics] = useState({ time: 0, range: 0, maxHeight: 0 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectileRef = useRef<ProjectileState>(makeProjectile(angleDeg, speed));
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const dragModeRef = useRef<DragMode>(null);

  const initialComponents = useMemo(() => {
    const angle = toRadians(angleDeg);
    return {
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  }, [angleDeg, speed]);

  const preview = useMemo(() => {
    const tof = gravity > 0 ? (2 * initialComponents.vy) / gravity : 0;
    return {
      time: Math.max(0, tof),
      range: Math.max(0, initialComponents.vx * tof),
      maxHeight:
        gravity > 0 ? (initialComponents.vy * initialComponents.vy) / (2 * gravity) : 0,
    };
  }, [gravity, initialComponents.vx, initialComponents.vy]);

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

  const prime = useCallback(() => {
    const projectile = makeProjectile(angleDeg, speed);
    projectileRef.current = projectile;
    setSnapshot({ ...projectile, path: [...projectile.path] });
    setMetrics({ time: 0, range: 0, maxHeight: 0 });
    setLaunched(false);
    setPlaying(false);
  }, [angleDeg, speed]);

  useEffect(() => {
    if (!launched) {
      projectileRef.current = makeProjectile(angleDeg, speed);
      setSnapshot({ ...projectileRef.current, path: [] });
    }
  }, [angleDeg, speed, launched]);

  const launch = () => {
    const projectile = makeProjectile(angleDeg, speed);
    projectileRef.current = projectile;
    setSnapshot({ ...projectile, path: [] });
    setMetrics({ time: 0, range: 0, maxHeight: 0 });
    setLaunched(true);
    setPlaying(true);
  };

  const clear = () => {
    setPreviousPath([]);
    prime();
  };

  const step = useCallback(
    (dt: number) => {
      const state = projectileRef.current;
      if (state.landed) {
        return;
      }

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
        const last = state.path[state.path.length - 1];
        const previous = state.path[state.path.length - 2] ?? { x: 0, y: 0 };
        const fraction = previous.y === last.y ? 1 : clamp(previous.y / (previous.y - last.y), 0, 1);
        state.x = lerp(previous.x, last.x, fraction);
        state.y = 0;
        state.vx = 0;
        state.vy = 0;
        state.landed = true;
        state.path[state.path.length - 1] = { x: state.x, y: 0 };
        setPlaying(false);
        setMetrics({ time: state.t, range: state.x, maxHeight: state.maxHeight });
        setPreviousPath([{ x: 0, y: 0 }, ...state.path]);
      }
    },
    [drag, gravity],
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
        const current = projectileRef.current;
        setSnapshot({ ...current, path: [...current.path] });
      }

      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [playing, step]);

  const getWorldWindow = useCallback(() => {
    const rangeMax = Math.max(70, targetX + 16, preview.range + 14, snapshot.x + 14);
    const heightMax = Math.max(32, preview.maxHeight + 10, snapshot.maxHeight + 10);
    const scale = Math.min((size.width - 84) / rangeMax, (size.height - 76) / heightMax);
    return { scale: Math.max(3.2, scale), rangeMax, heightMax };
  }, [preview.maxHeight, preview.range, size.height, size.width, snapshot.maxHeight, snapshot.x, targetX]);

  const worldToScreen = useCallback(
    (point: Point) => {
      const { scale } = getWorldWindow();
      return {
        x: 48 + point.x * scale,
        y: size.height - 42 - point.y * scale,
      };
    },
    [getWorldWindow, size.height],
  );

  const screenToWorld = useCallback(
    (x: number, y: number) => {
      const { scale } = getWorldWindow();
      return {
        x: (x - 48) / scale,
        y: (size.height - 42 - y) / scale,
      };
    },
    [getWorldWindow, size.height],
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

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

    const { rangeMax, heightMax, scale } = getWorldWindow();
    const groundY = size.height - 42;
    const stepMeters = niceStep(48 / scale);

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

    const drawPath = (path: Point[], color: string, alpha = 1, width = 2.5) => {
      if (path.length < 2) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
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

    drawPath(previousPath, blue, 0.3, 2.4);
    drawPath([{ x: 0, y: 0 }, ...snapshot.path], blue, 1, 2.6);

    if (!launched) {
      const origin = worldToScreen({ x: 0, y: 0 });
      const tip = worldToScreen({ x: initialComponents.vx * 0.72, y: initialComponents.vy * 0.72 });
      drawArrow(ctx, origin.x, origin.y, tip.x, tip.y, blue, 3);
    }

    if (launched && !snapshot.landed) {
      const ball = worldToScreen({ x: snapshot.x, y: snapshot.y });
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
      ctx.fill();
      drawArrow(ctx, ball.x, ball.y, ball.x + snapshot.vx * scale * 0.35, ball.y - snapshot.vy * scale * 0.35, blue, 2);
      drawArrow(ctx, ball.x, ball.y, ball.x, ball.y + gravity * scale * 0.52, amber, 2);
      ctx.fillStyle = text;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText('v', ball.x + 12, ball.y - 10);
      ctx.fillText('a', ball.x + 10, ball.y + 26);
    }

    const origin = worldToScreen({ x: 0, y: 0 });
    ctx.fillStyle = text;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, Math.PI * 2);
    ctx.fill();

    if (snapshot.landed) {
      const landing = worldToScreen({ x: snapshot.x, y: 0 });
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
    getWorldWindow,
    gravity,
    initialComponents.vx,
    initialComponents.vy,
    launched,
    previousPath,
    showGrid,
    size.height,
    size.width,
    snapshot.landed,
    snapshot.path,
    snapshot.vx,
    snapshot.vy,
    snapshot.x,
    snapshot.y,
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
      setTargetX(clamp(point.x, 4, 180));
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
        <Readout label="time" value={`${(snapshot.landed ? metrics.time : snapshot.t).toFixed(2)} s`} />
        <Readout label="range" value={`${(snapshot.landed ? metrics.range : preview.range).toFixed(1)} m`} />
        <Readout label="max height" value={`${(snapshot.landed ? metrics.maxHeight : preview.maxHeight).toFixed(1)} m`} />
        <Readout label="miss" value={`${Math.abs(targetX - (snapshot.landed ? snapshot.x : preview.range)).toFixed(1)} m`} />
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
            <button type="button" title={playing ? 'Pause' : 'Resume'} onClick={() => setPlaying((value) => (launched ? !value : value))} className={buttonClass} disabled={!launched || snapshot.landed}>
              <Pause className="h-4 w-4" />
              {playing ? 'Pause' : 'Resume'}
            </button>
            <button type="button" title="Clear trace" onClick={clear} className={buttonClass}>
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
  const head = 9;

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
