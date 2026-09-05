import { useMemo } from 'react';
import { niceTicks } from '../../../lib/kinematics/videoAnalysis';
import {
  GUIDE_BAND,
  describeTarget,
  targetSeries,
  type TargetGraph,
} from '../../../lib/kinematics/motionGame';

// SVG rather than canvas, for the reason already written down in
// AnalysisPlot.tsx: the point counts are in the hundreds, the axis text needs
// to stay crisp, and theme colours can be written as `stroke="var(--accent-blue)"`
// and simply repaint when the theme changes.

export interface TracePoint {
  t: number;
  /** null where the detector lost the player, so the line breaks honestly. */
  value: number | null;
}

interface TargetPlotProps {
  graph: TargetGraph;
  trace: TracePoint[];
  /** Seconds into the round, or null when not recording. */
  now: number | null;
  className?: string;
}

const VIEW_W = 720;
const VIEW_H = 340;
const PAD = { top: 16, right: 16, bottom: 40, left: 56 };

const PLOT_L = PAD.left;
const PLOT_R = VIEW_W - PAD.right;
const PLOT_T = PAD.top;
const PLOT_B = VIEW_H - PAD.bottom;

/** Splits at nulls so a dropout leaves a gap instead of a straight line across it. */
const toPaths = (
  points: TracePoint[],
  xPix: (t: number) => number,
  yPix: (value: number) => number,
): string[] => {
  const paths: string[] = [];
  let current: string[] = [];

  points.forEach((point) => {
    if (point.value === null || !Number.isFinite(point.value)) {
      if (current.length > 1) paths.push(current.join(' '));
      current = [];
      return;
    }
    const command = current.length === 0 ? 'M' : 'L';
    current.push(`${command}${xPix(point.t).toFixed(1)},${yPix(point.value).toFixed(1)}`);
  });

  if (current.length > 1) paths.push(current.join(' '));
  return paths;
};

export default function TargetPlot({ graph, trace, now, className = '' }: TargetPlotProps) {
  const xPix = (t: number) => PLOT_L + (t / graph.durationSeconds) * (PLOT_R - PLOT_L);
  const yPix = (value: number) =>
    PLOT_B - ((value - graph.axisMin) / (graph.axisMax - graph.axisMin)) * (PLOT_B - PLOT_T);

  const target = useMemo(() => targetSeries(graph, 0.05), [graph]);
  const guide = GUIDE_BAND[graph.quantity];

  const targetPath = useMemo(
    () =>
      target
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${xPix(point.t).toFixed(1)},${yPix(point.value).toFixed(1)}`,
        )
        .join(' '),
    [target, graph],
  );

  // A guide band around the target, drawn as one closed shape: out along the
  // top edge, back along the bottom. It helps someone walking see roughly where
  // they should be; it is not a scoring threshold, so the legend does not put a
  // number on it.
  const bandPath = useMemo(() => {
    const upper = target.map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${xPix(point.t).toFixed(1)},${yPix(point.value + guide).toFixed(1)}`,
    );
    const lower = [...target]
      .reverse()
      .map((point) => `L${xPix(point.t).toFixed(1)},${yPix(point.value - guide).toFixed(1)}`);
    return `${upper.join(' ')} ${lower.join(' ')} Z`;
  }, [target, guide, graph]);

  const tracePaths = useMemo(() => toPaths(trace, xPix, yPix), [trace, graph]);

  const yTicks = useMemo(() => niceTicks(graph.axisMin, graph.axisMax, 6), [graph]);
  const xTicks = useMemo(() => niceTicks(0, graph.durationSeconds, 7), [graph]);

  const axisLabel = graph.quantity === 'position' ? 'Distance from detector (m)' : 'Velocity (m/s)';

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={`w-full ${className}`.trim()}
      role="img"
      aria-label={describeTarget(graph)}
    >
      <rect x={PLOT_L} y={PLOT_T} width={PLOT_R - PLOT_L} height={PLOT_B - PLOT_T} fill="var(--sim-bg)" />

      {yTicks.map((value) => (
        <g key={`y${value}`}>
          <line
            x1={PLOT_L}
            x2={PLOT_R}
            y1={yPix(value)}
            y2={yPix(value)}
            stroke="var(--grid-line)"
            strokeWidth={1}
          />
          <text
            x={PLOT_L - 8}
            y={yPix(value) + 4}
            textAnchor="end"
            fontSize={12}
            fill="var(--text-muted)"
          >
            {value}
          </text>
        </g>
      ))}

      {xTicks.map((value) => (
        <g key={`x${value}`}>
          <line
            x1={xPix(value)}
            x2={xPix(value)}
            y1={PLOT_T}
            y2={PLOT_B}
            stroke="var(--grid-line)"
            strokeWidth={1}
          />
          <text
            x={xPix(value)}
            y={PLOT_B + 18}
            textAnchor="middle"
            fontSize={12}
            fill="var(--text-muted)"
          >
            {value}
          </text>
        </g>
      ))}

      {/* Zero line matters on the velocity graph: it separates walking away
          from walking back. */}
      {graph.axisMin < 0 && (
        <line
          x1={PLOT_L}
          x2={PLOT_R}
          y1={yPix(0)}
          y2={yPix(0)}
          stroke="var(--text-muted)"
          strokeWidth={1.5}
        />
      )}

      <path d={bandPath} fill="var(--accent-green)" opacity={0.16} />
      <path d={targetPath} fill="none" stroke="var(--accent-green)" strokeWidth={2.5} />

      {tracePaths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {now !== null && (
        <line
          x1={xPix(now)}
          x2={xPix(now)}
          y1={PLOT_T}
          y2={PLOT_B}
          stroke="var(--accent-red)"
          strokeWidth={2}
        />
      )}

      <text
        x={12}
        y={PLOT_T + (PLOT_B - PLOT_T) / 2}
        fontSize={12}
        fill="var(--text-muted)"
        textAnchor="middle"
        transform={`rotate(-90 12 ${PLOT_T + (PLOT_B - PLOT_T) / 2})`}
      >
        {axisLabel}
      </text>
      <text x={(PLOT_L + PLOT_R) / 2} y={VIEW_H - 6} fontSize={12} fill="var(--text-muted)" textAnchor="middle">
        Time (s)
      </text>

      <g transform={`translate(${PLOT_R - 190}, ${PLOT_T + 14})`}>
        <line x1={0} x2={22} y1={0} y2={0} stroke="var(--accent-green)" strokeWidth={2.5} />
        <text x={28} y={4} fontSize={11} fill="var(--text-muted)">
          target
        </text>
        <line x1={0} x2={22} y1={16} y2={16} stroke="var(--accent-blue)" strokeWidth={2.5} />
        <text x={28} y={20} fontSize={11} fill="var(--text-muted)">
          you
        </text>
      </g>
    </svg>
  );
}
