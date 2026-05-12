export type RippleVec2 = {
  x: number;
  y: number;
};

export type RippleEmitterSnapshot = RippleVec2 & {
  id: string;
  amplitude: number;
  frequency: number;
  phase: number;
  radius: number;
  color: string;
  enabled: boolean;
  controlledBy: string | null;
  updatedAt: number;
};

export type RippleObjectKind = 'barrier' | 'parabola' | 'single-slit' | 'double-slit';

export type RippleObjectSnapshot = RippleVec2 & {
  id: string;
  kind: RippleObjectKind;
  width: number;
  height: number;
  rotation: number;
  gap: number;
  spacing: number;
  controlledBy: string | null;
  updatedAt: number;
};

export type RippleSplashPayload = RippleVec2 & {
  strength?: number;
  radius?: number;
};

export type RippleSplashEvent = RippleVec2 & {
  id: string;
  strength: number;
  radius: number;
  createdBy: string;
  serverTime: number;
};

export type RippleEmitterPatch = Partial<
  Pick<RippleEmitterSnapshot, 'x' | 'y' | 'amplitude' | 'frequency' | 'phase' | 'radius' | 'color' | 'enabled'>
>;

export type RippleObjectPatch = Partial<
  Pick<RippleObjectSnapshot, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'gap' | 'spacing'>
>;

export type RippleSnapshot = {
  type: 'rippleSnapshot';
  roomCode: string;
  serverTime: number;
  paused: boolean;
  resetVersion: number;
  emitters: RippleEmitterSnapshot[];
  objects: RippleObjectSnapshot[];
  recentSplashes: RippleSplashEvent[];
  playerCount: number;
};

export type RippleRoomSummary = {
  roomCode: string;
  playerCount: number;
};

export type RippleJoinMessage = {
  type: 'rippleJoin';
  name?: string;
  roomCode?: string;
};

export type RippleSplashMessage = {
  type: 'rippleSplash';
  splash: RippleSplashPayload;
};

export type RippleEmitterUpdateMessage = {
  type: 'rippleEmitterUpdate';
  id: string;
  patch: RippleEmitterPatch;
};

export type RippleEmitterReleaseMessage = {
  type: 'rippleEmitterRelease';
  id: string;
};

export type RippleObjectCreateMessage = {
  type: 'rippleObjectCreate';
  kind: RippleObjectKind;
  object: RippleObjectPatch;
};

export type RippleObjectUpdateMessage = {
  type: 'rippleObjectUpdate';
  id: string;
  patch: RippleObjectPatch;
};

export type RippleObjectDeleteMessage = {
  type: 'rippleObjectDelete';
  id: string;
};

export type RippleObjectReleaseMessage = {
  type: 'rippleObjectRelease';
  id: string;
};

export type RippleSetPausedMessage = {
  type: 'rippleSetPaused';
  paused: boolean;
};

export type RippleResetMessage = {
  type: 'rippleReset';
};

export type RipplePingMessage = {
  type: 'ping';
  clientTime: number;
};

export type RippleClientToServerMessage =
  | RippleJoinMessage
  | RippleSplashMessage
  | RippleEmitterUpdateMessage
  | RippleEmitterReleaseMessage
  | RippleObjectCreateMessage
  | RippleObjectUpdateMessage
  | RippleObjectDeleteMessage
  | RippleObjectReleaseMessage
  | RippleSetPausedMessage
  | RippleResetMessage
  | RipplePingMessage;

export type RippleJoinedMessage = {
  type: 'rippleJoined';
  protocolVersion: number;
  you: string;
  snapshot: RippleSnapshot;
  rooms: RippleRoomSummary[];
  maxActiveUsers: number;
};

export type RipplePresenceMessage = {
  type: 'ripplePresence';
  playerCount: number;
};

export type RippleRoomsMessage = {
  type: 'rippleRooms';
  rooms: RippleRoomSummary[];
  maxActiveUsers: number;
};

export type RippleLobbyMessage = {
  type: 'rippleLobby';
  reason: 'inactive' | 'full' | 'local';
  message: string;
  rooms: RippleRoomSummary[];
  maxActiveUsers: number;
};

export type RippleErrorMessage = {
  type: 'error';
  message: string;
};

export type RipplePongMessage = {
  type: 'pong';
  clientTime: number;
  serverTime: number;
};

export type RippleServerToClientMessage =
  | RippleJoinedMessage
  | RippleSnapshot
  | RipplePresenceMessage
  | RippleRoomsMessage
  | RippleLobbyMessage
  | RippleErrorMessage
  | RipplePongMessage;

export const RIPPLE_CONFIG = {
  protocolVersion: 1,
  defaultRoomCode: 'TANK1',
  persistentRoomCodes: ['TANK1', 'TANK2', 'TANK3'],
  maxActiveUsers: 25,
  inactiveTimeoutMs: 120_000,
  roomCodeLength: 16,
  recentSplashLimit: 90,
  splashRateLimitMs: 38,
  nameMaxLength: 18,
  splash: {
    defaultStrength: 2.2,
    minStrength: 0.15,
    maxStrength: 3.2,
    defaultRadius: 0.055,
    minRadius: 0.012,
    maxRadius: 0.12,
  },
  emitter: {
    minAmplitude: 0,
    maxAmplitude: 2.4,
    minFrequency: 0.12,
    maxFrequency: 2.8,
    minRadius: 0.012,
    maxRadius: 0.085,
  },
  object: {
    maxObjects: 24,
    minSize: 0.008,
    maxSize: 0.55,
    minGap: 0.006,
    maxGap: 0.28,
    minSpacing: 0.006,
    maxSpacing: 0.28,
  },
} as const;

export const clampRippleNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const isFiniteRippleNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const normalizeRippleRoomCode = (value?: string): string => {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, RIPPLE_CONFIG.roomCodeLength);

  return normalized || RIPPLE_CONFIG.defaultRoomCode;
};

export const isPersistentRippleRoomCode = (value: string): boolean =>
  (RIPPLE_CONFIG.persistentRoomCodes as readonly string[]).includes(normalizeRippleRoomCode(value));

export const resolvePersistentRippleRoomCode = (value?: string): string => {
  const normalized = normalizeRippleRoomCode(value);
  return isPersistentRippleRoomCode(normalized) ? normalized : RIPPLE_CONFIG.defaultRoomCode;
};

export const sanitizeRippleName = (value: unknown, fallback = 'Explorer'): string => {
  if (typeof value !== 'string') return fallback;
  const name = value
    .trim()
    .replace(/[^\w -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, RIPPLE_CONFIG.nameMaxLength);
  return name || fallback;
};

const sanitizeRippleColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
};

export const sanitizeRippleSplash = (payload: unknown): Required<RippleSplashPayload> | null => {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as RippleSplashPayload;

  if (!isFiniteRippleNumber(candidate.x) || !isFiniteRippleNumber(candidate.y)) {
    return null;
  }

  const strength = isFiniteRippleNumber(candidate.strength)
    ? candidate.strength
    : RIPPLE_CONFIG.splash.defaultStrength;
  const radius = isFiniteRippleNumber(candidate.radius) ? candidate.radius : RIPPLE_CONFIG.splash.defaultRadius;

  return {
    x: clampRippleNumber(candidate.x, 0, 1),
    y: clampRippleNumber(candidate.y, 0, 1),
    strength: clampRippleNumber(strength, RIPPLE_CONFIG.splash.minStrength, RIPPLE_CONFIG.splash.maxStrength),
    radius: clampRippleNumber(radius, RIPPLE_CONFIG.splash.minRadius, RIPPLE_CONFIG.splash.maxRadius),
  };
};

export const sanitizeRippleEmitterPatch = (patch: unknown): RippleEmitterPatch | null => {
  if (!patch || typeof patch !== 'object') return null;
  const candidate = patch as RippleEmitterPatch;
  const sanitized: RippleEmitterPatch = {};

  if ('x' in candidate) {
    if (!isFiniteRippleNumber(candidate.x)) return null;
    sanitized.x = clampRippleNumber(candidate.x, 0, 1);
  }

  if ('y' in candidate) {
    if (!isFiniteRippleNumber(candidate.y)) return null;
    sanitized.y = clampRippleNumber(candidate.y, 0, 1);
  }

  if ('amplitude' in candidate) {
    if (!isFiniteRippleNumber(candidate.amplitude)) return null;
    sanitized.amplitude = clampRippleNumber(
      candidate.amplitude,
      RIPPLE_CONFIG.emitter.minAmplitude,
      RIPPLE_CONFIG.emitter.maxAmplitude,
    );
  }

  if ('frequency' in candidate) {
    if (!isFiniteRippleNumber(candidate.frequency)) return null;
    sanitized.frequency = clampRippleNumber(
      candidate.frequency,
      RIPPLE_CONFIG.emitter.minFrequency,
      RIPPLE_CONFIG.emitter.maxFrequency,
    );
  }

  if ('phase' in candidate) {
    if (!isFiniteRippleNumber(candidate.phase)) return null;
    sanitized.phase = clampRippleNumber(candidate.phase, -Math.PI * 2, Math.PI * 2);
  }

  if ('radius' in candidate) {
    if (!isFiniteRippleNumber(candidate.radius)) return null;
    sanitized.radius = clampRippleNumber(
      candidate.radius,
      RIPPLE_CONFIG.emitter.minRadius,
      RIPPLE_CONFIG.emitter.maxRadius,
    );
  }

  if ('enabled' in candidate) {
    if (typeof candidate.enabled !== 'boolean') return null;
    sanitized.enabled = candidate.enabled;
  }

  if ('color' in candidate) {
    const color = sanitizeRippleColor(candidate.color);
    if (!color) return null;
    sanitized.color = color;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
};

export const isRippleObjectKind = (value: unknown): value is RippleObjectKind =>
  value === 'barrier' || value === 'parabola' || value === 'single-slit' || value === 'double-slit';

export const sanitizeRippleObjectPatch = (patch: unknown): RippleObjectPatch | null => {
  if (!patch || typeof patch !== 'object') return null;
  const candidate = patch as RippleObjectPatch;
  const sanitized: RippleObjectPatch = {};

  if ('x' in candidate) {
    if (!isFiniteRippleNumber(candidate.x)) return null;
    sanitized.x = clampRippleNumber(candidate.x, 0, 1);
  }

  if ('y' in candidate) {
    if (!isFiniteRippleNumber(candidate.y)) return null;
    sanitized.y = clampRippleNumber(candidate.y, 0, 1);
  }

  if ('width' in candidate) {
    if (!isFiniteRippleNumber(candidate.width)) return null;
    sanitized.width = clampRippleNumber(
      candidate.width,
      RIPPLE_CONFIG.object.minSize,
      RIPPLE_CONFIG.object.maxSize,
    );
  }

  if ('height' in candidate) {
    if (!isFiniteRippleNumber(candidate.height)) return null;
    sanitized.height = clampRippleNumber(
      candidate.height,
      RIPPLE_CONFIG.object.minSize,
      RIPPLE_CONFIG.object.maxSize,
    );
  }

  if ('rotation' in candidate) {
    if (!isFiniteRippleNumber(candidate.rotation)) return null;
    sanitized.rotation = clampRippleNumber(candidate.rotation, -Math.PI * 2, Math.PI * 2);
  }

  if ('gap' in candidate) {
    if (!isFiniteRippleNumber(candidate.gap)) return null;
    sanitized.gap = clampRippleNumber(candidate.gap, RIPPLE_CONFIG.object.minGap, RIPPLE_CONFIG.object.maxGap);
  }

  if ('spacing' in candidate) {
    if (!isFiniteRippleNumber(candidate.spacing)) return null;
    sanitized.spacing = clampRippleNumber(
      candidate.spacing,
      RIPPLE_CONFIG.object.minSpacing,
      RIPPLE_CONFIG.object.maxSpacing,
    );
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
};

export const createDefaultRippleObject = (
  id: string,
  kind: RippleObjectKind,
  patch: RippleObjectPatch,
  updatedAt = 0,
): RippleObjectSnapshot => {
  const base =
    kind === 'parabola'
      ? { width: 0.22, height: 0.18, gap: 0.1, spacing: 0.058 }
      : kind === 'single-slit'
        ? { width: 0.012, height: 0.32, gap: 0.1, spacing: 0.058 }
        : kind === 'double-slit'
          ? { width: 0.012, height: 0.34, gap: 0.065, spacing: 0.058 }
        : { width: 0.24, height: 0.035, gap: 0.1, spacing: 0.058 };
  const sanitized: RippleObjectPatch = sanitizeRippleObjectPatch({ ...base, ...patch }) ?? { ...base };

  return {
    id,
    kind,
    x: sanitized.x ?? 0.5,
    y: sanitized.y ?? 0.5,
    width: sanitized.width ?? base.width,
    height: sanitized.height ?? base.height,
    rotation: sanitized.rotation ?? 0,
    gap: sanitized.gap ?? base.gap,
    spacing: sanitized.spacing ?? base.spacing,
    controlledBy: null,
    updatedAt,
  };
};

export const createDefaultRippleEmitters = (updatedAt = 0): RippleEmitterSnapshot[] => [
  {
    id: 'cool-left',
    x: 0.39,
    y: 0.44,
    amplitude: 1.05,
    frequency: 0.72,
    phase: 0,
    radius: 0.038,
    color: '#60a5fa',
    enabled: true,
    controlledBy: null,
    updatedAt,
  },
  {
    id: 'cool-center',
    x: 0.5,
    y: 0.46,
    amplitude: 0.94,
    frequency: 0.72,
    phase: 0,
    radius: 0.034,
    color: '#22d3ee',
    enabled: true,
    controlledBy: null,
    updatedAt,
  },
  {
    id: 'warm-right',
    x: 0.62,
    y: 0.44,
    amplitude: 1.0,
    frequency: 0.72,
    phase: Math.PI,
    radius: 0.038,
    color: '#f87171',
    enabled: true,
    controlledBy: null,
    updatedAt,
  },
];

export const cloneRippleEmitter = (emitter: RippleEmitterSnapshot): RippleEmitterSnapshot => ({ ...emitter });

export const cloneRippleObject = (object: RippleObjectSnapshot): RippleObjectSnapshot => ({ ...object });

export const cloneRippleSplash = (splash: RippleSplashEvent): RippleSplashEvent => ({ ...splash });
