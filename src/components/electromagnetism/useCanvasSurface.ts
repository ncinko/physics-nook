import { useEffect, useRef, useState } from 'react';

// Shared plumbing for the 2D canvas islands in this folder: a container that
// holds a fixed aspect ratio, a canvas that fills it, and a CSS-pixel size that
// follows the container. `prepareCanvas` sizes the backing store for the
// device pixel ratio and returns a context whose units are CSS pixels.

export interface CanvasSize {
  width: number;
  height: number;
}

export function useCanvasSurface() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () =>
      setSize((previous) => {
        const width = Math.round(container.clientWidth);
        const height = Math.round(container.clientHeight);
        return previous.width === width && previous.height === height ? previous : { width, height };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, canvasRef, size };
}

export function prepareCanvas(canvas: HTMLCanvasElement | null, size: CanvasSize): CanvasRenderingContext2D | null {
  if (!canvas || size.width === 0 || size.height === 0) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(size.width * dpr);
  const pixelHeight = Math.round(size.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  return ctx;
}

/** Tracks the reader's reduced-motion preference so animations can start paused. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const update = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Pointer position in CSS pixels relative to an element's top-left corner. */
export function pointerPosition(event: { clientX: number; clientY: number }, element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Draw an arrowhead-tipped line from (x1, y1) to (x2, y2) in the current stroke/fill style. */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLength: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const shaftEndX = x2 - Math.cos(angle) * headLength * 0.6;
  const shaftEndY = y2 - Math.sin(angle) * headLength * 0.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 7), y2 - headLength * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 7), y2 - headLength * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Mark a current's direction: a dot for out of the page, a cross for into it. */
export function drawCurrentMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outOfPage: boolean,
  radius: number,
) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (outOfPage) {
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const d = radius * 0.62;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x - d, y + d);
    ctx.lineTo(x + d, y - d);
    ctx.stroke();
  }
}
