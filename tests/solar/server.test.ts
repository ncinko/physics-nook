import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameServer } from '../../apps/server/src/server.ts';
import { ORBITAL_CONFIG } from '../../packages/shared/src/solar.ts';

const listen = (server: ReturnType<typeof createGameServer>) =>
  new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolve(address.port);
    });
  });

const closeServer = (server: ReturnType<typeof createGameServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const withServer = async (run: (port: number) => Promise<void>) => {
  const server = createGameServer();
  const port = await listen(server);
  try {
    await run(port);
  } finally {
    await closeServer(server);
  }
};

const connectWebSocket = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
    };
    const handleOpen = () => {
      cleanup();
      resolve(socket);
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Could not connect to ${url}`));
    };
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('error', handleError);
  });

const waitForMessage = async <T extends { type?: string }>(
  socket: WebSocket,
  predicate: (message: T) => boolean,
  timeoutMs = 1200,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('error', handleError);
    };
    const handleError = () => {
      cleanup();
      reject(new Error('WebSocket error while waiting for message.'));
    };
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as T;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError);
  });

const sendJson = (socket: WebSocket, message: unknown) => {
  socket.send(JSON.stringify(message));
};

test('root websocket still serves Manatee Royale lobby summaries', async () => {
  await withServer(async (port) => {
    const socket = await connectWebSocket(`ws://127.0.0.1:${port}`);
    try {
      const message = await waitForMessage<{ type: string; lobbies?: unknown[] }>(socket, (candidate) => candidate.type === 'lobbies');

      assert.equal(message.type, 'lobbies');
      assert.equal(Array.isArray(message.lobbies), true);
    } finally {
      socket.close();
    }
  });
});

test('orbitals websocket shares body additions across users and rejects global clear', async () => {
  await withServer(async (port) => {
    const first = await connectWebSocket(`ws://127.0.0.1:${port}/solar`);
    const second = await connectWebSocket(`ws://127.0.0.1:${port}/solar`);

    try {
      sendJson(first, { type: 'solarJoin', name: 'Ada' });

      const firstJoined = await waitForMessage<{
        type: string;
        you: string;
        snapshot: { bodies: Array<{ path: unknown[] }>; playerCount: number };
      }>(first, (message) => message.type === 'solarJoined');

      const firstPresence = waitForMessage<{ type: string; playerCount: number }>(
        first,
        (message) => message.type === 'solarPresence' && message.playerCount === 2,
      );
      const secondJoined = waitForMessage<{ type: string }>(second, (message) => message.type === 'solarJoined');
      sendJson(second, { type: 'solarJoin', name: 'Ben' });
      await secondJoined;
      await firstPresence;

      assert.ok(firstJoined.you);
      assert.equal(firstJoined.snapshot.bodies.length, 2);
      assert.ok(firstJoined.snapshot.bodies.every((body) => body.path.length === 0));

      const addedMessage = waitForMessage<{
        type: string;
        bodies: Array<{ mass: number; x: number; y: number; path: unknown[] }>;
      }>(second, (message) => message.type === 'solarSnapshot' && message.bodies.some((body) => body.mass === 240));
      sendJson(first, {
        type: 'solarAddBody',
        body: { x: 120, y: -40, vx: 0.8, vy: -1.2, mass: 240 },
      });
      const added = await addedMessage;

      const sharedBody = added.bodies.find((body) => body.mass === 240);
      assert.ok(sharedBody);
      assert.ok(Math.abs(sharedBody.x - 120) < 8);
      assert.ok(Math.abs(sharedBody.y + 40) < 8);
      assert.ok(added.bodies.every((body) => body.path.length === 0));

      sendJson(second, { type: 'solarClear' });
      const clearRejected = await waitForMessage<{ type: string; message: string }>(
        second,
        (message) => message.type === 'error' && message.message.includes('Unsupported orbitals message'),
      );
      assert.match(clearRejected.message, /solarClear/);
    } finally {
      first.close();
      second.close();
    }
  });
});

test('orbitals health reports the simplified shared world', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/solar/health`);
    const health = (await response.json()) as { ok: boolean; mode: string; bodies: number };

    assert.equal(health.ok, true);
    assert.equal(health.mode, 'orbitals');
    assert.equal(health.bodies, 2);
    assert.equal(ORBITAL_CONFIG.protocolVersion, 2);
  });
});
