import assert from 'node:assert/strict';
import {
  angularAccel,
  angularMomentum,
  centrifugalAccel,
  coriolisAccel,
  diskMomentOfInertia,
  physicalPendulumOmega,
  pointMomentOfInertia,
  polarAcceleration,
  rotationalKineticEnergy,
  torqueFromForce,
  uniformCircularMotion,
} from '../../src/lib/rotation/index.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

// Newton's second law for rotation and disk inertia (from the worked examples).
near(diskMomentOfInertia(4, 0.5), 0.5);
near(angularAccel(2, diskMomentOfInertia(4, 0.5)), 4);
near(pointMomentOfInertia(3, 2), 12);

// Torque from a tangential force (θ = 90°) and rotational quantities.
near(torqueFromForce(0.3, 10, Math.PI / 2), 3);
near(rotationalKineticEnergy(0.5, 4), 4);
near(angularMomentum(2, 4), 8);

// Physical pendulum angular frequency.
near(physicalPendulumOmega(1, 9.8, 0.5, 0.25), Math.sqrt((1 * 9.8 * 0.5) / 0.25));

// Polar acceleration: uniform circular motion is purely centripetal.
const circular = polarAcceleration({ r: 2, rDot: 0, rDDot: 0, thetaDot: 3, thetaDDot: 0 });
near(circular.aRadial, -2 * 3 * 3); // -r ω²
near(circular.aTransverse, 0);

// The transverse Coriolis term 2 ṙ θ̇ appears only when the radius is changing.
const movingOut = polarAcceleration({ r: 1, rDot: 0.5, rDDot: 0, thetaDot: 2, thetaDDot: 0 });
near(movingOut.aTransverse, 2 * 0.5 * 2);

// Rotating-frame apparent accelerations.
assert.deepEqual(centrifugalAccel(3, 2, 0), { x: 18, y: 0 }); // Ω² r outward
const cor = coriolisAccel(2, 1, 0); // velocity along +x
near(cor.x, 0);
near(cor.y, -4); // -2 Ω vx
const corZero = coriolisAccel(5, 0, 0); // no velocity → no Coriolis
near(corZero.x, 0);
near(corZero.y, 0);

// Uniform circular motion: velocity is tangent and acceleration points inward.
const uniform = uniformCircularMotion(2, 3, 0);
near(uniform.position.x, 2);
near(uniform.position.y, 0);
near(uniform.velocity.x, 0);
near(uniform.velocity.y, 6);
near(uniform.acceleration.x, -18);
near(uniform.acceleration.y, 0);
near(uniform.speed, 6); // v = r omega
near(uniform.centripetalAcceleration, 18); // a_c = r omega^2 = v^2 / r
near(uniform.centripetalAcceleration, (uniform.speed * uniform.speed) / 2);
near(
  uniform.position.x * uniform.velocity.x + uniform.position.y * uniform.velocity.y,
  0,
); // position and velocity are perpendicular
assert.ok(
  uniform.position.x * uniform.acceleration.x + uniform.position.y * uniform.acceleration.y < 0,
); // acceleration is antiparallel to position

// Reversing the rotation reverses velocity but leaves centripetal acceleration unchanged.
const reversed = uniformCircularMotion(2, -3, 0);
near(reversed.velocity.x, -uniform.velocity.x);
near(reversed.velocity.y, -uniform.velocity.y);
near(reversed.acceleration.x, uniform.acceleration.x);
near(reversed.acceleration.y, uniform.acceleration.y);
near(reversed.centripetalAcceleration, uniform.centripetalAcceleration);

console.log('rotation tests passed');
