import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { URL, pathToFileURL } from 'node:url';

import { createCoasterWorld } from './coaster.ts';
import { createRippleWorld } from './ripple.ts';
import { createSolarWorld } from './solar.ts';

import {
  DEFAULT_INPUT,
  GAME_CONFIG,
  GAME_MAP,
  LOBBY_CODES,
  TEAM_COLORS,
  clamp,
  createRoomSnapshot,
  getColorForSlot,
  getLobbyName,
  getRoleForSlot,
  getSpawnForSlot,
  getTeamForSlot,
  isLobbyCode,
  normalizeRoomCode,
  sanitizePlayerName,
} from '../../../packages/shared/src/index.ts';
import type {
  BerrySnapshot,
  ClamShellSnapshot,
  ClashEvent,
  ClientInputMessage,
  ClientJoinMessage,
  ClientPingMessage,
  ClientToServerMessage,
  DeathEvent,
  Facing,
  HiveCell,
  InputState,
  JumpEvent,
  LobbyCode,
  LobbyPhase,
  LobbySummary,
  Platform,
  PlayerId,
  PlayerSnapshot,
  RoomPlayer,
  ScoreState,
  ServerToClientMessage,
  SnailSnapshot,
  Team,
  UpgradeGate,
  WinnerState,
  WorldSnapshot,
} from '../../../packages/shared/src/index.ts';

const PORT = Number.parseInt(process.env.GAME_WS_PORT ?? process.env.PORT ?? '8788', 10);
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const FRAME_MAX_BYTES = 32 * 1024;
const TICK_INTERVAL_MS = 1000 / GAME_CONFIG.tickRate;
const SNAPSHOT_INTERVAL_TICKS = Math.max(1, Math.round(GAME_CONFIG.tickRate / GAME_CONFIG.snapshotRate));

type ClientConnection = {
  socket: import('node:net').Socket;
  buffer: Buffer;
  closed: boolean;
  id: PlayerId;
  roomCode: LobbyCode | null;
  input: InputState;
  previousInput: InputState;
  lastInputSeq: number;
  lastMessageAt: number;
};

type PlayerMeta = {
  canDoubleJump: boolean;
};

type DroppedPearl = BerrySnapshot & {
  vx: number;
  vy: number;
};

type GameRoom = {
  roomCode: LobbyCode;
  phase: LobbyPhase;
  clients: Map<PlayerId, ClientConnection>;
  players: Map<PlayerId, PlayerSnapshot>;
  playerMeta: Map<PlayerId, PlayerMeta>;
  droppedPearls: Map<string, DroppedPearl>;
  clamshells: Map<string, ClamShellSnapshot & { respawnTimer: number }>;
  scores: ScoreState;
  queenKills: ScoreState;
  snail: SnailSnapshot;
  snailEatTimer: number;
  upgradeGates: Map<string, UpgradeGate>;
  winner: WinnerState;
  scoreScreenEndsAt: number | null;
  roundStartedAt: number;
  clashEvents: ClashEvent[];
  jumpEvents: JumpEvent[];
  deathEvents: DeathEvent[];
  tick: number;
  createdAt: number;
  lastSnapshotTick: number;
  nextPearlId: number;
};

const connections = new Set<ClientConnection>();

const cloneInput = (input: InputState): InputState => ({
  left: Boolean(input.left),
  right: Boolean(input.right),
  jump: Boolean(input.jump),
  down: Boolean(input.down),
});

const freshScores = (): ScoreState => ({ blue: 0, red: 0 });

const makeInitialClams = (): GameRoom['clamshells'] =>
  new Map(
    GAME_MAP.clamShells.map((clam) => [
      clam.id,
      {
        ...clam,
        pearlsInside: 3,
        respawnTimer: 0,
      },
    ]),
  );

const makeInitialGates = (): Map<string, UpgradeGate> =>
  new Map(GAME_MAP.upgradeGates.map((gate) => [gate.id, { ...gate }]));

const makeInitialSnail = (): SnailSnapshot => ({
  x: GAME_MAP.snail.startX,
  y: GAME_MAP.snail.y,
  riderId: null,
  eatingTargetId: null,
  direction: 0,
  facing: -1,
});

const createGameRoom = (roomCode: LobbyCode): GameRoom => ({
  roomCode,
  phase: 'lobby',
  clients: new Map(),
  players: new Map(),
  playerMeta: new Map(),
  droppedPearls: new Map(),
  clamshells: makeInitialClams(),
  scores: freshScores(),
  queenKills: freshScores(),
  snail: makeInitialSnail(),
  snailEatTimer: 0,
  upgradeGates: makeInitialGates(),
  winner: null,
  scoreScreenEndsAt: null,
  roundStartedAt: Date.now(),
  clashEvents: [],
  jumpEvents: [],
  deathEvents: [],
  tick: 0,
  createdAt: Date.now(),
  lastSnapshotTick: 0,
  nextPearlId: 1,
});

const rooms = new Map<LobbyCode, GameRoom>(LOBBY_CODES.map((roomCode) => [roomCode, createGameRoom(roomCode)]));

const opposingTeam = (team: Team): Team => (team === 'blue' ? 'red' : 'blue');

const getRoomPlayers = (room: GameRoom): RoomPlayer[] =>
  [...room.players.values()]
    .sort((a, b) => a.slot - b.slot)
    .map(({ id, name, slot, team, role, ready, color, connected }) => ({
      id,
      name,
      slot,
      team,
      role,
      ready,
      color,
      connected,
    }));

const hasQueen = (room: GameRoom, team: Team): boolean =>
  [...room.players.values()].some((player) => player.team === team && player.role === 'queen');

const readyCount = (room: GameRoom): number => [...room.players.values()].filter((player) => player.ready).length;

const canStart = (room: GameRoom): boolean =>
  room.phase === 'lobby' &&
  room.players.size > 0 &&
  readyCount(room) === room.players.size &&
  hasQueen(room, 'blue') &&
  hasQueen(room, 'red');

const makeLobbySummary = (room: GameRoom): LobbySummary => ({
  roomCode: room.roomCode,
  name: getLobbyName(room.roomCode),
  phase: room.phase,
  playerCount: room.players.size,
  maxPlayers: GAME_CONFIG.maxPlayers,
  readyCount: readyCount(room),
  hasBlueQueen: hasQueen(room, 'blue'),
  hasRedQueen: hasQueen(room, 'red'),
  winner: room.winner ? { ...room.winner } : null,
  scoreScreenEndsAt: room.scoreScreenEndsAt,
});

const makeLobbyList = (): ServerToClientMessage => ({
  type: 'lobbies',
  lobbies: [...rooms.values()].map(makeLobbySummary),
});

const makeHiveCells = (scores: ScoreState): HiveCell[] => {
  const cells: HiveCell[] = [];

  for (const base of GAME_MAP.bases) {
    for (let i = 0; i < base.slots.length; i += 1) {
      const slot = base.slots[i];
      cells.push({
        id: `${base.team}-cell-${i}`,
        team: base.team,
        x: base.x + slot.x - 12,
        y: base.y + slot.y - 12,
        width: 24,
        height: 24,
        filled: i < scores[base.team],
      });
    }
  }

  return cells;
};

const roomSnapshot = (room: GameRoom) =>
  createRoomSnapshot(
    room.roomCode,
    getRoomPlayers(room),
    room.phase,
    canStart(room),
    readyCount(room),
    room.winner ? { ...room.winner } : null,
    room.scoreScreenEndsAt,
  );

const sendFrame = (socket: import('node:net').Socket, payload: ServerToClientMessage | string): void => {
  if (socket.destroyed) return;

  const data = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let header: Buffer;

  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  socket.write(Buffer.concat([header, data]));
};

const sendClose = (socket: import('node:net').Socket): void => {
  if (!socket.destroyed) {
    socket.end(Buffer.from([0x88, 0x00]));
  }
};

const sendPongFrame = (socket: import('node:net').Socket, payload: Buffer): void => {
  if (payload.length > 125 || socket.destroyed) return;
  socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
};

const parseFrames = (client: ClientConnection, chunk: Buffer): string[] => {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages: string[] = [];

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) break;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) break;
      const bigLength = client.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(FRAME_MAX_BYTES)) {
        throw new Error('Frame too large.');
      }
      length = Number(bigLength);
      offset += 8;
    }

    if (length > FRAME_MAX_BYTES) {
      throw new Error('Frame too large.');
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) break;

    let payload = client.buffer.subarray(offset, offset + length);
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.closed = true;
      sendClose(client.socket);
      break;
    }

    if (opcode === 0x9) {
      sendPongFrame(client.socket, payload);
      continue;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
  }

  return messages;
};

const broadcast = (room: GameRoom, message: ServerToClientMessage): void => {
  room.clients.forEach((client) => sendFrame(client.socket, message));
};

const broadcastLobbyList = (): void => {
  const message = makeLobbyList();
  connections.forEach((client) => sendFrame(client.socket, message));
};

const makeSnapshot = (room: GameRoom, consumeEvents = false): WorldSnapshot => ({
  type: 'snapshot',
  roomCode: room.roomCode,
  tick: room.tick,
  serverTime: Date.now(),
  phase: room.phase,
  timeElapsed: Math.max(0, (Date.now() - room.roundStartedAt) / 1000),
  players: [...room.players.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((player) => ({ ...player })),
  berries: [...room.droppedPearls.values()].map(({ vx: _vx, vy: _vy, ...pearl }) => ({ ...pearl })),
  scores: { ...room.scores },
  queenKills: { ...room.queenKills },
  snail: { ...room.snail },
  hiveCells: makeHiveCells(room.scores),
  clamshells: [...room.clamshells.values()].map(({ respawnTimer: _respawnTimer, ...clam }) => ({ ...clam })),
  upgradeGates: [...room.upgradeGates.values()].map((gate) => ({ ...gate })),
  clashEvents: consumeEvents ? room.clashEvents.splice(0) : [],
  jumpEvents: consumeEvents ? room.jumpEvents.splice(0) : [],
  deathEvents: consumeEvents ? room.deathEvents.splice(0) : [],
  winner: room.winner ? { ...room.winner } : null,
  roundEndsAt: room.scoreScreenEndsAt,
});

const broadcastRoom = (room: GameRoom): void => {
  broadcast(room, { type: 'room', room: roomSnapshot(room) });
  broadcastLobbyList();
};

const resetMatchState = (room: GameRoom): void => {
  room.droppedPearls = new Map();
  room.clamshells = makeInitialClams();
  room.scores = freshScores();
  room.queenKills = freshScores();
  room.snail = makeInitialSnail();
  room.snailEatTimer = 0;
  room.upgradeGates = makeInitialGates();
  room.winner = null;
  room.scoreScreenEndsAt = null;
  room.roundStartedAt = Date.now();
  room.clashEvents = [];
  room.jumpEvents = [];
  room.deathEvents = [];
  room.nextPearlId = 1;
};

const releaseBerry = (player: PlayerSnapshot): void => {
  player.carriedBerryId = null;
};

const placeAtSpawn = (player: PlayerSnapshot): void => {
  const spawn = getSpawnForSlot(player.slot);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.facing = player.team === 'blue' ? 1 : -1;
  player.isGrounded = false;
  player.alive = true;
  player.beingEaten = false;
  player.carriedBerryId = null;
  player.speedBoost = false;
  player.upgradeProgress = 0;
  player.upgradeGateId = null;
  player.invincibleUntil = Date.now() + GAME_CONFIG.player.invincibleMs;
  player.respawnsAt = null;
};

const applySlotToPlayer = (player: PlayerSnapshot, slot: number): void => {
  player.slot = slot;
  player.team = getTeamForSlot(slot);
  player.role = getRoleForSlot(slot);
  player.color = TEAM_COLORS[player.team];
  player.lives = GAME_CONFIG.player.queenLives;
  placeAtSpawn(player);
};

const respawnPlayer = (player: PlayerSnapshot): void => {
  placeAtSpawn(player);
  if (player.role !== 'queen') {
    player.role = 'worker';
  }
};

const removeClientFromRoom = (client: ClientConnection, broadcastChanges = true): void => {
  if (!client.roomCode || !client.id) return;

  const room = rooms.get(client.roomCode);
  if (!room) return;

  const player = room.players.get(client.id);
  if (player) {
    releaseBerry(player);
  }
  if (room.snail.riderId === client.id) room.snail.riderId = null;
  if (room.snail.eatingTargetId === client.id) room.snail.eatingTargetId = null;

  room.clients.delete(client.id);
  room.players.delete(client.id);
  room.playerMeta.delete(client.id);
  client.roomCode = null;
  client.id = '';
  client.input = { ...DEFAULT_INPUT };
  client.previousInput = { ...DEFAULT_INPUT };

  if (room.players.size === 0 && room.phase !== 'lobby') {
    room.phase = 'lobby';
    resetMatchState(room);
  }

  if (broadcastChanges) {
    broadcastRoom(room);
  }
};

const isInputState = (value: unknown): value is InputState => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.left === 'boolean' &&
    typeof input.right === 'boolean' &&
    typeof input.jump === 'boolean' &&
    (typeof input.down === 'boolean' || input.down === undefined)
  );
};

const sendError = (client: ClientConnection, message: string): void => {
  sendFrame(client.socket, { type: 'error', message });
};

const createPlayer = (slot: number, id: PlayerId, name: string): PlayerSnapshot => {
  const spawn = getSpawnForSlot(slot);
  const team = getTeamForSlot(slot);
  const role = getRoleForSlot(slot);

  return {
    id,
    name,
    slot,
    team,
    role,
    ready: false,
    color: TEAM_COLORS[team],
    connected: true,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing: team === 'blue' ? 1 : -1,
    isGrounded: false,
    alive: true,
    carriedBerryId: null,
    speedBoost: false,
    lives: GAME_CONFIG.player.queenLives,
    beingEaten: false,
    upgradeProgress: 0,
    upgradeGateId: null,
    invincibleUntil: Date.now() + GAME_CONFIG.player.invincibleMs,
    respawnsAt: null,
    lastInputSeq: 0,
  };
};

const getFirstOpenSlot = (room: GameRoom): number | null => {
  const usedSlots = new Set([...room.players.values()].map((player) => player.slot));
  for (let slot = 0; slot < GAME_CONFIG.maxPlayers; slot += 1) {
    if (!usedSlots.has(slot)) return slot;
  }
  return null;
};

const startGameIfReady = (room: GameRoom): void => {
  if (!canStart(room)) return;

  room.phase = 'playing';
  resetMatchState(room);
  for (const player of room.players.values()) {
    player.role = getRoleForSlot(player.slot);
    player.lives = GAME_CONFIG.player.queenLives;
    player.ready = true;
    placeAtSpawn(player);
    room.playerMeta.set(player.id, { canDoubleJump: false });
  }
  broadcastRoom(room);
  broadcast(room, makeSnapshot(room));
};

const handleJoin = (client: ClientConnection, message: ClientJoinMessage): void => {
  const normalized = normalizeRoomCode(message.roomCode ?? 'LOBBY1');

  if (!isLobbyCode(normalized)) {
    sendError(client, 'Choose one of the three open lobbies.');
    sendFrame(client.socket, makeLobbyList());
    return;
  }

  const room = rooms.get(normalized);
  if (!room) {
    sendError(client, 'Lobby is unavailable.');
    return;
  }

  if (room.phase !== 'lobby') {
    sendError(client, `${getLobbyName(room.roomCode)} is in a game. Choose another lobby or wait for the score screen to end.`);
    sendFrame(client.socket, makeLobbyList());
    return;
  }

  if (client.roomCode) {
    removeClientFromRoom(client);
  }

  const slot = getFirstOpenSlot(room);
  if (slot === null) {
    sendError(client, `${getLobbyName(room.roomCode)} is full.`);
    return;
  }

  const id = randomUUID();
  const name = sanitizePlayerName(message.name, `P${slot + 1}`);
  const player = createPlayer(slot, id, name);

  client.id = id;
  client.roomCode = room.roomCode;
  client.input = { ...DEFAULT_INPUT };
  client.previousInput = { ...DEFAULT_INPUT };
  client.lastInputSeq = 0;
  client.lastMessageAt = Date.now();
  room.clients.set(id, client);
  room.players.set(id, player);
  room.playerMeta.set(id, { canDoubleJump: false });

  sendFrame(client.socket, {
    type: 'joined',
    protocolVersion: GAME_CONFIG.protocolVersion,
    you: id,
    room: roomSnapshot(room),
    snapshot: makeSnapshot(room),
  });
  broadcastRoom(room);
};

const handleMoveSlot = (client: ClientConnection, requestedSlot: unknown): void => {
  if (!client.roomCode || !client.id) {
    sendError(client, 'Join a lobby before choosing a slot.');
    return;
  }

  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  const slot = Number(requestedSlot);

  if (!room || !player) {
    sendError(client, 'Player is no longer in a lobby.');
    return;
  }

  if (room.phase !== 'lobby') {
    sendError(client, 'Slots can only be changed in the lobby.');
    return;
  }

  if (!Number.isInteger(slot) || slot < 0 || slot >= GAME_CONFIG.maxPlayers) {
    sendError(client, 'Invalid slot.');
    return;
  }

  const occupied = [...room.players.values()].some((candidate) => candidate.slot === slot && candidate.id !== player.id);
  if (occupied) {
    sendError(client, 'That slot is already occupied.');
    return;
  }

  applySlotToPlayer(player, slot);
  player.ready = false;
  broadcastRoom(room);
};

const handleSetReady = (client: ClientConnection, ready: unknown): void => {
  if (!client.roomCode || !client.id) {
    sendError(client, 'Join a lobby before readying up.');
    return;
  }

  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (!room || !player) {
    sendError(client, 'Player is no longer in a lobby.');
    return;
  }

  if (room.phase !== 'lobby') return;

  player.ready = Boolean(ready);
  broadcastRoom(room);
  startGameIfReady(room);
};

const handleInput = (client: ClientConnection, message: ClientInputMessage): void => {
  if (!client.roomCode || !client.id) return;

  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);
  if (!room || !player || room.phase !== 'playing') return;

  if (!isInputState(message.input)) {
    sendError(client, 'Invalid input payload.');
    return;
  }

  client.input = cloneInput({ ...DEFAULT_INPUT, ...message.input });
  client.lastInputSeq = Number.isFinite(message.seq) ? Math.max(0, Math.floor(message.seq)) : client.lastInputSeq;
  client.lastMessageAt = Date.now();
  player.lastInputSeq = client.lastInputSeq;
};

const handlePing = (client: ClientConnection, message: ClientPingMessage): void => {
  const clientTime = Number.isFinite(message.clientTime) ? message.clientTime : 0;
  sendFrame(client.socket, { type: 'pong', clientTime, serverTime: Date.now() });
};

const handleMessage = (client: ClientConnection, raw: string): void => {
  let message: ClientToServerMessage;

  try {
    message = JSON.parse(raw) as ClientToServerMessage;
  } catch {
    sendError(client, 'Invalid JSON message.');
    return;
  }

  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    sendError(client, 'Invalid message.');
    return;
  }

  if (message.type === 'join') {
    handleJoin(client, message);
  } else if (message.type === 'moveSlot') {
    handleMoveSlot(client, message.slot);
  } else if (message.type === 'setReady') {
    handleSetReady(client, message.ready);
  } else if (message.type === 'leaveLobby') {
    removeClientFromRoom(client);
    sendFrame(client.socket, makeLobbyList());
  } else if (message.type === 'input') {
    handleInput(client, message);
  } else if (message.type === 'ping') {
    handlePing(client, message);
  } else {
    sendError(client, `Unsupported message type: ${(message as { type: string }).type}`);
  }
};

const playerRect = (player: PlayerSnapshot) => ({
  x: player.x,
  y: player.y,
  width: GAME_CONFIG.player.width,
  height: GAME_CONFIG.player.height,
});

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const platformLanding = (player: PlayerSnapshot, platform: Platform): boolean =>
  player.x + GAME_CONFIG.player.width > platform.x &&
  player.x < platform.x + platform.width &&
  player.y + GAME_CONFIG.player.height >= platform.y &&
  player.y + GAME_CONFIG.player.height - player.vy <= platform.y + 8;

const checkGround = (room: GameRoom, player: PlayerSnapshot): boolean => {
  for (const platform of GAME_MAP.platforms) {
    if (
      player.x + GAME_CONFIG.player.width > platform.x &&
      player.x < platform.x + platform.width &&
      Math.abs(player.y + GAME_CONFIG.player.height - platform.y) < 4 &&
      player.vy >= 0
    ) {
      return true;
    }
  }

  return (
    player.x + GAME_CONFIG.player.width > room.snail.x &&
    player.x < room.snail.x + GAME_MAP.snail.width &&
    Math.abs(player.y + GAME_CONFIG.player.height - room.snail.y) < 4 &&
    player.vy >= 0
  );
};

const setWinner = (room: GameRoom, team: Team, reason: NonNullable<WinnerState>['reason']): void => {
  if (room.winner || room.phase !== 'playing') return;
  const now = Date.now();
  room.phase = 'score';
  room.winner = { team, reason, decidedAt: now };
  room.scoreScreenEndsAt = now + GAME_CONFIG.objective.scoreScreenMs;
  broadcastRoom(room);
};

const killPlayer = (
  room: GameRoom,
  victim: PlayerSnapshot,
  killerTeam: Team | null,
  now: number,
  queenDeath = true,
  ignoreInvincible = false,
): void => {
  if (!victim.alive || (!ignoreInvincible && victim.invincibleUntil > now) || (killerTeam !== null && victim.team === killerTeam)) return;

  room.deathEvents.push({
    x: victim.x + GAME_CONFIG.player.width / 2,
    y: victim.y + GAME_CONFIG.player.height / 2,
    team: victim.team,
  });

  releaseBerry(victim);
  if (room.snail.riderId === victim.id) room.snail.riderId = null;
  if (room.snail.eatingTargetId === victim.id) room.snail.eatingTargetId = null;

  victim.alive = false;
  victim.beingEaten = false;
  victim.vx = 0;
  victim.vy = 0;
  victim.respawnsAt = now + GAME_CONFIG.player.respawnDelayMs;
  victim.upgradeProgress = 0;
  victim.upgradeGateId = null;

  if (victim.role === 'queen' && queenDeath) {
    victim.lives -= 1;
    room.queenKills[victim.team] = GAME_CONFIG.player.queenLives - victim.lives;
    if (victim.lives <= 0) {
      setWinner(room, opposingTeam(victim.team), 'military');
    }
  } else {
    victim.role = 'worker';
    victim.speedBoost = false;
  }
};

const simulatePlayer = (room: GameRoom, player: PlayerSnapshot, client: ClientConnection, now: number): void => {
  const meta = room.playerMeta.get(player.id) ?? { canDoubleJump: false };
  room.playerMeta.set(player.id, meta);

  if (!player.alive) {
    if (player.respawnsAt !== null && now >= player.respawnsAt) {
      respawnPlayer(player);
    }
    return;
  }

  if (player.beingEaten) {
    player.vx = 0;
    player.vy = 0;
    client.previousInput = cloneInput(client.input);
    return;
  }

  if (player.invincibleUntil > 0 && now >= player.invincibleUntil) {
    player.invincibleUntil = 0;
  }

  const ridingManatee = room.snail.riderId === player.id;
  const previousJump = client.previousInput.jump;
  const jumpPressed = client.input.jump;
  const jumpJustPressed = jumpPressed && !previousJump;
  const onGround = checkGround(room, player);
  let jumped = false;

  if (onGround) meta.canDoubleJump = true;

  if (!ridingManatee) {
    const currentSpeed = player.speedBoost ? GAME_CONFIG.player.maxSpeed * GAME_CONFIG.player.speedBoostMultiplier : GAME_CONFIG.player.maxSpeed;
    if (client.input.left) {
      player.vx = -currentSpeed;
      player.facing = -1;
    } else if (client.input.right) {
      player.vx = currentSpeed;
      player.facing = 1;
    } else {
      player.vx = 0;
    }
  }

  if (jumpJustPressed) {
    if (ridingManatee) {
      if (!room.snail.eatingTargetId) {
        room.snail.riderId = null;
        player.vy = -GAME_CONFIG.player.jumpVelocity;
        jumped = true;
      }
    } else if (player.role === 'warrior' || player.role === 'queen') {
      player.vy = -GAME_CONFIG.player.flapVelocity;
      jumped = true;
    } else if (onGround) {
      player.vy = -GAME_CONFIG.player.jumpVelocity;
      jumped = true;
    } else if (meta.canDoubleJump) {
      player.vy = -(GAME_CONFIG.player.jumpVelocity * 0.7);
      meta.canDoubleJump = false;
      jumped = true;
    }
  } else if (!jumpPressed && previousJump && player.vy < 0 && player.role === 'worker') {
    player.vy *= 0.4;
  }

  if (jumped) {
    room.jumpEvents.push({
      x: player.x + GAME_CONFIG.player.width / 2,
      y: player.y + GAME_CONFIG.player.height,
      team: player.team,
    });
  }

  client.previousInput = cloneInput(client.input);

  if (room.snail.riderId === player.id) {
    player.y = room.snail.y - GAME_CONFIG.player.height;
    player.x = room.snail.x + GAME_MAP.snail.width / 2 - GAME_CONFIG.player.width / 2;
    player.vx = 0;
    player.vy = 0;
    meta.canDoubleJump = true;
    return;
  }

  if (player.role === 'queen' && client.input.down) {
    player.vy = Math.min(player.vy + GAME_CONFIG.player.gravity * 4, 18);
  } else {
    player.vy = Math.min(player.vy + GAME_CONFIG.player.gravity, GAME_CONFIG.player.terminalVelocity);
  }

  player.x += player.vx;
  player.y += player.vy;

  if (player.vy > 0) {
    for (const platform of GAME_MAP.platforms) {
      if (platformLanding(player, platform)) {
        player.y = platform.y - GAME_CONFIG.player.height;
        player.vy = 0;
        break;
      }
    }
  }

  if (player.x > GAME_MAP.width) player.x = -GAME_CONFIG.player.width;
  if (player.x + GAME_CONFIG.player.width < 0) player.x = GAME_MAP.width;
  if (player.y < 0) {
    player.y = 0;
    player.vy = 0;
  }

  player.isGrounded = checkGround(room, player);
};

const spawnDroppedPearl = (room: GameRoom, x: number, y: number): void => {
  const id = `drop-${room.nextPearlId++}`;
  room.droppedPearls.set(id, {
    id,
    x,
    y,
    spawnX: x,
    spawnY: y,
    carriedBy: null,
    depositedTeam: null,
    vx: (Math.random() - 0.5) * 6,
    vy: -6,
  });
};

const updateManatee = (room: GameRoom): void => {
  room.snail.y = GAME_MAP.snail.y + Math.sin(room.tick / 24) * 12;

  const rider = room.snail.riderId ? room.players.get(room.snail.riderId) : null;
  if (rider) {
    room.snail.facing = rider.team === 'red' ? 1 : -1;
  }

  const target = room.snail.eatingTargetId ? room.players.get(room.snail.eatingTargetId) : null;
  if (target) {
    room.snailEatTimer -= 1;
    const mouthX = room.snail.facing > 0 ? room.snail.x + GAME_MAP.snail.width - 15 : room.snail.x - 15;
    target.x = mouthX;
    target.y = room.snail.y + 15;

    if (room.snailEatTimer <= 0) {
      if (target.carriedBerryId) {
        spawnDroppedPearl(room, mouthX, room.snail.y - 10);
      }
      target.carriedBerryId = null;
      target.beingEaten = false;
      killPlayer(room, target, null, Date.now(), false, true);
      room.snail.eatingTargetId = null;
    }
    return;
  }

  if (!rider || !rider.alive || rider.beingEaten || rider.role !== 'worker') {
    room.snail.riderId = null;
    room.snail.direction = 0;
    return;
  }

  const currentSpeed = rider.speedBoost ? GAME_CONFIG.objective.snailSpeed * 2 : GAME_CONFIG.objective.snailSpeed;
  room.snail.direction = rider.team === 'blue' ? -1 : 1;
  room.snail.x += room.snail.direction * currentSpeed;
  rider.x = room.snail.x + GAME_MAP.snail.width / 2 - GAME_CONFIG.player.width / 2;
  rider.y = room.snail.y - GAME_CONFIG.player.height;
  rider.vx = 0;
  rider.vy = 0;

  if (room.snail.x <= GAME_MAP.snail.blueGoalX) {
    setWinner(room, 'blue', 'manatee');
  } else if (room.snail.x + GAME_MAP.snail.width >= GAME_MAP.snail.redGoalX) {
    setWinner(room, 'red', 'manatee');
  }
};

const updateClams = (room: GameRoom): void => {
  for (const clam of room.clamshells.values()) {
    if (clam.pearlsInside >= 3) continue;
    clam.respawnTimer -= 1;
    if (clam.respawnTimer <= 0) {
      clam.pearlsInside += 1;
      if (clam.pearlsInside < 3) {
        clam.respawnTimer = GAME_CONFIG.objective.clamRespawnTicks;
      }
    }
  }
};

const updateDroppedPearls = (room: GameRoom): void => {
  for (const pearl of room.droppedPearls.values()) {
    pearl.vy = Math.min(pearl.vy + GAME_CONFIG.objective.droppedPearlGravity, GAME_CONFIG.player.terminalVelocity);
    pearl.x += pearl.vx;
    pearl.y += pearl.vy;

    if (pearl.vy > 0) {
      for (const platform of GAME_MAP.platforms) {
        if (
          pearl.x + 20 > platform.x &&
          pearl.x < platform.x + platform.width &&
          pearl.y + 20 >= platform.y &&
          pearl.y + 20 - pearl.vy <= platform.y + 8
        ) {
          pearl.y = platform.y - 20;
          pearl.vy = 0;
          pearl.vx *= 0.8;
          break;
        }
      }
    }

    if (pearl.y > 1020 - 20) {
      pearl.y = 1020 - 20;
      pearl.vy = 0;
      pearl.vx *= 0.8;
    }
    if (pearl.x > GAME_MAP.width) pearl.x = -20;
    if (pearl.x + 20 < 0) pearl.x = GAME_MAP.width;
  }
};

const canAttack = (player: PlayerSnapshot): boolean => player.alive && (player.role === 'queen' || player.role === 'warrior');

const processCombat = (room: GameRoom, now: number): void => {
  const players = [...room.players.values()].filter((player) => player.alive && !player.beingEaten);

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (a.team === b.team || !rectsOverlap(playerRect(a), playerRect(b))) continue;

      const aCombat = canAttack(a);
      const bCombat = canAttack(b);
      const aVerticalKill = a.y < b.y - 16 && a.vy > 0;
      const bVerticalKill = b.y < a.y - 16 && b.vy > 0;
      const aFrontalKill = (a.facing === 1 && a.x < b.x) || (a.facing === -1 && a.x > b.x);
      const bFrontalKill = (b.facing === 1 && b.x < a.x) || (b.facing === -1 && b.x > a.x);

      if (aCombat && bCombat) {
        const aHorizontalKill = a.facing === b.facing && aFrontalKill;
        const bHorizontalKill = b.facing === a.facing && bFrontalKill;
        if (aVerticalKill && !bVerticalKill) {
          killPlayer(room, b, a.team, now);
          a.vy = -GAME_CONFIG.player.flapVelocity;
        } else if (bVerticalKill && !aVerticalKill) {
          killPlayer(room, a, b.team, now);
          b.vy = -GAME_CONFIG.player.flapVelocity;
        } else if (aHorizontalKill && !bHorizontalKill) {
          killPlayer(room, b, a.team, now);
        } else if (bHorizontalKill && !aHorizontalKill) {
          killPlayer(room, a, b.team, now);
        } else {
          a.vx = a.x < b.x ? -GAME_CONFIG.player.maxSpeed * 2.5 : GAME_CONFIG.player.maxSpeed * 2.5;
          b.vx = b.x < a.x ? -GAME_CONFIG.player.maxSpeed * 2.5 : GAME_CONFIG.player.maxSpeed * 2.5;
          a.x += a.vx;
          b.x += b.vx;
          room.clashEvents.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      } else if (aCombat) {
        if (aVerticalKill || aFrontalKill) killPlayer(room, b, a.team, now);
      } else if (bCombat) {
        if (bVerticalKill || bFrontalKill) killPlayer(room, a, b.team, now);
      } else {
        a.vx = a.x < b.x ? -GAME_CONFIG.player.maxSpeed * 1.5 : GAME_CONFIG.player.maxSpeed * 1.5;
        b.vx = b.x < a.x ? -GAME_CONFIG.player.maxSpeed * 1.5 : GAME_CONFIG.player.maxSpeed * 1.5;
        a.x += a.vx;
        b.x += b.vx;
      }
    }
  }
};

const processInteractions = (room: GameRoom, now: number): void => {
  const snailRect = { x: room.snail.x, y: room.snail.y, width: GAME_MAP.snail.width, height: GAME_MAP.snail.height };

  for (const player of room.players.values()) {
    if (!player.alive || player.beingEaten) continue;

    if (player.role === 'worker' && rectsOverlap(playerRect(player), snailRect)) {
      if (!room.snail.riderId && player.vy >= 0 && player.y + GAME_CONFIG.player.height < room.snail.y + 24) {
        room.snail.riderId = player.id;
      } else if (room.snail.riderId && room.players.get(room.snail.riderId)?.team !== player.team && !room.snail.eatingTargetId) {
        room.snail.eatingTargetId = player.id;
        room.snailEatTimer = player.carriedBerryId ? 195 : 165;
        player.beingEaten = true;
      }
    }

    if (player.role === 'worker' && !player.carriedBerryId) {
      for (const clam of room.clamshells.values()) {
        if (clam.pearlsInside > 0 && rectsOverlap(playerRect(player), { x: clam.x, y: clam.y, width: 50, height: 30 })) {
          clam.pearlsInside -= 1;
          if (clam.respawnTimer <= 0) clam.respawnTimer = GAME_CONFIG.objective.clamRespawnTicks;
          player.carriedBerryId = 'held';
          break;
        }
      }

      if (!player.carriedBerryId) {
        for (const [id, pearl] of room.droppedPearls.entries()) {
          if (rectsOverlap(playerRect(player), { x: pearl.x, y: pearl.y, width: 20, height: 20 })) {
            player.carriedBerryId = 'held';
            room.droppedPearls.delete(id);
            break;
          }
        }
      }
    }

    let touchingGate = false;
    for (const gate of room.upgradeGates.values()) {
      if (!rectsOverlap(playerRect(player), { x: gate.x, y: gate.y, width: gate.width, height: gate.height })) continue;

      if (player.role === 'worker' && player.carriedBerryId && gate.ownerTeam === player.team) {
        touchingGate = true;
        if (Math.abs(player.vx) < 0.1) {
          player.upgradeProgress += 1;
          player.upgradeGateId = gate.id;
          if (player.upgradeProgress >= GAME_CONFIG.objective.upgradeTicks) {
            player.carriedBerryId = null;
            if (gate.type === 'warrior') {
              player.role = 'warrior';
              player.speedBoost = false;
            } else {
              player.role = 'worker';
              player.speedBoost = true;
            }
            player.upgradeProgress = 0;
            player.upgradeGateId = null;
          }
        } else {
          player.upgradeProgress = 0;
          player.upgradeGateId = null;
        }
      } else if (player.role === 'queen' && gate.ownerTeam !== player.team) {
        touchingGate = true;
        if (Math.abs(player.vx) < 0.1) {
          player.upgradeProgress += 1;
          player.upgradeGateId = gate.id;
          if (player.upgradeProgress >= GAME_CONFIG.objective.upgradeTicks) {
            gate.ownerTeam = player.team;
            player.upgradeProgress = 0;
            player.upgradeGateId = null;
          }
        } else {
          player.upgradeProgress = 0;
          player.upgradeGateId = null;
        }
      }
    }
    if (!touchingGate) {
      player.upgradeProgress = 0;
      player.upgradeGateId = null;
    }

    if (player.carriedBerryId) {
      for (const base of GAME_MAP.bases) {
        if (base.team === player.team && rectsOverlap(playerRect(player), { x: base.x, y: base.y, width: base.width, height: base.height })) {
          player.carriedBerryId = null;
          room.scores[player.team] += 1;
          if (room.scores[player.team] >= GAME_CONFIG.objective.berriesToWin) {
            setWinner(room, player.team, 'economic');
          }
        }
      }
    }
  }

  processCombat(room, now);
};

const returnToLobby = (room: GameRoom): void => {
  room.phase = 'lobby';
  resetMatchState(room);
  for (const player of room.players.values()) {
    player.ready = false;
    player.role = getRoleForSlot(player.slot);
    player.lives = GAME_CONFIG.player.queenLives;
    placeAtSpawn(player);
  }
  broadcastRoom(room);
  broadcast(room, makeSnapshot(room));
};

const tickRoom = (room: GameRoom): void => {
  const now = Date.now();

  if (room.phase === 'score') {
    if (room.scoreScreenEndsAt !== null && now >= room.scoreScreenEndsAt) {
      returnToLobby(room);
      return;
    }
  } else if (room.phase === 'playing') {
    room.players.forEach((player, playerId) => {
      const client = room.clients.get(playerId);
      if (client) simulatePlayer(room, player, client, now);
    });
    updateManatee(room);
    updateClams(room);
    updateDroppedPearls(room);
    processInteractions(room, now);
  }

  room.tick += 1;

  if (room.phase !== 'lobby' && room.tick - room.lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
    room.lastSnapshotTick = room.tick;
    broadcast(room, makeSnapshot(room, true));
  }
};

export const createGameServer = () => {
  const rippleWorld = createRippleWorld();
  const solarWorld = createSolarWorld();
  const coasterWorld = createCoasterWorld();
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');

    if (request.url === '/health') {
      const players = [...rooms.values()].reduce((total, room) => total + room.players.size, 0);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          lobbies: [...rooms.values()].map(makeLobbySummary),
          rooms: rooms.size,
          players,
        }),
      );
      return;
    }

    if (request.url === '/solar/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(solarWorld.health()));
      return;
    }

    if (request.url === '/ripples/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(rippleWorld.health()));
      return;
    }

    if (request.url === '/coaster/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(coasterWorld.health()));
      return;
    }

    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('Use a WebSocket connection for Manatee Royale, Orbitals, or Ripple Tank.');
  });

  const loop = setInterval(() => {
    rooms.forEach((room) => tickRoom(room));
  }, TICK_INTERVAL_MS);

  server.on('close', () => {
    clearInterval(loop);
    rippleWorld.close();
    solarWorld.close();
    coasterWorld.close();
  });

  server.on('upgrade', (request, socket) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }

      const netSocket = socket as Socket;
      const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
      netSocket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );
      netSocket.setNoDelay(true);

      if (url.pathname === '/solar' || url.pathname === '/solar/') {
        solarWorld.accept(netSocket);
        return;
      }

      if (url.pathname === '/ripples' || url.pathname === '/ripples/') {
        rippleWorld.accept(netSocket, url.searchParams.get('room') ?? undefined);
        return;
      }

      if (url.pathname === '/coaster' || url.pathname === '/coaster/') {
        coasterWorld.accept(netSocket);
        return;
      }

      const client: ClientConnection = {
        socket: netSocket,
        buffer: Buffer.alloc(0),
        closed: false,
        id: '',
        roomCode: null,
        input: { ...DEFAULT_INPUT },
        previousInput: { ...DEFAULT_INPUT },
        lastInputSeq: 0,
        lastMessageAt: Date.now(),
      };

      connections.add(client);
      sendFrame(netSocket, makeLobbyList());

      netSocket.on('data', (chunk) => {
        try {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          parseFrames(client, data).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendError(client, error instanceof Error ? error.message : 'Socket parse error.');
          netSocket.destroy();
        }
      });

      netSocket.on('close', () => {
        removeClientFromRoom(client);
        connections.delete(client);
      });
      netSocket.on('error', () => {
        removeClientFromRoom(client);
        connections.delete(client);
      });
    } catch {
      socket.destroy();
    }
  });

  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGameServer();
  server.listen(PORT, () => {
    console.log(`Manatee Royale game server listening on ws://localhost:${PORT}`);
  });
}
