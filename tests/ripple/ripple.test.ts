import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RIPPLE_CONFIG,
  createDefaultRippleEmitters,
  normalizeRippleRoomCode,
  sanitizeRippleEmitterPatch,
  sanitizeRippleName,
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

test('ripple names and room codes normalize for shared room routing', () => {
  assert.equal(normalizeRippleRoomCode('studio 42!'), 'STUDIO42');
  assert.equal(normalizeRippleRoomCode(''), RIPPLE_CONFIG.defaultRoomCode);
  assert.equal(sanitizeRippleName('<Ada  Lovelace!!>'), 'Ada Lovelace');
  assert.equal(sanitizeRippleName(''), 'Explorer');
});
