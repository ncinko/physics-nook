import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyParkOp,
  buildPreviewSegment,
  createInitialPark,
  createSegmentFromTemplate,
  getDefaultVariant,
  makeId,
} from '../../src/lib/coaster/track.ts';
import { createRunState, getEnergyTotal, simulateRun, simulateStep } from '../../src/lib/coaster/physics.ts';

const append = (park, templateId, variant = getDefaultVariant(templateId)) => {
  const coaster = park.coasters[0];
  const preview = buildPreviewSegment(park, coaster.id, templateId, variant);
  assert.equal(preview.valid, true, preview.reason);
  return applyParkOp(park, {
    type: 'appendPiece',
    clientId: 'test',
    clientOpId: makeId('op'),
    baseVersion: park.version,
    createdAt: Date.now(),
    coasterId: coaster.id,
    segment: createSegmentFromTemplate(templateId, preview.segment.connector, variant, makeId('seg')),
  });
};

test('zero-friction run approximately conserves mechanical energy', () => {
  let park = createInitialPark();
  park = append(park, 'lift');
  park = append(park, 'drop');
  park = append(park, 'straight');
  const coaster = park.coasters[0];
  let state = createRunState(coaster, 7);
  const initialEnergy = getEnergyTotal(state);

  for (let index = 0; index < 240 && !state.complete && !state.stalled; index += 1) {
    state = simulateStep(coaster, state, 1 / 60, {
      gravity: 9.81,
      rollingFriction: 0,
      dragCoefficient: 0,
    });
  }

  assert.ok(Math.abs(getEnergyTotal(state) - initialEnergy) < 120);
});

test('friction converts mechanical energy into thermal energy', () => {
  let park = createInitialPark();
  park = append(park, 'lift');
  park = append(park, 'drop');
  park = append(park, 'straight');
  const final = simulateRun(park.coasters[0], {
    initialSpeed: 8,
    maxTime: 8,
    config: {
      gravity: 9.81,
      rollingFriction: 0.04,
      dragCoefficient: 0.8,
    },
  });

  assert.ok(final.thermalEnergy > 0);
  assert.ok(final.metrics.maxSpeed > 0);
});

test('insufficient speed on an uphill section is marked as a stall', () => {
  let park = createInitialPark();
  park = append(park, 'slope');
  park = append(park, 'slope');
  const final = simulateRun(park.coasters[0], {
    initialSpeed: 0.6,
    maxTime: 35,
    config: {
      gravity: 9.81,
      rollingFriction: 0,
      dragCoefficient: 0,
    },
  });

  assert.equal(final.stalled, true);
  assert.ok(final.metrics.stalledSections.length > 0);
});
