/**
 * One description of a fit, in a form both the on-screen panel and the saved
 * plot image can render.
 *
 * The panel and the image have to agree — an exported graph whose caption
 * disagrees with what the student was looking at is worse than no caption. So
 * the labels, the numbers, and the rounding all live here, once, as data;
 * `FitPanel` turns the same groups into readouts and `exportPlot` turns them
 * into lines of text under the graph.
 *
 * DOM-free and deterministic, so it can be unit tested in `tests/kinematics`.
 */

import {
  QUANTITY_UNITS,
  kinematicsFromLinear,
  kinematicsFromQuadratic,
  type QuantityKey,
} from './videoAnalysis.ts';
import { formatMeasurement, type Measurement } from '../measurement/uncertainty.ts';
import type { FitResult } from '../math/leastSquares.ts';
import { fixed } from '../../utils/format.ts';

export type FitModel = 'none' | 'linear' | 'quadratic';

export interface SummaryValue {
  label: string;
  value: string;
  unit?: string;
}

export interface SummaryGroup {
  label: string;
  values: SummaryValue[];
}

/**
 * `formatMeasurement` rounds the uncertainty to one significant figure and then
 * matches the value to it — which collapses to a useless "3 ± 0" when the
 * uncertainty is zero. That happens for real here: a quadratic through exactly
 * three points has no residual at all.
 */
export const showMeasurement = (measurement: Measurement): string =>
  measurement.uncertainty > 0 && Number.isFinite(measurement.uncertainty)
    ? formatMeasurement(measurement)
    : `${fixed(measurement.value, 3)} ± —`;

const unitFor = (quantity: QuantityKey) => QUANTITY_UNITS[quantity];

const slopeUnit = (yQuantity: QuantityKey, xQuantity: QuantityKey) =>
  `${unitFor(yQuantity)}/${unitFor(xQuantity)}`;

export interface FitSummaryInput {
  result: FitResult | null;
  model: FitModel;
  xQuantity: QuantityKey;
  yQuantity: QuantityKey;
  seriesLabel: string;
}

/**
 * Why a fit produced nothing to show, phrased for a student rather than for a
 * log. `null` means there is a fit and `fitSummaryGroups` will describe it.
 */
export const fitSummaryProblem = ({ result, model }: FitSummaryInput): string | null => {
  if (model === 'none' || !result) {
    return 'Choose a model to fit the plotted data. A linear fit on velocity versus time is useful for estimating acceleration.';
  }
  if (!result.ok) {
    return result.reason === 'too-few-points'
      ? `Not enough points in range — a ${model} fit needs at least ${model === 'linear' ? 2 : 3}.`
      : 'These points do not pin down a fit: they share too few distinct horizontal values.';
  }
  return null;
};

export const fitSummaryGroups = (input: FitSummaryInput): SummaryGroup[] => {
  const { result, model, xQuantity, yQuantity, seriesLabel } = input;
  if (!result?.ok || model === 'none') return [];
  const { fit } = result;

  const goodness: SummaryGroup = {
    label: 'Goodness of fit',
    values: [
      {
        label: 'χ² per d.o.f.',
        value: Number.isFinite(fit.reducedChiSquare) ? fixed(fit.reducedChiSquare, 2) : '—',
      },
      { label: 'points fitted', value: String(fit.pointCount) },
    ],
  };

  if (model === 'linear') {
    const { slope, intercept } = kinematicsFromLinear(fit);
    // A line through a velocity-time graph has an acceleration for a slope —
    // the other honest route to `a`, alongside a parabola through positions.
    const readsAsAcceleration =
      xQuantity === 'time' && (yQuantity === 'vx' || yQuantity === 'vy');
    return [
      {
        label: `Line through ${seriesLabel}`,
        values: [
          { label: 'slope', value: showMeasurement(slope), unit: slopeUnit(yQuantity, xQuantity) },
          { label: 'intercept', value: showMeasurement(intercept), unit: unitFor(yQuantity) },
        ],
      },
      ...(readsAsAcceleration
        ? [
            {
              label: 'Read as motion',
              values: [
                { label: 'a = slope', value: showMeasurement(slope), unit: 'm/s²' },
                { label: 'v₀', value: showMeasurement(intercept), unit: 'm/s' },
              ],
            },
          ]
        : []),
      goodness,
    ];
  }

  const motion = kinematicsFromQuadratic(fit);
  const readsAsMotion = xQuantity === 'time' && (yQuantity === 'x' || yQuantity === 'y');
  return [
    {
      label: `Parabola through ${seriesLabel}`,
      values: [
        {
          label: 'A (t² term)',
          value: showMeasurement({
            value: fit.coefficients[2],
            uncertainty: fit.uncertainties[2],
          }),
        },
        {
          label: 'B (t term)',
          value: showMeasurement({
            value: fit.coefficients[1],
            uncertainty: fit.uncertainties[1],
          }),
        },
        {
          label: 'C (constant)',
          value: showMeasurement({
            value: fit.coefficients[0],
            uncertainty: fit.uncertainties[0],
          }),
        },
      ],
    },
    ...(readsAsMotion
      ? [
          {
            label: 'Read as motion',
            values: [
              { label: 'a = 2A', value: showMeasurement(motion.acceleration), unit: 'm/s²' },
              { label: 'v₀', value: showMeasurement(motion.initialVelocity), unit: 'm/s' },
              { label: 's₀', value: showMeasurement(motion.initialPosition), unit: 'm' },
            ],
          },
        ]
      : []),
    goodness,
  ];
};

/** The caveat printed under the numbers, or `null` when there is nothing to add. */
export const fitSummaryNote = (result: FitResult | null): string | null => {
  if (!result?.ok) return null;
  const { fit } = result;
  const weighting = fit.weighted
    ? 'The uncertainty slider sets the weights. With the same bar on every point it changes the reported ± but not the best-fit line itself — try it.'
    : 'No usable uncertainties, so every point counts equally and the ± values come from the scatter of the data.';
  const chi = Number.isFinite(fit.reducedChiSquare)
    ? fit.reducedChiSquare > 4
      ? ' χ² per degree of freedom is well above 1: either the error bars are too small or this is the wrong model.'
      : fit.reducedChiSquare < 0.25
        ? ' χ² per degree of freedom is well below 1, which usually means the error bars are generous.'
        : ''
    : '';
  return `${weighting}${chi}`;
};

/** `label = value unit`, the form both the panel and the caption read as. */
export const formatSummaryValue = (value: SummaryValue) =>
  `${value.label} = ${value.value}${value.unit ? ` ${value.unit}` : ''}`;

/** One line per group, for a caption that has no room for a table. */
export const fitSummaryLines = (groups: SummaryGroup[]): string[] =>
  groups.map((group) => `${group.label} — ${group.values.map(formatSummaryValue).join(' · ')}`);

/** What the saved image says about the clip the graph came from. */
export interface PlotExportMeta {
  clipName: string | null;
  xLabel: string;
  yLabel: string;
  seriesLabels: string[];
  pointCount: number;
  fps: number;
  metersPerPixel: number | null;
  fitRange: { min: number; max: number } | null;
  /** True only when the student has narrowed the fit to part of the data. */
  fitRangeIsSubset: boolean;
}

/**
 * The lines printed under a saved graph.
 *
 * A plot saved out of the lab has to survive being pasted into a lab report
 * with nothing around it, so it carries its own provenance: which clip, how
 * many points, what scale and frame rate produced the numbers, and what the fit
 * said. Without the scale and the frame rate the axes are unfalsifiable.
 *
 * It stops at the numbers. `fitSummaryNote` coaches the student about weighting
 * and what a reduced chi-square is telling them, which belongs beside the
 * controls they can still touch — not printed under a figure in someone's
 * report. The chi-square value itself stays, in the goodness-of-fit line.
 */
export const buildCaptionLines = (meta: PlotExportMeta, fit: FitSummaryInput): string[] => {
  const lines: string[] = [];
  const facts = [
    `${meta.pointCount} point${meta.pointCount === 1 ? '' : 's'}`,
    `${meta.fps.toFixed(2)} fps`,
    meta.metersPerPixel !== null ? `${meta.metersPerPixel.toPrecision(3)} m/px` : null,
  ].filter((entry): entry is string => entry !== null);
  lines.push(`${meta.yLabel} against ${meta.xLabel} · ${facts.join(' · ')}`);
  if (meta.seriesLabels.length > 0) lines.push(`Series: ${meta.seriesLabels.join(', ')}`);

  const problem = fitSummaryProblem(fit);
  if (problem) {
    lines.push(fit.model === 'none' ? 'No fit applied.' : problem);
    return lines;
  }

  if (meta.fitRangeIsSubset && meta.fitRange) {
    lines.push(
      `Fitted over ${meta.xLabel} from ${meta.fitRange.min.toPrecision(4)} to ${meta.fitRange.max.toPrecision(4)}`,
    );
  }
  lines.push(...fitSummaryLines(fitSummaryGroups(fit)));
  return lines;
};
