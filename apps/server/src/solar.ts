import { randomUUID } from 'node:crypto';

import {
  ORBITAL_CONFIG,
  createOrbitBody,
  createSeedBodies,
  sanitizeOrbitBody,
  stepOrbitBodies,
} from '../../../packages/shared/src/solar.ts';
import type {
  OrbitBodySnapshot,
  OrbitSnapshot,
  OrbitWorldEvent,
  SolarClientToServerMessage,
  SolarServerToClientMessage,
} from '../../../packages/shared/src/solar.ts';

const FRAME_MAX_BYTES = 32 * 1024;
const TICK_INTERVAL_MS = 1000 / ORBITAL_CONFIG.tickRate;
const SNAPSHOT_INTERVAL_TICKS = Math.max(1, Math.round(ORBITAL_CONFIG.tickRate / ORBITAL_CONFIG.snapshotRate));
const NAME_MAX_LENGTH = 18;

type SolarClient = {
  socket: import('node:net').Socket;
  buffer: Buffer;
  closed: boolean;
  id: string;
  joined: boolean;
  name: string;
  lastMessageAt: number;
};

const sanitizeName = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .trim()
    .replace(/[^\w -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX_LENGTH);
  return cleaned || fallback;
};

const cloneBody = (body: OrbitBodySnapshot): OrbitBodySnapshot => ({
  ...body,
  path: [],
});

const sendFrame = (socket: import('node:net').Socket, payload: SolarServerToClientMessage | string): void => {
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

const parseFrames = (client: SolarClient, chunk: Buffer): string[] => {
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

export const createSolarWorld = () => {
  const connections = new Set<SolarClient>();
  const events: OrbitWorldEvent[] = [];
  let bodies = createSeedBodies();
  let tick = 0;
  let lastSnapshotTick = 0;

  const makeSnapshot = (consumeEvents = false): OrbitSnapshot => ({
    type: 'solarSnapshot',
    tick,
    serverTime: Date.now(),
    bodies: bodies.map(cloneBody),
    playerCount: [...connections].filter((client) => client.joined).length,
    events: consumeEvents ? events.splice(0) : [],
  });

  const broadcast = (message: SolarServerToClientMessage): void => {
    const text = JSON.stringify(message);
    connections.forEach((client) => {
      if (client.joined) sendFrame(client.socket, text);
    });
  };

  const broadcastPresence = (): void => {
    broadcast({ type: 'solarPresence', playerCount: [...connections].filter((client) => client.joined).length });
  };

  const handleJoin = (client: SolarClient, name: unknown): void => {
    client.joined = true;
    client.name = sanitizeName(name, `Explorer ${connections.size}`);
    client.lastMessageAt = Date.now();

    sendFrame(client.socket, {
      type: 'solarJoined',
      protocolVersion: ORBITAL_CONFIG.protocolVersion,
      you: client.id,
      snapshot: makeSnapshot(),
    });
    broadcastPresence();
  };

  const handleAddBody = (client: SolarClient, message: SolarClientToServerMessage): void => {
    if (!client.joined || message.type !== 'solarAddBody') return;
    if (bodies.length >= ORBITAL_CONFIG.maxBodies) {
      sendFrame(client.socket, { type: 'error', message: `The canvas is full at ${ORBITAL_CONFIG.maxBodies} bodies.` });
      return;
    }

    const sanitized = sanitizeOrbitBody(message.body);
    if (!sanitized) {
      sendFrame(client.socket, { type: 'error', message: 'Invalid body payload.' });
      return;
    }

    const body = createOrbitBody(randomUUID(), sanitized);
    bodies.push(body);
    events.push({ type: 'bodyAdded', id: body.id });
    broadcast(makeSnapshot(true));
  };

  const handleMessage = (client: SolarClient, raw: string): void => {
    let message: SolarClientToServerMessage;

    try {
      message = JSON.parse(raw) as SolarClientToServerMessage;
    } catch {
      sendFrame(client.socket, { type: 'error', message: 'Invalid JSON message.' });
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      sendFrame(client.socket, { type: 'error', message: 'Invalid orbitals message.' });
      return;
    }

    client.lastMessageAt = Date.now();

    if (message.type === 'solarJoin') {
      handleJoin(client, message.name);
    } else if (message.type === 'solarAddBody') {
      handleAddBody(client, message);
    } else if (message.type === 'ping') {
      const clientTime = Number.isFinite(message.clientTime) ? message.clientTime : 0;
      sendFrame(client.socket, { type: 'pong', clientTime, serverTime: Date.now() });
    } else {
      sendFrame(client.socket, { type: 'error', message: `Unsupported orbitals message: ${(message as { type: string }).type}` });
    }
  };

  const removeClient = (client: SolarClient): void => {
    const wasJoined = client.joined;
    connections.delete(client);
    if (wasJoined) broadcastPresence();
  };

  const tickWorld = (): void => {
    if (bodies.length > 0) {
      stepOrbitBodies(bodies, 1 / ORBITAL_CONFIG.tickRate);
    }
    tick += 1;

    if (tick - lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
      lastSnapshotTick = tick;
      broadcast(makeSnapshot(true));
    }
  };

  const loop = setInterval(tickWorld, TICK_INTERVAL_MS);

  return {
    accept(socket: import('node:net').Socket): void {
      const client: SolarClient = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        id: randomUUID(),
        joined: false,
        name: 'Explorer',
        lastMessageAt: Date.now(),
      };

      connections.add(client);

      socket.on('data', (chunk) => {
        try {
          parseFrames(client, chunk).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendFrame(socket, { type: 'error', message: error instanceof Error ? error.message : 'Orbitals socket parse error.' });
          socket.destroy();
        }
      });

      socket.on('close', () => removeClient(client));
      socket.on('error', () => removeClient(client));
    },
    health() {
      return {
        ok: true,
        mode: 'orbitals',
        players: [...connections].filter((client) => client.joined).length,
        bodies: bodies.length,
        tick,
      };
    },
    close(): void {
      clearInterval(loop);
      connections.forEach((client) => {
        sendClose(client.socket);
        client.socket.destroy();
      });
      connections.clear();
      bodies = [];
    },
  };
};
