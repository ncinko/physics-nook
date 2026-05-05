export const GAME_CONFIG = {
  protocolVersion: 4,
  maxPlayers: 10,
  tickRate: 60,
  snapshotRate: 20,
  roomCodeLength: 6,
  arena: {
    width: 1920,
    height: 1080,
  },
  player: {
    width: 32,
    height: 32,
    maxSpeed: 5,
    speedBoostMultiplier: 1.5,
    gravity: 0.2,
    jumpVelocity: 8,
    flapVelocity: 5,
    terminalVelocity: 7,
    respawnDelayMs: 1500,
    invincibleMs: 1000,
    queenLives: 3,
  },
  objective: {
    berriesToWin: 10,
    queenDeathsToWin: 3,
    berryRadius: 10,
    pickupRadius: 28,
    snailMountRadius: 44,
    snailSpeed: 0.5,
    droppedPearlGravity: 0.2,
    upgradeTicks: 90,
    clamRespawnTicks: 600,
    scoreScreenMs: 20000,
  },
} as const;

export const LOBBY_CODES = ['LOBBY1', 'LOBBY2', 'LOBBY3'] as const;

export const LOBBY_NAMES: Record<(typeof LOBBY_CODES)[number], string> = {
  LOBBY1: 'Lobby 1',
  LOBBY2: 'Lobby 2',
  LOBBY3: 'Lobby 3',
};

export const TEAM_COLORS = {
  blue: '#00a8ff',
  red: '#ff4757',
} as const;

export const TEAM_DARK_COLORS = {
  blue: '#007ab8',
  red: '#b8323e',
} as const;

export const TEAM_BASE_COLORS = {
  blue: '#002a5c',
  red: '#5c1018',
} as const;

export const PLAYER_COLORS = [
  TEAM_COLORS.blue,
  '#48dbfb',
  '#7bdff2',
  '#66d9ff',
  '#2a9df4',
  TEAM_COLORS.red,
  '#ff6b81',
  '#ff7f8d',
  '#d8414f',
  TEAM_DARK_COLORS.red,
] as const;

export type Team = 'blue' | 'red';
export type Facing = -1 | 1;
export type PlayerId = string;
export type PlayerRole = 'queen' | 'worker' | 'warrior';
export type UpgradeType = 'speed' | 'warrior';
export type LobbyCode = (typeof LOBBY_CODES)[number];
export type LobbyPhase = 'lobby' | 'playing' | 'score';

export type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
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
  passThrough?: boolean;
};

export type SpawnPoint = {
  x: number;
  y: number;
  team: Team;
  role: PlayerRole;
};

export type ScoreSlot = {
  x: number;
  y: number;
};

export type GameBase = Rect & {
  id: string;
  team: Team;
  color: string;
  border: string;
  slots: ScoreSlot[];
};

export type Hive = Rect & {
  id: string;
  team: Team;
};

export type HiveCell = Rect & {
  id: string;
  team: Team;
  filled: boolean;
};

export type BerrySpawn = {
  id: string;
  x: number;
  y: number;
};

export type ClamShell = {
  id: string;
  x: number;
  y: number;
};

export type ClamShellSnapshot = ClamShell & {
  pearlsInside: number;
};

export type UpgradeGate = Rect & {
  id: string;
  type: UpgradeType;
  ownerTeam: Team | null;
};

export type SnailConfig = {
  startX: number;
  y: number;
  blueGoalX: number;
  redGoalX: number;
  width: number;
  height: number;
};

export type GameMap = {
  id: string;
  name: string;
  version: number;
  width: number;
  height: number;
  platforms: Platform[];
  spawns: SpawnPoint[];
  hives: Hive[];
  bases: GameBase[];
  berrySpawns: BerrySpawn[];
  clamShells: ClamShell[];
  upgradeGates: UpgradeGate[];
  snail: SnailConfig;
};

export type RoomPlayer = {
  id: PlayerId;
  name: string;
  slot: number;
  team: Team;
  role: PlayerRole;
  ready: boolean;
  color: string;
  connected: boolean;
};

export type PlayerSnapshot = RoomPlayer & {
  role: PlayerRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  isGrounded: boolean;
  alive: boolean;
  carriedBerryId: string | null;
  speedBoost: boolean;
  lives: number;
  beingEaten: boolean;
  upgradeProgress: number;
  upgradeGateId: string | null;
  invincibleUntil: number;
  respawnsAt: number | null;
  lastInputSeq: number;
};

export type BerrySnapshot = {
  id: string;
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  carriedBy: PlayerId | null;
  depositedTeam: Team | null;
};

export type SnailSnapshot = {
  x: number;
  y: number;
  riderId: PlayerId | null;
  eatingTargetId: PlayerId | null;
  direction: Facing | 0;
  facing: Facing;
};

export type ScoreState = Record<Team, number>;
export type QueenKills = Record<Team, number>;

export type WinnerState = {
  team: Team;
  reason: 'economic' | 'manatee' | 'military';
  decidedAt: number;
} | null;

export type ClashEvent = {
  x: number;
  y: number;
};

export type JumpEvent = {
  x: number;
  y: number;
  team: Team;
};

export type DeathEvent = {
  x: number;
  y: number;
  team: Team;
};

export type RoomSnapshot = {
  roomCode: string;
  name: string;
  phase: LobbyPhase;
  maxPlayers: number;
  players: RoomPlayer[];
  map: GameMap;
  canStart: boolean;
  readyCount: number;
  winner: WinnerState;
  scoreScreenEndsAt: number | null;
};

export type LobbySummary = {
  roomCode: LobbyCode;
  name: string;
  phase: LobbyPhase;
  playerCount: number;
  maxPlayers: number;
  readyCount: number;
  hasBlueQueen: boolean;
  hasRedQueen: boolean;
  winner: WinnerState;
  scoreScreenEndsAt: number | null;
};

export type WorldSnapshot = {
  type: 'snapshot';
  roomCode: string;
  tick: number;
  serverTime: number;
  phase: LobbyPhase;
  timeElapsed: number;
  players: PlayerSnapshot[];
  berries: BerrySnapshot[];
  scores: ScoreState;
  queenKills: QueenKills;
  snail: SnailSnapshot;
  hiveCells: HiveCell[];
  clamshells: ClamShellSnapshot[];
  upgradeGates: UpgradeGate[];
  clashEvents: ClashEvent[];
  jumpEvents: JumpEvent[];
  deathEvents: DeathEvent[];
  winner: WinnerState;
  roundEndsAt: number | null;
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

export type ClientMoveSlotMessage = {
  type: 'moveSlot';
  slot: number;
};

export type ClientSetReadyMessage = {
  type: 'setReady';
  ready: boolean;
};

export type ClientLeaveLobbyMessage = {
  type: 'leaveLobby';
};

export type ClientPingMessage = {
  type: 'ping';
  clientTime: number;
};

export type ClientToServerMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientMoveSlotMessage
  | ClientSetReadyMessage
  | ClientLeaveLobbyMessage
  | ClientPingMessage;

export type ServerLobbyListMessage = {
  type: 'lobbies';
  lobbies: LobbySummary[];
};

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
  | ServerLobbyListMessage
  | ServerJoinedMessage
  | ServerRoomMessage
  | ServerErrorMessage
  | ServerPongMessage
  | WorldSnapshot;

export const DEFAULT_INPUT: InputState = {
  left: false,
  right: false,
  jump: false,
  down: false,
};

const SCORE_SLOTS: ScoreSlot[] = [
  { x: 60, y: 50 },
  { x: 100, y: 50 },
  { x: 140, y: 50 },
  { x: 40, y: 85 },
  { x: 80, y: 85 },
  { x: 120, y: 85 },
  { x: 160, y: 85 },
  { x: 60, y: 120 },
  { x: 100, y: 120 },
  { x: 140, y: 120 },
];

export const GAME_MAP: GameMap = {
  id: 'manatee-royale',
  name: 'Manatee Royale',
  version: 3,
  width: GAME_CONFIG.arena.width,
  height: GAME_CONFIG.arena.height,
  spawns: [
    { x: 300, y: 950, team: 'blue', role: 'queen' },
    { x: 220, y: 950, team: 'blue', role: 'worker' },
    { x: 260, y: 950, team: 'blue', role: 'worker' },
    { x: 340, y: 950, team: 'blue', role: 'worker' },
    { x: 380, y: 950, team: 'blue', role: 'worker' },
    { x: 1580, y: 950, team: 'red', role: 'queen' },
    { x: 1500, y: 950, team: 'red', role: 'worker' },
    { x: 1540, y: 950, team: 'red', role: 'worker' },
    { x: 1620, y: 950, team: 'red', role: 'worker' },
    { x: 1660, y: 950, team: 'red', role: 'worker' },
  ],
  hives: [
    { id: 'blue-base', team: 'blue', x: 760, y: 0, width: 200, height: 180 },
    { id: 'red-base', team: 'red', x: 960, y: 0, width: 200, height: 180 },
  ],
  bases: [
    {
      id: 'blue-base',
      team: 'blue',
      x: 760,
      y: 0,
      width: 200,
      height: 180,
      color: TEAM_BASE_COLORS.blue,
      border: TEAM_COLORS.blue,
      slots: SCORE_SLOTS,
    },
    {
      id: 'red-base',
      team: 'red',
      x: 960,
      y: 0,
      width: 200,
      height: 180,
      color: TEAM_BASE_COLORS.red,
      border: TEAM_COLORS.red,
      slots: SCORE_SLOTS,
    },
  ],
  berrySpawns: [],
  clamShells: [
    { id: 'clam-center', x: 935, y: 850 },
    { id: 'clam-left', x: 50, y: 670 },
    { id: 'clam-right', x: 1820, y: 670 },
  ],
  upgradeGates: [
    { id: 'blue-warrior', type: 'warrior', ownerTeam: 'blue', x: 260, y: 780, width: 80, height: 100 },
    { id: 'red-warrior', type: 'warrior', ownerTeam: 'red', x: 1580, y: 780, width: 80, height: 100 },
    { id: 'red-speed', type: 'speed', ownerTeam: 'red', x: 535, y: 600, width: 80, height: 100 },
    { id: 'blue-speed', type: 'speed', ownerTeam: 'blue', x: 1305, y: 600, width: 80, height: 100 },
  ],
  snail: {
    startX: 905,
    y: 956,
    blueGoalX: 130,
    redGoalX: 1790,
    width: 110,
    height: 54,
  },
  platforms: [
    { id: 'floor', kind: 'floor', x: 0, y: 1040, width: 1920, height: 40 },
    { id: 'low-left', kind: 'ledge', x: 150, y: 880, width: 300, height: 28 },
    { id: 'low-mid', kind: 'ledge', x: 810, y: 880, width: 300, height: 28 },
    { id: 'low-right', kind: 'ledge', x: 1470, y: 880, width: 300, height: 28 },
    { id: 'side-left', kind: 'ledge', x: 0, y: 700, width: 150, height: 28 },
    { id: 'mid-left', kind: 'ledge', x: 450, y: 700, width: 250, height: 28 },
    { id: 'mid-right', kind: 'ledge', x: 1220, y: 700, width: 250, height: 28 },
    { id: 'side-right', kind: 'ledge', x: 1770, y: 700, width: 150, height: 28 },
    { id: 'upper-left', kind: 'ledge', x: 100, y: 520, width: 200, height: 28 },
    { id: 'upper-mid', kind: 'ledge', x: 760, y: 520, width: 400, height: 28 },
    { id: 'upper-right', kind: 'ledge', x: 1620, y: 520, width: 200, height: 28 },
    { id: 'top-left', kind: 'ledge', x: 350, y: 340, width: 300, height: 28 },
    { id: 'top-right', kind: 'ledge', x: 1270, y: 340, width: 300, height: 28 },
    { id: 'cap-left', kind: 'ledge', x: 150, y: 180, width: 200, height: 28 },
    { id: 'cap-mid-left', kind: 'ledge', x: 600, y: 180, width: 150, height: 28 },
    { id: 'cap-mid-right', kind: 'ledge', x: 1170, y: 180, width: 150, height: 28 },
    { id: 'cap-right', kind: 'ledge', x: 1570, y: 180, width: 200, height: 28 },
  ],
};

export const normalizeRoomCode = (value?: string): string => {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, GAME_CONFIG.roomCodeLength);

  return normalized || 'LOBBY1';
};

export const sanitizePlayerName = (value: unknown, fallback = 'Player'): string => {
  const safeFallback = fallback.trim().replace(/\s+/g, '').slice(0, 3) || 'PLY';

  if (typeof value !== 'string') {
    return safeFallback;
  }

  const name = value.trim().replace(/\s+/g, '').slice(0, 3);
  return name || safeFallback;
};

export const getTeamForSlot = (slot: number): Team => (slot < GAME_CONFIG.maxPlayers / 2 ? 'blue' : 'red');

export const getRoleForSlot = (slot: number): PlayerRole => (slot % 5 === 0 ? 'queen' : 'worker');

export const getColorForSlot = (slot: number): string => PLAYER_COLORS[slot % PLAYER_COLORS.length];

export const getSpawnForSlot = (slot: number): SpawnPoint => GAME_MAP.spawns[slot % GAME_MAP.spawns.length];

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const isLobbyCode = (value: string): value is LobbyCode => (LOBBY_CODES as readonly string[]).includes(value);

export const getLobbyName = (roomCode: string): string =>
  isLobbyCode(roomCode) ? LOBBY_NAMES[roomCode] : roomCode;

export const createRoomSnapshot = (
  roomCode: string,
  players: RoomPlayer[],
  phase: LobbyPhase,
  canStart: boolean,
  readyCount: number,
  winner: WinnerState,
  scoreScreenEndsAt: number | null,
): RoomSnapshot => ({
  roomCode,
  name: getLobbyName(roomCode),
  phase,
  maxPlayers: GAME_CONFIG.maxPlayers,
  players,
  map: GAME_MAP,
  canStart,
  readyCount,
  winner,
  scoreScreenEndsAt,
});
