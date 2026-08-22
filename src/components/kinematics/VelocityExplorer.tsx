import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SAMPLE_T_MAX,
  SAMPLE_T_MIN,
  accelerationOfT,
  clampSampleT,
  pathLengthOfT,
  positionOfT,
  velocityOfT,
} from '../../lib/kinematics/sampleMotion';
import { hedgehogGait } from '../../lib/kinematics/hedgehogGait';
import { drawHedgehogFrame } from './HedgehogSprite';
import { HEDGEHOG_CELL_H, HEDGEHOG_SHEET_SRC } from './hedgehogSheet';
import { fixed } from '../../utils/format';

type Size = {
  w: number;
  h: number;
};

type DragTarget = 't1' | 't2' | 't0' | 'play' | null;

const FONT_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const T_MIN = SAMPLE_T_MIN;
const T_MAX = SAMPLE_T_MAX;
const Y_MIN = 0;
const Y_MAX = 10;
const PAD_L = 64;
const PAD_R = 104;
const PAD_T = 30;
const PAD_B = 58;

const clampT = clampSampleT;

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 10,
) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

export default function VelocityExplorer() {
  const [t1, setT1] = useState(2);
  const [t2, setT2] = useState(9);
  const [t0, setT0] = useState(5);
  const [tMotion, setTMotion] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragVersion, setDragVersion] = useState(0);
  const [sheetReady, setSheetReady] = useState(false);
  const [size, setSize] = useState<Size>({ w: 860, h: 520 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const velocityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const draggingRef = useRef<DragTarget>(null);
  const velocityDraggingRef = useRef(false);
  const playButtonRef = useRef({ x: 18, y: 18, r: 18 });
  const sheetRef = useRef<HTMLImageElement | null>(null);
  const railFacingRef = useRef<1 | -1>(1);
  const velocityGeometryRef = useRef({ left: PAD_L, right: PAD_R, top: 14, bottom: 42 });

  const xPix = (t: number) =>
    PAD_L + ((t - T_MIN) / (T_MAX - T_MIN)) * (size.w - PAD_L - PAD_R);
  const yPix = (x: number) =>
    size.h - PAD_B - ((x - Y_MIN) / (Y_MAX - Y_MIN)) * (size.h - PAD_T - PAD_B);

  const averageVelocity = useMemo(
    () => (positionOfT(t2) - positionOfT(t1)) / (t2 - t1),
    [t1, t2],
  );
  const instantVelocity = useMemo(() => velocityOfT(t0), [t0]);
  const velocityPlotHeight = Math.max(220, Math.floor(size.h * 0.5));

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const width = Math.max(340, Math.floor(element.clientWidth));
      const height = Math.max(290, Math.floor((width * 5) / 8));
      setSize({ w: width, h: height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const dt = (timestamp - lastFrameRef.current) / 1000;
        setTMotion((current) => ((current + dt - T_MIN) % (T_MAX - T_MIN)) + T_MIN);
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
  }, [isPlaying]);

  useEffect(() => {
    const image = new Image();
    image.src = HEDGEHOG_SHEET_SRC;
    image.onload = () => {
      sheetRef.current = image;
      setSheetReady(true);
    };
    return () => {
      image.onload = null;
    };
  }, []);

  useEffect(() => {
    drawPositionPlot();
    drawVelocityPlot(t0);
  }, [t1, t2, t0, tMotion, isPlaying, size, dragVersion, sheetReady]);

  const drawPositionPlot = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = getCssColor('--bg-primary', '#ffffff');
    const panel = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const blue = getCssColor('--accent-blue', '#3b82f6');
    const red = getCssColor('--accent-red', '#ef4444');
    const green = '#16a34a';

    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, size.w, size.h);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const t = T_MIN + (i / 10) * (T_MAX - T_MIN);
      const x = xPix(t);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, size.h - PAD_B);
      ctx.stroke();
    }
    for (let i = 0; i <= Y_MAX; i += 1) {
      const y = yPix(i);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(size.w - PAD_R, y);
      ctx.stroke();
    }

    ctx.strokeStyle = text;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(PAD_L, size.h - PAD_B);
    ctx.lineTo(size.w - PAD_R, size.h - PAD_B);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, size.h - PAD_B);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('time (s)', (PAD_L + size.w - PAD_R) / 2, size.h - 16);
    ctx.save();
    ctx.translate(18, (PAD_T + size.h - PAD_B) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('position (m)', 0, 0);
    ctx.restore();

    ctx.font = `14px ${FONT_FAMILY}`;
    for (let i = 1; i <= 10; i += 1) {
      ctx.fillText(String(i), xPix(i), size.h - PAD_B + 20);
    }
    ctx.textAlign = 'right';
    for (let i = 1; i <= Y_MAX; i += 1) {
      ctx.fillText(String(i), PAD_L - 8, yPix(i) + 4);
    }

    ctx.strokeStyle = blue;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i <= 512; i += 1) {
      const t = T_MIN + (i / 512) * (T_MAX - T_MIN);
      const x = xPix(t);
      const y = yPix(positionOfT(t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const x1 = xPix(t1);
    const y1 = yPix(positionOfT(t1));
    const x2 = xPix(t2);
    const y2 = yPix(positionOfT(t2));
    ctx.save();
    ctx.strokeStyle = red;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = red;
    ctx.font = `600 14px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`avg v = ${fixed(averageVelocity)} m/s`, (x1 + x2) / 2, (y1 + y2) / 2 + 30);
    ctx.restore();

    const slope = instantVelocity;
    const xAtT0 = xPix(t0);
    const yAtT0 = yPix(positionOfT(t0));
    const yLeft = yPix(positionOfT(t0) + slope * (T_MIN - t0));
    const yRight = yPix(positionOfT(t0) + slope * (T_MAX - t0));
    ctx.save();
    ctx.strokeStyle = green;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(xPix(T_MIN), yLeft);
    ctx.lineTo(xPix(T_MAX), yRight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#166534';
    ctx.font = `600 14px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`v(t) = ${fixed(instantVelocity)} m/s`, xAtT0, Math.max(24, yAtT0 - 28));
    ctx.restore();

    drawHandle(ctx, x1, y1, red);
    drawHandle(ctx, x2, y2, red);
    drawHandle(ctx, xAtT0, yAtT0, green);

    if (draggingRef.current && draggingRef.current !== 'play') {
      const activeTime = draggingRef.current === 't1' ? t1 : draggingRef.current === 't2' ? t2 : t0;
      const activePosition = positionOfT(activeTime);
      const x = xPix(activeTime);
      const y = yPix(activePosition);
      ctx.save();
      ctx.strokeStyle = muted;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, size.h - PAD_B);
      ctx.moveTo(x, y);
      ctx.lineTo(PAD_L, y);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = `13px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText(activeTime.toFixed(2), x, size.h - PAD_B - 8);
      ctx.textAlign = 'left';
      ctx.fillText(fixed(activePosition), PAD_L + 8, y + 4);
      ctx.restore();
    }

    const motionX = xPix(tMotion);
    const motionY = yPix(positionOfT(tMotion));
    ctx.fillStyle = blue;
    ctx.beginPath();
    ctx.arc(motionX, motionY, 5, 0, Math.PI * 2);
    ctx.fill();
    // The rail runs vertically because position is the vertical axis here, so
    // the hedgehog is turned a quarter turn and climbs it: a quarter turn
    // anticlockwise puts its snout along +position, and the gait flip reverses
    // that when the motion does.
    const railX = size.w - 48;
    const railY = Math.max(PAD_T, Math.min(size.h - PAD_B, motionY));
    const sheet = sheetRef.current;
    if (sheet) {
      const pose = hedgehogGait({
        distance: pathLengthOfT(tMotion),
        velocity: velocityOfT(tMotion),
        acceleration: accelerationOfT(tMotion),
        previousFacing: railFacingRef.current,
      });
      railFacingRef.current = pose.facing;
      drawHedgehogFrame(ctx, sheet, pose.frame, {
        x: railX + HEDGEHOG_CELL_H / 2,
        y: railY,
        facing: pose.facing,
        rotate: -Math.PI / 2,
      });
    }

    // Down in the bottom-left corner, clear of the rail: the hedgehog needs the
    // full height of the right-hand margin to itself.
    playButtonRef.current = { x: PAD_L + 18, y: size.h - PAD_B + 26, r: 18 };
    ctx.fillStyle = bg;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(playButtonRef.current.x, playButtonRef.current.y, playButtonRef.current.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = text;
    if (isPlaying) {
      roundRect(ctx, playButtonRef.current.x - 6, playButtonRef.current.y - 8, 4, 16, 1);
      ctx.fill();
      roundRect(ctx, playButtonRef.current.x + 3, playButtonRef.current.y - 8, 4, 16, 1);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(playButtonRef.current.x - 5, playButtonRef.current.y - 8);
      ctx.lineTo(playButtonRef.current.x - 5, playButtonRef.current.y + 8);
      ctx.lineTo(playButtonRef.current.x + 9, playButtonRef.current.y);
      ctx.closePath();
      ctx.fill();
    }
  };

  const drawVelocityPlot = (markerTime: number) => {
    const canvas = velocityCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = size.w;
    const height = velocityPlotHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const panel = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const green = '#16a34a';
    const left = PAD_L;
    const right = PAD_R;
    const top = 16;
    const bottom = 42;
    velocityGeometryRef.current = { left, right, top, bottom };
    const xMap = (t: number) => left + ((t - T_MIN) / (T_MAX - T_MIN)) * (width - left - right);
    const yMap = (v: number) => height - bottom - ((v + 2) / 5) * (height - top - bottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const x = xMap(i);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, height - bottom);
      ctx.stroke();
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(left, yMap(0));
    ctx.lineTo(width - right, yMap(0));
    ctx.stroke();

    ctx.strokeStyle = text;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(left, height - bottom);
    ctx.lineTo(width - right, height - bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, height - bottom);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('time (s)', (left + width - right) / 2, height - 10);
    ctx.save();
    ctx.translate(18, (top + height - bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('velocity (m/s)', 0, 0);
    ctx.restore();

    ctx.font = `14px ${FONT_FAMILY}`;
    for (let i = 1; i <= 10; i += 1) {
      ctx.fillText(String(i), xMap(i), height - bottom + 19);
    }
    ctx.textAlign = 'right';
    [-2, -1, 0, 1, 2, 3].forEach((v) => {
      ctx.fillText(v.toFixed(1), left - 8, yMap(v) + 4);
    });

    ctx.strokeStyle = green;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 512; i += 1) {
      const t = T_MIN + (i / 512) * (T_MAX - T_MIN);
      const x = xMap(t);
      const y = yMap(velocityOfT(t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const time = clampT(markerTime);
    const markerX = xMap(time);
    const markerY = yMap(velocityOfT(time));
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(markerX, top);
    ctx.lineTo(markerX, height - bottom);
    ctx.stroke();
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#166534';
    ctx.beginPath();
    ctx.arc(markerX, markerY, 10, 0, Math.PI * 2);
    ctx.stroke();
  };

  const drawHandle = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const getCanvasPoint = (
    event: MouseEvent | TouchEvent,
    canvas: HTMLCanvasElement,
    logicalWidth: number,
    logicalHeight: number,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const touch = 'touches' in event ? event.touches[0] : null;
    const clientX = touch ? touch.clientX : (event as MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (event as MouseEvent).clientY;

    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * logicalWidth,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * logicalHeight,
    };
  };

  const hitTestPositionPlot = (x: number, y: number): DragTarget => {
    const play = playButtonRef.current;
    if (Math.hypot(x - play.x, y - play.y) <= play.r + 6) {
      return 'play';
    }

    const candidates = [
      { key: 't1' as const, x: xPix(t1), y: yPix(positionOfT(t1)) },
      { key: 't2' as const, x: xPix(t2), y: yPix(positionOfT(t2)) },
      { key: 't0' as const, x: xPix(t0), y: yPix(positionOfT(t0)) },
    ];

    const nearest = candidates
      .map((candidate) => ({
        ...candidate,
        distance: Math.hypot(x - candidate.x, y - candidate.y),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest && nearest.distance <= 24 ? nearest.key : null;
  };

  const positionCanvasXToTime = (x: number) =>
    clampT(T_MIN + ((x - PAD_L) / (size.w - PAD_L - PAD_R)) * (T_MAX - T_MIN));

  const velocityCanvasXToTime = (x: number) => {
    const { left, right } = velocityGeometryRef.current;

    return clampT(T_MIN + ((x - left) / (size.w - left - right)) * (T_MAX - T_MIN));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const onDown = (event: MouseEvent | TouchEvent) => {
      const point = getCanvasPoint(event, canvas, size.w, size.h);
      const target = hitTestPositionPlot(point.x, point.y);
      draggingRef.current = target;
      if (target === 'play') {
        setIsPlaying((playing) => !playing);
      }
    };

    const onMove = (event: MouseEvent | TouchEvent) => {
      const target = draggingRef.current;
      if (!target || target === 'play') {
        return;
      }

      const point = getCanvasPoint(event, canvas, size.w, size.h);
      const nextTime = positionCanvasXToTime(point.x);

      if (target === 't1') {
        setT1(Math.min(nextTime, t2 - 0.0001));
      } else if (target === 't2') {
        setT2(Math.max(nextTime, t1 + 0.0001));
      } else {
        setT0(nextTime);
      }
    };

    const onUp = () => {
      draggingRef.current = null;
      setDragVersion((version) => version + 1);
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);

    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [size, t1, t2, t0]);

  useEffect(() => {
    const canvas = velocityCanvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const onDown = (event: MouseEvent | TouchEvent) => {
      velocityDraggingRef.current = true;
      setT0(velocityCanvasXToTime(getCanvasPoint(event, canvas, size.w, velocityPlotHeight).x));
    };

    const onMove = (event: MouseEvent | TouchEvent) => {
      if (!velocityDraggingRef.current) {
        return;
      }

      setT0(velocityCanvasXToTime(getCanvasPoint(event, canvas, size.w, velocityPlotHeight).x));
    };

    const onUp = () => {
      velocityDraggingRef.current = false;
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);

    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [size, velocityPlotHeight]);

  return (
    <div
      ref={wrapperRef}
      className="flex h-full min-h-[42rem] w-full flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Readout label="Average velocity" value={`${fixed(averageVelocity)} m/s`} accent="var(--accent-red)" />
        <Readout label="Instantaneous velocity" value={`${fixed(instantVelocity)} m/s`} accent="#16a34a" />
      </div>

      <canvas
        ref={canvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Position versus time plot with draggable secant and tangent markers"
      />
      <canvas
        ref={velocityCanvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Velocity versus time plot with draggable marker"
      />
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
