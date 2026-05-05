export const GAME_CONFIG = {
  protocolVersion: 1,
  maxPlayers: 10,
  tickRate: 60,
  snapshotRate: 20,
  roomCodeLength: 6,
  arena: {
    width: 1280,
    height: 720,
  },
  player: {
    width: 34,
    height: 48,
    maxSpeed: 285,
    groundAcceleration: 2350,
    airAcceleration: 1350,
    friction: 2100,
    gravity: 1850,
    jumpVelocity: 690,
    terminalVelocity: 1150,
  },
} as const;

export const PLAYER_COLORS = [
  '#f5b642',
  '#f77f00',
  '#ffd166',
  '#ef476f',
  '#f4a261',
  '#2a9df4',
  '#06d6a0',
  '#118ab2',
  '#7bdff2',
  '#90be6d',
] as const;

export type Team = 'gold' | 'blue';
export type Facing = -1 | 1;
export type PlayerId = string;

export type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Platform = Rect & {
  id: string;
  kind: 'floor' | 'ledge' | 'wall';
};

export type SpawnPoint = {
  x: number;
  y: number;
  team: Team;
};

export type GameMap = {
  id: string;
  name: string;
  version: number;
  width: number;
  height: number;
  platforms: Platform[];
  spawns: SpawnPoint[];
};

export type RoomPlayer = {
  id: PlayerId;
  name: string;
  slot: number;
  team: Team;
  color: string;
  connected: boolean;
};

export type PlayerSnapshot = RoomPlayer & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  isGrounded: boolean;
  lastInputSeq: number;
};

export type RoomSnapshot = {
  roomCode: string;
  maxPlayers: number;
  players: RoomPlayer[];
  map: GameMap;
};

export type WorldSnapshot = {
  type: 'snapshot';
  roomCode: string;
  tick: number;
  serverTime: number;
  players: PlayerSnapshot[];
};

export type ClientJoinMessage = {
  type: 'join';
  roomCode?: string;
  name?: string;
};

export type ClientInputMessage = {
  type: 'input';
  seq: number;
  input: InputState;
};

export type ClientPingMessage = {
  type: 'ping';
  clientTime: number;
};

export type ClientToServerMessage = ClientJoinMessage | ClientInputMessage | ClientPingMessage;

export type ServerJoinedMessage = {
  type: 'joined';
  protocolVersion: number;
  you: PlayerId;
  room: RoomSnapshot;
  snapshot: WorldSnapshot;
};

export type ServerRoomMessage = {
  type: 'room';
  room: RoomSnapshot;
};

export type ServerErrorMessage = {
  type: 'error';
  message: string;
};

export type ServerPongMessage = {
  type: 'pong';
  clientTime: number;
  serverTime: number;
};

export type ServerToClientMessage =
  | ServerJoinedMessage
  | ServerRoomMessage
  | ServerErrorMessage
  | ServerPongMessage
  | WorldSnapshot;

export const DEFAULT_INPUT: InputState = {
  left: false,
  right: false,
  jump: false,
};

export const GAME_MAP: GameMap = {
  id: 'training-hive',
  name: 'Training Hive',
  version: 1,
  width: GAME_CONFIG.arena.width,
  height: GAME_CONFIG.arena.height,
  spawns: [
    { x: 210, y: 570, team: 'gold' },
    { x: 260, y: 570, team: 'gold' },
    { x: 310, y: 570, team: 'gold' },
    { x: 360, y: 570, team: 'gold' },
    { x: 410, y: 570, team: 'gold' },
    { x: 1070, y: 570, team: 'blue' },
    { x: 1020, y: 570, team: 'blue' },
    { x: 970, y: 570, team: 'blue' },
    { x: 920, y: 570, team: 'blue' },
    { x: 870, y: 570, team: 'blue' },
  ],
  platforms: [
    { id: 'floor', kind: 'floor', x: 0, y: 650, width: 1280, height: 70 },
    { id: 'left-wall', kind: 'wall', x: -24, y: 0, width: 24, height: 720 },
    { id: 'right-wall', kind: 'wall', x: 1280, y: 0, width: 24, height: 720 },
    { id: 'left-nest', kind: 'ledge', x: 110, y: 515, width: 250, height: 28 },
    { id: 'right-nest', kind: 'ledge', x: 920, y: 515, width: 250, height: 28 },
    { id: 'mid-low', kind: 'ledge', x: 455, y: 530, width: 370, height: 24 },
    { id: 'left-mid', kind: 'ledge', x: 250, y: 410, width: 245, height: 24 },
    { id: 'right-mid', kind: 'ledge', x: 785, y: 410, width: 245, height: 24 },
    { id: 'center', kind: 'ledge', x: 540, y: 315, width: 200, height: 24 },
    { id: 'left-top', kind: 'ledge', x: 125, y: 240, width: 230, height: 24 },
    { id: 'right-top', kind: 'ledge', x: 925, y: 240, width: 230, height: 24 },
  ],
};

export const normalizeRoomCode = (value?: string): string => {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, GAME_CONFIG.roomCodeLength);

  return normalized || 'ARENA';
};

export const sanitizePlayerName = (value: unknown, fallback = 'Player'): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const name = value.trim().replace(/\s+/g, ' ').slice(0, 18);
  return name || fallback;
};

export const getTeamForSlot = (slot: number): Team => (slot < GAME_CONFIG.maxPlayers / 2 ? 'gold' : 'blue');

export const getColorForSlot = (slot: number): string => PLAYER_COLORS[slot % PLAYER_COLORS.length];

export const getSpawnForSlot = (slot: number): SpawnPoint => GAME_MAP.spawns[slot % GAME_MAP.spawns.length];

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const createRoomSnapshot = (roomCode: string, players: RoomPlayer[]): RoomSnapshot => ({
  roomCode,
  maxPlayers: GAME_CONFIG.maxPlayers,
  players,
  map: GAME_MAP,
});
