import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { getCssColor, onThemeChange, themeColors } from '../shared/themeColors';
import { formatTesla, straightWireField, wireFieldMagnitude } from '../../lib/electromagnetism/biotSavart';
import { drawArrow, drawCurrentMark, pointerPosition, prepareCanvas, useCanvasSurface } from './useCanvasSurface';

// The field of one long straight wire, sampled where the reader puts a probe.
// The wire is at the origin of a 1 m by 0.8 m window with a 0.1 m grid, and the
// current runs along z (out of the page when positive).

const WORLD_WIDTH = 1; // meters across the canvas
const WORLD_HEIGHT = 0.8;
const MIN_FIELD_DISTANCE = 0.01;
const FIELD_FLOOR = 1e-7; // arrow is shortest at or below this
const FIELD_CEILING = 5e-5; // arrow is longest at or above this
const KEY_STEP = 0.01;

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampProbe = (p: Point): Point => ({
  x: clamp(p.x, -WORLD_WIDTH / 2, WORLD_WIDTH / 2),
  y: clamp(p.y, -WORLD_HEIGHT / 2, WORLD_HEIGHT / 2),
});

export default function StraightWireField() {
  const { containerRef, canvasRef, size } = useCanvasSurface();
  const [current, setCurrent] = useState(2);
  const [probe, setProbe] = useState<Point>({ x: 0.25, y: 0.1 });
  const dragging = useRef(false);

  const r = Math.hypot(probe.x, probe.y);
  const magnitude = wireFieldMagnitude(current, Math.max(r, MIN_FIELD_DISTANCE));

  const draw = useCallback(() => {
    const ctx = prepareCanvas(canvasRef.current, size);
    if (!ctx) return;
    const palette = themeColors();
    const fieldColor = getCssColor('--accent-blue', '#2563eb');
    const scale = size.width / WORLD_WIDTH;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const toPixel = (p: Point): Point => ({ x: cx + p.x * scale, y: cy - p.y * scale });

    // 0.1 m grid.
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    for (let k = -5; k <= 5; k++) {
      const x = cx + k * 0.1 * scale;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }
    for (let k = -4; k <= 4; k++) {
      const y = cy + k * 0.1 * scale;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The circle through the probe: |B| is the same all the way around it.
    ctx.strokeStyle = fieldColor;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Wire, with a dot for current out of the page and a cross for current into it.
    ctx.fillStyle = palette.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.text;
    ctx.fillStyle = palette.text;
    ctx.lineWidth = 2;
    if (current !== 0) drawCurrentMark(ctx, cx, cy, current > 0, 13);
    else {
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Probe and the field arrow drawn at it.
    const probePixel = toPixel(probe);
    if (current !== 0 && r > 0) {
      const b = straightWireField(probe.x, probe.y, current, MIN_FIELD_DISTANCE);
      const length = Math.hypot(b.x, b.y);
      const strength = clamp(
        (Math.log10(length) - Math.log10(FIELD_FLOOR)) / (Math.log10(FIELD_CEILING) - Math.log10(FIELD_FLOOR)),
        0,
        1,
      );
      const arrowLength = 26 + 70 * strength;
      ctx.strokeStyle = fieldColor;
      ctx.fillStyle = fieldColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      // Screen y points down, so flip the field's y component.
      drawArrow(
        ctx,
        probePixel.x,
        probePixel.y,
        probePixel.x + (b.x / length) * arrowLength,
        probePixel.y - (b.y / length) * arrowLength,
        12,
      );
    }
    ctx.beginPath();
    ctx.arc(probePixel.x, probePixel.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = palette.bg;
    ctx.fill();
    ctx.strokeStyle = fieldColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }, [canvasRef, size, current, probe, r]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => onThemeChange(draw), [draw]);

  const moveProbeTo = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pointerPosition(event, event.currentTarget);
    const scale = size.width / WORLD_WIDTH;
    setProbe(clampProbe({ x: (x - size.width / 2) / scale, y: (size.height / 2 - y) / scale }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setProbe((p) => clampProbe({ x: p.x + move.x, y: p.y + move.y }));
  };

  return (
    <div className="not-prose mx-auto max-w-xl p-3 text-[var(--text-primary)]">
      <div
        ref={containerRef}
        className="relative my-2 w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-plot)]"
        style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Straight wire with a draggable field probe. The probe is ${r.toFixed(2)} meters from the wire where the field is ${formatTesla(magnitude)}. Use the arrow keys to move it.`}
          className="absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-blue)]"
          style={{ touchAction: 'none' }}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            moveProbeTo(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) moveProbeTo(event);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ControlBar className="mb-2">
        <Slider
          label="Current I"
          unit="A"
          min={-5}
          max={5}
          step={0.1}
          value={current}
          onChange={setCurrent}
          format={(v) => v.toFixed(1)}
        />
        <span className="text-sm text-[var(--text-muted)]">
          {current > 0 ? 'out of the page (•)' : current < 0 ? 'into the page (×)' : 'no current'}
        </span>
      </ControlBar>
      <Readout variant="inline" className="justify-center">
        <Readout.Value label="r" value={r.toFixed(3)} unit="m" />
        <Readout.Value label="|B|" value={current === 0 ? '0' : formatTesla(magnitude)} />
      </Readout>
      <p className="type-supporting my-2 text-center">
        Drag the probe, or focus the plot and use the arrow keys. The blue circle shows every point at the probe’s
        distance, where the field has the same magnitude.
      </p>
    </div>
  );
}
