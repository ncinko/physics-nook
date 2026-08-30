import { Readout } from '../../shared/Readout';
import { fixed } from '../../../utils/format';
import {
  QUANTITY_UNITS,
  kinematicsFromLinear,
  kinematicsFromQuadratic,
  type QuantityKey,
} from '../../../lib/kinematics/videoAnalysis';
import {
  agreesWithin,
  discrepancy,
  formatMeasurement,
  type Measurement,
} from '../../../lib/measurement/uncertainty';
import type { FitResult } from '../../../lib/math/leastSquares';

/**
 * Reads a fit back as physics rather than as three anonymous coefficients. The
 * payoff line is the acceleration: for a quadratic position fit it is twice the
 * leading coefficient, and comparing it to -9.81 m/s^2 with the fit's own
 * uncertainty is the whole point of dropping a ball in front of a camera.
 */

interface FitPanelProps {
  result: FitResult | null;
  model: 'none' | 'linear' | 'quadratic';
  xQuantity: QuantityKey;
  yQuantity: QuantityKey;
  seriesLabel: string;
}

const GRAVITY = -9.81;

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
        Choose a model to fit the plotted data. A quadratic on position against time reads out the
        acceleration directly.
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
      <Readout.Value label="R²" value={fixed(fit.rSquared, 4)} />
      <Readout.Value
        label="χ² per d.o.f."
        value={Number.isFinite(fit.reducedChiSquare) ? fixed(fit.reducedChiSquare, 2) : '—'}
      />
      <Readout.Value label="points fitted" value={String(fit.pointCount)} />
    </>
  );

  if (model === 'linear') {
    const { slope, intercept } = kinematicsFromLinear(fit);
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
          <Readout.Group label="Goodness of fit">{goodness}</Readout.Group>
        </Readout>
        <FitNotes fit={fit} />
      </div>
    );
  }

  const motion = kinematicsFromQuadratic(fit);
  const readsAsMotion = xQuantity === 'time' && (yQuantity === 'x' || yQuantity === 'y');
  const sigmaFromGravity = discrepancy(motion.acceleration, GRAVITY);
  const agrees = agreesWithin(motion.acceleration, GRAVITY);

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

      {readsAsMotion && motion.acceleration.uncertainty > 0 && (
        <p
          className="m-0 text-sm font-medium"
          style={{ color: agrees ? 'var(--accent-green)' : 'var(--accent-red)' }}
        >
          {agrees
            ? `Agrees with free fall (−9.81 m/s²) — ${fixed(sigmaFromGravity, 1)} of its own uncertainty away.`
            : `Differs from free fall (−9.81 m/s²) by ${
                Number.isFinite(sigmaFromGravity) ? fixed(sigmaFromGravity, 1) : '∞'
              }× its own uncertainty.`}
        </p>
      )}
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
