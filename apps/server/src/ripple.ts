import { randomUUID } from 'node:crypto';

import {
  RIPPLE_CONFIG,
  cloneRippleEmitter,
  cloneRippleObject,
  cloneRippleSplash,
  createDefaultRippleObject,
  createDefaultRippleEmitters,
  isRippleObjectKind,
  normalizeRippleRoomCode,
  resolvePersistentRippleRoomCode,
  sanitizeRippleEmitterPatch,
  sanitizeRippleName,
  sanitizeRippleObjectPatch,
  sanitizeRippleSplash,
} from '../../../packages/shared/src/ripple.ts';
import type {
  RippleClientToServerMessage,
  RippleEmitterSnapshot,
  RippleObjectSnapshot,
  RippleRoomSummary,
  RippleServerToClientMessage,
  RippleSnapshot,
  RippleSplashEvent,
} from '../../../packages/shared/src/ripple.ts';

const FRAME_MAX_BYTES = 32 * 1024;

type RippleClient = {
  socket: import('node:net').Socket;
  buffer: Buffer;
  closed: boolean;
  id: string;
  joined: boolean;
  name: string;
  roomCode: string;
  lastMessageAt: number;
  lastActiveAt: number;
  lastSplashAt: number;
};

type RippleRoom = {
  roomCode: string;
  clients: Set<RippleClient>;
  emitters: Map<string, RippleEmitterSnapshot>;
  objects: Map<string, RippleObjectSnapshot>;
  recentSplashes: RippleSplashEvent[];
  paused: boolean;
  resetVersion: number;
  createdAt: number;
  nextSplashId: number;
  nextObjectId: number;
};

const sendFrame = (socket: import('node:net').Socket, payload: RippleServerToClientMessage | string): void => {
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

const parseFrames = (client: RippleClient, chunk: Buffer): string[] => {
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

const createRippleRoom = (roomCode: string): RippleRoom => {
  const now = Date.now();
  return {
    roomCode,
    clients: new Set(),
    emitters: new Map(createDefaultRippleEmitters(now).map((emitter) => [emitter.id, emitter])),
    objects: new Map(),
    recentSplashes: [],
    paused: false,
    resetVersion: 0,
    createdAt: now,
    nextSplashId: 1,
    nextObjectId: 1,
  };
};

export const createRippleWorld = () => {
  const rooms = new Map<string, RippleRoom>();
  const clients = new Set<RippleClient>();

  const getRoom = (roomCode: string): RippleRoom => {
    const normalized = resolvePersistentRippleRoomCode(roomCode);
    const existing = rooms.get(normalized);
    if (existing) return existing;

    const room = createRippleRoom(normalized);
    rooms.set(normalized, room);
    return room;
  };

  const joinedCount = (room: RippleRoom): number => [...room.clients].filter((client) => client.joined).length;
  const activeClientCount = (): number => [...clients].filter((client) => client.joined).length;

  const roomSummaries = (): RippleRoomSummary[] =>
    RIPPLE_CONFIG.persistentRoomCodes.map((roomCode) => {
      const room = getRoom(roomCode);
      return {
        roomCode: room.roomCode,
        playerCount: joinedCount(room),
      };
    });

  const makeSnapshot = (room: RippleRoom): RippleSnapshot => ({
    type: 'rippleSnapshot',
    roomCode: room.roomCode,
    serverTime: Date.now(),
    paused: room.paused,
    resetVersion: room.resetVersion,
    emitters: [...room.emitters.values()].map(cloneRippleEmitter),
    objects: [...room.objects.values()].map(cloneRippleObject),
    recentSplashes: room.recentSplashes.map(cloneRippleSplash),
    playerCount: joinedCount(room),
  });

  const broadcast = (room: RippleRoom, message: RippleServerToClientMessage): void => {
    const text = JSON.stringify(message);
    room.clients.forEach((client) => {
      if (client.joined) sendFrame(client.socket, text);
    });
  };

  const broadcastSnapshot = (room: RippleRoom): void => {
    broadcast(room, makeSnapshot(room));
  };

  const broadcastPresence = (room: RippleRoom): void => {
    broadcast(room, { type: 'ripplePresence', playerCount: joinedCount(room) });
  };

  const broadcastRooms = (): void => {
    const message: RippleServerToClientMessage = {
      type: 'rippleRooms',
      rooms: roomSummaries(),
      maxActiveUsers: RIPPLE_CONFIG.maxActiveUsers,
    };
    const text = JSON.stringify(message);
    clients.forEach((client) => sendFrame(client.socket, text));
  };

  const sendError = (client: RippleClient, message: string): void => {
    sendFrame(client.socket, { type: 'error', message });
  };

  const sendLobby = (
    client: RippleClient,
    reason: 'inactive' | 'full' | 'local',
    message: string,
  ): void => {
    sendFrame(client.socket, {
      type: 'rippleLobby',
      reason,
      message,
      rooms: roomSummaries(),
      maxActiveUsers: RIPPLE_CONFIG.maxActiveUsers,
    });
  };

  const removeClientFromRoom = (client: RippleClient): void => {
    const room = rooms.get(client.roomCode);
    if (!room) return;

    const wasJoined = client.joined;
    room.clients.delete(client);
    client.joined = false;

    let releasedState = false;
    room.emitters.forEach((emitter, id) => {
      if (emitter.controlledBy === client.id) {
        room.emitters.set(id, { ...emitter, controlledBy: null, updatedAt: Date.now() });
        releasedState = true;
      }
    });
    room.objects.forEach((object, id) => {
      if (object.controlledBy === client.id) {
        room.objects.set(id, { ...object, controlledBy: null, updatedAt: Date.now() });
        releasedState = true;
      }
    });

    if (wasJoined) {
      broadcastPresence(room);
      if (releasedState) broadcastSnapshot(room);
      broadcastRooms();
    }
  };

  const joinRoom = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleJoin') return;

    const requestedRoomCode = resolvePersistentRippleRoomCode(message.roomCode ?? client.roomCode);

    if (client.joined) {
      removeClientFromRoom(client);
    } else {
      const previousRoom = rooms.get(client.roomCode);
      previousRoom?.clients.delete(client);
    }

    if (activeClientCount() >= RIPPLE_CONFIG.maxActiveUsers) {
      client.joined = false;
      client.roomCode = requestedRoomCode;
      sendLobby(client, 'full', `All ${RIPPLE_CONFIG.maxActiveUsers} active ripple tank seats are full.`);
      broadcastRooms();
      return;
    }

    const room = getRoom(requestedRoomCode);
    client.roomCode = room.roomCode;
    client.joined = true;
    client.name = sanitizeRippleName(message.name, `Explorer ${joinedCount(room) + 1}`);
    client.lastMessageAt = Date.now();
    client.lastActiveAt = client.lastMessageAt;
    room.clients.add(client);

    sendFrame(client.socket, {
      type: 'rippleJoined',
      protocolVersion: RIPPLE_CONFIG.protocolVersion,
      you: client.id,
      snapshot: makeSnapshot(room),
      rooms: roomSummaries(),
      maxActiveUsers: RIPPLE_CONFIG.maxActiveUsers,
    });
    broadcastPresence(room);
    broadcastRooms();
  };

  const getJoinedRoom = (client: RippleClient): RippleRoom | null => {
    if (!client.joined) {
      sendError(client, 'Join Ripple Tank before sending actions.');
      return null;
    }

    const room = rooms.get(client.roomCode);
    if (!room) {
      sendError(client, 'Ripple room no longer exists.');
      return null;
    }

    return room;
  };

  const handleSplash = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleSplash') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    const now = Date.now();
    if (now - client.lastSplashAt < RIPPLE_CONFIG.splashRateLimitMs) return;

    const splash = sanitizeRippleSplash(message.splash);
    if (!splash) {
      sendError(client, 'Invalid ripple splash payload.');
      return;
    }

    client.lastSplashAt = now;
    client.lastActiveAt = now;
    room.recentSplashes.push({
      id: `${room.roomCode}-${room.nextSplashId++}`,
      createdBy: client.id,
      serverTime: now,
      ...splash,
    });

    if (room.recentSplashes.length > RIPPLE_CONFIG.recentSplashLimit) {
      room.recentSplashes.splice(0, room.recentSplashes.length - RIPPLE_CONFIG.recentSplashLimit);
    }

    broadcastSnapshot(room);
  };

  const handleEmitterUpdate = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleEmitterUpdate') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    const emitter = room.emitters.get(message.id);
    if (!emitter) {
      sendError(client, `Unknown ripple emitter: ${message.id}`);
      return;
    }

    const patch = sanitizeRippleEmitterPatch(message.patch);
    if (!patch) {
      sendError(client, 'Invalid ripple emitter update.');
      return;
    }

    client.lastActiveAt = Date.now();
    room.emitters.set(message.id, {
      ...emitter,
      ...patch,
      controlledBy: client.id,
      updatedAt: Date.now(),
    });
    broadcastSnapshot(room);
  };

  const handleEmitterRelease = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleEmitterRelease') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    const emitter = room.emitters.get(message.id);
    if (!emitter || emitter.controlledBy !== client.id) return;

    client.lastActiveAt = Date.now();
    room.emitters.set(message.id, { ...emitter, controlledBy: null, updatedAt: Date.now() });
    broadcastSnapshot(room);
  };

  const handleObjectCreate = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleObjectCreate') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    if (!isRippleObjectKind(message.kind)) {
      sendError(client, 'Invalid ripple object kind.');
      return;
    }

    if (room.objects.size >= RIPPLE_CONFIG.object.maxObjects) {
      sendError(client, `The tank is full at ${RIPPLE_CONFIG.object.maxObjects} objects.`);
      return;
    }

    const patch = sanitizeRippleObjectPatch(message.object);
    if (!patch) {
      sendError(client, 'Invalid ripple object payload.');
      return;
    }

    const id = `object-${room.nextObjectId++}`;
    const now = Date.now();
    client.lastActiveAt = now;
    const object = createDefaultRippleObject(id, message.kind, patch, now);
    room.objects.set(id, { ...object, controlledBy: client.id });
    broadcastSnapshot(room);
  };

  const handleObjectUpdate = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleObjectUpdate') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    const object = room.objects.get(message.id);
    if (!object) {
      sendError(client, `Unknown ripple object: ${message.id}`);
      return;
    }

    const patch = sanitizeRippleObjectPatch(message.patch);
    if (!patch) {
      sendError(client, 'Invalid ripple object update.');
      return;
    }

    client.lastActiveAt = Date.now();
    room.objects.set(message.id, {
      ...object,
      ...patch,
      controlledBy: client.id,
      updatedAt: Date.now(),
    });
    broadcastSnapshot(room);
  };

  const handleObjectDelete = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleObjectDelete') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    client.lastActiveAt = Date.now();
    if (room.objects.delete(message.id)) {
      broadcastSnapshot(room);
    }
  };

  const handleObjectRelease = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleObjectRelease') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    const object = room.objects.get(message.id);
    if (!object || object.controlledBy !== client.id) return;

    client.lastActiveAt = Date.now();
    room.objects.set(message.id, { ...object, controlledBy: null, updatedAt: Date.now() });
    broadcastSnapshot(room);
  };

  const handlePause = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleSetPaused') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    room.paused = Boolean(message.paused);
    client.lastActiveAt = Date.now();
    broadcastSnapshot(room);
  };

  const handleReset = (client: RippleClient, message: RippleClientToServerMessage): void => {
    if (message.type !== 'rippleReset') return;
    const room = getJoinedRoom(client);
    if (!room) return;

    room.recentSplashes = [];
    room.resetVersion += 1;
    client.lastActiveAt = Date.now();
    broadcastSnapshot(room);
  };

  const handleMessage = (client: RippleClient, raw: string): void => {
    let message: RippleClientToServerMessage;

    try {
      message = JSON.parse(raw) as RippleClientToServerMessage;
    } catch {
      sendError(client, 'Invalid JSON message.');
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      sendError(client, 'Invalid ripple message.');
      return;
    }

    client.lastMessageAt = Date.now();

    if (message.type === 'rippleJoin') {
      joinRoom(client, message);
    } else if (message.type === 'rippleSplash') {
      handleSplash(client, message);
    } else if (message.type === 'rippleEmitterUpdate') {
      handleEmitterUpdate(client, message);
    } else if (message.type === 'rippleEmitterRelease') {
      handleEmitterRelease(client, message);
    } else if (message.type === 'rippleObjectCreate') {
      handleObjectCreate(client, message);
    } else if (message.type === 'rippleObjectUpdate') {
      handleObjectUpdate(client, message);
    } else if (message.type === 'rippleObjectDelete') {
      handleObjectDelete(client, message);
    } else if (message.type === 'rippleObjectRelease') {
      handleObjectRelease(client, message);
    } else if (message.type === 'rippleSetPaused') {
      handlePause(client, message);
    } else if (message.type === 'rippleReset') {
      handleReset(client, message);
    } else if (message.type === 'ping') {
      const clientTime = Number.isFinite(message.clientTime) ? message.clientTime : 0;
      sendFrame(client.socket, { type: 'pong', clientTime, serverTime: Date.now() });
    } else {
      sendError(client, `Unsupported ripple message: ${(message as { type: string }).type}`);
    }
  };

  const moveInactiveClientsToLobby = (): void => {
    const now = Date.now();
    clients.forEach((client) => {
      if (!client.joined || now - client.lastActiveAt < RIPPLE_CONFIG.inactiveTimeoutMs) return;
      removeClientFromRoom(client);
      client.joined = false;
      sendLobby(client, 'inactive', 'You were moved to the local lobby after 120 seconds of inactivity.');
    });
  };

  const inactivityInterval = setInterval(moveInactiveClientsToLobby, 5000);

  RIPPLE_CONFIG.persistentRoomCodes.forEach((roomCode) => getRoom(roomCode));

  return {
    accept(socket: import('node:net').Socket, roomCode: string = RIPPLE_CONFIG.defaultRoomCode): void {
      const client: RippleClient = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        id: randomUUID(),
        joined: false,
        name: 'Explorer',
        roomCode: resolvePersistentRippleRoomCode(roomCode),
        lastMessageAt: Date.now(),
        lastActiveAt: Date.now(),
        lastSplashAt: 0,
      };

      clients.add(client);

      socket.on('data', (chunk) => {
        try {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          parseFrames(client, data).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendError(client, error instanceof Error ? error.message : 'Ripple socket parse error.');
          socket.destroy();
        }
      });

      socket.on('close', () => {
        removeClientFromRoom(client);
        clients.delete(client);
      });
      socket.on('error', () => {
        removeClientFromRoom(client);
        clients.delete(client);
      });
    },
    health() {
      return {
        ok: true,
        mode: 'ripples',
        rooms: roomSummaries(),
        players: activeClientCount(),
        maxActiveUsers: RIPPLE_CONFIG.maxActiveUsers,
        defaultRoom: RIPPLE_CONFIG.defaultRoomCode,
      };
    },
    close(): void {
      clearInterval(inactivityInterval);
      rooms.forEach((room) => {
        room.clients.forEach((client) => {
          sendClose(client.socket);
          client.socket.destroy();
        });
        room.clients.clear();
      });
      rooms.clear();
      clients.forEach((client) => {
        sendClose(client.socket);
        client.socket.destroy();
      });
      clients.clear();
    },
  };
};
