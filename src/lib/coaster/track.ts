import type {
  Coaster,
  ParkDocument,
  ParkOp,
  PieceTemplate,
  PieceTemplateId,
  PieceVariant,
  PreviewResult,
  TrackFlags,
  TrackSample,
  TrackSegment,
  TrackTransform,
  Vec3,
} from './types.ts';

const TAU = Math.PI * 2;
const SAMPLE_SPACING = 1.2;
const MIN_TRACK_Y = 0.55;
const COLLISION_RADIUS = 1.55;
export const TILE_SIZE = 8;
export const BUILD_GRID_SIZE = TILE_SIZE * 40;
const SMALL_TURN_RADIUS = TILE_SIZE * 1.5;

export function degToRad(degrees: number) {
  return (degrees / 180) * Math.PI;
}

export function radToDeg(radians: number) {
  return (radians / Math.PI) * 180;
}

export const PIECE_TEMPLATES: PieceTemplate[] = [
  {
    id: 'station',
    label: 'Station',
    shortLabel: 'Station',
    length: TILE_SIZE * 2,
    flags: { station: true },
    variants: [{ id: 'default', label: 'Flat' }],
  },
  {
    id: 'straight',
    label: 'Straight',
    shortLabel: 'Straight',
    length: TILE_SIZE,
    variants: [{ id: 'default', label: 'Flat' }],
  },
  {
    id: 'slope',
    label: 'Slope',
    shortLabel: 'Slope',
    length: TILE_SIZE,
    variants: [
      { id: 'up', label: 'Up', heightDelta: TILE_SIZE * 0.35 },
      { id: 'down', label: 'Down', heightDelta: -TILE_SIZE * 0.35 },
    ],
  },
  {
    id: 'flat-turn',
    label: 'Flat Turn',
    shortLabel: 'Turn',
    length: SMALL_TURN_RADIUS * (Math.PI / 2),
    radius: SMALL_TURN_RADIUS,
    variants: [
      { id: 'right', label: 'Right', yawDelta: degToRad(90) },
      { id: 'left', label: 'Left', yawDelta: degToRad(-90) },
    ],
  },
  {
    id: 'banked-turn',
    label: 'Banked Turn',
    shortLabel: 'Bank',
    length: SMALL_TURN_RADIUS * (Math.PI / 2),
    radius: SMALL_TURN_RADIUS,
    variants: [
      { id: 'right', label: 'Right Bank', yawDelta: degToRad(90), bankAngle: degToRad(28) },
      { id: 'left', label: 'Left Bank', yawDelta: degToRad(-90), bankAngle: degToRad(-28) },
    ],
  },
  {
    id: 'lift',
    label: 'Lift Hill',
    shortLabel: 'Lift',
    length: TILE_SIZE,
    flags: { lift: true },
    variants: [{ id: 'up', label: 'Chain Up', heightDelta: TILE_SIZE * 0.35 }],
  },
  {
    id: 'drop',
    label: 'Drop',
    shortLabel: 'Drop',
    length: TILE_SIZE,
    variants: [{ id: 'down', label: 'Dive', heightDelta: -TILE_SIZE * 0.35 }],
  },
  {
    id: 'brake',
    label: 'Brake Run',
    shortLabel: 'Brake',
    length: TILE_SIZE,
    flags: { brake: true },
    variants: [{ id: 'default', label: 'Brake', targetSpeed: 5.5 }],
  },
  {
    id: 'loop',
    label: 'Vertical Loop',
    shortLabel: 'Loop',
    length: TILE_SIZE * 2,
    radius: TILE_SIZE * 0.75,
    flags: { loop: true },
    variants: [{ id: 'default', label: 'Loop' }],
  },
];

export const getPieceTemplate = (id: PieceTemplateId) => {
  const template = PIECE_TEMPLATES.find((piece) => piece.id === id);

  if (!template) {
    throw new Error(`Unknown coaster piece: ${id}`);
  }

  return template;
};

export const getDefaultVariant = (templateId: PieceTemplateId) =>
  getPieceTemplate(templateId).variants[0];

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const makeId = (prefix: string) => {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${prefix}-${random}`;
};

export const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);

export const mul = (a: Vec3, scalar: number): Vec3 => v(a.x * scalar, a.y * scalar, a.z * scalar);

export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));

export const normalize = (a: Vec3, fallback: Vec3 = v(0, 0, 1)): Vec3 => {
  const magnitude = length(a);
  return magnitude > 1e-8 ? mul(a, 1 / magnitude) : fallback;
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

export const yawPitchDirection = (yaw: number, pitch: number): Vec3 =>
  normalize(v(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));

const projectUpToTrackNormal = (tangent: Vec3, previousNormal?: Vec3) => {
  const worldUp = v(0, 1, 0);
  const projected = sub(worldUp, mul(tangent, dot(worldUp, tangent)));
  return normalize(projected, previousNormal ?? v(0, 1, 0));
};

const mergeFlags = (template: PieceTemplate): TrackFlags => ({ ...(template.flags ?? {}) });

const makeRawSample = (position: Vec3, roll: number) => ({ position, roll });

const smoothStep = (t: number) => t * t * (3 - 2 * t);

const rotateHorizontal = (point: Vec3, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return v(point.x * cos + point.z * sin, point.y, -point.x * sin + point.z * cos);
};

const buildLinearSamples = (
  connector: TrackTransform,
  template: PieceTemplate,
  variant: PieceVariant,
) => {
  const steps = Math.max(8, Math.ceil(template.length / SAMPLE_SPACING));
  const heightDelta = variant.heightDelta ?? 0;
  const horizontalForward = yawPitchDirection(connector.yaw, 0);
  const raw = [makeRawSample(connector.position, connector.roll)];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const current = add(
      add(connector.position, mul(horizontalForward, template.length * t)),
      v(0, heightDelta * smoothStep(t), 0),
    );
    raw.push(makeRawSample(current, connector.roll * (1 - t)));
  }

  const current = raw[raw.length - 1].position;

  return {
    raw,
    endTransform: {
      position: current,
      yaw: connector.yaw,
      pitch: 0,
      roll: 0,
    },
  };
};

const buildTurnSamples = (
  connector: TrackTransform,
  template: PieceTemplate,
  variant: PieceVariant,
) => {
  const yawDelta = variant.yawDelta ?? 0;
  const radius = template.radius ?? SMALL_TURN_RADIUS;
  const arcLength = Math.abs(yawDelta) * radius;
  const steps = Math.max(10, Math.ceil(arcLength / SAMPLE_SPACING));
  const raw = [makeRawSample(connector.position, connector.roll)];
  const turnSign = yawDelta >= 0 ? 1 : -1;
  const forward = yawPitchDirection(connector.yaw, 0);
  const right = v(Math.cos(connector.yaw), 0, -Math.sin(connector.yaw));
  const center = add(connector.position, mul(right, radius * turnSign));
  const startRadial = mul(right, -radius * turnSign);

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const radial = rotateHorizontal(startRadial, turnSign * Math.abs(yawDelta) * t);
    const current = add(center, radial);
    current.y = connector.position.y;
    const roll = (variant.bankAngle ?? 0) * Math.sin(Math.PI * t);
    raw.push(makeRawSample(current, roll));
  }

  const current = raw[raw.length - 1].position;

  return {
    raw,
    endTransform: {
      position: current,
      yaw: connector.yaw + yawDelta,
      pitch: 0,
      roll: 0,
    },
  };
};

const buildLoopSamples = (connector: TrackTransform, template: PieceTemplate) => {
  const radius = template.radius ?? 6.5;
  const advance = TILE_SIZE * 2;
  const steps = 52;
  const forward = yawPitchDirection(connector.yaw, 0);
  const raw = [makeRawSample(connector.position, 0)];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const angle = TAU * t;
    const localForward = advance * t + radius * 0.42 * Math.sin(angle);
    const localUp = radius * (1 - Math.cos(angle));
    raw.push(makeRawSample(add(connector.position, add(mul(forward, localForward), v(0, localUp, 0))), 0));
  }

  return {
    raw,
    endTransform: {
      position: add(connector.position, mul(forward, advance)),
      yaw: connector.yaw,
      pitch: connector.pitch,
      roll: 0,
    },
  };
};

const finalizeSamples = (
  raw: Array<{ position: Vec3; roll: number }>,
  segmentId: string,
  flags: TrackFlags,
) => {
  let arclength = 0;
  let previousNormal: Vec3 | undefined;

  return raw.map((sample, index): TrackSample => {
    if (index > 0) {
      arclength += distance(raw[index - 1].position, sample.position);
    }

    const previous = raw[Math.max(0, index - 1)].position;
    const next = raw[Math.min(raw.length - 1, index + 1)].position;
    const tangent = normalize(sub(next, previous), v(0, 0, 1));
    const normal = projectUpToTrackNormal(tangent, previousNormal);
    previousNormal = normal;
    const binormal = normalize(cross(tangent, normal), v(1, 0, 0));
    const previousTangent =
      index > 0 ? normalize(sub(sample.position, raw[index - 1].position), tangent) : tangent;
    const nextTangent =
      index < raw.length - 1 ? normalize(sub(raw[index + 1].position, sample.position), tangent) : tangent;
    const tangentDelta = sub(nextTangent, previousTangent);
    const localDistance =
      index > 0 && index < raw.length - 1
        ? Math.max(distance(raw[index - 1].position, raw[index + 1].position), 0.001)
        : Math.max(distance(previous, next), 0.001);
    const curvature = length(tangentDelta) / localDistance;
    const curvatureNormal = normalize(tangentDelta, normal);

    return {
      position: sample.position,
      tangent,
      normal,
      binormal,
      curvatureNormal,
      arclength,
      curvature,
      slope: tangent.y,
      roll: sample.roll,
      segmentId,
      flags,
    };
  });
};

export const createSegmentFromTemplate = (
  templateId: PieceTemplateId,
  connector: TrackTransform,
  variant: PieceVariant = getDefaultVariant(templateId),
  segmentId = makeId('seg'),
): TrackSegment => {
  const template = getPieceTemplate(templateId);
  const flags = mergeFlags(template);
  const built =
    templateId === 'flat-turn' || templateId === 'banked-turn'
      ? buildTurnSamples(connector, template, variant)
      : templateId === 'loop'
        ? buildLoopSamples(connector, template)
        : buildLinearSamples(connector, template, variant);
  const samples = finalizeSamples(built.raw, segmentId, flags);
  const lengthMeters = samples[samples.length - 1]?.arclength ?? template.length;

  return {
    id: segmentId,
    templateId,
    label: template.label,
    variant,
    connector,
    endTransform: built.endTransform,
    length: lengthMeters,
    samples,
    flags,
  };
};

export const createInitialPark = (): ParkDocument => {
  const station = createSegmentFromTemplate(
    'station',
    { position: v(TILE_SIZE / 2, 1.2, -TILE_SIZE), yaw: 0, pitch: 0, roll: 0 },
    getDefaultVariant('station'),
    'station-1',
  );

  return {
    schemaVersion: 1,
    version: 0,
    terrain: { groundY: 0, gridSize: BUILD_GRID_SIZE },
    scenery: [],
    coasters: [
      {
        id: 'coaster-main',
        name: 'Coaster 1',
        stationSegmentId: station.id,
        segments: [station],
        train: {
          carCount: 5,
          massKg: 1200,
          initialSpeed: 5,
          chainSpeed: 4,
          brakeSpeed: 5.5,
        },
      },
    ],
  };
};

export const getOpenEndTransform = (coaster: Coaster): TrackTransform =>
  coaster.segments[coaster.segments.length - 1]?.endTransform ?? {
    position: v(0, 1.2, 0),
    yaw: 0,
    pitch: 0,
    roll: 0,
  };

export const getCoasterSamples = (coaster: Coaster): TrackSample[] => {
  const samples: TrackSample[] = [];
  let offset = 0;

  coaster.segments.forEach((segment, segmentIndex) => {
    segment.samples.forEach((sample, sampleIndex) => {
      if (segmentIndex > 0 && sampleIndex === 0) {
        return;
      }

      samples.push({
        ...sample,
        arclength: offset + sample.arclength,
      });
    });
    offset += segment.length;
  });

  return samples;
};

export const getTrackLength = (coaster: Coaster) =>
  coaster.segments.reduce((total, segment) => total + segment.length, 0);

export const getTrackPointAtS = (samples: TrackSample[], s: number): TrackSample => {
  if (samples.length === 0) {
    throw new Error('Cannot sample an empty track.');
  }

  const clampedS = clamp(s, samples[0].arclength, samples[samples.length - 1].arclength);
  let high = samples.length - 1;
  let low = 0;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].arclength < clampedS) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const right = samples[low];
  const left = samples[Math.max(0, low - 1)];
  const span = Math.max(right.arclength - left.arclength, 0.001);
  const t = clamp((clampedS - left.arclength) / span, 0, 1);

  return {
    ...right,
    position: lerpVec(left.position, right.position, t),
    tangent: normalize(lerpVec(left.tangent, right.tangent, t), right.tangent),
    normal: normalize(lerpVec(left.normal, right.normal, t), right.normal),
    binormal: normalize(lerpVec(left.binormal, right.binormal, t), right.binormal),
    curvatureNormal: normalize(lerpVec(left.curvatureNormal, right.curvatureNormal, t), right.curvatureNormal),
    arclength: clampedS,
    curvature: lerp(left.curvature, right.curvature, t),
    slope: lerp(left.slope, right.slope, t),
    roll: lerp(left.roll, right.roll, t),
  };
};

export const buildPreviewSegment = (
  park: ParkDocument,
  coasterId: string,
  templateId: PieceTemplateId,
  variant: PieceVariant = getDefaultVariant(templateId),
): PreviewResult => {
  const coaster = park.coasters.find((entry) => entry.id === coasterId);

  if (!coaster) {
    throw new Error(`Unknown coaster: ${coasterId}`);
  }

  const connector = getOpenEndTransform(coaster);
  const segment = createSegmentFromTemplate(templateId, connector, variant, makeId('preview'));
  const reason = getPreviewProblem(coaster, segment, park.terrain.groundY);

  return {
    segment,
    valid: reason === '',
    reason,
  };
};

export const getPreviewProblem = (coaster: Coaster, segment: TrackSegment, groundY = 0) => {
  if (segment.templateId === 'loop' && Math.abs(segment.connector.pitch) > degToRad(6)) {
    return 'Loop pieces need a nearly level connector.';
  }

  if (
    (segment.templateId === 'flat-turn' || segment.templateId === 'banked-turn') &&
    Math.abs(segment.connector.pitch) > degToRad(6)
  ) {
    return 'Turn pieces need a nearly level connector.';
  }

  if (segment.samples.some((sample) => sample.position.y < groundY + MIN_TRACK_Y)) {
    return 'Track would clip through the terrain.';
  }

  const existingSamples = getCoasterSamples(coaster);
  const ignoredExistingStart = Math.max(0, existingSamples.length - 12);

  for (let index = 5; index < segment.samples.length; index += 1) {
    const sample = segment.samples[index];

    for (let otherIndex = 0; otherIndex < ignoredExistingStart; otherIndex += 1) {
      if (distance(sample.position, existingSamples[otherIndex].position) < COLLISION_RADIUS) {
        return 'Track would collide with an existing segment.';
      }
    }
  }

  return '';
};

const clonePark = (park: ParkDocument): ParkDocument =>
  typeof structuredClone === 'function' ? structuredClone(park) : JSON.parse(JSON.stringify(park));

export const applyParkOp = (park: ParkDocument, op: ParkOp): ParkDocument => {
  if (op.type === 'updatePresence' || op.type === 'startRun') {
    return park;
  }

  if (op.type === 'replacePark') {
    return {
      ...op.document,
      version: park.version + 1,
    };
  }

  const next = clonePark(park);

  if (op.type === 'appendPiece') {
    const coaster = next.coasters.find((entry) => entry.id === op.coasterId);
    if (!coaster) {
      return park;
    }
    coaster.segments.push(op.segment);
    next.version += 1;
    return next;
  }

  if (op.type === 'undoLastPiece') {
    const coaster = next.coasters.find((entry) => entry.id === op.coasterId);
    if (!coaster || coaster.segments.length <= 1) {
      return park;
    }
    coaster.segments.pop();
    next.version += 1;
    return next;
  }

  if (op.type === 'deleteCoaster') {
    next.coasters = next.coasters.filter((coaster) => coaster.id !== op.coasterId);
    next.version += 1;
    return next;
  }

  return park;
};

export const summarizeCoaster = (coaster: Coaster) => {
  const samples = getCoasterSamples(coaster);
  const heights = samples.map((sample) => sample.position.y);

  return {
    length: getTrackLength(coaster),
    segmentCount: coaster.segments.length,
    minHeight: Math.min(...heights),
    maxHeight: Math.max(...heights),
    end: getOpenEndTransform(coaster),
  };
};
