import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyParkOp,
  buildPreviewSegment,
  createInitialPark,
  createSegmentFromTemplate,
  getCoasterSamples,
  getDefaultVariant,
  getOpenEndTransform,
  getTrackLength,
  makeId,
  TILE_SIZE,
} from '../../src/lib/coaster/track.ts';

const closeTo = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} was not close to ${expected}`);
};

test('appending preset pieces keeps connectors continuous', () => {
  let park = createInitialPark();
  const coaster = park.coasters[0];
  const preview = buildPreviewSegment(park, coaster.id, 'slope', getDefaultVariant('slope'));
  assert.equal(preview.valid, true);

  const segment = createSegmentFromTemplate('slope', preview.segment.connector, getDefaultVariant('slope'), makeId('seg'));
  park = applyParkOp(park, {
    type: 'appendPiece',
    clientId: 'test',
    clientOpId: 'op-1',
    baseVersion: park.version,
    createdAt: Date.now(),
    coasterId: coaster.id,
    segment,
  });

  const appended = park.coasters[0].segments.at(-1);
  assert.ok(appended);
  assert.deepEqual(appended?.samples[0].position, appended?.connector.position);
  assert.deepEqual(appended?.endTransform.position, getOpenEndTransform(park.coasters[0]).position);
});

test('loop pieces produce sampled geometry and return to a level connector', () => {
  const park = createInitialPark();
  const coaster = park.coasters[0];
  const preview = buildPreviewSegment(park, coaster.id, 'loop', getDefaultVariant('loop'));

  assert.equal(preview.valid, true);
  assert.equal(Math.round(preview.segment.endTransform.pitch * 1000), 0);
  assert.ok(preview.segment.samples.length > 40);
  assert.ok(preview.segment.length > 20);
});

test('undo removes only the latest non-station segment', () => {
  let park = createInitialPark();
  const coaster = park.coasters[0];
  const preview = buildPreviewSegment(park, coaster.id, 'straight', getDefaultVariant('straight'));
  park = applyParkOp(park, {
    type: 'appendPiece',
    clientId: 'test',
    clientOpId: 'op-1',
    baseVersion: park.version,
    createdAt: Date.now(),
    coasterId: coaster.id,
    segment: createSegmentFromTemplate('straight', preview.segment.connector, getDefaultVariant('straight'), makeId('seg')),
  });
  const lengthWithPiece = getTrackLength(park.coasters[0]);

  park = applyParkOp(park, {
    type: 'undoLastPiece',
    clientId: 'test',
    clientOpId: 'op-2',
    baseVersion: park.version,
    createdAt: Date.now(),
    coasterId: coaster.id,
  });

  assert.equal(park.coasters[0].segments.length, 1);
  assert.ok(lengthWithPiece > getTrackLength(park.coasters[0]));
  assert.ok(getCoasterSamples(park.coasters[0]).length > 4);
});

test('straight pieces span one centered grid square', () => {
  const park = createInitialPark();
  const coaster = park.coasters[0];
  const preview = buildPreviewSegment(park, coaster.id, 'straight', getDefaultVariant('straight'));

  assert.equal(preview.valid, true);
  closeTo(preview.segment.endTransform.position.x, preview.segment.connector.position.x);
  closeTo(preview.segment.endTransform.position.z - preview.segment.connector.position.z, TILE_SIZE);
  closeTo(preview.segment.connector.position.x % TILE_SIZE, TILE_SIZE / 2);
  closeTo(preview.segment.connector.position.z % TILE_SIZE, 0);
});

test('small turns occupy a three-square L footprint', () => {
  const park = createInitialPark();
  const coaster = park.coasters[0];
  const rightTurn = buildPreviewSegment(park, coaster.id, 'flat-turn', getDefaultVariant('flat-turn'));

  assert.equal(rightTurn.valid, true);
  closeTo(rightTurn.segment.endTransform.position.x - rightTurn.segment.connector.position.x, TILE_SIZE * 1.5);
  closeTo(rightTurn.segment.endTransform.position.z - rightTurn.segment.connector.position.z, TILE_SIZE * 1.5);
  closeTo(rightTurn.segment.endTransform.yaw, Math.PI / 2);
  closeTo(rightTurn.segment.endTransform.position.x % TILE_SIZE, 0);
  closeTo(rightTurn.segment.endTransform.position.z % TILE_SIZE, TILE_SIZE / 2);
});
