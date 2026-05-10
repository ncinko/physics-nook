import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RIPPLE_CONFIG,
  createDefaultRippleObject,
  createDefaultRippleEmitters,
  normalizeRippleRoomCode,
  sanitizeRippleEmitterPatch,
  sanitizeRippleName,
  sanitizeRippleObjectPatch,
  sanitizeRippleSplash,
} from '../../packages/shared/src/ripple.ts';

test('default ripple emitters match the planned home-page source layout', () => {
  const emitters = createDefaultRippleEmitters(123);

  assert.equal(emitters.length, 3);
  assert.deepEqual(
    emitters.map((emitter) => emitter.id),
    ['cool-left', 'cool-center', 'warm-right'],
  );
  assert.equal(emitters[0].color, '#60a5fa');
  assert.equal(emitters[1].color, '#22d3ee');
  assert.equal(emitters[2].color, '#f87171');
  assert.ok(emitters.every((emitter) => emitter.x > 0.33 && emitter.x < 0.67));
  assert.equal(emitters[2].phase, Math.PI);
  assert.ok(emitters.every((emitter) => emitter.enabled && emitter.controlledBy === null && emitter.updatedAt === 123));
});

test('ripple splash payloads reject non-finite coordinates and clamp safe ranges', () => {
  assert.equal(sanitizeRippleSplash({ x: Number.NaN, y: 0.4 }), null);

  const sanitized = sanitizeRippleSplash({
    x: -2,
    y: 4,
    strength: RIPPLE_CONFIG.splash.maxStrength * 5,
    radius: RIPPLE_CONFIG.splash.maxRadius * 5,
  });

  assert.deepEqual(sanitized, {
    x: 0,
    y: 1,
    strength: RIPPLE_CONFIG.splash.maxStrength,
    radius: RIPPLE_CONFIG.splash.maxRadius,
  });
});

test('ripple splash payloads fill optional strength and radius defaults', () => {
  assert.deepEqual(sanitizeRippleSplash({ x: 0.25, y: 0.75 }), {
    x: 0.25,
    y: 0.75,
    strength: RIPPLE_CONFIG.splash.defaultStrength,
    radius: RIPPLE_CONFIG.splash.defaultRadius,
  });
});

test('ripple emitter patches sanitize individual controls', () => {
  assert.equal(sanitizeRippleEmitterPatch({ x: 0.2, frequency: Number.POSITIVE_INFINITY }), null);
  assert.equal(sanitizeRippleEmitterPatch({ enabled: 'yes' }), null);
  assert.equal(sanitizeRippleEmitterPatch({ color: 'url(javascript:alert(1))' }), null);
  assert.equal(sanitizeRippleEmitterPatch({}), null);

  assert.deepEqual(
    sanitizeRippleEmitterPatch({
      x: 2,
      y: -1,
      amplitude: RIPPLE_CONFIG.emitter.maxAmplitude * 2,
      frequency: 0,
      phase: Math.PI * 10,
      radius: 1,
      color: '#abcdef',
      enabled: false,
    }),
    {
      x: 1,
      y: 0,
      amplitude: RIPPLE_CONFIG.emitter.maxAmplitude,
      frequency: RIPPLE_CONFIG.emitter.minFrequency,
      phase: Math.PI * 2,
      radius: RIPPLE_CONFIG.emitter.maxRadius,
      color: '#abcdef',
      enabled: false,
    },
  );
});

test('ripple objects sanitize geometry and create default shapes', () => {
  assert.equal(sanitizeRippleObjectPatch({ x: Number.NaN }), null);
  assert.equal(sanitizeRippleObjectPatch({}), null);

  assert.deepEqual(sanitizeRippleObjectPatch({ x: -1, y: 2, width: 2, height: 0, rotation: Math.PI * 4, gap: 1 }), {
    x: 0,
    y: 1,
    width: RIPPLE_CONFIG.object.maxSize,
    height: RIPPLE_CONFIG.object.minSize,
    rotation: Math.PI * 2,
    gap: RIPPLE_CONFIG.object.maxGap,
  });

  const slit = createDefaultRippleObject('object-1', 'single-slit', { x: 0.5, y: 0.5 }, 321);
  assert.equal(slit.kind, 'single-slit');
  assert.equal(slit.controlledBy, null);
  assert.equal(slit.updatedAt, 321);
  assert.ok(slit.width <= 0.014);
  assert.ok(slit.gap > 0);

  const doubleSlit = createDefaultRippleObject('object-2', 'double-slit', { x: 0.48, y: 0.52 }, 321);
  assert.equal(doubleSlit.kind, 'double-slit');
  assert.ok(doubleSlit.width <= 0.014);
  assert.ok(doubleSlit.gap < slit.gap);
  assert.ok(doubleSlit.spacing >= RIPPLE_CONFIG.object.minSpacing);
  assert.deepEqual(sanitizeRippleObjectPatch({ gap: 0 }), { gap: RIPPLE_CONFIG.object.minGap });
  assert.deepEqual(sanitizeRippleObjectPatch({ spacing: -1 }), { spacing: RIPPLE_CONFIG.object.minSpacing });
});

test('ripple names and room codes normalize for shared room routing', () => {
  assert.equal(normalizeRippleRoomCode('tank 42!'), 'TANK42');
  assert.equal(normalizeRippleRoomCode(''), RIPPLE_CONFIG.defaultRoomCode);
  assert.equal(sanitizeRippleName('<Ada  Lovelace!!>'), 'Ada Lovelace');
  assert.equal(sanitizeRippleName(''), 'Explorer');
});
