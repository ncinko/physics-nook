import './ripple-styles.css';

import {
  RIPPLE_CONFIG,
  resolvePersistentRippleRoomCode,
} from '../../../packages/shared/src/ripple.ts';
import type {
  RippleClientToServerMessage,
  RippleEmitterPatch,
  RippleEmitterSnapshot,
  RippleObjectKind,
  RippleObjectPatch,
  RippleObjectSnapshot,
  RippleRoomSummary,
  RippleServerToClientMessage,
  RippleSnapshot,
  RippleSplashEvent,
} from '../../../packages/shared/src/ripple.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';
type PointerMode = 'splash' | 'emitter' | 'object-move' | 'object-rotate' | 'object-width';
type ObjectHandle = 'rotate' | 'delete' | 'width';

type GridState = {
  previous: Float32Array;
  current: Float32Array;
  next: Float32Array;
};

type PoolSize = {
  width: number;
  height: number;
  viewCols: number;
  viewRows: number;
  activeCols: number;
  activeRows: number;
  sinkCols: number;
  sinkRows: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

type DragState = {
  active: boolean;
  pointerId: number | null;
  mode: PointerMode;
  emitterId: string | null;
  objectId: string | null;
  lastX: number;
  lastY: number;
  lastAt: number;
};

const canvas = document.getElementById('rippleCanvas') as HTMLCanvasElement | null;
const roomLabel = document.getElementById('roomLabel');
const playerCount = document.getElementById('playerCount');
const tankSwitcherButton = document.getElementById('tankSwitcherButton') as HTMLButtonElement | null;
const tankSwitcher = document.getElementById('tankSwitcher') as HTMLElement | null;
const lobbyNotice = document.getElementById('lobbyNotice') as HTMLElement | null;
const tankButtons = document.getElementById('tankButtons');
const themeButton = document.getElementById('themeButton') as HTMLButtonElement | null;
const pauseButton = document.getElementById('pauseButton') as HTMLButtonElement | null;
const resetButton = document.getElementById('resetButton') as HTMLButtonElement | null;
const selectionPanel = document.getElementById('selectionPanel') as HTMLElement | null;
const selectionPanelTitle = document.getElementById('selectionPanelTitle');
const selectionCloseButton = document.getElementById('selectionCloseButton') as HTMLButtonElement | null;
const emitterControls = document.getElementById('emitterControls') as HTMLElement | null;
const objectControls = document.getElementById('objectControls') as HTMLElement | null;
const amplitudeInput = document.getElementById('amplitudeInput') as HTMLInputElement | null;
const frequencyInput = document.getElementById('frequencyInput') as HTMLInputElement | null;
const phaseInput = document.getElementById('phaseInput') as HTMLInputElement | null;
const sensitivityInput = document.getElementById('sensitivityInput') as HTMLInputElement | null;
const gradientInput = document.getElementById('gradientInput') as HTMLInputElement | null;
const enableButton = document.getElementById('enableButton') as HTMLButtonElement | null;
const objectWidthInput = document.getElementById('objectWidthInput') as HTMLInputElement | null;
const objectHeightInput = document.getElementById('objectHeightInput') as HTMLInputElement | null;
const objectGapControl = document.getElementById('objectGapControl') as HTMLElement | null;
const objectGapInput = document.getElementById('objectGapInput') as HTMLInputElement | null;
const objectSpacingControl = document.getElementById('objectSpacingControl') as HTMLElement | null;
const objectSpacingInput = document.getElementById('objectSpacingInput') as HTMLInputElement | null;
const deleteButton = document.getElementById('deleteButton') as HTMLButtonElement | null;

if (
  !canvas ||
  !roomLabel ||
  !playerCount ||
  !tankSwitcherButton ||
  !tankSwitcher ||
  !lobbyNotice ||
  !tankButtons ||
  !themeButton ||
  !pauseButton ||
  !resetButton ||
  !selectionPanel ||
  !selectionPanelTitle ||
  !selectionCloseButton ||
  !emitterControls ||
  !objectControls ||
  !amplitudeInput ||
  !frequencyInput ||
  !phaseInput ||
  !sensitivityInput ||
  !gradientInput ||
  !enableButton ||
  !objectWidthInput ||
  !objectHeightInput ||
  !objectGapControl ||
  !objectGapInput ||
  !objectSpacingControl ||
  !objectSpacingInput ||
  !deleteButton
) {
  throw new Error('Ripple Tank markup is missing required elements.');
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
const WORLD_SCALE = 3;
const DAMPING = 0.9976;
const QUIET_FIELD_EPSILON = 0.00042;
const HIDDEN_SINK_SCREENS = 0.5;
const HIDDEN_SINK_MAX_DAMPING = 0.985;
const ABSORBING_BOUNDARY_LAYER_CELLS = 24;
const ABSORBING_BOUNDARY_MAX_DAMPING = 0.985;
const ABSORBING_BOUNDARY_COEFFICIENT = (Math.SQRT1_2 - 1) / (Math.SQRT1_2 + 1);
const DRAG_INTERVAL_MS = 65;
const EMITTER_SEND_INTERVAL_MS = 44;
const OBJECT_SEND_INTERVAL_MS = 44;
const PING_INTERVAL_MS = 2000;
const SPLASH_PROCESSED_LIMIT = 500;
const CAMERA_SPEED_SCREENS = 0.92;
const MIN_CAMERA_ZOOM = 0.65;
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_RATE = 0.0012;
const THEME_STORAGE_KEY = 'physics-nook-ripple-theme';
const SENSITIVITY_STORAGE_KEY = 'physics-nook-ripple-display-sensitivity';
const GRADIENT_DRAW_STORAGE_KEY = 'physics-nook-ripple-gradient-draw';
const DEFAULT_DISPLAY_SENSITIVITY = 72;
const DISPLAY_SENSITIVITY_MAX = 160;
const MIN_DISPLAY_THRESHOLD = 0.0011;
const DEFAULT_DISPLAY_THRESHOLD = 0.00872;
const MAX_DISPLAY_THRESHOLD = 0.048;
const MAX_SLIT_OBJECT_WIDTH = 0.08;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const searchParams = new URLSearchParams(window.location.search);
let activeRoomCode = resolvePersistentRippleRoomCode(searchParams.get('room') ?? undefined);

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const mixChannel = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

const mixColor = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: mixChannel(a.r, b.r, t),
  g: mixChannel(a.g, b.g, t),
  b: mixChannel(a.b, b.b, t),
});

const scaleColor = (color: Rgb, factor: number): Rgb => ({
  r: clamp(Math.round(color.r * factor), 0, 255),
  g: clamp(Math.round(color.g * factor), 0, 255),
  b: clamp(Math.round(color.b * factor), 0, 255),
});

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
  objectId: null,
  lastX: 0,
  lastY: 0,
  lastAt: 0,
});

let socket: WebSocket | null = null;
let connectionState: ConnectionState = 'offline';
let localPlayerId: string | null = null;
let latestSnapshot: RippleSnapshot | null = null;
let emitters: RippleEmitterSnapshot[] = [];
let objects: RippleObjectSnapshot[] = [];
let selectedEmitterId: string | null = null;
let selectedObjectId: string | null = null;
let pendingObjectKind: RippleObjectKind | null = null;
let paused = false;
let resetVersion = -1;
let dpr = 1;
let simTime = 0;
let lastFrameAt = performance.now();
let lastPingAt = 0;
let lastEmitterSendAt = 0;
let lastObjectSendAt = 0;
let processedSplashIds = new Set<string>();
let objectMask = new Uint8Array(0);
let displaySensitivity = DEFAULT_DISPLAY_SENSITIVITY;
let useGradientDrawing = false;
let inLobby = true;
let lobbyMessage = 'Choose a ripple tank to join.';
let roomSummaries: RippleRoomSummary[] = RIPPLE_CONFIG.persistentRoomCodes.map((roomCode) => ({
  roomCode,
  playerCount: 0,
}));
const keyState = new Set<string>();
const camera = { xScreens: 0, yScreens: 0, zoom: 1 };

const size: PoolSize = {
  width: 0,
  height: 0,
  viewCols: MIN_COLS,
  viewRows: MIN_ROWS,
  activeCols: MIN_COLS * WORLD_SCALE,
  activeRows: MIN_ROWS * WORLD_SCALE,
  sinkCols: ABSORBING_BOUNDARY_LAYER_CELLS,
  sinkRows: ABSORBING_BOUNDARY_LAYER_CELLS,
  cols: MIN_COLS * WORLD_SCALE + ABSORBING_BOUNDARY_LAYER_CELLS * 2,
  rows: MIN_ROWS * WORLD_SCALE + ABSORBING_BOUNDARY_LAYER_CELLS * 2,
  cellWidth: 1,
  cellHeight: 1,
};
let grid = createGridState(size.cols, size.rows);
let dragState = emptyDragState();

const setConnectionState = (state: ConnectionState, _label: string): void => {
  connectionState = state;
};

const setPlayerCount = (count: number): void => {
  playerCount.textContent = `Users: ${count}`;
};

const activeRoomSummary = (): RippleRoomSummary =>
  roomSummaries.find((room) => room.roomCode === activeRoomCode) ?? { roomCode: activeRoomCode, playerCount: 0 };

const updateBrowserRoom = (): void => {
  const url = new URL(window.location.href);
  url.searchParams.set('room', activeRoomCode);
  window.history.replaceState(null, '', url);
};

const renderTankSwitcher = (): void => {
  tankButtons.textContent = '';
  for (const room of roomSummaries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tank-button';
    button.dataset.active = String(!inLobby && room.roomCode === activeRoomCode);
    button.setAttribute('aria-pressed', String(!inLobby && room.roomCode === activeRoomCode));
    button.addEventListener('click', () => joinTank(room.roomCode));

    const label = document.createElement('strong');
    label.textContent = room.roomCode.replace(/^TANK/, 'Tank ');
    const count = document.createElement('span');
    count.textContent = `${room.playerCount}/${RIPPLE_CONFIG.maxActiveUsers}`;
    button.append(label, count);
    tankButtons.append(button);
  }

  const summary = activeRoomSummary();
  roomLabel.textContent = inLobby ? 'LOBBY' : activeRoomCode;
  setPlayerCount(summary.playerCount);
  lobbyNotice.hidden = !inLobby && !lobbyMessage;
  lobbyNotice.textContent = lobbyMessage;
};

const setRoomSummaries = (summaries: RippleRoomSummary[]): void => {
  roomSummaries = RIPPLE_CONFIG.persistentRoomCodes.map((roomCode) => (
    summaries.find((summary) => summary.roomCode === roomCode) ?? { roomCode, playerCount: 0 }
  ));
  renderTankSwitcher();
};

const setTankSwitcherOpen = (open: boolean): void => {
  tankSwitcher.hidden = !open;
  tankSwitcherButton.setAttribute('aria-expanded', String(open));
};

const enterLobby = (message: string): void => {
  inLobby = true;
  lobbyMessage = message;
  selectedEmitterId = null;
  selectedObjectId = null;
  emitters = [];
  objects = [];
  latestSnapshot = null;
  processedSplashIds.clear();
  clearGrid();
  setTankSwitcherOpen(true);
  renderTankSwitcher();
  updateSelectionPanel();
};

const joinTank = (roomCode: string): void => {
  activeRoomCode = resolvePersistentRippleRoomCode(roomCode);
  inLobby = true;
  lobbyMessage = `Joining ${activeRoomCode.replace(/^TANK/, 'Tank ')}...`;
  setTankSwitcherOpen(false);
  updateBrowserRoom();
  clearSelection();
  clearGrid();
  renderTankSwitcher();
  sendMessage({ type: 'rippleJoin', name: makeExplorerName(), roomCode: activeRoomCode });
};

const applyTheme = (theme: 'light' | 'dark'): void => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  themeButton.textContent = theme === 'dark' ? 'Light' : 'Dark';
  themeButton.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
};

const initializeTheme = (): void => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(stored === 'dark' ? 'dark' : 'light');
};

const setDisplaySensitivity = (value: number): void => {
  displaySensitivity = clamp(Math.round(value), 0, DISPLAY_SENSITIVITY_MAX);
  sensitivityInput.value = String(displaySensitivity);
  localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(displaySensitivity));
};

const initializeDisplaySensitivity = (): void => {
  const stored = Number.parseFloat(localStorage.getItem(SENSITIVITY_STORAGE_KEY) ?? '');
  setDisplaySensitivity(Number.isFinite(stored) ? stored : DEFAULT_DISPLAY_SENSITIVITY);
};

const displayThreshold = (): number => {
  if (displaySensitivity <= DEFAULT_DISPLAY_SENSITIVITY) {
    const t = displaySensitivity / DEFAULT_DISPLAY_SENSITIVITY;
    return MAX_DISPLAY_THRESHOLD - t * (MAX_DISPLAY_THRESHOLD - DEFAULT_DISPLAY_THRESHOLD);
  }

  const t = (displaySensitivity - DEFAULT_DISPLAY_SENSITIVITY) / (DISPLAY_SENSITIVITY_MAX - DEFAULT_DISPLAY_SENSITIVITY);
  return DEFAULT_DISPLAY_THRESHOLD - t * (DEFAULT_DISPLAY_THRESHOLD - MIN_DISPLAY_THRESHOLD);
};

const setGradientDrawing = (enabled: boolean): void => {
  useGradientDrawing = enabled;
  gradientInput.checked = enabled;
  localStorage.setItem(GRADIENT_DRAW_STORAGE_KEY, String(enabled));
};

const initializeGradientDrawing = (): void => {
  setGradientDrawing(localStorage.getItem(GRADIENT_DRAW_STORAGE_KEY) === 'true');
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
  url.searchParams.set('room', activeRoomCode);
  return url.toString();
};

const getDefaultWsUrl = (): string => {
  const configured = getConfiguredWsUrl();
  if (configured) return appendRipplePath(configured);

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const hostName = window.location.hostname || 'localhost';
  if (localHosts.has(hostName) || hostName.startsWith('192.168.') || hostName.startsWith('10.') || hostName.endsWith('.local')) {
    return `ws://${hostName}:8788/ripples?room=${encodeURIComponent(activeRoomCode)}`;
  }

  if (window.location.protocol === 'https:') {
    return `wss://ws.physicsnook.com/ripples?room=${encodeURIComponent(activeRoomCode)}`;
  }

  return `ws://${hostName}:8788/ripples?room=${encodeURIComponent(activeRoomCode)}`;
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

const viewMetrics = () => {
  const visibleCols = size.viewCols / camera.zoom;
  const visibleRows = size.viewRows / camera.zoom;

  return {
    visibleCols,
    visibleRows,
    cellWidth: size.width / visibleCols,
    cellHeight: size.height / visibleRows,
  };
};

const screenCellWidth = (): number => viewMetrics().cellWidth;
const screenCellHeight = (): number => viewMetrics().cellHeight;

const maxVisibleOriginOffset = () => {
  const metrics = viewMetrics();
  return {
    col: Math.max(0, size.activeCols - metrics.visibleCols),
    row: Math.max(0, size.activeRows - metrics.visibleRows),
  };
};

const visibleOrigin = () => {
  const maxOffset = maxVisibleOriginOffset();

  return {
    col: size.sinkCols + ((camera.xScreens + 1) / 2) * maxOffset.col,
    row: size.sinkRows + ((camera.yScreens + 1) / 2) * maxOffset.row,
  };
};

const originToCameraPosition = (col: number, row: number): void => {
  const maxOffset = maxVisibleOriginOffset();
  camera.xScreens = maxOffset.col > 0 ? clamp(((col - size.sinkCols) / maxOffset.col) * 2 - 1, -1, 1) : 0;
  camera.yScreens = maxOffset.row > 0 ? clamp(((row - size.sinkRows) / maxOffset.row) * 2 - 1, -1, 1) : 0;
};

const worldToGrid = (point: { x: number; y: number }) => ({
  col: size.sinkCols + point.x * (size.activeCols - 1),
  row: size.sinkRows + point.y * (size.activeRows - 1),
});

const worldToScreen = (point: { x: number; y: number }) => {
  const origin = visibleOrigin();
  const gridPoint = worldToGrid(point);
  const metrics = viewMetrics();
  return {
    x: (gridPoint.col - origin.col) * metrics.cellWidth,
    y: (gridPoint.row - origin.row) * metrics.cellHeight,
  };
};

const screenToWorld = (x: number, y: number) => {
  const origin = visibleOrigin();
  const metrics = viewMetrics();
  return {
    x: clamp((origin.col + x / metrics.cellWidth - size.sinkCols) / (size.activeCols - 1), 0, 1),
    y: clamp((origin.row + y / metrics.cellHeight - size.sinkRows) / (size.activeRows - 1), 0, 1),
  };
};

const clearGrid = (): void => {
  grid = createGridState(size.cols, size.rows);
  objectMask = new Uint8Array(size.cols * size.rows);
};

const resize = (): void => {
  const rect = canvas.getBoundingClientRect();
  size.width = Math.max(rect.width, 1);
  size.height = Math.max(rect.height, 1);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  size.viewCols = clamp(Math.round(size.width / CELL_TARGET), MIN_COLS, MAX_COLS);
  size.viewRows = clamp(Math.round(size.height / CELL_TARGET), MIN_ROWS, MAX_ROWS);
  size.activeCols = size.viewCols * WORLD_SCALE;
  size.activeRows = size.viewRows * WORLD_SCALE;
  size.sinkCols = Math.max(
    ABSORBING_BOUNDARY_LAYER_CELLS + 4,
    Math.round(size.viewCols * HIDDEN_SINK_SCREENS),
  );
  size.sinkRows = Math.max(
    ABSORBING_BOUNDARY_LAYER_CELLS + 4,
    Math.round(size.viewRows * HIDDEN_SINK_SCREENS),
  );
  size.cols = size.activeCols + size.sinkCols * 2;
  size.rows = size.activeRows + size.sinkRows * 2;
  size.cellWidth = size.width / size.viewCols;
  size.cellHeight = size.height / size.viewRows;

  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearGrid();
};

const addSplash = (xNorm: number, yNorm: number, strength: number, radiusNorm: number): void => {
  const gridPoint = worldToGrid({ x: clamp(xNorm, 0, 1), y: clamp(yNorm, 0, 1) });
  const gridX = Math.round(gridPoint.col);
  const gridY = Math.round(gridPoint.row);
  const radius = clamp(Math.round(Math.min(size.viewCols, size.viewRows) * radiusNorm), 1, 10);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const row = gridY + dy;
    if (row < 1 || row >= size.rows - 1) continue;

    for (let dx = -radius; dx <= radius; dx += 1) {
      const col = gridX + dx;
      if (col < 1 || col >= size.cols - 1) continue;
      const index = row * size.cols + col;
      if (objectMask[index]) continue;

      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      const falloff = Math.cos((distance / radius) * Math.PI * 0.5) ** 2;
      grid.current[index] += strength * falloff;
    }
  }
};

const applySplashEvent = (splash: RippleSplashEvent, referenceTime: number): void => {
  const ageSeconds = Math.max(0, (referenceTime - splash.serverTime) / 1000);
  if (ageSeconds > 7) return;
  addSplash(splash.x, splash.y, splash.strength * Math.exp(-ageSeconds * 0.55), splash.radius);
};

const activeWorldPixelWidth = (): number => (size.activeCols - 1) * screenCellWidth();
const activeWorldPixelHeight = (): number => (size.activeRows - 1) * screenCellHeight();

const isSlitObjectKind = (kind: RippleObjectKind): kind is 'single-slit' | 'double-slit' =>
  kind === 'single-slit' || kind === 'double-slit';

type SlitOpeningRange = {
  start: number;
  end: number;
};

const slitOpeningRanges = (
  kind: 'single-slit' | 'double-slit',
  height: number,
  gap: number,
  spacing = 0,
): SlitOpeningRange[] => {
  if (kind === 'single-slit') {
    const slitHeight = clamp(gap, Math.max(screenCellHeight(), 2), Math.max(2, height * 0.72));
    return [{ start: -slitHeight / 2, end: slitHeight / 2 }];
  }

  const slitHeight = clamp(gap, Math.max(screenCellHeight(), 2), Math.max(2, height * 0.28));
  const maxOffset = Math.max(0, height / 2 - slitHeight / 2 - 1);
  const centerSpacing = clamp(slitHeight + spacing, slitHeight + Math.max(screenCellHeight(), 2), height - slitHeight);
  const offset = Math.min(centerSpacing / 2, maxOffset);

  return [
    { start: -offset - slitHeight / 2, end: -offset + slitHeight / 2 },
    { start: offset - slitHeight / 2, end: offset + slitHeight / 2 },
  ];
};

const isInsideSlitOpening = (localY: number, openings: SlitOpeningRange[]): boolean =>
  openings.some((opening) => localY >= opening.start && localY <= opening.end);

const appendSlitBarrierPath = (
  width: number,
  height: number,
  openings: SlitOpeningRange[],
): void => {
  const halfHeight = height / 2;
  let cursor = -halfHeight;

  for (const opening of openings) {
    const start = clamp(opening.start, -halfHeight, halfHeight);
    const end = clamp(opening.end, -halfHeight, halfHeight);
    if (start - cursor > 0.5) {
      ctx.rect(-width / 2, cursor, width, start - cursor);
    }
    cursor = Math.max(cursor, end);
  }

  if (halfHeight - cursor > 0.5) {
    ctx.rect(-width / 2, cursor, width, halfHeight - cursor);
  }
};

const localObjectCoordinates = (
  object: RippleObjectSnapshot,
  x: number,
  y: number,
  worldPixelWidth = activeWorldPixelWidth(),
  worldPixelHeight = activeWorldPixelHeight(),
) => {
  const dx = (x - object.x) * worldPixelWidth;
  const dy = (y - object.y) * worldPixelHeight;
  const cos = Math.cos(-object.rotation);
  const sin = Math.sin(-object.rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
};

const slitObjectWidthFromPoint = (object: RippleObjectSnapshot, x: number, y: number): number => {
  const worldPixelWidth = activeWorldPixelWidth();
  const local = localObjectCoordinates(object, x, y, worldPixelWidth);
  const width = (Math.abs(local.x) * 2) / Math.max(worldPixelWidth, 1);
  return clamp(width, RIPPLE_CONFIG.object.minSize, MAX_SLIT_OBJECT_WIDTH);
};

const isPointInsideObject = (
  object: RippleObjectSnapshot,
  x: number,
  y: number,
  paddingPx = 0,
): boolean => {
  const worldPixelWidth = activeWorldPixelWidth();
  const worldPixelHeight = activeWorldPixelHeight();
  const local = localObjectCoordinates(object, x, y, worldPixelWidth, worldPixelHeight);
  const width = object.width * worldPixelWidth;
  const height = object.height * worldPixelHeight;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  if (object.kind === 'barrier') {
    return Math.abs(local.x) <= halfWidth + paddingPx && Math.abs(local.y) <= halfHeight + paddingPx;
  }

  if (isSlitObjectKind(object.kind)) {
    const gap = object.gap * worldPixelHeight;
    const spacing = (object.spacing ?? 0.058) * worldPixelHeight;
    const openings = slitOpeningRanges(object.kind, height, gap, spacing);
    return (
      Math.abs(local.x) <= halfWidth + paddingPx &&
      Math.abs(local.y) <= halfHeight + paddingPx &&
      !isInsideSlitOpening(local.y, openings)
    );
  }

  if (Math.abs(local.x) > halfWidth + paddingPx) return false;
  const t = local.x / Math.max(halfWidth, 1e-6);
  const curveY = t * t * height - halfHeight;
  const thickness = Math.max(Math.min(screenCellWidth(), screenCellHeight()) * 1.4, Math.min(width, height) * 0.12);
  return Math.abs(local.y - curveY) <= thickness + paddingPx;
};

const buildObjectMask = (): void => {
  objectMask.fill(0);
  const firstRow = Math.max(1, size.sinkRows);
  const lastRow = Math.min(size.rows - 2, size.sinkRows + size.activeRows - 1);
  const firstCol = Math.max(1, size.sinkCols);
  const lastCol = Math.min(size.cols - 2, size.sinkCols + size.activeCols - 1);

  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = (row - size.sinkRows) / (size.activeRows - 1);
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x = (col - size.sinkCols) / (size.activeCols - 1);
      if (objects.some((object) => isPointInsideObject(object, x, y))) {
        const index = row * size.cols + col;
        objectMask[index] = 1;
        grid.current[index] = 0;
        grid.previous[index] = 0;
        grid.next[index] = 0;
      }
    }
  }
};

const sampleNeighbor = (index: number, currentIndex: number): number =>
  objectMask[index] ? -grid.current[currentIndex] * 0.78 : grid.current[index];

const hiddenSinkProgress = (col: number, row: number): number => {
  const left = size.sinkCols;
  const right = size.sinkCols + size.activeCols - 1;
  const top = size.sinkRows;
  const bottom = size.sinkRows + size.activeRows - 1;
  const outsideX = col < left ? left - col : col > right ? col - right : 0;
  const outsideY = row < top ? top - row : row > bottom ? row - bottom : 0;
  if (outsideX === 0 && outsideY === 0) return 0;

  const xProgress = outsideX / Math.max(1, size.sinkCols);
  const yProgress = outsideY / Math.max(1, size.sinkRows);
  return clamp(Math.max(xProgress, yProgress), 0, 1);
};

const applyAbsorbingBoundary = (current: Float32Array, next: Float32Array): void => {
  const { cols, rows } = size;
  const coefficient = ABSORBING_BOUNDARY_COEFFICIENT;

  for (let col = 1; col < cols - 1; col += 1) {
    const top = col;
    const topInner = cols + col;
    const bottom = (rows - 1) * cols + col;
    const bottomInner = (rows - 2) * cols + col;

    next[top] = current[topInner] + coefficient * (next[topInner] - current[top]);
    next[bottom] = current[bottomInner] + coefficient * (next[bottomInner] - current[bottom]);
  }

  for (let row = 1; row < rows - 1; row += 1) {
    const left = row * cols;
    const leftInner = left + 1;
    const right = row * cols + cols - 1;
    const rightInner = right - 1;

    next[left] = current[leftInner] + coefficient * (next[leftInner] - current[left]);
    next[right] = current[rightInner] + coefficient * (next[rightInner] - current[right]);
  }

  next[0] = (next[1] + next[cols]) * 0.5;
  next[cols - 1] = (next[cols - 2] + next[2 * cols - 1]) * 0.5;

  const bottomLeft = (rows - 1) * cols;
  next[bottomLeft] = (next[bottomLeft + 1] + next[bottomLeft - cols]) * 0.5;

  const bottomRight = rows * cols - 1;
  next[bottomRight] = (next[bottomRight - 1] + next[bottomRight - cols]) * 0.5;
};

const stepGrid = (): void => {
  const { cols, rows } = size;
  const { previous, current, next } = grid;

  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      const index = row * cols + col;
      if (objectMask[index]) {
        next[index] = 0;
        continue;
      }

      const neighborSum =
        sampleNeighbor(index - 1, index) +
        sampleNeighbor(index + 1, index) +
        sampleNeighbor(index - cols, index) +
        sampleNeighbor(index + cols, index);
      let nextValue = ((neighborSum * 0.5) - previous[index]) * DAMPING;

      const edgeDistance = Math.min(col, row, cols - 1 - col, rows - 1 - row);
      if (edgeDistance < ABSORBING_BOUNDARY_LAYER_CELLS) {
        const normalized = (ABSORBING_BOUNDARY_LAYER_CELLS - edgeDistance) / ABSORBING_BOUNDARY_LAYER_CELLS;
        nextValue *= 1 - normalized * normalized * ABSORBING_BOUNDARY_MAX_DAMPING;
      }

      const sinkProgress = hiddenSinkProgress(col, row);
      if (sinkProgress > 0) {
        nextValue *= 1 - sinkProgress * sinkProgress * HIDDEN_SINK_MAX_DAMPING;
      }

      if (Math.abs(nextValue) < QUIET_FIELD_EPSILON && Math.abs(current[index]) < QUIET_FIELD_EPSILON) {
        nextValue = 0;
      }

      next[index] = nextValue;
    }
  }

  applyAbsorbingBoundary(current, next);

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

const gradientWaterFill = (
  value: number,
  magnitude: number,
  threshold: number,
  shimmer: number,
  lightMode: boolean,
): string => {
  const trough = lightMode ? { r: 12, g: 116, b: 128 } : { r: 18, g: 87, b: 120 };
  const neutral = lightMode ? { r: 190, g: 235, b: 239 } : { r: 76, g: 142, b: 164 };
  const crest = lightMode ? { r: 104, g: 168, b: 248 } : { r: 120, g: 208, b: 252 };
  const signed = clamp(value / Math.max(threshold * 7, DEFAULT_DISPLAY_THRESHOLD * 1.6), -1, 1);
  const color = signed >= 0 ? mixColor(neutral, crest, signed) : mixColor(neutral, trough, -signed);
  const intensity = clamp((magnitude - threshold) / Math.max(threshold * 5, 0.006), 0, 1);
  const alpha = clamp(0.025 + intensity * intensity * (lightMode ? 0.32 : 0.36), 0.02, lightMode ? 0.36 : 0.4);
  const litColor = scaleColor(color, 0.92 + shimmer * 0.18);

  return `rgba(${litColor.r}, ${litColor.g}, ${litColor.b}, ${alpha})`;
};

const drawWater = (): void => {
  const origin = visibleOrigin();
  const metrics = viewMetrics();
  const current = grid.current;
  const lightMode = document.documentElement.dataset.theme !== 'dark';
  const threshold = displayThreshold();
  const gain = 0.1 + (displaySensitivity / 100) * 0.08;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const visibleRows = Math.ceil(metrics.visibleRows);
  const visibleCols = Math.ceil(metrics.visibleCols);

  for (let viewRow = 1; viewRow < visibleRows - 1; viewRow += 1) {
    const row = Math.round(origin.row + viewRow);
    if (row <= 0 || row >= size.rows - 1) continue;

    for (let viewCol = 1; viewCol < visibleCols - 1; viewCol += 1) {
      const col = Math.round(origin.col + viewCol);
      if (col <= 0 || col >= size.cols - 1) continue;

      const index = row * size.cols + col;
      const value = current[index];
      const magnitude = Math.abs(value);
      if (magnitude < threshold && !objectMask[index]) continue;

      const x = viewCol * metrics.cellWidth;
      const y = viewRow * metrics.cellHeight;

      if (objectMask[index]) {
        ctx.fillStyle = lightMode ? 'rgba(15, 87, 116, 0.18)' : 'rgba(199, 233, 255, 0.14)';
        ctx.fillRect(x, y, metrics.cellWidth + 1, metrics.cellHeight + 1);
        continue;
      }

      const slopeX = current[index + 1] - current[index - 1];
      const slopeY = current[index + size.cols] - current[index - size.cols];
      const shimmer = clamp(0.5 + slopeX * 0.7 - slopeY * 0.55, 0, 1);

      if (useGradientDrawing) {
        ctx.fillStyle = gradientWaterFill(value, magnitude, threshold, shimmer, lightMode);
        ctx.fillRect(x, y, metrics.cellWidth + 1, metrics.cellHeight + 1);
        continue;
      }

      const visibleMagnitude = Math.max(0, magnitude - threshold);
      const alpha = clamp(0.04 + visibleMagnitude * gain, 0.035, lightMode ? 0.32 : 0.36);

      if (value >= 0) {
        const r = lightMode ? Math.round(92 + shimmer * 70) : Math.round(44 + shimmer * 26);
        const g = lightMode ? Math.round(164 + shimmer * 42) : Math.round(116 + shimmer * 34);
        const b = lightMode ? 248 : Math.round(184 + shimmer * 22);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } else {
        const r = lightMode ? Math.round(15 + shimmer * 22) : Math.round(18 + shimmer * 20);
        const g = lightMode ? Math.round(118 + shimmer * 20) : Math.round(82 + shimmer * 28);
        const b = lightMode ? Math.round(128 + shimmer * 26) : Math.round(118 + shimmer * 24);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.92})`;
      }

      ctx.fillRect(x, y, metrics.cellWidth + 1, metrics.cellHeight + 1);
    }
  }

  ctx.save();
  ctx.strokeStyle = lightMode ? 'rgba(255, 255, 255, 0.26)' : 'rgba(199, 233, 255, 0.13)';
  ctx.lineWidth = 1.1;

  for (let line = 0; line < 12; line += 1) {
    const y = size.height * 0.08 + line * ((size.height * 0.84) / 11);
    ctx.beginPath();
    ctx.moveTo(0, y);

    for (let x = 0; x <= size.width; x += Math.max(metrics.cellWidth * 1.2, 10)) {
      const col = clamp(Math.round(origin.col + x / metrics.cellWidth), 1, size.cols - 2);
      const row = clamp(Math.round(origin.row + y / metrics.cellHeight), 1, size.rows - 2);
      const sample = current[row * size.cols + col];
      const wave = Math.abs(sample) < threshold ? 0 : sample * 9;
      ctx.lineTo(x, y + wave);
    }

    ctx.stroke();
  }
  ctx.restore();
};

const drawObjectShape = (object: RippleObjectSnapshot, fill = false): void => {
  const point = worldToScreen(object);
  const width = object.width * activeWorldPixelWidth();
  const height = object.height * activeWorldPixelHeight();

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(object.rotation);
  ctx.beginPath();

  if (object.kind === 'barrier') {
    ctx.rect(-width / 2, -height / 2, width, height);
  } else if (isSlitObjectKind(object.kind)) {
    const gap = object.gap * activeWorldPixelHeight();
    const spacing = (object.spacing ?? 0.058) * activeWorldPixelHeight();
    appendSlitBarrierPath(width, height, slitOpeningRanges(object.kind, height, gap, spacing));
  } else {
    ctx.moveTo(-width / 2, height / 2);
    for (let i = 0; i <= 32; i += 1) {
      const x = -width / 2 + (i / 32) * width;
      const t = x / Math.max(width / 2, 1);
      const y = t * t * height - height / 2;
      ctx.lineTo(x, y);
    }
  }

  if (fill) ctx.fill();
  else ctx.stroke();
  ctx.restore();
};

const objectHandlePoints = (object: RippleObjectSnapshot) => {
  const center = worldToScreen(object);
  const width = object.width * activeWorldPixelWidth();
  const height = object.height * activeWorldPixelHeight();
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  const rotateLocal = { x: 0, y: -height / 2 - 28 };
  const deleteLocal = { x: width / 2 + 18, y: -height / 2 - 18 };
  const widthLocal = { x: width / 2 + 24, y: 0 };
  const toScreen = (local: { x: number; y: number }) => ({
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos,
  });

  return {
    rotate: toScreen(rotateLocal),
    delete: toScreen(deleteLocal),
    width: isSlitObjectKind(object.kind) ? toScreen(widthLocal) : null,
  };
};

const drawObjects = (): void => {
  const lightMode = document.documentElement.dataset.theme !== 'dark';
  for (const object of objects) {
    const selected = object.id === selectedObjectId;
    const mine = object.controlledBy === localPlayerId;

    ctx.save();
    ctx.lineWidth = selected ? 2.6 : 1.6;
    ctx.strokeStyle = selected || mine ? (lightMode ? '#075985' : '#e0f2fe') : lightMode ? 'rgba(15, 87, 116, 0.76)' : 'rgba(199, 233, 255, 0.58)';
    ctx.fillStyle = lightMode ? 'rgba(14, 116, 144, 0.12)' : 'rgba(199, 233, 255, 0.08)';
    if (object.kind !== 'parabola') drawObjectShape(object, true);
    drawObjectShape(object);
    ctx.restore();

    if (!selected) continue;
    const handles = objectHandlePoints(object);
    ctx.save();
    ctx.fillStyle = lightMode ? '#0f766e' : '#7dd3fc';
    ctx.strokeStyle = lightMode ? '#ffffff' : '#082f49';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(handles.rotate.x, handles.rotate.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (handles.width) {
      ctx.beginPath();
      ctx.arc(handles.width.x, handles.width.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = lightMode ? '#0284c7' : '#38bdf8';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(handles.width.x - 4, handles.width.y);
      ctx.lineTo(handles.width.x + 4, handles.width.y);
      ctx.stroke();
      ctx.strokeStyle = lightMode ? '#ffffff' : '#082f49';
      ctx.lineWidth = 2;
    }
    ctx.beginPath();
    ctx.arc(handles.delete.x, handles.delete.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#fb7185';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(handles.delete.x - 4, handles.delete.y - 4);
    ctx.lineTo(handles.delete.x + 4, handles.delete.y + 4);
    ctx.moveTo(handles.delete.x + 4, handles.delete.y - 4);
    ctx.lineTo(handles.delete.x - 4, handles.delete.y + 4);
    ctx.stroke();
    ctx.restore();
  }
};

const drawEmitters = (timestamp: number): void => {
  for (const emitter of emitters) {
    const point = worldToScreen(emitter);
    if (point.x < -60 || point.x > size.width + 60 || point.y < -60 || point.y > size.height + 60) continue;

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
    ctx.restore();
  }
};

const getSelectedEmitter = (): RippleEmitterSnapshot | null =>
  selectedEmitterId ? emitters.find((emitter) => emitter.id === selectedEmitterId) ?? null : null;

const getSelectedObject = (): RippleObjectSnapshot | null =>
  selectedObjectId ? objects.find((object) => object.id === selectedObjectId) ?? null : null;

const objectKindLabel = (kind: RippleObjectKind): string => {
  if (kind === 'parabola') return 'Parabolic Reflector';
  if (kind === 'single-slit') return 'Single Slit';
  if (kind === 'double-slit') return 'Double Slit';
  return 'Rectangular Barrier';
};

const updateSelectionPanel = (): void => {
  const emitter = getSelectedEmitter();
  const object = getSelectedObject();

  selectionPanel.hidden = !emitter && !object;
  emitterControls.hidden = !emitter;
  objectControls.hidden = !object;

  if (emitter) {
    selectionPanelTitle.textContent = 'Emitter';
    amplitudeInput.value = String(emitter.amplitude);
    frequencyInput.value = String(emitter.frequency);
    phaseInput.value = String(emitter.phase);
    enableButton.textContent = emitter.enabled ? 'Enabled' : 'Disabled';
    enableButton.dataset.enabled = String(emitter.enabled);
  }

  if (object) {
    const slitObject = isSlitObjectKind(object.kind);
    const doubleSlit = object.kind === 'double-slit';
    selectionPanelTitle.textContent = objectKindLabel(object.kind);
    objectWidthInput.max = String(slitObject ? MAX_SLIT_OBJECT_WIDTH : RIPPLE_CONFIG.object.maxSize);
    objectWidthInput.value = String(object.width);
    objectHeightInput.value = String(object.height);
    objectGapControl.hidden = !slitObject;
    objectSpacingControl.hidden = !doubleSlit;
    objectGapInput.value = String(object.gap);
    objectSpacingInput.value = String(object.spacing ?? 0.058);
  }
};

const updateLocalEmitter = (id: string, patch: RippleEmitterPatch): void => {
  emitters = emitters.map((emitter) => (emitter.id === id ? { ...emitter, ...patch } : emitter));
  if (id === selectedEmitterId) updateSelectionPanel();
};

const updateLocalObject = (id: string, patch: RippleObjectPatch): void => {
  objects = objects.map((object) => (object.id === id ? { ...object, ...patch } : object));
  if (id === selectedObjectId) updateSelectionPanel();
};

const syncRipplePanels = (): void => {
  updateSelectionPanel();
};

const clearSelection = (): void => {
  selectedEmitterId = null;
  selectedObjectId = null;
  updateSelectionPanel();
};

const selectEmitter = (id: string): void => {
  selectedEmitterId = id;
  selectedObjectId = null;
  updateSelectionPanel();
};

const selectObject = (id: string): void => {
  selectedObjectId = id;
  selectedEmitterId = null;
  updateSelectionPanel();
};

const handleSnapshot = (snapshot: RippleSnapshot): void => {
  latestSnapshot = snapshot;
  inLobby = false;
  lobbyMessage = '';
  activeRoomCode = resolvePersistentRippleRoomCode(snapshot.roomCode);
  setTankSwitcherOpen(false);
  paused = snapshot.paused;
  pauseButton.textContent = paused ? 'Play' : 'Pause';
  pauseButton.setAttribute('aria-label', paused ? 'Resume ripple simulation' : 'Pause ripple simulation');
  setRoomSummaries(roomSummaries.map((room) => (
    room.roomCode === activeRoomCode ? { ...room, playerCount: snapshot.playerCount } : room
  )));
  updateBrowserRoom();

  if (snapshot.resetVersion !== resetVersion) {
    resetVersion = snapshot.resetVersion;
    processedSplashIds.clear();
    clearGrid();
  }

  emitters = snapshot.emitters;
  objects = snapshot.objects;
  if (selectedEmitterId && !emitters.some((emitter) => emitter.id === selectedEmitterId)) {
    selectedEmitterId = null;
  }
  if (selectedObjectId && !objects.some((object) => object.id === selectedObjectId)) {
    selectedObjectId = null;
  }
  syncRipplePanels();

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
    setRoomSummaries(message.rooms);
    handleSnapshot(message.snapshot);
  } else if (message.type === 'rippleSnapshot') {
    handleSnapshot(message);
  } else if (message.type === 'ripplePresence') {
    setRoomSummaries(roomSummaries.map((room) => (
      room.roomCode === activeRoomCode ? { ...room, playerCount: message.playerCount } : room
    )));
  } else if (message.type === 'rippleRooms') {
    setRoomSummaries(message.rooms);
  } else if (message.type === 'rippleLobby') {
    setRoomSummaries(message.rooms);
    enterLobby(message.message);
  } else if (message.type === 'pong') {
    if (connectionState === 'online') return;
  } else if (message.type === 'error') {
    setConnectionState('error', message.message);
  }
};

const connect = (): void => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  setConnectionState('connecting', 'Connecting');
  socket = new WebSocket(getDefaultWsUrl());
  socket.addEventListener('open', () => sendMessage({ type: 'rippleJoin', name: makeExplorerName(), roomCode: activeRoomCode }));
  socket.addEventListener('message', handleSocketMessage);
  socket.addEventListener('close', () => {
    setConnectionState('offline', 'Offline');
    localPlayerId = null;
    window.setTimeout(connect, 1200);
  });
  socket.addEventListener('error', () => setConnectionState('error', 'Socket error'));
};

const pointFromEvent = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  const screenX = clamp(event.clientX - rect.left, 0, rect.width);
  const screenY = clamp(event.clientY - rect.top, 0, rect.height);
  const world = screenToWorld(screenX, screenY);
  return { screenX, screenY, x: world.x, y: world.y };
};

const handleWheel = (event: WheelEvent): void => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const screenX = clamp(event.clientX - rect.left, 0, rect.width);
  const screenY = clamp(event.clientY - rect.top, 0, rect.height);
  const worldBefore = screenToWorld(screenX, screenY);
  const nextZoom = clamp(camera.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
  if (nextZoom === camera.zoom) return;

  camera.zoom = nextZoom;
  const gridPoint = worldToGrid(worldBefore);
  const metrics = viewMetrics();
  originToCameraPosition(
    gridPoint.col - screenX / metrics.cellWidth,
    gridPoint.row - screenY / metrics.cellHeight,
  );
};

const hitEmitter = (x: number, y: number): RippleEmitterSnapshot | null => {
  for (let index = emitters.length - 1; index >= 0; index -= 1) {
    const emitter = emitters[index];
    const point = worldToScreen(emitter);
    const hitRadius = Math.max(28, emitter.radius * Math.min(size.width, size.height) * 1.8);
    if (Math.hypot(x - point.x, y - point.y) <= hitRadius) return emitter;
  }
  return null;
};

const hitObject = (x: number, y: number): RippleObjectSnapshot | null => {
  const world = screenToWorld(x, y);
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (isPointInsideObject(objects[index], world.x, world.y, 10)) return objects[index];
  }
  return null;
};

const hitObjectHandle = (x: number, y: number): ObjectHandle | null => {
  const selected = selectedObjectId ? objects.find((object) => object.id === selectedObjectId) : null;
  if (!selected) return null;
  const handles = objectHandlePoints(selected);
  if (Math.hypot(x - handles.delete.x, y - handles.delete.y) <= 16) return 'delete';
  if (handles.width && Math.hypot(x - handles.width.x, y - handles.width.y) <= 15) return 'width';
  if (Math.hypot(x - handles.rotate.x, y - handles.rotate.y) <= 16) return 'rotate';
  return null;
};

const sendSplash = (x: number, y: number, strength: number): void => {
  if (paused) return;
  sendMessage({ type: 'rippleSplash', splash: { x, y, strength, radius: RIPPLE_CONFIG.splash.defaultRadius } });
};

const sendEmitterPatch = (id: string, patch: RippleEmitterPatch, force = false): void => {
  updateLocalEmitter(id, patch);
  const now = performance.now();
  if (!force && now - lastEmitterSendAt < EMITTER_SEND_INTERVAL_MS) return;
  lastEmitterSendAt = now;
  sendMessage({ type: 'rippleEmitterUpdate', id, patch });
};

const sendObjectPatch = (id: string, patch: RippleObjectPatch, force = false): void => {
  updateLocalObject(id, patch);
  const now = performance.now();
  if (!force && now - lastObjectSendAt < OBJECT_SEND_INTERVAL_MS) return;
  lastObjectSendAt = now;
  sendMessage({ type: 'rippleObjectUpdate', id, patch });
};

const createObjectAt = (kind: RippleObjectKind, x: number, y: number): void => {
  sendMessage({ type: 'rippleObjectCreate', kind, object: { x, y } });
};

const handlePointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  const point = pointFromEvent(event);
  const handle = hitObjectHandle(point.screenX, point.screenY);

  if (handle === 'delete' && selectedObjectId) {
    sendMessage({ type: 'rippleObjectDelete', id: selectedObjectId });
    clearSelection();
    return;
  }

  if (handle === 'rotate' && selectedObjectId) {
    dragState = { active: true, pointerId: event.pointerId, mode: 'object-rotate', emitterId: null, objectId: selectedObjectId, lastX: point.screenX, lastY: point.screenY, lastAt: performance.now() };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (handle === 'width' && selectedObjectId) {
    dragState = { active: true, pointerId: event.pointerId, mode: 'object-width', emitterId: null, objectId: selectedObjectId, lastX: point.screenX, lastY: point.screenY, lastAt: performance.now() };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const object = hitObject(point.screenX, point.screenY);
  if (object) {
    selectObject(object.id);
    sendObjectPatch(object.id, { x: point.x, y: point.y }, true);
    dragState = { active: true, pointerId: event.pointerId, mode: 'object-move', emitterId: null, objectId: object.id, lastX: point.screenX, lastY: point.screenY, lastAt: performance.now() };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const emitter = hitEmitter(point.screenX, point.screenY);
  if (emitter) {
    selectEmitter(emitter.id);
    sendEmitterPatch(emitter.id, { x: point.x, y: point.y }, true);
    dragState = { active: true, pointerId: event.pointerId, mode: 'emitter', emitterId: emitter.id, objectId: null, lastX: point.screenX, lastY: point.screenY, lastAt: performance.now() };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  clearSelection();
  sendSplash(point.x, point.y, RIPPLE_CONFIG.splash.defaultStrength);
  dragState = { active: true, pointerId: event.pointerId, mode: 'splash', emitterId: null, objectId: null, lastX: point.screenX, lastY: point.screenY, lastAt: performance.now() };
  canvas.setPointerCapture(event.pointerId);
};

const handlePointerMove = (event: PointerEvent): void => {
  if (!dragState.active || dragState.pointerId !== event.pointerId) return;
  const point = pointFromEvent(event);
  const now = performance.now();

  if (dragState.mode === 'emitter' && dragState.emitterId) {
    sendEmitterPatch(dragState.emitterId, { x: point.x, y: point.y });
  } else if (dragState.mode === 'object-move' && dragState.objectId) {
    sendObjectPatch(dragState.objectId, { x: point.x, y: point.y });
  } else if (dragState.mode === 'object-rotate' && dragState.objectId) {
    const object = objects.find((candidate) => candidate.id === dragState.objectId);
    if (object) {
      const center = worldToScreen(object);
      sendObjectPatch(dragState.objectId, { rotation: Math.atan2(point.screenY - center.y, point.screenX - center.x) + Math.PI / 2 });
    }
  } else if (dragState.mode === 'object-width' && dragState.objectId) {
    const object = objects.find((candidate) => candidate.id === dragState.objectId);
    if (object && isSlitObjectKind(object.kind)) {
      sendObjectPatch(dragState.objectId, { width: slitObjectWidthFromPoint(object, point.x, point.y) });
    }
  } else {
    const distance = Math.hypot(point.screenX - dragState.lastX, point.screenY - dragState.lastY);
    if (distance > 24 && now - dragState.lastAt > DRAG_INTERVAL_MS) {
      sendSplash(point.x, point.y, 1.2);
      dragState.lastX = point.screenX;
      dragState.lastY = point.screenY;
      dragState.lastAt = now;
    }
  }
};

const finishPointer = (event: PointerEvent): void => {
  if (!dragState.active || dragState.pointerId !== event.pointerId) return;
  if (dragState.mode === 'emitter' && dragState.emitterId) {
    sendMessage({ type: 'rippleEmitterRelease', id: dragState.emitterId });
  }
  if (
    (dragState.mode === 'object-move' || dragState.mode === 'object-rotate' || dragState.mode === 'object-width') &&
    dragState.objectId
  ) {
    sendMessage({ type: 'rippleObjectRelease', id: dragState.objectId });
  }
  dragState = emptyDragState();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
};

const sendSelectedControlPatch = (patch: RippleEmitterPatch, force = false): void => {
  const emitter = getSelectedEmitter();
  if (!emitter) return;
  sendEmitterPatch(emitter.id, patch, force);
  updateSelectionPanel();
};

const sendSelectedObjectPatch = (patch: RippleObjectPatch, force = false): void => {
  const object = getSelectedObject();
  if (!object) return;
  sendObjectPatch(object.id, patch, force);
  updateSelectionPanel();
};

const updateCamera = (dt: number): void => {
  const left = keyState.has('KeyA') || keyState.has('ArrowLeft');
  const right = keyState.has('KeyD') || keyState.has('ArrowRight');
  const up = keyState.has('KeyW') || keyState.has('ArrowUp');
  const down = keyState.has('KeyS') || keyState.has('ArrowDown');
  camera.xScreens = clamp(camera.xScreens + (Number(right) - Number(left)) * CAMERA_SPEED_SCREENS * dt, -1, 1);
  camera.yScreens = clamp(camera.yScreens + (Number(down) - Number(up)) * CAMERA_SPEED_SCREENS * dt, -1, 1);
};

amplitudeInput.addEventListener('input', () => sendSelectedControlPatch({ amplitude: Number.parseFloat(amplitudeInput.value) }));
amplitudeInput.addEventListener('change', () => sendSelectedControlPatch({ amplitude: Number.parseFloat(amplitudeInput.value) }, true));
frequencyInput.addEventListener('input', () => sendSelectedControlPatch({ frequency: Number.parseFloat(frequencyInput.value) }));
frequencyInput.addEventListener('change', () => sendSelectedControlPatch({ frequency: Number.parseFloat(frequencyInput.value) }, true));
phaseInput.addEventListener('input', () => sendSelectedControlPatch({ phase: Number.parseFloat(phaseInput.value) }));
phaseInput.addEventListener('change', () => sendSelectedControlPatch({ phase: Number.parseFloat(phaseInput.value) }, true));
sensitivityInput.addEventListener('input', () => setDisplaySensitivity(Number.parseFloat(sensitivityInput.value)));
gradientInput.addEventListener('change', () => setGradientDrawing(gradientInput.checked));
objectWidthInput.addEventListener('input', () => sendSelectedObjectPatch({ width: Number.parseFloat(objectWidthInput.value) }));
objectWidthInput.addEventListener('change', () => sendSelectedObjectPatch({ width: Number.parseFloat(objectWidthInput.value) }, true));
objectHeightInput.addEventListener('input', () => sendSelectedObjectPatch({ height: Number.parseFloat(objectHeightInput.value) }));
objectHeightInput.addEventListener('change', () => sendSelectedObjectPatch({ height: Number.parseFloat(objectHeightInput.value) }, true));
objectGapInput.addEventListener('input', () => sendSelectedObjectPatch({ gap: Number.parseFloat(objectGapInput.value) }));
objectGapInput.addEventListener('change', () => sendSelectedObjectPatch({ gap: Number.parseFloat(objectGapInput.value) }, true));
objectSpacingInput.addEventListener('input', () => sendSelectedObjectPatch({ spacing: Number.parseFloat(objectSpacingInput.value) }));
objectSpacingInput.addEventListener('change', () => sendSelectedObjectPatch({ spacing: Number.parseFloat(objectSpacingInput.value) }, true));
enableButton.addEventListener('click', () => {
  const emitter = getSelectedEmitter();
  if (emitter) sendSelectedControlPatch({ enabled: !emitter.enabled }, true);
});
deleteButton.addEventListener('click', () => {
  const object = getSelectedObject();
  if (!object) return;
  sendMessage({ type: 'rippleObjectDelete', id: object.id });
  clearSelection();
});
selectionCloseButton.addEventListener('click', clearSelection);
pauseButton.addEventListener('click', () => sendMessage({ type: 'rippleSetPaused', paused: !paused }));
resetButton.addEventListener('click', () => sendMessage({ type: 'rippleReset' }));
themeButton.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
tankSwitcherButton.addEventListener('click', () => setTankSwitcherOpen(tankSwitcher.hidden));

document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!tankSwitcher.hidden && !tankSwitcher.contains(target) && !tankSwitcherButton.contains(target)) {
    setTankSwitcherOpen(false);
  }
  if (!selectionPanel.hidden && !selectionPanel.contains(target) && !canvas.contains(target)) {
    clearSelection();
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-object-kind]').forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    pendingObjectKind = button.dataset.objectKind as RippleObjectKind;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointerup', (event) => {
    if (!pendingObjectKind) return;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const world = screenToWorld(x, y);
      createObjectAt(pendingObjectKind, world.x, world.y);
    } else {
      createObjectAt(pendingObjectKind, 0.5, 0.5);
    }
    pendingObjectKind = null;
  });
  button.addEventListener('pointercancel', () => {
    pendingObjectKind = null;
  });
});

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);
canvas.addEventListener('wheel', handleWheel, { passive: false });
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
    event.preventDefault();
    keyState.add(event.code);
  }
});
window.addEventListener('keyup', (event) => keyState.delete(event.code));

const draw = (timestamp: number): void => {
  const dt = clamp((timestamp - lastFrameAt) / 1000, 0, 0.04);
  lastFrameAt = timestamp;
  const tankVisible = !inLobby && !document.hidden;

  if (tankVisible) {
    updateCamera(dt);
    buildObjectMask();

    if (!paused) {
      simTime += dt;
      injectEmitters();
      stepGrid();
    }

    drawWater();
    drawObjects();
    drawEmitters(timestamp);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (socket?.readyState === WebSocket.OPEN && timestamp - lastPingAt > PING_INTERVAL_MS) {
    lastPingAt = timestamp;
    sendMessage({ type: 'ping', clientTime: performance.now() });
  }

  window.requestAnimationFrame(draw);
};

initializeTheme();
initializeDisplaySensitivity();
initializeGradientDrawing();
renderTankSwitcher();
updateBrowserRoom();
resize();
connect();
window.requestAnimationFrame(draw);
