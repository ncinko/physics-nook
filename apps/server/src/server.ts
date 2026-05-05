import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_INPUT,
  GAME_CONFIG,
  GAME_MAP,
  clamp,
  createRoomSnapshot,
  getColorForSlot,
  getSpawnForSlot,
  getTeamForSlot,
  normalizeRoomCode,
  sanitizePlayerName,
} from '../../../packages/shared/src/index.ts';
import type {
  ClientInputMessage,
  ClientJoinMessage,
  ClientPingMessage,
  ClientToServerMessage,
  InputState,
  Platform,
  PlayerId,
  PlayerSnapshot,
  RoomPlayer,
  ServerToClientMessage,
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
  roomCode: string | null;
  input: InputState;
  previousInput: InputState;
  lastInputSeq: number;
  lastMessageAt: number;
};

type GameRoom = {
  roomCode: string;
  clients: Map<PlayerId, ClientConnection>;
  players: Map<PlayerId, PlayerSnapshot>;
  tick: number;
  createdAt: number;
  lastSnapshotTick: number;
};

const rooms = new Map<string, GameRoom>();

const cloneInput = (input: InputState): InputState => ({
  left: Boolean(input.left),
  right: Boolean(input.right),
  jump: Boolean(input.jump),
});

const getRoomPlayers = (room: GameRoom): RoomPlayer[] =>
  [...room.players.values()]
    .sort((a, b) => a.slot - b.slot)
    .map(({ id, name, slot, team, color, connected }) => ({ id, name, slot, team, color, connected }));

const getRoom = (roomCode: string): GameRoom => {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const existing = rooms.get(normalizedRoomCode);

  if (existing) {
    return existing;
  }

  const room: GameRoom = {
    roomCode: normalizedRoomCode,
    clients: new Map(),
    players: new Map(),
    tick: 0,
    createdAt: Date.now(),
    lastSnapshotTick: 0,
  };
  rooms.set(normalizedRoomCode, room);
  return room;
};

const getFirstOpenSlot = (room: GameRoom): number | null => {
  const usedSlots = new Set([...room.players.values()].map((player) => player.slot));

  for (let slot = 0; slot < GAME_CONFIG.maxPlayers; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }

  return null;
};

const sendFrame = (socket: import('node:net').Socket, payload: ServerToClientMessage | string): void => {
  if (socket.destroyed) {
    return;
  }

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
  if (payload.length > 125 || socket.destroyed) {
    return;
  }

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
    if (masked) {
      offset += 4;
    }

    if (client.buffer.length < offset + length) {
      break;
    }

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

const makeSnapshot = (room: GameRoom): WorldSnapshot => ({
  type: 'snapshot',
  roomCode: room.roomCode,
  tick: room.tick,
  serverTime: Date.now(),
  players: [...room.players.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((player) => ({ ...player })),
});

const broadcastRoom = (room: GameRoom): void => {
  broadcast(room, {
    type: 'room',
    room: createRoomSnapshot(room.roomCode, getRoomPlayers(room)),
  });
};

const removeClient = (client: ClientConnection): void => {
  if (!client.roomCode || !client.id) {
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) {
    return;
  }

  room.clients.delete(client.id);
  room.players.delete(client.id);
  broadcastRoom(room);

  if (room.clients.size === 0) {
    rooms.delete(room.roomCode);
  }

  client.roomCode = null;
  client.id = '';
};

const isInputState = (value: unknown): value is InputState => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const input = value as Record<string, unknown>;
  return typeof input.left === 'boolean' && typeof input.right === 'boolean' && typeof input.jump === 'boolean';
};

const sendError = (client: ClientConnection, message: string): void => {
  sendFrame(client.socket, { type: 'error', message });
};

const handleJoin = (client: ClientConnection, message: ClientJoinMessage): void => {
  if (client.roomCode) {
    removeClient(client);
  }

  const room = getRoom(message.roomCode ?? 'ARENA');
  const slot = getFirstOpenSlot(room);

  if (slot === null) {
    sendError(client, `Room ${room.roomCode} is full.`);
    sendClose(client.socket);
    return;
  }

  const spawn = getSpawnForSlot(slot);
  const id = randomUUID();
  const name = sanitizePlayerName(message.name, `Player ${slot + 1}`);
  const team = getTeamForSlot(slot);
  const player: PlayerSnapshot = {
    id,
    name,
    slot,
    team,
    color: getColorForSlot(slot),
    connected: true,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing: team === 'gold' ? 1 : -1,
    isGrounded: false,
    lastInputSeq: 0,
  };

  client.id = id;
  client.roomCode = room.roomCode;
  client.input = { ...DEFAULT_INPUT };
  client.previousInput = { ...DEFAULT_INPUT };
  client.lastInputSeq = 0;
  client.lastMessageAt = Date.now();
  room.clients.set(id, client);
  room.players.set(id, player);

  sendFrame(client.socket, {
    type: 'joined',
    protocolVersion: GAME_CONFIG.protocolVersion,
    you: id,
    room: createRoomSnapshot(room.roomCode, getRoomPlayers(room)),
    snapshot: makeSnapshot(room),
  });
  broadcastRoom(room);
};

const handleInput = (client: ClientConnection, message: ClientInputMessage): void => {
  if (!client.roomCode || !client.id) {
    sendError(client, 'Join a room before sending input.');
    return;
  }

  const room = rooms.get(client.roomCode);
  const player = room?.players.get(client.id);

  if (!room || !player) {
    sendError(client, 'Player is no longer in a room.');
    return;
  }

  if (!isInputState(message.input)) {
    sendError(client, 'Invalid input payload.');
    return;
  }

  client.input = cloneInput(message.input);
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
    return;
  }

  if (message.type === 'input') {
    handleInput(client, message);
    return;
  }

  if (message.type === 'ping') {
    handlePing(client, message);
    return;
  }

  sendError(client, `Unsupported message type: ${(message as { type: string }).type}`);
};

const moveToward = (value: number, target: number, maxDelta: number): number => {
  if (value < target) {
    return Math.min(value + maxDelta, target);
  }

  if (value > target) {
    return Math.max(value - maxDelta, target);
  }

  return target;
};

const overlaps = (player: PlayerSnapshot, platform: Platform): boolean => {
  const halfWidth = GAME_CONFIG.player.width / 2;
  const halfHeight = GAME_CONFIG.player.height / 2;

  return (
    player.x + halfWidth > platform.x &&
    player.x - halfWidth < platform.x + platform.width &&
    player.y + halfHeight > platform.y &&
    player.y - halfHeight < platform.y + platform.height
  );
};

const collideHorizontal = (player: PlayerSnapshot, previousX: number, platform: Platform): void => {
  const halfWidth = GAME_CONFIG.player.width / 2;

  if (player.x > previousX) {
    player.x = platform.x - halfWidth;
  } else if (player.x < previousX) {
    player.x = platform.x + platform.width + halfWidth;
  }

  player.vx = 0;
};

const collideVertical = (player: PlayerSnapshot, previousY: number, platform: Platform): void => {
  const halfHeight = GAME_CONFIG.player.height / 2;

  if (player.y > previousY) {
    player.y = platform.y - halfHeight;
    player.isGrounded = true;
  } else if (player.y < previousY) {
    player.y = platform.y + platform.height + halfHeight;
  }

  player.vy = 0;
};

const resolveAxis = (player: PlayerSnapshot, amount: number, axis: 'x' | 'y'): void => {
  const previous = player[axis];
  player[axis] += amount;

  for (const platform of GAME_MAP.platforms) {
    if (!overlaps(player, platform)) {
      continue;
    }

    if (axis === 'x') {
      collideHorizontal(player, previous, platform);
    } else {
      collideVertical(player, previous, platform);
    }
  }
};

const respawnPlayer = (player: PlayerSnapshot): void => {
  const spawn = getSpawnForSlot(player.slot);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.isGrounded = false;
};

const simulatePlayer = (player: PlayerSnapshot, client: ClientConnection, dt: number): void => {
  const direction = Number(client.input.right) - Number(client.input.left);
  const acceleration = player.isGrounded ? GAME_CONFIG.player.groundAcceleration : GAME_CONFIG.player.airAcceleration;
  const targetVx = direction * GAME_CONFIG.player.maxSpeed;

  if (direction !== 0) {
    player.vx = moveToward(player.vx, targetVx, acceleration * dt);
    player.facing = direction > 0 ? 1 : -1;
  } else {
    const drag = player.isGrounded ? GAME_CONFIG.player.friction : GAME_CONFIG.player.friction * 0.22;
    player.vx = moveToward(player.vx, 0, drag * dt);
  }

  if (client.input.jump && !client.previousInput.jump && player.isGrounded) {
    player.vy = -GAME_CONFIG.player.jumpVelocity;
    player.isGrounded = false;
  }

  client.previousInput = cloneInput(client.input);
  player.vy = clamp(
    player.vy + GAME_CONFIG.player.gravity * dt,
    -GAME_CONFIG.player.terminalVelocity,
    GAME_CONFIG.player.terminalVelocity,
  );

  player.isGrounded = false;
  resolveAxis(player, player.vx * dt, 'x');
  resolveAxis(player, player.vy * dt, 'y');

  player.x = clamp(player.x, GAME_CONFIG.player.width / 2, GAME_MAP.width - GAME_CONFIG.player.width / 2);

  if (player.y > GAME_MAP.height + 240) {
    respawnPlayer(player);
  }
};

const tickRoom = (room: GameRoom): void => {
  const dt = 1 / GAME_CONFIG.tickRate;

  room.players.forEach((player, playerId) => {
    const client = room.clients.get(playerId);
    if (client) {
      simulatePlayer(player, client, dt);
    }
  });

  room.tick += 1;

  if (room.tick - room.lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
    room.lastSnapshotTick = room.tick;
    broadcast(room, makeSnapshot(room));
  }
};

export const createGameServer = () => {
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');

    if (request.url === '/health') {
      const players = [...rooms.values()].reduce((total, room) => total + room.players.size, 0);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
      return;
    }

    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('Use a WebSocket connection for Physics Nook Arena.');
  });

  const loop = setInterval(() => {
    rooms.forEach((room) => tickRoom(room));
  }, TICK_INTERVAL_MS);

  server.on('close', () => clearInterval(loop));

  server.on('upgrade', (request, socket) => {
    try {
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }

      const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );
      socket.setNoDelay(true);

      const client: ClientConnection = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        id: '',
        roomCode: null,
        input: { ...DEFAULT_INPUT },
        previousInput: { ...DEFAULT_INPUT },
        lastInputSeq: 0,
        lastMessageAt: Date.now(),
      };

      socket.on('data', (chunk) => {
        try {
          parseFrames(client, chunk).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendError(client, error instanceof Error ? error.message : 'Socket parse error.');
          socket.destroy();
        }
      });

      socket.on('close', () => removeClient(client));
      socket.on('error', () => removeClient(client));
    } catch {
      socket.destroy();
    }
  });

  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGameServer();
  server.listen(PORT, () => {
    console.log(`Physics Nook game server listening on ws://localhost:${PORT}`);
  });
}
