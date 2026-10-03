import { useState } from 'react';
import { Button, ControlBar, Slider, Toggle } from '../shared/InlineControls';
import { FitPlot } from './FitPlot';
import { formatMeasurement } from '../../lib/measurement/uncertainty';
import {
  RC_DELAYED_SEED,
  RC_SIGMA,
  bestDelayedForTau,
  delayedChiSquareAt,
  delayedResiduals,
  delayedVoltage,
  deltaChiIntervalDelayed,
  fitDelayedRc,
  generateDelayedRcData,
  profileDelayedChiSquare,
} from '../../lib/measurement/rcFit';

// The by-hand method, made explicit. Drag the parameters, watch the residuals,
// and mark the τ values where the fit has visibly stopped working. A reveal then
// lays the formal χ² answer over the student's own range.
//
// This run starts recording before the switch closes, so the model has a third
// parameter, the start time t0. Three parameters make the "re-adjust the others"
// step matter more: τ, V0 and t0 are all correlated.

const DATA = generateDelayedRcData(RC_DELAYED_SEED);
const BEST = fitDelayedRc(DATA);

const TAU_MIN = 1.0;
const TAU_MAX = 3.0;
const TAU_TICKS = [1.8, 2.0, 2.2, 2.4, 2.6];
const CHI_RISE_SHOWN = 16;

const PROFILE = profileDelayedChiSquare(
  DATA,
  Array.from({ length: 101 }, (_, i) => TAU_MIN + ((TAU_MAX - TAU_MIN) * i) / 100),
);

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 230;
const PAD_LEFT = 58;
const PAD_RIGHT = 18;
const PAD_TOP = 14;
const PAD_BOTTOM = 44;

export function TauByEye() {
  const [v0, setV0] = useState(4.7);
  const [tau, setTau] = useState(2.55);
  const [t0, setT0] = useState(0.9);
  const [autoRest, setAutoRest] = useState(false);
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [reveal, setReveal] = useState(false);

  if (!BEST.ok) return null;
  const best = BEST.fit;
  const bestTau = best.parameters[1];
  const interval = deltaChiIntervalDelayed(DATA, bestTau);

  // With "re-adjust" on, Vb and t0 are whatever minimize χ² at this τ.
  const tuned = autoRest ? bestDelayedForTau(DATA, tau) : null;
  const effectiveV0 = tuned ? tuned.v0 : v0;
  const effectiveT0 = tuned ? tuned.t0 : t0;
  const residuals = delayedResiduals(DATA, effectiveV0, tau, effectiveT0);

  // The by-eye statement appears as soon as either edge is marked; an unmarked
  // edge reads "?" so a click always visibly does something.
  const hasMark = low !== null || high !== null;
  const marks = low !== null && high !== null ? [Math.min(low, high), Math.max(low, high)] : null;
  const byEye = marks ? { value: (marks[0] + marks[1]) / 2, uncertainty: (marks[1] - marks[0]) / 2 } : null;
  const edge = (value: number | null) => (value === null ? '?' : value.toFixed(2));

  // χ² profile geometry.
  const chiMin = best.chiSquare;
  const plotLeft = PAD_LEFT;
  const plotRight = VIEW_WIDTH - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = VIEW_HEIGHT - PAD_BOTTOM;
  const yLow = chiMin - 2;
  const yHigh = chiMin + CHI_RISE_SHOWN;
  const xPix = (value: number) => plotLeft + ((value - TAU_MIN) / (TAU_MAX - TAU_MIN)) * (plotRight - plotLeft);
  const yPix = (value: number) => plotBottom - ((value - yLow) / (yHigh - yLow)) * (plotBottom - plotTop);
  const profilePath = PROFILE.map((entry) => `${xPix(entry.tau).toFixed(1)},${yPix(entry.chiSquare).toFixed(1)}`).join(' ');
  const currentChi = delayedChiSquareAt(DATA, effectiveV0, tau, effectiveT0);

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[680px] flex-col gap-3 text-[var(--text-primary)]">
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--grid-line)] bg-[var(--surface-plot)]">
        <FitPlot
          points={DATA}
          curves={[{ fn: (t) => delayedVoltage(t, effectiveV0, tau, effectiveT0), color: 'var(--accent-red)' }]}
          residuals={residuals}
          residualExtent={0.6}
          residualBand={RC_SIGMA}
          xRange={[0, 10.5]}
          yRange={[-0.3, 5.5]}
          xTicks={[0, 2, 4, 6, 8, 10]}
          yTicks={[0, 1, 2, 3, 4, 5]}
          xLabel="time t (s)"
          yLabel="capacitor voltage V (V)"
          summary={`Delayed exponential charging curve with V0 = ${effectiveV0.toFixed(2)} V, tau = ${tau.toFixed(2)} s and start time t0 = ${effectiveT0.toFixed(2)} s drawn over the data, with residuals below.`}
        />
      </div>

      <ControlBar>
        <Slider label={<>V<sub>b</sub></>} ariaLabel="V b" unit="V" min={4.5} max={5.5} step={0.01} value={effectiveV0} onChange={setV0} disabled={autoRest} format={(value) => value.toFixed(2)} />
        <Slider label={<>t<sub>0</sub></>} ariaLabel="t 0" unit="s" min={0.5} max={2} step={0.01} value={effectiveT0} onChange={setT0} disabled={autoRest} format={(value) => value.toFixed(2)} />
        <Slider label="τ" unit="s" min={TAU_MIN} max={TAU_MAX} step={0.01} value={tau} onChange={setTau} format={(value) => value.toFixed(2)} />
        <Toggle
          label={<>Re-adjust V<sub>b</sub> and t<sub>0</sub> for me</>}
          checked={autoRest}
          onChange={(checked) => {
            // Hand control back where the automatic values left off.
            if (!checked) {
              setV0(Math.min(5.5, Math.max(4.5, effectiveV0)));
              setT0(Math.min(2, Math.max(0.5, effectiveT0)));
            }
            setAutoRest(checked);
          }}
        />
      </ControlBar>

      <ControlBar>
        <Button variant="secondary" onClick={() => setLow(tau)}>Mark low edge (τ = {tau.toFixed(2)})</Button>
        <Button variant="secondary" onClick={() => setHigh(tau)}>Mark high edge (τ = {tau.toFixed(2)})</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setLow(null);
            setHigh(null);
          }}
        >
          Clear marks
        </Button>
      </ControlBar>

      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        {hasMark ? (
          <>
            By eye: τ from {marks ? edge(marks[0]) : edge(low)} to {marks ? edge(marks[1]) : edge(high)} s, so τ ={' '}
            {byEye ? formatMeasurement(byEye) : '?'} s.
          </>
        ) : (
          <>
            Slide τ until the residuals stop looking like random scatter, and mark that edge. Then slide
            the other way. Re-tune V<sub>b</sub> and t<sub>0</sub> each time.
          </>
        )}
      </p>

      <div className="flex justify-center">
        <Toggle label="Reveal the χ² answer" checked={reveal} onChange={setReveal} />
      </div>

      {reveal && interval && (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--grid-line)] bg-[var(--surface-plot)]">
            <svg
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              role="img"
              aria-label={`Chi-square versus tau. The minimum is ${chiMin.toFixed(1)} at tau = ${bestTau.toFixed(2)} seconds, and chi-square rises by 1 at ${interval.low.toFixed(2)} and ${interval.high.toFixed(2)} seconds.`}
              className="block h-auto w-full select-none"
            >
              <defs>
                <clipPath id="tau-chi-clip">
                  <rect x={plotLeft} y={plotTop} width={plotRight - plotLeft} height={plotBottom - plotTop} />
                </clipPath>
              </defs>
              {TAU_TICKS.map((tick) => (
                <g key={tick}>
                  <line x1={xPix(tick)} y1={plotTop} x2={xPix(tick)} y2={plotBottom} stroke="var(--grid-line)" strokeWidth={0.5} opacity={0.5} />
                  <text x={xPix(tick)} y={plotBottom + 18} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
                    {tick.toFixed(1)}
                  </text>
                </g>
              ))}
              <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke="var(--grid-line)" />
              <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="var(--grid-line)" />
              <text x={(plotLeft + plotRight) / 2} y={plotBottom + 36} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight={600}>
                time constant τ (s)
              </text>
              <text x={14} y={(plotTop + plotBottom) / 2} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight={600} transform={`rotate(-90 14 ${(plotTop + plotBottom) / 2})`}>
                χ²
              </text>

              <g clipPath="url(#tau-chi-clip)">
                {/* the formal range: where χ² is within 1 of its minimum */}
                <rect x={xPix(interval.low)} y={plotTop} width={xPix(interval.high) - xPix(interval.low)} height={plotBottom - plotTop} fill="var(--accent-blue)" opacity={0.14} />
                <line x1={plotLeft} y1={yPix(chiMin + 1)} x2={plotRight} y2={yPix(chiMin + 1)} stroke="var(--accent-blue)" strokeWidth={1.2} strokeDasharray="6 4" />
                <polyline points={profilePath} fill="none" stroke="var(--accent-purple)" strokeWidth={2.2} />
                {marks &&
                  marks.map((value, index) => (
                    <line key={index} x1={xPix(value)} y1={plotTop} x2={xPix(value)} y2={plotBottom} stroke="var(--accent-red)" strokeWidth={2} />
                  ))}
                {tau >= TAU_MIN && tau <= TAU_MAX && (
                  <circle cx={xPix(tau)} cy={yPix(currentChi)} r={4.5} fill="var(--accent-red)" stroke="var(--surface-plot)" strokeWidth={1.5} />
                )}
              </g>
              <text x={plotRight - 4} y={yPix(chiMin + 1) - 6} textAnchor="end" fill="var(--accent-blue)" fontSize="11">
                χ²min + 1
              </text>
            </svg>
          </div>
          <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
            χ² is smallest at τ = {bestTau.toFixed(2)} s and has risen by 1 at {interval.low.toFixed(2)} and{' '}
            {interval.high.toFixed(2)} s: τ = {formatMeasurement({ value: bestTau, uncertainty: (interval.high - interval.low) / 2 })} s.
            {marks ? (
              <> Your marks (red) bracket {marks[0].toFixed(2)} to {marks[1].toFixed(2)} s. The red dot follows your τ slider.</>
            ) : (
              <> The red dot follows your τ slider.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
