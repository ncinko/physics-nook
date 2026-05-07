import './ripple-styles.css';

import {
  RIPPLE_CONFIG,
  normalizeRippleRoomCode,
} from '../../../packages/shared/src/ripple.ts';
import type {
  RippleClientToServerMessage,
  RippleEmitterPatch,
  RippleEmitterSnapshot,
  RippleServerToClientMessage,
  RippleSnapshot,
  RippleSplashEvent,
} from '../../../packages/shared/src/ripple.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

type GridState = {
  previous: Float32Array;
  current: Float32Array;
  next: Float32Array;
};

type PoolSize = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

type PointerMode = 'splash' | 'emitter';

type DragState = {
  active: boolean;
  pointerId: number | null;
  mode: PointerMode;
  emitterId: string | null;
  lastX: number;
  lastY: number;
  lastAt: number;
};

const canvas = document.getElementById('rippleCanvas') as HTMLCanvasElement | null;
const roomLabel = document.getElementById('roomLabel');
const playerCount = document.getElementById('playerCount');
const emitterCount = document.getElementById('emitterCount');
const connectionPill = document.getElementById('connectionPill');
const statusText = document.getElementById('statusText');
const pauseButton = document.getElementById('pauseButton') as HTMLButtonElement | null;
const resetButton = document.getElementById('resetButton') as HTMLButtonElement | null;
const emitterButtons = document.getElementById('emitterButtons');
const selectedEmitterLabel = document.getElementById('selectedEmitterLabel');
const amplitudeInput = document.getElementById('amplitudeInput') as HTMLInputElement | null;
const frequencyInput = document.getElementById('frequencyInput') as HTMLInputElement | null;
const phaseInput = document.getElementById('phaseInput') as HTMLInputElement | null;
const enableButton = document.getElementById('enableButton') as HTMLButtonElement | null;

if (
  !canvas ||
  !roomLabel ||
  !playerCount ||
  !emitterCount ||
  !connectionPill ||
  !statusText ||
  !pauseButton ||
  !resetButton ||
  !emitterButtons ||
  !selectedEmitterLabel ||
  !amplitudeInput ||
  !frequencyInput ||
  !phaseInput ||
  !enableButton
) {
  throw new Error('Ripple Tank Studio markup is missing required elements.');
}

const ctx = canvas.getContext('2d', { alpha: true });
if (!ctx) {
  throw new Error('Could not initialize Ripple Tank canvas.');
}

const MIN_COLS = 52;
const MAX_COLS = 132;
const MIN_ROWS = 28;
const MAX_ROWS = 88;
const CELL_TARGET = 14;
const DAMPING = 0.9976;
const SIDE_DAMPING_LAYER_CELLS = 10;
const SIDE_DAMPING_MAX = 0.18;
const VERTICAL_DAMPING_LAYER_CELLS = 5;
const VERTICAL_DAMPING_MAX = 0.82;
const DRAG_INTERVAL_MS = 65;
const EMITTER_SEND_INTERVAL_MS = 44;
const PING_INTERVAL_MS = 2000;
const SPLASH_PROCESSED_LIMIT = 500;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const searchParams = new URLSearchParams(window.location.search);
const roomCode = normalizeRippleRoomCode(searchParams.get('room') ?? undefined);

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const createGridState = (cols: number, rows: number): GridState => {
  const size = cols * rows;
  return {
    previous: new Float32Array(size),
    current: new Float32Array(size),
    next: new Float32Array(size),
  };
};

const emptyDragState = (): DragState => ({
  active: false,
  pointerId: null,
  mode: 'splash',
  emitterId: null,
  lastX: 0,
  lastY: 0,
  lastAt: 0,
});

let socket: WebSocket | null = null;
let connectionState: ConnectionState = 'offline';
let localPlayerId: string | null = null;
let latestSnapshot: RippleSnapshot | null = null;
let emitters: RippleEmitterSnapshot[] = [];
let selectedEmitterId = 'cool-left';
let paused = false;
let resetVersion = -1;
let dpr = 1;
let simTime = 0;
let lastFrameAt = performance.now();
let lastPingAt = 0;
let lastEmitterSendAt = 0;
let processedSplashIds = new Set<string>();

const size: PoolSize = {
  width: 0,
  height: 0,
  cols: MIN_COLS,
  rows: MIN_ROWS,
  cellWidth: 1,
  cellHeight: 1,
};
let grid = createGridState(MIN_COLS, MIN_ROWS);
let dragState = emptyDragState();

const setConnectionState = (state: ConnectionState, label: string): void => {
  connectionState = state;
  connectionPill.dataset.state = state;
  statusText.textContent = label;
};

const getConfiguredWsUrl = (): string | null => {
  const configured = searchParams.get('ws') ?? env.VITE_GAME_WS_URL ?? env.PUBLIC_GAME_WS_URL;
  return configured?.trim() || null;
};

const appendRipplePath = (base: string): string => {
  const url = new URL(base, window.location.href);
  if (!url.pathname.endsWith('/ripples')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/ripples`;
  }
  url.searchParams.set('room', roomCode);
  return url.toString();
};

const getDefaultWsUrl = (): string => {
  const configured = getConfiguredWsUrl();
  if (configured) return appendRipplePath(configured);

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const hostName = window.location.hostname || 'localhost';
  if (localHosts.has(hostName) || hostName.startsWith('192.168.') || hostName.startsWith('10.') || hostName.endsWith('.local')) {
    return `ws://${hostName}:8788/ripples?room=${encodeURIComponent(roomCode)}`;
  }

  if (window.location.protocol === 'https:') {
    return `wss://ws.physicsnook.com/ripples?room=${encodeURIComponent(roomCode)}`;
  }

  return `ws://${hostName}:8788/ripples?room=${encodeURIComponent(roomCode)}`;
};

const makeExplorerName = (): string => {
  const stored = localStorage.getItem('physics-nook-ripple-name');
  if (stored) return stored;
  const suffix = Math.floor(Math.random() * 900 + 100);
  const name = `Explorer ${suffix}`;
  localStorage.setItem('physics-nook-ripple-name', name);
  return name;
};

const sendMessage = (message: RippleClientToServerMessage): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

const clearGrid = (): void => {
  grid = createGridState(size.cols, size.rows);
};

const resize = (): void => {
  const rect = canvas.getBoundingClientRect();
  size.width = Math.max(rect.width, 1);
  size.height = Math.max(rect.height, 1);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  size.cols = clamp(Math.round(size.width / CELL_TARGET), MIN_COLS, MAX_COLS);
  size.rows = clamp(Math.round(size.height / CELL_TARGET), MIN_ROWS, MAX_ROWS);
  size.cellWidth = size.width / size.cols;
  size.cellHeight = size.height / size.rows;

  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearGrid();
};

const addSplash = (xNorm: number, yNorm: number, strength: number, radiusNorm: number): void => {
  const gridX = Math.round(clamp(xNorm, 0, 1) * (size.cols - 1));
  const gridY = Math.round(clamp(yNorm, 0, 1) * (size.rows - 1));
  const radius = clamp(Math.round(Math.min(size.cols, size.rows) * radiusNorm), 1, 10);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const row = gridY + dy;
    if (row < 1 || row >= size.rows - 1) continue;

    for (let dx = -radius; dx <= radius; dx += 1) {
      const col = gridX + dx;
      if (col < 1 || col >= size.cols - 1) continue;

      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      const falloff = Math.cos((distance / radius) * Math.PI * 0.5) ** 2;
      const index = row * size.cols + col;
      grid.current[index] += strength * falloff;
    }
  }
};

const applySplashEvent = (splash: RippleSplashEvent, referenceTime: number): void => {
  const ageSeconds = Math.max(0, (referenceTime - splash.serverTime) / 1000);
  if (ageSeconds > 7) return;

  const decayedStrength = splash.strength * Math.exp(-ageSeconds * 0.55);
  addSplash(splash.x, splash.y, decayedStrength, splash.radius);
};

const stepGrid = (): void => {
  const { cols, rows } = size;
  const { previous, current, next } = grid;

  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      const index = row * cols + col;
      let nextValue =
        (((current[index - 1] + current[index + 1] + current[index - cols] + current[index + cols]) * 0.5) -
          previous[index]) *
        DAMPING;

      const sideDistance = Math.min(col, cols - 1 - col);
      if (sideDistance < SIDE_DAMPING_LAYER_CELLS) {
        const normalized = (SIDE_DAMPING_LAYER_CELLS - sideDistance) / SIDE_DAMPING_LAYER_CELLS;
        nextValue *= 1 - normalized * normalized * SIDE_DAMPING_MAX;
      }

      const verticalDistance = Math.min(row, rows - 1 - row);
      if (verticalDistance < VERTICAL_DAMPING_LAYER_CELLS) {
        const normalized = (VERTICAL_DAMPING_LAYER_CELLS - verticalDistance) / VERTICAL_DAMPING_LAYER_CELLS;
        nextValue *= 1 - normalized * normalized * VERTICAL_DAMPING_MAX;
      }

      next[index] = nextValue;
    }
  }

  for (let col = 0; col < cols; col += 1) {
    next[col] = 0;
    next[cols + col] *= 0.8;
    next[(rows - 1) * cols + col] = 0;
    next[(rows - 2) * cols + col] *= 0.8;
  }

  for (let row = 0; row < rows; row += 1) {
    next[row * cols] = next[row * cols + 1];
    next[row * cols + cols - 1] = next[row * cols + cols - 2];
  }

  grid.previous = current;
  grid.current = next;
  grid.next = previous;
};

const injectEmitters = (): void => {
  for (const emitter of emitters) {
    if (!emitter.enabled || emitter.amplitude <= 0) continue;
    const oscillation = Math.sin(simTime * emitter.frequency * Math.PI * 2 + emitter.phase);
    const strength = oscillation * emitter.amplitude * 0.11;
    if (Math.abs(strength) < 0.003) continue;
    addSplash(emitter.x, emitter.y, strength, emitter.radius);
  }
};

const drawWater = (): void => {
  const { cols, rows, width, height, cellWidth, cellHeight } = size;
  const { current } = grid;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      const index = row * cols + col;
      const value = current[index];
      const magnitude = Math.abs(value);

      if (magnitude < 0.008) continue;

      const slopeX = current[index + 1] - current[index - 1];
      const slopeY = current[index + cols] - current[index - cols];
      const shimmer = clamp(0.5 + slopeX * 0.7 - slopeY * 0.55, 0, 1);
      const alpha = clamp(0.05 + magnitude * 0.13, 0.04, 0.36);
      const x = col * cellWidth;
      const y = row * cellHeight;

      if (value >= 0) {
        const r = Math.round(44 + shimmer * 26);
        const g = Math.round(116 + shimmer * 34);
        const b = Math.round(184 + shimmer * 22);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } else {
        const r = Math.round(18 + shimmer * 20);
        const g = Math.round(82 + shimmer * 28);
        const b = Math.round(118 + shimmer * 24);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.92})`;
      }

      ctx.fillRect(x, y, cellWidth + 1, cellHeight + 1);
    }
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(199, 233, 255, 0.13)';
  ctx.lineWidth = 1.1;

  for (let row = 0; row < 12; row += 1) {
    const y = height * 0.08 + row * ((height * 0.84) / 11);
    ctx.beginPath();
    ctx.moveTo(0, y);

    for (let x = 0; x <= width; x += Math.max(cellWidth * 1.2, 10)) {
      const col = clamp(Math.round((x / width) * (cols - 1)), 1, cols - 2);
      const mappedRow = clamp(Math.round((y / height) * (rows - 1)), 1, rows - 2);
      const wave = current[mappedRow * cols + col] * 9;
      ctx.lineTo(x, y + wave);
    }

    ctx.stroke();
  }
  ctx.restore();
};

const emitterScreenPosition = (emitter: RippleEmitterSnapshot) => ({
  x: emitter.x * size.width,
  y: emitter.y * size.height,
});

const drawEmitters = (timestamp: number): void => {
  for (const emitter of emitters) {
    const point = emitterScreenPosition(emitter);
    const selected = emitter.id === selectedEmitterId;
    const mine = emitter.controlledBy && emitter.controlledBy === localPlayerId;
    const controlled = Boolean(emitter.controlledBy && emitter.controlledBy !== localPlayerId);
    const pulse = 1 + Math.sin(timestamp * 0.004 + emitter.phase) * 0.08;
    const alpha = emitter.enabled ? 1 : 0.42;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = emitter.color;
    ctx.strokeStyle = controlled ? '#fbbf24' : mine || selected ? '#e0f2fe' : emitter.color;
    ctx.lineWidth = selected || controlled || mine ? 2.8 : 1.7;

    ctx.globalAlpha = emitter.enabled ? 0.18 : 0.08;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 30 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(point.x, point.y, selected ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(point.x, point.y, selected ? 20 : 16, 0, Math.PI * 2);
    ctx.stroke();

    if (controlled || mine) {
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
};

const getSelectedEmitter = (): RippleEmitterSnapshot | null =>
  emitters.find((emitter) => emitter.id === selectedEmitterId) ?? emitters[0] ?? null;

const formatEmitterName = (id: string): string =>
  id
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const updateSelectedControls = (): void => {
  const emitter = getSelectedEmitter();
  if (!emitter) return;

  selectedEmitterId = emitter.id;
  selectedEmitterLabel.textContent = formatEmitterName(emitter.id);
  amplitudeInput.value = String(emitter.amplitude);
  frequencyInput.value = String(emitter.frequency);
  phaseInput.value = String(emitter.phase);
  enableButton.textContent = emitter.enabled ? 'Enabled' : 'Disabled';
  enableButton.dataset.enabled = String(emitter.enabled);
};

const updateLocalEmitter = (id: string, patch: RippleEmitterPatch): void => {
  emitters = emitters.map((emitter) => (emitter.id === id ? { ...emitter, ...patch } : emitter));
};

const renderEmitterTray = (): void => {
  emitterButtons.textContent = '';

  for (const emitter of emitters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emitter-button';
    button.setAttribute('aria-label', `Select ${formatEmitterName(emitter.id)} emitter`);
    button.setAttribute('aria-pressed', String(emitter.id === selectedEmitterId));
    button.dataset.disabled = String(!emitter.enabled);
    button.addEventListener('click', () => {
      selectedEmitterId = emitter.id;
      renderEmitterTray();
      updateSelectedControls();
    });

    const swatch = document.createElement('span');
    swatch.className = 'emitter-swatch';
    swatch.style.backgroundColor = emitter.color;
    swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch);
    emitterButtons.append(button);
  }

  emitterCount.textContent = String(emitters.length);
  updateSelectedControls();
};

const handleSnapshot = (snapshot: RippleSnapshot): void => {
  latestSnapshot = snapshot;
  paused = snapshot.paused;
  pauseButton.textContent = paused ? 'Play' : 'Pause';
  pauseButton.setAttribute('aria-label', paused ? 'Resume ripple simulation' : 'Pause ripple simulation');
  roomLabel.textContent = snapshot.roomCode;
  playerCount.textContent = String(snapshot.playerCount);

  if (snapshot.resetVersion !== resetVersion) {
    resetVersion = snapshot.resetVersion;
    processedSplashIds.clear();
    clearGrid();
    simTime = 0;
  }

  emitters = snapshot.emitters;
  if (!emitters.some((emitter) => emitter.id === selectedEmitterId)) {
    selectedEmitterId = emitters[0]?.id ?? 'cool-left';
  }
  renderEmitterTray();

  for (const splash of snapshot.recentSplashes) {
    if (processedSplashIds.has(splash.id)) continue;
    processedSplashIds.add(splash.id);
    applySplashEvent(splash, snapshot.serverTime);
  }

  if (processedSplashIds.size > SPLASH_PROCESSED_LIMIT) {
    processedSplashIds = new Set(snapshot.recentSplashes.map((splash) => splash.id));
  }
};

const handleSocketMessage = (event: MessageEvent): void => {
  let message: RippleServerToClientMessage;
  try {
    message = JSON.parse(String(event.data)) as RippleServerToClientMessage;
  } catch {
    return;
  }

  if (message.type === 'rippleJoined') {
    localPlayerId = message.you;
    setConnectionState('online', 'Online');
    handleSnapshot(message.snapshot);
  } else if (message.type === 'rippleSnapshot') {
    handleSnapshot(message);
  } else if (message.type === 'ripplePresence') {
    playerCount.textContent = String(message.playerCount);
  } else if (message.type === 'pong') {
    const latency = Math.max(0, Math.round(performance.now() - message.clientTime));
    if (connectionState === 'online') statusText.textContent = `${latency} ms`;
  } else if (message.type === 'error') {
    setConnectionState('error', message.message);
  }
};

const connect = (): void => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  setConnectionState('connecting', 'Connecting');
  socket = new WebSocket(getDefaultWsUrl());

  socket.addEventListener('open', () => {
    sendMessage({ type: 'rippleJoin', name: makeExplorerName(), roomCode });
  });

  socket.addEventListener('message', handleSocketMessage);

  socket.addEventListener('close', () => {
    setConnectionState('offline', 'Offline');
    localPlayerId = null;
    window.setTimeout(connect, 1200);
  });

  socket.addEventListener('error', () => {
    setConnectionState('error', 'Socket error');
  });
};

const pointFromEvent = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  return {
    x,
    y,
    xNorm: rect.width > 0 ? x / rect.width : 0,
    yNorm: rect.height > 0 ? y / rect.height : 0,
  };
};

const hitEmitter = (x: number, y: number): RippleEmitterSnapshot | null => {
  for (let index = emitters.length - 1; index >= 0; index -= 1) {
    const emitter = emitters[index];
    const point = emitterScreenPosition(emitter);
    const hitRadius = Math.max(28, emitter.radius * Math.min(size.width, size.height) * 1.8);
    if (Math.hypot(x - point.x, y - point.y) <= hitRadius) {
      return emitter;
    }
  }

  return null;
};

const sendSplash = (x: number, y: number, strength: number): void => {
  if (paused) return;
  sendMessage({
    type: 'rippleSplash',
    splash: {
      x,
      y,
      strength,
      radius: RIPPLE_CONFIG.splash.defaultRadius,
    },
  });
};

const sendEmitterPatch = (id: string, patch: RippleEmitterPatch, force = false): void => {
  updateLocalEmitter(id, patch);
  const now = performance.now();
  if (!force && now - lastEmitterSendAt < EMITTER_SEND_INTERVAL_MS) return;
  lastEmitterSendAt = now;
  sendMessage({ type: 'rippleEmitterUpdate', id, patch });
};

const handlePointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  const point = pointFromEvent(event);
  const emitter = hitEmitter(point.x, point.y);

  if (emitter) {
    selectedEmitterId = emitter.id;
    renderEmitterTray();
    sendEmitterPatch(emitter.id, { x: point.xNorm, y: point.yNorm }, true);
    dragState = {
      active: true,
      pointerId: event.pointerId,
      mode: 'emitter',
      emitterId: emitter.id,
      lastX: point.x,
      lastY: point.y,
      lastAt: performance.now(),
    };
  } else {
    sendSplash(point.xNorm, point.yNorm, RIPPLE_CONFIG.splash.defaultStrength);
    dragState = {
      active: true,
      pointerId: event.pointerId,
      mode: 'splash',
      emitterId: null,
      lastX: point.x,
      lastY: point.y,
      lastAt: performance.now(),
    };
  }

  canvas.setPointerCapture(event.pointerId);
};

const handlePointerMove = (event: PointerEvent): void => {
  if (!dragState.active || dragState.pointerId !== event.pointerId) return;
  const point = pointFromEvent(event);
  const now = performance.now();

  if (dragState.mode === 'emitter' && dragState.emitterId) {
    sendEmitterPatch(dragState.emitterId, { x: point.xNorm, y: point.yNorm });
    dragState.lastX = point.x;
    dragState.lastY = point.y;
    dragState.lastAt = now;
    return;
  }

  const distance = Math.hypot(point.x - dragState.lastX, point.y - dragState.lastY);
  if (distance > 24 && now - dragState.lastAt > DRAG_INTERVAL_MS) {
    sendSplash(point.xNorm, point.yNorm, 1.2);
    dragState.lastX = point.x;
    dragState.lastY = point.y;
    dragState.lastAt = now;
  }
};

const finishPointer = (event: PointerEvent): void => {
  if (!dragState.active || dragState.pointerId !== event.pointerId) return;

  if (dragState.mode === 'emitter' && dragState.emitterId) {
    sendMessage({ type: 'rippleEmitterRelease', id: dragState.emitterId });
  }

  dragState = emptyDragState();
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
};

const sendSelectedControlPatch = (patch: RippleEmitterPatch, force = false): void => {
  const emitter = getSelectedEmitter();
  if (!emitter) return;
  sendEmitterPatch(emitter.id, patch, force);
  renderEmitterTray();
};

amplitudeInput.addEventListener('input', () => {
  sendSelectedControlPatch({ amplitude: Number.parseFloat(amplitudeInput.value) });
});
amplitudeInput.addEventListener('change', () => {
  sendSelectedControlPatch({ amplitude: Number.parseFloat(amplitudeInput.value) }, true);
});
frequencyInput.addEventListener('input', () => {
  sendSelectedControlPatch({ frequency: Number.parseFloat(frequencyInput.value) });
});
frequencyInput.addEventListener('change', () => {
  sendSelectedControlPatch({ frequency: Number.parseFloat(frequencyInput.value) }, true);
});
phaseInput.addEventListener('input', () => {
  sendSelectedControlPatch({ phase: Number.parseFloat(phaseInput.value) });
});
phaseInput.addEventListener('change', () => {
  sendSelectedControlPatch({ phase: Number.parseFloat(phaseInput.value) }, true);
});
enableButton.addEventListener('click', () => {
  const emitter = getSelectedEmitter();
  if (!emitter) return;
  sendSelectedControlPatch({ enabled: !emitter.enabled }, true);
});
pauseButton.addEventListener('click', () => {
  sendMessage({ type: 'rippleSetPaused', paused: !paused });
});
resetButton.addEventListener('click', () => {
  sendMessage({ type: 'rippleReset' });
});

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);
window.addEventListener('resize', resize);

const draw = (timestamp: number): void => {
  const dt = clamp((timestamp - lastFrameAt) / 1000, 0, 0.04);
  lastFrameAt = timestamp;

  if (!paused) {
    simTime += dt;
    injectEmitters();
    stepGrid();
  }

  drawWater();
  drawEmitters(timestamp);

  if (socket?.readyState === WebSocket.OPEN && timestamp - lastPingAt > PING_INTERVAL_MS) {
    lastPingAt = timestamp;
    sendMessage({ type: 'ping', clientTime: performance.now() });
  }

  window.requestAnimationFrame(draw);
};

roomLabel.textContent = roomCode;
resize();
connect();
window.requestAnimationFrame(draw);
