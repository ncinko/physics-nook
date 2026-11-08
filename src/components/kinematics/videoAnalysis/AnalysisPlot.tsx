import { useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { niceTicks } from '../../../lib/kinematics/videoAnalysis';
import { markerPath, type MarkerShape } from './trackColors';
import { fixed } from '../../../utils/format';
import { nearestPoint, placeLabels, type HoverCandidate } from '../../../lib/sensors/hover';

/**
 * The graph half of the lab: an SVG scatter with error bars, an optional fit
 * curve, draggable range handles, and an optional residual strip.
 *
 * SVG rather than canvas. The point counts are in the tens or hundreds, the
 * text needs to stay crisp, and — decisively — theme colours can be written as
 * `stroke="var(--accent-blue)"` and simply repaint when the theme changes, with
 * none of the redraw plumbing a canvas would need.
 */

export interface PlotPoint {
  x: number;
  y: number;
  sigmaX: number | null;
  sigmaY: number | null;
}

export interface PlotSeries {
  key: string;
  label: string;
  color: string;
  shape: MarkerShape;
  points: PlotPoint[];
  /** Drawn muted, for points a fit leaves out. Never gets a legend entry. */
  faded?: boolean;
}

/** A data point the user clicked to keep on screen. */
export type PlotPin = HoverCandidate;

interface AnalysisPlotProps {
  series: PlotSeries[];
  xLabel: string;
  yLabel: string;
  /** Sampled fit curve in data coordinates, or null when no model is fitted. */
  fitCurve: Array<{ x: number; y: number }> | null;
  fitColor: string;
  fitRange: { min: number; max: number } | null;
  onFitRangeChange: (min: number, max: number) => void;
  residuals: Array<{ x: number; y: number }> | null;
  summary: string;
  /** Lets the lab reach the rendered SVG in order to save it as an image. */
  exportRef?: { current: SVGSVGElement | null };
  /** What an empty graph says; defaults to the video lab's prompt. */
  emptyMessage?: string;
  /**
   * Fixed axis bounds, used exactly as given (no padding). Null or omitted
   * means auto-scale to the data. Data outside a fixed range is clipped to the
   * plot frame, so zooming in never draws over the axes.
   */
  xRange?: { min: number; max: number } | null;
  yRange?: { min: number; max: number } | null;
  /** Snap to the nearest data point under the pointer and show its value. */
  hover?: boolean;
  /** Text for a hovered or pinned point; defaults to "x, y". */
  formatHover?: (point: HoverCandidate) => string;
  /** Pinned points. Clicking a point toggles it when `onPinsChange` is given. */
  pins?: PlotPin[];
  onPinsChange?: (pins: PlotPin[]) => void;
  /** Makes each axis label a button (opens the caller range controls). */
  onAxisLabelClick?: (axis: 'x' | 'y') => void;
  /** Appends "(zoomed)" to the label so a custom range is never silent. */
  xCustom?: boolean;
  yCustom?: boolean;
}

const VIEW_WIDTH = 720;
const PLOT_HEIGHT = 380;
const RESIDUAL_HEIGHT = 120;
const PAD_LEFT = 74;
const PAD_RIGHT = 22;
const PAD_TOP = 18;
const PAD_BOTTOM = 46;

const axisFormat = (value: number) => {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.01 || magnitude >= 100000)) return value.toExponential(1);
  if (magnitude >= 100) return fixed(value, 0);
  if (magnitude >= 10) return fixed(value, 1);
  return fixed(value, 2);
};

export function AnalysisPlot({
  series,
  xLabel,
  yLabel,
  fitCurve,
  fitColor,
  fitRange,
  onFitRangeChange,
  residuals,
  summary,
  exportRef,
  emptyMessage = 'Mark points on the video to build a graph.',
  xRange = null,
  yRange = null,
  hover = false,
  formatHover,
  pins = [],
  onPinsChange,
  onAxisLabelClick,
  xCustom = false,
  yCustom = false,
}: AnalysisPlotProps) {
  const clipId = useId();
  const [hovered, setHovered] = useState<HoverCandidate | null>(null);
  const clickRef = useRef<HoverCandidate | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // One node, two holders: the drag maths needs it, and so does the exporter.
  const attachSvg = (node: SVGSVGElement | null) => {
    svgRef.current = node;
    if (exportRef) exportRef.current = node;
  };
  const draggingRef = useRef<'min' | 'max' | null>(null);

  const labelClass =
    'outline-none [&:hover>text]:underline [&:focus-visible>text]:underline' +
    (onAxisLabelClick ? ' cursor-pointer' : '');
  const labelButtonProps = (axis: 'x' | 'y') =>
    onAxisLabelClick
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `Set ${axis === 'x' ? 'horizontal' : 'vertical'} axis range`,
          onClick: () => onAxisLabelClick(axis),
          onPointerDown: (event: ReactPointerEvent<SVGGElement>) => event.stopPropagation(),
          onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onAxisLabelClick(axis);
            }
          },
        }
      : {};

  const showResiduals = residuals !== null && residuals.length > 0;
  const viewHeight = PLOT_HEIGHT + (showResiduals ? RESIDUAL_HEIGHT : 0);
  const plotLeft = PAD_LEFT;
  const plotRight = VIEW_WIDTH - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = PLOT_HEIGHT - PAD_BOTTOM;

  const flat = series.flatMap((entry) => entry.points);
  const empty = flat.length === 0;

  // Auto-scale over the error bars too, so a bar is never clipped by the frame.
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  flat.forEach((point) => {
    const ex = point.sigmaX ?? 0;
    const ey = point.sigmaY ?? 0;
    xMin = Math.min(xMin, point.x - ex);
    xMax = Math.max(xMax, point.x + ex);
    yMin = Math.min(yMin, point.y - ey);
    yMax = Math.max(yMax, point.y + ey);
  });
  if (empty) {
    xMin = 0;
    xMax = 1;
    yMin = 0;
    yMax = 1;
  }
  if (xMax - xMin < 1e-12) {
    xMin -= 0.5;
    xMax += 0.5;
  }
  if (yMax - yMin < 1e-12) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const xPad = (xMax - xMin) * 0.06;
  const yPad = (yMax - yMin) * 0.06;
  xMin -= xPad;
  xMax += xPad;
  yMin -= yPad;
  yMax += yPad;
  if (xRange && xRange.max > xRange.min) {
    xMin = xRange.min;
    xMax = xRange.max;
  }
  if (yRange && yRange.max > yRange.min) {
    yMin = yRange.min;
    yMax = yRange.max;
  }

  const xPix = (value: number) =>
    plotLeft + ((value - xMin) / (xMax - xMin)) * (plotRight - plotLeft);
  const yPix = (value: number) =>
    plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const xData = (pixel: number) =>
    xMin + ((pixel - plotLeft) / (plotRight - plotLeft)) * (xMax - xMin);

  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 6);

  const residualExtent = showResiduals
    ? Math.max(...residuals.map((point) => Math.abs(point.y)), 1e-9)
    : 1;
  const residualTop = PLOT_HEIGHT + 12;
  const residualBottom = PLOT_HEIGHT + RESIDUAL_HEIGHT - 34;
  const residualZero = (residualTop + residualBottom) / 2;
  const residualPix = (value: number) =>
    residualZero - (value / residualExtent) * ((residualBottom - residualTop) / 2);

  // Through the SVG screen transform, so a letterboxed plot (the page may cap
  // its height) still maps the pointer onto the right data.
  const toView = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  };

  const pointerToData = (event: ReactPointerEvent<SVGSVGElement>) => {
    const view = toView(event);
    return view ? xData(view.x) : null;
  };

  const candidates: HoverCandidate[] = hover
    ? series.flatMap((entry) =>
        entry.faded
          ? []
          : entry.points.map((point) => ({
              seriesKey: entry.key,
              seriesLabel: entry.label,
              x: point.x,
              y: point.y,
            })),
      )
    : [];

  const pointUnder = (event: ReactPointerEvent<SVGSVGElement>): HoverCandidate | null => {
    if (!hover) return null;
    const view = toView(event);
    if (!view) return null;
    if (view.x < plotLeft || view.x > plotRight || view.y < plotTop || view.y > plotBottom) return null;
    return nearestPoint(candidates, view.x, view.y, { x: xPix, y: yPix });
  };

  const samePin = (a: PlotPin, b: PlotPin) => a.seriesKey === b.seriesKey && a.x === b.x && a.y === b.y;

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    clickRef.current = pointUnder(event);
    if (!fitRange) return;
    const value = pointerToData(event);
    if (value === null) return;
    const toMin = Math.abs(xPix(value) - xPix(fitRange.min));
    const toMax = Math.abs(xPix(value) - xPix(fitRange.max));
    if (Math.min(toMin, toMax) > 18) return;
    clickRef.current = null;
    draggingRef.current = toMin <= toMax ? 'min' : 'max';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort; the drag still follows this element's move events.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const handle = draggingRef.current;
    if (!handle) {
      if (hover) setHovered(pointUnder(event));
      return;
    }
    if (!fitRange) return;
    const value = pointerToData(event);
    if (value === null) return;
    if (handle === 'min') onFitRangeChange(Math.min(value, fitRange.max), fitRange.max);
    else onFitRangeChange(fitRange.min, Math.max(value, fitRange.min));
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const wasDragging = draggingRef.current !== null;
    draggingRef.current = null;
    const clicked = clickRef.current;
    clickRef.current = null;
    if (!wasDragging && clicked && onPinsChange) {
      onPinsChange(
        pins.some((pin) => samePin(pin, clicked))
          ? pins.filter((pin) => !samePin(pin, clicked))
          : [...pins, clicked],
      );
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released.
    }
  };

  // Pinned labels are placed first, then the hover label around them, so a
  // pin never jumps when the pointer moves. Each label tries several spots
  // beside its point and takes the first that overlaps nothing.
  const inFrame = (pin: PlotPin) => {
    const px = xPix(pin.x);
    const py = yPix(pin.y);
    return px >= plotLeft && px <= plotRight && py >= plotTop && py <= plotBottom;
  };
  const labelText = (pin: PlotPin) =>
    formatHover ? formatHover(pin) : `${axisFormat(pin.x)}, ${axisFormat(pin.y)}`;
  const labelBounds = { x: plotLeft, y: plotTop, width: plotRight - plotLeft, height: plotBottom - plotTop };
  const labelEntries = [
    ...pins.filter(inFrame).map((pin) => ({ pin, pinned: true })),
    ...(hover && hovered && inFrame(hovered) ? [{ pin: hovered, pinned: false }] : []),
  ].map((entry) => {
    const text = labelText(entry.pin);
    return { ...entry, text, width: text.length * 6.6 + 14 };
  });
  const markerBoxes = labelEntries.map(({ pin }) => ({
    x: xPix(pin.x) - 8,
    y: yPix(pin.y) - 8,
    width: 16,
    height: 16,
  }));
  const pinnedCount = labelEntries.filter((entry) => entry.pinned).length;
  const pinnedBoxes = placeLabels(
    labelEntries.slice(0, pinnedCount).map(({ pin, width }) => ({
      cx: xPix(pin.x),
      cy: yPix(pin.y),
      width,
      height: 20,
    })),
    labelBounds,
    markerBoxes,
  );
  const hoverBoxes = placeLabels(
    labelEntries.slice(pinnedCount).map(({ pin, width }) => ({
      cx: xPix(pin.x),
      cy: yPix(pin.y),
      width,
      height: 20,
    })),
    labelBounds,
    [...markerBoxes, ...pinnedBoxes],
  );
  const labelPlacements = labelEntries.map((entry, index) => ({
    ...entry,
    box: index < pinnedCount ? pinnedBoxes[index] : hoverBoxes[index - pinnedCount],
  }));

  return (
    <svg
      ref={attachSvg}
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      role="img"
      aria-label={summary}
      className="block h-auto w-full touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHovered(null)}
    >
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={plotLeft}
            y1={yPix(tick)}
            x2={plotRight}
            y2={yPix(tick)}
            stroke="var(--grid-line)"
            strokeWidth={tick === 0 ? 1.2 : 0.5}
            opacity={tick === 0 ? 0.9 : 0.6}
          />
          <text
            x={plotLeft - 8}
            y={yPix(tick) + 4}
            textAnchor="end"
            fill="var(--text-muted)"
            fontSize="12"
          >
            {axisFormat(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            x1={xPix(tick)}
            y1={plotTop}
            x2={xPix(tick)}
            y2={plotBottom}
            stroke="var(--grid-line)"
            strokeWidth={0.5}
            opacity={0.5}
          />
          <text
            x={xPix(tick)}
            y={plotBottom + 18}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="12"
          >
            {axisFormat(tick)}
          </text>
        </g>
      ))}

      <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke="var(--grid-line)" />
      <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="var(--grid-line)" />

      <g data-axis-label="x" {...labelButtonProps('x')} className={labelClass}>
        {onAxisLabelClick && (
          <rect x={(plotLeft + plotRight) / 2 - 100} y={plotBottom + 24} width={200} height={20} fill="transparent" />
        )}
        <text
          x={(plotLeft + plotRight) / 2}
          y={plotBottom + 38}
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="13"
          fontWeight={600}
        >
          {xCustom ? `${xLabel} (zoomed)` : xLabel}
        </text>
      </g>
      <g
        data-axis-label="y"
        {...labelButtonProps('y')}
        className={labelClass}
        transform={`rotate(-90 16 ${(plotTop + plotBottom) / 2})`}
      >
        {onAxisLabelClick && (
          <rect x={16 - 100} y={(plotTop + plotBottom) / 2 - 14} width={200} height={20} fill="transparent" />
        )}
        <text
          x={16}
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="13"
          fontWeight={600}
        >
          {yCustom ? `${yLabel} (zoomed)` : yLabel}
        </text>
      </g>

      {/* The fit range, drawn under the data so it never hides a point. */}
      {fitRange && (
        <g>
          <rect
            x={xPix(fitRange.min)}
            y={plotTop}
            width={Math.max(0, xPix(fitRange.max) - xPix(fitRange.min))}
            height={plotBottom - plotTop}
            fill="var(--accent-blue)"
            opacity={0.06}
          />
          {([fitRange.min, fitRange.max] as const).map((value, index) => (
            <g key={index} style={{ cursor: 'ew-resize' }}>
              <line
                x1={xPix(value)}
                y1={plotTop}
                x2={xPix(value)}
                y2={plotBottom}
                stroke="var(--accent-blue)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <rect
                x={xPix(value) - 5}
                y={plotTop}
                width={10}
                height={plotBottom - plotTop}
                fill="transparent"
              />
              <circle cx={xPix(value)} cy={plotTop + 8} r={5} fill="var(--accent-blue)" />
            </g>
          ))}
        </g>
      )}

      <clipPath id={clipId}>
        <rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop} />
      </clipPath>

      {series.map((entry) => (
        <g
          key={entry.key}
          clipPath={`url(#${clipId})`}
          stroke={entry.color}
          fill={entry.color}
          opacity={entry.faded ? 0.3 : undefined}
        >
          {entry.points.map((point, index) => {
            const cx = xPix(point.x);
            const cy = yPix(point.y);
            const ey = point.sigmaY ?? 0;
            const ex = point.sigmaX ?? 0;
            return (
              <g key={index}>
                {ey > 0 && (
                  <>
                    <line
                      x1={cx}
                      y1={yPix(point.y - ey)}
                      x2={cx}
                      y2={yPix(point.y + ey)}
                      strokeWidth={1.4}
                      opacity={0.8}
                    />
                    <line
                      x1={cx - 4}
                      y1={yPix(point.y + ey)}
                      x2={cx + 4}
                      y2={yPix(point.y + ey)}
                      strokeWidth={1.4}
                      opacity={0.8}
                    />
                    <line
                      x1={cx - 4}
                      y1={yPix(point.y - ey)}
                      x2={cx + 4}
                      y2={yPix(point.y - ey)}
                      strokeWidth={1.4}
                      opacity={0.8}
                    />
                  </>
                )}
                {ex > 0 && (
                  <line
                    x1={xPix(point.x - ex)}
                    y1={cy}
                    x2={xPix(point.x + ex)}
                    y2={cy}
                    strokeWidth={1.4}
                    opacity={0.8}
                  />
                )}
                <path d={markerPath(entry.shape, cx, cy, 3.6)} strokeWidth={1} />
              </g>
            );
          })}
        </g>
      ))}

      {/* The fit is drawn over the data, on a halo in the plot colour, so a
          dense run of points can never hide the function that describes it. */}
      {fitCurve && fitCurve.length > 1 && (
        <g clipPath={`url(#${clipId})`} fill="none" strokeLinejoin="round" strokeLinecap="round">
          <polyline
            points={fitCurve.map((point) => `${xPix(point.x)},${yPix(point.y)}`).join(' ')}
            stroke="var(--surface-plot)"
            strokeWidth={7}
            opacity={0.85}
          />
          <polyline
            points={fitCurve.map((point) => `${xPix(point.x)},${yPix(point.y)}`).join(' ')}
            stroke={fitColor}
            strokeWidth={3}
          />
        </g>
      )}

      {labelPlacements.map(({ pin, pinned, box, text }, index) => (
        <g key={`${pinned ? 'pin' : 'hover'}-${index}`} pointerEvents="none">
          <circle
            cx={xPix(pin.x)}
            cy={yPix(pin.y)}
            r={7}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={1.6}
          />
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={4}
            fill="var(--surface-elevated)"
            stroke={pinned ? 'var(--accent-blue)' : 'var(--grid-line)'}
          />
          <text x={box.x + 7} y={box.y + 14} fontSize="11.5" fill="var(--text-primary)">
            {text}
          </text>
        </g>
      ))}

      {series.filter((entry) => !entry.faded).length > 1 && (
        <g>
          {series
            .filter((entry) => !entry.faded)
            .map((entry, index) => (
            <g key={`legend-${entry.key}`}>
              <path
                d={markerPath(entry.shape, plotLeft + 10, plotTop + 12 + index * 16, 4)}
                fill={entry.color}
                stroke={entry.color}
              />
              <text
                x={plotLeft + 20}
                y={plotTop + 16 + index * 16}
                fill="var(--text-muted)"
                fontSize="11"
              >
                {entry.label}
              </text>
            </g>
          ))}
        </g>
      )}

      {empty && (
        <text
          x={(plotLeft + plotRight) / 2}
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="14"
        >
          {emptyMessage}
        </text>
      )}

      {showResiduals && (
        <g>
          <line
            x1={plotLeft}
            y1={residualZero}
            x2={plotRight}
            y2={residualZero}
            stroke="var(--grid-line)"
            strokeWidth={1}
          />
          {residuals.map((point, index) => (
            <g key={`residual-${index}`}>
              <line
                x1={xPix(point.x)}
                y1={residualZero}
                x2={xPix(point.x)}
                y2={residualPix(point.y)}
                stroke={fitColor}
                strokeWidth={1.2}
                opacity={0.7}
              />
              <circle cx={xPix(point.x)} cy={residualPix(point.y)} r={2.6} fill={fitColor} />
            </g>
          ))}
          <text
            x={plotLeft - 8}
            y={residualZero + 4}
            textAnchor="end"
            fill="var(--text-muted)"
            fontSize="11"
          >
            0
          </text>
          <text
            x={(plotLeft + plotRight) / 2}
            y={residualBottom + 22}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="12"
          >
            residuals (± {axisFormat(residualExtent)})
          </text>
        </g>
      )}
    </svg>
  );
}

export default AnalysisPlot;
