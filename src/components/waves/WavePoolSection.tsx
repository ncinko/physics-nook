import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface GridState {
  previous: Float32Array;
  current: Float32Array;
  next: Float32Array;
}

interface PoolSize {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  lastX: number;
  lastY: number;
  lastAt: number;
}

const MIN_COLS = 52;
const MAX_COLS = 132;
const MIN_ROWS = 28;
const MAX_ROWS = 88;
const CELL_TARGET = 14;
const DRAG_INTERVAL_MS = 65;
const DAMPING = 0.9976;
const SIDE_DAMPING_LAYER_CELLS = 10;
const SIDE_DAMPING_MAX = 0.18;
const VERTICAL_DAMPING_LAYER_CELLS = 5;
const VERTICAL_DAMPING_MAX = 0.82;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const createGridState = (cols: number, rows: number): GridState => {
  const size = cols * rows;
  return {
    previous: new Float32Array(size),
    current: new Float32Array(size),
    next: new Float32Array(size),
  };
};

const emptyDragState = (): DragState => ({
  active: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
  lastAt: 0,
});

const getPointInElement = (element: HTMLDivElement, event: ReactPointerEvent<HTMLDivElement>) => {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const addSplash = (
  grid: GridState,
  size: PoolSize,
  x: number,
  y: number,
  strength: number,
) => {
  const gridX = Math.round((x / Math.max(size.width, 1)) * (size.cols - 1));
  const gridY = Math.round((y / Math.max(size.height, 1)) * (size.rows - 1));
  const radius = clamp(Math.round(Math.min(size.cols, size.rows) * 0.08), 2, 6);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const row = gridY + dy;
    if (row < 1 || row >= size.rows - 1) continue;

    for (let dx = -radius; dx <= radius; dx += 1) {
      const col = gridX + dx;
      if (col < 1 || col >= size.cols - 1) continue;

      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      const falloff = Math.cos((distance / radius) * Math.PI * 0.5) ** 2;
      const index = row * size.cols + col;
      grid.current[index] += strength * falloff;
    }
  }
};

export default function WavePoolSection({ children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const sizeRef = useRef<PoolSize>({
    width: 0,
    height: 0,
    cols: 0,
    rows: 0,
    cellWidth: 0,
    cellHeight: 0,
  });
  const gridRef = useRef<GridState>(createGridState(MIN_COLS, MIN_ROWS));
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

    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      dpr = window.devicePixelRatio || 1;

      const cols = clamp(Math.round(width / CELL_TARGET), MIN_COLS, MAX_COLS);
      const rows = clamp(Math.round(height / CELL_TARGET), MIN_ROWS, MAX_ROWS);

      sizeRef.current = {
        width,
        height,
        cols,
        rows,
        cellWidth: width / cols,
        cellHeight: height / rows,
      };

      gridRef.current = createGridState(cols, rows);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const step = () => {
      const size = sizeRef.current;
      const grid = gridRef.current;
      const { cols, rows } = size;

      if (!cols || !rows) {
        return;
      }

      const { previous, current, next } = grid;

      for (let row = 1; row < rows - 1; row += 1) {
        for (let col = 1; col < cols - 1; col += 1) {
          const index = row * cols + col;
          let nextValue =
            (((current[index - 1] + current[index + 1] + current[index - cols] + current[index + cols]) * 0.5) -
              previous[index]) *
            DAMPING;

          const sideDistance = Math.min(col, cols - 1 - col);
          if (sideDistance < SIDE_DAMPING_LAYER_CELLS) {
            const normalized = (SIDE_DAMPING_LAYER_CELLS - sideDistance) / SIDE_DAMPING_LAYER_CELLS;
            nextValue *= 1 - normalized * normalized * SIDE_DAMPING_MAX;
          }

          const verticalDistance = Math.min(row, rows - 1 - row);
          if (verticalDistance < VERTICAL_DAMPING_LAYER_CELLS) {
            const normalized =
              (VERTICAL_DAMPING_LAYER_CELLS - verticalDistance) / VERTICAL_DAMPING_LAYER_CELLS;
            nextValue *= 1 - normalized * normalized * VERTICAL_DAMPING_MAX;
          }

          next[index] = nextValue;
        }
      }

      for (let col = 0; col < cols; col += 1) {
        next[col] = 0;
        next[cols + col] *= 0.8;
        next[(rows - 1) * cols + col] = 0;
        next[(rows - 2) * cols + col] *= 0.8;
      }

      for (let row = 0; row < rows; row += 1) {
        next[row * cols] = next[row * cols + 1];
        next[row * cols + cols - 1] = next[row * cols + cols - 2];
      }

      grid.previous = current;
      grid.current = next;
      grid.next = previous;
    };

    const draw = (timestamp: number) => {
      const size = sizeRef.current;
      const grid = gridRef.current;
      const { cols, rows, width, height, cellWidth, cellHeight } = size;
      const { current } = grid;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!cols || !rows) {
        animationRef.current = window.requestAnimationFrame(draw);
        return;
      }

      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      const darkMode = theme === 'dark';

      for (let row = 1; row < rows - 1; row += 1) {
        for (let col = 1; col < cols - 1; col += 1) {
          const index = row * cols + col;
          const value = current[index];
          const magnitude = Math.abs(value);

          if (magnitude < 0.01) {
            continue;
          }

          const slopeX = current[index + 1] - current[index - 1];
          const slopeY = current[index + cols] - current[index - cols];
          const shimmer = clamp(0.5 + slopeX * 0.7 - slopeY * 0.55, 0, 1);
          const alpha = clamp(0.06 + magnitude * 0.12, 0.05, 0.34);

          const x = col * cellWidth;
          const y = row * cellHeight;

          if (value >= 0) {
            const r = darkMode ? Math.round(44 + shimmer * 26) : Math.round(92 + shimmer * 70);
            const g = darkMode ? Math.round(116 + shimmer * 34) : Math.round(164 + shimmer * 42);
            const b = darkMode ? Math.round(184 + shimmer * 22) : 248;
            context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          } else {
            const r = darkMode ? Math.round(22 + shimmer * 18) : Math.round(15 + shimmer * 22);
            const g = darkMode ? Math.round(92 + shimmer * 24) : Math.round(118 + shimmer * 20);
            const b = darkMode ? Math.round(126 + shimmer * 18) : Math.round(128 + shimmer * 26);
            context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.92})`;
          }

          context.fillRect(x, y, cellWidth + 1, cellHeight + 1);
        }
      }

      context.save();
      context.strokeStyle = darkMode ? 'rgba(148, 197, 255, 0.1)' : 'rgba(255, 255, 255, 0.22)';
      context.lineWidth = 1.1;

      for (let row = 0; row < 11; row += 1) {
        const y = height * 0.08 + row * ((height * 0.84) / 10);
        context.beginPath();
        context.moveTo(0, y);

        for (let x = 0; x <= width; x += Math.max(cellWidth * 1.2, 10)) {
          const col = clamp(Math.round((x / width) * (cols - 1)), 1, cols - 2);
          const mappedRow = clamp(Math.round((y / height) * (rows - 1)), 1, rows - 2);
          const wave = current[mappedRow * cols + col] * 9;
          context.lineTo(x, y + wave);
        }

        context.stroke();
      }
      context.restore();

      step();
      animationRef.current = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    animationRef.current = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();

      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      animationRef.current = null;
    };
  }, []);

  const spawnRipple = (x: number, y: number, strength: number) => {
    addSplash(gridRef.current, sizeRef.current, x, y, strength);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const point = getPointInElement(container, event);
    spawnRipple(point.x, point.y, 2.2);

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: point.x,
      lastY: point.y,
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

    const point = getPointInElement(container, event);
    const now = performance.now();
    const distance = Math.hypot(point.x - dragRef.current.lastX, point.y - dragRef.current.lastY);

    if (distance > 24 && now - dragRef.current.lastAt > DRAG_INTERVAL_MS) {
      spawnRipple(point.x, point.y, 1.2);
      dragRef.current.lastX = point.x;
      dragRef.current.lastY = point.y;
      dragRef.current.lastAt = now;
    }
  };

  const finishDrag = (pointerId: number) => {
    if (dragRef.current.pointerId !== pointerId) {
      return;
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
      className="relative isolate my-8 min-h-[34rem] max-w-none overflow-hidden"
      style={{ touchAction: 'none', marginInline: 'calc(50% - 50vw)' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label="Interactive wave pool; click or drag to create disturbances"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.18),transparent_34%),radial-gradient(circle_at_78%_26%,rgba(14,165,233,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(15,118,110,0.16),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--bg-primary)_84%,transparent),color-mix(in_srgb,var(--sim-bg)_76%,transparent))]" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[min(94vw,54rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,color-mix(in_srgb,var(--bg-primary)_38%,transparent),color-mix(in_srgb,var(--bg-primary)_14%,transparent)_56%,transparent_80%)] blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--bg-primary)_76%,transparent),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--bg-primary)_70%,transparent),transparent)]" />

      <div className="relative z-10 mx-auto flex min-h-[34rem] w-full max-w-4xl items-center px-4 py-6 md:px-6 md:py-8">
        <div className="mx-auto max-w-[65ch] [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0">
          {children}
        </div>
      </div>
    </section>
  );
}
