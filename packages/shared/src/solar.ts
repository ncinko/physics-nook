export type Vec2 = {
  x: number;
  y: number;
};

export type OrbitBodySnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  color: string;
  path: Vec2[];
};

export type OrbitAddBodyPayload = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
};

export type OrbitSnapshot = {
  type: 'solarSnapshot';
  tick: number;
  serverTime: number;
  bodies: OrbitBodySnapshot[];
  playerCount: number;
  events: OrbitWorldEvent[];
};

export type OrbitWorldEvent =
  {
    type: 'bodyAdded';
    id: string;
  };

export type SolarJoinMessage = {
  type: 'solarJoin';
  name?: string;
};

export type SolarAddBodyMessage = {
  type: 'solarAddBody';
  body: OrbitAddBodyPayload;
};

export type SolarClientToServerMessage =
  | SolarJoinMessage
  | SolarAddBodyMessage
  | {
      type: 'ping';
      clientTime: number;
    };

export type SolarJoinedMessage = {
  type: 'solarJoined';
  protocolVersion: number;
  you: string;
  snapshot: OrbitSnapshot;
};

export type SolarPresenceMessage = {
  type: 'solarPresence';
  playerCount: number;
};

export type SolarServerToClientMessage =
  | SolarJoinedMessage
  | OrbitSnapshot
  | SolarPresenceMessage
  | {
      type: 'pong';
      clientTime: number;
      serverTime: number;
    }
  | {
      type: 'error';
      message: string;
    };

export const ORBITAL_CONFIG = {
  protocolVersion: 2,
  tickRate: 60,
  snapshotRate: 20,
  maxBodies: 160,
  trailLength: 54,
  physics: {
    gravity: 0.38,
    softening: 4,
  },
  creation: {
    baseMass: 10,
    massGrowthRate: 0.1,
    maxMass: 5000,
    velocityScale: 0.05,
  },
  world: {
    startingOrbitRadius: 260,
    boundaryLimit: 5000,
    despawnMargin: 1000,
    velocityLimit: 120,
  },
} as const;

export const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const getColorForMass = (mass: number): string => {
  const { baseMass, maxMass } = ORBITAL_CONFIG.creation;
  const minLog = Math.log(baseMass);
  const maxLog = Math.log(maxMass);
  const massLog = Math.log(clampNumber(mass, baseMass, maxMass));
  const ratio = clampNumber((massLog - minLog) / (maxLog - minLog), 0, 1);
  const hue = Math.round(240 - ratio * 240);
  return `hsl(${hue}, 80%, 60%)`;
};

export const getRadiusForMass = (mass: number): number => Math.max(2, Math.sqrt(Math.max(0, mass)) * 0.8);

export const sanitizeOrbitBody = (body: OrbitAddBodyPayload): OrbitAddBodyPayload | null => {
  if (
    !isFiniteNumber(body.x) ||
    !isFiniteNumber(body.y) ||
    !isFiniteNumber(body.vx) ||
    !isFiniteNumber(body.vy) ||
    !isFiniteNumber(body.mass)
  ) {
    return null;
  }

  const { boundaryLimit, velocityLimit } = ORBITAL_CONFIG.world;
  const { baseMass, maxMass } = ORBITAL_CONFIG.creation;
  return {
    x: clampNumber(body.x, -boundaryLimit, boundaryLimit),
    y: clampNumber(body.y, -boundaryLimit, boundaryLimit),
    vx: clampNumber(body.vx, -velocityLimit, velocityLimit),
    vy: clampNumber(body.vy, -velocityLimit, velocityLimit),
    mass: clampNumber(body.mass, baseMass, maxMass),
  };
};

export const createOrbitBody = (id: string, body: OrbitAddBodyPayload): OrbitBodySnapshot => {
  const mass = clampNumber(body.mass, ORBITAL_CONFIG.creation.baseMass, ORBITAL_CONFIG.creation.maxMass);
  return {
    id,
    x: body.x,
    y: body.y,
    vx: body.vx,
    vy: body.vy,
    mass,
    radius: getRadiusForMass(mass),
    color: getColorForMass(mass),
    path: [],
  };
};

export const createSeedBodies = (): OrbitBodySnapshot[] => {
  const radius = ORBITAL_CONFIG.world.startingOrbitRadius;
  return [
    createOrbitBody('seed-anchor', { x: 0, y: 0, vx: 0, vy: 0, mass: 3000 }),
    createOrbitBody('seed-orbiter', { x: 0, y: -radius, vx: 2.35, vy: 0, mass: 100 }),
  ];
};

export const getDespawnLimit = (): number => ORBITAL_CONFIG.world.boundaryLimit + ORBITAL_CONFIG.world.despawnMargin;

export const isBodyPastDespawnLimit = (body: OrbitBodySnapshot): boolean => {
  const limit = getDespawnLimit();
  return Math.abs(body.x) > limit || Math.abs(body.y) > limit;
};

const pushTrailPoint = (body: OrbitBodySnapshot): void => {
  body.path.push({ x: body.x, y: body.y });
  if (body.path.length > ORBITAL_CONFIG.trailLength) {
    body.path.splice(0, body.path.length - ORBITAL_CONFIG.trailLength);
  }
};

const mergeBodies = (target: OrbitBodySnapshot, source: OrbitBodySnapshot): void => {
  const newMass = target.mass + source.mass;
  target.vx = (target.vx * target.mass + source.vx * source.mass) / newMass;
  target.vy = (target.vy * target.mass + source.vy * source.mass) / newMass;
  target.x = (target.x * target.mass + source.x * source.mass) / newMass;
  target.y = (target.y * target.mass + source.y * source.mass) / newMass;
  target.mass = newMass;
  target.radius = getRadiusForMass(newMass);
  target.color = getColorForMass(newMass);
  target.path = [];
};

const resolveCollisionsOnce = (bodies: OrbitBodySnapshot[]): boolean => {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b1 = bodies[i];
      const b2 = bodies[j];
      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= b1.radius + b2.radius) {
        const target = b1.mass >= b2.mass ? b1 : b2;
        const source = target === b1 ? b2 : b1;
        mergeBodies(target, source);
        bodies.splice(target === b1 ? j : i, 1);
        return true;
      }
    }
  }

  return false;
};

const resolveAllCollisions = (bodies: OrbitBodySnapshot[]): void => {
  while (resolveCollisionsOnce(bodies)) {
    // Keep resolving until one pass finds no overlapping bodies.
  }
};

const calculateAccelerations = (bodies: OrbitBodySnapshot[]): Vec2[] => {
  const accelerations = bodies.map(() => ({ x: 0, y: 0 }));
  const { gravity, softening } = ORBITAL_CONFIG.physics;
  const softeningSq = softening * softening;

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b1 = bodies[i];
      const b2 = bodies[j];
      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;
      const softenedDistSq = dx * dx + dy * dy + softeningSq;
      const inverseDistCubed = 1 / (softenedDistSq * Math.sqrt(softenedDistSq));
      const ax = gravity * dx * inverseDistCubed;
      const ay = gravity * dy * inverseDistCubed;

      accelerations[i].x += ax * b2.mass;
      accelerations[i].y += ay * b2.mass;
      accelerations[j].x -= ax * b1.mass;
      accelerations[j].y -= ay * b1.mass;
    }
  }

  return accelerations;
};

const removeDespawnedBodies = (bodies: OrbitBodySnapshot[]): void => {
  for (let index = bodies.length - 1; index >= 0; index -= 1) {
    if (isBodyPastDespawnLimit(bodies[index])) {
      bodies.splice(index, 1);
    }
  }
};

const integrateOrbitBodies = (bodies: OrbitBodySnapshot[], stepAmount: number): void => {
  resolveAllCollisions(bodies);
  if (bodies.length === 0) return;

  const accelerations = calculateAccelerations(bodies);

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const acceleration = accelerations[index];
    body.vx += acceleration.x * stepAmount * 0.5;
    body.vy += acceleration.y * stepAmount * 0.5;
    body.x += body.vx * stepAmount;
    body.y += body.vy * stepAmount;
  }

  removeDespawnedBodies(bodies);
  resolveAllCollisions(bodies);
  if (bodies.length === 0) return;

  const nextAccelerations = calculateAccelerations(bodies);
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const acceleration = nextAccelerations[index];
    body.vx += acceleration.x * stepAmount * 0.5;
    body.vy += acceleration.y * stepAmount * 0.5;
    pushTrailPoint(body);
  }
};

export const getOrbitSystemEnergy = (bodies: OrbitBodySnapshot[]): number => {
  const { gravity, softening } = ORBITAL_CONFIG.physics;
  let energy = 0;

  for (const body of bodies) {
    energy += 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy);
  }

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      energy -= (gravity * bodies[i].mass * bodies[j].mass) / Math.sqrt(dx * dx + dy * dy + softening * softening);
    }
  }

  return energy;
};

export const stepOrbitBodies = (bodies: OrbitBodySnapshot[], dtSeconds: number): void => {
  let remaining = clampNumber(dtSeconds * ORBITAL_CONFIG.tickRate, 0, 4);
  while (remaining > 1e-8) {
    const stepAmount = Math.min(1, remaining);
    integrateOrbitBodies(bodies, stepAmount);
    remaining -= stepAmount;
  }
};
