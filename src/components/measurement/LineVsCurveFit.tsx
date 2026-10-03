import { useState } from 'react';
import { ControlBar, Select, Toggle } from '../shared/InlineControls';
import { FitPlot } from './FitPlot';
import { predictPolynomial } from '../../lib/math/leastSquares';
import { formatMeasurement } from '../../lib/measurement/uncertainty';
import {
  RC_DEFAULT_SEED,
  RC_SIGMA,
  chargingVoltage,
  fitRc,
  fitRcLine,
  generateRcData,
} from '../../lib/measurement/rcFit';

// The same twenty voltmeter readings fitted two ways. The straight line is the
// right tool for a lot of lab data and the wrong one for this; the residual strip
// is how you can tell without being told.

type ModelKind = 'line' | 'exp';

const DATA = generateRcData(RC_DEFAULT_SEED);
const LINE = fitRcLine(DATA);
const EXPONENTIAL = fitRc(DATA);

// Both models' residuals are drawn on the line's scale by default, so the arch
// in the line's residuals and the tiny scatter of the exponential's are visible
// at the same time. "Zoom" then rescales to the noise.
const LINE_EXTENT = LINE
  ? Math.ceil(Math.max(...LINE.residuals.map((value) => Math.abs(value))) * 10) / 10
  : 0.5;
const ZOOM_EXTENT = 0.15;

export function LineVsCurveFit() {
  const [model, setModel] = useState<ModelKind>('line');
  const [zoom, setZoom] = useState(false);

  if (!LINE || !EXPONENTIAL.ok) return null;
  const exp = EXPONENTIAL.fit;

  const [v0, tau] = exp.parameters;
  const curve =
    model === 'line'
      ? (t: number) => predictPolynomial(LINE.coefficients, t)
      : (t: number) => chargingVoltage(t, v0, tau);
  const residuals = model === 'line' ? LINE.residuals : exp.residuals;

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[680px] flex-col gap-3 text-[var(--text-primary)]">
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--grid-line)] bg-[var(--surface-plot)]">
        <FitPlot
          points={DATA}
          curves={[{ fn: curve, color: model === 'line' ? 'var(--accent-purple)' : 'var(--accent-red)' }]}
          residuals={residuals}
          residualExtent={zoom ? ZOOM_EXTENT : LINE_EXTENT}
          residualBand={RC_SIGMA}
          residualColor={model === 'line' ? 'var(--accent-purple)' : 'var(--accent-red)'}
          xRange={[0, 10.5]}
          yRange={[0, 5.5]}
          xTicks={[0, 2, 4, 6, 8, 10]}
          yTicks={[0, 1, 2, 3, 4, 5]}
          xLabel="time t (s)"
          yLabel="capacitor voltage V (V)"
          summary={
            model === 'line'
              ? 'Capacitor voltage versus time with a straight-line fit; the residuals form a clear arch.'
              : 'Capacitor voltage versus time with an exponential fit; the residuals scatter randomly about zero.'
          }
        />
      </div>

      <ControlBar>
        <Select
          label="fit model"
          value={model}
          onChange={(value) => setModel(value as ModelKind)}
          options={[
            { value: 'line', label: 'Straight line: V = a + bt' },
            { value: 'exp', label: 'Exponential: V = V₀(1 − e^(−t/τ))' },
          ]}
        />
        <Toggle label="Zoom residuals to the noise" checked={zoom} onChange={setZoom} />
      </ControlBar>

      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        {model === 'line' ? (
          <>
            a = {formatMeasurement({ value: LINE.coefficients[0], uncertainty: LINE.uncertainties[0] })} V,
            {' '}b = {formatMeasurement({ value: LINE.coefficients[1], uncertainty: LINE.uncertainties[1] })} V/s.
            The fit reports tidy uncertainties, but the residuals arch above and below zero: the line is
            the wrong shape, no matter how precisely it is pinned down.
          </>
        ) : (
          <>
            V₀ = {formatMeasurement({ value: v0, uncertainty: exp.uncertainties[0] })} V,
            {' '}τ = {formatMeasurement({ value: tau, uncertainty: exp.uncertainties[1] })} s.
            The residuals now scatter about zero, mostly inside the shaded ±{RC_SIGMA} V band that marks the
            voltmeter's own uncertainty.
          </>
        )}
      </p>
    </div>
  );
}
