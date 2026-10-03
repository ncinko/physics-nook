import { useId } from 'react';
import type { FitPoint } from '../../lib/math/leastSquares';

// The graph shared by the three fitting islands: data with error bars, any
// number of model curves, and a residual strip underneath.
//
// Axes are fixed by the caller rather than auto-scaled. When a slider drags a
// curve around, a rescaling plot would hide exactly the thing the student is
// meant to watch — the residuals growing and bending.

export interface FitCurve {
  fn: (x: number) => number;
  color: string;
  dashed?: boolean;
}

interface FitPlotProps {
  points: readonly FitPoint[];
  curves: readonly FitCurve[];
  /** One residual per point, in the same units as y. Omit to hide the strip. */
  residuals?: readonly number[] | null;
  /** Half-height of the residual strip, in the units of y. */
  residualExtent?: number;
  /** Draws a ±sigma band on the residual strip: "this much scatter is just noise". */
  residualBand?: number;
  residualColor?: string;
  xRange: readonly [number, number];
  yRange: readonly [number, number];
  xTicks: readonly number[];
  yTicks: readonly number[];
  xLabel: string;
  yLabel: string;
  residualLabel?: string;
  summary: string;
}

const VIEW_WIDTH = 640;
const PLOT_HEIGHT = 330;
const RESIDUAL_HEIGHT = 130;
const PAD_LEFT = 58;
const PAD_RIGHT = 18;
const PAD_TOP = 14;
const PAD_BOTTOM = 44;
const CURVE_SAMPLES = 160;

const tickText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export function FitPlot({
  points,
  curves,
  residuals = null,
  residualExtent = 0.2,
  residualBand,
  residualColor = 'var(--accent-red)',
  xRange,
  yRange,
  xTicks,
  yTicks,
  xLabel,
  yLabel,
  residualLabel = 'residuals (V)',
  summary,
}: FitPlotProps) {
  const clipId = `fit-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const showResiduals = residuals !== null && residuals.length > 0;
  const viewHeight = PLOT_HEIGHT + (showResiduals ? RESIDUAL_HEIGHT : 0);

  const plotLeft = PAD_LEFT;
  const plotRight = VIEW_WIDTH - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = PLOT_HEIGHT - PAD_BOTTOM;

  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xPix = (value: number) => plotLeft + ((value - xMin) / (xMax - xMin)) * (plotRight - plotLeft);
  const yPix = (value: number) => plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - plotTop);

  const residualTop = PLOT_HEIGHT + 6;
  const residualBottom = PLOT_HEIGHT + RESIDUAL_HEIGHT - 30;
  const residualZero = (residualTop + residualBottom) / 2;
  const residualHalf = (residualBottom - residualTop) / 2;
  // Residuals past the strip are pinned to its edge rather than drawn off-screen.
  const residualPix = (value: number) =>
    residualZero - (Math.max(-residualExtent, Math.min(residualExtent, value)) / residualExtent) * residualHalf;

  const curvePath = (fn: (x: number) => number) =>
    Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
      const x = xMin + ((xMax - xMin) * i) / CURVE_SAMPLES;
      return `${xPix(x).toFixed(1)},${yPix(fn(x)).toFixed(1)}`;
    }).join(' ');

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      role="img"
      aria-label={summary}
      className="block h-auto w-full select-none"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop} />
        </clipPath>
      </defs>

      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={plotLeft} y1={yPix(tick)} x2={plotRight} y2={yPix(tick)} stroke="var(--grid-line)" strokeWidth={0.5} opacity={0.6} />
          <text x={plotLeft - 8} y={yPix(tick) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="12">
            {tickText(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={xPix(tick)} y1={plotTop} x2={xPix(tick)} y2={plotBottom} stroke="var(--grid-line)" strokeWidth={0.5} opacity={0.5} />
          <text x={xPix(tick)} y={plotBottom + 18} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
            {tickText(tick)}
          </text>
        </g>
      ))}
      <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke="var(--grid-line)" />
      <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="var(--grid-line)" />

      <text x={(plotLeft + plotRight) / 2} y={plotBottom + 36} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight={600}>
        {xLabel}
      </text>
      <text
        x={14}
        y={(plotTop + plotBottom) / 2}
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize="13"
        fontWeight={600}
        transform={`rotate(-90 14 ${(plotTop + plotBottom) / 2})`}
      >
        {yLabel}
      </text>

      <g clipPath={`url(#${clipId})`}>
        {curves.map((curve, index) => (
          <polyline
            key={index}
            points={curvePath(curve.fn)}
            fill="none"
            stroke={curve.color}
            strokeWidth={2.2}
            strokeDasharray={curve.dashed ? '7 5' : undefined}
          />
        ))}
      </g>

      {points.map((point, index) => {
        const cx = xPix(point.x);
        const sigma = point.sigma ?? 0;
        return (
          <g key={index} stroke="var(--accent-blue)" fill="var(--accent-blue)">
            {sigma > 0 && (
              <>
                <line x1={cx} y1={yPix(point.y - sigma)} x2={cx} y2={yPix(point.y + sigma)} strokeWidth={1.3} opacity={0.75} />
                <line x1={cx - 3.5} y1={yPix(point.y + sigma)} x2={cx + 3.5} y2={yPix(point.y + sigma)} strokeWidth={1.3} opacity={0.75} />
                <line x1={cx - 3.5} y1={yPix(point.y - sigma)} x2={cx + 3.5} y2={yPix(point.y - sigma)} strokeWidth={1.3} opacity={0.75} />
              </>
            )}
            <circle cx={cx} cy={yPix(point.y)} r={3.2} strokeWidth={0} />
          </g>
        );
      })}

      {showResiduals && (
        <g>
          {residualBand !== undefined && residualBand > 0 && (
            <rect
              x={plotLeft}
              y={residualPix(residualBand)}
              width={plotRight - plotLeft}
              height={Math.max(0, residualPix(-residualBand) - residualPix(residualBand))}
              fill="var(--accent-blue)"
              opacity={0.1}
            />
          )}
          <line x1={plotLeft} y1={residualZero} x2={plotRight} y2={residualZero} stroke="var(--grid-line)" strokeWidth={1.2} />
          {residuals.map((value, index) => {
            const x = xPix(points[index].x);
            const pinned = Math.abs(value) > residualExtent;
            return (
              <g key={`r-${index}`}>
                <line x1={x} y1={residualZero} x2={x} y2={residualPix(value)} stroke={residualColor} strokeWidth={1.2} opacity={0.7} />
                <circle cx={x} cy={residualPix(value)} r={2.8} fill={residualColor} opacity={pinned ? 0.5 : 1} />
              </g>
            );
          })}
          <text x={plotLeft - 8} y={residualTop + 4} textAnchor="end" fill="var(--text-muted)" fontSize="11">
            +{tickText(Number(residualExtent.toPrecision(2)))}
          </text>
          <text x={plotLeft - 8} y={residualZero + 4} textAnchor="end" fill="var(--text-muted)" fontSize="11">
            0
          </text>
          <text x={plotLeft - 8} y={residualBottom + 4} textAnchor="end" fill="var(--text-muted)" fontSize="11">
            −{tickText(Number(residualExtent.toPrecision(2)))}
          </text>
          <text x={(plotLeft + plotRight) / 2} y={residualBottom + 24} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
            {residualLabel}
          </text>
        </g>
      )}
    </svg>
  );
}
