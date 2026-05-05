import './styles.css';

import {
  DEFAULT_INPUT,
  GAME_CONFIG,
  GAME_MAP,
  LOBBY_CODES,
  LOBBY_NAMES,
  TEAM_BASE_COLORS,
  TEAM_COLORS,
  TEAM_DARK_COLORS,
  getRoleForSlot,
  getTeamForSlot,
} from '../../../packages/shared/src/index.ts';
import type {
  BerrySnapshot,
  ClientToServerMessage,
  GameBase,
  GameMap,
  InputState,
  LobbyCode,
  LobbySummary,
  PlayerRole,
  PlayerSnapshot,
  RoomPlayer,
  RoomSnapshot,
  ServerToClientMessage,
  Team,
  UpgradeGate,
  WorldSnapshot,
} from '../../../packages/shared/src/index.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

const INPUT_FLUSH_MS = 1000 / 30;
const PING_INTERVAL_MS = 2000;
const SNAPSHOT_BUFFER_MAX = 10;
const SNAPSHOT_INTERPOLATION_DELAY_MS = Math.round((1000 / GAME_CONFIG.snapshotRate) * 1.6);
const MAX_EXTRAPOLATION_MS = Math.round(1000 / GAME_CONFIG.snapshotRate);
const SNAPSHOT_TELEPORT_DISTANCE = 180;
const CANVAS_BASE_WIDTH = GAME_CONFIG.arena.width;
const CANVAS_BASE_HEIGHT = GAME_CONFIG.arena.height;
const PLAYER_WIDTH = GAME_CONFIG.player.width;
const PLAYER_HEIGHT = GAME_CONFIG.player.height;
const MANATEE_WIDTH = GAME_MAP.snail.width;
const MANATEE_HEIGHT = GAME_MAP.snail.height;
const MAX_LIVES = GAME_CONFIG.player.queenLives;
const MAX_PEARLS = GAME_CONFIG.objective.berriesToWin;
const PLAYER_NAME_MAX_LENGTH = 3;

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
const menuManatee = document.getElementById('menuManatee') as HTMLCanvasElement | null;
const nameInput = document.getElementById('nameInput') as HTMLInputElement | null;
const statusText = document.getElementById('statusText');
const connectionPill = document.getElementById('connectionPill');
const playerCount = document.getElementById('playerCount');
const menuOverlay = document.getElementById('menuOverlay');
const lobbyOverlay = document.getElementById('lobbyOverlay');
const lobbyCards = document.getElementById('lobbyCards');
const lobbyName = document.getElementById('lobbyName');
const lobbyStatus = document.getElementById('lobbyStatus');
const readyButton = document.getElementById('readyButton') as HTMLButtonElement | null;
const leaveButton = document.getElementById('leaveButton') as HTMLButtonElement | null;
const scoreOverlay = document.getElementById('scoreOverlay');
const scoreTitle = document.getElementById('scoreTitle');
const scoreStats = document.getElementById('scoreStats');
const scoreCountdown = document.getElementById('scoreCountdown');

if (
  !canvas ||
  !menuManatee ||
  !nameInput ||
  !statusText ||
  !connectionPill ||
  !playerCount ||
  !menuOverlay ||
  !lobbyOverlay ||
  !lobbyCards ||
  !lobbyName ||
  !lobbyStatus ||
  !readyButton ||
  !leaveButton ||
  !scoreOverlay ||
  !scoreTitle ||
  !scoreStats ||
  !scoreCountdown
) {
  throw new Error('Game client markup is missing required elements.');
}

const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D is unavailable.');
}

const menuManateeContext = menuManatee.getContext('2d');
if (!menuManateeContext) {
  throw new Error('Menu manatee canvas 2D is unavailable.');
}

context.imageSmoothingEnabled = false;
menuManateeContext.imageSmoothingEnabled = false;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const input: InputState = { ...DEFAULT_INPUT };
let socket: WebSocket | null = null;
let localPlayerId: string | null = null;
let room: RoomSnapshot | null = null;
let latestSnapshot: WorldSnapshot | null = null;
let snapshotBuffer: WorldSnapshot[] = [];
let serverClockOffsetMs: number | null = null;
let lobbySummaries: LobbySummary[] = [];
let pendingJoin: LobbyCode | null = null;
let inputSeq = 0;
let latencyMs: number | null = null;
let lastInputFlush = 0;
let lastPingAt = 0;
let connectionState: ConnectionState = 'offline';
let frameCount = 0;
let frameDelta = 1;
let lastFrameAt = 0;

const clashFx: { x: number; y: number; framesLeft: number; lifeFrames: number }[] = [];
const particles: Particle[] = [];
const backgroundBubbles = Array.from({ length: 140 }, (_, index) => ({
  x: (index * 251) % CANVAS_BASE_WIDTH,
  y: (index * 397) % CANVAS_BASE_HEIGHT,
  speed: 0.5 + (index % 7) * 0.25,
  size: 2 + (index % 6),
  phase: index * 0.63,
}));

const getConfiguredWsUrl = (): string | null => {
  const configured = env.VITE_GAME_WS_URL ?? env.PUBLIC_GAME_WS_URL;
  return configured?.trim() || null;
};

const getDefaultWsUrl = (): string => {
  const configured = getConfiguredWsUrl();
  if (configured) return configured;

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const host = window.location.hostname || 'localhost';

  if (localHosts.has(host) || host.startsWith('192.168.') || host.startsWith('10.') || host.endsWith('.local')) {
    return `ws://${host}:8788`;
  }

  if (window.location.protocol === 'https:') {
    return 'wss://ws.physicsnook.com';
  }

  return `ws://${host}:8788`;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const positiveModulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const lerpPosition = (from: number, to: number, amount: number): number =>
  Math.abs(to - from) > SNAPSHOT_TELEPORT_DISTANCE ? to : lerp(from, to, amount);

const cloneSnapshot = (snapshot: WorldSnapshot): WorldSnapshot => ({
  ...snapshot,
  players: snapshot.players.map((player) => ({ ...player })),
  berries: snapshot.berries.map((berry) => ({ ...berry })),
  scores: { ...snapshot.scores },
  queenKills: { ...snapshot.queenKills },
  snail: { ...snapshot.snail },
  hiveCells: snapshot.hiveCells.map((cell) => ({ ...cell })),
  clamshells: snapshot.clamshells.map((clam) => ({ ...clam })),
  upgradeGates: snapshot.upgradeGates.map((gate) => ({ ...gate })),
  clashEvents: [],
  jumpEvents: [],
  deathEvents: [],
  winner: snapshot.winner ? { ...snapshot.winner } : null,
});

const interpolatePlayer = (from: PlayerSnapshot, to: PlayerSnapshot, amount: number): PlayerSnapshot => {
  const snap =
    from.alive !== to.alive ||
    from.beingEaten !== to.beingEaten ||
    from.role !== to.role ||
    from.team !== to.team ||
    from.slot !== to.slot ||
    Math.abs(to.x - from.x) > SNAPSHOT_TELEPORT_DISTANCE ||
    Math.abs(to.y - from.y) > SNAPSHOT_TELEPORT_DISTANCE;

  return {
    ...to,
    x: snap ? to.x : lerp(from.x, to.x, amount),
    y: snap ? to.y : lerp(from.y, to.y, amount),
    vx: snap ? to.vx : lerp(from.vx, to.vx, amount),
    vy: snap ? to.vy : lerp(from.vy, to.vy, amount),
    upgradeProgress: snap ? to.upgradeProgress : lerp(from.upgradeProgress, to.upgradeProgress, amount),
  };
};

const interpolateBerry = (from: BerrySnapshot, to: BerrySnapshot, amount: number): BerrySnapshot => {
  const snap =
    from.carriedBy !== to.carriedBy ||
    from.depositedTeam !== to.depositedTeam ||
    Math.abs(to.x - from.x) > SNAPSHOT_TELEPORT_DISTANCE ||
    Math.abs(to.y - from.y) > SNAPSHOT_TELEPORT_DISTANCE;

  return {
    ...to,
    x: snap ? to.x : lerp(from.x, to.x, amount),
    y: snap ? to.y : lerp(from.y, to.y, amount),
  };
};

const interpolateSnapshot = (from: WorldSnapshot, to: WorldSnapshot, amount: number): WorldSnapshot => {
  if (from.roomCode !== to.roomCode || from.phase !== to.phase) {
    return cloneSnapshot(to);
  }

  const playersById = new Map(from.players.map((player) => [player.id, player]));
  const berriesById = new Map(from.berries.map((berry) => [berry.id, berry]));

  return {
    ...to,
    tick: Math.round(lerp(from.tick, to.tick, amount)),
    serverTime: lerp(from.serverTime, to.serverTime, amount),
    timeElapsed: lerp(from.timeElapsed, to.timeElapsed, amount),
    players: to.players.map((player) => {
      const previous = playersById.get(player.id);
      return previous ? interpolatePlayer(previous, player, amount) : { ...player };
    }),
    berries: to.berries.map((berry) => {
      const previous = berriesById.get(berry.id);
      return previous ? interpolateBerry(previous, berry, amount) : { ...berry };
    }),
    scores: { ...to.scores },
    queenKills: { ...to.queenKills },
    snail: {
      ...to.snail,
      x: lerpPosition(from.snail.x, to.snail.x, amount),
      y: lerpPosition(from.snail.y, to.snail.y, amount),
    },
    hiveCells: to.hiveCells.map((cell) => ({ ...cell })),
    clamshells: to.clamshells.map((clam) => ({ ...clam })),
    upgradeGates: to.upgradeGates.map((gate) => ({ ...gate })),
    clashEvents: [],
    jumpEvents: [],
    deathEvents: [],
    winner: to.winner ? { ...to.winner } : null,
  };
};

const updateServerClockOffset = (snapshot: WorldSnapshot, receivedAt = performance.now()): void => {
  const nextOffset = snapshot.serverTime - receivedAt;
  serverClockOffsetMs = serverClockOffsetMs === null ? nextOffset : serverClockOffsetMs * 0.9 + nextOffset * 0.1;
};

const clearSnapshotState = (): void => {
  latestSnapshot = null;
  snapshotBuffer = [];
  serverClockOffsetMs = null;
};

const resetSnapshotState = (snapshot: WorldSnapshot): void => {
  latestSnapshot = snapshot;
  snapshotBuffer = [snapshot];
  serverClockOffsetMs = null;
  updateServerClockOffset(snapshot);
};

const queueSnapshot = (snapshot: WorldSnapshot): void => {
  latestSnapshot = snapshot;
  updateServerClockOffset(snapshot);

  const last = snapshotBuffer.at(-1);
  if (!last || last.roomCode !== snapshot.roomCode || snapshot.tick < last.tick) {
    snapshotBuffer = [snapshot];
    return;
  }

  if (last.tick === snapshot.tick) {
    snapshotBuffer[snapshotBuffer.length - 1] = snapshot;
  } else {
    snapshotBuffer.push(snapshot);
  }

  if (snapshotBuffer.length > SNAPSHOT_BUFFER_MAX) {
    snapshotBuffer.splice(0, snapshotBuffer.length - SNAPSHOT_BUFFER_MAX);
  }
};

const getRenderableSnapshot = (time: number): WorldSnapshot | null => {
  if (!latestSnapshot) return null;
  if (snapshotBuffer.length < 2 || serverClockOffsetMs === null) return latestSnapshot;

  const renderServerTime = time + serverClockOffsetMs - SNAPSHOT_INTERPOLATION_DELAY_MS;

  while (snapshotBuffer.length > 2 && snapshotBuffer[1].serverTime <= renderServerTime) {
    snapshotBuffer.shift();
  }

  if (renderServerTime <= snapshotBuffer[0].serverTime) {
    return snapshotBuffer[0];
  }

  for (let index = 1; index < snapshotBuffer.length; index += 1) {
    const previous = snapshotBuffer[index - 1];
    const next = snapshotBuffer[index];

    if (renderServerTime <= next.serverTime) {
      const span = Math.max(1, next.serverTime - previous.serverTime);
      return interpolateSnapshot(previous, next, clamp01((renderServerTime - previous.serverTime) / span));
    }
  }

  const newest = snapshotBuffer.at(-1);
  const previous = snapshotBuffer.at(-2);
  if (!newest || !previous) return latestSnapshot;

  if (newest.phase !== 'playing') return newest;

  const span = Math.max(1, newest.serverTime - previous.serverTime);
  const overrun = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, renderServerTime - newest.serverTime));
  return interpolateSnapshot(previous, newest, 1 + overrun / span);
};

const sanitizeAlias = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '')
    .slice(0, PLAYER_NAME_MAX_LENGTH);

const teamColor = (team: Team): string => TEAM_COLORS[team];
const teamDarkColor = (team: Team): string => TEAM_DARK_COLORS[team];
const teamBaseColor = (team: Team): string => TEAM_BASE_COLORS[team];

const createParticles = (x: number, y: number, color: string, count: number, speed: number): void => {
  for (let i = 0; i < count; i += 1) {
    const life = 30 + Math.random() * 30;
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed - 1,
      life,
      maxLife: life,
      color,
      size: 3 + Math.random() * 5,
    });
  }
};

const roleLabel = (role?: PlayerRole): string => {
  if (role === 'queen') return 'QUEEN';
  if (role === 'warrior') return 'WARRIOR';
  return 'WORKER';
};

const victoryLabel = (reason: NonNullable<WorldSnapshot['winner']>['reason']): string => {
  if (reason === 'economic') return 'Economic Victory';
  if (reason === 'manatee') return 'Manatee Victory';
  return 'Military Victory';
};

const getLocalRoomPlayer = (): RoomPlayer | null =>
  localPlayerId && room ? (room.players.find((player) => player.id === localPlayerId) ?? null) : null;

const formatRoomPingLabel = (roomName = room?.name): string => {
  if (!roomName) return latencyMs !== null ? `Lobby ${latencyMs} ms` : 'Choose lobby';
  return latencyMs !== null ? `${roomName} ${latencyMs} ms` : roomName;
};

const setConnectionState = (state: ConnectionState, label?: string): void => {
  connectionState = state;
  connectionPill.dataset.state = state;
  statusText.textContent = label ?? (state === 'online' && latencyMs !== null ? `Online ${latencyMs} ms` : state);
};

const sendMessage = (message: ClientToServerMessage): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

const sendInput = (): void => {
  if (!localPlayerId || connectionState !== 'online' || latestSnapshot?.phase !== 'playing') return;
  inputSeq += 1;
  sendMessage({ type: 'input', seq: inputSeq, input: { ...input } });
};

const setUiPhase = (): void => {
  const phase = room?.phase ?? latestSnapshot?.phase ?? 'menu';
  document.body.dataset.phase = phase;
  menuOverlay.hidden = Boolean(room);
  lobbyOverlay.hidden = !room || room.phase !== 'lobby';
  scoreOverlay.hidden = !(room?.phase === 'score' || latestSnapshot?.phase === 'score');
};

const lobbyStatusText = (summary: LobbySummary): string => {
  if (summary.phase === 'playing') return `${summary.playerCount}/${summary.maxPlayers} playing`;
  if (summary.phase === 'score') return 'score screen';
  if (!summary.hasBlueQueen || !summary.hasRedQueen) return `${summary.playerCount}/${summary.maxPlayers} waiting`;
  return `${summary.readyCount}/${summary.playerCount || 1} ready`;
};

const renderLobbyCards = (): void => {
  lobbyCards.replaceChildren();

  for (const roomCode of LOBBY_CODES) {
    const summary =
      lobbySummaries.find((candidate) => candidate.roomCode === roomCode) ??
      ({
        roomCode,
        name: LOBBY_NAMES[roomCode],
        phase: 'lobby',
        playerCount: 0,
        maxPlayers: GAME_CONFIG.maxPlayers,
        readyCount: 0,
        hasBlueQueen: false,
        hasRedQueen: false,
        winner: null,
        scoreScreenEndsAt: null,
      } satisfies LobbySummary);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lobby-card';
    button.disabled = connectionState !== 'online' || summary.phase !== 'lobby' || summary.playerCount >= summary.maxPlayers;
    button.innerHTML = `
      <strong>${summary.name}</strong>
      ${summary.phase === 'lobby' ? '' : `<span>${summary.phase}</span>`}
      <small>${lobbyStatusText(summary)}</small>
    `;
    button.addEventListener('click', () => joinLobby(roomCode));
    lobbyCards.append(button);
  }
};

const renderLobby = (): void => {
  setUiPhase();

  if (!room) {
    playerCount.textContent = '0/10';
    return;
  }

  const players = room.players;
  playerCount.textContent = `${players.length}/${GAME_CONFIG.maxPlayers}`;
  lobbyName.textContent = room.name;

  const local = getLocalRoomPlayer();
  const hasBlueQueen = players.some((player) => player.team === 'blue' && player.role === 'queen');
  const hasRedQueen = players.some((player) => player.team === 'red' && player.role === 'queen');
  const readyCount = players.filter((player) => player.ready).length;

  if (!hasBlueQueen || !hasRedQueen) {
    lobbyStatus.textContent = 'Both queen slots must be filled before the game can begin.';
  } else {
    lobbyStatus.textContent = `${readyCount}/${players.length} ready. The round starts automatically when everyone is ready.`;
  }

  readyButton.textContent = local?.ready ? 'Unready' : 'Ready';
  readyButton.classList.toggle('is-ready', Boolean(local?.ready));
  readyButton.disabled = !local;

  for (let slot = 0; slot < GAME_CONFIG.maxPlayers; slot += 1) {
    const player = players.find((candidate) => candidate.slot === slot);
    const button = document.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`);
    if (!button) continue;

    const team = getTeamForSlot(slot);
    const role = getRoleForSlot(slot);
    button.className = `${player ? `team-${team}` : 'is-open'}${player?.id === localPlayerId ? ' is-local' : ''}`;
    button.disabled = Boolean(player && player.id !== localPlayerId);
    button.replaceChildren();

    const roleSpan = document.createElement('span');
    roleSpan.className = 'slot-role';
    roleSpan.textContent = roleLabel(role);
    button.append(roleSpan);

    const name = document.createElement('span');
    name.className = 'slot-name';
    name.textContent = player?.name ?? 'Open';
    button.append(name);

    const state = document.createElement('span');
    state.className = `slot-state${player?.ready ? ' is-ready' : ''}`;
    state.textContent = player ? (player.ready ? 'READY' : 'WAIT') : 'OPEN';
    button.append(state);
  }
};

const renderScoreOverlay = (): void => {
  const winner = room?.winner ?? latestSnapshot?.winner;
  const endsAt = room?.scoreScreenEndsAt ?? latestSnapshot?.roundEndsAt ?? null;

  if (!winner || (room?.phase !== 'score' && latestSnapshot?.phase !== 'score')) return;

  const secondsLeft = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 20;
  scoreTitle.textContent = `${winner.team.toUpperCase()} WINS`;
  scoreStats.textContent = `Pearls ${latestSnapshot?.scores.blue ?? 0}-${latestSnapshot?.scores.red ?? 0} | Queen falls ${latestSnapshot?.queenKills.blue ?? 0}-${latestSnapshot?.queenKills.red ?? 0} | ${victoryLabel(winner.reason)}`;
  scoreCountdown.textContent = `Returning to lobby in ${secondsLeft}s`;
};

const handleJoined = (message: Extract<ServerToClientMessage, { type: 'joined' }>): void => {
  localPlayerId = message.you;
  room = message.room;
  resetSnapshotState(message.snapshot);
  pendingJoin = null;
  setConnectionState('online', formatRoomPingLabel(message.room.name));
  renderLobby();
};

const handleRoomUpdate = (message: Extract<ServerToClientMessage, { type: 'room' }>): void => {
  room = message.room;
  setConnectionState('online', formatRoomPingLabel(message.room.name));
  renderLobby();
};

const handleSnapshot = (message: WorldSnapshot): void => {
  queueSnapshot(message);
  for (const event of message.clashEvents ?? []) {
    clashFx.push({ x: event.x, y: event.y, framesLeft: 18, lifeFrames: 18 });
  }
  for (const event of message.jumpEvents ?? []) {
    createParticles(event.x, event.y, '#d9fbff', 5, 3.4);
  }
  for (const event of message.deathEvents ?? []) {
    createParticles(event.x, event.y, teamColor(event.team), 32, 9);
    createParticles(event.x, event.y, '#fff4b8', 12, 7);
  }
  if (room && room.roomCode === message.roomCode && room.phase !== message.phase) {
    room = { ...room, phase: message.phase, winner: message.winner, scoreScreenEndsAt: message.roundEndsAt };
  }
  setUiPhase();
};

const handleSocketMessage = (event: MessageEvent): void => {
  let message: ServerToClientMessage;

  try {
    message = JSON.parse(String(event.data)) as ServerToClientMessage;
  } catch {
    setConnectionState('error', 'Bad message');
    return;
  }

  if (message.type === 'joined') {
    handleJoined(message);
    return;
  }

  if (message.type === 'lobbies') {
    lobbySummaries = message.lobbies;
    renderLobbyCards();
    return;
  }

  if (message.type === 'room') {
    handleRoomUpdate(message);
    return;
  }

  if (message.type === 'snapshot') {
    handleSnapshot(message);
    return;
  }

  if (message.type === 'pong') {
    latencyMs = Math.max(0, Math.round(performance.now() - message.clientTime));
    if (connectionState === 'online' && room) {
      setConnectionState('online', formatRoomPingLabel(room.name));
    }
    return;
  }

  if (message.type === 'error') {
    setConnectionState('error', message.message);
  }
};

const connect = (): void => {
  const wsUrl = getDefaultWsUrl();

  if (socket && socket.readyState !== WebSocket.CLOSED) return;

  setConnectionState('connecting', 'Connecting');
  renderLobbyCards();

  const nextSocket = new WebSocket(wsUrl);
  socket = nextSocket;

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return;

    setConnectionState('connecting', 'Joining');
    if (pendingJoin) {
      joinLobby(pendingJoin);
    } else {
      setConnectionState('online', 'Choose lobby');
      renderLobbyCards();
    }
  });

  nextSocket.addEventListener('message', handleSocketMessage);

  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return;

    setConnectionState('offline', 'Offline');
    localPlayerId = null;
    room = null;
    clearSnapshotState();
    socket = null;
    setUiPhase();
    renderLobby();
    renderLobbyCards();
  });

  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return;

    setConnectionState('error', 'Socket error');
    renderLobbyCards();
  });
};

const joinLobby = (roomCode: LobbyCode): void => {
  const name = sanitizeAlias(nameInput.value);
  nameInput.value = name;
  localStorage.setItem('physics-nook-game-name', name);
  localStorage.setItem('physics-nook-game-room', roomCode);
  pendingJoin = roomCode;

  if (!socket || socket.readyState === WebSocket.CLOSED) {
    connect();
    return;
  }

  if (socket.readyState !== WebSocket.OPEN) {
    setConnectionState('connecting', 'Connecting');
    return;
  }

  setConnectionState('connecting', `Joining ${LOBBY_NAMES[roomCode]}`);
  sendMessage({ type: 'join', roomCode, name });
};

const setInput = (action: keyof InputState, pressed: boolean): void => {
  if (input[action] === pressed) return;
  input[action] = pressed;
  sendInput();
};

const resetInput = (): void => {
  let changed = false;

  for (const action of Object.keys(input) as (keyof InputState)[]) {
    if (input[action]) {
      input[action] = false;
      changed = true;
    }
  }

  if (changed) sendInput();
};

const actionForKey = (event: KeyboardEvent): keyof InputState | null => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') return 'left';
  if (event.code === 'ArrowRight' || event.code === 'KeyD') return 'right';
  if (event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'Space') return 'jump';
  if (event.code === 'ArrowDown' || event.code === 'KeyS') return 'down';
  return null;
};

document.addEventListener('keydown', (event) => {
  const action = actionForKey(event);
  if (!action) return;

  event.preventDefault();
  setInput(action, true);
});

document.addEventListener('keyup', (event) => {
  const action = actionForKey(event);
  if (!action) return;

  event.preventDefault();
  setInput(action, false);
});

window.addEventListener('blur', resetInput);

nameInput.addEventListener('input', () => {
  const sanitized = sanitizeAlias(nameInput.value);
  if (nameInput.value !== sanitized) {
    nameInput.value = sanitized;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
  const action = button.dataset.control as keyof InputState;

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setInput(action, true);
  });

  const release = (event: PointerEvent): void => {
    event.preventDefault();
    setInput(action, false);
  };

  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => setInput(action, false));
});

readyButton.addEventListener('click', () => {
  const local = getLocalRoomPlayer();
  if (!local) return;
  sendMessage({ type: 'setReady', ready: !local.ready });
});

leaveButton.addEventListener('click', () => {
  sendMessage({ type: 'leaveLobby' });
  localPlayerId = null;
  room = null;
  clearSnapshotState();
  setConnectionState(socket?.readyState === WebSocket.OPEN ? 'online' : 'offline', socket?.readyState === WebSocket.OPEN ? 'Choose lobby' : 'Offline');
  setUiPhase();
  renderLobbyCards();
});

document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((button) => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.slot);
    if (Number.isInteger(slot)) {
      sendMessage({ type: 'moveSlot', slot });
    }
  });
});

const drawRoundRect = (x: number, y: number, width: number, height: number, radius: number): void => {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
};

const drawWorldText = (
  text: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    weight?: string;
    maxWidth?: number;
    stroke?: boolean;
  } = {},
): void => {
  context.font = `${options.weight ?? '700'} ${options.size ?? 24}px "Courier New", monospace`;
  context.textAlign = options.align ?? 'left';
  context.textBaseline = options.baseline ?? 'alphabetic';
  if (options.stroke ?? true) {
    context.strokeStyle = '#000914';
    context.lineWidth = Math.max(3, Math.round((options.size ?? 24) / 7));
    context.strokeText(text, x, y, options.maxWidth);
  }
  context.fillStyle = options.color ?? '#ffffff';
  context.fillText(text, x, y, options.maxWidth);
};

const drawCrown = (x: number, y: number, isLost: boolean, accent = '#ff4757'): void => {
  context.save();
  context.translate(x, y);
  if (isLost) context.globalAlpha = 0.4;

  context.fillStyle = '#ffd700';
  context.fillRect(4, 16, 24, 8);
  context.fillRect(2, 8, 6, 8);
  context.fillRect(13, 10, 6, 6);
  context.fillRect(24, 8, 6, 8);

  context.fillStyle = accent;
  context.fillRect(0, 4, 8, 6);
  context.fillRect(12, 6, 8, 6);
  context.fillRect(24, 4, 8, 6);

  if (isLost) {
    context.globalAlpha = 1;
    context.strokeStyle = '#ff4757';
    context.lineWidth = 6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-4, -2);
    context.lineTo(36, 28);
    context.moveTo(36, -2);
    context.lineTo(-4, 28);
    context.stroke();
  }
  context.restore();
};

const drawPearl = (x: number, y: number, size = 20): void => {
  const shadow = Math.max(2, Math.floor(size * 0.2));
  const highlight = Math.max(4, Math.floor(size * 0.4));
  context.fillStyle = '#dfe6e9';
  context.fillRect(x, y, size, size);
  context.fillStyle = '#b2bec3';
  context.fillRect(x, y + size - shadow, size, shadow);
  context.fillRect(x + size - shadow, y, shadow, size);
  context.fillStyle = '#ffffff';
  context.fillRect(x + Math.floor(size * 0.2), y + Math.floor(size * 0.2), highlight, highlight);
};

const drawBackgroundDecorations = (): void => {
  context.fillStyle = 'rgba(60, 40, 100, 0.4)';
  for (let i = 0; i < CANVAS_BASE_WIDTH; i += 180) {
    const h = 40 + Math.sin(i) * 60;
    context.fillRect(i + 40, 1000 - h, 20, h);
    context.fillRect(i + 30, 1000 - h + 20, 40, 10);
    context.fillRect(i + 45, 1000 - h - 10, 10, 10);
  }
};

const drawBackground = (): void => {
  const bgGrad = context.createLinearGradient(0, 0, 0, CANVAS_BASE_HEIGHT);
  bgGrad.addColorStop(0, '#1c456b');
  bgGrad.addColorStop(1, '#2a6592');
  context.fillStyle = bgGrad;
  context.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

  drawBackgroundDecorations();

  for (const bubble of backgroundBubbles) {
    const y = positiveModulo(bubble.y - frameCount * bubble.speed + CANVAS_BASE_HEIGHT + 20, CANVAS_BASE_HEIGHT + 40) - 20;
    const x = bubble.x + Math.sin(frameCount * 0.02 + bubble.phase) * 6;
    context.fillStyle = 'rgba(217, 251, 255, 0.36)';
    context.fillRect(x, y, bubble.size, bubble.size);
    context.fillStyle = 'rgba(255, 255, 255, 0.55)';
    context.fillRect(x + 1, y + 1, Math.max(1, bubble.size - 3), Math.max(1, bubble.size - 3));
  }

  context.fillStyle = '#c2b280';
  context.fillRect(0, 1020, CANVAS_BASE_WIDTH, 60);
  for (let i = 0; i < CANVAS_BASE_WIDTH; i += 120) {
    context.beginPath();
    context.ellipse(i + 60, 1030, 80, 20, 0, 0, Math.PI, true);
    context.fill();
  }
};

const drawBase = (base: GameBase, score: number): void => {
  context.fillStyle = teamBaseColor(base.team);
  context.fillRect(base.x, base.y, base.width, base.height);

  for (let index = 0; index < base.slots.length; index += 1) {
    const slot = base.slots[index];
    const slotX = base.x + slot.x;
    const slotY = base.y + slot.y;
    const px = slotX - 12;
    const py = slotY - 12;

    context.fillStyle = '#050a12';
    context.fillRect(px, py, 24, 24);
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(px, py, 24, 4);
    context.fillRect(px, py, 4, 24);

    if (index < score) {
      drawPearl(slotX - 10, slotY - 10, 20);
    }
  }

  context.fillStyle = teamColor(base.team);
  context.fillRect(base.x, base.y + base.height - 10, base.width, 10);
};

const drawGateIcon = (gate: UpgradeGate): void => {
  context.save();
  context.translate(gate.x + gate.width / 2, gate.y - 24);
  context.fillStyle = '#ffffff';

  if (gate.type === 'warrior') {
    context.rotate(-0.55);
    context.fillRect(-3, -20, 6, 38);
    context.fillRect(-11, 8, 22, 5);
    context.fillRect(-2, -25, 4, 8);
    context.rotate(1.1);
    context.fillRect(-3, -20, 6, 38);
    context.fillRect(-11, 8, 22, 5);
    context.fillRect(-2, -25, 4, 8);
  } else {
    context.fillStyle = '#241700';
    context.fillRect(-1, -29, 16, 10);
    context.fillRect(-10, -21, 16, 10);
    context.fillRect(-19, -13, 24, 10);
    context.fillRect(-3, -5, 16, 10);
    context.fillRect(-12, 3, 16, 10);
    context.fillRect(-21, 11, 16, 10);
    context.fillRect(-29, 19, 14, 9);

    context.fillStyle = '#ffe766';
    context.fillRect(-4, -32, 16, 10);
    context.fillRect(-13, -24, 16, 10);
    context.fillRect(-22, -16, 24, 10);
    context.fillRect(-6, -8, 16, 10);
    context.fillRect(-15, 0, 16, 10);
    context.fillRect(-24, 8, 16, 10);
    context.fillRect(-32, 16, 14, 9);

    context.fillStyle = '#ffffff';
    context.fillRect(2, -32, 5, 8);
    context.fillRect(-7, -24, 5, 8);
  }

  context.restore();
};

const drawGate = (gate: UpgradeGate): void => {
  const color = gate.ownerTeam ? teamColor(gate.ownerTeam) : '#9aa4ad';
  context.fillStyle = '#111111';
  context.fillRect(gate.x + 10, gate.y + 20, gate.width - 20, gate.height - 20);

  context.fillStyle = color;
  const time = frameCount / 12;
  for (let i = 0; i < 5; i += 1) {
    const wave = Math.sin(time + i) * 6;
    context.fillRect(gate.x + 10 + i * 12 + wave, gate.y + 10, 8, gate.height - 10);
  }

  context.strokeStyle = color;
  context.lineWidth = 4;
  context.strokeRect(gate.x, gate.y, gate.width, gate.height);
  drawGateIcon(gate);
};

const drawPlatform = (platform: GameMap['platforms'][number]): void => {
  context.fillStyle = '#b85f8c';
  context.fillRect(platform.x, platform.y, platform.width, platform.height);

  context.fillStyle = '#9b4a72';
  for (let i = 0; i < platform.width; i += 24) {
    if (i % 48 === 0) context.fillRect(platform.x + i, platform.y + 12, 12, 12);
  }

  context.fillStyle = '#39c488';
  context.fillRect(platform.x, platform.y, platform.width, 8);
  for (let i = 10; i < platform.width - 10; i += 30) {
    context.fillRect(platform.x + i, platform.y - 4, 8, 4);
  }
};

const drawClamshell = (clam: WorldSnapshot['clamshells'][number] | GameMap['clamShells'][number]): void => {
  const pearlsInside = 'pearlsInside' in clam ? clam.pearlsInside : 3;

  context.save();
  context.translate(clam.x, clam.y);

  const shellBase = '#e1b16a';
  const shellDark = '#c68d45';
  const shellOutline = '#432918';
  const innerFlesh = '#e84e56';
  const innerShadow = '#b8323a';
  const shellLip = '#f5d596';

  const topScallops = [
    { x: 4, y: -12 },
    { x: 13, y: -16 },
    { x: 22, y: -18 },
    { x: 31, y: -16 },
    { x: 40, y: -12 },
  ];

  const botScallops = [
    { x: 4, y: 24 },
    { x: 13, y: 28 },
    { x: 22, y: 30 },
    { x: 31, y: 28 },
    { x: 40, y: 24 },
  ];

  context.fillStyle = shellOutline;
  context.fillRect(4, -8, 42, 24);
  for (const s of topScallops) {
    context.fillRect(s.x, s.y, 8, 10);
    context.fillRect(s.x + 1, s.y - 2, 6, 2);
  }

  context.fillStyle = shellBase;
  context.fillRect(6, -6, 38, 22);
  for (const s of topScallops) {
    context.fillRect(s.x + 1, s.y + 2, 6, 10);
    context.fillRect(s.x + 2, s.y, 4, 2);
  }

  context.fillStyle = shellDark;
  for (const s of topScallops) {
    context.fillRect(s.x + 3, s.y + 2, 2, -s.y + 14);
  }

  context.fillStyle = innerFlesh;
  context.fillRect(6, -2, 38, 18);
  for (const s of topScallops) {
    context.fillRect(s.x + 1, s.y + 6, 6, 6);
  }

  context.fillStyle = innerShadow;
  context.fillRect(6, 6, 38, 10);

  if (pearlsInside > 0) {
    const startX = 25 - ((pearlsInside * 13 - 3) / 2);
    for (let i = 0; i < pearlsInside; i += 1) {
      drawPearl(Math.floor(startX + i * 13), 8, 10);
    }
  }

  context.fillStyle = shellOutline;
  context.fillRect(4, 16, 42, 8);
  for (const s of botScallops) {
    context.fillRect(s.x, 16, 8, s.y - 16);
    context.fillRect(s.x + 1, s.y, 6, 2);
  }

  context.fillStyle = shellBase;
  context.fillRect(6, 18, 38, 4);
  for (const s of botScallops) {
    context.fillRect(s.x + 1, 18, 6, s.y - 20);
    context.fillRect(s.x + 2, s.y - 2, 4, 2);
  }

  context.fillStyle = shellDark;
  for (const s of botScallops) {
    context.fillRect(s.x + 3, 18, 2, s.y - 20);
  }

  context.fillStyle = shellLip;
  context.fillRect(5, 16, 40, 2);
  for (const s of botScallops) {
    context.fillRect(s.x + 2, 14, 4, 2);
  }

  context.restore();
};

const drawFlag = (baseX: number, poleY: number, color: string, flip: boolean): void => {
  context.fillStyle = '#7f8fa6';
  context.fillRect(baseX, poleY, 8, 140);
  context.fillStyle = color;
  context.fillRect(baseX - 4, poleY - 6, 16, 8);

  const startX = flip ? baseX - 60 : baseX + 8;
  const startY = poleY + 10;
  const sq = 10;
  const time = frameCount / 12;

  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      context.fillStyle = (r + c) % 2 === 0 ? '#f5f6fa' : '#2f3640';
      const wave = Math.sin(time + c) * 4;
      context.fillRect(startX + c * sq, startY + r * sq + wave, sq, sq + 1);
    }
  }
};

const drawManateeSprite = (renderContext: CanvasRenderingContext2D, eatingTargetId: string | null = null): void => {
  renderContext.fillStyle = '#89a397';
  renderContext.fillRect(-45, -15, 90, 30);
  renderContext.fillRect(-35, -20, 75, 5);
  renderContext.fillRect(45, -5, 10, 20);
  renderContext.fillRect(-55, 0, 16, 25);
  renderContext.fillRect(-60, 10, 5, 15);

  renderContext.fillStyle = '#5a6e60';
  renderContext.fillRect(-25, -20, 15, 5);
  renderContext.fillRect(-15, -15, 10, 5);
  renderContext.fillRect(0, -15, 8, 5);
  renderContext.fillRect(5, -10, 5, 5);
  renderContext.fillRect(-35, -10, 8, 5);
  renderContext.fillRect(15, 15, 12, 22);
  renderContext.fillRect(42, 5, 4, 10);
  renderContext.fillRect(46, 10, 12, 4);

  renderContext.fillStyle = '#111111';
  renderContext.fillRect(35, -5, 4, 4);

  if (eatingTargetId) {
    renderContext.fillStyle = '#89a397';
    const jawDrop = Math.sin(frameCount / 5) * 4 + 4;
    renderContext.fillRect(45, 15 + jawDrop, 10, 8);
  }
};

const drawMenuManatee = (): void => {
  menuManateeContext.clearRect(0, 0, menuManatee.width, menuManatee.height);
  menuManateeContext.save();
  menuManateeContext.translate(82, 40);
  menuManateeContext.scale(1.25, 1.25);
  menuManateeContext.scale(-1, 1);
  drawManateeSprite(menuManateeContext);
  menuManateeContext.restore();
};

const drawManatee = (snapshot: WorldSnapshot | null): void => {
  const snail = snapshot?.snail ?? { x: GAME_MAP.snail.startX, y: GAME_MAP.snail.y, facing: -1, eatingTargetId: null };
  const baseY = GAME_MAP.snail.y;

  drawFlag(120, baseY - 80, TEAM_COLORS.blue, true);
  drawFlag(CANVAS_BASE_WIDTH - 128, baseY - 80, TEAM_COLORS.red, false);

  context.save();
  context.translate(snail.x + MANATEE_WIDTH / 2, snail.y + MANATEE_HEIGHT / 2);
  if (snail.facing < 0) context.scale(-1, 1);

  drawManateeSprite(context, snail.eatingTargetId);

  context.restore();
};

const drawDroppedPearl = (pearl: BerrySnapshot): void => {
  drawPearl(pearl.x, pearl.y, 20);
};

const drawWorker = (player: PlayerSnapshot, snapshot: WorldSnapshot): void => {
  const color = teamColor(player.team);
  const dark = teamDarkColor(player.team);
  const time = frameCount / 9;

  context.fillStyle = color;
  context.fillRect(-12, -16, 24, 6);
  context.fillRect(-16, -10, 32, 16);

  context.fillStyle = '#111111';
  context.fillRect(6, -6, 6, 6);

  const ridingManatee = snapshot.snail.riderId === player.id;
  const offset = ridingManatee ? Math.sin(time) * 4 : Math.sin(time + player.x) * 4;
  context.fillStyle = dark;
  context.fillRect(-14 + offset, 6, 6, 14);
  context.fillRect(-4 - offset, 6, 6, 18);
  context.fillRect(6 + offset, 6, 6, 14);
  context.fillRect(12 - offset, 6, 6, 16);
};

const drawOctopus = (player: PlayerSnapshot): void => {
  const color = teamColor(player.team);
  const dark = teamDarkColor(player.team);
  const time = frameCount / 9;

  context.fillStyle = dark;
  context.fillRect(-18, -22, 36, 26);
  context.fillStyle = color;
  context.fillRect(-16, -20, 32, 22);
  context.fillRect(-20, -2, 40, 12);

  context.fillStyle = '#ffffff';
  context.fillRect(4, -12, 10, 8);
  context.fillStyle = '#000000';
  context.fillRect(6, -10, 6, 6);

  const tentacleOffset = Math.sin(time * 2) * 3;
  context.fillStyle = color;
  context.fillRect(-18, 10, 8, 10 + tentacleOffset);
  context.fillRect(-6, 10, 8, 14 - tentacleOffset);
  context.fillRect(6, 10, 8, 12 + tentacleOffset);
  context.fillRect(16, 10, 8, 10 - tentacleOffset);

  context.fillStyle = '#ffd700';
  context.fillRect(12, -2, 42, 6);
  context.fillRect(48, -16, 6, 32);
  context.fillRect(54, -18, 10, 6);
  context.fillRect(54, -4, 14, 6);
  context.fillRect(54, 10, 10, 6);

  if (player.role === 'queen') {
    context.fillStyle = '#ffd700';
    context.fillRect(-8, -26, 16, 4);
    context.fillRect(-12, -30, 4, 8);
    context.fillRect(-2, -30, 4, 4);
    context.fillRect(8, -30, 4, 8);
  }
};

const drawPlayerName = (player: PlayerSnapshot): void => {
  const cx = player.x + PLAYER_WIDTH / 2;
  const y = player.y - (player.role === 'queen' ? 48 : 38);
  const label = player.name.slice(0, PLAYER_NAME_MAX_LENGTH);

  drawWorldText(label, cx, y, {
    size: 15,
    color: '#ffffff',
    align: 'center',
    baseline: 'middle',
    maxWidth: 56,
  });
};

const drawUpgradeProgress = (player: PlayerSnapshot): void => {
  if (player.upgradeProgress <= 0) return;

  const barW = 40;
  const barH = 8;
  const xPos = player.x + PLAYER_WIDTH / 2 - barW / 2;
  const yPos = player.y - 18;
  context.fillStyle = 'rgba(0, 0, 0, 0.8)';
  context.fillRect(xPos - 2, yPos - 2, barW + 4, barH + 4);
  context.fillStyle = teamColor(player.team);
  context.fillRect(xPos, yPos, barW * clamp01(player.upgradeProgress / GAME_CONFIG.objective.upgradeTicks), barH);
};

const drawPlayer = (player: PlayerSnapshot, snapshot: WorldSnapshot): void => {
  if (!player.alive) return;
  if (player.invincibleUntil > snapshot.serverTime && Math.floor(frameCount / 6) % 2 === 0) return;

  context.save();
  if (player.beingEaten) {
    context.translate(player.x + PLAYER_WIDTH / 2 + (Math.random() * 6 - 3), player.y + PLAYER_HEIGHT / 2 + (Math.random() * 6 - 3));
  } else {
    context.translate(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2);
  }

  if (player.speedBoost && !player.beingEaten) {
    context.fillStyle = 'rgba(255, 255, 100, 0.2)';
    context.beginPath();
    context.arc(0, 0, 24, 0, Math.PI * 2);
    context.fill();
  }

  if (player.facing < 0) context.scale(-1, 1);

  if (player.role === 'warrior' || player.role === 'queen') {
    drawOctopus(player);
  } else {
    drawWorker(player, snapshot);
  }

  if (player.carriedBerryId) {
    context.fillStyle = '#ffffff';
    context.fillRect(-8, -PLAYER_HEIGHT / 2 - 20, 16, 16);
    context.fillStyle = '#bce6ff';
    context.fillRect(-4, -PLAYER_HEIGHT / 2 - 18, 6, 6);
  }

  context.restore();

  if (player.id === localPlayerId) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.strokeRect(player.x - 4, player.y - 4, PLAYER_WIDTH + 8, PLAYER_HEIGHT + 8);
  }

  drawUpgradeProgress(player);
  drawPlayerName(player);
};

const drawPlayers = (snapshot: WorldSnapshot): void => {
  const players = [...snapshot.players].sort((a, b) => {
    if (a.id === localPlayerId) return 1;
    if (b.id === localPlayerId) return -1;
    return a.y - b.y;
  });

  for (const player of players) {
    drawPlayer(player, snapshot);
  }
};

const drawParticles = (): void => {
  context.save();
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    const alpha = Math.max(0, particle.life / particle.maxLife);

    context.globalAlpha = alpha;
    context.fillStyle = particle.color;
    context.fillRect(Math.round(particle.x), Math.round(particle.y), Math.round(particle.size), Math.round(particle.size));

    if (particle.size > 4) {
      context.globalAlpha = alpha * 0.62;
      context.fillStyle = '#ffffff';
      context.fillRect(Math.round(particle.x + 1), Math.round(particle.y + 1), Math.max(1, Math.floor(particle.size / 2)), Math.max(1, Math.floor(particle.size / 2)));
    }

    particle.x += particle.vx * frameDelta;
    particle.y += particle.vy * frameDelta;
    particle.vx *= Math.pow(0.98, frameDelta);
    particle.vy -= 0.02 * frameDelta;
    particle.life -= frameDelta;

    if (particle.life <= 0) {
      particles.splice(i, 1);
    }
  }
  context.restore();
};

const drawClashFx = (): void => {
  for (let i = clashFx.length - 1; i >= 0; i -= 1) {
    const fx = clashFx[i];
    const age = 1 - fx.framesLeft / fx.lifeFrames;
    const radius = 8 + age * 28;
    const alpha = 1 - age;

    context.fillStyle = `rgba(255, 238, 187, ${0.25 * alpha})`;
    context.beginPath();
    context.arc(fx.x, fx.y, radius * 1.4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
    context.beginPath();
    context.arc(fx.x, fx.y, Math.max(2, radius * 0.35), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = `rgba(255, 242, 168, ${0.9 * alpha})`;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(fx.x - radius * 1.6, fx.y);
    context.lineTo(fx.x + radius * 1.6, fx.y);
    context.moveTo(fx.x, fx.y - radius * 1.6);
    context.lineTo(fx.x, fx.y + radius * 1.6);
    context.stroke();

    fx.framesLeft -= frameDelta;
    if (fx.framesLeft <= 0) clashFx.splice(i, 1);
  }
};

const drawHud = (snapshot: WorldSnapshot): void => {
  const blueQueen = snapshot.players.find((player) => player.team === 'blue' && player.role === 'queen');
  const redQueen = snapshot.players.find((player) => player.team === 'red' && player.role === 'queen');

  for (let i = 0; i < MAX_LIVES; i += 1) {
    drawCrown(40 + i * 45, 30, !blueQueen || i >= blueQueen.lives, TEAM_COLORS.blue);
  }
  for (let i = 0; i < MAX_LIVES; i += 1) {
    drawCrown(CANVAS_BASE_WIDTH - 72 - i * 45, 30, !redQueen || i >= redQueen.lives, TEAM_COLORS.red);
  }

  drawWorldText(`${snapshot.scores.blue}/${MAX_PEARLS}`, 40, 92, {
    size: 24,
    color: TEAM_COLORS.blue,
    align: 'left',
  });
  drawWorldText(`${snapshot.scores.red}/${MAX_PEARLS}`, CANVAS_BASE_WIDTH - 40, 92, {
    size: 24,
    color: TEAM_COLORS.red,
    align: 'right',
  });
};

const drawScoreBanner = (snapshot: WorldSnapshot): void => {
  if (!snapshot.winner) return;

  const title = `${snapshot.winner.team.toUpperCase()} WINS!`;
  const subtitle = victoryLabel(snapshot.winner.reason);
  context.fillStyle = 'rgba(0, 9, 20, 0.82)';
  context.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
  drawWorldText(title, CANVAS_BASE_WIDTH / 2, CANVAS_BASE_HEIGHT / 2 - 36, {
    size: 72,
    color: teamColor(snapshot.winner.team),
    align: 'center',
    weight: '900',
  });
  drawWorldText(subtitle, CANVAS_BASE_WIDTH / 2, CANVAS_BASE_HEIGHT / 2 + 24, {
    size: 34,
    color: '#48dbfb',
    align: 'center',
    weight: '800',
  });
};

const drawArena = (snapshot: WorldSnapshot | null): void => {
  drawBackground();

  const scores = snapshot?.scores ?? { blue: 0, red: 0 };
  for (const base of GAME_MAP.bases) {
    drawBase(base, scores[base.team]);
  }

  const gates = snapshot?.upgradeGates ?? GAME_MAP.upgradeGates;
  for (const gate of gates) {
    drawGate(gate);
  }

  for (const platform of GAME_MAP.platforms) {
    drawPlatform(platform);
  }

  drawManatee(snapshot);

  const clams = snapshot?.clamshells ?? GAME_MAP.clamShells;
  for (const clam of clams) {
    drawClamshell(clam);
  }

  if (snapshot) {
    for (const pearl of snapshot.berries) {
      drawDroppedPearl(pearl);
    }
    drawPlayers(snapshot);
    drawClashFx();
    drawHud(snapshot);
    if (snapshot.phase === 'score') {
      drawScoreBanner(snapshot);
    }
    drawParticles();
  }
};

const drawWorld = (time: number): void => {
  const renderSnapshot = getRenderableSnapshot(time);
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const scale = Math.min(cssWidth / CANVAS_BASE_WIDTH, cssHeight / CANVAS_BASE_HEIGHT);
  const worldWidth = CANVAS_BASE_WIDTH * scale;
  const worldHeight = CANVAS_BASE_HEIGHT * scale;
  const offsetX = (cssWidth - worldWidth) / 2;
  const offsetY = (cssHeight - worldHeight) / 2;

  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000914';
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  context.beginPath();
  context.rect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
  context.clip();
  drawArena(renderSnapshot);
  context.restore();

  if (!renderSnapshot && !room) {
    context.fillStyle = 'rgba(0, 9, 20, 0.78)';
    drawRoundRect(cssWidth / 2 - 210, cssHeight / 2 - 42, 420, 84, 8);
    context.fill();
    context.fillStyle = '#dceffc';
    context.font = '800 18px "Courier New", monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Choose a lobby to enter Manatee Royale', cssWidth / 2, cssHeight / 2);
  }
};

const resizeCanvas = (): void => {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
};

const animationFrame = (time: number): void => {
  frameDelta = lastFrameAt > 0 ? Math.min(2, Math.max(0.25, (time - lastFrameAt) / (1000 / 60))) : 1;
  lastFrameAt = time;
  frameCount += frameDelta;
  resizeCanvas();
  renderScoreOverlay();

  if (time - lastInputFlush >= INPUT_FLUSH_MS) {
    sendInput();
    lastInputFlush = time;
  }

  if (socket?.readyState === WebSocket.OPEN && time - lastPingAt >= PING_INTERVAL_MS) {
    sendMessage({ type: 'ping', clientTime: time });
    lastPingAt = time;
  }

  drawWorld(time);
  window.requestAnimationFrame(animationFrame);
};

const hydrateSavedInputs = (): void => {
  nameInput.value = sanitizeAlias(localStorage.getItem('physics-nook-game-name') ?? '');
};

hydrateSavedInputs();
drawMenuManatee();
renderLobbyCards();
renderLobby();
setConnectionState('offline', 'Offline');
connect();
window.requestAnimationFrame(animationFrame);
