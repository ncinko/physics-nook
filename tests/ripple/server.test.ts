import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameServer } from '../../apps/server/src/server.ts';
import { RIPPLE_CONFIG } from '../../packages/shared/src/ripple.ts';

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

test('ripples health reports the shared studio world', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/ripples/health`);
    const health = (await response.json()) as { ok: boolean; mode: string; defaultRoom: string };

    assert.equal(health.ok, true);
    assert.equal(health.mode, 'ripples');
    assert.equal(health.defaultRoom, RIPPLE_CONFIG.defaultRoomCode);
  });
});

test('ripples websocket shares splashes and emitter updates across users', async () => {
  await withServer(async (port) => {
    const first = await connectWebSocket(`ws://127.0.0.1:${port}/ripples?room=lab1`);
    const second = await connectWebSocket(`ws://127.0.0.1:${port}/ripples?room=lab1`);

    try {
      sendJson(first, { type: 'rippleJoin', name: 'Ada', roomCode: 'lab1' });
      const firstJoined = await waitForMessage<{
        type: string;
        you: string;
        snapshot: { roomCode: string; emitters: Array<{ id: string }>; playerCount: number };
      }>(first, (message) => message.type === 'rippleJoined');

      const firstPresence = waitForMessage<{ type: string; playerCount: number }>(
        first,
        (message) => message.type === 'ripplePresence' && message.playerCount === 2,
      );
      const secondJoined = waitForMessage<{ type: string }>(second, (message) => message.type === 'rippleJoined');
      sendJson(second, { type: 'rippleJoin', name: 'Ben', roomCode: 'lab1' });
      await secondJoined;
      await firstPresence;

      assert.equal(firstJoined.snapshot.roomCode, 'LAB1');
      assert.equal(firstJoined.snapshot.emitters.length, 3);
      assert.ok(firstJoined.you);

      const splashMessage = waitForMessage<{
        type: string;
        recentSplashes: Array<{ createdBy: string; x: number; y: number; strength: number }>;
      }>(
        second,
        (message) =>
          message.type === 'rippleSnapshot' &&
          message.recentSplashes.some((splash) => splash.createdBy === firstJoined.you),
      );
      sendJson(first, { type: 'rippleSplash', splash: { x: 0.24, y: 0.48, strength: 1.7 } });
      const splashSnapshot = await splashMessage;
      const splash = splashSnapshot.recentSplashes.find((candidate) => candidate.createdBy === firstJoined.you);
      assert.ok(splash);
      assert.equal(splash.x, 0.24);
      assert.equal(splash.y, 0.48);
      assert.equal(splash.strength, 1.7);

      const emitterMessage = waitForMessage<{
        type: string;
        emitters: Array<{ id: string; x: number; controlledBy: string | null }>;
      }>(
        second,
        (message) =>
          message.type === 'rippleSnapshot' &&
          message.emitters.some((emitter) => emitter.id === 'cool-left' && emitter.x === 0.62),
      );
      sendJson(first, { type: 'rippleEmitterUpdate', id: 'cool-left', patch: { x: 0.62, y: 0.27 } });
      const emitterSnapshot = await emitterMessage;
      const emitter = emitterSnapshot.emitters.find((candidate) => candidate.id === 'cool-left');
      assert.ok(emitter);
      assert.equal(emitter.controlledBy, firstJoined.you);
    } finally {
      first.close();
      second.close();
    }
  });
});

test('ripples websocket handles pause, reset, and invalid payloads', async () => {
  await withServer(async (port) => {
    const socket = await connectWebSocket(`ws://127.0.0.1:${port}/ripples`);

    try {
      sendJson(socket, { type: 'rippleJoin', name: 'Ada' });
      await waitForMessage<{ type: string }>(socket, (message) => message.type === 'rippleJoined');

      const pausedMessage = waitForMessage<{ type: string; paused: boolean }>(
        socket,
        (message) => message.type === 'rippleSnapshot' && message.paused === true,
      );
      sendJson(socket, { type: 'rippleSetPaused', paused: true });
      await pausedMessage;

      const resetMessage = waitForMessage<{
        type: string;
        paused: boolean;
        resetVersion: number;
        recentSplashes: unknown[];
      }>(socket, (message) => message.type === 'rippleSnapshot' && message.resetVersion === 1);
      sendJson(socket, { type: 'rippleReset' });
      const resetSnapshot = await resetMessage;
      assert.equal(resetSnapshot.paused, false);
      assert.equal(resetSnapshot.recentSplashes.length, 0);

      const errorMessage = waitForMessage<{ type: string; message: string }>(
        socket,
        (message) => message.type === 'error' && message.message.includes('Invalid ripple splash'),
      );
      sendJson(socket, { type: 'rippleSplash', splash: { x: 'bad', y: 0.3 } });
      await errorMessage;
    } finally {
      socket.close();
    }
  });
});
