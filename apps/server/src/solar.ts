import { randomUUID } from 'node:crypto';

import {
  DEFAULT_SOLAR_INPUT,
  PLAYER_COLORS_SOLAR,
  SOLAR_BODIES,
  SOLAR_BODY_BY_ID,
  SOLAR_CONFIG,
  addVec,
  clampNumber,
  crossVec,
  distanceVec,
  dotVec,
  getBodyTransform,
  getBodyTransforms,
  getLaunchSite,
  getNearestBody,
  getShipSpawnTransform,
  lengthSqVec,
  lengthVec,
  lerpVec,
  normalizeVec,
  projectOnPlane,
  rotateVectorAroundAxis,
  scaleVec,
  subVec,
  vec3,
} from '../../../packages/shared/src/solar.ts';
import type {
  SolarBodyId,
  SolarClientToServerMessage,
  SolarInputMessage,
  SolarInputState,
  SolarPlayerSnapshot,
  SolarServerToClientMessage,
  SolarShipSnapshot,
  SolarSnapshot,
  SolarWorldEvent,
  Vec3,
} from '../../../packages/shared/src/solar.ts';

const FRAME_MAX_BYTES = 32 * 1024;
const TICK_INTERVAL_MS = 1000 / SOLAR_CONFIG.tickRate;
const SNAPSHOT_INTERVAL_TICKS = Math.max(1, Math.round(SOLAR_CONFIG.tickRate / SOLAR_CONFIG.snapshotRate));
const NAME_MAX_LENGTH = 12;

type SolarClient = {
  socket: import('node:net').Socket;
  buffer: Buffer;
  closed: boolean;
  id: string;
  joined: boolean;
  name: string;
  input: SolarInputState;
  previousInput: SolarInputState;
  cameraForward: Vec3;
  cameraRight: Vec3;
  lastInputSeq: number;
  lastMessageAt: number;
};

type SolarPlayerState = SolarPlayerSnapshot & {
  surfaceNormal: Vec3;
  heightAboveSurface: number;
  verticalVelocity: number;
};

const cloneInput = (input: SolarInputState): SolarInputState => ({
  forward: Boolean(input.forward),
  backward: Boolean(input.backward),
  left: Boolean(input.left),
  right: Boolean(input.right),
  jump: Boolean(input.jump),
  sprint: Boolean(input.sprint),
  boost: Boolean(input.boost),
  ascend: Boolean(input.ascend),
  descend: Boolean(input.descend),
  yawLeft: Boolean(input.yawLeft),
  yawRight: Boolean(input.yawRight),
  pitchUp: Boolean(input.pitchUp),
  pitchDown: Boolean(input.pitchDown),
  rollLeft: Boolean(input.rollLeft),
  rollRight: Boolean(input.rollRight),
});

const isFiniteVec = (value: unknown): value is Vec3 => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z);
};

const sanitizeName = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .trim()
    .replace(/[^\w -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX_LENGTH);
  return cleaned || fallback;
};

const isSolarInputState = (value: unknown): value is SolarInputState => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return Object.keys(DEFAULT_SOLAR_INPUT).every((key) => typeof input[key] === 'boolean' || input[key] === undefined);
};

const sendFrame = (socket: import('node:net').Socket, payload: SolarServerToClientMessage | string): void => {
  if (socket.destroyed) return;

  const data = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let header: Buffer;

  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  socket.write(Buffer.concat([header, data]));
};

const sendClose = (socket: import('node:net').Socket): void => {
  if (!socket.destroyed) {
    socket.end(Buffer.from([0x88, 0x00]));
  }
};

const sendPongFrame = (socket: import('node:net').Socket, payload: Buffer): void => {
  if (payload.length > 125 || socket.destroyed) return;
  socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
};

const parseFrames = (client: SolarClient, chunk: Buffer): string[] => {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages: string[] = [];

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) break;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) break;
      const bigLength = client.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(FRAME_MAX_BYTES)) {
        throw new Error('Frame too large.');
      }
      length = Number(bigLength);
      offset += 8;
    }

    if (length > FRAME_MAX_BYTES) {
      throw new Error('Frame too large.');
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) break;

    let payload = client.buffer.subarray(offset, offset + length);
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.closed = true;
      sendClose(client.socket);
      break;
    }

    if (opcode === 0x9) {
      sendPongFrame(client.socket, payload);
      continue;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
  }

  return messages;
};

const toSnapshotPlayer = (player: SolarPlayerState): SolarPlayerSnapshot => ({
  id: player.id,
  name: player.name,
  color: player.color,
  mode: player.mode,
  bodyId: player.bodyId,
  position: { ...player.position },
  velocity: { ...player.velocity },
  up: { ...player.up },
  forward: { ...player.forward },
  grounded: player.grounded,
  connected: player.connected,
  lastInputSeq: player.lastInputSeq,
});

const sanitizeDirection = (value: Vec3, fallback: Vec3): Vec3 => normalizeVec(value, fallback);

const makeSpawnNormal = (slotIndex: number, now: number): Vec3 => {
  const launch = getLaunchSite(now);
  const row = Math.floor(slotIndex / 5);
  const column = slotIndex % 5;
  const eastOffset = (column - 2) * 1.15;
  const northOffset = row * 1.1;
  return normalizeVec(
    addVec(addVec(scaleVec(launch.up, launch.body.radius), scaleVec(launch.east, eastOffset)), scaleVec(launch.north, northOffset)),
    // Fallback to exact base spawn for the first player.
    getLaunchSite(now).up,
  );
};

const createPlayer = (client: SolarClient, slotIndex: number, now: number): SolarPlayerState => {
  const launch = getLaunchSite(now);
  const body = SOLAR_BODY_BY_ID[launch.body.id];
  const surfaceNormal = makeSpawnNormal(slotIndex, now);
  const position = addVec(launch.transform.position, scaleVec(surfaceNormal, body.radius + SOLAR_CONFIG.player.height / 2));
  const forward = normalizeVec(projectOnPlane(launch.forward, surfaceNormal), launch.east);

  return {
    id: client.id,
    name: client.name,
    color: PLAYER_COLORS_SOLAR[slotIndex % PLAYER_COLORS_SOLAR.length],
    mode: 'surface',
    bodyId: launch.body.id,
    position,
    velocity: vec3(),
    up: surfaceNormal,
    forward,
    grounded: true,
    connected: true,
    lastInputSeq: 0,
    surfaceNormal,
    heightAboveSurface: 0,
    verticalVelocity: 0,
  };
};

const projectPlayerToSurface = (player: SolarPlayerState, bodyId: SolarBodyId, normal: Vec3, now: number): void => {
  const body = SOLAR_BODY_BY_ID[bodyId];
  const transform = getBodyTransform(bodyId, now);
  const up = normalizeVec(normal);
  player.mode = 'surface';
  player.bodyId = bodyId;
  player.surfaceNormal = up;
  player.heightAboveSurface = 0;
  player.verticalVelocity = 0;
  player.up = up;
  player.forward = normalizeVec(projectOnPlane(player.forward, up), getLaunchSite(now).forward);
  player.position = addVec(transform.position, scaleVec(up, body.radius + SOLAR_CONFIG.player.height / 2));
  player.velocity = vec3();
  player.grounded = true;
};

const orthonormalizeShip = (ship: SolarShipSnapshot): void => {
  ship.forward = normalizeVec(ship.forward, vec3(1, 0, 0));
  ship.right = normalizeVec(crossVec(ship.forward, ship.up), vec3(0, 0, 1));
  ship.up = normalizeVec(crossVec(ship.right, ship.forward), vec3(0, 1, 0));
};

export const createSolarWorld = () => {
  const connections = new Set<SolarClient>();
  const players = new Map<string, SolarPlayerState>();
  let ship = getShipSpawnTransform(Date.now());
  let shipAnchored = true;
  let lastPilotedAt = Date.now();
  let tick = 0;
  let lastSnapshotTick = 0;
  const events: SolarWorldEvent[] = [];

  const makeSnapshot = (consumeEvents = false): SolarSnapshot => ({
    type: 'solarSnapshot',
    tick,
    serverTime: Date.now(),
    players: [...players.values()].map(toSnapshotPlayer),
    ship: {
      id: ship.id,
      position: { ...ship.position },
      velocity: { ...ship.velocity },
      forward: { ...ship.forward },
      up: { ...ship.up },
      right: { ...ship.right },
      pilotId: ship.pilotId,
      respawnsAt: ship.respawnsAt,
    },
    events: consumeEvents ? events.splice(0) : [],
  });

  const broadcast = (message: SolarServerToClientMessage): void => {
    const text = JSON.stringify(message);
    connections.forEach((client) => {
      if (client.joined) sendFrame(client.socket, text);
    });
  };

  const broadcastPresence = (): void => {
    broadcast({
      type: 'solarPresence',
      players: [...players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        mode: player.mode,
      })),
    });
  };

  const resetShip = (now: number): void => {
    ship = getShipSpawnTransform(now);
    shipAnchored = true;
    lastPilotedAt = now;
    events.push({ type: 'shipRespawned' });
  };

  const leaveShip = (client: SolarClient, now: number): void => {
    if (ship.pilotId !== client.id) return;
    const player = players.get(client.id);
    if (!player) return;

    ship.pilotId = null;
    lastPilotedAt = now;
    const nearest = getNearestBody(ship.position, now);
    const normal = normalizeVec(subVec(ship.position, nearest.transform.position), vec3(0, 1, 0));
    projectPlayerToSurface(player, nearest.body.id, normal, now);
    player.forward = normalizeVec(projectOnPlane(ship.forward, player.up), player.forward);
    events.push({ type: 'shipLeft', playerId: client.id });
    broadcastPresence();
  };

  const handleJoin = (client: SolarClient, name: unknown): void => {
    if (players.size >= SOLAR_CONFIG.maxPlayers && !players.has(client.id)) {
      sendFrame(client.socket, { type: 'error', message: 'The solar system is full.' });
      return;
    }

    const now = Date.now();
    client.joined = true;
    client.name = sanitizeName(name, `Explorer ${players.size + 1}`);

    if (!players.has(client.id)) {
      players.set(client.id, createPlayer(client, players.size, now));
    }

    sendFrame(client.socket, {
      type: 'solarJoined',
      protocolVersion: SOLAR_CONFIG.protocolVersion,
      you: client.id,
      snapshot: makeSnapshot(),
    });
    broadcastPresence();
  };

  const handleInput = (client: SolarClient, message: SolarInputMessage): void => {
    if (!client.joined || !players.has(client.id)) return;

    if (!isSolarInputState(message.input)) {
      sendFrame(client.socket, { type: 'error', message: 'Invalid solar input payload.' });
      return;
    }

    client.input = cloneInput({ ...DEFAULT_SOLAR_INPUT, ...message.input });
    if (isFiniteVec(message.cameraForward)) {
      client.cameraForward = sanitizeDirection(message.cameraForward, client.cameraForward);
    }
    if (isFiniteVec(message.cameraRight)) {
      client.cameraRight = sanitizeDirection(message.cameraRight, client.cameraRight);
    }
    client.lastInputSeq = Number.isFinite(message.seq) ? Math.max(0, Math.floor(message.seq)) : client.lastInputSeq;
    client.lastMessageAt = Date.now();
    const player = players.get(client.id);
    if (player) player.lastInputSeq = client.lastInputSeq;
  };

  const handleUse = (client: SolarClient): void => {
    const player = players.get(client.id);
    if (!player) return;

    const now = Date.now();
    if (ship.pilotId === client.id) {
      leaveShip(client, now);
      return;
    }

    if (ship.pilotId !== null || player.mode !== 'surface') return;
    if (distanceVec(player.position, ship.position) > SOLAR_CONFIG.ship.boardRadius) return;

    ship.pilotId = client.id;
    shipAnchored = false;
    ship.respawnsAt = null;
    player.mode = 'ship';
    player.grounded = false;
    player.velocity = { ...ship.velocity };
    events.push({ type: 'shipBoarded', playerId: client.id });
    broadcastPresence();
  };

  const handleMessage = (client: SolarClient, raw: string): void => {
    let message: SolarClientToServerMessage;

    try {
      message = JSON.parse(raw) as SolarClientToServerMessage;
    } catch {
      sendFrame(client.socket, { type: 'error', message: 'Invalid JSON message.' });
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      sendFrame(client.socket, { type: 'error', message: 'Invalid solar message.' });
      return;
    }

    if (message.type === 'solarJoin') {
      handleJoin(client, message.name);
    } else if (message.type === 'solarInput') {
      handleInput(client, message);
    } else if (message.type === 'solarUse') {
      handleUse(client);
    } else if (message.type === 'solarLeaveShip') {
      leaveShip(client, Date.now());
    } else if (message.type === 'ping') {
      const clientTime = Number.isFinite(message.clientTime) ? message.clientTime : 0;
      sendFrame(client.socket, { type: 'pong', clientTime, serverTime: Date.now() });
    } else {
      sendFrame(client.socket, { type: 'error', message: `Unsupported solar message: ${(message as { type: string }).type}` });
    }
  };

  const removeClient = (client: SolarClient): void => {
    connections.delete(client);
    if (ship.pilotId === client.id) {
      ship.pilotId = null;
      lastPilotedAt = Date.now();
    }
    players.delete(client.id);
    broadcastPresence();
  };

  const updateSurfacePlayer = (player: SolarPlayerState, client: SolarClient, dt: number, now: number): void => {
    const body = SOLAR_BODY_BY_ID[player.bodyId];
    const transform = getBodyTransform(player.bodyId, now);
    const radius = body.radius + SOLAR_CONFIG.player.height / 2 + player.heightAboveSurface;
    const currentUp = normalizeVec(subVec(player.position, transform.position), player.surfaceNormal);
    player.up = currentUp;
    player.surfaceNormal = currentUp;

    let cameraForward = normalizeVec(projectOnPlane(client.cameraForward, currentUp), player.forward);
    let cameraRight = normalizeVec(projectOnPlane(client.cameraRight, currentUp), crossVec(cameraForward, currentUp));
    if (lengthSqVec(cameraForward) < 0.01 || lengthSqVec(cameraRight) < 0.01) {
      const basis = getLaunchSite(now);
      cameraForward = normalizeVec(projectOnPlane(basis.forward, currentUp), player.forward);
      cameraRight = normalizeVec(crossVec(cameraForward, currentUp));
    }

    let move = vec3();
    if (client.input.forward) move = addVec(move, cameraForward);
    if (client.input.backward) move = subVec(move, cameraForward);
    if (client.input.right) move = addVec(move, cameraRight);
    if (client.input.left) move = subVec(move, cameraRight);
    const wantsMove = lengthSqVec(move) > 0.0001;
    const desiredSpeed = client.input.sprint ? SOLAR_CONFIG.player.sprintSpeed : SOLAR_CONFIG.player.walkSpeed;
    const desiredTangent = wantsMove ? scaleVec(normalizeVec(move), desiredSpeed) : vec3();
    const currentTangent = projectOnPlane(player.velocity, currentUp);
    const control = player.grounded ? 1 : SOLAR_CONFIG.player.airControl;
    const nextTangent = lerpVec(currentTangent, desiredTangent, clampNumber(dt * 9 * control, 0, 1));

    const jumpJustPressed = client.input.jump && !client.previousInput.jump;
    if (jumpJustPressed && player.grounded) {
      player.verticalVelocity = SOLAR_CONFIG.player.jumpVelocity;
      player.grounded = false;
    }

    player.verticalVelocity -= SOLAR_CONFIG.player.surfaceGravity * dt;
    player.heightAboveSurface += player.verticalVelocity * dt;
    if (player.heightAboveSurface <= 0 && player.verticalVelocity <= 0) {
      player.heightAboveSurface = 0;
      player.verticalVelocity = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    const basePosition = addVec(transform.position, scaleVec(currentUp, radius));
    const movedPosition = addVec(basePosition, scaleVec(nextTangent, dt));
    const nextUp = normalizeVec(subVec(movedPosition, transform.position), currentUp);
    player.surfaceNormal = nextUp;
    player.up = nextUp;
    player.position = addVec(
      transform.position,
      scaleVec(nextUp, body.radius + SOLAR_CONFIG.player.height / 2 + player.heightAboveSurface),
    );
    player.velocity = addVec(projectOnPlane(nextTangent, nextUp), scaleVec(nextUp, player.verticalVelocity));
    if (wantsMove) {
      player.forward = normalizeVec(projectOnPlane(desiredTangent, nextUp), player.forward);
    }
    client.previousInput = cloneInput(client.input);
  };

  const updateShip = (dt: number, now: number): void => {
    if (shipAnchored) {
      const anchored = getShipSpawnTransform(now);
      ship = { ...anchored, pilotId: null };
      return;
    }

    const pilotClient = ship.pilotId ? [...connections].find((client) => client.id === ship.pilotId) : null;
    if (ship.pilotId && !pilotClient) {
      ship.pilotId = null;
      lastPilotedAt = now;
    }

    if (pilotClient) {
      const input = pilotClient.input;
      const yaw = (Number(input.yawRight || input.right) - Number(input.yawLeft || input.left)) * SOLAR_CONFIG.ship.turnRate * dt;
      const pitch = (Number(input.pitchDown || input.descend) - Number(input.pitchUp || input.ascend)) * SOLAR_CONFIG.ship.turnRate * dt;
      const roll = (Number(input.rollRight) - Number(input.rollLeft)) * SOLAR_CONFIG.ship.rollRate * dt;

      if (yaw) {
        ship.forward = rotateVectorAroundAxis(ship.forward, ship.up, -yaw);
        ship.right = rotateVectorAroundAxis(ship.right, ship.up, -yaw);
      }
      if (pitch) {
        ship.forward = rotateVectorAroundAxis(ship.forward, ship.right, pitch);
        ship.up = rotateVectorAroundAxis(ship.up, ship.right, pitch);
      }
      if (roll) {
        ship.up = rotateVectorAroundAxis(ship.up, ship.forward, -roll);
        ship.right = rotateVectorAroundAxis(ship.right, ship.forward, -roll);
      }
      orthonormalizeShip(ship);

      let thrust = vec3();
      if (input.forward) thrust = addVec(thrust, ship.forward);
      if (input.backward) thrust = subVec(thrust, ship.forward);
      if (input.right) thrust = addVec(thrust, ship.right);
      if (input.left) thrust = subVec(thrust, ship.right);
      if (input.ascend) thrust = addVec(thrust, ship.up);
      if (input.descend) thrust = subVec(thrust, ship.up);

      if (lengthSqVec(thrust) > 0.0001) {
        const multiplier = input.boost ? SOLAR_CONFIG.ship.boostMultiplier : 1;
        ship.velocity = addVec(ship.velocity, scaleVec(normalizeVec(thrust), SOLAR_CONFIG.ship.acceleration * multiplier * dt));
      }
      lastPilotedAt = now;
      ship.respawnsAt = null;
    }

    const transforms = getBodyTransforms(now);
    for (const body of SOLAR_BODIES) {
      const offset = subVec(transforms[body.id].position, ship.position);
      const distance = Math.max(lengthVec(offset), body.radius + 0.1);
      const gravity = Math.min(body.gravity, body.gravity * (body.radius * body.radius) / (distance * distance));
      ship.velocity = addVec(ship.velocity, scaleVec(normalizeVec(offset), gravity * dt));
    }

    ship.velocity = scaleVec(ship.velocity, Math.exp(-SOLAR_CONFIG.ship.damping * dt));
    ship.position = addVec(ship.position, scaleVec(ship.velocity, dt));

    for (const body of SOLAR_BODIES) {
      const center = transforms[body.id].position;
      const toShip = subVec(ship.position, center);
      const distance = lengthVec(toShip);
      const minDistance = body.radius + SOLAR_CONFIG.ship.radius;
      if (distance < minDistance) {
        const normal = normalizeVec(toShip, vec3(0, 1, 0));
        ship.position = addVec(center, scaleVec(normal, minDistance));
        const inwardVelocity = dotVec(ship.velocity, normal);
        if (inwardVelocity < 0) {
          ship.velocity = subVec(ship.velocity, scaleVec(normal, inwardVelocity * (1 + SOLAR_CONFIG.ship.collisionBounce)));
        }
      }
    }

    if (!ship.pilotId) {
      const launch = getLaunchSite(now);
      const lost = distanceVec(ship.position, launch.position) > SOLAR_CONFIG.ship.lostDistanceFromLaunch;
      if (lost) {
        ship.respawnsAt = lastPilotedAt + SOLAR_CONFIG.ship.idleRespawnMs;
        if (now >= ship.respawnsAt) {
          resetShip(now);
        }
      } else {
        ship.respawnsAt = null;
      }
    }
  };

  const updateShipPlayers = (): void => {
    if (!ship.pilotId) return;
    const pilot = players.get(ship.pilotId);
    if (!pilot) return;
    pilot.mode = 'ship';
    pilot.position = addVec(addVec(ship.position, scaleVec(ship.up, 0.8)), scaleVec(ship.right, -0.55));
    pilot.velocity = { ...ship.velocity };
    pilot.up = { ...ship.up };
    pilot.forward = { ...ship.forward };
    pilot.grounded = false;
  };

  const tickWorld = (): void => {
    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;

    for (const player of players.values()) {
      if (player.mode !== 'surface') continue;
      const client = [...connections].find((candidate) => candidate.id === player.id);
      if (client) updateSurfacePlayer(player, client, dt, now);
    }

    updateShip(dt, now);
    updateShipPlayers();
    tick += 1;

    if (tick - lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
      lastSnapshotTick = tick;
      broadcast(makeSnapshot(true));
    }
  };

  const loop = setInterval(tickWorld, TICK_INTERVAL_MS);

  return {
    accept(socket: import('node:net').Socket): void {
      const client: SolarClient = {
        socket,
        buffer: Buffer.alloc(0),
        closed: false,
        id: randomUUID(),
        joined: false,
        name: 'Explorer',
        input: { ...DEFAULT_SOLAR_INPUT },
        previousInput: { ...DEFAULT_SOLAR_INPUT },
        cameraForward: vec3(1, 0, 0),
        cameraRight: vec3(0, 0, 1),
        lastInputSeq: 0,
        lastMessageAt: Date.now(),
      };

      connections.add(client);

      socket.on('data', (chunk) => {
        try {
          parseFrames(client, chunk).forEach((message) => handleMessage(client, message));
        } catch (error) {
          sendFrame(socket, { type: 'error', message: error instanceof Error ? error.message : 'Solar socket parse error.' });
          socket.destroy();
        }
      });

      socket.on('close', () => removeClient(client));
      socket.on('error', () => removeClient(client));
    },
    health() {
      return {
        ok: true,
        mode: 'solar',
        players: players.size,
        shipPiloted: ship.pilotId !== null,
        tick,
      };
    },
    close(): void {
      clearInterval(loop);
      connections.forEach((client) => {
        sendClose(client.socket);
        client.socket.destroy();
      });
      connections.clear();
      players.clear();
    },
  };
};
