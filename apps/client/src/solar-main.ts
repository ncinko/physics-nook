import './solar-styles.css';

import * as THREE from 'three';

import {
  DEFAULT_SOLAR_INPUT,
  SOLAR_BODIES,
  SOLAR_CONFIG,
  addVec,
  distanceVec,
  getBodyTransforms,
  getLaunchSite,
  getNearestBody,
  getShipSpawnTransform,
  lerpVec,
  normalizeVec,
  projectOnPlane,
  rotateVectorAroundAxis,
  scaleVec,
} from '../../../packages/shared/src/solar.ts';
import type {
  SolarBodyConfig,
  SolarBodyId,
  SolarClientToServerMessage,
  SolarInputState,
  SolarPlayerSnapshot,
  SolarServerToClientMessage,
  SolarShipSnapshot,
  SolarSnapshot,
  Vec3,
} from '../../../packages/shared/src/solar.ts';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

type BodyRuntime = {
  body: SolarBodyConfig;
  group: THREE.Group;
  orbitLine: THREE.LineLoop | null;
};

const SNAPSHOT_BUFFER_MAX = 12;
const SNAPSHOT_INTERPOLATION_DELAY_MS = Math.round((1000 / SOLAR_CONFIG.snapshotRate) * 1.8);
const PING_INTERVAL_MS = 2000;
const INPUT_FLUSH_MS = 1000 / 30;
const STAR_COUNT = 1200;

const host = document.getElementById('solarScene');
const connectionPill = document.getElementById('connectionPill');
const statusText = document.getElementById('statusText');
const usePrompt = document.getElementById('usePrompt');
const targetLabel = document.getElementById('targetLabel');

if (!host || !connectionPill || !statusText || !usePrompt || !targetLabel) {
  throw new Error('Solar system page markup is missing required elements.');
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#02040a');
scene.fog = new THREE.FogExp2('#02040a', 0.0016);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'solar-canvas';
host.replaceChildren(renderer.domElement);

scene.add(new THREE.AmbientLight('#b9d7ff', 0.32));
const sunLight = new THREE.PointLight('#fff1bf', 9000, 650, 1.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);

const keyState = new Set<string>();
const touchState: Partial<Record<keyof SolarInputState, boolean>> = {};
const bodyRuntimes = new Map<SolarBodyId, BodyRuntime>();
const avatarGroups = new Map<string, THREE.Group>();
const bodyGeometry = new THREE.SphereGeometry(1, 72, 36);
const serverClock = { offsetMs: 0, synced: false };
let socket: WebSocket | null = null;
let connectionState: ConnectionState = 'offline';
let localPlayerId: string | null = null;
let latestSnapshot: SolarSnapshot | null = null;
let snapshotBuffer: SolarSnapshot[] = [];
let inputSeq = 0;
let lastInputFlush = 0;
let lastPingAt = 0;
let cameraYaw = 0;
let cameraPitch = 0.34;
let cameraDistance = 13;
let draggingCamera = false;
let lastPointerX = 0;
let lastPointerY = 0;

const toThree = (value: Vec3): THREE.Vector3 => new THREE.Vector3(value.x, value.y, value.z);
const fromThree = (value: THREE.Vector3): Vec3 => ({ x: value.x, y: value.y, z: value.z });
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const seedFromString = (value: string): number =>
  [...value].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 2166136261);

const seededRandom = (seedStart: number) => {
  let seed = seedStart >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
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
  const stored = localStorage.getItem('physics-nook-solar-name');
  if (stored) return stored;
  const suffix = Math.floor(Math.random() * 900 + 100);
  const name = `Explorer ${suffix}`;
  localStorage.setItem('physics-nook-solar-name', name);
  return name;
};

const sendMessage = (message: SolarClientToServerMessage): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

const createPlanetTexture = (body: SolarBodyConfig): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = body.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(seedFromString(body.id));

  if (body.id === 'earth') {
    context.fillStyle = '#38b66b';
    for (let index = 0; index < 38; index += 1) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const rx = 14 + random() * 42;
      const ry = 6 + random() * 24;
      context.beginPath();
      context.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = 'rgba(255,255,255,0.82)';
    context.fillRect(0, 0, canvas.width, 12);
    context.fillRect(0, canvas.height - 16, canvas.width, 16);
  } else if (body.id === 'giant') {
    for (let y = 0; y < canvas.height; y += 16) {
      context.fillStyle = y % 32 === 0 ? '#6db7d6' : '#d6f2ff';
      context.fillRect(0, y, canvas.width, 12);
    }
  } else if (body.id === 'moon') {
    context.fillStyle = 'rgba(82, 91, 105, 0.38)';
    for (let index = 0; index < 54; index += 1) {
      const radius = 2 + random() * 10;
      context.beginPath();
      context.arc(random() * canvas.width, random() * canvas.height, radius, 0, Math.PI * 2);
      context.fill();
    }
  } else if (body.id === 'mars' || body.id === 'mercury') {
    context.fillStyle = 'rgba(46, 20, 18, 0.18)';
    for (let index = 0; index < 44; index += 1) {
      context.beginPath();
      context.ellipse(random() * canvas.width, random() * canvas.height, 10 + random() * 34, 3 + random() * 14, 0, 0, Math.PI * 2);
      context.fill();
    }
  } else if (body.id === 'sun') {
    const gradient = context.createRadialGradient(256, 128, 10, 256, 128, 250);
    gradient.addColorStop(0, '#fff6b7');
    gradient.addColorStop(0.52, body.color);
    gradient.addColorStop(1, '#ff7a1a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
};

const createOrbitLine = (body: SolarBodyConfig): THREE.LineLoop | null => {
  if (!body.parentId || body.orbitRadius <= 0) return null;
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 180; index += 1) {
    const angle = (index / 180) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * body.orbitRadius, 0, Math.sin(angle) * body.orbitRadius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: '#37536f', transparent: true, opacity: 0.38 });
  const line = new THREE.LineLoop(geometry, material);
  line.rotation.x = THREE.MathUtils.degToRad(body.orbitInclinationDeg);
  scene.add(line);
  return line;
};

const createBodyRuntime = (body: SolarBodyConfig): BodyRuntime => {
  const group = new THREE.Group();
  group.name = body.id;

  const material =
    body.id === 'sun'
      ? new THREE.MeshBasicMaterial({ map: createPlanetTexture(body), color: '#ffffff' })
      : new THREE.MeshStandardMaterial({
          map: createPlanetTexture(body),
          roughness: 0.86,
          metalness: 0.02,
        });
  const sphere = new THREE.Mesh(bodyGeometry, material);
  sphere.scale.setScalar(body.radius);
  sphere.castShadow = body.id !== 'sun';
  sphere.receiveShadow = body.id !== 'sun';
  group.add(sphere);

  if (body.atmosphereColor) {
    const atmosphere = new THREE.Mesh(
      bodyGeometry,
      new THREE.MeshBasicMaterial({
        color: body.atmosphereColor,
        transparent: true,
        opacity: body.id === 'earth' ? 0.16 : 0.11,
        side: THREE.BackSide,
      }),
    );
    atmosphere.scale.setScalar(body.radius * 1.04);
    group.add(atmosphere);
  }

  if (body.id === 'sun') {
    const glow = new THREE.Mesh(
      bodyGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.22, side: THREE.BackSide }),
    );
    glow.scale.setScalar(body.radius * 1.35);
    group.add(glow);
  }

  scene.add(group);
  const runtime = { body, group, orbitLine: createOrbitLine(body) };
  bodyRuntimes.set(body.id, runtime);
  return runtime;
};

const createStars = (): void => {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const random = seededRandom(9001);

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 520 + random() * 320;
    positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[index * 3 + 1] = Math.cos(phi) * radius;
    positions[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    const warmth = 0.72 + random() * 0.28;
    colors[index * 3] = warmth;
    colors[index * 3 + 1] = 0.82 + random() * 0.18;
    colors[index * 3 + 2] = 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 1.25, vertexColors: true, transparent: true, opacity: 0.9 });
  scene.add(new THREE.Points(geometry, material));
};

const makeAvatarGroup = (color: string): THREE.Group => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, SOLAR_CONFIG.player.height * 0.62, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
  );
  body.position.y = SOLAR_CONFIG.player.height * 0.31;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 12),
    new THREE.MeshStandardMaterial({ color: '#f5d0a9', roughness: 0.72 }),
  );
  head.position.y = SOLAR_CONFIG.player.height * 0.72;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.12, 0.04),
    new THREE.MeshStandardMaterial({ color: '#07121f', roughness: 0.32, metalness: 0.1 }),
  );
  visor.position.set(0, SOLAR_CONFIG.player.height * 0.72, 0.25);
  group.add(visor);
  scene.add(group);
  return group;
};

const shipGroup = new THREE.Group();
const shipMaterial = new THREE.MeshStandardMaterial({ color: '#e5edf6', roughness: 0.42, metalness: 0.16 });
const shipAccent = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.5 });
const shipGlass = new THREE.MeshStandardMaterial({ color: '#0ea5e9', roughness: 0.18, metalness: 0.05, emissive: '#082f49' });
const shipBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 3.8), shipMaterial);
shipBody.castShadow = true;
shipGroup.add(shipBody);
const shipNose = new THREE.Mesh(new THREE.ConeGeometry(0.86, 1.35, 24), shipMaterial);
shipNose.rotation.x = Math.PI / 2;
shipNose.position.z = 2.55;
shipNose.castShadow = true;
shipGroup.add(shipNose);
const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 14), shipGlass);
cockpit.scale.set(1, 0.48, 0.72);
cockpit.position.set(0, 0.52, 0.84);
shipGroup.add(cockpit);
for (const side of [-1, 1]) {
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.1), shipAccent);
  wing.position.set(side * 1.16, -0.1, -0.42);
  wing.rotation.z = side * -0.18;
  wing.castShadow = true;
  shipGroup.add(wing);
}
scene.add(shipGroup);

const setObjectBasis = (object: THREE.Object3D, position: Vec3, forward: Vec3, up: Vec3): void => {
  const f = toThree(normalizeVec(forward, { x: 0, y: 0, z: 1 })).normalize();
  const u = toThree(normalizeVec(up, { x: 0, y: 1, z: 0 })).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  if (r.lengthSq() < 1e-8) return;
  const correctedUp = new THREE.Vector3().crossVectors(r, f).normalize();
  const matrix = new THREE.Matrix4().makeBasis(r, correctedUp, f);
  object.position.copy(toThree(position));
  object.quaternion.setFromRotationMatrix(matrix);
};

const interpolatePlayer = (from: SolarPlayerSnapshot | undefined, to: SolarPlayerSnapshot, amount: number): SolarPlayerSnapshot => {
  if (!from || from.mode !== to.mode || from.bodyId !== to.bodyId) return { ...to };
  return {
    ...to,
    position: lerpVec(from.position, to.position, amount),
    velocity: lerpVec(from.velocity, to.velocity, amount),
    up: normalizeVec(lerpVec(from.up, to.up, amount), to.up),
    forward: normalizeVec(lerpVec(from.forward, to.forward, amount), to.forward),
  };
};

const interpolateShip = (from: SolarShipSnapshot, to: SolarShipSnapshot, amount: number): SolarShipSnapshot => ({
  ...to,
  position: lerpVec(from.position, to.position, amount),
  velocity: lerpVec(from.velocity, to.velocity, amount),
  forward: normalizeVec(lerpVec(from.forward, to.forward, amount), to.forward),
  up: normalizeVec(lerpVec(from.up, to.up, amount), to.up),
  right: normalizeVec(lerpVec(from.right, to.right, amount), to.right),
});

const interpolateSnapshot = (from: SolarSnapshot, to: SolarSnapshot, amount: number): SolarSnapshot => ({
  ...to,
  players: to.players.map((player) => interpolatePlayer(from.players.find((candidate) => candidate.id === player.id), player, amount)),
  ship: interpolateShip(from.ship, to.ship, amount),
  events: [],
});

const queueSnapshot = (snapshot: SolarSnapshot): void => {
  const receivedAt = performance.now();
  const nextOffset = snapshot.serverTime - receivedAt;
  serverClock.offsetMs = serverClock.synced ? serverClock.offsetMs * 0.88 + nextOffset * 0.12 : nextOffset;
  serverClock.synced = true;
  latestSnapshot = snapshot;
  if (snapshotBuffer.length > 0 && snapshot.serverTime < snapshotBuffer[snapshotBuffer.length - 1].serverTime) {
    snapshotBuffer = [];
  }
  snapshotBuffer.push(snapshot);
  if (snapshotBuffer.length > SNAPSHOT_BUFFER_MAX) snapshotBuffer.splice(0, snapshotBuffer.length - SNAPSHOT_BUFFER_MAX);
};

const getRenderableSnapshot = (time: number): SolarSnapshot | null => {
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

const updateBodies = (serverTime: number): void => {
  const transforms = getBodyTransforms(serverTime);
  for (const body of SOLAR_BODIES) {
    const runtime = bodyRuntimes.get(body.id) ?? createBodyRuntime(body);
    const transform = transforms[body.id];
    runtime.group.position.copy(toThree(transform.position));
    runtime.group.rotation.y = transform.rotationAngle;
    if (body.id === 'sun') {
      sunLight.position.copy(runtime.group.position);
    }
    if (runtime.orbitLine && body.parentId) {
      runtime.orbitLine.position.copy(toThree(transforms[body.parentId].position));
    }
  }
};

const updateAvatars = (snapshot: SolarSnapshot | null): void => {
  const activeIds = new Set(snapshot?.players.map((player) => player.id) ?? []);
  for (const [id, group] of avatarGroups.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(group);
      avatarGroups.delete(id);
    }
  }

  if (!snapshot) return;
  for (const player of snapshot.players) {
    if (player.id === localPlayerId && player.mode === 'ship') {
      const localAvatar = avatarGroups.get(player.id);
      if (localAvatar) localAvatar.visible = false;
      continue;
    }
    const group = avatarGroups.get(player.id) ?? makeAvatarGroup(player.color);
    group.visible = true;
    avatarGroups.set(player.id, group);
    setObjectBasis(group, player.position, player.forward, player.up);
  }
};

const updateShip = (snapshot: SolarSnapshot | null): void => {
  const serverTime = snapshot?.serverTime ?? performance.now() + serverClock.offsetMs;
  const ship = snapshot?.ship ?? getShipSpawnTransform(serverTime);
  setObjectBasis(shipGroup, ship.position, ship.forward, ship.up);
};

const readInput = (): SolarInputState => {
  const has = (code: string) => keyState.has(code);
  return {
    forward: has('KeyW') || has('ArrowUp') || Boolean(touchState.forward),
    backward: has('KeyS') || Boolean(touchState.backward),
    left: has('KeyA') || Boolean(touchState.left),
    right: has('KeyD') || Boolean(touchState.right),
    jump: has('Space') || Boolean(touchState.jump),
    sprint: has('ShiftLeft') || has('ShiftRight') || Boolean(touchState.boost),
    boost: has('ShiftLeft') || has('ShiftRight') || Boolean(touchState.boost),
    ascend: has('Space') || Boolean(touchState.jump),
    descend: has('ControlLeft') || has('ControlRight'),
    yawLeft: has('ArrowLeft'),
    yawRight: has('ArrowRight'),
    pitchUp: has('KeyI'),
    pitchDown: has('KeyK'),
    rollLeft: has('KeyQ'),
    rollRight: has('KeyR'),
  };
};

const sendInput = (): void => {
  if (connectionState !== 'online') return;
  const cameraForward = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  sendMessage({
    type: 'solarInput',
    seq: ++inputSeq,
    input: readInput(),
    cameraForward: fromThree(cameraForward),
    cameraRight: fromThree(cameraRight),
  });
};

const updateCamera = (snapshot: SolarSnapshot | null, serverTime: number): void => {
  const localPlayer = snapshot?.players.find((player) => player.id === localPlayerId) ?? null;
  const targetShip = snapshot?.ship ?? null;
  let targetPosition: Vec3;
  let targetForward: Vec3;
  let targetUp: Vec3;
  let desiredDistance: number;

  if (localPlayer) {
    targetPosition = localPlayer.mode === 'ship' && targetShip ? targetShip.position : localPlayer.position;
    targetForward = localPlayer.mode === 'ship' && targetShip ? targetShip.forward : localPlayer.forward;
    targetUp = localPlayer.mode === 'ship' && targetShip ? targetShip.up : localPlayer.up;
    desiredDistance = localPlayer.mode === 'ship' ? 18 : 12.5;
    const nearest = getNearestBody(targetPosition, serverTime);
    targetLabel.textContent = localPlayer.mode === 'ship' ? 'Starter ship' : `${nearest.body.name} surface`;
  } else {
    const launch = getLaunchSite(serverTime);
    targetPosition = launch.position;
    targetForward = launch.forward;
    targetUp = launch.up;
    desiredDistance = 18;
    targetLabel.textContent = 'Earth launch site';
  }

  cameraDistance += (desiredDistance - cameraDistance) * 0.08;
  const up = normalizeVec(targetUp);
  const baseForward = normalizeVec(projectOnPlane(targetForward, up), targetForward);
  const viewForward = normalizeVec(rotateVectorAroundAxis(baseForward, up, cameraYaw), baseForward);
  const back = scaleVec(viewForward, -Math.cos(cameraPitch) * cameraDistance);
  const lift = scaleVec(up, Math.sin(cameraPitch) * cameraDistance + 2.2);
  const desiredPosition = addVec(addVec(targetPosition, back), lift);

  camera.position.lerp(toThree(desiredPosition), 0.22);
  camera.up.copy(toThree(up));
  camera.lookAt(toThree(addVec(addVec(targetPosition, scaleVec(up, 1.35)), scaleVec(viewForward, 1.4))));
};

const updateUsePrompt = (snapshot: SolarSnapshot | null): void => {
  if (!snapshot || !localPlayerId) {
    usePrompt.hidden = true;
    return;
  }

  const localPlayer = snapshot.players.find((player) => player.id === localPlayerId);
  if (!localPlayer) {
    usePrompt.hidden = true;
    return;
  }

  if (snapshot.ship.pilotId === localPlayerId) {
    usePrompt.textContent = 'Exit';
    usePrompt.hidden = false;
    return;
  }

  const canBoard =
    localPlayer.mode === 'surface' &&
    snapshot.ship.pilotId === null &&
    distanceVec(localPlayer.position, snapshot.ship.position) <= SOLAR_CONFIG.ship.boardRadius;
  usePrompt.textContent = 'Board';
  usePrompt.hidden = !canBoard;
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
    window.setTimeout(connect, 1400);
  });

  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return;
    setConnectionState('error', 'Socket error');
  });
};

const resize = (): void => {
  const width = Math.max(host.clientWidth, 320);
  const height = Math.max(host.clientHeight, 320);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};

const handlePointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  draggingCamera = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  renderer.domElement.setPointerCapture?.(event.pointerId);
};

const handlePointerMove = (event: PointerEvent): void => {
  if (!draggingCamera) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  cameraYaw -= dx * 0.0048;
  cameraPitch = clamp(cameraPitch + dy * 0.0038, -0.18, 1.15);
};

const handlePointerUp = (event: PointerEvent): void => {
  draggingCamera = false;
  if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
};

renderer.domElement.addEventListener('pointerdown', handlePointerDown);
renderer.domElement.addEventListener('pointermove', handlePointerMove);
renderer.domElement.addEventListener('pointerup', handlePointerUp);
renderer.domElement.addEventListener('pointerleave', handlePointerUp);
renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    cameraDistance = clamp(cameraDistance * (event.deltaY > 0 ? 1.08 : 0.92), 7, 42);
  },
  { passive: false },
);

document.addEventListener('keydown', (event) => {
  if (event.repeat && event.code === 'KeyE') return;
  if (event.code === 'KeyE') {
    event.preventDefault();
    sendMessage({ type: 'solarUse' });
    return;
  }
  keyState.add(event.code);
});

document.addEventListener('keyup', (event) => {
  keyState.delete(event.code);
});

window.addEventListener('blur', () => {
  keyState.clear();
  for (const key of Object.keys(touchState) as (keyof SolarInputState)[]) {
    touchState[key] = false;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
  const control = button.dataset.control as keyof SolarInputState | undefined;
  if (!control) return;
  const setPressed = (pressed: boolean) => {
    touchState[control] = pressed;
    if (control === 'boost') {
      touchState.sprint = pressed;
    }
    if (control === 'jump') {
      touchState.ascend = pressed;
    }
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

document.querySelectorAll<HTMLButtonElement>('[data-action="use"]').forEach((button) => {
  button.addEventListener('click', () => sendMessage({ type: 'solarUse' }));
});

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(host);
resize();
createStars();
SOLAR_BODIES.forEach(createBodyRuntime);

const animate = (time: number): void => {
  const serverTime = serverClock.synced ? time + serverClock.offsetMs : Date.now();
  const renderSnapshot = getRenderableSnapshot(time);

  updateBodies(serverTime);
  updateAvatars(renderSnapshot);
  updateShip(renderSnapshot);
  updateCamera(renderSnapshot, serverTime);
  updateUsePrompt(renderSnapshot);

  if (time - lastInputFlush >= INPUT_FLUSH_MS) {
    sendInput();
    lastInputFlush = time;
  }

  if (socket?.readyState === WebSocket.OPEN && time - lastPingAt >= PING_INTERVAL_MS) {
    sendMessage({ type: 'ping', clientTime: time });
    lastPingAt = time;
  }

  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
};

setConnectionState('offline', 'Offline');
connect();
window.requestAnimationFrame(animate);
