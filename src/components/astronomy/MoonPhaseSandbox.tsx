import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Gauge,
  LocateFixed,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import * as THREE from 'three';

import {
  DAY_MS,
  EARTH_RADIUS_KM,
  MEAN_MOON_DISTANCE_KM,
  MOON_PATH_SAMPLE_COUNT,
  MOON_RADIUS_KM,
  TIME_SPEED_PRESETS,
  advanceSimulationTime,
  applySpaceTranslation,
  canUseClickForDescent,
  clampCameraPitch,
  createSurfacePose,
  formatSpeedLabel,
  getCameraBasis,
  getEarthMoonSunSnapshot,
  getSurfaceSkyState,
  moveSurfacePose,
  speedFromLogSlider,
  surfaceLatitudeLongitude,
  type CameraMode,
  type EclipseState,
  type MoonPhaseSummary,
  type SurfacePose,
  type Vec3,
} from '../../lib/astronomy/index.ts';
import './moonPhaseSandbox.css';

type BodyId = 'earth' | 'moon';
type ScaleMode = 'compact' | 'true';
type LabelId = 'earth' | 'moon' | 'sun' | 'path' | 'eclipse';

interface SceneObjects {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  earthGroup: THREE.Group;
  moonGroup: THREE.Group;
  earthMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  sunMesh: THREE.Mesh;
  sunLight: THREE.DirectionalLight;
  earthAtmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  moonPathLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  eclipseLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lunarEclipseTint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  labels: Record<LabelId, THREE.Sprite>;
}

interface SurfaceState {
  body: BodyId;
  pose: SurfacePose;
  pitch: number;
}

interface TransitionState {
  startTime: number;
  duration: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  onComplete: () => void;
}

interface SpaceCameraState {
  yaw: number;
  pitch: number;
}

const EARTH_SCENE_RADIUS = 9.5;
const MOON_SCENE_RADIUS = EARTH_SCENE_RADIUS * (MOON_RADIUS_KM / EARTH_RADIUS_KM);
const EARTH_ATMOSPHERE_RADIUS = EARTH_SCENE_RADIUS * 1.035;
const COMPACT_MOON_DISTANCE = EARTH_SCENE_RADIUS * 11.6;
const SPACE_CAMERA_POSITION = new THREE.Vector3(38, 92, 240);
const INITIAL_SIM_DATE = new Date('2000-01-01T12:00:00.000Z');
const SNAPSHOT_UPDATE_MS = 180;
const UI_SYNC_MS = 220;
const SPACE_LOOK_SENSITIVITY = 0.0036;
const SURFACE_LOOK_SENSITIVITY = 0.0024;

const BODY_CONFIG: Record<BodyId, {
  label: string;
  radius: number;
  eyeHeight: number;
  walkSpeed: number;
  fastMultiplier: number;
}> = {
  earth: {
    label: 'Earth',
    radius: EARTH_SCENE_RADIUS,
    eyeHeight: EARTH_SCENE_RADIUS * 0.0046,
    walkSpeed: EARTH_SCENE_RADIUS * 0.13,
    fastMultiplier: 4.2,
  },
  moon: {
    label: 'Moon',
    radius: MOON_SCENE_RADIUS,
    eyeHeight: MOON_SCENE_RADIUS * 0.016,
    walkSpeed: MOON_SCENE_RADIUS * 0.16,
    fastMultiplier: 3.4,
  },
};

const vectorFromPlain = (vector: Vec3) =>
  new THREE.Vector3(vector.x, vector.y, vector.z);

const plainFromVector = (vector: THREE.Vector3): Vec3 => ({
  x: vector.x,
  y: vector.y,
  z: vector.z,
});

const keyed = (keys: Set<string>, ...values: string[]) =>
  values.some((value) => keys.has(value));

const normalizedAxisInput = (forward: number, right: number) => {
  const magnitude = Math.hypot(forward, right);
  if (magnitude === 0) return { forward: 0, right: 0 };
  return {
    forward: forward / magnitude,
    right: right / magnitude,
  };
};

const seededUnit = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const createStarField = () => {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const z = seededUnit(index, 1) * 2 - 1;
    const theta = seededUnit(index, 2) * Math.PI * 2;
    const radius = Math.sqrt(1 - z * z);
    const distance = 780 + seededUnit(index, 3) * 540;
    const colorMix = 0.72 + seededUnit(index, 4) * 0.28;

    positions[index * 3] = Math.cos(theta) * radius * distance;
    positions[index * 3 + 1] = z * distance;
    positions[index * 3 + 2] = Math.sin(theta) * radius * distance;
    colors[index * 3] = colorMix;
    colors[index * 3 + 1] = colorMix * (0.92 + seededUnit(index, 5) * 0.1);
    colors[index * 3 + 2] = 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 1.2,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  );
};

const createMoonPathLine = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MOON_PATH_SAMPLE_COUNT * 3), 3),
  );
  geometry.setDrawRange(0, MOON_PATH_SAMPLE_COUNT);

  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x8dd7ff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
};

const createTwoPointLine = (color: number) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
};

const createLabelSprite = (label: string, scale = new THREE.Vector3(4.4, 1.65, 1)) => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(8, 13, 24, 0.72)';
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    context.lineWidth = 2;
    context.roundRect(18, 18, 284, 52, 12);
    context.fill();
    context.stroke();
    context.fillStyle = '#f8fafc';
    context.font = '600 27px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 160, 45);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.copy(scale);
  sprite.renderOrder = 8;
  return sprite;
};

const createEarthAtmosphere = () =>
  new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_ATMOSPHERE_RADIUS, 128, 64),
    new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec3 normalDirection = normalize(vWorldNormal);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float sunFacing = dot(normalDirection, normalize(sunDirection));
          float rim = pow(1.0 - abs(dot(normalDirection, viewDirection)), 2.15);
          float twilight = smoothstep(-0.28, 0.08, sunFacing) * (1.0 - smoothstep(0.32, 0.76, sunFacing));
          float daylight = smoothstep(-0.06, 0.42, sunFacing);
          vec3 dayColor = vec3(0.32, 0.62, 1.0);
          vec3 duskColor = vec3(1.0, 0.49, 0.22);
          vec3 color = mix(duskColor, dayColor, daylight);
          float alpha = rim * (0.11 + daylight * 0.22 + twilight * 0.2);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );

const createSurfaceSkyDome = () =>
  new THREE.Mesh(
    new THREE.SphereGeometry(480, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        upDirection: { value: new THREE.Vector3(0, 1, 0) },
        daylight: { value: 1 },
        twilight: { value: 0 },
        night: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldDirection;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform vec3 upDirection;
        uniform float daylight;
        uniform float twilight;
        uniform float night;
        varying vec3 vWorldDirection;

        void main() {
          vec3 direction = normalize(vWorldDirection);
          vec3 sun = normalize(sunDirection);
          vec3 up = normalize(upDirection);
          float sunDot = dot(direction, sun);
          float upDot = dot(direction, up);
          float horizon = pow(1.0 - abs(upDot), 3.0);
          float sunGlow = smoothstep(0.12, 0.98, sunDot);
          float duskBand = smoothstep(-0.25, 0.12, sunDot) * (1.0 - smoothstep(0.12, 0.48, sunDot));

          vec3 nightColor = mix(vec3(0.004, 0.008, 0.028), vec3(0.018, 0.034, 0.075), max(upDot, 0.0));
          vec3 dayColor = mix(vec3(0.38, 0.62, 0.98), vec3(0.08, 0.21, 0.48), clamp(upDot, 0.0, 1.0));
          vec3 twilightColor = vec3(1.0, 0.36, 0.17) * duskBand * (0.34 + horizon);
          vec3 horizonColor = mix(vec3(0.08, 0.1, 0.18), vec3(0.74, 0.82, 0.94), daylight);
          vec3 color = mix(nightColor, dayColor, daylight);

          color += twilightColor * twilight;
          color += vec3(1.0, 0.84, 0.45) * sunGlow * daylight * 0.48;
          color = mix(color, horizonColor, horizon * (0.28 + daylight * 0.32 + twilight * 0.34));
          color = mix(color, vec3(0.0, 0.0, 0.0), night * smoothstep(-1.0, -0.25, upDot) * 0.35);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
    }),
  );

const easeInOutCubic = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

const getMoonDistance = (scaleMode: ScaleMode, moonDistanceKm: number) =>
  scaleMode === 'true'
    ? (moonDistanceKm / EARTH_RADIUS_KM) * EARTH_SCENE_RADIUS
    : COMPACT_MOON_DISTANCE * (moonDistanceKm / MEAN_MOON_DISTANCE_KM);

const getSunDistance = (scaleMode: ScaleMode) => (scaleMode === 'true' ? 520 : 260);

const getScenePositionFromGeocentric = (vector: Vec3, scaleMode: ScaleMode) => {
  const position = vectorFromPlain(vector);
  const distanceKm = position.length();
  return position.normalize().multiplyScalar(getMoonDistance(scaleMode, distanceKm));
};

const getMoonScenePosition = (
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  scaleMode: ScaleMode,
) => getScenePositionFromGeocentric(snapshot.moonGeocentricKm, scaleMode);

const getSpaceView = (
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  scaleMode: ScaleMode,
) => {
  const moonPosition = getMoonScenePosition(snapshot, scaleMode);
  const target = moonPosition.clone().multiplyScalar(0.38);
  const offset = scaleMode === 'true'
    ? new THREE.Vector3(120, 250, 760)
    : new THREE.Vector3(38, 92, 240);

  return {
    position: target.clone().add(offset),
    target,
  };
};

const toDisplayDate = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const sliderValueForSpeed = (speed: number) => {
  if (speed === 1) return 0;
  return Math.sign(speed) * Math.log10(Math.max(1, Math.abs(speed)));
};

const getInitialRuntimeDate = () => {
  if (typeof window === 'undefined') return new Date();
  const requestedDate = new URLSearchParams(window.location.search).get('date');
  if (!requestedDate) return new Date();
  const parsedDate = new Date(requestedDate);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
};

const getBodyCenter = (objects: SceneObjects, body: BodyId) =>
  body === 'earth' ? objects.earthGroup.position : objects.moonGroup.position;

const getBodyGroup = (objects: SceneObjects, body: BodyId) =>
  body === 'earth' ? objects.earthGroup : objects.moonGroup;

const setSpaceCameraFromLookAt = (
  position: THREE.Vector3,
  target: THREE.Vector3,
  state: SpaceCameraState,
) => {
  const direction = target.clone().sub(position).normalize();
  state.yaw = Math.atan2(direction.x, -direction.z);
  state.pitch = clampCameraPitch(Math.asin(Math.max(-1, Math.min(1, direction.y))));
};

const applySpaceCameraLook = (
  camera: THREE.PerspectiveCamera,
  state: SpaceCameraState,
) => {
  const basis = getCameraBasis(state.yaw, state.pitch);
  const lookTarget = camera.position.clone().add(vectorFromPlain(basis.forward));
  camera.lookAt(lookTarget);
};

const getSurfaceCameraVectors = (
  objects: SceneObjects,
  surface: SurfaceState,
) => {
  const config = BODY_CONFIG[surface.body];
  const bodyGroup = getBodyGroup(objects, surface.body);
  const bodyCenter = getBodyCenter(objects, surface.body);
  const localEye = vectorFromPlain(surface.pose.up).multiplyScalar(config.radius + config.eyeHeight);
  const localForward = vectorFromPlain(surface.pose.forward);
  const localUp = vectorFromPlain(surface.pose.up);
  const localLook = localForward
    .multiplyScalar(Math.cos(surface.pitch))
    .add(localUp.clone().multiplyScalar(Math.sin(surface.pitch)))
    .normalize();

  const eye = localEye.applyQuaternion(bodyGroup.quaternion).add(bodyCenter);
  const lookDirection = localLook.applyQuaternion(bodyGroup.quaternion).normalize();
  const target = eye.clone().add(lookDirection.multiplyScalar(config.radius * 2));

  return { eye, target };
};

const updateLinePositions = (
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  points: THREE.Vector3[],
) => {
  const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  points.forEach((point, index) => {
    attribute.setXYZ(index, point.x, point.y, point.z);
  });
  line.geometry.setDrawRange(0, points.length);
  attribute.needsUpdate = true;
  line.geometry.computeBoundingSphere();
};

const updateMoonPathLine = (
  objects: SceneObjects,
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  scaleMode: ScaleMode,
) => {
  const points = snapshot.moonPathGeocentricKm.map((point) =>
    getScenePositionFromGeocentric(point, scaleMode));
  updateLinePositions(objects.moonPathLine, points);

  const labelPoint = points[Math.floor(points.length * 0.18)] ?? points[0];
  if (labelPoint) {
    objects.labels.path.position.copy(labelPoint).add(new THREE.Vector3(0, 8, 0));
  }
};

const setEclipseIndicator = (
  objects: SceneObjects,
  eclipseState: EclipseState | null,
  moonPosition: THREE.Vector3,
) => {
  objects.eclipseLine.visible = false;
  objects.labels.eclipse.visible = false;
  objects.lunarEclipseTint.visible = false;
  objects.eclipseLine.material.opacity = 0;

  if (!eclipseState) return;

  const opacity = 0.18 + eclipseState.intensity * 0.54;
  if (eclipseState.type === 'lunar') {
    objects.lunarEclipseTint.position.copy(moonPosition);
    objects.lunarEclipseTint.material.opacity = opacity;
    objects.lunarEclipseTint.visible = true;
    objects.labels.eclipse.position.copy(moonPosition).add(new THREE.Vector3(0, MOON_SCENE_RADIUS + 5.5, 0));
  } else {
    updateLinePositions(objects.eclipseLine, [moonPosition, new THREE.Vector3(0, 0, 0)]);
    objects.eclipseLine.material.opacity = opacity;
    objects.eclipseLine.visible = true;
    objects.labels.eclipse.position.copy(moonPosition.clone().multiplyScalar(0.48).add(new THREE.Vector3(0, 6, 0)));
  }

  objects.labels.eclipse.visible = true;
};

export default function MoonPhaseSandbox() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const objectsRef = useRef<SceneObjects | null>(null);
  const requestRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(performance.now());
  const lastUiSyncRef = useRef<number>(0);
  const simTimeRef = useRef<Date>(INITIAL_SIM_DATE);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const scaleModeRef = useRef<ScaleMode>('compact');
  const labelsVisibleRef = useRef(true);
  const modeRef = useRef<CameraMode>('space');
  const surfaceRef = useRef<SurfaceState | null>(null);
  const transitionRef = useRef<TransitionState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const spaceCameraRef = useRef<SpaceCameraState>({ yaw: 0, pitch: -0.18 });
  const pointerLockedRef = useRef(false);
  const pointerRef = useRef({
    down: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  const [hydrated, setHydrated] = useState(false);
  const [displayDate, setDisplayDate] = useState(() => simTimeRef.current);
  const [phase, setPhase] = useState<MoonPhaseSummary>(() =>
    getEarthMoonSunSnapshot(simTimeRef.current).phase,
  );
  const [eclipseState, setEclipseState] = useState<EclipseState | null>(() =>
    getEarthMoonSunSnapshot(simTimeRef.current).eclipseState,
  );
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('compact');
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [mode, setMode] = useState<CameraMode>('space');
  const [surfaceBody, setSurfaceBody] = useState<BodyId | null>(null);
  const [surfaceCoords, setSurfaceCoords] = useState({ latitude: 0, longitude: 0 });
  const [pointerLocked, setPointerLocked] = useState(false);

  const speedLabel = useMemo(() => formatSpeedLabel(speed), [speed]);

  useEffect(() => {
    const now = getInitialRuntimeDate();
    const snapshot = getEarthMoonSunSnapshot(now);
    simTimeRef.current = now;
    setDisplayDate(now);
    setPhase(snapshot.phase);
    setEclipseState(snapshot.eclipseState);
    setHydrated(true);
  }, []);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    scaleModeRef.current = scaleMode;
  }, [scaleMode]);

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
  }, [labelsVisible]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    let latestSnapshot = getEarthMoonSunSnapshot(simTimeRef.current);
    let lastSnapshotUpdate = 0;
    scene.background = new THREE.Color(0x02040b);
    scene.fog = new THREE.FogExp2(0x02040b, 0.0008);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.005, 2200);
    camera.position.copy(SPACE_CAMERA_POSITION);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);

    const initialSpaceView = getSpaceView(latestSnapshot, scaleModeRef.current);
    camera.position.copy(initialSpaceView.position);
    setSpaceCameraFromLookAt(camera.position, initialSpaceView.target, spaceCameraRef.current);
    applySpaceCameraLook(camera, spaceCameraRef.current);

    scene.add(createStarField());
    scene.add(new THREE.AmbientLight(0x182033, 0.12));

    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load('/textures/astronomy/earth-blue-marble-july.jpg');
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const moonTexture = textureLoader.load('/textures/astronomy/moon-lroc-color-2k.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    moonTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const moonBump = textureLoader.load('/textures/astronomy/moon-ldem-1k.jpg');
    moonBump.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const earthGroup = new THREE.Group();
    const moonGroup = new THREE.Group();
    scene.add(earthGroup);
    scene.add(moonGroup);

    const earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 160, 80),
      new THREE.MeshStandardMaterial({
        map: earthTexture,
        roughness: 0.78,
        metalness: 0,
      }),
    );
    earthMesh.castShadow = true;
    earthMesh.receiveShadow = true;
    earthMesh.userData.body = 'earth';
    earthGroup.add(earthMesh);

    const earthAtmosphere = createEarthAtmosphere();
    earthGroup.add(earthAtmosphere);

    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_SCENE_RADIUS, 128, 64),
      new THREE.MeshStandardMaterial({
        map: moonTexture,
        bumpMap: moonBump,
        bumpScale: 0.075,
        roughness: 0.94,
      }),
    );
    moonMesh.castShadow = true;
    moonMesh.receiveShadow = true;
    moonMesh.userData.body = 'moon';
    moonGroup.add(moonMesh);

    const lunarEclipseTint = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_SCENE_RADIUS * 1.025, 64, 32),
      new THREE.MeshBasicMaterial({
        color: 0x7f1d1d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.MultiplyBlending,
      }),
    );
    lunarEclipseTint.visible = false;
    scene.add(lunarEclipseTint);

    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(9.5, 64, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd88a,
      }),
    );
    scene.add(sunMesh);

    const sunHalo = new THREE.Mesh(
      new THREE.SphereGeometry(15.5, 64, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
      }),
    );
    sunMesh.add(sunHalo);

    const sunLight = new THREE.DirectionalLight(0xffffff, 5.4);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 420;
    sunLight.shadow.camera.left = -90;
    sunLight.shadow.camera.right = 90;
    sunLight.shadow.camera.top = 90;
    sunLight.shadow.camera.bottom = -90;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const moonPathLine = createMoonPathLine();
    scene.add(moonPathLine);

    const eclipseLine = createTwoPointLine(0xf97316);
    scene.add(eclipseLine);

    const skyDome = createSurfaceSkyDome();
    skyDome.visible = false;
    scene.add(skyDome);

    const labels = {
      earth: createLabelSprite('Earth'),
      moon: createLabelSprite('Moon'),
      sun: createLabelSprite('Sun'),
      path: createLabelSprite('Moon path', new THREE.Vector3(5.6, 1.7, 1)),
      eclipse: createLabelSprite('Eclipse window', new THREE.Vector3(6.4, 1.7, 1)),
    };
    scene.add(labels.earth, labels.moon, labels.sun, labels.path, labels.eclipse);

    const objects: SceneObjects = {
      scene,
      camera,
      renderer,
      earthGroup,
      moonGroup,
      earthMesh,
      moonMesh,
      sunMesh,
      sunLight,
      earthAtmosphere,
      skyDome,
      moonPathLine,
      eclipseLine,
      lunarEclipseTint,
      labels,
    };
    objectsRef.current = objects;

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const requestPointerLock = () => {
      try {
        const result = renderer.domElement.requestPointerLock?.();
        if (result && 'catch' in result) {
          result.catch(() => undefined);
        }
      } catch {
        // Pointer lock is optional; the surface remains keyboard-navigable without it.
      }
    };

    const beginTransition = (
      toPosition: THREE.Vector3,
      toTarget: THREE.Vector3,
      onComplete: () => void,
      duration = 950,
    ) => {
      const fromTarget = modeRef.current === 'surface' && surfaceRef.current
        ? getSurfaceCameraVectors(objects, surfaceRef.current).target
        : camera.position.clone().add(vectorFromPlain(getCameraBasis(
          spaceCameraRef.current.yaw,
          spaceCameraRef.current.pitch,
        ).forward));

      transitionRef.current = {
        startTime: performance.now(),
        duration,
        fromPosition: camera.position.clone(),
        fromTarget,
        toPosition,
        toTarget,
        onComplete,
      };
      modeRef.current = 'transition';
      setMode('transition');
    };

    const enterSurface = (body: BodyId, worldPoint: THREE.Vector3) => {
      const bodyGroup = getBodyGroup(objects, body);
      const config = BODY_CONFIG[body];
      const localPoint = bodyGroup.worldToLocal(worldPoint.clone()).normalize();
      const latitude = Math.asin(Math.max(-1, Math.min(1, localPoint.y)));
      const longitude = Math.atan2(localPoint.z, localPoint.x);
      const pose = createSurfacePose(config.radius, latitude, longitude, 0);
      const surface: SurfaceState = {
        body,
        pose,
        pitch: body === 'earth' ? 0.02 : 0.06,
      };
      const { eye, target } = getSurfaceCameraVectors(objects, surface);

      surfaceRef.current = surface;
      setSurfaceBody(body);
      requestPointerLock();
      beginTransition(eye, target, () => {
        modeRef.current = 'surface';
        setMode('surface');
      });
    };

    const returnToSpace = () => {
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      surfaceRef.current = null;
      setSurfaceBody(null);
      const spaceView = getSpaceView(latestSnapshot, scaleModeRef.current);
      beginTransition(spaceView.position, spaceView.target, () => {
        modeRef.current = 'space';
        setMode('space');
        setSpaceCameraFromLookAt(camera.position, spaceView.target, spaceCameraRef.current);
        applySpaceCameraLook(camera, spaceCameraRef.current);
      });
    };

    const resetCamera = () => {
      if (modeRef.current === 'surface') {
        returnToSpace();
        return;
      }

      const spaceView = getSpaceView(latestSnapshot, scaleModeRef.current);
      beginTransition(spaceView.position, spaceView.target, () => {
        modeRef.current = 'space';
        setMode('space');
        setSpaceCameraFromLookAt(camera.position, spaceView.target, spaceCameraRef.current);
        applySpaceCameraLook(camera, spaceCameraRef.current);
      }, 700);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (modeRef.current === 'surface') {
        requestPointerLock();
        return;
      }

      if (modeRef.current !== 'space') return;
      pointerRef.current = {
        down: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const pointerState = pointerRef.current;
      if (!pointerState.down || pointerState.pointerId !== event.pointerId || modeRef.current !== 'space') {
        return;
      }

      const dx = event.clientX - pointerState.lastX;
      const dy = event.clientY - pointerState.lastY;
      pointerState.lastX = event.clientX;
      pointerState.lastY = event.clientY;

      if (
        Math.hypot(
          event.clientX - pointerState.startX,
          event.clientY - pointerState.startY,
        ) > 5
      ) {
        pointerState.moved = true;
      }

      event.preventDefault();
      spaceCameraRef.current.yaw -= dx * SPACE_LOOK_SENSITIVITY;
      spaceCameraRef.current.pitch = clampCameraPitch(
        spaceCameraRef.current.pitch - dy * SPACE_LOOK_SENSITIVITY,
      );
      applySpaceCameraLook(camera, spaceCameraRef.current);
    };

    const onPointerUp = (event: PointerEvent) => {
      const pointerState = pointerRef.current;
      pointerState.down = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);

      if (!canUseClickForDescent(modeRef.current, pointerState.moved)) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects([earthMesh, moonMesh], false);
      const hit = intersections[0];
      const body = hit?.object.userData.body as BodyId | undefined;
      if (hit && (body === 'earth' || body === 'moon')) {
        enterSurface(body, hit.point);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      pointerRef.current.down = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    };

    const onDocumentMouseMove = (event: MouseEvent) => {
      if (!pointerLockedRef.current || modeRef.current !== 'surface' || !surfaceRef.current) {
        return;
      }

      const surface = surfaceRef.current;
      surface.pose = moveSurfacePose(surface.pose, BODY_CONFIG[surface.body].radius, {
        forwardDistance: 0,
        rightDistance: 0,
        turnRadians: -event.movementX * SURFACE_LOOK_SENSITIVITY,
      });
      surface.pitch = clampCameraPitch(surface.pitch - event.movementY * SURFACE_LOOK_SENSITIVITY);
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      pointerLockedRef.current = locked;
      setPointerLocked(locked);
    };

    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, button, textarea, select'));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (
        key === 'arrowup'
        || key === 'arrowdown'
        || key === 'arrowleft'
        || key === 'arrowright'
      ) {
        event.preventDefault();
      }
      keysRef.current.add(key);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      keysRef.current.delete(event.key.toLowerCase());
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    (window as Window & {
      __moonPhaseSandboxReturnToSpace?: () => void;
      __moonPhaseSandboxResetCamera?: () => void;
      __moonPhaseSandboxSetDate?: (date: Date | string) => void;
    }).__moonPhaseSandboxReturnToSpace = returnToSpace;
    (window as Window & {
      __moonPhaseSandboxReturnToSpace?: () => void;
      __moonPhaseSandboxResetCamera?: () => void;
      __moonPhaseSandboxSetDate?: (date: Date | string) => void;
    }).__moonPhaseSandboxResetCamera = resetCamera;
    (window as Window & {
      __moonPhaseSandboxReturnToSpace?: () => void;
      __moonPhaseSandboxResetCamera?: () => void;
      __moonPhaseSandboxSetDate?: (date: Date | string) => void;
    }).__moonPhaseSandboxSetDate = (date: Date | string) => {
      simTimeRef.current = typeof date === 'string' ? new Date(date) : date;
      latestSnapshot = getEarthMoonSunSnapshot(simTimeRef.current);
      setDisplayDate(new Date(simTimeRef.current));
      setPhase(latestSnapshot.phase);
      setEclipseState(latestSnapshot.eclipseState);
    };

    const animate = (now: number) => {
      const elapsed = Math.min(64, now - lastFrameRef.current);
      lastFrameRef.current = now;
      simTimeRef.current = advanceSimulationTime(
        simTimeRef.current,
        elapsed,
        speedRef.current,
        runningRef.current,
      );

      if (now - lastSnapshotUpdate > SNAPSHOT_UPDATE_MS) {
        latestSnapshot = getEarthMoonSunSnapshot(simTimeRef.current);
        lastSnapshotUpdate = now;
      }

      const snapshot = latestSnapshot;
      const moonPosition = getMoonScenePosition(snapshot, scaleModeRef.current);
      const sunDirection = vectorFromPlain(snapshot.sunDirection).normalize();
      const sunPosition = sunDirection.clone().multiplyScalar(getSunDistance(scaleModeRef.current));

      moonGroup.position.copy(moonPosition);
      sunMesh.position.copy(sunPosition);
      sunLight.position.copy(sunDirection.clone().multiplyScalar(180));
      sunLight.target.position.set(0, 0, 0);
      earthGroup.rotation.y = snapshot.earthRotationRadians;
      moonGroup.rotation.y = snapshot.moonRotationRadians;
      earthAtmosphere.material.uniforms.sunDirection.value.copy(sunDirection);
      updateMoonPathLine(objects, snapshot, scaleModeRef.current);
      setEclipseIndicator(objects, snapshot.eclipseState, moonPosition);

      labels.earth.visible = labelsVisibleRef.current && modeRef.current === 'space';
      labels.moon.visible = labelsVisibleRef.current && modeRef.current === 'space';
      labels.sun.visible = labelsVisibleRef.current && modeRef.current === 'space';
      labels.path.visible = labelsVisibleRef.current && modeRef.current === 'space';
      labels.eclipse.visible = labelsVisibleRef.current && labels.eclipse.visible && modeRef.current === 'space';
      labels.earth.position.set(0, EARTH_SCENE_RADIUS + 6.2, 0);
      labels.moon.position.copy(moonPosition).add(new THREE.Vector3(0, MOON_SCENE_RADIUS + 4.3, 0));
      labels.sun.position.copy(sunPosition).add(new THREE.Vector3(0, 14, 0));

      const transition = transitionRef.current;
      if (transition) {
        const amount = Math.min(1, (now - transition.startTime) / transition.duration);
        const eased = easeInOutCubic(amount);
        const transitionTarget = new THREE.Vector3();
        camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
        transitionTarget.lerpVectors(transition.fromTarget, transition.toTarget, eased);
        camera.lookAt(transitionTarget);
        if (amount >= 1) {
          transitionRef.current = null;
          transition.onComplete();
        }
      } else if (modeRef.current === 'surface' && surfaceRef.current) {
        const surface = surfaceRef.current;
        const config = BODY_CONFIG[surface.body];
        const keys = keysRef.current;
        const forwardRaw = Number(keyed(keys, 'w', 'arrowup')) - Number(keyed(keys, 's', 'arrowdown'));
        const rightRaw = Number(keyed(keys, 'd', 'arrowright')) - Number(keyed(keys, 'a', 'arrowleft'));
        const input = normalizedAxisInput(forwardRaw, rightRaw);
        const speedBoost = keys.has('shift') ? config.fastMultiplier : 1;
        const distanceScale = config.walkSpeed * speedBoost * (elapsed / 1000);

        if (input.forward !== 0 || input.right !== 0) {
          surface.pose = moveSurfacePose(surface.pose, config.radius, {
            forwardDistance: input.forward * distanceScale,
            rightDistance: input.right * distanceScale,
          });
        }

        const { eye, target } = getSurfaceCameraVectors(objects, surface);
        const bodyGroup = getBodyGroup(objects, surface.body);
        const worldUp = vectorFromPlain(surface.pose.up)
          .applyQuaternion(bodyGroup.quaternion)
          .normalize();
        const sky = getSurfaceSkyState(snapshot.sunDirection, plainFromVector(worldUp));

        camera.position.copy(eye);
        camera.lookAt(target);
        skyDome.visible = surface.body === 'earth';
        skyDome.position.copy(camera.position);
        skyDome.material.uniforms.sunDirection.value.copy(sunDirection);
        skyDome.material.uniforms.upDirection.value.copy(worldUp);
        skyDome.material.uniforms.daylight.value = sky.daylight;
        skyDome.material.uniforms.twilight.value = sky.twilight;
        skyDome.material.uniforms.night.value = sky.night;
      } else {
        skyDome.visible = false;
        if (modeRef.current === 'space') {
          const keys = keysRef.current;
          const forwardRaw = Number(keyed(keys, 'w', 'arrowup')) - Number(keyed(keys, 's', 'arrowdown'));
          const rightRaw = Number(keyed(keys, 'd', 'arrowright')) - Number(keyed(keys, 'a', 'arrowleft'));
          const input = normalizedAxisInput(forwardRaw, rightRaw);
          const speedBoost = keys.has('shift') ? 4 : 1;
          const baseSpeed = scaleModeRef.current === 'true' ? 185 : 58;
          const distance = baseSpeed * speedBoost * (elapsed / 1000);

          if (input.forward !== 0 || input.right !== 0) {
            const nextPosition = applySpaceTranslation(
              plainFromVector(camera.position),
              getCameraBasis(spaceCameraRef.current.yaw, spaceCameraRef.current.pitch),
              input,
              distance,
            );
            camera.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
          }
          applySpaceCameraLook(camera, spaceCameraRef.current);
        }
      }

      if (now - lastUiSyncRef.current > UI_SYNC_MS) {
        lastUiSyncRef.current = now;
        setDisplayDate(new Date(simTimeRef.current));
        setPhase(snapshot.phase);
        setEclipseState(snapshot.eclipseState);
        const surface = surfaceRef.current;
        if (surface) {
          const coords = surfaceLatitudeLongitude(surface.pose);
          setSurfaceCoords({
            latitude: coords.latitudeRadians * 180 / Math.PI,
            longitude: coords.longitudeRadians * 180 / Math.PI,
          });
        }
      }

      renderer.render(scene, camera);
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('mousemove', onDocumentMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      delete (window as Window & {
        __moonPhaseSandboxReturnToSpace?: () => void;
        __moonPhaseSandboxResetCamera?: () => void;
        __moonPhaseSandboxSetDate?: (date: Date | string) => void;
      }).__moonPhaseSandboxReturnToSpace;
      delete (window as Window & {
        __moonPhaseSandboxReturnToSpace?: () => void;
        __moonPhaseSandboxResetCamera?: () => void;
        __moonPhaseSandboxSetDate?: (date: Date | string) => void;
      }).__moonPhaseSandboxResetCamera;
      delete (window as Window & {
        __moonPhaseSandboxReturnToSpace?: () => void;
        __moonPhaseSandboxResetCamera?: () => void;
        __moonPhaseSandboxSetDate?: (date: Date | string) => void;
      }).__moonPhaseSandboxSetDate;
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material?.dispose?.();
        }
      });
      mount.removeChild(renderer.domElement);
      objectsRef.current = null;
    };
  }, []);

  const setSimDate = (date: Date) => {
    const snapshot = getEarthMoonSunSnapshot(date);
    simTimeRef.current = date;
    setDisplayDate(date);
    setPhase(snapshot.phase);
    setEclipseState(snapshot.eclipseState);
  };

  const setPresetSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    setRunning(true);
  };

  const resetCamera = () => {
    (window as Window & { __moonPhaseSandboxResetCamera?: () => void })
      .__moonPhaseSandboxResetCamera?.();
  };

  const returnToSpace = () => {
    (window as Window & { __moonPhaseSandboxReturnToSpace?: () => void })
      .__moonPhaseSandboxReturnToSpace?.();
  };

  const locationLabel = surfaceBody
    ? `${BODY_CONFIG[surfaceBody].label} ${surfaceCoords.latitude.toFixed(1)} deg, ${surfaceCoords.longitude.toFixed(1)} deg`
    : mode === 'transition'
      ? 'Transition'
      : 'Space';

  const controlModeLabel = mode === 'surface'
    ? pointerLocked
      ? 'Mouse look'
      : 'Click for mouse look'
    : scaleMode;

  return (
    <div className={`moon-phase-sandbox ${mode === 'surface' ? 'is-surface' : ''}`}>
      <div ref={mountRef} className="moon-phase-canvas" aria-label="Earth Moon Sun 3D sandbox" />

      <header className="moon-hud moon-hud-primary">
        <div className="moon-title-block">
          <div className="moon-kicker">Earth Moon Sun</div>
          <h1>Moon Phase Sandbox</h1>
        </div>
        <div className="moon-readouts">
          <div>
            <span>Phase</span>
            <strong>{phase.phaseName}</strong>
          </div>
          <div>
            <span>Lit</span>
            <strong>{formatPercent(phase.illuminationFraction)}</strong>
          </div>
          <div>
            <span>View</span>
            <strong>{locationLabel}</strong>
          </div>
          {eclipseState && (
            <div className="moon-eclipse-readout">
              <span>Eclipse</span>
              <strong>{eclipseState.label}</strong>
            </div>
          )}
        </div>
      </header>

      <section className="moon-hud moon-time-panel" aria-label="Time controls">
        <div className="moon-date">
          <Clock size={16} aria-hidden="true" />
          <span>{hydrated ? toDisplayDate(displayDate) : 'Starting clock'}</span>
        </div>
        <div className="moon-control-row">
          <button
            type="button"
            className="moon-icon-button"
            onClick={() => setRunning((value) => !value)}
            aria-label={running ? 'Pause time' : 'Play time'}
            title={running ? 'Pause' : 'Play'}
          >
            {running ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="moon-icon-button"
            onClick={() => setSimDate(new Date(simTimeRef.current.getTime() - DAY_MS))}
            aria-label="Step back one day"
            title="-1 day"
          >
            <SkipBack size={18} />
          </button>
          <button
            type="button"
            className="moon-icon-button"
            onClick={() => setSimDate(new Date(simTimeRef.current.getTime() + DAY_MS))}
            aria-label="Step forward one day"
            title="+1 day"
          >
            <SkipForward size={18} />
          </button>
          <button
            type="button"
            className="moon-text-button"
            onClick={() => setSimDate(new Date())}
          >
            Now
          </button>
          <button
            type="button"
            className="moon-icon-button"
            onClick={resetCamera}
            aria-label="Reset camera"
            title="Reset camera"
          >
            <RotateCcw size={18} />
          </button>
          {surfaceBody && (
            <button
              type="button"
              className="moon-text-button"
              onClick={returnToSpace}
            >
              Space
            </button>
          )}
        </div>

        <div className="moon-speed">
          <Gauge size={16} aria-hidden="true" />
          <input
            type="range"
            min="-5"
            max="5"
            step="0.02"
            value={sliderValueForSpeed(speed)}
            aria-label="Time speed"
            onChange={(event) => {
              setSpeed(speedFromLogSlider(Number(event.currentTarget.value)));
              setRunning(true);
            }}
          />
          <output>{speedLabel}</output>
        </div>

        <div className="moon-presets" aria-label="Speed presets">
          {TIME_SPEED_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={Math.abs(preset - speed) < 0.001 ? 'is-active' : ''}
              onClick={() => setPresetSpeed(preset)}
            >
              {formatSpeedLabel(preset)}
            </button>
          ))}
        </div>
      </section>

      <section className="moon-hud moon-view-panel" aria-label="View controls">
        <div className="moon-segmented">
          <button
            type="button"
            aria-pressed={scaleMode === 'compact'}
            onClick={() => setScaleMode('compact')}
          >
            Compact
          </button>
          <button
            type="button"
            aria-pressed={scaleMode === 'true'}
            onClick={() => setScaleMode('true')}
          >
            True distance
          </button>
        </div>
        <label className="moon-toggle">
          <input
            type="checkbox"
            checked={labelsVisible}
            onChange={(event) => setLabelsVisible(event.currentTarget.checked)}
          />
          <span>Labels</span>
        </label>
        <div className="moon-location-pill">
          <LocateFixed size={15} aria-hidden="true" />
          <span>{mode === 'surface' ? controlModeLabel : scaleMode}</span>
        </div>
      </section>
    </div>
  );
}
