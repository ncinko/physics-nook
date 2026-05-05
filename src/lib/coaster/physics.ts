import type { Coaster, TrackSample, Vec3 } from './types.ts';
import {
  add,
  clamp,
  dot,
  getCoasterSamples,
  getTrackLength,
  getTrackPointAtS,
  mul,
  normalize,
  sub,
} from './track.ts';

const GRAVITY = 9.81;

export interface PhysicsConfig {
  gravity: number;
  rollingFriction: number;
  dragCoefficient: number;
}

export interface RunMetrics {
  maxSpeed: number;
  maxHeight: number;
  maxPositiveVerticalG: number;
  maxNegativeVerticalG: number;
  maxLateralG: number;
  airtime: number;
  stalledSections: string[];
  warnings: string[];
}

export interface TrainRunState {
  s: number;
  speed: number;
  time: number;
  thermalEnergy: number;
  liftEnergy: number;
  brakeEnergy: number;
  kineticEnergy: number;
  potentialEnergy: number;
  verticalG: number;
  lateralG: number;
  forwardG: number;
  complete: boolean;
  stalled: boolean;
  metrics: RunMetrics;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  gravity: GRAVITY,
  rollingFriction: 0.018,
  dragCoefficient: 0.42,
};

const unique = (values: string[]) => Array.from(new Set(values));

const rotateFrameByRoll = (sample: TrackSample) => {
  const cos = Math.cos(sample.roll);
  const sin = Math.sin(sample.roll);
  const carUp = normalize(add(mul(sample.normal, cos), mul(sample.binormal, sin)), sample.normal);
  const carRight = normalize(sub(mul(sample.binormal, cos), mul(sample.normal, sin)), sample.binormal);
  return { carUp, carRight };
};

const createEmptyMetrics = (height: number): RunMetrics => ({
  maxSpeed: 0,
  maxHeight: height,
  maxPositiveVerticalG: 0,
  maxNegativeVerticalG: 0,
  maxLateralG: 0,
  airtime: 0,
  stalledSections: [],
  warnings: [],
});

export const createRunState = (coaster: Coaster, initialSpeed = coaster.train.initialSpeed): TrainRunState => {
  const samples = getCoasterSamples(coaster);
  const start = samples[0];
  const mass = coaster.train.massKg;
  const kineticEnergy = 0.5 * mass * initialSpeed * initialSpeed;
  const potentialEnergy = mass * GRAVITY * start.position.y;

  return {
    s: 0,
    speed: initialSpeed,
    time: 0,
    thermalEnergy: 0,
    liftEnergy: 0,
    brakeEnergy: 0,
    kineticEnergy,
    potentialEnergy,
    verticalG: 1,
    lateralG: 0,
    forwardG: 0,
    complete: false,
    stalled: false,
    metrics: createEmptyMetrics(start.position.y),
  };
};

const getWarnings = (state: TrainRunState) => {
  const warnings: string[] = [];

  if (state.metrics.maxPositiveVerticalG > 5.2) {
    warnings.push('High positive vertical g-force');
  }

  if (state.metrics.maxNegativeVerticalG < -1.2) {
    warnings.push('High negative vertical g-force');
  }

  if (state.metrics.maxLateralG > 1.8) {
    warnings.push('High lateral g-force');
  }

  if (state.stalled) {
    warnings.push('Train stalled before the end of the track');
  }

  return unique(warnings);
};

const getCurrentSegmentLabel = (coaster: Coaster, segmentId: string) =>
  coaster.segments.find((segment) => segment.id === segmentId)?.label ?? segmentId;

const computeGForces = (
  sample: TrackSample,
  previousSample: TrackSample,
  previousSpeed: number,
  nextSpeed: number,
  dt: number,
  gravity: number,
) => {
  const tangentialAcceleration = dt > 0 ? (nextSpeed - previousSpeed) / dt : 0;
  const centripetalAcceleration = nextSpeed * nextSpeed * sample.curvature;
  const acceleration = add(
    mul(sample.tangent, tangentialAcceleration),
    mul(sample.curvatureNormal, centripetalAcceleration),
  );
  const properAcceleration = sub(acceleration, { x: 0, y: -gravity, z: 0 });
  const { carUp, carRight } = rotateFrameByRoll(sample);

  return {
    verticalG: dot(properAcceleration, carUp) / gravity,
    lateralG: dot(properAcceleration, carRight) / gravity,
    forwardG: dot(properAcceleration, sample.tangent) / gravity,
    acceleration,
    previousAcceleration: previousSample,
  };
};

export const simulateStep = (
  coaster: Coaster,
  state: TrainRunState,
  dt: number,
  config: PhysicsConfig = DEFAULT_PHYSICS,
): TrainRunState => {
  if (state.complete || state.stalled) {
    return state;
  }

  const safeDt = clamp(dt, 0.001, 0.05);
  const samples = getCoasterSamples(coaster);
  const trackLength = getTrackLength(coaster);
  const current = getTrackPointAtS(samples, state.s);
  const mass = coaster.train.massKg;
  const normalFactor = clamp(1 - Math.abs(current.slope), 0.2, 1);
  const rollingLoss =
    config.rollingFriction * mass * config.gravity * normalFactor * Math.max(state.speed, 0.2) * safeDt;
  const dragLoss = config.dragCoefficient * Math.pow(state.speed, 3) * safeDt;
  const predictedDistance = Math.max(state.speed, 0.7) * safeDt;
  const predictedS = clamp(state.s + predictedDistance, 0, trackLength);
  const predicted = getTrackPointAtS(samples, predictedS);
  const deltaHeight = predicted.position.y - current.position.y;
  let speedSq =
    state.speed * state.speed -
    2 * config.gravity * deltaHeight -
    (2 * (rollingLoss + dragLoss)) / mass;
  let liftEnergy = state.liftEnergy;
  let brakeEnergy = state.brakeEnergy;
  let brakeLoss = 0;
  let liftInput = 0;

  if (current.flags.lift && speedSq < coaster.train.chainSpeed * coaster.train.chainSpeed) {
    liftInput = 0.5 * mass * (coaster.train.chainSpeed * coaster.train.chainSpeed - Math.max(speedSq, 0));
    speedSq = coaster.train.chainSpeed * coaster.train.chainSpeed;
    liftEnergy += liftInput;
  }

  if (current.flags.brake && speedSq > coaster.train.brakeSpeed * coaster.train.brakeSpeed) {
    brakeLoss = 0.5 * mass * (speedSq - coaster.train.brakeSpeed * coaster.train.brakeSpeed);
    speedSq = coaster.train.brakeSpeed * coaster.train.brakeSpeed;
    brakeEnergy += brakeLoss;
  }

  if (speedSq <= 0.05 && predicted.position.y >= current.position.y) {
    const segmentLabel = getCurrentSegmentLabel(coaster, current.segmentId);
    const stalledState = {
      ...state,
      speed: 0,
      stalled: true,
      time: state.time + safeDt,
      metrics: {
        ...state.metrics,
        stalledSections: unique([...state.metrics.stalledSections, segmentLabel]),
      },
    };

    return {
      ...stalledState,
      metrics: {
        ...stalledState.metrics,
        warnings: getWarnings(stalledState),
      },
    };
  }

  const nextSpeed = Math.sqrt(Math.max(speedSq, 0));
  const averageSpeed = Math.max(0.1, (state.speed + nextSpeed) * 0.5);
  const nextS = clamp(state.s + averageSpeed * safeDt, 0, trackLength);
  const nextSample = getTrackPointAtS(samples, nextS);
  const kineticEnergy = 0.5 * mass * nextSpeed * nextSpeed;
  const potentialEnergy = mass * config.gravity * nextSample.position.y;
  const gForces = computeGForces(nextSample, current, state.speed, nextSpeed, safeDt, config.gravity);
  const thermalEnergy = state.thermalEnergy + rollingLoss + dragLoss + brakeLoss;
  const complete = nextS >= trackLength - 0.02;

  const nextState: TrainRunState = {
    ...state,
    s: nextS,
    speed: nextSpeed,
    time: state.time + safeDt,
    thermalEnergy,
    liftEnergy,
    brakeEnergy,
    kineticEnergy,
    potentialEnergy,
    verticalG: gForces.verticalG,
    lateralG: gForces.lateralG,
    forwardG: gForces.forwardG,
    complete,
    stalled: false,
    metrics: {
      ...state.metrics,
      maxSpeed: Math.max(state.metrics.maxSpeed, nextSpeed),
      maxHeight: Math.max(state.metrics.maxHeight, nextSample.position.y),
      maxPositiveVerticalG: Math.max(state.metrics.maxPositiveVerticalG, gForces.verticalG),
      maxNegativeVerticalG: Math.min(state.metrics.maxNegativeVerticalG, gForces.verticalG),
      maxLateralG: Math.max(state.metrics.maxLateralG, Math.abs(gForces.lateralG)),
      airtime: state.metrics.airtime + (gForces.verticalG < 0.15 ? safeDt : 0),
      stalledSections: state.metrics.stalledSections,
      warnings: state.metrics.warnings,
    },
  };

  return {
    ...nextState,
    metrics: {
      ...nextState.metrics,
      warnings: getWarnings(nextState),
    },
  };
};

export const simulateRun = (
  coaster: Coaster,
  options: { dt?: number; maxTime?: number; config?: PhysicsConfig; initialSpeed?: number } = {},
) => {
  const dt = options.dt ?? 1 / 60;
  const maxTime = options.maxTime ?? 60;
  let state = createRunState(coaster, options.initialSpeed ?? coaster.train.initialSpeed);

  while (!state.complete && !state.stalled && state.time < maxTime) {
    state = simulateStep(coaster, state, dt, options.config ?? DEFAULT_PHYSICS);
  }

  return state;
};

export const getEnergyTotal = (state: TrainRunState) =>
  state.kineticEnergy + state.potentialEnergy + state.thermalEnergy + state.brakeEnergy - state.liftEnergy;

export const getTrainPosition = (coaster: Coaster, state: TrainRunState): Vec3 => {
  const samples = getCoasterSamples(coaster);
  return getTrackPointAtS(samples, state.s).position;
};
