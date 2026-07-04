import assert from 'node:assert/strict';
import {
  angularAccel,
  angularCollision,
  angularKinematics,
  angularMomentum,
  centrifugalAccel,
  compositeMomentOfInertia,
  conservedOmega,
  coriolisAccel,
  cycloidPoint,
  cycloidVelocity,
  diskMomentOfInertia,
  inertiaCoefficient,
  physicalPendulumOmega,
  pointMomentOfInertia,
  polarAcceleration,
  rollingAcceleration,
  rollingEnergyBreakdown,
  rollingRaceState,
  rotationalKineticEnergy,
  rpmToRadPerSec,
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

// rpm conversion (angular-kinematics worked example: 300 rpm hard drive).
near(rpmToRadPerSec(300), 10 * Math.PI);
near(rpmToRadPerSec(60), 2 * Math.PI);

// Constant-α kinematics (angular-kinematics worked example: rest, α = 2 rad/s², t = 10 s).
const spinUp = angularKinematics(0, 0, 2, 10);
near(spinUp.theta, 100); // ≈ 15.9 revolutions
near(spinUp.omega, 20);
// Nonzero initial conditions.
const spinning = angularKinematics(1, 3, -0.5, 4);
near(spinning.theta, 1 + 12 - 4);
near(spinning.omega, 1);

// Cycloid: the contact point of a rolling wheel is momentarily at rest.
const contact = cycloidVelocity(0.5, 0.5, 0, 2);
near(contact.x, 0);
near(contact.y, 0);
// Top of the wheel moves at 2Rω.
const top = cycloidVelocity(0.5, 0.5, Math.PI, 2);
near(Math.hypot(top.x, top.y), 2 * 0.5 * 2);
// The wheel center (pointRadius = 0) always moves at v = Rω.
const center = cycloidVelocity(0.5, 0, 1.234, 2);
near(center.x, 0.5 * 2);
near(center.y, 0);
// Position: after a full turn the rim point returns to the ground, 2πR ahead.
const afterTurn = cycloidPoint(0.5, 0.5, 2 * Math.PI);
near(afterTurn.x, 2 * Math.PI * 0.5);
near(afterTurn.y, 0);

// Composite inertia matches Σ m r² and the single-point helper.
near(compositeMomentOfInertia([{ mass: 3, radius: 2 }]), pointMomentOfInertia(3, 2));
near(
  compositeMomentOfInertia([
    { mass: 1, radius: 0.5 },
    { mass: 1, radius: 1.5 },
  ]),
  0.25 + 2.25,
);
near(compositeMomentOfInertia([]), 0);

// Shape coefficients c in I = c m r².
near(inertiaCoefficient('hoop'), 1);
near(inertiaCoefficient('disk'), 0.5);
near(inertiaCoefficient('solidSphere'), 0.4);
near(inertiaCoefficient('hollowSphere'), 2 / 3);

// Rolling down an incline (rolling-and-energy worked example: solid sphere, 30°).
near(rollingAcceleration(9.8, Math.PI / 6, 0.4), 4.9 / 1.4); // 3.5 m/s²
// The race ordering: smaller c wins, independent of mass and radius.
const order = (['solidSphere', 'disk', 'hollowSphere', 'hoop'] as const).map((s) =>
  rollingAcceleration(9.8, Math.PI / 6, inertiaCoefficient(s)),
);
assert.ok(order[0] > order[1] && order[1] > order[2] && order[2] > order[3]);
// Falling unrolling cylinder (θ = 90°, c = ½): a = 2g/3.
near(rollingAcceleration(9.8, Math.PI / 2, 0.5), (2 * 9.8) / 3);

// Closed-form race state: d = ½at², v = at.
const race = rollingRaceState(9.8, Math.PI / 6, 0.4, 2);
near(race.distance, 0.5 * 3.5 * 4);
near(race.speed, 7);

// Energy split: total is ½(1+c)mv²; a hoop splits 50/50.
const hoopSplit = rollingEnergyBreakdown(2, 3, 1);
near(hoopSplit.translational, hoopSplit.rotational);
near(hoopSplit.total, 0.5 * (1 + 1) * 2 * 9);
const sphereSplit = rollingEnergyBreakdown(2, 3, 0.4);
near(sphereSplit.rotational, 0.4 * sphereSplit.translational);
near(sphereSplit.total, sphereSplit.translational + sphereSplit.rotational);

// Skater spin (angular-momentum worked example): halving I doubles ω and doubles K_rot.
near(conservedOmega(4, 3, 2), 6);
near(angularMomentum(2, conservedOmega(4, 3, 2)), angularMomentum(4, 3));
assert.ok(
  rotationalKineticEnergy(2, conservedOmega(4, 3, 2)) > rotationalKineticEnergy(4, 3),
);
near(rotationalKineticEnergy(2, 6), 2 * rotationalKineticEnergy(4, 3));

// Disk-drop collision: L conserved exactly, kinetic energy lost.
const drop = angularCollision(0.5, 8, 0.5, 0);
near(drop.omegaFinal, 4); // identical disk halves ω
near(drop.angularMomentum, angularMomentum(0.5, 8));
near(drop.angularMomentum, angularMomentum(1.0, drop.omegaFinal));
near(drop.keFinal, drop.keInitial / 2); // and halves the kinetic energy
// No energy is lost when the bodies already co-rotate.
const gentle = angularCollision(0.5, 4, 0.25, 4);
near(gentle.omegaFinal, 4);
near(gentle.keFinal, gentle.keInitial);

console.log('rotation tests passed');
