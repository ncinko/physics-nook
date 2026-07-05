// Shared protocol for coaster slop ("coaster") online rooms.
//
// The game state itself is produced by packages/coaster/game/reducer.js (plain
// JS, machine-synced from the coaster slop repo) — its shape is owned there, so it
// stays untyped here.

export const COASTER_PROTOCOL_VERSION = 1;

export const COASTER_MIN_PLAYERS = 2;
export const COASTER_MAX_PLAYERS = 4;

export type CoasterGameState = Record<string, unknown>;

export type CoasterGameAction = { type: string } & Record<string, unknown>;

export type CoasterSeat = {
  seat: number;
  name: string;
  connected: boolean;
  isHost: boolean;
};

export type CoasterRoomPhase = 'lobby' | 'playing' | 'ended';

export type CoasterRoomSnapshot = {
  roomCode: string;
  phase: CoasterRoomPhase;
  seats: CoasterSeat[];
  maxSeats: number;
  canStart: boolean;
};

export type CoasterClientToServerMessage =
  | { type: 'coasterCreate'; name: string }
  | { type: 'coasterJoin'; roomCode: string; name: string; token?: string }
  | { type: 'coasterLeave' }
  | { type: 'coasterStart' }
  | { type: 'coasterRestart' }
  | { type: 'coasterAction'; action: CoasterGameAction }
  | { type: 'ping'; clientTime: number };

export type CoasterServerToClientMessage =
  | {
      type: 'coasterJoined';
      protocolVersion: number;
      roomCode: string;
      seat: number;
      token: string;
      room: CoasterRoomSnapshot;
      state: CoasterGameState | null;
    }
  | { type: 'coasterRoom'; room: CoasterRoomSnapshot }
  | { type: 'coasterState'; state: CoasterGameState }
  | { type: 'error'; message: string }
  | { type: 'pong'; clientTime: number; serverTime: number };

// No 0/O/1/I/L — room codes get read out loud across the table.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const COASTER_ROOM_CODE_LENGTH = 4;

export const generateCoasterRoomCode = (): string => {
  let code = '';
  for (let i = 0; i < COASTER_ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
};

export const normalizeCoasterRoomCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z2-9]{4}$/.test(code) ? code : null;
};

export const sanitizeCoasterName = (raw: unknown, fallback: string): string => {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 16);
  return name.length > 0 ? name : fallback;
};
