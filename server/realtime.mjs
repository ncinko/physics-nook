import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { URL, pathToFileURL } from 'node:url';

const PORT = Number.parseInt(process.env.COASTER_WS_PORT ?? '8787', 10);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();

const clone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const sendFrame = (socket, payload) => {
  if (socket.destroyed) {
    return;
  }

  const data = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let header;

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

const sendClose = (socket) => {
  if (!socket.destroyed) {
    socket.end(Buffer.from([0x88, 0x00]));
  }
};

const sendPong = (socket, payload) => {
  const data = payload ?? Buffer.alloc(0);
  socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
};

const parseFrames = (client, chunk) => {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages = [];

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
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Frame too large.');
      }
      length = Number(bigLength);
      offset += 8;
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
      sendPong(client.socket, payload);
      continue;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
  }

  return messages;
};

const getRoom = (roomCode, seedDocument) => {
  const normalized = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARK1';

  if (!rooms.has(normalized)) {
    rooms.set(normalized, {
      roomCode: normalized,
      document: clone(seedDocument),
      clients: new Map(),
      createdAt: Date.now(),
    });
  }

  return rooms.get(normalized);
};

const getUsers = (room) =>
  [...room.clients.values()].map((client) => client.presence).filter(Boolean);

const broadcast = (room, message) => {
  const text = JSON.stringify(message);
  room.clients.forEach((client) => sendFrame(client.socket, text));
};

const removeClient = (client) => {
  if (!client.roomCode) {
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) {
    return;
  }

  room.clients.delete(client.clientId);
  broadcast(room, { type: 'presence', roomCode: room.roomCode, users: getUsers(room) });

  if (room.clients.size === 0) {
    const cleanupTimer = setTimeout(() => {
      const staleRoom = rooms.get(room.roomCode);
      if (staleRoom && staleRoom.clients.size === 0 && Date.now() - staleRoom.createdAt > 1000) {
        rooms.delete(room.roomCode);
      }
    }, 5 * 60 * 1000);
    cleanupTimer.unref?.();
  }
};

const findCoaster = (document, coasterId) =>
  document.coasters?.find((coaster) => coaster.id === coasterId);

const applyServerOp = (document, op) => {
  const next = clone(document);

  if (op.type === 'appendPiece') {
    const coaster = findCoaster(next, op.coasterId);
    if (!coaster || !op.segment) {
      return { ok: false, reason: 'Unknown coaster or segment.' };
    }
    coaster.segments.push(op.segment);
    next.version += 1;
    return { ok: true, document: next };
  }

  if (op.type === 'undoLastPiece') {
    const coaster = findCoaster(next, op.coasterId);
    if (!coaster || coaster.segments.length <= 1) {
      return { ok: false, reason: 'Nothing to undo.' };
    }
    coaster.segments.pop();
    next.version += 1;
    return { ok: true, document: next };
  }

  if (op.type === 'deleteCoaster') {
    next.coasters = next.coasters.filter((coaster) => coaster.id !== op.coasterId);
    next.version += 1;
    return { ok: true, document: next };
  }

  if (op.type === 'replacePark') {
    const replacement = clone(op.document);
    replacement.version = next.version + 1;
    return { ok: true, document: replacement };
  }

  return { ok: false, reason: `Unsupported op: ${op.type}` };
};

const handleJoin = (client, message) => {
  const room = getRoom(message.roomCode ?? client.roomCode ?? 'PARK1', message.document);
  client.clientId = message.clientId;
  client.roomCode = room.roomCode;
  client.presence = {
    ...message.presence,
    clientId: message.clientId,
    name: message.name || message.presence?.name || 'Builder',
    roomCode: room.roomCode,
  };
  room.clients.set(client.clientId, client);
  sendFrame(client.socket, {
    type: 'joined',
    roomCode: room.roomCode,
    clientId: client.clientId,
    document: room.document,
    version: room.document.version,
    users: getUsers(room),
  });
  broadcast(room, { type: 'presence', roomCode: room.roomCode, users: getUsers(room) });
};

const handleParkOp = (client, op) => {
  const room = rooms.get(client.roomCode);
  if (!room) {
    sendFrame(client.socket, { type: 'error', reason: 'Join a room before sending edits.' });
    return;
  }

  if (op.type === 'startRun') {
    const runOp = { ...op, serverTime: Date.now(), seed: op.seed ?? Math.floor(Math.random() * 999999) };
    broadcast(room, {
      type: 'parkOpApplied',
      roomCode: room.roomCode,
      version: room.document.version,
      op: runOp,
    });
    return;
  }

  if (op.baseVersion !== room.document.version) {
    sendFrame(client.socket, {
      type: 'opRejected',
      roomCode: room.roomCode,
      clientOpId: op.clientOpId,
      reason: 'Room changed first. Replayed the latest park.',
      version: room.document.version,
      document: room.document,
    });
    return;
  }

  const result = applyServerOp(room.document, op);
  if (!result.ok) {
    sendFrame(client.socket, {
      type: 'opRejected',
      roomCode: room.roomCode,
      clientOpId: op.clientOpId,
      reason: result.reason,
      version: room.document.version,
      document: room.document,
    });
    return;
  }

  room.document = result.document;
  broadcast(room, {
    type: 'parkOpApplied',
    roomCode: room.roomCode,
    version: room.document.version,
    op,
  });
};

const handleMessage = (client, raw) => {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendFrame(client.socket, { type: 'error', reason: 'Invalid JSON message.' });
    return;
  }

  if (message.type === 'join') {
    handleJoin(client, message);
    return;
  }

  if (message.type === 'presence') {
    const room = rooms.get(client.roomCode);
    if (!room) return;
    client.presence = { ...message.presence, clientId: client.clientId, roomCode: room.roomCode };
    broadcast(room, { type: 'presence', roomCode: room.roomCode, users: getUsers(room) });
    return;
  }

  if (message.type === 'parkOp') {
    handleParkOp(client, message.op);
  }
};

export const createRealtimeServer = () => {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }

    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('Use a WebSocket connection for coaster rooms.');
  });

  server.on('upgrade', (request, socket) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }

      const accept = createHash('sha1').update(key + GUID).digest('base64');
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

      const client = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        clientId: '',
        roomCode: url.searchParams.get('room')?.toUpperCase() ?? 'PARK1',
        presence: null,
      };

      socket.on('data', (chunk) => {
        try {
          parseFrames(client, chunk).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendFrame(socket, { type: 'error', reason: error instanceof Error ? error.message : 'Socket parse error.' });
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
  const server = createRealtimeServer();
  server.listen(PORT, () => {
    console.log(`Coaster room server listening on ws://localhost:${PORT}`);
  });
}
