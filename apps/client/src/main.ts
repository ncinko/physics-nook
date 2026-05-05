import './styles.css';

import {
  DEFAULT_INPUT,
  GAME_CONFIG,
  GAME_MAP,
  normalizeRoomCode,
} from '../../../packages/shared/src/index.ts';
import type {
  ClientToServerMessage,
  GameMap,
  InputState,
  PlayerSnapshot,
  RoomPlayer,
  RoomSnapshot,
  ServerToClientMessage,
  Team,
  WorldSnapshot,
} from '../../../packages/shared/src/index.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
const joinForm = document.getElementById('joinForm') as HTMLFormElement | null;
const roomInput = document.getElementById('roomInput') as HTMLInputElement | null;
const nameInput = document.getElementById('nameInput') as HTMLInputElement | null;
const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
const statusText = document.getElementById('statusText');
const connectionPill = document.getElementById('connectionPill');
const endpointText = document.getElementById('endpointText');
const rosterList = document.getElementById('rosterList');
const playerCount = document.getElementById('playerCount');

if (!canvas || !joinForm || !roomInput || !nameInput || !joinButton || !statusText || !connectionPill || !endpointText || !rosterList || !playerCount) {
  throw new Error('Game client markup is missing required elements.');
}

const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D is unavailable.');
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const input: InputState = { ...DEFAULT_INPUT };
let socket: WebSocket | null = null;
let localPlayerId: string | null = null;
let room: RoomSnapshot | null = null;
let latestSnapshot: WorldSnapshot | null = null;
let inputSeq = 0;
let latencyMs: number | null = null;
let lastInputFlush = 0;
let lastPingAt = 0;
let connectionState: ConnectionState = 'offline';

const INPUT_FLUSH_MS = 1000 / 30;
const PING_INTERVAL_MS = 2000;

const getConfiguredWsUrl = (): string | null => {
  const configured = env.VITE_GAME_WS_URL ?? env.PUBLIC_GAME_WS_URL;
  return configured?.trim() || null;
};

const getDefaultWsUrl = (): string => {
  const configured = getConfiguredWsUrl();
  if (configured) {
    return configured;
  }

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

const setConnectionState = (state: ConnectionState, label?: string): void => {
  connectionState = state;
  connectionPill.dataset.state = state;
  statusText.textContent = label ?? (state === 'online' && latencyMs !== null ? `Online ${latencyMs} ms` : state);
};

const sendMessage = (message: ClientToServerMessage): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
};

const sendInput = (): void => {
  if (!localPlayerId || connectionState !== 'online') {
    return;
  }

  inputSeq += 1;
  sendMessage({ type: 'input', seq: inputSeq, input: { ...input } });
};

const renderRoster = (): void => {
  const players = room?.players ?? [];
  rosterList.replaceChildren();
  playerCount.textContent = `${players.length}/${GAME_CONFIG.maxPlayers}`;

  for (let slot = 0; slot < GAME_CONFIG.maxPlayers; slot += 1) {
    const player = players.find((candidate) => candidate.slot === slot);
    const item = document.createElement('li');
    item.className = `roster-slot ${player ? `team-${player.team}` : 'is-open'}${player?.id === localPlayerId ? ' is-local' : ''}`;

    const slotBadge = document.createElement('span');
    slotBadge.className = 'slot-badge';
    slotBadge.textContent = String(slot + 1).padStart(2, '0');
    item.append(slotBadge);

    const name = document.createElement('span');
    name.className = 'slot-name';
    name.textContent = player?.name ?? 'Open';
    item.append(name);

    const team = document.createElement('span');
    team.className = 'slot-team';
    team.textContent = player ? player.team : '';
    item.append(team);

    rosterList.append(item);
  }
};

const handleJoined = (message: Extract<ServerToClientMessage, { type: 'joined' }>): void => {
  localPlayerId = message.you;
  room = message.room;
  latestSnapshot = message.snapshot;
  setConnectionState('online', `Room ${message.room.roomCode}`);
  joinButton.disabled = false;
  renderRoster();
};

const handleRoomUpdate = (message: Extract<ServerToClientMessage, { type: 'room' }>): void => {
  room = message.room;
  renderRoster();
};

const handleSnapshot = (message: WorldSnapshot): void => {
  latestSnapshot = message;
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
      setConnectionState('online', `Room ${room.roomCode} ${latencyMs} ms`);
    }
    return;
  }

  if (message.type === 'error') {
    setConnectionState('error', message.message);
  }
};

const connect = (): void => {
  const roomCode = normalizeRoomCode(roomInput.value);
  const name = nameInput.value.trim();
  const wsUrl = getDefaultWsUrl();

  roomInput.value = roomCode;
  localStorage.setItem('physics-nook-game-room', roomCode);
  localStorage.setItem('physics-nook-game-name', name);
  endpointText.textContent = wsUrl.replace(/^wss?:\/\//, '');

  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.close(1000, 'Rejoining');
  }

  setConnectionState('connecting', 'Connecting');
  joinButton.disabled = true;
  room = null;
  latestSnapshot = null;
  localPlayerId = null;
  renderRoster();

  const nextSocket = new WebSocket(wsUrl);
  socket = nextSocket;

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) {
      return;
    }

    setConnectionState('connecting', 'Joining');
    sendMessage({ type: 'join', roomCode, name });
  });

  nextSocket.addEventListener('message', handleSocketMessage);

  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) {
      return;
    }

    setConnectionState('offline', 'Offline');
    joinButton.disabled = false;
    localPlayerId = null;
    socket = null;
    renderRoster();
  });

  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) {
      return;
    }

    setConnectionState('error', 'Socket error');
    joinButton.disabled = false;
  });
};

const setInput = (action: keyof InputState, pressed: boolean): void => {
  if (input[action] === pressed) {
    return;
  }

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

  if (changed) {
    sendInput();
  }
};

const actionForKey = (event: KeyboardEvent): keyof InputState | null => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') return 'left';
  if (event.code === 'ArrowRight' || event.code === 'KeyD') return 'right';
  if (event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'Space') return 'jump';
  return null;
};

document.addEventListener('keydown', (event) => {
  const action = actionForKey(event);
  if (!action) {
    return;
  }

  event.preventDefault();
  setInput(action, true);
});

document.addEventListener('keyup', (event) => {
  const action = actionForKey(event);
  if (!action) {
    return;
  }

  event.preventDefault();
  setInput(action, false);
});

window.addEventListener('blur', resetInput);

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

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  connect();
});

const drawRoundRect = (x: number, y: number, width: number, height: number, radius: number): void => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
};

const drawPlatform = (platform: GameMap['platforms'][number]): void => {
  context.fillStyle = platform.kind === 'floor' ? '#2d2419' : '#4a3520';
  context.strokeStyle = platform.kind === 'floor' ? '#6c4d2b' : '#a06d2e';
  context.lineWidth = platform.kind === 'floor' ? 4 : 3;
  drawRoundRect(platform.x, platform.y, platform.width, platform.height, platform.kind === 'floor' ? 0 : 7);
  context.fill();
  context.stroke();

  context.fillStyle = platform.kind === 'floor' ? '#8f6b35' : '#d59b3a';
  context.fillRect(platform.x, platform.y, platform.width, Math.min(5, platform.height));
};

const drawArena = (map: GameMap): void => {
  context.fillStyle = '#151711';
  context.fillRect(0, 0, map.width, map.height);

  context.fillStyle = '#1f3328';
  context.fillRect(0, 0, map.width, 190);
  context.fillStyle = '#1a2a31';
  context.fillRect(0, 190, map.width, 210);
  context.fillStyle = '#211f18';
  context.fillRect(0, 400, map.width, map.height - 400);

  context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  context.lineWidth = 1;
  for (let x = 80; x < map.width; x += 80) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, map.height);
    context.stroke();
  }
  for (let y = 80; y < map.height; y += 80) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(map.width, y);
    context.stroke();
  }

  context.strokeStyle = 'rgba(245, 182, 66, 0.55)';
  context.setLineDash([12, 14]);
  context.beginPath();
  context.moveTo(map.width / 2, 54);
  context.lineTo(map.width / 2, map.height - 76);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = 'rgba(245, 182, 66, 0.14)';
  context.fillRect(92, 472, 300, 170);
  context.fillStyle = 'rgba(42, 157, 244, 0.14)';
  context.fillRect(map.width - 392, 472, 300, 170);

  for (const platform of map.platforms) {
    drawPlatform(platform);
  }
};

const drawNameplate = (player: PlayerSnapshot): void => {
  const label = player.name;
  context.font = '15px Inter, ui-sans-serif, system-ui, sans-serif';
  const width = Math.min(140, context.measureText(label).width + 18);
  const x = -width / 2;
  const y = -GAME_CONFIG.player.height / 2 - 27;

  context.fillStyle = player.id === localPlayerId ? 'rgba(255, 255, 255, 0.92)' : 'rgba(17, 18, 15, 0.78)';
  drawRoundRect(x, y, width, 20, 8);
  context.fill();
  context.fillStyle = player.id === localPlayerId ? '#11120f' : '#f7f3e8';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, y + 10, width - 12);
};

const teamAccent = (team: Team): string => (team === 'gold' ? '#f5b642' : '#2a9df4');

const drawPlayer = (player: PlayerSnapshot): void => {
  const width = GAME_CONFIG.player.width;
  const height = GAME_CONFIG.player.height;

  context.save();
  context.translate(player.x, player.y);

  if (player.id === localPlayerId) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(0, 4, width * 0.85, height * 0.68, 0, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = player.team === 'gold' ? 'rgba(245, 182, 66, 0.24)' : 'rgba(42, 157, 244, 0.24)';
  context.beginPath();
  context.ellipse(-width * 0.42, -height * 0.1, width * 0.45, height * 0.24, -0.55, 0, Math.PI * 2);
  context.ellipse(width * 0.42, -height * 0.1, width * 0.45, height * 0.24, 0.55, 0, Math.PI * 2);
  context.fill();

  context.scale(player.facing, 1);
  context.fillStyle = player.color;
  drawRoundRect(-width / 2, -height / 2, width, height, 9);
  context.fill();

  context.fillStyle = '#11120f';
  drawRoundRect(-width / 2 + 6, -height / 2 + 8, width - 12, 13, 6);
  context.fill();

  context.fillStyle = '#f7f3e8';
  context.fillRect(4, -height / 2 + 12, 7, 4);

  context.fillStyle = teamAccent(player.team);
  context.fillRect(-width / 2 + 5, height / 2 - 12, width - 10, 5);

  context.restore();

  context.save();
  context.translate(player.x, player.y);
  drawNameplate(player);
  context.restore();
};

const drawWorld = (): void => {
  const map = room?.map ?? GAME_MAP;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = Math.min(width / map.width, height / map.height);
  const worldWidth = map.width * scale;
  const worldHeight = map.height * scale;
  const offsetX = (width - worldWidth) / 2;
  const offsetY = (height - worldHeight) / 2;

  context.fillStyle = '#0e100d';
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  drawArena(map);

  const players = latestSnapshot?.players ?? [];
  for (const player of players) {
    drawPlayer(player);
  }

  context.restore();
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
  resizeCanvas();

  if (time - lastInputFlush >= INPUT_FLUSH_MS) {
    sendInput();
    lastInputFlush = time;
  }

  if (socket?.readyState === WebSocket.OPEN && time - lastPingAt >= PING_INTERVAL_MS) {
    sendMessage({ type: 'ping', clientTime: time });
    lastPingAt = time;
  }

  drawWorld();
  window.requestAnimationFrame(animationFrame);
};

const hydrateSavedInputs = (): void => {
  roomInput.value = normalizeRoomCode(localStorage.getItem('physics-nook-game-room') ?? roomInput.value);
  nameInput.value = localStorage.getItem('physics-nook-game-name') ?? '';
  endpointText.textContent = getDefaultWsUrl().replace(/^wss?:\/\//, '');
};

hydrateSavedInputs();
renderRoster();
setConnectionState('offline', 'Offline');
window.requestAnimationFrame(animationFrame);
