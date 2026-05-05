import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Download,
  Gauge,
  Mountain,
  Pause,
  Play,
  Radio,
  RadioTower,
  Redo2,
  RotateCcw,
  Route,
  Save,
  Upload,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  AppendPieceOp,
  ParkDocument,
  ParkOp,
  PieceTemplateId,
  PresenceState,
  TrackSample,
  StartRunOp,
  TrackSegment,
} from '../../lib/coaster/types';
import {
  applyParkOp,
  buildPreviewSegment,
  createInitialPark,
  createSegmentFromTemplate,
  getCoasterSamples,
  getDefaultVariant,
  getOpenEndTransform,
  getPieceTemplate,
  getTrackPointAtS,
  makeId,
  summarizeCoaster,
  BUILD_GRID_SIZE,
  TILE_SIZE,
} from '../../lib/coaster/track';
import {
  createRunState,
  DEFAULT_PHYSICS,
  simulateStep,
  type TrainRunState,
} from '../../lib/coaster/physics';

type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'error';

interface RuntimeScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cameraTarget: THREE.Vector3;
  cameraSpherical: THREE.Spherical;
  zoomDistance: number;
  trackGroup: THREE.Group;
  ghostGroup: THREE.Group;
  trainGroup: THREE.Group;
  remoteGroup: THREE.Group;
  keyState: Set<string>;
  resizeObserver: ResizeObserver;
  animationFrame: number;
  updateCamera: () => void;
  cleanup: () => void;
}

interface ServerMessage {
  type:
    | 'joined'
    | 'parkOpApplied'
    | 'opRejected'
    | 'presence'
    | 'roomClosed'
    | 'error';
  roomCode?: string;
  clientId?: string;
  document?: ParkDocument;
  version?: number;
  users?: PresenceState[];
  op?: ParkOp;
  reason?: string;
  clientOpId?: string;
}

const PIECE_ICONS: Record<PieceTemplateId, React.ComponentType<{ className?: string }>> = {
  station: Save,
  straight: Route,
  slope: ArrowUp,
  'flat-turn': Redo2,
  'banked-turn': RotateCcw,
  lift: Mountain,
  drop: ArrowDown,
  brake: Gauge,
  loop: Radio,
};

interface PieceAction {
  id: string;
  label: string;
  templateId: PieceTemplateId;
  variantIndex: number;
}

const PIECE_GROUPS: Array<{ label: string; actions: PieceAction[] }> = [
  {
    label: 'Track',
    actions: [
      { id: 'straight', label: 'Straight', templateId: 'straight', variantIndex: 0 },
      { id: 'brake', label: 'Brake', templateId: 'brake', variantIndex: 0 },
    ],
  },
  {
    label: 'Hills',
    actions: [
      { id: 'slope-up', label: 'Slope Up', templateId: 'slope', variantIndex: 0 },
      { id: 'slope-down', label: 'Slope Down', templateId: 'slope', variantIndex: 1 },
      { id: 'lift', label: 'Lift', templateId: 'lift', variantIndex: 0 },
      { id: 'drop', label: 'Drop', templateId: 'drop', variantIndex: 0 },
    ],
  },
  {
    label: 'Turns',
    actions: [
      { id: 'turn-right', label: 'Turn Right', templateId: 'flat-turn', variantIndex: 0 },
      { id: 'turn-left', label: 'Turn Left', templateId: 'flat-turn', variantIndex: 1 },
      { id: 'bank-right', label: 'Bank Right', templateId: 'banked-turn', variantIndex: 0 },
      { id: 'bank-left', label: 'Bank Left', templateId: 'banked-turn', variantIndex: 1 },
    ],
  },
  {
    label: 'Inversions',
    actions: [{ id: 'loop', label: 'Loop', templateId: 'loop', variantIndex: 0 }],
  },
];

const USER_COLORS = ['#2563eb', '#0f766e', '#dc2626', '#7c3aed', '#b45309', '#0891b2'];
const CAMERA_DIRECTION = new THREE.Vector3(0.72, 0.58, 0.72).normalize();
const INITIAL_CAMERA_TARGET = new THREE.Vector3(TILE_SIZE * 1.5, 5, TILE_SIZE * 2);
const INITIAL_ZOOM_DISTANCE = 72;

const formatNumber = (value: number, digits = 1) => {
  const rounded = value.toFixed(digits);
  return rounded === '-0.0' || rounded === '-0.00' ? rounded.slice(1) : rounded;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const createRoomCode = () =>
  Math.random()
    .toString(36)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)
    .padEnd(5, 'X');

const createClientId = () => makeId('client');

const getWsUrl = (roomCode: string) => {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.PUBLIC_COASTER_WS_URL;
  if (configured) {
    const url = new URL(configured);
    url.searchParams.set('room', roomCode);
    return url.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8787?room=${encodeURIComponent(roomCode)}`;
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
};

const clearGroup = (group: THREE.Group) => {
  [...group.children].forEach((child) => {
    group.remove(child);
    disposeObject(child);
  });
};

const toThree = (point: { x: number; y: number; z: number }) => new THREE.Vector3(point.x, point.y, point.z);

const getSampleFrame = (sample: TrackSample) => {
  const tangent = toThree(sample.tangent).normalize();
  const normal = toThree(sample.normal).normalize();
  const binormal = toThree(sample.binormal).normalize();
  const carUp = normal.multiplyScalar(Math.cos(sample.roll)).add(binormal.multiplyScalar(Math.sin(sample.roll))).normalize();
  const carRight = new THREE.Vector3().crossVectors(carUp, tangent).normalize();

  return { tangent, carUp, carRight };
};

const makeTubeFromPoints = (points: THREE.Vector3[], color: string, radius: number, opacity = 1) => {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.04);
  const geometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), radius, 8, false);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.48,
    transparent: opacity < 1,
    opacity,
  });
  const tube = new THREE.Mesh(geometry, material);
  tube.castShadow = true;
  tube.receiveShadow = true;
  return tube;
};

const makeOffsetTrackPoints = (segment: TrackSegment, lateralOffset: number, verticalOffset: number) =>
  segment.samples.map((sample) => {
    const { carUp, carRight } = getSampleFrame(sample);
    return toThree(sample.position)
      .addScaledVector(carRight, lateralOffset)
      .addScaledVector(carUp, verticalOffset);
  });

const orientObjectToTrack = (object: THREE.Object3D, sample: TrackSample) => {
  const { tangent, carUp, carRight } = getSampleFrame(sample);
  const basis = new THREE.Matrix4().makeBasis(carRight, carUp, tangent);
  object.quaternion.setFromRotationMatrix(basis);
};

const makeTrackHardware = (segment: TrackSegment, color: string, opacity = 1) => {
  const group = new THREE.Group();
  const railColor = segment.flags.brake ? '#991b1b' : segment.flags.lift ? '#1d4ed8' : color;
  const railGauge = 1.18;
  const railVerticalOffset = 0.1;

  group.add(makeTubeFromPoints(makeOffsetTrackPoints(segment, -railGauge / 2, railVerticalOffset), railColor, 0.065, opacity));
  group.add(makeTubeFromPoints(makeOffsetTrackPoints(segment, railGauge / 2, railVerticalOffset), railColor, 0.065, opacity));
  group.add(makeTubeFromPoints(makeOffsetTrackPoints(segment, 0, -0.08), '#475569', 0.035, Math.min(opacity, 0.72)));

  const tieMaterial = new THREE.MeshStandardMaterial({
    color: segment.flags.station ? '#334155' : '#7c4a24',
    roughness: 0.82,
    metalness: 0.03,
    transparent: opacity < 1,
    opacity,
  });
  const tieGeometry = new THREE.BoxGeometry(railGauge + 0.72, 0.12, 0.34);
  const tieStride = Math.max(2, Math.floor(segment.samples.length / Math.max(4, segment.length / 1.8)));

  segment.samples.forEach((sample, index) => {
    if (index % tieStride !== 0 && index !== segment.samples.length - 1) {
      return;
    }

    const tie = new THREE.Mesh(tieGeometry, tieMaterial);
    tie.position.copy(toThree(sample.position).addScaledVector(getSampleFrame(sample).carUp, -0.02));
    orientObjectToTrack(tie, sample);
    tie.castShadow = true;
    tie.receiveShadow = true;
    group.add(tie);
  });

  return group;
};

const makeGhostTrack = (segment: TrackSegment, color: string, opacity = 0.42) => {
  const group = makeTrackHardware(segment, color, opacity);
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.material && !Array.isArray(mesh.material)) {
      mesh.material.depthWrite = false;
    }
  });
  return group;
};

const makeSupport = (top: THREE.Vector3, groundY: number) => {
  const height = Math.max(0.1, top.y - groundY);
  const geometry = new THREE.CylinderGeometry(0.05, 0.08, height, 8);
  const material = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.7 });
  const support = new THREE.Mesh(geometry, material);
  support.position.set(top.x, groundY + height / 2, top.z);
  support.castShadow = true;
  return support;
};

const getSegmentColor = (segment: TrackSegment) => {
  if (segment.flags.station) return '#475569';
  if (segment.flags.lift) return '#2563eb';
  if (segment.flags.brake) return '#dc2626';
  if (segment.flags.loop) return '#7c3aed';
  if (segment.templateId === 'banked-turn') return '#0f766e';
  return '#334155';
};

const rebuildTrackScene = (
  runtime: RuntimeScene,
  park: ParkDocument,
  preview: { segment: TrackSegment; valid: boolean } | null,
  runState: TrainRunState | null,
  users: PresenceState[],
  localClientId: string,
) => {
  clearGroup(runtime.trackGroup);
  clearGroup(runtime.ghostGroup);
  clearGroup(runtime.remoteGroup);

  const coaster = park.coasters[0];
  const samples = getCoasterSamples(coaster);

  coaster.segments.forEach((segment) => {
    runtime.trackGroup.add(makeTrackHardware(segment, getSegmentColor(segment)));

    segment.samples.forEach((sample, index) => {
      if (index % 8 !== 0 || sample.position.y < park.terrain.groundY + 1.4) {
        return;
      }
      runtime.trackGroup.add(makeSupport(toThree(sample.position), park.terrain.groundY));
    });
  });

  if (preview) {
    runtime.ghostGroup.add(makeGhostTrack(preview.segment, preview.valid ? '#22c55e' : '#ef4444', 0.42));
  }

  const end = getOpenEndTransform(coaster);
  const markerGeometry = new THREE.SphereGeometry(0.45, 18, 18);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#7c2d12', emissiveIntensity: 0.18 });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.position.copy(toThree(end.position));
  marker.castShadow = true;
  runtime.trackGroup.add(marker);

  clearGroup(runtime.trainGroup);
  const trainSample = runState && samples.length > 0 ? getTrackPointAtS(samples, runState.s) : samples[0];
  const train = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.35, metalness: 0.15 });
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.3 });
  for (let index = 0; index < coaster.train.carCount; index += 1) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 1.05), bodyMaterial);
    car.position.z = -index * 0.72;
    car.position.y = 0.26;
    car.castShadow = true;
    train.add(car);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.52), cabinMaterial);
    cabin.position.set(0, 0.62, -index * 0.72);
    cabin.castShadow = true;
    train.add(cabin);
  }
  train.position.copy(toThree(trainSample.position).addScaledVector(getSampleFrame(trainSample).carUp, 0.44));
  orientObjectToTrack(train, trainSample);
  runtime.trainGroup.add(train);

  users
    .filter((user) => user.clientId !== localClientId && user.focus)
    .forEach((user) => {
      const avatar = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: user.color, roughness: 0.4 });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), material);
      sphere.position.y = 0.34;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.025, 6, 24), material);
      ring.rotation.x = Math.PI / 2;
      avatar.add(sphere, ring);
      avatar.position.copy(toThree(user.focus!));
      avatar.position.y += 0.85;
      runtime.remoteGroup.add(avatar);
    });
};

export default function CoasterParkBuilder() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<RuntimeScene | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef(createClientId());
  const placeRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const [park, setPark] = useState<ParkDocument>(() => createInitialPark());
  const [selectedPiece, setSelectedPiece] = useState<PieceTemplateId>('straight');
  const [variantIndex, setVariantIndex] = useState(0);
  const [status, setStatus] = useState('Ready to build.');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('offline');
  const [roomCode, setRoomCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [users, setUsers] = useState<PresenceState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runState, setRunState] = useState<TrainRunState | null>(null);
  const runStateRef = useRef<TrainRunState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoomCode((params.get('room') || createRoomCode()).toUpperCase());
    setClientName(`Builder ${clientIdRef.current.slice(-3).toUpperCase()}`);
  }, []);

  const coaster = park.coasters[0];
  const selectedTemplate = getPieceTemplate(selectedPiece);
  const selectedVariant = selectedTemplate.variants[variantIndex % selectedTemplate.variants.length] ?? getDefaultVariant(selectedPiece);
  const summary = useMemo(() => summarizeCoaster(coaster), [coaster]);

  const preview = useMemo(
    () => buildPreviewSegment(park, coaster.id, selectedPiece, selectedVariant),
    [park, coaster.id, selectedPiece, selectedVariant],
  );

  useEffect(() => {
    setVariantIndex(0);
  }, [selectedPiece]);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  const localPresence = useCallback((): PresenceState => {
    const end = getOpenEndTransform(coaster);
    const colorIndex = Math.abs(clientIdRef.current.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % USER_COLORS.length;
    return {
      clientId: clientIdRef.current,
      name: clientName || 'Builder',
      color: USER_COLORS[colorIndex],
      roomCode,
      selectedPiece,
      focus: end.position,
    };
  }, [clientName, coaster, roomCode, selectedPiece]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const makeBaseOp = useCallback(
    (type: ParkOp['type']) => ({
      type,
      clientId: clientIdRef.current,
      clientOpId: makeId('op'),
      baseVersion: park.version,
      createdAt: Date.now(),
    }),
    [park.version],
  );

  const applyOrSendOp = useCallback(
    (op: ParkOp) => {
      if (connectionStatus === 'connected' && sendMessage({ type: 'parkOp', op })) {
        setStatus('Sent to room.');
        return;
      }

      setPark((current) => applyParkOp(current, op));
      setStatus('Applied locally.');
    },
    [connectionStatus, sendMessage],
  );

  const placePiece = useCallback(
    (templateId: PieceTemplateId, nextVariantIndex: number) => {
      const template = getPieceTemplate(templateId);
      const variant = template.variants[nextVariantIndex] ?? getDefaultVariant(templateId);
      const latestPreview = buildPreviewSegment(park, coaster.id, templateId, variant);

      setSelectedPiece(templateId);
      setVariantIndex(nextVariantIndex);

      if (!latestPreview.valid) {
        setStatus(latestPreview.reason);
        return;
      }

      const finalSegment = createSegmentFromTemplate(
        templateId,
        latestPreview.segment.connector,
        variant,
        makeId('seg'),
      );
      const op: AppendPieceOp = {
        ...makeBaseOp('appendPiece'),
        type: 'appendPiece',
        coasterId: coaster.id,
        segment: finalSegment,
      };
      setIsRunning(false);
      setRunState(null);
      applyOrSendOp(op);
    },
    [applyOrSendOp, coaster.id, makeBaseOp, park],
  );

  const placeSelectedPiece = useCallback(() => {
    const latestPreview = buildPreviewSegment(park, coaster.id, selectedPiece, selectedVariant);
    if (!latestPreview.valid) {
      setStatus(latestPreview.reason);
      return;
    }

    const finalSegment = createSegmentFromTemplate(
      selectedPiece,
      latestPreview.segment.connector,
      selectedVariant,
      makeId('seg'),
    );
    const op: AppendPieceOp = {
      ...makeBaseOp('appendPiece'),
      type: 'appendPiece',
      coasterId: coaster.id,
      segment: finalSegment,
    };
    setIsRunning(false);
    setRunState(null);
    applyOrSendOp(op);
  }, [applyOrSendOp, coaster.id, makeBaseOp, park, selectedPiece, selectedVariant]);

  const undoLastPiece = useCallback(() => {
    if (coaster.segments.length <= 1) {
      setStatus('Station is the fixed start.');
      return;
    }

    applyOrSendOp({
      ...makeBaseOp('undoLastPiece'),
      type: 'undoLastPiece',
      coasterId: coaster.id,
    });
    setIsRunning(false);
    setRunState(null);
  }, [applyOrSendOp, coaster.id, coaster.segments.length, makeBaseOp]);

  placeRef.current = placeSelectedPiece;
  undoRef.current = undoLastPiece;

  const startRun = useCallback(
    (fromRemote = false, seed = Math.floor(Math.random() * 999999)) => {
      const op: StartRunOp = {
        ...makeBaseOp('startRun'),
        type: 'startRun',
        coasterId: coaster.id,
        seed,
      };

      if (!fromRemote && connectionStatus === 'connected') {
        sendMessage({ type: 'parkOp', op });
      }

      const initialRunState = createRunState(coaster);
      runStateRef.current = initialRunState;
      setRunState(initialRunState);
      setIsRunning(true);
      setStatus('Test run started.');
    },
    [coaster, connectionStatus, makeBaseOp, sendMessage],
  );

  const connectRoom = useCallback(() => {
    if (!roomCode.trim()) {
      setStatus('Enter a room code.');
      return;
    }

    wsRef.current?.close();
    setConnectionStatus('connecting');
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const socket = new WebSocket(getWsUrl(normalizedRoomCode));
    wsRef.current = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'join',
          roomCode: normalizedRoomCode,
          clientId: clientIdRef.current,
          name: clientName || 'Builder',
          presence: localPresence(),
          document: park,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as ServerMessage;

      if (message.type === 'joined' && message.document) {
        setConnectionStatus('connected');
        setPark(message.document);
        setUsers(message.users ?? []);
        setRoomCode(message.roomCode ?? normalizedRoomCode);
        window.history.replaceState(null, '', `/coaster-park?room=${encodeURIComponent(message.roomCode ?? normalizedRoomCode)}`);
        setStatus(`Joined room ${message.roomCode ?? normalizedRoomCode}.`);
      }

      if (message.type === 'parkOpApplied' && message.op) {
        if (message.op.type === 'startRun') {
          startRun(true, message.op.seed);
        } else {
          setPark((current) => applyParkOp(current, message.op!));
        }
      }

      if (message.type === 'opRejected' && message.document) {
        setPark(message.document);
        setStatus(message.reason ?? 'Room rejected the edit.');
      }

      if (message.type === 'presence') {
        setUsers(message.users ?? []);
      }

      if (message.type === 'error') {
        setStatus(message.reason ?? 'Room server error.');
      }
    });

    socket.addEventListener('close', () => {
      setConnectionStatus((current) => (current === 'connected' ? 'offline' : current));
      setUsers([]);
    });

    socket.addEventListener('error', () => {
      setConnectionStatus('error');
      setStatus('Could not reach the room server.');
    });
  }, [clientName, localPresence, park, roomCode, startRun]);

  const disconnectRoom = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus('offline');
    setUsers([]);
    setStatus('Room disconnected.');
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      sendMessage({
        type: 'presence',
        presence: localPresence(),
      });
    }, 900);

    return () => window.clearInterval(interval);
  }, [connectionStatus, localPresence, sendMessage]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    let frameId = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const dt = Math.min((time - previousTime) / 1000, 0.035);
      previousTime = time;
      const current = runStateRef.current;
      if (!current) {
        setIsRunning(false);
        return;
      }
      const next = simulateStep(coaster, current, dt, DEFAULT_PHYSICS);
      runStateRef.current = next;
      setRunState(next);
      if (next.complete || next.stalled) {
        setIsRunning(false);
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [coaster, isRunning]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dbeafe');
    scene.fog = new THREE.Fog('#dbeafe', 150, 360);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
    const cameraTarget = INITIAL_CAMERA_TARGET.clone();
    const cameraSpherical = new THREE.Spherical().setFromVector3(CAMERA_DIRECTION);
    let zoomDistance = INITIAL_ZOOM_DISTANCE;
    const updateCamera = () => {
      const runtime = runtimeRef.current;
      const distance = runtime?.zoomDistance ?? zoomDistance;
      const spherical = runtime?.cameraSpherical ?? cameraSpherical;
      camera.position
        .copy(cameraTarget)
        .add(new THREE.Vector3().setFromSphericalCoords(distance, spherical.phi, spherical.theta));
      camera.lookAt(cameraTarget);
    };
    updateCamera();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'block h-full w-full';
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#f8fafc', '#93c5fd', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(BUILD_GRID_SIZE, BUILD_GRID_SIZE, BUILD_GRID_SIZE / TILE_SIZE, BUILD_GRID_SIZE / TILE_SIZE),
      new THREE.MeshStandardMaterial({ color: '#86efac', roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(BUILD_GRID_SIZE, BUILD_GRID_SIZE / TILE_SIZE, '#64748b', '#94a3b8');
    grid.position.y = 0.015;
    scene.add(grid);

    const trackGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    const trainGroup = new THREE.Group();
    const remoteGroup = new THREE.Group();
    scene.add(trackGroup, ghostGroup, trainGroup, remoteGroup);

    const keyState = new Set<string>();

    const runtime: RuntimeScene = {
      scene,
      camera,
      renderer,
      cameraTarget,
      cameraSpherical,
      zoomDistance,
      trackGroup,
      ghostGroup,
      trainGroup,
      remoteGroup,
      keyState,
      resizeObserver: new ResizeObserver(() => undefined),
      animationFrame: 0,
      updateCamera,
      cleanup: () => undefined,
    };

    const updateSize = () => {
      const width = Math.max(host.clientWidth, 320);
      const height = Math.max(host.clientHeight, 420);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(host);
    runtime.resizeObserver = resizeObserver;
    updateSize();

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      runtime.zoomDistance = clampNumber(
        runtime.zoomDistance * (event.deltaY > 0 ? 1.1 : 0.9),
        24,
        170,
      );
      zoomDistance = runtime.zoomDistance;
      runtime.updateCamera();
    };

    let isRotatingCamera = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.target !== renderer.domElement) {
        return;
      }

      isRotatingCamera = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isRotatingCamera) {
        return;
      }

      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      runtime.cameraSpherical.theta -= dx * 0.006;
      runtime.cameraSpherical.phi = clampNumber(
        runtime.cameraSpherical.phi + dy * 0.004,
        0.38,
        1.32,
      );
      runtime.updateCamera();
    };

    const handlePointerUp = (event: PointerEvent) => {
      isRotatingCamera = false;
      if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      keyState.add(event.key.toLowerCase());
      if (event.key === 'Enter') {
        event.preventDefault();
        placeRef.current();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoRef.current();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keyState.delete(event.key.toLowerCase());
    };

    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const animate = () => {
      const activeRuntime = runtimeRef.current;
      if (activeRuntime) {
        const forward = new THREE.Vector3();
        activeRuntime.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const pan = new THREE.Vector3();
        const speed = activeRuntime.zoomDistance * (activeRuntime.keyState.has('shift') ? 0.021 : 0.012);
        if (activeRuntime.keyState.has('w')) pan.addScaledVector(forward, speed);
        if (activeRuntime.keyState.has('s')) pan.addScaledVector(forward, -speed);
        if (activeRuntime.keyState.has('d')) pan.addScaledVector(right, speed);
        if (activeRuntime.keyState.has('a')) pan.addScaledVector(right, -speed);
        if (pan.lengthSq() > 0) {
          activeRuntime.cameraTarget.add(pan);
          const halfGrid = BUILD_GRID_SIZE / 2 - TILE_SIZE;
          activeRuntime.cameraTarget.x = clampNumber(activeRuntime.cameraTarget.x, -halfGrid, halfGrid);
          activeRuntime.cameraTarget.z = clampNumber(activeRuntime.cameraTarget.z, -halfGrid, halfGrid);
          activeRuntime.updateCamera();
        }
        activeRuntime.renderer.render(activeRuntime.scene, activeRuntime.camera);
        activeRuntime.animationFrame = window.requestAnimationFrame(animate);
      }
    };

    runtime.cleanup = () => {
      window.cancelAnimationFrame(runtime.animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearGroup(trackGroup);
      clearGroup(ghostGroup);
      clearGroup(trainGroup);
      clearGroup(remoteGroup);
      renderer.dispose();
      host.replaceChildren();
    };
    runtimeRef.current = runtime;
    animate();

    return () => {
      runtime.cleanup();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    rebuildTrackScene(runtime, park, preview, runState, users, clientIdRef.current);
  }, [park, preview, runState, users]);

  const exportPark = () => {
    const blob = new Blob([JSON.stringify(park, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `coaster-park-${roomCode || 'local'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPark = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const document = JSON.parse(String(reader.result)) as ParkDocument;
        const op: ParkOp = {
          ...makeBaseOp('replacePark'),
          type: 'replacePark',
          document,
        };
        applyOrSendOp(op);
        setIsRunning(false);
        setRunState(null);
      } catch {
        setStatus('Could not import that park JSON.');
      }
    });
    reader.readAsText(file);
  };

  const resetLocalPark = () => {
    const fresh = createInitialPark();
    const op: ParkOp = {
      ...makeBaseOp('replacePark'),
      type: 'replacePark',
      document: fresh,
    };
    applyOrSendOp(op);
    setIsRunning(false);
    setRunState(null);
  };

  const connectionIcon =
    connectionStatus === 'connected' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />;

  return (
    <div className="relative h-[100svh] min-h-[42rem] overflow-hidden bg-slate-950 text-slate-50">
      <div ref={hostRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 sm:p-4">
        <div className="flex min-h-0 items-start justify-between gap-3">
          <div className="pointer-events-auto flex max-w-[min(92vw,25rem)] flex-col gap-3 rounded-lg border border-white/15 bg-slate-950/78 p-3 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Coaster Park</p>
                <p className="m-0 text-sm text-slate-300">v{park.version} | {formatNumber(summary.length, 0)} m | {summary.segmentCount} pieces</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const runtime = runtimeRef.current;
                  if (!runtime) return;
                  runtime.cameraTarget.copy(INITIAL_CAMERA_TARGET);
                  runtime.cameraSpherical.copy(new THREE.Spherical().setFromVector3(CAMERA_DIRECTION));
                  runtime.zoomDistance = INITIAL_ZOOM_DISTANCE;
                  runtime.updateCamera();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-slate-100 hover:border-sky-300 hover:text-sky-200"
                title="Reset camera"
                aria-label="Reset camera"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3">
              {PIECE_GROUPS.map((group) => (
                <section key={group.label} className="grid gap-2">
                  <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.actions.map((action) => {
                      const template = getPieceTemplate(action.templateId);
                      const variant = template.variants[action.variantIndex] ?? getDefaultVariant(action.templateId);
                      const Icon = PIECE_ICONS[action.templateId];
                      const active =
                        selectedPiece === action.templateId &&
                        (variantIndex % selectedTemplate.variants.length) === action.variantIndex;

                      return (
                        <button
                          key={action.id}
                          type="button"
                          onMouseEnter={() => {
                            setSelectedPiece(action.templateId);
                            setVariantIndex(action.variantIndex);
                          }}
                          onFocus={() => {
                            setSelectedPiece(action.templateId);
                            setVariantIndex(action.variantIndex);
                          }}
                          onClick={() => placePiece(action.templateId, action.variantIndex)}
                          className={`flex h-12 items-center justify-start gap-2 rounded-md border px-3 text-left text-xs font-semibold transition-colors ${
                            active
                              ? 'border-sky-300 bg-sky-400/20 text-sky-100'
                              : 'border-white/12 bg-white/8 text-slate-200 hover:border-sky-300/70 hover:text-sky-100'
                          }`}
                          title={`${template.label}: ${variant.label}`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">{action.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={undoLastPiece}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/10 text-sm font-semibold text-slate-100 hover:border-amber-300 hover:text-amber-100"
                title="Undo last piece"
                aria-label="Undo last piece"
              >
                <RotateCcw className="h-4 w-4" />
                Undo
              </button>
            </div>

            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                preview.valid
                  ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100'
                  : 'border-rose-400/45 bg-rose-500/12 text-rose-100'
              }`}
            >
              {preview.valid ? status : preview.reason}
            </div>
          </div>

          <div className="pointer-events-auto hidden w-[20rem] rounded-lg border border-white/15 bg-slate-950/78 p-3 shadow-xl backdrop-blur-md md:block">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Ride Test</p>
                <p className="m-0 text-sm text-slate-300">{isRunning ? 'Running' : runState?.complete ? 'Complete' : runState?.stalled ? 'Stalled' : 'Ready'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isRunning) {
                    setIsRunning(false);
                  } else if (runState && !runState.complete && !runState.stalled) {
                    setIsRunning(true);
                  } else {
                    startRun();
                  }
                }}
                className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-400"
              >
                {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isRunning ? 'Pause' : 'Run'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Speed" value={`${formatNumber(runState?.speed ?? 0)} m/s`} />
              <Metric label="Height" value={`${formatNumber(runState?.metrics.maxHeight ?? summary.maxHeight)} m`} />
              <Metric label="+Vertical g" value={formatNumber(runState?.metrics.maxPositiveVerticalG ?? 0, 2)} />
              <Metric label="-Vertical g" value={formatNumber(runState?.metrics.maxNegativeVerticalG ?? 0, 2)} />
              <Metric label="Lateral g" value={formatNumber(runState?.metrics.maxLateralG ?? 0, 2)} />
              <Metric label="Airtime" value={`${formatNumber(runState?.metrics.airtime ?? 0, 2)} s`} />
              <Metric label="Kinetic" value={`${formatNumber((runState?.kineticEnergy ?? 0) / 1000, 1)} kJ`} />
              <Metric label="Thermal" value={`${formatNumber((runState?.thermalEnergy ?? 0) / 1000, 1)} kJ`} />
            </div>

            <div className="mt-3 rounded-md border border-white/12 bg-white/8 px-3 py-2 text-sm text-slate-200">
              {(runState?.metrics.warnings.length ?? 0) > 0 ? runState?.metrics.warnings.join(' | ') : 'Forces are within the v1 comfort envelope.'}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto grid gap-3 rounded-lg border border-white/15 bg-slate-950/78 p-3 shadow-xl backdrop-blur-md md:grid-cols-[1fr_auto_auto]">
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              className="h-10 rounded-md border border-white/15 bg-white/10 px-3 text-sm font-semibold uppercase text-white outline-none focus:border-sky-300"
              aria-label="Room code"
            />
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              className="h-10 rounded-md border border-white/15 bg-white/10 px-3 text-sm text-white outline-none focus:border-sky-300"
              aria-label="Builder name"
            />
            <button
              type="button"
              onClick={connectionStatus === 'connected' ? disconnectRoom : connectRoom}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm font-semibold text-slate-100 hover:border-sky-300 hover:text-sky-100"
            >
              {connectionIcon}
              {connectionStatus === 'connected' ? 'Disconnect' : connectionStatus === 'connecting' ? 'Connecting' : 'Join Room'}
            </button>
            <div className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/8 px-3 text-sm text-slate-200">
              <Users className="h-4 w-4" />
              {Math.max(users.length, connectionStatus === 'connected' ? 1 : 0)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => startRun()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-3 text-sm font-semibold text-white hover:bg-orange-400"
            >
              <Play className="h-4 w-4" />
              Test
            </button>
            <button
              type="button"
              onClick={resetLocalPark}
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 bg-white/10 px-3 text-slate-100 hover:border-rose-300 hover:text-rose-100"
              title="Reset park"
              aria-label="Reset park"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importPark(file);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 bg-white/10 px-3 text-slate-100 hover:border-sky-300 hover:text-sky-100"
              title="Import park"
              aria-label="Import park"
            >
              <Upload className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={exportPark}
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 bg-white/10 px-3 text-slate-100 hover:border-sky-300 hover:text-sky-100"
              title="Export park"
              aria-label="Export park"
            >
              <Download className="h-4 w-4" />
            </button>
            <div className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/8 px-3 text-sm text-slate-200">
              <RadioTower className="h-4 w-4" />
              {connectionStatus}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/12 bg-white/8 px-3 py-2">
      <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="m-0 mt-1 font-mono text-base text-slate-50">{value}</p>
    </div>
  );
}
