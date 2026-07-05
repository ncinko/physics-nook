// WebSocket connection + tiny store for the coaster slop online client.
//
// Seat credentials live in sessionStorage (per-tab, survives reload) so two
// tabs in one browser hold two different seats; the display name lives in
// localStorage. A player on a fresh device rejoins by room code + same name.

import type {
  CoasterClientToServerMessage,
  CoasterGameState,
  CoasterRoomSnapshot,
  CoasterServerToClientMessage,
} from '../../../../packages/shared/src/coaster.ts';

export type NetStatus = 'connecting' | 'open' | 'closed';

export type NetState = {
  status: NetStatus;
  seat: number | null;
  roomCode: string | null;
  room: CoasterRoomSnapshot | null;
  gameState: CoasterGameState | null;
  error: string | null;
};

const NAME_KEY = 'coaster-name';
const ROOM_KEY = 'coaster-room';
const TOKEN_KEY = 'coaster-token';

const PING_INTERVAL_MS = 25_000;
const ERROR_TTL_MS = 4_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

const searchParams = new URLSearchParams(window.location.search);
const env = import.meta.env as Record<string, string | undefined>;

const resolveWsUrl = (): string => {
  const configured = (searchParams.get('ws') ?? env.VITE_GAME_WS_URL ?? env.PUBLIC_GAME_WS_URL)?.trim();
  if (configured) {
    const url = new URL(configured, window.location.href);
    if (!url.pathname.endsWith('/coaster')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/coaster`;
    }
    return url.toString();
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const hostName = window.location.hostname || 'localhost';
  if (localHosts.has(hostName) || hostName.startsWith('192.168.') || hostName.startsWith('10.') || hostName.endsWith('.local')) {
    return `ws://${hostName}:8788/coaster`;
  }

  if (window.location.protocol === 'https:') {
    return 'wss://ws.physicsnook.com/coaster';
  }

  return `ws://${hostName}:8788/coaster`;
};

export const getStoredName = (): string => localStorage.getItem(NAME_KEY) ?? '';

export const createNet = () => {
  let state: NetState = {
    status: 'connecting',
    seat: null,
    roomCode: null,
    room: null,
    gameState: null,
    error: null,
  };

  const listeners = new Set<() => void>();
  let socket: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let closedForGood = false;

  const emit = () => listeners.forEach((listener) => listener());

  const patch = (updates: Partial<NetState>) => {
    state = { ...state, ...updates };
    emit();
  };

  const setError = (message: string) => {
    if (errorTimer) clearTimeout(errorTimer);
    patch({ error: message });
    errorTimer = setTimeout(() => patch({ error: null }), ERROR_TTL_MS);
  };

  const send = (message: CoasterClientToServerMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const rejoin = () => {
    const roomCode = sessionStorage.getItem(ROOM_KEY);
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (roomCode && token) {
      send({ type: 'coasterJoin', roomCode, name: getStoredName() || 'Player', token });
    }
  };

  const handleMessage = (message: CoasterServerToClientMessage) => {
    if (message.type === 'coasterJoined') {
      sessionStorage.setItem(ROOM_KEY, message.roomCode);
      sessionStorage.setItem(TOKEN_KEY, message.token);
      patch({
        seat: message.seat,
        roomCode: message.roomCode,
        room: message.room,
        gameState: message.state,
      });
    } else if (message.type === 'coasterRoom') {
      patch({ room: message.room });
    } else if (message.type === 'coasterState') {
      patch({ gameState: message.state });
    } else if (message.type === 'error') {
      setError(message.message);
    }
  };

  const connect = () => {
    if (closedForGood) return;
    patch({ status: 'connecting' });

    socket = new WebSocket(resolveWsUrl());

    socket.onopen = () => {
      reconnectAttempts = 0;
      patch({ status: 'open' });
      rejoin();
    };

    socket.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(String(event.data)) as CoasterServerToClientMessage);
      } catch {
        // Ignore malformed frames.
      }
    };

    socket.onclose = () => {
      socket = null;
      patch({ status: 'closed' });
      if (closedForGood) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();
  pingTimer = setInterval(() => send({ type: 'ping', clientTime: Date.now() }), PING_INTERVAL_MS);

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: (): NetState => state,
    createRoom(name: string): void {
      localStorage.setItem(NAME_KEY, name);
      send({ type: 'coasterCreate', name });
    },
    joinRoom(roomCode: string, name: string): void {
      localStorage.setItem(NAME_KEY, name);
      send({ type: 'coasterJoin', roomCode, name });
    },
    leaveRoom(): void {
      send({ type: 'coasterLeave' });
      sessionStorage.removeItem(ROOM_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      patch({ seat: null, roomCode: null, room: null, gameState: null });
    },
    startGame(boardRadius?: number): void {
      send({ type: 'coasterStart', boardRadius });
    },
    restartGame(): void {
      send({ type: 'coasterRestart' });
    },
    dispatchAction(action: { type: string } & Record<string, unknown>): void {
      send({ type: 'coasterAction', action });
    },
    destroy(): void {
      closedForGood = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (errorTimer) clearTimeout(errorTimer);
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
    },
  };
};

export type Net = ReturnType<typeof createNet>;
