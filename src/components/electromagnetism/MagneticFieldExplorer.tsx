import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Button, ControlBar, Select, Slider, Toggle } from '../shared/InlineControls';
import {
  cssColorToRgb,
  getCssColor,
  mixRgb,
  onThemeChange,
  themeColors,
  type Rgb,
} from '../shared/themeColors';
import { rotateAroundX, solenoidTurnPositions, type Vec3 } from '../../lib/electromagnetism/biotSavart';
import {
  BAR_LENGTH,
  BAR_THICKNESS,
  DEFAULT_SOURCE,
  SAMPLE_EXTENT,
  SOLENOID_LENGTH,
  barMagnetDipoles,
  effectiveTilt,
  orbit,
  project,
  rotateYawPitch,
  sampleField,
  solenoidRadius,
  strengthFraction,
  strengthOpacity,
  type PairMode,
  type SourceConfig,
  type SourceParams,
  type View,
} from '../../lib/electromagnetism/magneticSources';
import { prepareCanvas, useCanvasSurface } from './useCanvasSurface';

// Sample the field of five source types on a 3D grid of arrows. Every arrow has
// the same length so direction reads clearly; color and opacity carry |B|.
// The reader drags the plot to orbit. All field values come from
// lib/electromagnetism/magneticSources and biotSavart.

const DEFAULT_VIEW: View = { yaw: 0.6, pitch: 0.35 };
const MUTED_FALLBACK: Rgb = [107, 114, 128];
const BLUE_FALLBACK: Rgb = [37, 99, 235];

const SOURCE_OPTIONS: { value: SourceConfig; label: string }[] = [
  { value: 'wire', label: 'Straight wire' },
  { value: 'loop', label: 'Current loop' },
  { value: 'solenoid', label: 'Solenoid' },
  { value: 'dipole', label: 'Bar magnet' },
  { value: 'pair', label: 'Two bar magnets' },
];

const rgbString = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

export default function MagneticFieldExplorer() {
  const { containerRef, canvasRef, size } = useCanvasSurface();
  const [source, setSource] = useState<SourceParams>(DEFAULT_SOURCE);
  const [density, setDensity] = useState(7);
  const [showSource, setShowSource] = useState(true);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const update = (changes: Partial<SourceParams>) => setSource((previous) => ({ ...previous, ...changes }));
  const samples = useMemo(() => sampleField(density, source), [density, source]);

  const draw = useCallback(() => {
    const ctx = prepareCanvas(canvasRef.current, size);
    if (!ctx) return;
    const palette = themeColors();
    const muted = cssColorToRgb(palette.muted, MUTED_FALLBACK);
    const blue = cssColorToRgb(getCssColor('--accent-blue', '#2563eb'), BLUE_FALLBACK);

    const cx = size.width / 2;
    const cy = size.height / 2;
    // Fit the sample cube inside the plot whichever dimension is tighter.
    const scale = Math.min(size.width * 0.22, size.height * 0.27);
    const toScreen = (p: Vec3) => {
      const q = project(p, view);
      return { x: cx + q.x * scale, y: cy - q.y * scale, z: q.z, persp: q.persp };
    };
    const tilt = (effectiveTilt(source) * Math.PI) / 180;

    // Axes, kept faint so they orient the reader without competing with the field.
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const [label, axis] of [
      ['x', { x: 1, y: 0, z: 0 }],
      ['y', { x: 0, y: 1, z: 0 }],
      ['z', { x: 0, y: 0, z: 1 }],
    ] as [string, Vec3][]) {
      const end = toScreen({ x: axis.x * 1.45, y: axis.y * 1.45, z: axis.z * 1.45 });
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.fillText(label, end.x + 4, end.y - 4);
    }

    // The source itself, sketched lightly under the arrows.
    if (showSource) {
      ctx.save();
      ctx.strokeStyle = palette.text;
      ctx.fillStyle = palette.text;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';

      const ring = (radius: number, z: number, tiltRad: number) => {
        const points = 96;
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const t = (2 * Math.PI * i) / points;
          const local = rotateAroundX({ x: radius * Math.cos(t), y: radius * Math.sin(t), z }, tiltRad);
          const s = toScreen(local);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      };
      const arrowhead = (from: Vec3, to: Vec3) => {
        const a = toScreen(from);
        const b = toScreen(to);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = 11;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      };
      // An arrowhead on a ring at the given angle, pointing the way the current flows.
      const ringArrow = (radius: number, z: number, tiltRad: number, sign: number) => {
        const at = (t: number) => rotateAroundX({ x: radius * Math.cos(t), y: radius * Math.sin(t), z }, tiltRad);
        const t0 = 0.15 * 2 * Math.PI;
        arrowhead(at(t0), at(t0 + 0.06 * sign));
      };

      if (source.config === 'loop') {
        ring(source.loopRadius, 0, tilt);
        ringArrow(source.loopRadius, 0, tilt, source.currentSign);
      } else if (source.config === 'solenoid') {
        const radius = solenoidRadius(source.loopRadius);
        const turns = Math.max(2, Math.floor(source.solenoidTurns));
        for (const z of solenoidTurnPositions(turns, SOLENOID_LENGTH)) ring(radius, z, 0);
        const zs = solenoidTurnPositions(turns, SOLENOID_LENGTH);
        ringArrow(radius, zs[Math.floor(zs.length / 2)], 0, source.currentSign);
      } else if (source.config === 'wire') {
        const bottom = { x: 0, y: 0, z: -SAMPLE_EXTENT };
        const top = { x: 0, y: 0, z: SAMPLE_EXTENT };
        const a = toScreen(bottom);
        const b = toScreen(top);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Arrowhead at the end the current is flowing toward.
        if (source.currentSign > 0) arrowhead({ x: 0, y: 0, z: SAMPLE_EXTENT * 0.6 }, top);
        else arrowhead({ x: 0, y: 0, z: -SAMPLE_EXTENT * 0.6 }, bottom);
      } else {
        // Bar magnets as boxes, with N at the end the moment points to.
        const halfWidth = BAR_THICKNESS / 2;
        const halfLength = BAR_LENGTH / 2;
        ctx.lineWidth = 1.5;
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const dipole of barMagnetDipoles(source)) {
          const cxm = dipole.position.x;
          const corners: Vec3[] = [];
          for (const z of [-halfLength, halfLength]) {
            for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              corners.push(rotateAroundX({ x: cxm + dx * halfWidth, y: dy * halfWidth, z }, tilt));
            }
          }
          const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          ctx.beginPath();
          for (const [i, j] of edges) {
            const a = toScreen(corners[i]);
            const b = toScreen(corners[j]);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
          // The moment points toward the bar's north end; undo the tilt to read which end that is.
          const northSign = dipole.moment.z * Math.cos(tilt) - dipole.moment.y * Math.sin(tilt) >= 0 ? 1 : -1;
          const north = rotateAroundX({ x: cxm, y: 0, z: northSign * (halfLength + 0.16) }, tilt);
          const south = rotateAroundX({ x: cxm, y: 0, z: -northSign * (halfLength + 0.16) }, tilt);
          const n = toScreen(north);
          const s = toScreen(south);
          ctx.globalAlpha = 0.9;
          ctx.fillText('N', n.x, n.y);
          ctx.fillText('S', s.x, s.y);
          ctx.globalAlpha = 0.5;
        }
      }
      ctx.restore();
    }

    // Field arrows, far ones first so near ones draw over them.
    const arrowLength = scale * 0.22;
    const projected = samples
      .map(({ point, field }) => {
        const sp = toScreen(point);
        const rotated = rotateYawPitch({ x: field.x, y: field.y, z: field.z }, view);
        return { sp, rotated, magnitude: Math.hypot(field.x, field.y, field.z) };
      })
      .sort((a, b) => a.sp.z - b.sp.z);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const { sp, rotated, magnitude } of projected) {
      if (magnitude === 0) continue;
      const fraction = strengthFraction(magnitude);
      const color = rgbString(mixRgb(muted, blue, Math.sqrt(fraction)));
      const depthFade = Math.min(1, Math.max(0.35, (6 - sp.z) / 6));
      const dx = (rotated.x / magnitude) * arrowLength * sp.persp;
      const dy = (rotated.y / magnitude) * arrowLength * sp.persp;
      const tipX = sp.x + dx;
      const tipY = sp.y - dy;
      ctx.globalAlpha = depthFade * strengthOpacity(fraction);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const length = Math.hypot(dx, dy);
      if (length > 3) {
        const angle = Math.atan2(tipY - sp.y, tipX - sp.x);
        const head = Math.max(6, Math.min(arrowLength * 0.24, length * 0.5));
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - head * Math.cos(angle - Math.PI / 6), tipY - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(tipX - head * Math.cos(angle + Math.PI / 6), tipY - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }, [canvasRef, size, view, source, samples, showSource]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => onThemeChange(draw), [draw]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    dragging.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const last = dragging.current;
    if (!last) return;
    dragging.current = { x: event.clientX, y: event.clientY };
    setView((previous) => orbit(previous, event.clientX - last.x, event.clientY - last.y));
  };
  const onPointerEnd = () => {
    dragging.current = null;
  };

  const hasCurrentSign = source.config === 'wire' || source.config === 'loop' || source.config === 'solenoid';
  const hasTilt = source.config === 'loop' || source.config === 'dipole' || source.config === 'pair';
  const hasRadius = source.config === 'loop' || source.config === 'solenoid';

  return (
    <div className="not-prose mx-auto max-w-5xl p-3 text-[var(--text-primary)]">
      <ControlBar>
        <Select
          label="Source"
          value={source.config}
          onChange={(value) => update({ config: value as SourceConfig })}
          options={SOURCE_OPTIONS}
        />
        {hasCurrentSign ? (
          <Select
            label="Current"
            value={String(source.currentSign)}
            onChange={(value) => update({ currentSign: value === '-1' ? -1 : 1 })}
            options={
              source.config === 'wire'
                ? [
                    { value: '1', label: '+z (out of page)' },
                    { value: '-1', label: '−z (into page)' },
                  ]
                : [
                    { value: '1', label: 'Counterclockwise' },
                    { value: '-1', label: 'Clockwise' },
                  ]
            }
          />
        ) : null}
        {source.config === 'pair' ? (
          <Select
            label="Polarity"
            value={source.pairMode}
            onChange={(value) => update({ pairMode: value as PairMode })}
            options={[
              { value: 'anti', label: 'Opposite (N beside S)' },
              { value: 'parallel', label: 'Same (N beside N)' },
            ]}
          />
        ) : null}
      </ControlBar>
      <div
        ref={containerRef}
        className="relative my-2 w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-plot)]"
        style={{ aspectRatio: '25 / 18', minHeight: 260 }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Three-dimensional grid of magnetic field arrows around the chosen source. Drag to rotate the view."
          className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      </div>
      <ControlBar className="mb-2">
        <Slider
          label="Sample density"
          min={4}
          max={10}
          step={1}
          value={density}
          onChange={setDensity}
          format={(v) => `${v}³`}
        />
        {hasRadius ? (
          <Slider
            label="Radius"
            min={0.5}
            max={1.4}
            step={0.05}
            value={source.loopRadius}
            onChange={(value) => update({ loopRadius: value })}
            format={(v) => v.toFixed(2)}
          />
        ) : null}
        {source.config === 'solenoid' ? (
          <Slider
            label="Turns"
            min={3}
            max={20}
            step={1}
            value={source.solenoidTurns}
            onChange={(value) => update({ solenoidTurns: value })}
          />
        ) : null}
        {hasTilt ? (
          <Slider
            label="Tilt"
            unit="°"
            min={-45}
            max={60}
            step={1}
            value={source.tiltDeg}
            onChange={(value) => update({ tiltDeg: value })}
          />
        ) : null}
        {source.config === 'pair' ? (
          <Slider
            label="Spacing"
            min={0.6}
            max={2}
            step={0.05}
            value={source.pairSeparation}
            onChange={(value) => update({ pairSeparation: value })}
            format={(v) => v.toFixed(2)}
          />
        ) : null}
      </ControlBar>
      <ControlBar className="mb-2">
        <Toggle label="Show source" checked={showSource} onChange={setShowSource} />
        <Button variant="secondary" onClick={() => setView(DEFAULT_VIEW)}>Reset view</Button>
      </ControlBar>
      <p className="type-supporting my-2 text-center">
        Drag the plot to rotate it. Every arrow is the same length and shows only the field’s direction; stronger
        fields are bluer and more opaque. The gray lines are the x, y and z axes.
      </p>
    </div>
  );
}
