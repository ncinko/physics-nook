import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';

type Size = {
  width: number;
  height: number;
};

type Geometry = {
  originX: number;
  originY: number;
  zoom: number;
};

const ANGLE_MIN = 0;
const ANGLE_MAX = 90;
const SPEED_MIN = 0;
const SPEED_MAX = 60;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  lineWidth = 3,
) => {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 10;

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
};

export default function LaunchDecomposition() {
  const [angleDeg, setAngleDeg] = useState(35);
  const [speed, setSpeed] = useState(34);
  const [size, setSize] = useState<Size>({ width: 760, height: 420 });
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometryRef = useRef<Geometry>({ originX: 64, originY: 340, zoom: 8 });
  const draggingRef = useRef(false);

  const components = useMemo(() => {
    const angle = toRadians(angleDeg);
    return {
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  }, [angleDeg, speed]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const width = Math.max(320, Math.floor(element.clientWidth));
      const height = Math.max(310, Math.min(460, Math.round(width * 0.55)));
      setSize({ width, height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
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
    ctx.clearRect(0, 0, size.width, size.height);

    const panel = getCssColor('--bg-primary', '#ffffff');
    const simBg = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const blue = getCssColor('--accent-blue', '#2563eb');
    const red = getCssColor('--accent-red', '#ef4444');
    const green = '#16a34a';
    const amber = '#d97706';

    const originX = 68;
    const originY = size.height - 54;
    const availableX = size.width - originX - 44;
    const availableY = originY - 28;
    const zoom = Math.min(availableX / SPEED_MAX, availableY / SPEED_MAX);
    geometryRef.current = { originX, originY, zoom };

    const endX = originX + components.vx * zoom;
    const endY = originY - components.vy * zoom;
    const xEnd = originX + components.vx * zoom;
    const yEnd = originY - components.vy * zoom;

    ctx.fillStyle = simBg;
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = originX; x <= size.width - 24; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, originY);
      ctx.stroke();
    }
    for (let y = originY; y >= 18; y -= 42) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(size.width - 20, y);
      ctx.stroke();
    }

    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, originY);
    ctx.lineTo(size.width - 20, originY);
    ctx.moveTo(originX, size.height - 22);
    ctx.lineTo(originX, 18);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.font = `13px ${FONT}`;
    ctx.fillText('x', size.width - 30, originY - 8);
    ctx.fillText('y', originX + 8, 30);

    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(xEnd, originY);
    ctx.lineTo(xEnd, yEnd);
    ctx.stroke();
    ctx.restore();

    drawArrow(ctx, originX, originY, xEnd, originY, green, 3);
    drawArrow(ctx, xEnd, originY, xEnd, yEnd, amber, 3);
    drawArrow(ctx, originX, originY, endX, endY, blue, 3.4);

    const arcRadius = 42;
    ctx.strokeStyle = text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(originX, originY, arcRadius, 0, -toRadians(angleDeg), true);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText('theta', originX + 48, originY - 16);

    ctx.fillStyle = blue;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText('v0', endX + 10, endY - 10);
    ctx.fillStyle = green;
    ctx.fillText('v0x', (originX + xEnd) / 2 - 12, originY - 10);
    ctx.fillStyle = amber;
    ctx.fillText('v0y', xEnd + 10, (originY + yEnd) / 2);

    ctx.fillStyle = text;
    ctx.beginPath();
    ctx.arc(originX, originY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = panel;
    ctx.strokeStyle = red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(endX, endY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }, [angleDeg, components.vx, components.vy, size]);

  const updateFromPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const { originX, originY, zoom } = geometryRef.current;
    const dx = px - originX;
    const dy = originY - py;

    setAngleDeg(clamp(toDegrees(Math.atan2(dy, dx)), ANGLE_MIN, ANGLE_MAX));
    setSpeed(clamp(Math.hypot(dx, dy) / Math.max(zoom, 0.001), SPEED_MIN, SPEED_MAX));
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) {
      return;
    }

    updateFromPointer(event);
  };

  const stopDragging = () => {
    draggingRef.current = false;
  };

  return (
    <div ref={wrapperRef} className="flex h-full min-h-[34rem] flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]">
      <div className="grid gap-3 md:grid-cols-3">
        <Readout label="Launch speed" value={`${speed.toFixed(1)} m/s`} accent="var(--accent-blue)" />
        <Readout label="Horizontal component" value={`${components.vx.toFixed(1)} m/s`} accent="#16a34a" />
        <Readout label="Vertical component" value={`${components.vy.toFixed(1)} m/s`} accent="#d97706" />
      </div>

      <canvas
        ref={canvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Launch velocity vector decomposed into horizontal and vertical components"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={stopDragging}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Control label={`Angle ${angleDeg.toFixed(1)} deg`}>
          <input
            type="range"
            min={ANGLE_MIN}
            max={ANGLE_MAX}
            step={0.1}
            value={angleDeg}
            onChange={(event) => setAngleDeg(Number(event.currentTarget.value))}
            className="w-full accent-[var(--accent-blue)]"
          />
        </Control>
        <Control label={`Speed ${speed.toFixed(1)} m/s`}>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.1}
            value={speed}
            onChange={(event) => setSpeed(Number(event.currentTarget.value))}
            className="w-full accent-[var(--accent-blue)]"
          />
        </Control>
      </div>
    </div>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold" style={{ color: accent }}>
        {value}
      </div>
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
