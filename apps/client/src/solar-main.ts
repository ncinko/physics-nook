import './solar-styles.css';

import {
  ORBITAL_CONFIG,
  getColorForMass,
  getRadiusForMass,
} from '../../../packages/shared/src/solar.ts';
import type {
  OrbitAddBodyPayload,
  OrbitBodySnapshot,
  OrbitSnapshot,
  SolarClientToServerMessage,
  SolarServerToClientMessage,
  Vec2,
} from '../../../packages/shared/src/solar.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

const canvas = document.getElementById('simCanvas') as HTMLCanvasElement | null;
const countDisplay = document.getElementById('bodyCount');
const playerDisplay = document.getElementById('playerCount');
const connectionPill = document.getElementById('connectionPill');
const statusText = document.getElementById('statusText');
const viewLabel = document.getElementById('viewLabel');

if (!canvas || !countDisplay || !playerDisplay || !connectionPill || !statusText || !viewLabel) {
  throw new Error('Orbitals page markup is missing required elements.');
}

const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) {
  throw new Error('Could not initialize the Orbitals canvas.');
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const keyState = new Set<string>();
const touchPanState = new Set<string>();
const pointer = {
  creating: false,
  id: -1,
  start: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  holdStartTime: 0,
};

type TrailState = {
  points: Vec2[];
  lastUpdatedAt: number;
};

let socket: WebSocket | null = null;
let connectionState: ConnectionState = 'offline';
let localPlayerId: string | null = null;
let latestSnapshot: OrbitSnapshot | null = null;
let snapshotBuffer: OrbitSnapshot[] = [];
const serverClock = { offsetMs: 0, synced: false };
let width = 1;
let height = 1;
let dpr = 1;
let cameraX = 0;
let cameraY = 0;
let zoom = 1;
let lastFrameTime = performance.now();
let lastPingAt = 0;
const trailStates = new Map<string, TrailState>();

const PING_INTERVAL_MS = 2000;
const SNAPSHOT_BUFFER_MAX = 12;
const SNAPSHOT_INTERPOLATION_DELAY_MS = Math.round((1000 / ORBITAL_CONFIG.snapshotRate) * 2.2);
const PAN_SPEED = 520;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.2;
const GRID_SIZE = 120;
const STAR_CELL_SIZE = 520;
const STARS_PER_CELL = 3;
const TRAIL_POINT_MIN_WORLD_DISTANCE = 0.75;
const TRAIL_LIVE_ENDPOINT_MIN_WORLD_DISTANCE = 0.05;
const TRAIL_RESET_WORLD_DISTANCE = 420;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const cloneSnapshot = (snapshot: OrbitSnapshot): OrbitSnapshot => ({
  ...snapshot,
  bodies: snapshot.bodies.map((body) => ({ ...body, path: body.path.map((point) => ({ ...point })) })),
  events: [...snapshot.events],
});

const interpolateBody = (
  from: OrbitBodySnapshot | undefined,
  to: OrbitBodySnapshot,
  amount: number,
): OrbitBodySnapshot => {
  if (!from) return { ...to, path: to.path.map((point) => ({ ...point })) };
  const current = {
    x: lerp(from.x, to.x, amount),
    y: lerp(from.y, to.y, amount),
  };
  return {
    ...to,
    x: current.x,
    y: current.y,
    vx: lerp(from.vx, to.vx, amount),
    vy: lerp(from.vy, to.vy, amount),
    path: [],
  };
};

const interpolateSnapshot = (from: OrbitSnapshot, to: OrbitSnapshot, amount: number): OrbitSnapshot => {
  const previousBodies = new Map(from.bodies.map((body) => [body.id, body]));
  return {
    ...to,
    serverTime: lerp(from.serverTime, to.serverTime, amount),
    bodies: to.bodies.map((body) => interpolateBody(previousBodies.get(body.id), body, amount)),
    events: [],
  };
};

const queueSnapshot = (snapshot: OrbitSnapshot): void => {
  const receivedAt = performance.now();
  const nextOffset = snapshot.serverTime - receivedAt;
  serverClock.offsetMs = serverClock.synced ? serverClock.offsetMs * 0.88 + nextOffset * 0.12 : nextOffset;
  serverClock.synced = true;
  latestSnapshot = snapshot;

  if (snapshotBuffer.length > 0 && snapshot.serverTime < snapshotBuffer[snapshotBuffer.length - 1].serverTime) {
    snapshotBuffer = [];
  }

  snapshotBuffer.push(cloneSnapshot(snapshot));
  if (snapshotBuffer.length > SNAPSHOT_BUFFER_MAX) {
    snapshotBuffer.splice(0, snapshotBuffer.length - SNAPSHOT_BUFFER_MAX);
  }
};

const getRenderableSnapshot = (time: number): OrbitSnapshot | null => {
  if (!latestSnapshot) return null;
  if (snapshotBuffer.length < 2 || !serverClock.synced) return latestSnapshot;

  const renderServerTime = time + serverClock.offsetMs - SNAPSHOT_INTERPOLATION_DELAY_MS;
  while (snapshotBuffer.length > 2 && snapshotBuffer[1].serverTime <= renderServerTime) {
    snapshotBuffer.shift();
  }

  const previous = snapshotBuffer[0];
  const next = snapshotBuffer[1];
  if (!previous || !next) return latestSnapshot;
  if (renderServerTime <= previous.serverTime) return previous;
  if (renderServerTime >= next.serverTime) return next;
  const amount = (renderServerTime - previous.serverTime) / Math.max(1, next.serverTime - previous.serverTime);
  return interpolateSnapshot(previous, next, clamp(amount, 0, 1));
};

const clampWorldToBoundary = (point: Vec2): Vec2 => {
  const limit = ORBITAL_CONFIG.world.boundaryLimit;
  return {
    x: clamp(point.x, -limit, limit),
    y: clamp(point.y, -limit, limit),
  };
};

const clampCameraToBoundary = (): void => {
  const limit = ORBITAL_CONFIG.world.boundaryLimit;
  cameraX = clamp(cameraX, -limit, limit);
  cameraY = clamp(cameraY, -limit, limit);
};

const seededUnit = (x: number, y: number, salt: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const setConnectionState = (state: ConnectionState, label: string): void => {
  connectionState = state;
  connectionPill.dataset.state = state;
  statusText.textContent = label;
};

const getConfiguredWsUrl = (): string | null => {
  const configured = env.VITE_GAME_WS_URL ?? env.PUBLIC_GAME_WS_URL;
  return configured?.trim() || null;
};

const appendSolarPath = (base: string): string => {
  const url = new URL(base, window.location.href);
  if (!url.pathname.endsWith('/solar')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/solar`;
  }
  return url.toString();
};

const getDefaultWsUrl = (): string => {
  const configured = getConfiguredWsUrl();
  if (configured) return appendSolarPath(configured);

  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const hostName = window.location.hostname || 'localhost';
  if (localHosts.has(hostName) || hostName.startsWith('192.168.') || hostName.startsWith('10.') || hostName.endsWith('.local')) {
    return `ws://${hostName}:8788/solar`;
  }

  if (window.location.protocol === 'https:') {
    return 'wss://ws.physicsnook.com/solar';
  }

  return `ws://${hostName}:8788/solar`;
};

const makeExplorerName = (): string => {
  const stored = localStorage.getItem('physics-nook-orbitals-name');
  if (stored) return stored;
  const suffix = Math.floor(Math.random() * 900 + 100);
  const name = `Explorer ${suffix}`;
  localStorage.setItem('physics-nook-orbitals-name', name);
  return name;
};

const sendMessage = (message: SolarClientToServerMessage): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

const screenToWorld = (clientX: number, clientY: number): Vec2 => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: cameraX + (clientX - rect.left - width / 2) / zoom,
    y: cameraY + (clientY - rect.top - height / 2) / zoom,
  };
};

const worldToScreen = (point: Vec2): Vec2 => ({
  x: width / 2 + (point.x - cameraX) * zoom,
  y: height / 2 + (point.y - cameraY) * zoom,
});

const distanceWorld = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const resize = (): void => {
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
};

const drawGrid = (): void => {
  const startWorldX = cameraX - width / (2 * zoom);
  const endWorldX = cameraX + width / (2 * zoom);
  const startWorldY = cameraY - height / (2 * zoom);
  const endWorldY = cameraY + height / (2 * zoom);
  const firstX = Math.floor(startWorldX / GRID_SIZE) * GRID_SIZE;
  const firstY = Math.floor(startWorldY / GRID_SIZE) * GRID_SIZE;

  ctx.save();
  ctx.lineWidth = 1;
  for (let x = firstX; x <= endWorldX; x += GRID_SIZE) {
    const screen = worldToScreen({ x, y: 0 }).x;
    ctx.beginPath();
    ctx.moveTo(screen, 0);
    ctx.lineTo(screen, height);
    ctx.strokeStyle = x === 0 ? 'rgba(125, 211, 252, 0.22)' : 'rgba(148, 163, 184, 0.08)';
    ctx.stroke();
  }
  for (let y = firstY; y <= endWorldY; y += GRID_SIZE) {
    const screen = worldToScreen({ x: 0, y }).y;
    ctx.beginPath();
    ctx.moveTo(0, screen);
    ctx.lineTo(width, screen);
    ctx.strokeStyle = y === 0 ? 'rgba(125, 211, 252, 0.22)' : 'rgba(148, 163, 184, 0.08)';
    ctx.stroke();
  }
  ctx.restore();
};

const drawStars = (): void => {
  const startWorldX = cameraX - width / (2 * zoom);
  const endWorldX = cameraX + width / (2 * zoom);
  const startWorldY = cameraY - height / (2 * zoom);
  const endWorldY = cameraY + height / (2 * zoom);
  const firstCellX = Math.floor(startWorldX / STAR_CELL_SIZE) - 1;
  const lastCellX = Math.floor(endWorldX / STAR_CELL_SIZE) + 1;
  const firstCellY = Math.floor(startWorldY / STAR_CELL_SIZE) - 1;
  const lastCellY = Math.floor(endWorldY / STAR_CELL_SIZE) + 1;

  ctx.save();
  ctx.fillStyle = '#dbeafe';
  for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
    for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
      for (let starIndex = 0; starIndex < STARS_PER_CELL; starIndex += 1) {
        const star = {
          x: (cellX + seededUnit(cellX, cellY, starIndex)) * STAR_CELL_SIZE,
          y: (cellY + seededUnit(cellX, cellY, starIndex + 9)) * STAR_CELL_SIZE,
          radius: 0.55 + seededUnit(cellX, cellY, starIndex + 17) * 1.45,
          alpha: 0.22 + seededUnit(cellX, cellY, starIndex + 31) * 0.42,
        };
        const screen = worldToScreen(star);
        ctx.globalAlpha = star.alpha;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, clamp(star.radius * Math.sqrt(zoom), 0.45, 2.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
};

const drawBoundary = (): void => {
  const limit = ORBITAL_CONFIG.world.boundaryLimit;
  const despawnLimit = limit + ORBITAL_CONFIG.world.despawnMargin;
  const topLeft = worldToScreen({ x: -limit, y: -limit });
  const bottomRight = worldToScreen({ x: limit, y: limit });
  const despawnTopLeft = worldToScreen({ x: -despawnLimit, y: -despawnLimit });
  const despawnBottomRight = worldToScreen({ x: despawnLimit, y: despawnLimit });

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.62)';
  ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.24)';
  ctx.strokeRect(
    despawnTopLeft.x,
    despawnTopLeft.y,
    despawnBottomRight.x - despawnTopLeft.x,
    despawnBottomRight.y - despawnTopLeft.y,
  );
  ctx.restore();
};

const withClientTrail = (body: OrbitBodySnapshot, time: number): OrbitBodySnapshot => {
  const currentPoint = { x: body.x, y: body.y };
  let trail = trailStates.get(body.id);

  if (!trail) {
    trail = { points: [currentPoint], lastUpdatedAt: time };
    trailStates.set(body.id, trail);
  } else {
    const previous = trail.points[trail.points.length - 1];
    const shouldReset = previous && distanceWorld(previous, currentPoint) > TRAIL_RESET_WORLD_DISTANCE;
    if (shouldReset) {
      trail.points = [currentPoint];
    } else if (!previous || distanceWorld(previous, currentPoint) >= TRAIL_POINT_MIN_WORLD_DISTANCE) {
      trail.points.push(currentPoint);
      if (trail.points.length > ORBITAL_CONFIG.trailLength) {
        trail.points.splice(0, trail.points.length - ORBITAL_CONFIG.trailLength);
      }
    }
    trail.lastUpdatedAt = time;
  }

  const lastPoint = trail.points[trail.points.length - 1];
  const path =
    lastPoint && distanceWorld(lastPoint, currentPoint) >= TRAIL_LIVE_ENDPOINT_MIN_WORLD_DISTANCE
      ? [...trail.points, currentPoint]
      : trail.points;

  return {
    ...body,
    path,
  };
};

const attachClientTrails = (bodies: OrbitBodySnapshot[], time: number): OrbitBodySnapshot[] => {
  const activeIds = new Set(bodies.map((body) => body.id));
  for (const [id, trail] of trailStates.entries()) {
    if (!activeIds.has(id) || time - trail.lastUpdatedAt > 2000) {
      trailStates.delete(id);
    }
  }
  return bodies.map((body) => withClientTrail(body, time));
};

const drawBodyTrail = (body: OrbitBodySnapshot): void => {
  if (body.path.length < 2) return;

  const points = body.path
    .map(worldToScreen)
    .filter((point, index, allPoints) => {
      if (index === 0) return true;
      const previous = allPoints[index - 1];
      return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.35;
    });
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, body.radius * 0.28 * zoom);

  if (points.length === 2) {
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = body.color;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const from =
      index === 1
        ? previous
        : {
            x: (previous.x + current.x) / 2,
            y: (previous.y + current.y) / 2,
          };
    const to =
      next && index < points.length - 1
        ? {
            x: (current.x + next.x) / 2,
            y: (current.y + next.y) / 2,
          }
        : current;

    ctx.globalAlpha = (index / (points.length - 1)) * 0.58;
    ctx.strokeStyle = body.color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(current.x, current.y, to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawBody = (body: OrbitBodySnapshot): void => {
  const screen = worldToScreen(body);
  const radius = Math.max(2, body.radius * zoom);
  if (screen.x < -radius * 4 || screen.x > width + radius * 4 || screen.y < -radius * 4 || screen.y > height + radius * 4) {
    return;
  }

  ctx.save();
  ctx.shadowBlur = Math.min(42, radius * 1.8);
  ctx.shadowColor = body.color;
  ctx.fillStyle = body.color;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
};

const getPreviewMass = (): number => {
  const timeHeld = Date.now() - pointer.holdStartTime;
  return Math.min(
    ORBITAL_CONFIG.creation.baseMass + timeHeld * ORBITAL_CONFIG.creation.massGrowthRate,
    ORBITAL_CONFIG.creation.maxMass,
  );
};

const drawCreationPreview = (): void => {
  if (!pointer.creating) return;

  const mass = getPreviewMass();
  const radius = getRadiusForMass(mass) * zoom;
  const color = getColorForMass(mass);
  const start = worldToScreen(pointer.start);
  const current = worldToScreen(pointer.current);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(current.x, current.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.shadowBlur = Math.min(48, radius * 2);
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.arc(start.x, start.y, Math.max(2, radius), 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(start.x, start.y, Math.max(7, radius + 4), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const updateCameraPan = (dtSeconds: number): void => {
  const has = (code: string) => keyState.has(code) || touchPanState.has(code);
  let dx = 0;
  let dy = 0;
  if (has('KeyA') || has('ArrowLeft')) dx -= 1;
  if (has('KeyD') || has('ArrowRight')) dx += 1;
  if (has('KeyW') || has('ArrowUp')) dy -= 1;
  if (has('KeyS') || has('ArrowDown')) dy += 1;

  if (dx === 0 && dy === 0) return;
  const length = Math.hypot(dx, dy) || 1;
  const speed = PAN_SPEED / zoom;
  cameraX += (dx / length) * speed * dtSeconds;
  cameraY += (dy / length) * speed * dtSeconds;
  clampCameraToBoundary();
};

const updateUi = (): void => {
  const bodies = latestSnapshot?.bodies.length ?? 0;
  const players = latestSnapshot?.playerCount ?? (connectionState === 'online' ? 1 : 0);
  countDisplay.textContent = `${bodies}/${ORBITAL_CONFIG.maxBodies}`;
  playerDisplay.textContent = players.toString();
  viewLabel.textContent = `${Math.round(cameraX)}, ${Math.round(cameraY)}`;
};

const render = (time: number): void => {
  const dtSeconds = Math.min(0.05, Math.max(0.001, (time - lastFrameTime) / 1000));
  lastFrameTime = time;
  updateCameraPan(dtSeconds);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, width, height);

  drawStars();
  drawGrid();
  drawBoundary();

  const renderSnapshot = getRenderableSnapshot(time);
  const bodies = attachClientTrails(renderSnapshot?.bodies ?? [], time);
  for (const body of bodies) drawBodyTrail(body);
  for (const body of bodies) drawBody(body);
  drawCreationPreview();
  updateUi();

  if (socket?.readyState === WebSocket.OPEN && time - lastPingAt >= PING_INTERVAL_MS) {
    sendMessage({ type: 'ping', clientTime: time });
    lastPingAt = time;
  }

  window.requestAnimationFrame(render);
};

const handleSocketMessage = (event: MessageEvent): void => {
  let message: SolarServerToClientMessage;
  try {
    message = JSON.parse(String(event.data)) as SolarServerToClientMessage;
  } catch {
    setConnectionState('error', 'Bad message');
    return;
  }

  if (message.type === 'solarJoined') {
    localPlayerId = message.you;
    queueSnapshot(message.snapshot);
    setConnectionState('online', 'Online');
    return;
  }

  if (message.type === 'solarSnapshot') {
    queueSnapshot(message);
    return;
  }

  if (message.type === 'solarPresence') {
    if (latestSnapshot) {
      latestSnapshot = { ...latestSnapshot, playerCount: message.playerCount };
    }
    return;
  }

  if (message.type === 'pong') {
    const nextOffset = message.serverTime - performance.now();
    serverClock.offsetMs = serverClock.synced ? serverClock.offsetMs * 0.9 + nextOffset * 0.1 : nextOffset;
    serverClock.synced = true;
    return;
  }

  if (message.type === 'error') {
    setConnectionState('error', message.message);
  }
};

const connect = (): void => {
  if (socket && socket.readyState !== WebSocket.CLOSED) return;
  setConnectionState('connecting', 'Connecting');

  const nextSocket = new WebSocket(getDefaultWsUrl());
  socket = nextSocket;

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return;
    setConnectionState('connecting', 'Joining');
    sendMessage({ type: 'solarJoin', name: makeExplorerName() });
  });

  nextSocket.addEventListener('message', handleSocketMessage);

  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return;
    setConnectionState('offline', 'Offline');
    socket = null;
    localPlayerId = null;
    latestSnapshot = null;
    snapshotBuffer = [];
    trailStates.clear();
    serverClock.synced = false;
    window.setTimeout(connect, 1400);
  });

  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return;
    setConnectionState('error', 'Socket error');
  });
};

const handlePointerDown = (event: PointerEvent): void => {
  if (event.button !== 0 || connectionState !== 'online') return;
  event.preventDefault();
  pointer.creating = true;
  pointer.id = event.pointerId;
  pointer.start = clampWorldToBoundary(screenToWorld(event.clientX, event.clientY));
  pointer.current = { ...pointer.start };
  pointer.holdStartTime = Date.now();
  canvas.setPointerCapture?.(event.pointerId);
};

const handlePointerMove = (event: PointerEvent): void => {
  if (!pointer.creating || event.pointerId !== pointer.id) return;
  event.preventDefault();
  pointer.current = screenToWorld(event.clientX, event.clientY);
};

const finishCreation = (event: PointerEvent): void => {
  if (!pointer.creating || event.pointerId !== pointer.id) return;
  event.preventDefault();
  pointer.current = screenToWorld(event.clientX, event.clientY);
  pointer.creating = false;

  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  const body: OrbitAddBodyPayload = {
    x: pointer.start.x,
    y: pointer.start.y,
    vx: (pointer.current.x - pointer.start.x) * ORBITAL_CONFIG.creation.velocityScale,
    vy: (pointer.current.y - pointer.start.y) * ORBITAL_CONFIG.creation.velocityScale,
    mass: getPreviewMass(),
  };
  sendMessage({ type: 'solarAddBody', body });
};

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', finishCreation);
canvas.addEventListener('pointercancel', (event) => {
  pointer.creating = false;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const before = screenToWorld(event.clientX, event.clientY);
    zoom = clamp(zoom * (event.deltaY > 0 ? 0.92 : 1.08), MIN_ZOOM, MAX_ZOOM);
    const after = screenToWorld(event.clientX, event.clientY);
    cameraX += before.x - after.x;
    cameraY += before.y - after.y;
    clampCameraToBoundary();
  },
  { passive: false },
);

document.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
    event.preventDefault();
    keyState.add(event.code);
  }
});

document.addEventListener('keyup', (event) => {
  keyState.delete(event.code);
});

window.addEventListener('blur', () => {
  keyState.clear();
  touchPanState.clear();
});

document.querySelectorAll<HTMLButtonElement>('[data-pan]').forEach((button) => {
  const code = button.dataset.pan;
  if (!code) return;
  const setPressed = (pressed: boolean) => {
    if (pressed) touchPanState.add(code);
    else touchPanState.delete(code);
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    setPressed(true);
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointerup', (event) => {
    event.preventDefault();
    setPressed(false);
    if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
  });
  button.addEventListener('pointercancel', () => setPressed(false));
  button.addEventListener('pointerleave', () => setPressed(false));
});

window.addEventListener('resize', resize);
resize();
setConnectionState('offline', 'Offline');
connect();
window.requestAnimationFrame(render);
