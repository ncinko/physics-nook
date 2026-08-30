import { Readout } from '../../shared/Readout';
import { fixed } from '../../../utils/format';
import {
  QUANTITY_UNITS,
  kinematicsFromLinear,
  kinematicsFromQuadratic,
  type QuantityKey,
} from '../../../lib/kinematics/videoAnalysis';
import { formatMeasurement, type Measurement } from '../../../lib/measurement/uncertainty';
import type { FitResult } from '../../../lib/math/leastSquares';

/**
 * Reads a fit back as physics rather than as anonymous coefficients: a line
 * through a velocity-time graph has an acceleration for a slope, and a parabola
 * through a position-time graph has half of one for its leading coefficient.
 *
 * What the reading is *compared* to is left to the student. Naming an expected
 * answer here would turn a measurement into a box to tick.
 */

interface FitPanelProps {
  result: FitResult | null;
  model: 'none' | 'linear' | 'quadratic';
  xQuantity: QuantityKey;
  yQuantity: QuantityKey;
  seriesLabel: string;
}

/**
 * `formatMeasurement` rounds the uncertainty to one significant figure and then
 * matches the value to it — which collapses to a useless "3 ± 0" when the
 * uncertainty is zero. That happens for real here: a quadratic through exactly
 * three points has no residual at all.
 */
const showMeasurement = (measurement: Measurement): string =>
  measurement.uncertainty > 0 && Number.isFinite(measurement.uncertainty)
    ? formatMeasurement(measurement)
    : `${fixed(measurement.value, 3)} ± —`;

const unitFor = (quantity: QuantityKey) => QUANTITY_UNITS[quantity];

const slopeUnit = (yQuantity: QuantityKey, xQuantity: QuantityKey) =>
  `${unitFor(yQuantity)}/${unitFor(xQuantity)}`;

export function FitPanel({ result, model, xQuantity, yQuantity, seriesLabel }: FitPanelProps) {
  if (model === 'none' || !result) {
    return (
      <p className="m-0 text-sm text-[var(--text-muted)]">
        Choose a model to fit the plotted data. A linear fit on velocity versus time is useful for estimating acceleration.
      </p>
    );
  }

  if (!result.ok) {
    return (
      <p className="m-0 text-sm text-[var(--accent-red)]">
        {result.reason === 'too-few-points'
          ? `Not enough points in range — a ${model} fit needs at least ${model === 'linear' ? 2 : 3}.`
          : 'These points do not pin down a fit: they share too few distinct horizontal values.'}
      </p>
    );
  }

  const { fit } = result;
  const goodness = (
    <>
      <Readout.Value
        label="χ² per d.o.f."
        value={Number.isFinite(fit.reducedChiSquare) ? fixed(fit.reducedChiSquare, 2) : '—'}
      />
      <Readout.Value label="points fitted" value={String(fit.pointCount)} />
    </>
  );

  if (model === 'linear') {
    const { slope, intercept } = kinematicsFromLinear(fit);
    // A line through a velocity-time graph has an acceleration for a slope —
    // the other honest route to `a`, alongside a parabola through positions.
    const readsAsAcceleration =
      xQuantity === 'time' && (yQuantity === 'vx' || yQuantity === 'vy');
    return (
      <div className="flex flex-col gap-2">
        <Readout>
          <Readout.Group label={`Line through ${seriesLabel}`}>
            <Readout.Value
              label="slope"
              value={showMeasurement(slope)}
              unit={slopeUnit(yQuantity, xQuantity)}
            />
            <Readout.Value
              label="intercept"
              value={showMeasurement(intercept)}
              unit={unitFor(yQuantity)}
            />
          </Readout.Group>
          {readsAsAcceleration && (
            <Readout.Group label="Read as motion">
              <Readout.Value label="a = slope" value={showMeasurement(slope)} unit="m/s²" />
              <Readout.Value label="v₀" value={showMeasurement(intercept)} unit="m/s" />
            </Readout.Group>
          )}
          <Readout.Group label="Goodness of fit">{goodness}</Readout.Group>
        </Readout>
        <FitNotes fit={fit} />
      </div>
    );
  }

  const motion = kinematicsFromQuadratic(fit);
  const readsAsMotion = xQuantity === 'time' && (yQuantity === 'x' || yQuantity === 'y');

  return (
    <div className="flex flex-col gap-2">
      <Readout>
        <Readout.Group label={`Parabola through ${seriesLabel}`}>
          <Readout.Value
            label="A (t² term)"
            value={showMeasurement({
              value: fit.coefficients[2],
              uncertainty: fit.uncertainties[2],
            })}
          />
          <Readout.Value
            label="B (t term)"
            value={showMeasurement({
              value: fit.coefficients[1],
              uncertainty: fit.uncertainties[1],
            })}
          />
          <Readout.Value
            label="C (constant)"
            value={showMeasurement({
              value: fit.coefficients[0],
              uncertainty: fit.uncertainties[0],
            })}
          />
        </Readout.Group>
        {readsAsMotion && (
          <Readout.Group label="Read as motion">
            <Readout.Value
              label="a = 2A"
              value={showMeasurement(motion.acceleration)}
              unit="m/s²"
            />
            <Readout.Value label="v₀" value={showMeasurement(motion.initialVelocity)} unit="m/s" />
            <Readout.Value label="s₀" value={showMeasurement(motion.initialPosition)} unit="m" />
          </Readout.Group>
        )}
        <Readout.Group label="Goodness of fit">{goodness}</Readout.Group>
      </Readout>

      <FitNotes fit={fit} />
    </div>
  );
}

function FitNotes({ fit }: { fit: Extract<FitResult, { ok: true }>['fit'] }) {
  return (
    <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
      {fit.weighted
        ? 'The uncertainty slider sets the weights. With the same bar on every point it changes the reported ± but not the best-fit line itself — try it.'
        : 'No usable uncertainties, so every point counts equally and the ± values come from the scatter of the data.'}
      {Number.isFinite(fit.reducedChiSquare) && fit.reducedChiSquare > 4
        ? ' χ² per degree of freedom is well above 1: either the error bars are too small or this is the wrong model.'
        : null}
      {Number.isFinite(fit.reducedChiSquare) && fit.reducedChiSquare < 0.25
        ? ' χ² per degree of freedom is well below 1, which usually means the error bars are generous.'
        : null}
    </p>
  );
}

export default FitPanel;
