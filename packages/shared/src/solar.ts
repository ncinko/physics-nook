export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type SolarBodyId = 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'giant';

export type SolarBodyConfig = {
  id: SolarBodyId;
  name: string;
  parentId: SolarBodyId | null;
  radius: number;
  orbitRadius: number;
  orbitSeconds: number;
  orbitPhase: number;
  orbitInclinationDeg: number;
  rotationSeconds: number;
  color: string;
  atmosphereColor?: string;
  emissive?: string;
  gravity: number;
};

export type SolarBodyTransform = {
  id: SolarBodyId;
  position: Vec3;
  rotationAngle: number;
};

export type SolarInputState = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  boost: boolean;
  ascend: boolean;
  descend: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  pitchUp: boolean;
  pitchDown: boolean;
  rollLeft: boolean;
  rollRight: boolean;
};

export type SolarPlayerMode = 'surface' | 'ship';

export type SolarPlayerSnapshot = {
  id: string;
  name: string;
  color: string;
  mode: SolarPlayerMode;
  bodyId: SolarBodyId;
  position: Vec3;
  velocity: Vec3;
  up: Vec3;
  forward: Vec3;
  grounded: boolean;
  connected: boolean;
  lastInputSeq: number;
};

export type SolarShipSnapshot = {
  id: 'starter';
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  pilotId: string | null;
  respawnsAt: number | null;
};

export type SolarPresencePlayer = {
  id: string;
  name: string;
  color: string;
  mode: SolarPlayerMode;
};

export type SolarSnapshot = {
  type: 'solarSnapshot';
  tick: number;
  serverTime: number;
  players: SolarPlayerSnapshot[];
  ship: SolarShipSnapshot;
  events: SolarWorldEvent[];
};

export type SolarWorldEvent =
  | {
      type: 'shipBoarded';
      playerId: string;
    }
  | {
      type: 'shipLeft';
      playerId: string;
    }
  | {
      type: 'shipRespawned';
    };

export type SolarJoinMessage = {
  type: 'solarJoin';
  name?: string;
};

export type SolarInputMessage = {
  type: 'solarInput';
  seq: number;
  input: SolarInputState;
  cameraForward?: Vec3;
  cameraRight?: Vec3;
};

export type SolarUseMessage = {
  type: 'solarUse';
};

export type SolarLeaveShipMessage = {
  type: 'solarLeaveShip';
};

export type SolarClientToServerMessage =
  | SolarJoinMessage
  | SolarInputMessage
  | SolarUseMessage
  | SolarLeaveShipMessage
  | {
      type: 'ping';
      clientTime: number;
    };

export type SolarJoinedMessage = {
  type: 'solarJoined';
  protocolVersion: number;
  you: string;
  snapshot: SolarSnapshot;
};

export type SolarPresenceMessage = {
  type: 'solarPresence';
  players: SolarPresencePlayer[];
};

export type SolarServerToClientMessage =
  | SolarJoinedMessage
  | SolarSnapshot
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

export const SOLAR_CONFIG = {
  protocolVersion: 1,
  tickRate: 60,
  snapshotRate: 20,
  maxPlayers: 32,
  player: {
    height: 1.8,
    radius: 0.42,
    walkSpeed: 0.84,
    sprintSpeed: 1.35,
    jumpVelocity: 2.8,
    surfaceGravity: 5.4,
    airControl: 0.35,
  },
  ship: {
    id: 'starter',
    radius: 2.4,
    boardRadius: 14,
    spawnOffsetEast: 7.5,
    spawnOffsetNorth: 2.6,
    spawnAltitude: 1.8,
    acceleration: 8.5,
    boostMultiplier: 2.4,
    turnRate: 1.65,
    rollRate: 1.35,
    damping: 0.18,
    collisionBounce: 0.16,
    idleRespawnMs: 180000,
    lostDistanceFromLaunch: 85,
  },
  launchSite: {
    bodyId: 'earth' as SolarBodyId,
    latitudeDeg: 28.5,
    longitudeDeg: -80.6,
    headingDeg: 68,
  },
} as const;

export const DEFAULT_SOLAR_INPUT: SolarInputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  boost: false,
  ascend: false,
  descend: false,
  yawLeft: false,
  yawRight: false,
  pitchUp: false,
  pitchDown: false,
  rollLeft: false,
  rollRight: false,
};

export const SOLAR_BODIES: SolarBodyConfig[] = [
  {
    id: 'sun',
    name: 'Sun',
    parentId: null,
    radius: 18,
    orbitRadius: 0,
    orbitSeconds: 0,
    orbitPhase: 0,
    orbitInclinationDeg: 0,
    rotationSeconds: 80,
    color: '#ffd166',
    emissive: '#ff9f1c',
    gravity: 7.6,
  },
  {
    id: 'mercury',
    name: 'Ember',
    parentId: 'sun',
    radius: 5,
    orbitRadius: 50,
    orbitSeconds: 82,
    orbitPhase: 0.3,
    orbitInclinationDeg: 3,
    rotationSeconds: 37,
    color: '#a78b71',
    gravity: 1.1,
  },
  {
    id: 'venus',
    name: 'Cloudwell',
    parentId: 'sun',
    radius: 9,
    orbitRadius: 72,
    orbitSeconds: 126,
    orbitPhase: 1.8,
    orbitInclinationDeg: -2,
    rotationSeconds: 66,
    color: '#d8b46a',
    atmosphereColor: '#fff0b8',
    gravity: 2.1,
  },
  {
    id: 'earth',
    name: 'Earth',
    parentId: 'sun',
    radius: 24,
    orbitRadius: 106,
    orbitSeconds: 180,
    orbitPhase: 3.2,
    orbitInclinationDeg: 0,
    rotationSeconds: 96,
    color: '#2f9bff',
    atmosphereColor: '#8bd3ff',
    gravity: 5.4,
  },
  {
    id: 'moon',
    name: 'Moon',
    parentId: 'earth',
    radius: 6,
    orbitRadius: 38,
    orbitSeconds: 46,
    orbitPhase: 0.9,
    orbitInclinationDeg: 8,
    rotationSeconds: 46,
    color: '#c9d1d9',
    gravity: 1.2,
  },
  {
    id: 'mars',
    name: 'Rust Hollow',
    parentId: 'sun',
    radius: 12,
    orbitRadius: 152,
    orbitSeconds: 264,
    orbitPhase: 4.4,
    orbitInclinationDeg: 4,
    rotationSeconds: 104,
    color: '#c65a3a',
    gravity: 2.5,
  },
  {
    id: 'giant',
    name: 'Giant',
    parentId: 'sun',
    radius: 20,
    orbitRadius: 208,
    orbitSeconds: 392,
    orbitPhase: 5.2,
    orbitInclinationDeg: -5,
    rotationSeconds: 130,
    color: '#8ecae6',
    atmosphereColor: '#caf0f8',
    gravity: 4.2,
  },
];

export const SOLAR_BODY_BY_ID = Object.fromEntries(SOLAR_BODIES.map((body) => [body.id, body])) as Record<
  SolarBodyId,
  SolarBodyConfig
>;

export const PLAYER_COLORS_SOLAR = [
  '#7dd3fc',
  '#86efac',
  '#fbbf24',
  '#f0abfc',
  '#fb7185',
  '#a7f3d0',
  '#c4b5fd',
  '#fde68a',
] as const;

export const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const addVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scaleVec = (value: Vec3, scale: number): Vec3 => ({
  x: value.x * scale,
  y: value.y * scale,
  z: value.z * scale,
});
export const dotVec = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const crossVec = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthSqVec = (value: Vec3): number => dotVec(value, value);
export const lengthVec = (value: Vec3): number => Math.sqrt(lengthSqVec(value));
export const distanceVec = (a: Vec3, b: Vec3): number => lengthVec(subVec(a, b));
export const normalizeVec = (value: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 => {
  const length = lengthVec(value);
  if (length < 1e-8) return { ...fallback };
  return scaleVec(value, 1 / length);
};
export const lerpVec = (a: Vec3, b: Vec3, amount: number): Vec3 => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount,
  z: a.z + (b.z - a.z) * amount,
});

export const projectOnPlane = (value: Vec3, normal: Vec3): Vec3 => subVec(value, scaleVec(normal, dotVec(value, normal)));

export const rotateVectorAroundAxis = (value: Vec3, axis: Vec3, radians: number): Vec3 => {
  const unitAxis = normalizeVec(axis);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return addVec(
    addVec(scaleVec(value, cos), scaleVec(crossVec(unitAxis, value), sin)),
    scaleVec(unitAxis, dotVec(unitAxis, value) * (1 - cos)),
  );
};

export const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const wrapLongitudeDeg = (longitudeDeg: number): number => {
  const wrapped = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
};

export const localSphericalToNormal = (latitudeDeg: number, longitudeDeg: number): Vec3 => {
  const latitude = latitudeDeg * DEG_TO_RAD;
  const longitude = longitudeDeg * DEG_TO_RAD;
  const cosLatitude = Math.cos(latitude);
  return normalizeVec({
    x: cosLatitude * Math.cos(longitude),
    y: Math.sin(latitude),
    z: cosLatitude * Math.sin(longitude),
  });
};

export const normalToLocalSpherical = (normal: Vec3): { latitudeDeg: number; longitudeDeg: number } => {
  const unit = normalizeVec(normal);
  return {
    latitudeDeg: Math.asin(clampNumber(unit.y, -1, 1)) * RAD_TO_DEG,
    longitudeDeg: wrapLongitudeDeg(Math.atan2(unit.z, unit.x) * RAD_TO_DEG),
  };
};

export const getSurfaceBasis = (normal: Vec3): { east: Vec3; north: Vec3; up: Vec3 } => {
  const up = normalizeVec(normal);
  const poleSafeAxis = Math.abs(up.y) > 0.96 ? vec3(0, 0, 1) : vec3(0, 1, 0);
  const east = normalizeVec(crossVec(poleSafeAxis, up), vec3(1, 0, 0));
  const north = normalizeVec(crossVec(up, east), vec3(0, 0, 1));
  return { east, north, up };
};

export const offsetLatLonBySurfaceMeters = (
  latitudeDeg: number,
  longitudeDeg: number,
  eastDistance: number,
  northDistance: number,
  radius: number,
): { latitudeDeg: number; longitudeDeg: number } => {
  const latitude = latitudeDeg * DEG_TO_RAD;
  const nextLatitude = clampNumber(latitude + northDistance / radius, -Math.PI / 2 + 1e-5, Math.PI / 2 - 1e-5);
  const latitudeForLongitude = Math.max(0.02, Math.cos(nextLatitude));
  const nextLongitude = longitudeDeg * DEG_TO_RAD + eastDistance / (radius * latitudeForLongitude);
  return {
    latitudeDeg: nextLatitude * RAD_TO_DEG,
    longitudeDeg: wrapLongitudeDeg(nextLongitude * RAD_TO_DEG),
  };
};

export const getBodyTransform = (
  bodyId: SolarBodyId,
  serverTimeMs: number,
  cache: Partial<Record<SolarBodyId, SolarBodyTransform>> = {},
): SolarBodyTransform => {
  const cached = cache[bodyId];
  if (cached) return cached;

  const body = SOLAR_BODY_BY_ID[bodyId];
  const elapsedSeconds = serverTimeMs / 1000;
  let position = vec3();

  if (body.parentId) {
    const parent = getBodyTransform(body.parentId, serverTimeMs, cache);
    const orbitAngle = body.orbitPhase + (body.orbitSeconds > 0 ? (elapsedSeconds / body.orbitSeconds) * TAU : 0);
    const inclination = body.orbitInclinationDeg * DEG_TO_RAD;
    const flat = vec3(Math.cos(orbitAngle) * body.orbitRadius, 0, Math.sin(orbitAngle) * body.orbitRadius);
    position = addVec(parent.position, {
      x: flat.x,
      y: Math.sin(inclination) * flat.z,
      z: Math.cos(inclination) * flat.z,
    });
  }

  const rotationAngle = body.rotationSeconds > 0 ? ((elapsedSeconds / body.rotationSeconds) * TAU) % TAU : 0;
  const transform = { id: bodyId, position, rotationAngle };
  cache[bodyId] = transform;
  return transform;
};

export const getBodyTransforms = (serverTimeMs: number): Record<SolarBodyId, SolarBodyTransform> => {
  const cache: Partial<Record<SolarBodyId, SolarBodyTransform>> = {};
  for (const body of SOLAR_BODIES) {
    getBodyTransform(body.id, serverTimeMs, cache);
  }
  return cache as Record<SolarBodyId, SolarBodyTransform>;
};

export const getLaunchSite = (serverTimeMs: number) => {
  const body = SOLAR_BODY_BY_ID[SOLAR_CONFIG.launchSite.bodyId];
  const transform = getBodyTransform(body.id, serverTimeMs);
  const normal = localSphericalToNormal(SOLAR_CONFIG.launchSite.latitudeDeg, SOLAR_CONFIG.launchSite.longitudeDeg);
  const basis = getSurfaceBasis(normal);
  const heading = SOLAR_CONFIG.launchSite.headingDeg * DEG_TO_RAD;
  const forward = normalizeVec(addVec(scaleVec(basis.north, Math.cos(heading)), scaleVec(basis.east, Math.sin(heading))));
  const right = normalizeVec(crossVec(forward, basis.up));
  const surfacePosition = addVec(transform.position, scaleVec(basis.up, body.radius));

  return {
    body,
    transform,
    position: addVec(surfacePosition, scaleVec(basis.up, SOLAR_CONFIG.player.height / 2)),
    surfacePosition,
    up: basis.up,
    east: basis.east,
    north: basis.north,
    forward,
    right,
  };
};

export const getShipSpawnTransform = (serverTimeMs: number): SolarShipSnapshot => {
  const launch = getLaunchSite(serverTimeMs);
  const position = addVec(
    addVec(
      addVec(launch.surfacePosition, scaleVec(launch.east, SOLAR_CONFIG.ship.spawnOffsetEast)),
      scaleVec(launch.north, SOLAR_CONFIG.ship.spawnOffsetNorth),
    ),
    scaleVec(launch.up, SOLAR_CONFIG.ship.spawnAltitude + SOLAR_CONFIG.ship.radius),
  );
  const forward = normalizeVec(launch.forward);
  const up = normalizeVec(launch.up);
  const right = normalizeVec(crossVec(forward, up));

  return {
    id: 'starter',
    position,
    velocity: vec3(),
    forward,
    up,
    right,
    pilotId: null,
    respawnsAt: null,
  };
};

export const getNearestBody = (position: Vec3, serverTimeMs: number): { body: SolarBodyConfig; transform: SolarBodyTransform; distance: number } => {
  const transforms = getBodyTransforms(serverTimeMs);
  let nearest = SOLAR_BODIES[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const body of SOLAR_BODIES) {
    const distance = distanceVec(position, transforms[body.id].position) - body.radius;
    if (distance < nearestDistance) {
      nearest = body;
      nearestDistance = distance;
    }
  }

  return {
    body: nearest,
    transform: transforms[nearest.id],
    distance: nearestDistance,
  };
};

export const getCircumnavigationSeconds = (radius: number, speed: number): number => (TAU * radius) / speed;
