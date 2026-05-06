import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameServer } from '../../apps/server/src/server.ts';

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

test('solar websocket spawns players near each other and keeps one ship pilot', async () => {
  await withServer(async (port) => {
    const first = await connectWebSocket(`ws://127.0.0.1:${port}/solar`);
    const second = await connectWebSocket(`ws://127.0.0.1:${port}/solar`);

    try {
      sendJson(first, { type: 'solarJoin', name: 'Ada' });
      sendJson(second, { type: 'solarJoin', name: 'Ben' });

      const firstJoined = await waitForMessage<{
        type: string;
        you: string;
        snapshot: { players: Array<{ id: string; position: { x: number; y: number; z: number } }> };
      }>(first, (message) => message.type === 'solarJoined');
      const secondJoined = await waitForMessage<{
        type: string;
        you: string;
        snapshot: { players: Array<{ id: string; position: { x: number; y: number; z: number } }> };
      }>(second, (message) => message.type === 'solarJoined');

      const firstPlayer = firstJoined.snapshot.players.find((player) => player.id === firstJoined.you);
      const secondPlayer = secondJoined.snapshot.players.find((player) => player.id === secondJoined.you);
      assert.ok(firstPlayer);
      assert.ok(secondPlayer);
      const spawnDistance = Math.hypot(
        firstPlayer.position.x - secondPlayer.position.x,
        firstPlayer.position.y - secondPlayer.position.y,
        firstPlayer.position.z - secondPlayer.position.z,
      );
      assert.ok(spawnDistance < 6);

      sendJson(first, { type: 'solarUse' });
      const piloted = await waitForMessage<{ type: string; ship: { pilotId: string | null } }>(
        first,
        (message) => message.type === 'solarSnapshot' && message.ship.pilotId === firstJoined.you,
      );
      assert.equal(piloted.ship.pilotId, firstJoined.you);

      sendJson(second, { type: 'solarUse' });
      sendJson(second, {
        type: 'solarInput',
        seq: 1,
        input: {
          forward: true,
          backward: false,
          left: false,
          right: false,
          jump: false,
          sprint: false,
          boost: true,
          ascend: false,
          descend: false,
          yawLeft: false,
          yawRight: false,
          pitchUp: false,
          pitchDown: false,
          rollLeft: false,
          rollRight: false,
        },
      });
      const afterSecondUse = await waitForMessage<{ type: string; ship: { pilotId: string | null } }>(
        first,
        (message) => message.type === 'solarSnapshot',
      );
      assert.equal(afterSecondUse.ship.pilotId, firstJoined.you);
    } finally {
      first.close();
      second.close();
    }
  });
});
