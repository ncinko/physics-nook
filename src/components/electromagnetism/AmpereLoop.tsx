import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { getCssColor, onThemeChange, themeColors } from '../shared/themeColors';
import {
  ampereRightSide,
  buildPathSteps,
  closePath,
  fieldAt,
  formatLineIntegral,
  isClosedPath,
  type CurrentWire,
  type PathPoint,
  type PathStep,
} from '../../lib/electromagnetism/ampere';
import { drawArrow, drawCurrentMark, pointerPosition, prepareCanvas, useCanvasSurface, usePrefersReducedMotion } from './useCanvasSurface';

// Build a set of long straight currents, draw a path through their field, and
// watch B · dl add up step by step. The window is 6 m by 4 m, so the numbers do
// not depend on how wide the page happens to be.

const WORLD_WIDTH = 6;
const WORLD_HEIGHT = 4;
const ARROW_SPACING = 0.5;
const STEP_LENGTH = 0.1;
const CLOSE_TOLERANCE = 0.25;
const MIN_POINT_GAP = 0.03;
const HIT_RADIUS_PX = 20;
const MAX_WIRES = 12;
const ANIMATION_SECONDS = 3.5;

type Mode = 'move' | 'addOut' | 'addIn' | 'draw';

interface Integration {
  steps: PathStep[];
  /** The path that was integrated, closed if the reader's path ended near its start. */
  path: PathPoint[];
  shown: number;
}

const INITIAL_WIRES: CurrentWire[] = [{ id: 1, x: 0, y: 0, current: 1 }];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A counterclockwise circle, closed by repeating its first point. */
const circlePath = (radius: number, points = 96): PathPoint[] =>
  Array.from({ length: points + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });

export default function AmpereLoop() {
  const { containerRef, canvasRef, size } = useCanvasSurface();
  const reducedMotion = usePrefersReducedMotion();

  const [wires, setWires] = useState<CurrentWire[]>(INITIAL_WIRES);
  const [nextId, setNextId] = useState(2);
  const [mode, setMode] = useState<Mode>('move');
  const [amount, setAmount] = useState(1);
  const [path, setPath] = useState<PathPoint[]>([]);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [animating, setAnimating] = useState(false);

  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const drawing = useRef(false);
  const stepCount = useRef(0);
  stepCount.current = integration?.steps.length ?? 0;

  const scale = size.width / WORLD_WIDTH;
  const toPixel = useCallback(
    (p: PathPoint) => ({ x: size.width / 2 + p.x * scale, y: size.height / 2 - p.y * scale }),
    [size.width, size.height, scale],
  );

  const draw = useCallback(() => {
    const ctx = prepareCanvas(canvasRef.current, size);
    if (!ctx) return;
    const palette = themeColors();
    const fieldColor = getCssColor('--accent-blue', '#2563eb');
    const spacingPx = ARROW_SPACING * scale;

    // Field arrows on a regular lattice, longer and darker where the field is stronger.
    const cols = Math.floor(WORLD_WIDTH / ARROW_SPACING);
    const rows = Math.floor(WORLD_HEIGHT / ARROW_SPACING);
    const samples: { x: number; y: number; bx: number; by: number; magnitude: number }[] = [];
    let strongest = 0;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -WORLD_WIDTH / 2 + ARROW_SPACING * (i + 0.5);
        const y = -WORLD_HEIGHT / 2 + ARROW_SPACING * (j + 0.5);
        const b = fieldAt(wires, x, y);
        const magnitude = Math.hypot(b.x, b.y);
        strongest = Math.max(strongest, magnitude);
        samples.push({ x, y, bx: b.x, by: b.y, magnitude });
      }
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.6;
    for (const s of samples) {
      const base = toPixel(s);
      if (s.magnitude === 0 || strongest === 0) {
        ctx.fillStyle = palette.grid;
        ctx.beginPath();
        ctx.arc(base.x, base.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const t = Math.sqrt(s.magnitude / strongest);
      const length = spacingPx * (0.3 + 0.5 * t);
      ctx.globalAlpha = 0.28 + 0.65 * t;
      ctx.strokeStyle = fieldColor;
      ctx.fillStyle = fieldColor;
      drawArrow(
        ctx,
        base.x - ((s.bx / s.magnitude) * length) / 2,
        base.y + ((s.by / s.magnitude) * length) / 2,
        base.x + ((s.bx / s.magnitude) * length) / 2,
        base.y - ((s.by / s.magnitude) * length) / 2,
        Math.max(5, length * 0.28),
      );
    }
    ctx.globalAlpha = 1;

    // The drawn path; the stretch already integrated is thicker and green.
    const done = integration ? integration.steps.slice(0, integration.shown) : [];
    const shownPath = integration ? integration.path : path;
    if (shownPath.length > 1) {
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      shownPath.forEach((point, index) => {
        const px = toPixel(point);
        if (index === 0) ctx.moveTo(px.x, px.y);
        else ctx.lineTo(px.x, px.y);
      });
      ctx.stroke();
      // Start marker, so the direction of travel is clear.
      const start = toPixel(shownPath[0]);
      ctx.fillStyle = palette.text;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (done.length > 0) {
      ctx.strokeStyle = palette.probe;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      done.forEach((step, index) => {
        const a = toPixel(step.start);
        const b = toPixel(step.end);
        if (index === 0 || done[index - 1].end !== step.start) ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
      ctx.stroke();
      const latest = done[done.length - 1];
      const magnitude = Math.hypot(latest.bx, latest.by);
      if (magnitude > 0) {
        const mid = toPixel(latest.mid);
        const length = Math.max(26, spacingPx * 0.9);
        ctx.strokeStyle = palette.probe;
        ctx.fillStyle = palette.probe;
        ctx.lineWidth = 3;
        drawArrow(
          ctx,
          mid.x,
          mid.y,
          mid.x + (latest.bx / magnitude) * length,
          mid.y - (latest.by / magnitude) * length,
          10,
        );
      }
    }

    // Wires on top.
    for (const wire of wires) {
      const p = toPixel(wire);
      ctx.fillStyle = palette.surface;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.text;
      ctx.fillStyle = palette.text;
      ctx.lineWidth = 2;
      drawCurrentMark(ctx, p.x, p.y, wire.current > 0, 13);
      if (Math.abs(wire.current) !== 1) {
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.abs(wire.current)} A`, p.x + 18, p.y);
      }
    }
  }, [canvasRef, size, scale, toPixel, wires, path, integration]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => onThemeChange(draw), [draw]);

  // Step the integration forward over a few seconds, whatever the path's length.
  useEffect(() => {
    if (!animating) return;
    let frame = 0;
    let started = 0;
    const tick = (time: number) => {
      if (!started) started = time;
      const total = stepCount.current;
      const rate = total / ANIMATION_SECONDS;
      const shown = Math.min(total, Math.floor(((time - started) / 1000) * rate) + 1);
      setIntegration((previous) => (previous ? { ...previous, shown } : previous));
      if (shown >= total) {
        setAnimating(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating]);

  const stopIntegration = () => {
    setAnimating(false);
    setIntegration(null);
  };

  const toWorld = (event: { clientX: number; clientY: number }, element: Element): PathPoint => {
    const { x, y } = pointerPosition(event, element);
    return { x: (x - size.width / 2) / scale, y: (size.height / 2 - y) / scale };
  };
  const clampToWorld = (p: PathPoint): PathPoint => ({
    x: clamp(p.x, -WORLD_WIDTH / 2, WORLD_WIDTH / 2),
    y: clamp(p.y, -WORLD_HEIGHT / 2, WORLD_HEIGHT / 2),
  });

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = toWorld(event, event.currentTarget);
    if (mode === 'draw') {
      stopIntegration();
      drawing.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPath([clampToWorld(point)]);
      return;
    }
    if (mode === 'move') {
      const hitRadius = HIT_RADIUS_PX / scale;
      const hit = wires.find((w) => Math.hypot(point.x - w.x, point.y - w.y) <= hitRadius);
      if (hit) {
        drag.current = { id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current) {
      const point = clampToWorld(toWorld(event, event.currentTarget));
      setPath((previous) => {
        const last = previous[previous.length - 1];
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_GAP) return previous;
        return [...previous, point];
      });
      return;
    }
    const active = drag.current;
    if (active) {
      const point = toWorld(event, event.currentTarget);
      const moved = clampToWorld({ x: point.x - active.dx, y: point.y - active.dy });
      stopIntegration();
      setWires((previous) => previous.map((w) => (w.id === active.id ? { ...w, ...moved } : w)));
    }
  };

  const endPointer = () => {
    drag.current = null;
    drawing.current = false;
  };

  const onClick = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    if (mode !== 'addOut' && mode !== 'addIn') return;
    if (wires.length >= MAX_WIRES) return;
    const point = clampToWorld(toWorld(event, event.currentTarget));
    stopIntegration();
    setWires((previous) => [
      ...previous,
      { id: nextId, ...point, current: mode === 'addOut' ? amount : -amount },
    ]);
    setNextId((id) => id + 1);
  };

  const integrate = () => {
    const closed = closePath(path, CLOSE_TOLERANCE);
    const steps = buildPathSteps(closed, wires, STEP_LENGTH);
    if (steps.length === 0) return;
    setIntegration({ steps, path: closed, shown: reducedMotion ? steps.length : 1 });
    setAnimating(!reducedMotion);
  };

  const showCircle = () => {
    stopIntegration();
    setPath(circlePath(1));
    setMode('move');
  };

  const clearPath = () => {
    stopIntegration();
    setPath([]);
  };

  const clearCurrents = () => {
    stopIntegration();
    setWires([]);
  };

  const modeButton = (value: Mode, label: string) => (
    <Button
      variant={mode === value ? 'primary' : 'secondary'}
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
    >
      {label}
    </Button>
  );

  const canIntegrate = path.length >= 2 && wires.length > 0 && !animating;
  const running = integration && integration.shown > 0 ? integration.steps[integration.shown - 1].cumulative : null;
  const finished = integration !== null && integration.shown >= integration.steps.length;
  const closedPath = integration ? isClosedPath(integration.path) : false;
  const cursor = mode === 'draw' ? 'crosshair' : mode === 'move' ? 'grab' : 'copy';
  const totalCurrent = wires.reduce((sum, w) => sum + w.current, 0);

  return (
    <div className="not-prose mx-auto max-w-5xl p-3 text-[var(--text-primary)]">
      <div
        ref={containerRef}
        className="relative my-2 w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-plot)]"
        style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}`, minHeight: 200 }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Field of straight currents with a drawable Ampère path. Use the buttons below to add currents, draw a path, and integrate B dot dl."
          className="absolute inset-0 h-full w-full"
          style={{
            cursor,
            touchAction: mode === 'addOut' || mode === 'addIn' ? 'pan-y' : 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={onClick}
        />
      </div>

      <ControlBar className="mb-2" align="start">
        <span className="type-label">Currents</span>
        {modeButton('move', 'Move')}
        {modeButton('addOut', 'Add • (out)')}
        {modeButton('addIn', 'Add × (in)')}
        <Slider label="New current" unit="A" min={1} max={5} step={1} value={amount} onChange={setAmount} />
        <Button variant="secondary" onClick={clearCurrents} disabled={wires.length === 0}>Clear currents</Button>
      </ControlBar>
      <ControlBar className="mb-2" align="start">
        <span className="type-label">Path</span>
        {modeButton('draw', 'Draw path')}
        <Button variant="secondary" onClick={showCircle}>Circle around center</Button>
        <Button onClick={integrate} disabled={!canIntegrate}>
          {animating ? 'Integrating…' : 'Integrate B · dl'}
        </Button>
        <Button variant="secondary" onClick={clearPath} disabled={path.length === 0}>Clear path</Button>
      </ControlBar>

      <div role="status" aria-live="polite">
        <Readout variant="inline" className="justify-center">
          <Readout.Value label="Net current" value={totalCurrent.toFixed(0)} unit="A" />
          <Readout.Value label="∑ B · dl" value={running === null ? '—' : formatLineIntegral(running)} />
          {integration && finished && closedPath ? (
            <Readout.Value label="μ₀ I_enc" value={formatLineIntegral(ampereRightSide(integration.path, wires))} />
          ) : null}
        </Readout>
        {finished && !closedPath ? (
          <p className="type-supporting my-1 text-center">
            This path is open, so Ampère’s law does not apply to it. End it near where it started to close the loop.
          </p>
        ) : null}
      </div>
    </div>
  );
}
