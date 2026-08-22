import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

import {
  SAMPLE_T_MAX,
  SAMPLE_T_MIN,
  accelerationOfT,
  areaUnderAcceleration,
  averageRate,
  clampSampleT,
  pathLengthOfT,
  positionOfT,
  velocityOfT,
} from '../../lib/kinematics/sampleMotion';
import { hedgehogGait } from '../../lib/kinematics/hedgehogGait';
import { drawHedgehogFrame } from './HedgehogSprite';
import { HEDGEHOG_CELL_H, HEDGEHOG_CELL_W, HEDGEHOG_SHEET_SRC } from './hedgehogSheet';
import { fixed } from '../../utils/format';
import {
  InterpretationToggle,
  MetricPanel,
  type Interpretation,
} from './ExplorerControls';
import { drawChangeBracket, fillSignedArea } from './plotShading';

type Size = {
  w: number;
  h: number;
};

type DragTarget = 't1' | 't2' | 't0' | null;

const FONT_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const T_MIN = SAMPLE_T_MIN;
const T_MAX = SAMPLE_T_MAX;
const V_MIN = -2;
const V_MAX = 3;
const A_MIN = -2;
const A_MAX = 2;
const PAD_L = 64;
const PAD_R = 40;
const PAD_T = 20;
const PAD_B = 58;

// The strip between the two graphs. Its horizontal axis is position, not time -
// it is the motion itself, not another plot - so it carries no ticks or labels,
// only a ground line for the hedgehog to run along.
const MOTION_H = 100;
const MOTION_GROUND_Y = MOTION_H - 24;
const POSITION_MIN = 0;
const POSITION_MAX = 10;

/** Pixels of velocity arrow per m/s. */
const ARROW_SCALE = 26;

// Velocity keeps the same green it has on the position/velocity explorer, so a
// student reading down the page sees one colour per quantity.
const VELOCITY_GREEN = '#16a34a';

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export default function AccelerationExplorer() {
  const [t1, setT1] = useState(2);
  const [t2, setT2] = useState(9);
  const [t0, setT0] = useState(5);
  const [tMotion, setTMotion] = useState(SAMPLE_T_MIN);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation>('slope');
  const [dragVersion, setDragVersion] = useState(0);
  const [size, setSize] = useState<Size>({ w: 860, h: 430 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const velocityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const accelerationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef<DragTarget>(null);
  const accelerationDraggingRef = useRef(false);
  const sheetRef = useRef<HTMLImageElement | null>(null);
  const motionFacingRef = useRef<1 | -1>(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  // Inset by half a sprite at each end so the hedgehog always stands on the
  // ground line rather than hanging off it - and, at position zero, so it does
  // not sit on top of the play button.
  const motionInset = HEDGEHOG_CELL_W / 2;
  const xPos = (position: number) =>
    PAD_L +
    motionInset +
    ((position - POSITION_MIN) / (POSITION_MAX - POSITION_MIN)) *
      (size.w - PAD_L - PAD_R - motionInset * 2);

  const accelerationPlotHeight = Math.max(230, Math.floor(size.h * 0.72));

  const xPix = (t: number) =>
    PAD_L + ((t - T_MIN) / (T_MAX - T_MIN)) * (size.w - PAD_L - PAD_R);
  const vPix = (v: number) =>
    size.h - PAD_B - ((v - V_MIN) / (V_MAX - V_MIN)) * (size.h - PAD_T - PAD_B);

  const averageAcceleration = useMemo(() => averageRate(velocityOfT, t1, t2), [t1, t2]);
  const instantAcceleration = useMemo(() => accelerationOfT(t0), [t0]);
  const deltaV = useMemo(() => areaUnderAcceleration(t1, t2), [t1, t2]);
  const showSlope = interpretation === 'slope';

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const width = Math.max(340, Math.floor(element.clientWidth));
      const height = Math.max(280, Math.floor(width / 2));
      setSize({ w: width, h: height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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
    drawVelocityPlot();
    drawMotionStrip();
    drawAccelerationPlot();
  }, [t1, t2, t0, tMotion, isPlaying, size, dragVersion, sheetReady, interpretation]);

  const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return ctx;
  };

  const drawFrame = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    yAxisLabel: string,
    ticks: number[],
    yMap: (value: number) => number,
  ) => {
    const panel = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const x = xPix(i);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, height - PAD_B);
      ctx.stroke();
    }
    ticks.forEach((value) => {
      const y = yMap(value);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(width - PAD_R, y);
      ctx.stroke();
    });

    // The zero line is the one students need to find in order to read a sign.
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(PAD_L, yMap(0));
    ctx.lineTo(width - PAD_R, yMap(0));
    ctx.stroke();

    ctx.strokeStyle = text;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(PAD_L, height - PAD_B);
    ctx.lineTo(width - PAD_R, height - PAD_B);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, height - PAD_B);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('time (s)', (PAD_L + width - PAD_R) / 2, height - 16);
    ctx.save();
    ctx.translate(18, (PAD_T + height - PAD_B) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yAxisLabel, 0, 0);
    ctx.restore();

    ctx.font = `14px ${FONT_FAMILY}`;
    for (let i = 1; i <= 10; i += 1) {
      ctx.fillText(String(i), xPix(i), height - PAD_B + 20);
    }
    ctx.textAlign = 'right';
    ticks.forEach((value) => {
      ctx.fillText(value.toFixed(1), PAD_L - 8, yMap(value) + 4);
    });
  };

  const drawCurve = (
    ctx: CanvasRenderingContext2D,
    valueOfT: (t: number) => number,
    yMap: (value: number) => number,
    color: string,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i <= 512; i += 1) {
      const t = T_MIN + (i / 512) * (T_MAX - T_MIN);
      const x = xPix(t);
      const y = yMap(valueOfT(t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
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

  const drawVelocityPlot = () => {
    const canvas = velocityCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = prepareCanvas(canvas, size.w, size.h);
    if (!ctx) {
      return;
    }

    const red = getCssColor('--accent-red', '#ef4444');
    const purple = getCssColor('--accent-purple', '#7e57c2');
    const muted = getCssColor('--text-muted', '#4b5563');

    drawFrame(ctx, size.w, size.h, 'velocity (m/s)', [-2, -1, 0, 1, 2, 3], vPix);
    drawCurve(ctx, velocityOfT, vPix, VELOCITY_GREEN);

    const x1 = xPix(t1);
    const y1 = vPix(velocityOfT(t1));
    const x2 = xPix(t2);
    const y2 = vPix(velocityOfT(t2));

    const xAtT0 = xPix(t0);
    const yAtT0 = vPix(velocityOfT(t0));

    if (showSlope) {
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
      ctx.fillText(
        `avg a = ${fixed(averageAcceleration)} m/s²`,
        (x1 + x2) / 2,
        (y1 + y2) / 2 + 30,
      );
      ctx.restore();

      const slope = instantAcceleration;
      ctx.save();
      ctx.strokeStyle = purple;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(xPix(T_MIN), vPix(velocityOfT(t0) + slope * (T_MIN - t0)));
      ctx.lineTo(xPix(T_MAX), vPix(velocityOfT(t0) + slope * (T_MAX - t0)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = purple;
      ctx.font = `600 14px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText(`a(t) = ${fixed(slope)} m/s²`, xAtT0, Math.max(24, yAtT0 - 28));
      ctx.restore();
    } else {
      // The rise of the velocity curve across the interval - the same number the
      // shaded area under the acceleration graph below is accumulating.
      drawChangeBracket(ctx, {
        xFrom: x1,
        xTo: x2,
        xArrow: Math.min(x2 + 24, size.w - PAD_R - 14),
        yFrom: y1,
        yTo: y2,
        color: VELOCITY_GREEN,
        label: `Δv = ${fixed(deltaV)} m/s`,
        font: FONT_FAMILY,
      });
    }

    drawHandle(ctx, x1, y1, red);
    drawHandle(ctx, x2, y2, red);
    if (showSlope) {
      drawHandle(ctx, xAtT0, yAtT0, purple);
    }

    // The animation's own marker, sliding along the curve as the hedgehog runs
    // below. Green because it reads a velocity, the same green as the curve.
    const motionX = xPix(tMotion);
    const motionY = vPix(velocityOfT(tMotion));
    ctx.save();
    ctx.fillStyle = VELOCITY_GREEN;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(motionX, motionY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (draggingRef.current) {
      const activeTime =
        draggingRef.current === 't1' ? t1 : draggingRef.current === 't2' ? t2 : t0;
      const x = xPix(activeTime);
      ctx.save();
      ctx.strokeStyle = muted;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, size.h - PAD_B);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = `13px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${activeTime.toFixed(2)} s`, x, size.h - PAD_B - 8);
      ctx.restore();
    }
  };

  /** A horizontal velocity vector, drawn from the hedgehog's back. */
  const drawVelocityArrow = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    velocity: number,
  ) => {
    const length = velocity * ARROW_SCALE;
    if (Math.abs(length) < 4) {
      return;
    }

    const direction = Math.sign(length);
    const tip = x + length;
    const head = 9;

    ctx.save();
    ctx.strokeStyle = VELOCITY_GREEN;
    ctx.fillStyle = VELOCITY_GREEN;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tip - direction * head * 0.7, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tip, y);
    ctx.lineTo(tip - direction * head, y - 5);
    ctx.lineTo(tip - direction * head, y + 5);
    ctx.closePath();
    ctx.fill();

    ctx.font = `italic 600 13px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('v', (x + tip) / 2, y - 9);
    ctx.restore();
  };

  const drawMotionStrip = () => {
    const canvas = motionCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = prepareCanvas(canvas, size.w, MOTION_H);
    if (!ctx) {
      return;
    }

    const panel = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');

    ctx.clearRect(0, 0, size.w, MOTION_H);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, size.w, MOTION_H);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD_L, MOTION_GROUND_Y);
    ctx.lineTo(size.w - PAD_R, MOTION_GROUND_Y);
    ctx.stroke();

    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }

    const velocity = velocityOfT(tMotion);
    const pose = hedgehogGait({
      distance: pathLengthOfT(tMotion),
      velocity,
      acceleration: accelerationOfT(tMotion),
      previousFacing: motionFacingRef.current,
    });
    motionFacingRef.current = pose.facing;

    const x = xPos(positionOfT(tMotion));
    drawHedgehogFrame(ctx, sheet, pose.frame, {
      x,
      y: MOTION_GROUND_Y,
      facing: pose.facing,
    });
    drawVelocityArrow(ctx, x, MOTION_GROUND_Y - HEDGEHOG_CELL_H - 6, velocity);
  };

  const drawAccelerationPlot = () => {
    const canvas = accelerationCanvasRef.current;
    if (!canvas) {
      return;
    }

    const height = accelerationPlotHeight;
    const ctx = prepareCanvas(canvas, size.w, height);
    if (!ctx) {
      return;
    }

    const purple = getCssColor('--accent-purple', '#7e57c2');
    const red = getCssColor('--accent-red', '#ef4444');
    const aPix = (a: number) =>
      height - PAD_B - ((a - A_MIN) / (A_MAX - A_MIN)) * (height - PAD_T - PAD_B);

    drawFrame(ctx, size.w, height, 'acceleration (m/s²)', [-2, -1, 0, 1, 2], aPix);

    if (!showSlope) {
      // Tinted with the colour of what the area gives you - a velocity - rather
      // than the colour of the acceleration curve it sits under.
      fillSignedArea(ctx, {
        from: t1,
        to: t2,
        valueOfT: accelerationOfT,
        xPix,
        yPix: aPix,
        color: VELOCITY_GREEN,
        font: FONT_FAMILY,
      });
    }

    drawCurve(ctx, accelerationOfT, aPix, purple);

    if (!showSlope) {
      // Boundary rules so the shaded band lines up with the markers above.
      ctx.save();
      ctx.strokeStyle = red;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      [t1, t2].forEach((t) => {
        ctx.beginPath();
        ctx.moveTo(xPix(t), PAD_T);
        ctx.lineTo(xPix(t), height - PAD_B);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (showSlope) {
      const markerX = xPix(t0);
      const markerY = aPix(accelerationOfT(t0));
      ctx.strokeStyle = purple;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(markerX, PAD_T);
      ctx.lineTo(markerX, height - PAD_B);
      ctx.stroke();
      ctx.fillStyle = purple;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
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

  const canvasXToTime = (x: number) =>
    clampSampleT(T_MIN + ((x - PAD_L) / (size.w - PAD_L - PAD_R)) * (T_MAX - T_MIN));

  const hitTestVelocityPlot = (x: number, y: number): DragTarget => {
    const candidates = [
      { key: 't1' as const, x: xPix(t1), y: vPix(velocityOfT(t1)) },
      { key: 't2' as const, x: xPix(t2), y: vPix(velocityOfT(t2)) },
      ...(showSlope
        ? [{ key: 't0' as const, x: xPix(t0), y: vPix(velocityOfT(t0)) }]
        : []),
    ];

    const nearest = candidates
      .map((candidate) => ({
        ...candidate,
        distance: Math.hypot(x - candidate.x, y - candidate.y),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest && nearest.distance <= 24 ? nearest.key : null;
  };

  useEffect(() => {
    const canvas = velocityCanvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const onDown = (event: MouseEvent | TouchEvent) => {
      const point = getCanvasPoint(event, canvas, size.w, size.h);
      draggingRef.current = hitTestVelocityPlot(point.x, point.y);
    };

    const onMove = (event: MouseEvent | TouchEvent) => {
      const target = draggingRef.current;
      if (!target) {
        return;
      }

      const nextTime = canvasXToTime(getCanvasPoint(event, canvas, size.w, size.h).x);

      if (target === 't1') {
        setT1(Math.min(nextTime, t2 - 0.25));
      } else if (target === 't2') {
        setT2(Math.max(nextTime, t1 + 0.25));
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
  }, [size, t1, t2, t0, showSlope]);

  useEffect(() => {
    const canvas = accelerationCanvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!showSlope) {
        return;
      }
      accelerationDraggingRef.current = true;
      setT0(canvasXToTime(getCanvasPoint(event, canvas, size.w, accelerationPlotHeight).x));
    };

    const onMove = (event: MouseEvent | TouchEvent) => {
      if (!accelerationDraggingRef.current) {
        return;
      }

      setT0(canvasXToTime(getCanvasPoint(event, canvas, size.w, accelerationPlotHeight).x));
    };

    const onUp = () => {
      accelerationDraggingRef.current = false;
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
  }, [size, accelerationPlotHeight, showSlope]);

  return (
    <div
      ref={wrapperRef}
      className="flex h-full min-h-[38rem] w-full flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InterpretationToggle
          value={interpretation}
          onChange={setInterpretation}
          label="Read the graphs as slopes or as areas"
        />
      </div>

      {showSlope ? (
        <div className="grid gap-3 md:grid-cols-2">
          <MetricPanel
            label="Average acceleration"
            value={`${fixed(averageAcceleration)} m/s²`}
            accent="var(--accent-red)"
          />
          <MetricPanel
            label="Instantaneous acceleration"
            value={`${fixed(instantAcceleration)} m/s²`}
            accent="var(--accent-purple)"
          />
        </div>
      ) : (
        <div className="grid gap-3">
          <MetricPanel
            label="Change in velocity"
            value={`${fixed(deltaV)} m/s`}
            accent={VELOCITY_GREEN}
          />
        </div>
      )}

      <canvas
        ref={velocityCanvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Velocity versus time plot with draggable secant and tangent markers showing average and instantaneous acceleration"
      />
      <div className="relative">
        <canvas
          ref={motionCanvasRef}
          className="block max-w-full rounded-lg border border-[var(--grid-line)] shadow-sm"
          aria-label="The motion the two graphs describe: a hedgehog running along a ten metre track with a green arrow showing its velocity"
        />
        <button
          type="button"
          onClick={() => setIsPlaying((playing) => !playing)}
          aria-label={isPlaying ? 'Pause the motion' : 'Play the motion'}
          className="absolute left-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
        >
          {isPlaying ? (
            <Pause aria-hidden="true" size={16} strokeWidth={2.5} />
          ) : (
            <Play aria-hidden="true" size={16} strokeWidth={2.5} />
          )}
        </button>
      </div>

      <canvas
        ref={accelerationCanvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Acceleration versus time plot with the signed area between the markers shaded to show the change in velocity"
      />
    </div>
  );
}
