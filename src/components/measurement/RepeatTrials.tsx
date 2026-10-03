import { useMemo, useState } from 'react';
import { Button, ControlBar } from '../shared/InlineControls';
import { formatMeasurement } from '../../lib/measurement/uncertainty';
import { RC_DEFAULT_SEED, RC_TRUTH, fitRc, generateRcData, runTrials } from '../../lib/measurement/rcFit';

// Repeat the whole experiment and fit each run. The first run is the dataset the
// rest of the page uses; every later run is the same circuit with fresh voltmeter
// noise. The spread of the fitted τ values is an uncertainty you can measure
// directly, with no formula at all.

const MAX_RUNS = 200;
const AXIS_MIN = 1.9;
const AXIS_MAX = 2.5;
const BIN_WIDTH = 0.02;

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 230;
const PAD_LEFT = 24;
const PAD_RIGHT = 24;
const BASELINE = 178;

const FIRST_FIT = fitRc(generateRcData(RC_DEFAULT_SEED));

export function RepeatTrials() {
  const [runs, setRuns] = useState(1);
  const summary = useMemo(() => runTrials(RC_DEFAULT_SEED, runs), [runs]);

  const xPix = (value: number) =>
    PAD_LEFT + ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (VIEW_WIDTH - PAD_LEFT - PAD_RIGHT);

  // Stack the τ values into bins so repeated results pile up into a histogram.
  const bins = new Map<number, number[]>();
  summary.taus.forEach((value, index) => {
    const key = Math.round((value - AXIS_MIN) / BIN_WIDTH);
    bins.set(key, [...(bins.get(key) ?? []), index]);
  });
  const tallest = Math.max(1, ...Array.from(bins.values(), (stack) => stack.length));
  const dotRadius = Math.min(5, (BASELINE - 40) / (2 * tallest + 1));

  const hasSpread = Number.isFinite(summary.scatter);
  const fitUncertainty = FIRST_FIT.ok ? FIRST_FIT.fit.uncertainties[1] : Number.NaN;

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[680px] flex-col gap-3 text-[var(--text-primary)]">
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--grid-line)] bg-[var(--surface-plot)]">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Histogram of ${summary.taus.length} fitted time constants${hasSpread ? `, mean ${summary.mean.toFixed(3)} seconds with scatter ${summary.scatter.toFixed(3)} seconds` : ''}.`}
          className="block h-auto w-full select-none"
        >
          {hasSpread && (
            <rect
              x={xPix(summary.mean - summary.scatter)}
              y={20}
              width={xPix(summary.mean + summary.scatter) - xPix(summary.mean - summary.scatter)}
              height={BASELINE - 20}
              fill="var(--accent-blue)"
              opacity={0.14}
            />
          )}
          <line x1={PAD_LEFT} y1={BASELINE} x2={VIEW_WIDTH - PAD_RIGHT} y2={BASELINE} stroke="var(--grid-line)" />
          {[2.0, 2.1, 2.2, 2.3, 2.4].map((tick) => (
            <g key={tick}>
              <line x1={xPix(tick)} y1={BASELINE} x2={xPix(tick)} y2={BASELINE + 5} stroke="var(--grid-line)" />
              <text x={xPix(tick)} y={BASELINE + 19} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
                {tick.toFixed(1)}
              </text>
            </g>
          ))}
          <text x={VIEW_WIDTH / 2} y={BASELINE + 40} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight={600}>
            fitted time constant τ (s)
          </text>

          <line x1={xPix(RC_TRUTH.tau)} y1={20} x2={xPix(RC_TRUTH.tau)} y2={BASELINE} stroke="var(--accent-green)" strokeWidth={1.6} strokeDasharray="6 4" />
          <text x={xPix(RC_TRUTH.tau) + 6} y={30} fill="var(--accent-green)" fontSize="11">
            R·C = 2.2 s
          </text>

          {Array.from(bins.entries()).flatMap(([key, stack]) =>
            stack.map((runIndex, level) => (
              <circle
                key={runIndex}
                cx={xPix(AXIS_MIN + key * BIN_WIDTH)}
                cy={BASELINE - dotRadius - level * 2 * dotRadius}
                r={dotRadius}
                fill={runIndex === 0 ? 'var(--accent-red)' : 'var(--accent-purple)'}
                opacity={0.9}
              />
            )),
          )}

          {hasSpread && (
            <line x1={xPix(summary.mean)} y1={20} x2={xPix(summary.mean)} y2={BASELINE} stroke="var(--accent-blue)" strokeWidth={1.6} />
          )}
        </svg>
      </div>

      <ControlBar>
        <Button variant="secondary" disabled={runs >= MAX_RUNS} onClick={() => setRuns((n) => Math.min(MAX_RUNS, n + 1))}>
          Run it again
        </Button>
        <Button variant="secondary" disabled={runs >= MAX_RUNS} onClick={() => setRuns((n) => Math.min(MAX_RUNS, n + 10))}>
          Run 10 more
        </Button>
        <Button variant="secondary" disabled={runs === 1} onClick={() => setRuns(1)}>
          Start over
        </Button>
      </ControlBar>

      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        {hasSpread ? (
          <>
            {summary.taus.length} runs: mean τ = {summary.mean.toFixed(3)} s, standard deviation of the
            fitted values = {summary.scatter.toFixed(3)} s
            {Number.isFinite(fitUncertainty) ? (
              <>
                . The fit to the first run (red) alone gave τ = {formatMeasurement({ value: FIRST_FIT.ok ? FIRST_FIT.fit.parameters[1] : 0, uncertainty: fitUncertainty })} s,
                an uncertainty of {fitUncertainty.toFixed(3)} s.
              </>
            ) : (
              '.'
            )}
          </>
        ) : (
          <>One run gives one τ. Run the experiment again and see how much it moves.</>
        )}
      </p>
    </div>
  );
}
