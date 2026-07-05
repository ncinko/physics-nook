import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COASTER_BOARD_RADII,
  COASTER_DEFAULT_BOARD_RADIUS,
  COASTER_MAX_PLAYERS,
  COASTER_MIN_PLAYERS,
  COASTER_PROTOCOL_VERSION,
  generateCoasterRoomCode,
  normalizeCoasterRoomCode,
  sanitizeCoasterName,
} from '../../../packages/shared/src/coaster.ts';
import type {
  CoasterClientToServerMessage,
  CoasterGameAction,
  CoasterGameState,
  CoasterRoomSnapshot,
  CoasterServerToClientMessage,
} from '../../../packages/shared/src/coaster.ts';

// Machine-synced from the coaster slop repo (npm run coaster:sync). Pure JS — the
// import graph must stop at game/*.js (no components, no JSON, no React).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore untyped synced module
import { createInitialState, reducer } from '../../../packages/coaster/game/reducer.js';

const FRAME_MAX_BYTES = 32 * 1024;

// Reducer action types a seated player may dispatch. NEW_GAME is deliberately
// excluded — games start via coasterStart/coasterRestart (host only).
const ALLOWED_ACTION_TYPES = new Set([
  'SELECT_ACTION',
  'CANCEL',
  'END_TURN',
  'FINISH_BUY_LAND',
  'CLICK_HEX',
  'SELECT_CARD',
  'CONFIRM_ATTRACTION',
  'FUNDRAISER',
  'TAKE_MARKET',
  'START_DRAW',
  'KEEP_CARD',
  'TOGGLE_DRAFT_CARD',
  'CONFIRM_DRAFT',
  'PROPOSE_TRADE',
  'CANCEL_TRADE',
  'ACCEPT_TRADE',
  'DECLINE_TRADE',
]);

// A trade offer's resources, coerced to safe non-negative integers.
const sanitizeTradeResources = (raw: unknown): { money: number; wood: number; steel: number } => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const clamp = (v: unknown) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 999) : 0;
  };
  return { money: clamp(r.money), wood: clamp(r.wood), steel: clamp(r.steel) };
};

const MAX_ROOMS = 50;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const ABANDONED_ROOM_MS = 2 * 60 * 60 * 1000;
const IDLE_LOBBY_MS = 30 * 60 * 1000;
const SNAPSHOT_DEBOUNCE_MS = 2000;
const SNAPSHOT_PATH = process.env.COASTER_SNAPSHOT_PATH ?? join(tmpdir(), 'coaster-rooms.json');

type CoasterClient = {
  socket: import('node:net').Socket;
  buffer: Buffer;
  closed: boolean;
  room: CoasterRoom | null;
  seat: number | null;
  lastMessageAt: number;
};

type CoasterSeatState = {
  seat: number;
  name: string;
  token: string;
  client: CoasterClient | null;
};

type CoasterRoom = {
  roomCode: string;
  phase: 'lobby' | 'playing' | 'ended';
  seats: CoasterSeatState[];
  hostSeat: number;
  state: CoasterGameState | null; // authoritative, unredacted
  boardRadius: number; // host's map choice; restarts reuse it
  createdAt: number;
  lastActivityAt: number;
};

const sendFrame = (socket: import('node:net').Socket, payload: CoasterServerToClientMessage | string): void => {
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

const parseFrames = (client: CoasterClient, chunk: Buffer): string[] => {
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

// Hide information a given seat must not see, while preserving array lengths —
// the synced UI components only read `.length` of hidden collections. Staging
// state (selected action/card/hexes, draft picks) is private to the acting
// player so other clients don't get selection panels opening under them.
const redactStateFor = (state: CoasterGameState, seat: number): CoasterGameState => {
  const s = state as Record<string, any>;
  const isCurrent = s.currentPlayerId === seat;
  const drafting = s.phase === 'draft';
  return {
    ...s,
    deck: (s.deck as unknown[]).map(() => null),
    discard: (s.discard as unknown[]).map(() => null),
    drawnCards: isCurrent ? s.drawnCards : null,
    // Everyone drafts in parallel; each client's "displayed drafter" is itself
    // until it confirms, then nothing.
    draftPlayerId: drafting ? (s.draftCards?.[seat] ? seat : null) : s.draftPlayerId,
    draftCards: Array.isArray(s.draftCards)
      ? s.draftCards.map((cards: unknown[] | null, pid: number) =>
          pid === seat ? cards : cards ? cards.map(() => null) : null,
        )
      : s.draftCards,
    draftSelected: Array.isArray(s.draftSelected)
      ? s.draftSelected.map((sel: unknown[], pid: number) => (pid === seat ? sel : []))
      : s.draftSelected,
    selectedAction: isCurrent ? s.selectedAction : null,
    selectedCardId: isCurrent ? s.selectedCardId : null,
    selectedHexIds: isCurrent ? s.selectedHexIds : [],
    players: (s.players as Array<Record<string, any>>).map((p) =>
      p.id === seat ? p : { ...p, hand: (p.hand as unknown[]).map(() => null) },
    ),
  };
};

export const createCoasterWorld = () => {
  const rooms = new Map<string, CoasterRoom>();
  const clients = new Set<CoasterClient>();

  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  // Rooms survive server restarts (VM deploys) via a debounced JSON snapshot;
  // revived seats start disconnected and players reclaim them by token/name.
  const writeSnapshot = (): void => {
    try {
      const payload = [...rooms.values()].map((room) => ({
        roomCode: room.roomCode,
        phase: room.phase,
        hostSeat: room.hostSeat,
        state: room.state,
        boardRadius: room.boardRadius,
        createdAt: room.createdAt,
        lastActivityAt: room.lastActivityAt,
        seats: room.seats.map(({ seat, name, token }) => ({ seat, name, token })),
      }));
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload));
    } catch {
      // Snapshotting is best-effort; never let it take down the game server.
    }
  };

  const persistRooms = (): void => {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      writeSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  };

  const restoreRooms = (): void => {
    try {
      const payload = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Array<Record<string, any>>;
      for (const entry of payload) {
        if (typeof entry?.roomCode !== 'string' || !Array.isArray(entry.seats)) continue;
        rooms.set(entry.roomCode, {
          roomCode: entry.roomCode,
          phase: entry.phase === 'playing' || entry.phase === 'ended' ? entry.phase : 'lobby',
          hostSeat: typeof entry.hostSeat === 'number' ? entry.hostSeat : 0,
          state: entry.state ?? null,
          boardRadius: COASTER_BOARD_RADII.includes(entry.boardRadius)
            ? entry.boardRadius
            : COASTER_DEFAULT_BOARD_RADIUS,
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          lastActivityAt: typeof entry.lastActivityAt === 'number' ? entry.lastActivityAt : Date.now(),
          seats: entry.seats.map((seat: Record<string, any>, index: number) => ({
            seat: index,
            name: typeof seat.name === 'string' ? seat.name : `Player ${index + 1}`,
            token: typeof seat.token === 'string' ? seat.token : randomUUID(),
            client: null,
          })),
        });
      }
      if (rooms.size > 0) {
        console.log(`[coaster] restored ${rooms.size} room(s) from ${SNAPSHOT_PATH}`);
      }
    } catch {
      // Missing or corrupt snapshot: start empty.
    }
  };

  const roomSnapshot = (room: CoasterRoom): CoasterRoomSnapshot => ({
    roomCode: room.roomCode,
    phase: room.phase,
    maxSeats: COASTER_MAX_PLAYERS,
    canStart: room.phase === 'lobby' && room.seats.length >= COASTER_MIN_PLAYERS,
    seats: room.seats.map((seat) => ({
      seat: seat.seat,
      name: seat.name,
      connected: seat.client !== null,
      isHost: seat.seat === room.hostSeat,
    })),
  });

  const sendError = (client: CoasterClient, message: string): void => {
    sendFrame(client.socket, { type: 'error', message });
  };

  const broadcastRoom = (room: CoasterRoom): void => {
    const message: CoasterServerToClientMessage = { type: 'coasterRoom', room: roomSnapshot(room) };
    const text = JSON.stringify(message);
    room.seats.forEach((seat) => {
      if (seat.client) sendFrame(seat.client.socket, text);
    });
  };

  const broadcastState = (room: CoasterRoom): void => {
    if (!room.state) return;
    room.seats.forEach((seat) => {
      if (seat.client) {
        sendFrame(seat.client.socket, {
          type: 'coasterState',
          state: redactStateFor(room.state!, seat.seat),
        });
      }
    });
  };

  const touch = (room: CoasterRoom): void => {
    room.lastActivityAt = Date.now();
    persistRooms();
  };

  const seatOf = (client: CoasterClient): CoasterSeatState | null => {
    if (!client.room || client.seat === null) return null;
    return client.room.seats.find((seat) => seat.seat === client.seat) ?? null;
  };

  const handleDisconnect = (client: CoasterClient): void => {
    const room = client.room;
    const seat = seatOf(client);
    client.room = null;
    client.seat = null;
    clients.delete(client);
    if (!room || !seat || seat.client !== client) return;

    // Seats persist through disconnects mid-game; players reclaim by token.
    seat.client = null;
    broadcastRoom(room);
    persistRooms();
  };

  const seatClient = (client: CoasterClient, room: CoasterRoom, seat: CoasterSeatState): void => {
    // A seat can only have one live socket; kick the older one (e.g. a stale tab).
    if (seat.client && seat.client !== client) {
      const old = seat.client;
      old.room = null;
      old.seat = null;
      sendError(old, 'Your seat was claimed from another window.');
      sendClose(old.socket);
    }
    seat.client = client;
    client.room = room;
    client.seat = seat.seat;

    sendFrame(client.socket, {
      type: 'coasterJoined',
      protocolVersion: COASTER_PROTOCOL_VERSION,
      roomCode: room.roomCode,
      seat: seat.seat,
      token: seat.token,
      room: roomSnapshot(room),
      state: room.state ? redactStateFor(room.state, seat.seat) : null,
    });
    broadcastRoom(room);
    touch(room);
  };

  const handleCreate = (client: CoasterClient, message: Extract<CoasterClientToServerMessage, { type: 'coasterCreate' }>): void => {
    if (client.room) {
      sendError(client, 'Leave your current room first.');
      return;
    }
    if (rooms.size >= MAX_ROOMS) {
      sendError(client, 'Too many active games right now — try again later.');
      return;
    }

    let roomCode = generateCoasterRoomCode();
    while (rooms.has(roomCode)) roomCode = generateCoasterRoomCode();

    const room: CoasterRoom = {
      roomCode,
      phase: 'lobby',
      seats: [],
      hostSeat: 0,
      state: null,
      boardRadius: COASTER_DEFAULT_BOARD_RADIUS,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    rooms.set(roomCode, room);

    const seat: CoasterSeatState = {
      seat: 0,
      name: sanitizeCoasterName(message.name, 'Player 1'),
      token: randomUUID(),
      client: null,
    };
    room.seats.push(seat);
    seatClient(client, room, seat);
  };

  const handleJoin = (client: CoasterClient, message: Extract<CoasterClientToServerMessage, { type: 'coasterJoin' }>): void => {
    if (client.room) {
      sendError(client, 'Leave your current room first.');
      return;
    }

    const roomCode = normalizeCoasterRoomCode(message.roomCode);
    if (!roomCode) {
      sendError(client, 'Room codes are 4 letters/digits, e.g. TXKQ.');
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      sendError(client, `No game found with code ${roomCode}.`);
      return;
    }

    // Reconnect by token (page reload, network blip, server restart).
    if (typeof message.token === 'string' && message.token.length > 0) {
      const seat = room.seats.find((s) => s.token === message.token);
      if (seat) {
        seatClient(client, room, seat);
        return;
      }
    }

    const name = sanitizeCoasterName(message.name, `Player ${room.seats.length + 1}`);

    // Reclaim a disconnected seat by name (new device, cleared storage).
    const abandoned = room.seats.find(
      (s) => s.client === null && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (abandoned) {
      abandoned.token = randomUUID();
      seatClient(client, room, abandoned);
      return;
    }

    if (room.phase !== 'lobby') {
      sendError(client, 'That game is already in progress.');
      return;
    }
    if (room.seats.length >= COASTER_MAX_PLAYERS) {
      sendError(client, 'That game is full (4 players max).');
      return;
    }

    const seat: CoasterSeatState = {
      seat: room.seats.length,
      name,
      token: randomUUID(),
      client: null,
    };
    room.seats.push(seat);
    seatClient(client, room, seat);
  };

  const handleLeave = (client: CoasterClient): void => {
    const room = client.room;
    const seat = seatOf(client);
    if (!room || !seat) return;

    client.room = null;
    client.seat = null;
    seat.client = null;

    if (room.phase === 'lobby') {
      // Free the seat and renumber so the next joiner fills the gap.
      room.seats = room.seats.filter((s) => s !== seat);
      room.seats.forEach((s, index) => {
        s.seat = index;
        if (s.client) s.client.seat = index;
      });
      if (room.seats.length === 0) {
        rooms.delete(room.roomCode);
        persistRooms();
        return;
      }
      room.hostSeat = 0;
    }

    broadcastRoom(room);
    touch(room);
  };

  const startGame = (room: CoasterRoom): void => {
    let state = createInitialState(room.seats.length, room.boardRadius) as Record<string, any>;
    // The reducer bakes default names ("Red (P1)") into players; swap in lobby
    // names once and every later reducer message follows.
    state = {
      ...state,
      players: state.players.map((p: Record<string, any>, index: number) => ({
        ...p,
        name: room.seats[index].name,
      })),
    };

    room.state = state;
    room.phase = 'playing';
    broadcastRoom(room);
    broadcastState(room);
    touch(room);
  };

  const handleStart = (client: CoasterClient, restart: boolean, boardRadius?: unknown): void => {
    const room = client.room;
    const seat = seatOf(client);
    if (!room || !seat) {
      sendError(client, 'Join a room first.');
      return;
    }
    if (seat.seat !== room.hostSeat) {
      sendError(client, 'Only the host can start the game.');
      return;
    }
    if (restart ? room.phase !== 'ended' : room.phase !== 'lobby') {
      sendError(client, restart ? 'The game is still running.' : 'The game has already started.');
      return;
    }
    if (room.seats.length < COASTER_MIN_PLAYERS) {
      sendError(client, `Need at least ${COASTER_MIN_PLAYERS} players.`);
      return;
    }
    // Restarts reuse the room's map; a fresh start may pick one.
    if (!restart && typeof boardRadius === 'number' && COASTER_BOARD_RADII.includes(boardRadius)) {
      room.boardRadius = boardRadius;
    }
    startGame(room);
  };

  const handleAction = (client: CoasterClient, message: Extract<CoasterClientToServerMessage, { type: 'coasterAction' }>): void => {
    const room = client.room;
    const seat = seatOf(client);
    if (!room || !seat || !room.state || room.phase !== 'playing') {
      sendError(client, 'No game in progress.');
      return;
    }

    const action = message.action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string' || !ALLOWED_ACTION_TYPES.has(action.type)) {
      sendError(client, 'Unsupported game action.');
      return;
    }

    const state = room.state as Record<string, any>;
    const isDraftAction = action.type === 'TOGGLE_DRAFT_CARD' || action.type === 'CONFIRM_DRAFT';
    const isTradeResponse = action.type === 'ACCEPT_TRADE' || action.type === 'DECLINE_TRADE';
    if (state.phase === 'draft') {
      // Drafting happens in parallel: any seat may act on its own cards.
      if (!isDraftAction) {
        sendError(client, 'Finish the draft first.');
        return;
      }
      if (!state.draftCards?.[seat.seat]) {
        sendError(client, 'You have already drafted.');
        return;
      }
    } else if (isTradeResponse) {
      // Only the player being offered the pending trade may accept/decline it.
      if (!state.pendingTrade || state.pendingTrade.to !== seat.seat) {
        sendError(client, 'No trade is waiting for your response.');
        return;
      }
    } else if (isDraftAction || seat.seat !== state.currentPlayerId) {
      // Everything else (incl. PROPOSE_TRADE / CANCEL_TRADE) is the turn holder's.
      sendError(client, 'Not your turn.');
      return;
    }

    // Keep payloads to the primitive fields the reducer reads.
    const sanitized: CoasterGameAction = { type: action.type };
    if (isDraftAction) sanitized.playerId = seat.seat; // server-assigned, never client-supplied
    if (action.type === 'PROPOSE_TRADE') {
      if (
        typeof action.to === 'number' &&
        Number.isInteger(action.to) &&
        action.to >= 0 &&
        action.to < COASTER_MAX_PLAYERS
      ) {
        sanitized.to = action.to;
      }
      sanitized.offer = sanitizeTradeResources(action.offer);
      sanitized.request = sanitizeTradeResources(action.request);
    }
    if (typeof action.hexId === 'string' && action.hexId.length <= 32) sanitized.hexId = action.hexId;
    if (typeof action.cardId === 'string' && action.cardId.length <= 64) sanitized.cardId = action.cardId;
    if (typeof action.action === 'string' && action.action.length <= 32) sanitized.action = action.action;
    if (typeof action.index === 'number' && Number.isInteger(action.index) && action.index >= 0 && action.index < 16) {
      sanitized.index = action.index;
    }

    const next = reducer(room.state, sanitized) as Record<string, any>;
    if (next === room.state) return;

    room.state = next;
    if (next.phase === 'gameOver') room.phase = 'ended';
    broadcastState(room);
    if (next.phase === 'gameOver') broadcastRoom(room);
    touch(room);
  };

  const handleMessage = (client: CoasterClient, raw: string): void => {
    let message: CoasterClientToServerMessage;

    try {
      message = JSON.parse(raw) as CoasterClientToServerMessage;
    } catch {
      sendError(client, 'Invalid JSON message.');
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      sendError(client, 'Invalid coaster message.');
      return;
    }

    client.lastMessageAt = Date.now();

    if (message.type === 'coasterCreate') {
      handleCreate(client, message);
    } else if (message.type === 'coasterJoin') {
      handleJoin(client, message);
    } else if (message.type === 'coasterLeave') {
      handleLeave(client);
    } else if (message.type === 'coasterStart') {
      handleStart(client, false, message.boardRadius);
    } else if (message.type === 'coasterRestart') {
      handleStart(client, true);
    } else if (message.type === 'coasterAction') {
      handleAction(client, message);
    } else if (message.type === 'ping') {
      const clientTime = Number.isFinite(message.clientTime) ? message.clientTime : 0;
      sendFrame(client.socket, { type: 'pong', clientTime, serverTime: Date.now() });
    } else {
      sendError(client, `Unsupported coaster message: ${(message as { type: string }).type}`);
    }
  };

  const cleanupRooms = (): void => {
    const now = Date.now();
    let removed = false;
    rooms.forEach((room, roomCode) => {
      const allDisconnected = room.seats.every((seat) => seat.client === null);
      if (!allDisconnected) return;
      const idleMs = now - room.lastActivityAt;
      if (idleMs > ABANDONED_ROOM_MS || (room.phase === 'lobby' && idleMs > IDLE_LOBBY_MS)) {
        rooms.delete(roomCode);
        removed = true;
      }
    });
    if (removed) persistRooms();
  };

  const cleanupInterval = setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

  restoreRooms();

  return {
    accept(socket: import('node:net').Socket): void {
      const client: CoasterClient = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        room: null,
        seat: null,
        lastMessageAt: Date.now(),
      };

      clients.add(client);

      socket.on('data', (chunk) => {
        try {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          parseFrames(client, data).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendError(client, error instanceof Error ? error.message : 'Coaster socket parse error.');
          socket.destroy();
        }
      });

      socket.on('close', () => handleDisconnect(client));
      socket.on('error', () => handleDisconnect(client));
    },
    health() {
      return {
        ok: true,
        mode: 'coaster',
        rooms: rooms.size,
        players: [...clients].filter((client) => client.room !== null).length,
        snapshotPath: SNAPSHOT_PATH,
      };
    },
    close(): void {
      clearInterval(cleanupInterval);
      if (snapshotTimer) {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
      writeSnapshot();
      clients.forEach((client) => {
        sendClose(client.socket);
        client.socket.destroy();
      });
      clients.clear();
      rooms.clear();
    },
  };
};
