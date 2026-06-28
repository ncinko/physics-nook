import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  Gauge,
  Info,
  LocateFixed,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import * as THREE from 'three';

import {
  DAY_MS,
  BRIGHT_STAR_CATALOG,
  SOLAR_ORBIT_SAMPLE_COUNT,
  SOLAR_SYSTEM_BODY_IDS,
  SOLAR_SYSTEM_BODIES,
  SOLAR_SYSTEM_BODY_LIST,
  TIME_SPEED_PRESETS,
  advanceSimulationTime,
  applySpaceRoll,
  applySpaceTranslation,
  applySurfaceLookDrag,
  canUseClickForDescent,
  celestialDirectionFromRaDec,
  clampCameraPitch,
  createSurfacePose,
  formatSpeedLabel,
  getCameraBasis,
  getSolarSystemBodyScenePosition,
  getSolarSystemOrbitScenePoints,
  getSolarSystemSnapshot,
  getSurfaceViewFrame,
  greatCircleDistanceRadians,
  headingDegreesForSurfacePose,
  isSolarSystemBodyLandable,
  moveSurfacePose,
  normalizeCompassDegrees,
  bearingOffsetToSurfaceTarget,
  solarSystemSceneDistanceForKilometers,
  speedFromLogSlider,
  starVisualStyle,
  surfaceLatitudeLongitude,
  type CameraMode,
  type SolarSystemBodyId,
  type SolarSystemScaleMode,
  type SolarSystemSnapshot,
  type SpaceLookState,
  type SurfacePose,
  type Vec3,
} from '../../lib/astronomy/index.ts';
import './solarSystemExplorer.css';

type ScaleMode = SolarSystemScaleMode;
type SceneStatus = 'initializing' | 'ready' | 'unavailable';
type AtmosphereMesh = THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

interface SceneObjects {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  starField: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  bodyGroups: Record<SolarSystemBodyId, THREE.Group>;
  bodyMeshes: Record<SolarSystemBodyId, THREE.Mesh>;
  atmospheres: Partial<Record<SolarSystemBodyId, AtmosphereMesh>>;
  orbitLines: Partial<Record<SolarSystemBodyId, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>>;
  labels: Record<SolarSystemBodyId, THREE.Sprite>;
  northPoleGroup: THREE.Group;
  southPoleGroup: THREE.Group;
  homeMarkerGroup: THREE.Group;
  sunLight: THREE.PointLight;
}

interface SurfaceState {
  body: SolarSystemBodyId;
  pose: SurfacePose;
  pitch: number;
}

interface TransitionState {
  startTime: number;
  duration: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  fromUp: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toUp: THREE.Vector3;
  onComplete: () => void;
}

interface BodyReadout {
  name: string;
  distance: string;
  orbit: string;
  spin: string;
  landing: string;
}

interface CompassMarker {
  id: string;
  label: string;
  shortLabel: string;
  offsetDegrees: number;
  kind: 'cardinal' | 'pole' | 'home';
}

interface SurfaceCompassState {
  headingDegrees: number;
  markers: CompassMarker[];
}

interface SurfaceInfoReadout {
  body: string;
  controls: string;
  latitude: string;
  longitude: string;
  landmark: string;
}

type TutorialMode = 'space' | 'surface';
type TutorialInput =
  | 'space-look'
  | 'space-forward'
  | 'space-strafe'
  | 'space-vertical'
  | 'space-roll'
  | 'space-land'
  | 'surface-look'
  | 'surface-walk'
  | 'surface-strafe'
  | 'surface-fast'
  | 'surface-return';

interface TutorialStep {
  input: TutorialInput;
  title: string;
  prompt: string;
  hint: string;
}

interface TutorialState {
  mode: TutorialMode;
  stepIndex: number;
  status: 'prompting' | 'advancing';
}

const INITIAL_SIM_DATE = new Date('2000-01-01T12:00:00.000Z');
const SNAPSHOT_UPDATE_MS = 260;
const UI_SYNC_MS = 180;
const SPACE_LOOK_SENSITIVITY = 0.0036;
const SPACE_KEY_LOOK_SPEED = Math.PI * 0.36;
const SPACE_ROLL_SPEED = Math.PI * 0.55;
const SURFACE_LOOK_SENSITIVITY = 0.0024;
const STAR_FIELD_RADIUS = 4600;
const WORLD_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const ACTIVE_SOLAR_SCALE_MODE: ScaleMode = 'true';
const DEFAULT_SOLAR_BODY: SolarSystemBodyId = 'sun';
const POLE_COMPASS_VISIBLE_RADIANS = 0.52;
const COMPASS_DISPLAY_DEGREES = 110;
const IP_LOCATION_ENDPOINT = '/api/ip-location';
const IP_LOCATION_TIMEOUT_MS = 4200;
const TUTORIAL_ADVANCE_DELAY_MS = 620;
const TUTORIAL_STORAGE_KEYS: Record<TutorialMode, string> = {
  space: 'physics-nook:solar-system:tutorial:space',
  surface: 'physics-nook:solar-system:tutorial:surface',
};

const SPACE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    input: 'space-look',
    title: 'Look around',
    prompt: 'Drag the scene or press the arrow keys to aim the camera.',
    hint: 'Drag / Arrow keys',
  },
  {
    input: 'space-forward',
    title: 'Fly forward and back',
    prompt: 'Press W or S to move along your view direction.',
    hint: 'W / S',
  },
  {
    input: 'space-strafe',
    title: 'Slide sideways',
    prompt: 'Press A or D to strafe left and right.',
    hint: 'A / D',
  },
  {
    input: 'space-vertical',
    title: 'Change height',
    prompt: 'Press Space to rise, or Shift+Space to move down.',
    hint: 'Space / Shift+Space',
  },
  {
    input: 'space-roll',
    title: 'Roll the camera',
    prompt: 'Press Q or E to roll around the view axis.',
    hint: 'Q / E',
  },
  {
    input: 'space-land',
    title: 'Enter surface view',
    prompt: 'Click a solid world to land on the surface.',
    hint: 'Click a body',
  },
];

const SURFACE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    input: 'surface-look',
    title: 'Look around',
    prompt: 'Drag the surface view to turn your head.',
    hint: 'Mouse or touch drag',
  },
  {
    input: 'surface-walk',
    title: 'Walk',
    prompt: 'Press W or S to walk forward and back.',
    hint: 'W / S',
  },
  {
    input: 'surface-strafe',
    title: 'Sidestep',
    prompt: 'Press A or D to sidestep.',
    hint: 'A / D',
  },
  {
    input: 'surface-fast',
    title: 'Move faster',
    prompt: 'Press Shift to use the faster movement mode.',
    hint: 'Shift',
  },
  {
    input: 'surface-return',
    title: 'Return to space',
    prompt: 'Use the Space button or press Space to leave surface view.',
    hint: 'Space button / Space',
  },
];

const vectorFromPlain = (vector: Vec3) =>
  new THREE.Vector3(vector.x, vector.y, vector.z);

const plainFromVector = (vector: THREE.Vector3): Vec3 => ({
  x: vector.x,
  y: vector.y,
  z: vector.z,
});

const keyed = (keys: Set<string>, ...values: string[]) =>
  values.some((value) => keys.has(value));

const keyName = (event: KeyboardEvent) =>
  event.code === 'Space' || event.key === ' ' ? 'space' : event.key.toLowerCase();

const normalizedAxisInput = (forward: number, right: number, up = 0) => {
  const magnitude = Math.hypot(forward, right, up);
  if (magnitude === 0) return { forward: 0, right: 0, up: 0 };
  return {
    forward: forward / magnitude,
    right: right / magnitude,
    up: up / magnitude,
  };
};

const compassPositionPercent = (offsetDegrees: number) =>
  50 + (offsetDegrees / COMPASS_DISPLAY_DEGREES) * 50;

const toDisplayDate = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);

const sliderValueForSpeed = (speed: number) => {
  if (speed === 1) return 0;
  return Math.sign(speed) * Math.log10(Math.max(1, Math.abs(speed)));
};

const formatDistance = (kilometers: number) => {
  if (kilometers === 0) return 'Center';
  const au = kilometers / 149597870.69098932;
  if (au >= 0.1) return `${au.toFixed(au >= 10 ? 1 : 2)} AU`;
  if (kilometers >= 1_000_000) return `${(kilometers / 1_000_000).toFixed(1)} million km`;
  return `${Math.round(kilometers).toLocaleString()} km`;
};

const formatPeriod = (days: number | null) => {
  if (days === null) return 'Center';
  if (days < 2) return `${(days * 24).toFixed(1)} hours`;
  if (days < 365) return `${days.toFixed(days < 100 ? 1 : 0)} days`;
  return `${(days / 365.25).toFixed(1)} years`;
};

const formatRotation = (hours: number | null) => {
  if (hours === null) return 'Unknown';
  const absolute = Math.abs(hours);
  const suffix = hours < 0 ? ' retrograde' : '';
  if (absolute < 48) return `${absolute.toFixed(absolute < 12 ? 1 : 0)} hours${suffix}`;
  return `${(absolute / 24).toFixed(1)} days${suffix}`;
};

const getBodyReadout = (
  snapshot: SolarSystemSnapshot,
  bodyId: SolarSystemBodyId,
): BodyReadout => {
  const body = snapshot.bodyMap[bodyId];
  const parent = body.definition.parentId
    ? SOLAR_SYSTEM_BODIES[body.definition.parentId].label
    : 'Sun';
  const distance = bodyId === 'sun'
    ? 'Center of model'
    : `${formatDistance(body.distanceFromParentKm)} from ${parent}`;

  return {
    name: body.definition.label,
    distance,
    orbit: formatPeriod(body.definition.orbitalPeriodDays),
    spin: formatRotation(body.definition.rotationPeriodHours),
    landing: body.definition.landable ? 'Surface available' : 'Space only',
  };
};

const formatDegrees = (value: number, positiveSuffix: string, negativeSuffix: string) => {
  if (Math.abs(value) < 0.05) return '0.0 deg';
  return `${Math.abs(value).toFixed(1)} deg ${value >= 0 ? positiveSuffix : negativeSuffix}`;
};

const numberFromLocationField = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readIpLocationCoordinates = (data: unknown) => {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const latitude = numberFromLocationField(record.latitude ?? record.lat);
  const longitude = numberFromLocationField(record.longitude ?? record.lon);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
};

const createEarthHomeSurface = (latitudeDegrees: number, longitudeDegrees: number): SurfaceState => {
  const latitude = latitudeDegrees * Math.PI / 180;
  const longitude = -longitudeDegrees * Math.PI / 180;
  return {
    body: 'earth',
    pose: createSurfacePose(SOLAR_SYSTEM_BODIES.earth.sceneRadius, latitude, longitude, 0),
    pitch: 0.02,
  };
};

const polePose = (bodyId: SolarSystemBodyId, hemisphere: 'north' | 'south') =>
  createSurfacePose(
    SOLAR_SYSTEM_BODIES[bodyId].sceneRadius,
    hemisphere === 'north' ? Math.PI / 2 : -Math.PI / 2,
    0,
    0,
  );

const getSurfaceCompassState = (
  surface: SurfaceState,
  homeSurface: SurfaceState | null,
): SurfaceCompassState => {
  const headingDegrees = headingDegreesForSurfacePose(surface.pose);
  const cardinalMarkers: CompassMarker[] = [
    { id: 'north', label: 'North', shortLabel: 'N', offsetDegrees: normalizeCompassDegrees(0 - headingDegrees), kind: 'cardinal' },
    { id: 'east', label: 'East', shortLabel: 'E', offsetDegrees: normalizeCompassDegrees(90 - headingDegrees), kind: 'cardinal' },
    { id: 'south', label: 'South', shortLabel: 'S', offsetDegrees: normalizeCompassDegrees(180 - headingDegrees), kind: 'cardinal' },
    { id: 'west', label: 'West', shortLabel: 'W', offsetDegrees: normalizeCompassDegrees(270 - headingDegrees), kind: 'cardinal' },
  ];
  const poleTargets = [
    { id: 'north-pole', label: 'North pole', shortLabel: 'N pole', up: polePose(surface.body, 'north').up },
    { id: 'south-pole', label: 'South pole', shortLabel: 'S pole', up: polePose(surface.body, 'south').up },
  ];
  const poleMarkers = poleTargets
    .filter((target) => greatCircleDistanceRadians(surface.pose.up, target.up) <= POLE_COMPASS_VISIBLE_RADIANS)
    .map((target): CompassMarker => ({
      id: target.id,
      label: target.label,
      shortLabel: target.shortLabel,
      offsetDegrees: normalizeCompassDegrees(bearingOffsetToSurfaceTarget(surface.pose, target.up)),
      kind: 'pole',
    }));
  const homeMarker = surface.body === 'earth' && homeSurface?.body === 'earth'
    ? [{
      id: 'home',
      label: 'Home',
      shortLabel: 'Home',
      offsetDegrees: normalizeCompassDegrees(bearingOffsetToSurfaceTarget(surface.pose, homeSurface.pose.up)),
      kind: 'home' as const,
    }]
    : [];

  return {
    headingDegrees,
    markers: [...cardinalMarkers, ...poleMarkers, ...homeMarker],
  };
};

const getInitialRuntimeDate = () => {
  if (typeof window === 'undefined') return new Date();
  const requestedDate = new URLSearchParams(window.location.search).get('date');
  if (!requestedDate) return new Date();
  const parsedDate = new Date(requestedDate);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
};

const createSolarSystemRenderer = () => {
  try {
    return {
      renderer: new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }),
      lowResource: false,
    };
  } catch {
    return {
      renderer: new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'default',
      }),
      lowResource: true,
    };
  }
};

const disposeSceneGraph = (scene: THREE.Scene | null) => {
  if (!scene) return;

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
};

const removeRendererCanvas = (
  renderer: THREE.WebGLRenderer | null,
  mount: HTMLDivElement,
) => {
  const canvas = renderer?.domElement;
  if (canvas?.parentElement === mount) {
    mount.removeChild(canvas);
    return;
  }

  mount.querySelectorAll('canvas').forEach((candidate) => {
    if (candidate.parentElement === mount) {
      mount.removeChild(candidate);
    }
  });
};

const createStarField = () => {
  const catalogStars = BRIGHT_STAR_CATALOG.map((star) => {
    const style = starVisualStyle(star);
    return {
      direction: celestialDirectionFromRaDec(star.raHours, star.decDegrees),
      color: style.color,
      size: style.size * 1.08,
      alpha: style.alpha,
    };
  });
  const count = catalogStars.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  catalogStars.forEach((star, index) => {
    const direction = vectorFromPlain(star.direction).normalize();
    positions[index * 3] = direction.x * STAR_FIELD_RADIUS;
    positions[index * 3 + 1] = direction.y * STAR_FIELD_RADIUS;
    positions[index * 3 + 2] = direction.z * STAR_FIELD_RADIUS;
    colors[index * 3] = star.color.x;
    colors[index * 3 + 1] = star.color.y;
    colors[index * 3 + 2] = star.color.z;
    sizes[index] = star.size;
    alphas[index] = star.alpha;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float size;
      attribute float alpha;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered) * 2.0;
        if (radius > 1.0) discard;
        float core = 1.0 - smoothstep(0.12, 1.0, radius);
        float glow = pow(max(0.0, 1.0 - radius), 2.2);
        gl_FragColor = vec4(vColor, vAlpha * max(core, glow * 0.72));
      }
    `,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  material.toneMapped = false;

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -30;
  return points;
};

const createLabelSprite = (text: string) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const width = 320;
  const height = 96;
  canvas.width = width;
  canvas.height = height;

  if (context) {
    context.clearRect(0, 0, width, height);
    context.font = '700 34px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0, 0, 0, 0.85)';
    context.shadowBlur = 10;
    context.fillStyle = 'rgba(248, 250, 252, 0.96)';
    context.fillText(text, width / 2, height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  }));
  sprite.scale.set(19, 5.7, 1);
  sprite.renderOrder = 10;
  return sprite;
};

const createOrbitLine = (color: number) => {
  const positions = new Float32Array(SOLAR_ORBIT_SAMPLE_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
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

const createPoleMarkerGroup = (hemisphere: 'north' | 'south') => {
  const group = new THREE.Group();
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.42,
    metalness: 0.03,
  });
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: hemisphere === 'north' ? 0x60a5fa : 0xf97316,
    roughness: 0.52,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.58,
  });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.52, 12), poleMaterial);
  shaft.position.y = 0.26;
  group.add(shaft);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.035, 20), darkMaterial);
  base.position.y = 0.017;
  group.add(base);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), stripeMaterial);
  cap.position.y = 0.54;
  group.add(cap);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.092, 0.012),
    stripeMaterial,
  );
  flag.position.set(0.085, 0.435, -0.004);
  group.add(flag);

  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 8), darkMaterial);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.y = 0.485;
  group.add(crossbar);

  group.visible = false;
  return group;
};

const createHomeMarkerGroup = () => {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0x4a3005,
    emissiveIntensity: 0.08,
    roughness: 0.5,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xfef3c7,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.62,
  });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 12), postMaterial);
  post.position.y = 0.17;
  group.add(post);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.08, 4), postMaterial);
  roof.position.y = 0.375;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.024, 18), darkMaterial);
  base.position.y = 0.012;
  group.add(base);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.004, 8, 42), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.018;
  group.add(ring);

  group.visible = false;
  return group;
};

const placeSurfaceGroup = (
  group: THREE.Group,
  bodyGroup: THREE.Group,
  pose: SurfacePose,
  radius: number,
  height: number,
  scale: number,
) => {
  const localUp = vectorFromPlain(pose.up).normalize();
  const localForward = vectorFromPlain(pose.forward).normalize();
  const localRight = vectorFromPlain(pose.right).normalize();
  const worldUp = localUp.clone().applyQuaternion(bodyGroup.quaternion).normalize();
  const worldForward = localForward.clone().applyQuaternion(bodyGroup.quaternion).normalize();
  const worldRight = localRight.clone().applyQuaternion(bodyGroup.quaternion).normalize();
  const worldBackward = worldForward.clone().multiplyScalar(-1);
  const rotation = new THREE.Matrix4().makeBasis(worldRight, worldUp, worldBackward);
  const localPosition = localUp.multiplyScalar(radius + height);

  group.position.copy(localPosition.applyQuaternion(bodyGroup.quaternion).add(bodyGroup.position));
  group.quaternion.setFromRotationMatrix(rotation);
  group.scale.setScalar(scale);
  group.visible = true;
};

const setSurfaceLandmarksHidden = (objects: SceneObjects) => {
  objects.northPoleGroup.visible = false;
  objects.southPoleGroup.visible = false;
  objects.homeMarkerGroup.visible = false;
};

const updateSurfaceLandmarks = (
  objects: SceneObjects,
  surface: SurfaceState,
  homeSurface: SurfaceState | null,
) => {
  const definition = SOLAR_SYSTEM_BODIES[surface.body];
  const bodyGroup = objects.bodyGroups[surface.body];
  const eyeHeight = Math.max(definition.sceneRadius * 0.016, 0.035);
  const markerScale = Math.max(eyeHeight * 5.8, definition.sceneRadius * 0.04);

  placeSurfaceGroup(
    objects.northPoleGroup,
    bodyGroup,
    polePose(surface.body, 'north'),
    definition.sceneRadius,
    eyeHeight * 0.04,
    markerScale,
  );
  placeSurfaceGroup(
    objects.southPoleGroup,
    bodyGroup,
    polePose(surface.body, 'south'),
    definition.sceneRadius,
    eyeHeight * 0.04,
    markerScale,
  );

  if (surface.body === 'earth' && homeSurface?.body === 'earth') {
    placeSurfaceGroup(
      objects.homeMarkerGroup,
      bodyGroup,
      homeSurface.pose,
      definition.sceneRadius,
      eyeHeight * 0.045,
      Math.max(eyeHeight * 4.2, definition.sceneRadius * 0.032),
    );
  } else {
    objects.homeMarkerGroup.visible = false;
  }
};

const addRings = (group: THREE.Group, bodyId: SolarSystemBodyId) => {
  const definition = SOLAR_SYSTEM_BODIES[bodyId];
  if (!definition.hasRings) return;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(definition.sceneRadius * 1.28, definition.sceneRadius * 2.14, 160),
    new THREE.MeshStandardMaterial({
      color: bodyId === 'saturn' ? 0xf8e7b0 : 0xb8f3ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: bodyId === 'saturn' ? 0.46 : 0.24,
      roughness: 0.78,
      metalness: 0,
      depthWrite: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.rotation.z = bodyId === 'uranus' ? Math.PI * 0.42 : Math.PI * 0.08;
  group.add(ring);
};

const createSunlitAtmosphere = (radius: number, color: number, maxOpacity: number): AtmosphereMesh => {
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.035, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        atmosphereColor: { value: new THREE.Color(color) },
        maxOpacity: { value: maxOpacity },
        sunDirectionLocal: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vNormal;

        void main() {
          vNormal = normalize(normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 atmosphereColor;
        uniform float maxOpacity;
        uniform vec3 sunDirectionLocal;
        varying vec3 vNormal;

        void main() {
          float daylight = smoothstep(-0.04, 0.28, dot(normalize(vNormal), normalize(sunDirectionLocal)));
          float alpha = maxOpacity * daylight;
          if (alpha <= 0.004) discard;
          gl_FragColor = vec4(atmosphereColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmosphere.renderOrder = 2;
  return atmosphere;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  amount: number,
): [number, number, number] => [
  mix(a[0], b[0], amount),
  mix(a[1], b[1], amount),
  mix(a[2], b[2], amount),
];

const noise2d = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 41.371) * 43758.5453123;
  return value - Math.floor(value);
};

const smoothNoise = (x: number, y: number, seed: number) => {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const easeX = localX * localX * (3 - 2 * localX);
  const easeY = localY * localY * (3 - 2 * localY);
  const top = mix(noise2d(cellX, cellY, seed), noise2d(cellX + 1, cellY, seed), easeX);
  const bottom = mix(noise2d(cellX, cellY + 1, seed), noise2d(cellX + 1, cellY + 1, seed), easeX);
  return mix(top, bottom, easeY);
};

const fractalNoise = (u: number, v: number, seed: number) => {
  let total = 0;
  let amplitude = 0.56;
  let frequency = 3.2;
  let normalizer = 0;

  for (let octave = 0; octave < 5; octave += 1) {
    total += smoothNoise(u * frequency, v * frequency, seed + octave * 11.7) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.52;
    frequency *= 2.05;
  }

  return total / normalizer;
};

const writePixel = (
  data: Uint8ClampedArray,
  index: number,
  color: [number, number, number],
) => {
  data[index] = clampByte(color[0]);
  data[index + 1] = clampByte(color[1]);
  data[index + 2] = clampByte(color[2]);
  data[index + 3] = 255;
};

const applyTextureSettings = (
  texture: THREE.Texture,
  anisotropy: number,
) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
};

const createProceduralPlanetTexture = (
  bodyId: SolarSystemBodyId,
  anisotropy: number,
) => {
  const canvas = document.createElement('canvas');
  const width = bodyId === 'jupiter' || bodyId === 'saturn' ? 1024 : 768;
  const height = width / 2;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return applyTextureSettings(new THREE.CanvasTexture(canvas), anisotropy);
  }

  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    const latitude = (v - 0.5) * Math.PI;
    const pole = Math.abs(v - 0.5) * 2;

    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const seed = SOLAR_SYSTEM_BODY_IDS.indexOf(bodyId) + 1;
      const fine = fractalNoise(u + Math.sin(latitude) * 0.04, v, seed);
      const bandNoise = fractalNoise(u * 0.62 + v * 0.18, v * 1.8, seed + 19);
      let color: [number, number, number];

      if (bodyId === 'mercury') {
        color = mixRgb([82, 78, 73], [196, 187, 175], fine * 0.78 + 0.08);
        color = mixRgb(color, [55, 53, 50], Math.max(0, bandNoise - 0.72) * 1.6);
      } else if (bodyId === 'venus') {
        const swirl = Math.sin(u * Math.PI * 8 + v * Math.PI * 5 + fine * 3.4) * 0.5 + 0.5;
        color = mixRgb([174, 120, 51], [255, 218, 143], 0.48 + swirl * 0.34);
        color = mixRgb(color, [255, 239, 187], Math.max(0, fine - 0.58) * 0.65);
      } else if (bodyId === 'mars') {
        color = mixRgb([101, 47, 35], [218, 111, 66], fine * 0.86);
        color = mixRgb(color, [58, 48, 42], Math.max(0, bandNoise - 0.66) * 1.15);
        if (pole > 0.86) color = mixRgb(color, [241, 231, 210], (pole - 0.86) / 0.14);
      } else if (bodyId === 'jupiter') {
        const bands = Math.sin(v * Math.PI * 24 + fine * 1.7) * 0.5 + 0.5;
        color = mixRgb([139, 84, 58], [249, 223, 184], bands * 0.72 + 0.16);
        color = mixRgb(color, [88, 55, 44], Math.max(0, bandNoise - 0.72) * 0.9);
      } else if (bodyId === 'saturn') {
        const bands = Math.sin(v * Math.PI * 18 + fine) * 0.5 + 0.5;
        color = mixRgb([168, 130, 83], [255, 231, 179], bands * 0.62 + 0.22);
        color = mixRgb(color, [112, 91, 67], Math.max(0, bandNoise - 0.76) * 0.55);
      } else if (bodyId === 'uranus') {
        const bands = Math.sin(v * Math.PI * 8 + fine * 0.8) * 0.5 + 0.5;
        color = mixRgb([93, 177, 184], [198, 251, 255], 0.48 + bands * 0.22);
        color = mixRgb(color, [232, 255, 255], Math.max(0, pole - 0.62) * 0.18);
      } else if (bodyId === 'neptune') {
        const bands = Math.sin(v * Math.PI * 12 + fine * 2.1) * 0.5 + 0.5;
        color = mixRgb([19, 44, 137], [79, 133, 245], 0.44 + bands * 0.28);
        color = mixRgb(color, [157, 194, 255], Math.max(0, fine - 0.72) * 0.5);
      } else if (bodyId === 'pluto') {
        color = mixRgb([105, 78, 64], [226, 199, 169], fine * 0.76 + 0.1);
        color = mixRgb(color, [232, 226, 211], Math.max(0, pole - 0.7) * 0.42);
      } else {
        const base = new THREE.Color(SOLAR_SYSTEM_BODIES[bodyId].color);
        color = [
          base.r * 255 * (0.75 + fine * 0.34),
          base.g * 255 * (0.75 + fine * 0.34),
          base.b * 255 * (0.75 + fine * 0.34),
        ];
      }

      const shade = 0.9 + fine * 0.16 - pole * 0.04;
      writePixel(image.data, (y * width + x) * 4, [
        color[0] * shade,
        color[1] * shade,
        color[2] * shade,
      ]);
    }
  }

  context.putImageData(image, 0, 0);
  if (bodyId === 'jupiter') {
    context.fillStyle = 'rgba(190, 72, 42, 0.76)';
    context.beginPath();
    context.ellipse(width * 0.67, height * 0.58, width * 0.085, height * 0.038, -0.12, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(255, 226, 184, 0.58)';
    context.lineWidth = Math.max(2, width * 0.004);
    context.stroke();
  } else if (bodyId === 'neptune') {
    context.fillStyle = 'rgba(12, 25, 92, 0.54)';
    context.beginPath();
    context.ellipse(width * 0.62, height * 0.43, width * 0.048, height * 0.024, 0.18, 0, Math.PI * 2);
    context.fill();
  } else if (bodyId === 'pluto') {
    context.fillStyle = 'rgba(235, 219, 203, 0.72)';
    context.beginPath();
    context.ellipse(width * 0.48, height * 0.42, width * 0.095, height * 0.07, -0.22, 0, Math.PI * 2);
    context.fill();
  }

  return applyTextureSettings(new THREE.CanvasTexture(canvas), anisotropy);
};

const createProceduralSolarTextures = (anisotropy: number) => {
  const bodyTextures = {} as Partial<Record<SolarSystemBodyId, THREE.Texture>>;
  SOLAR_SYSTEM_BODY_IDS.forEach((bodyId) => {
    if (bodyId === 'sun' || bodyId === 'earth' || bodyId === 'moon') return;
    bodyTextures[bodyId] = createProceduralPlanetTexture(bodyId, anisotropy);
  });
  return bodyTextures;
};

const createSolarBody = (
  bodyId: SolarSystemBodyId,
  textures: {
    earthTexture: THREE.Texture;
    moonTexture: THREE.Texture;
    moonBump: THREE.Texture;
    bodyTextures: Partial<Record<SolarSystemBodyId, THREE.Texture>>;
  },
) => {
  const definition = SOLAR_SYSTEM_BODIES[bodyId];
  const group = new THREE.Group();
  let atmosphere: AtmosphereMesh | undefined;
  let material: THREE.Material;

  if (bodyId === 'sun') {
    material = new THREE.MeshBasicMaterial({ color: definition.color, toneMapped: false });
  } else if (bodyId === 'earth') {
    material = new THREE.MeshStandardMaterial({
      map: textures.earthTexture,
      roughness: 0.78,
      metalness: 0,
    });
  } else if (bodyId === 'moon') {
    material = new THREE.MeshStandardMaterial({
      map: textures.moonTexture,
      bumpMap: textures.moonBump,
      bumpScale: 0.035,
      roughness: 0.94,
      metalness: 0,
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      map: textures.bodyTextures[bodyId],
      color: 0xffffff,
      roughness: bodyId === 'mercury' || bodyId === 'mars' || bodyId === 'pluto' ? 0.9 : 0.72,
      metalness: 0,
    });
  }

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      definition.sceneRadius,
      bodyId === 'sun' || definition.sceneRadius > 5 ? 96 : 72,
      bodyId === 'sun' || definition.sceneRadius > 5 ? 48 : 36,
    ),
    material,
  );
  mesh.castShadow = bodyId !== 'sun';
  mesh.receiveShadow = bodyId !== 'sun';
  mesh.userData.body = bodyId;
  group.add(mesh);

  if (definition.hasAtmosphere) {
    atmosphere = createSunlitAtmosphere(
      definition.sceneRadius,
      bodyId === 'earth' ? 0x67c7ff : 0xffca7b,
      bodyId === 'earth' ? 0.16 : 0.22,
    );
    group.add(atmosphere);
  }

  addRings(group, bodyId);

  return { group, mesh, atmosphere };
};

const setSpaceCameraFromLookAt = (
  position: THREE.Vector3,
  target: THREE.Vector3,
  state: SpaceLookState,
) => {
  const direction = target.clone().sub(position).normalize();
  state.yaw = Math.atan2(direction.x, -direction.z);
  state.pitch = clampCameraPitch(Math.asin(Math.max(-1, Math.min(1, direction.y))));
  state.roll = 0;
};

const applySpaceCameraLook = (
  camera: THREE.PerspectiveCamera,
  state: SpaceLookState,
) => {
  const basis = getCameraBasis(state.yaw, state.pitch, state.roll);
  const lookTarget = camera.position.clone().add(vectorFromPlain(basis.forward));
  camera.up.copy(vectorFromPlain(basis.up));
  camera.lookAt(lookTarget);
};

const spaceLookStateFromBasis = (
  forward: THREE.Vector3,
  up: THREE.Vector3,
  fallback: SpaceLookState,
): SpaceLookState => {
  const nextForward = forward.clone().normalize();
  if (nextForward.lengthSq() < 1e-8) return fallback;

  const yaw = Math.atan2(nextForward.x, -nextForward.z);
  const pitch = clampCameraPitch(Math.asin(Math.max(-1, Math.min(1, nextForward.y))));
  const unrolledRight = new THREE.Vector3().crossVectors(nextForward, WORLD_CAMERA_UP);
  if (unrolledRight.lengthSq() < 1e-8) {
    return { yaw, pitch, roll: fallback.roll };
  }

  unrolledRight.normalize();
  const unrolledUp = new THREE.Vector3().crossVectors(unrolledRight, nextForward).normalize();
  const desiredUp = up.clone().sub(nextForward.clone().multiplyScalar(up.dot(nextForward)));
  if (desiredUp.lengthSq() < 1e-8) {
    return { yaw, pitch, roll: fallback.roll };
  }
  desiredUp.normalize();

  return {
    yaw,
    pitch,
    roll: Math.atan2(
      new THREE.Vector3().crossVectors(unrolledUp, desiredUp).dot(nextForward),
      unrolledUp.dot(desiredUp),
    ),
  };
};

const applySpaceLocalLook = (
  state: SpaceLookState,
  yawDelta: number,
  pitchDelta: number,
): SpaceLookState => {
  if (yawDelta === 0 && pitchDelta === 0) return state;

  const basis = getCameraBasis(state.yaw, state.pitch, state.roll);
  const forward = vectorFromPlain(basis.forward);
  const right = vectorFromPlain(basis.right);
  const up = vectorFromPlain(basis.up);

  if (yawDelta !== 0) {
    forward.applyAxisAngle(up, -yawDelta).normalize();
    right.applyAxisAngle(up, -yawDelta).normalize();
  }
  if (pitchDelta !== 0) {
    forward.applyAxisAngle(right, pitchDelta).normalize();
    up.applyAxisAngle(right, pitchDelta).normalize();
  }

  return spaceLookStateFromBasis(forward, up, state);
};

const getBodyScenePosition = (
  snapshot: SolarSystemSnapshot,
  bodyId: SolarSystemBodyId,
  scaleMode: ScaleMode,
) => vectorFromPlain(
  getSolarSystemBodyScenePosition(snapshot.bodyMap[bodyId], snapshot, scaleMode),
);

const getSpaceFocusView = (
  snapshot: SolarSystemSnapshot,
  bodyId: SolarSystemBodyId,
  scaleMode: ScaleMode,
) => {
  const body = snapshot.bodyMap[bodyId];
  const target = getBodyScenePosition(snapshot, bodyId, scaleMode);

  if (bodyId === 'sun') {
    return {
      position: new THREE.Vector3(0, 74, 185),
      target,
    };
  }

  const parentId = body.definition.parentId;
  const childOffset = parentId
    ? target.clone().sub(getBodyScenePosition(snapshot, parentId, scaleMode))
    : null;
  const radial = childOffset && childOffset.lengthSq() > 1e-8
    ? childOffset.normalize()
    : target.lengthSq() > 1e-8
      ? target.clone().normalize()
      : new THREE.Vector3(1, 0.3, 1).normalize();
  const side = new THREE.Vector3().crossVectors(radial, WORLD_CAMERA_UP);
  if (side.lengthSq() < 1e-8) {
    side.set(1, 0, 0);
  } else {
    side.normalize();
  }

  const focusDistance = Math.max(
    body.definition.sceneRadius * 8.4,
    parentId ? 18 : scaleMode === 'true' ? 70 : 52,
  );
  const lift = Math.max(
    body.definition.sceneRadius * 2.8,
    parentId ? 5 : scaleMode === 'true' ? 24 : 18,
  );
  const position = target.clone()
    .add(radial.multiplyScalar(focusDistance))
    .add(side.multiplyScalar(focusDistance * 0.34))
    .add(WORLD_CAMERA_UP.clone().multiplyScalar(lift));

  return { position, target };
};

const getSurfaceCameraVectors = (
  objects: SceneObjects,
  surface: SurfaceState,
) => {
  const definition = SOLAR_SYSTEM_BODIES[surface.body];
  const bodyGroup = objects.bodyGroups[surface.body];
  const bodyCenter = bodyGroup.position;
  const frame = getSurfaceViewFrame(surface.pose, surface.pitch);
  const eyeHeight = Math.max(definition.sceneRadius * 0.016, 0.035);
  const localEye = vectorFromPlain(frame.eyeUp).multiplyScalar(definition.sceneRadius + eyeHeight);

  const eye = localEye.applyQuaternion(bodyGroup.quaternion).add(bodyCenter);
  const lookDirection = vectorFromPlain(frame.lookDirection).applyQuaternion(bodyGroup.quaternion).normalize();
  const headUp = vectorFromPlain(frame.headUp).applyQuaternion(bodyGroup.quaternion).normalize();
  const target = eye.clone().add(lookDirection.multiplyScalar(definition.sceneRadius * 2));

  return {
    eye,
    target,
    headUp,
  };
};

const updateSolarSystemObjects = (
  objects: SceneObjects,
  snapshot: SolarSystemSnapshot,
  scaleMode: ScaleMode,
  labelsVisible: boolean,
  cameraMode: CameraMode,
) => {
  SOLAR_SYSTEM_BODY_IDS.forEach((bodyId) => {
    const body = snapshot.bodyMap[bodyId];
    const group = objects.bodyGroups[bodyId];
    const position = getBodyScenePosition(snapshot, bodyId, scaleMode);
    group.position.copy(position);
    group.rotation.y = body.rotationRadians;

    const atmosphere = objects.atmospheres[bodyId];
    if (atmosphere && position.lengthSq() > 1e-8) {
      const sunDirectionLocal = position
        .clone()
        .multiplyScalar(-1)
        .normalize()
        .applyQuaternion(group.quaternion.clone().invert())
        .normalize();
      atmosphere.material.uniforms.sunDirectionLocal.value.copy(sunDirectionLocal);
    }

    const label = objects.labels[bodyId];
    label.position.copy(position).add(new THREE.Vector3(
      0,
      body.definition.sceneRadius + (bodyId === 'sun' ? 13 : 5.5),
      0,
    ));
    label.visible = labelsVisible && cameraMode === 'space';

    const line = objects.orbitLines[bodyId];
    if (line) {
      const points = getSolarSystemOrbitScenePoints(body, scaleMode).map(vectorFromPlain);
      updateLinePositions(line, points);
      line.visible = labelsVisible && cameraMode === 'space';
    }
  });

  objects.sunLight.position.set(0, 0, 0);
};

const shouldIgnoreKeyTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, select, textarea, button'));
};

export default function SolarSystemExplorer() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const objectsRef = useRef<SceneObjects | null>(null);
  const requestRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(performance.now());
  const lastUiSyncRef = useRef<number>(0);
  const simTimeRef = useRef<Date>(INITIAL_SIM_DATE);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const scaleModeRef = useRef<ScaleMode>(ACTIVE_SOLAR_SCALE_MODE);
  const labelsVisibleRef = useRef(true);
  const selectedBodyRef = useRef<SolarSystemBodyId>(DEFAULT_SOLAR_BODY);
  const modeRef = useRef<CameraMode>('space');
  const surfaceRef = useRef<SurfaceState | null>(null);
  const homeSurfaceRef = useRef<SurfaceState | null>(null);
  const transitionRef = useRef<TransitionState | null>(null);
  const tutorialStateRef = useRef<TutorialState | null>(null);
  const tutorialAdvanceTimerRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const spaceCameraRef = useRef<SpaceLookState>({ yaw: 0, pitch: -0.16, roll: 0 });
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

  const initialSnapshot = useMemo(() => getSolarSystemSnapshot(INITIAL_SIM_DATE), []);
  const [hydrated, setHydrated] = useState(false);
  const [displayDate, setDisplayDate] = useState(() => simTimeRef.current);
  const [bodyReadout, setBodyReadout] = useState<BodyReadout>(() =>
    getBodyReadout(initialSnapshot, DEFAULT_SOLAR_BODY));
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scaleMode] = useState<ScaleMode>(ACTIVE_SOLAR_SCALE_MODE);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [timePanelOpen, setTimePanelOpen] = useState(false);
  const [readoutsVisible, setReadoutsVisible] = useState(false);
  const [mode, setMode] = useState<CameraMode>('space');
  const [selectedBody, setSelectedBody] = useState<SolarSystemBodyId>(DEFAULT_SOLAR_BODY);
  const [surfaceBody, setSurfaceBody] = useState<SolarSystemBodyId | null>(null);
  const [surfaceCoords, setSurfaceCoords] = useState({ latitude: 0, longitude: 0 });
  const [surfaceCompass, setSurfaceCompass] = useState<SurfaceCompassState | null>(null);
  const [tutorialState, setTutorialState] = useState<TutorialState | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('initializing');
  const [sceneFailureMessage, setSceneFailureMessage] = useState(
    'The 3D scene could not start on this machine.',
  );
  const [sceneRetryKey, setSceneRetryKey] = useState(0);

  const speedLabel = useMemo(() => formatSpeedLabel(speed), [speed]);

  const setSelectedBodySynced = (bodyId: SolarSystemBodyId) => {
    selectedBodyRef.current = bodyId;
    setSelectedBody(bodyId);
  };

  const setTutorialStateSynced = (nextTutorialState: TutorialState | null) => {
    tutorialStateRef.current = nextTutorialState;
    setTutorialState(nextTutorialState);
  };

  const clearTutorialAdvanceTimer = () => {
    if (tutorialAdvanceTimerRef.current === null) return;
    window.clearTimeout(tutorialAdvanceTimerRef.current);
    tutorialAdvanceTimerRef.current = null;
  };

  const tutorialStepsForMode = (tutorialMode: TutorialMode) =>
    tutorialMode === 'space' ? SPACE_TUTORIAL_STEPS : SURFACE_TUTORIAL_STEPS;

  const isTutorialComplete = (tutorialMode: TutorialMode) => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(TUTORIAL_STORAGE_KEYS[tutorialMode]) === 'done';
    } catch {
      return false;
    }
  };

  const markTutorialComplete = (tutorialMode: TutorialMode) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEYS[tutorialMode], 'done');
    } catch {
      // Local storage can be unavailable in stricter browser contexts.
    }
  };

  const dismissTutorial = () => {
    const activeTutorial = tutorialStateRef.current;
    if (activeTutorial) {
      markTutorialComplete(activeTutorial.mode);
    }
    clearTutorialAdvanceTimer();
    setTutorialStateSynced(null);
  };

  const recordTutorialInput = (input: TutorialInput) => {
    const activeTutorial = tutorialStateRef.current;
    if (!activeTutorial || activeTutorial.status !== 'prompting') return;

    const steps = tutorialStepsForMode(activeTutorial.mode);
    const step = steps[activeTutorial.stepIndex];
    if (step?.input !== input) return;

    const advancingState: TutorialState = {
      ...activeTutorial,
      status: 'advancing',
    };
    setTutorialStateSynced(advancingState);
    clearTutorialAdvanceTimer();
    tutorialAdvanceTimerRef.current = window.setTimeout(() => {
      tutorialAdvanceTimerRef.current = null;
      const latestTutorial = tutorialStateRef.current;
      if (
        !latestTutorial
        || latestTutorial.mode !== advancingState.mode
        || latestTutorial.stepIndex !== advancingState.stepIndex
      ) {
        return;
      }

      if (latestTutorial.stepIndex >= steps.length - 1) {
        markTutorialComplete(latestTutorial.mode);
        setTutorialStateSynced(null);
        return;
      }

      setTutorialStateSynced({
        mode: latestTutorial.mode,
        stepIndex: latestTutorial.stepIndex + 1,
        status: 'prompting',
      });
    }, TUTORIAL_ADVANCE_DELAY_MS);
  };

  useEffect(() => {
    const now = getInitialRuntimeDate();
    const snapshot = getSolarSystemSnapshot(now);
    simTimeRef.current = now;
    setDisplayDate(now);
    setBodyReadout(getBodyReadout(snapshot, selectedBodyRef.current));
    setHydrated(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), IP_LOCATION_TIMEOUT_MS);

    fetch(IP_LOCATION_ENDPOINT, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const coordinates = readIpLocationCoordinates(data);
        if (!coordinates) return;
        homeSurfaceRef.current = createEarthHomeSurface(
          coordinates.latitude,
          coordinates.longitude,
        );
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => () => {
    clearTutorialAdvanceTimer();
  }, []);

  useEffect(() => {
    if (sceneStatus !== 'ready' || (mode !== 'space' && mode !== 'surface')) return;

    const activeTutorial = tutorialStateRef.current;
    if (activeTutorial?.mode === mode) return;
    if (activeTutorial && activeTutorial.mode !== mode) {
      clearTutorialAdvanceTimer();
      setTutorialStateSynced(null);
    }
    if (isTutorialComplete(mode)) return;

    setTutorialStateSynced({
      mode,
      stepIndex: 0,
      status: 'prompting',
    });
  }, [mode, sceneStatus]);

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

    let startupScene: THREE.Scene | null = null;
    let startupRenderer: THREE.WebGLRenderer | null = null;
    let disposed = false;
    setSceneStatus('initializing');
    setSceneFailureMessage('The 3D scene could not start on this machine.');

    try {
      const scene = new THREE.Scene();
      startupScene = scene;
      let latestSnapshot = getSolarSystemSnapshot(simTimeRef.current);
      let lastSnapshotUpdate = 0;
      scene.background = new THREE.Color(0x02040b);

      const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 8200);
      scene.add(camera);

      const { renderer, lowResource } = createSolarSystemRenderer();
      startupRenderer = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowResource ? 1 : 1.5));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      mount.appendChild(renderer.domElement);

      const textureLoader = new THREE.TextureLoader();
      textureLoader.setCrossOrigin('anonymous');
      const earthTexture = textureLoader.load('/textures/astronomy/earth-blue-marble-july.jpg');
      earthTexture.colorSpace = THREE.SRGBColorSpace;
      earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const moonTexture = textureLoader.load('/textures/astronomy/moon-lroc-color-2k.jpg');
      moonTexture.colorSpace = THREE.SRGBColorSpace;
      moonTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const moonBump = textureLoader.load('/textures/astronomy/moon-ldem-1k.jpg');
      moonBump.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const bodyTextures = createProceduralSolarTextures(renderer.capabilities.getMaxAnisotropy());

      const starField = createStarField();
      scene.add(starField);
      scene.add(new THREE.AmbientLight(0x05070c, 0.035));

      const sunLight = new THREE.PointLight(0xffffff, 4.8, 0, 0);
      sunLight.position.set(0, 0, 0);
      scene.add(sunLight);

      const bodyGroups = {} as Record<SolarSystemBodyId, THREE.Group>;
      const bodyMeshes = {} as Record<SolarSystemBodyId, THREE.Mesh>;
      const atmospheres: Partial<Record<SolarSystemBodyId, AtmosphereMesh>> = {};
      const orbitLines: Partial<Record<SolarSystemBodyId, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>> = {};
      const labels = {} as Record<SolarSystemBodyId, THREE.Sprite>;

      SOLAR_SYSTEM_BODY_IDS.forEach((bodyId) => {
        const { group, mesh, atmosphere } = createSolarBody(bodyId, {
          earthTexture,
          moonTexture,
          moonBump,
          bodyTextures,
        });
        bodyGroups[bodyId] = group;
        bodyMeshes[bodyId] = mesh;
        if (atmosphere) {
          atmospheres[bodyId] = atmosphere;
        }
        scene.add(group);

        const label = createLabelSprite(SOLAR_SYSTEM_BODIES[bodyId].label);
        labels[bodyId] = label;
        scene.add(label);

        if (bodyId !== 'sun') {
          const line = createOrbitLine(
            bodyId === 'moon'
              ? 0xcbd5e1
              : SOLAR_SYSTEM_BODIES[bodyId].accentColor,
          );
          orbitLines[bodyId] = line;
          scene.add(line);
        }
      });

      const northPoleGroup = createPoleMarkerGroup('north');
      const southPoleGroup = createPoleMarkerGroup('south');
      const homeMarkerGroup = createHomeMarkerGroup();
      scene.add(northPoleGroup, southPoleGroup, homeMarkerGroup);

      const objects: SceneObjects = {
        scene,
        camera,
        renderer,
        starField,
        bodyGroups,
        bodyMeshes,
        atmospheres,
        orbitLines,
        labels,
        northPoleGroup,
        southPoleGroup,
        homeMarkerGroup,
        sunLight,
      };
      objectsRef.current = objects;

      const initialView = getSpaceFocusView(
        latestSnapshot,
        selectedBodyRef.current,
        scaleModeRef.current,
      );
      camera.position.copy(initialView.position);
      setSpaceCameraFromLookAt(camera.position, initialView.target, spaceCameraRef.current);
      applySpaceCameraLook(camera, spaceCameraRef.current);
      updateSolarSystemObjects(objects, latestSnapshot, scaleModeRef.current, labelsVisibleRef.current, modeRef.current);

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
          // Pointer lock is optional.
        }
      };

      const beginTransition = (
        toPosition: THREE.Vector3,
        toTarget: THREE.Vector3,
        onComplete: () => void,
        duration = 900,
        toUp = WORLD_CAMERA_UP,
      ) => {
        const currentDirection = new THREE.Vector3();
        camera.getWorldDirection(currentDirection);

        transitionRef.current = {
          startTime: performance.now(),
          duration,
          fromPosition: camera.position.clone(),
          fromTarget: camera.position.clone().add(currentDirection.multiplyScalar(50)),
          fromUp: camera.up.clone(),
          toPosition,
          toTarget,
          toUp: toUp.clone().normalize(),
          onComplete,
        };
        modeRef.current = 'transition';
        setMode('transition');
      };

      const focusBody = (bodyId: SolarSystemBodyId, duration = 850) => {
        setSelectedBodySynced(bodyId);
        setBodyReadout(getBodyReadout(latestSnapshot, bodyId));
        surfaceRef.current = null;
        setSurfaceBody(null);
        setSurfaceCompass(null);
        if (document.pointerLockElement === renderer.domElement) {
          document.exitPointerLock();
        }

        const view = getSpaceFocusView(latestSnapshot, bodyId, scaleModeRef.current);
        beginTransition(view.position, view.target, () => {
          modeRef.current = 'space';
          setMode('space');
          camera.up.copy(WORLD_CAMERA_UP);
          setSpaceCameraFromLookAt(camera.position, view.target, spaceCameraRef.current);
          applySpaceCameraLook(camera, spaceCameraRef.current);
        }, duration);
      };

      const enterSurface = (bodyId: SolarSystemBodyId, worldPoint: THREE.Vector3) => {
        if (!isSolarSystemBodyLandable(bodyId)) {
          focusBody(bodyId);
          return;
        }

        const definition = SOLAR_SYSTEM_BODIES[bodyId];
        const bodyGroup = bodyGroups[bodyId];
        const localPoint = bodyGroup.worldToLocal(worldPoint.clone()).normalize();
        const latitude = Math.asin(Math.max(-1, Math.min(1, localPoint.y)));
        const longitude = Math.atan2(localPoint.z, localPoint.x);
        const pose = createSurfacePose(definition.sceneRadius, latitude, longitude, 0);
        const surface: SurfaceState = {
          body: bodyId,
          pose,
          pitch: bodyId === 'earth' ? 0.02 : 0.06,
        };
        const { eye, target, headUp } = getSurfaceCameraVectors(objects, surface);
        setSelectedBodySynced(bodyId);
        surfaceRef.current = surface;
        setSurfaceBody(bodyId);
        setSurfaceCompass(getSurfaceCompassState(surface, homeSurfaceRef.current));
        requestPointerLock();
        beginTransition(eye, target, () => {
          modeRef.current = 'surface';
          setMode('surface');
        }, 950, headUp);
      };

      const returnToSpace = () => {
        const returnBody = surfaceRef.current?.body ?? selectedBodyRef.current;
        focusBody(returnBody, 850);
      };

      const resetCamera = () => {
        focusBody(selectedBodyRef.current, 700);
      };

      const releaseCanvasPointer = (pointerId: number) => {
        if (renderer.domElement.hasPointerCapture?.(pointerId)) {
          renderer.domElement.releasePointerCapture(pointerId);
        }
      };

      const onPointerDown = (event: PointerEvent) => {
        if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

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

        if (modeRef.current === 'surface') {
          requestPointerLock();
          event.preventDefault();
          return;
        }

        if (modeRef.current !== 'space') {
          pointerRef.current.down = false;
          releaseCanvasPointer(event.pointerId);
        }
      };

      const onPointerMove = (event: PointerEvent) => {
        const pointerState = pointerRef.current;
        if (!pointerState.down || pointerState.pointerId !== event.pointerId) return;

        const dx = event.clientX - pointerState.lastX;
        const dy = event.clientY - pointerState.lastY;
        pointerState.lastX = event.clientX;
        pointerState.lastY = event.clientY;

        if (Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY) > 5) {
          pointerState.moved = true;
        }

        event.preventDefault();
        if (modeRef.current === 'surface') {
          if (!pointerLockedRef.current && surfaceRef.current) {
            if (Math.hypot(dx, dy) > 1) {
              recordTutorialInput('surface-look');
            }
            const nextSurfaceLook = applySurfaceLookDrag(
              surfaceRef.current,
              dx,
              dy,
              SURFACE_LOOK_SENSITIVITY,
            );
            surfaceRef.current.pose = nextSurfaceLook.pose;
            surfaceRef.current.pitch = nextSurfaceLook.pitch;
          }
          return;
        }

        if (modeRef.current !== 'space') return;

        if (Math.hypot(dx, dy) > 1) {
          recordTutorialInput('space-look');
        }
        spaceCameraRef.current = applySpaceLocalLook(
          spaceCameraRef.current,
          dx * SPACE_LOOK_SENSITIVITY,
          -dy * SPACE_LOOK_SENSITIVITY,
        );
        applySpaceCameraLook(camera, spaceCameraRef.current);
      };

      const onPointerUp = (event: PointerEvent) => {
        const pointerState = pointerRef.current;
        if (pointerState.pointerId !== event.pointerId) return;

        pointerState.down = false;
        releaseCanvasPointer(event.pointerId);

        if (modeRef.current === 'surface') return;
        if (!canUseClickForDescent(modeRef.current, pointerState.moved)) return;

        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        const hit = raycaster.intersectObjects(Object.values(bodyMeshes), false)[0];
        const bodyId = hit?.object.userData.body as SolarSystemBodyId | undefined;
        if (!bodyId) return;

        setSelectedBodySynced(bodyId);
        setBodyReadout(getBodyReadout(latestSnapshot, bodyId));
        if (isSolarSystemBodyLandable(bodyId)) {
          recordTutorialInput('space-land');
          enterSurface(bodyId, hit.point);
        } else {
          focusBody(bodyId);
        }
      };

      const onPointerCancel = (event: PointerEvent) => {
        if (pointerRef.current.pointerId !== event.pointerId) return;
        pointerRef.current.down = false;
        releaseCanvasPointer(event.pointerId);
      };

      const onDocumentMouseMove = (event: MouseEvent) => {
        if (!pointerLockedRef.current || modeRef.current !== 'surface' || !surfaceRef.current) return;

        if (Math.hypot(event.movementX, event.movementY) > 1) {
          recordTutorialInput('surface-look');
        }
        const nextSurfaceLook = applySurfaceLookDrag(
          surfaceRef.current,
          event.movementX,
          event.movementY,
          SURFACE_LOOK_SENSITIVITY,
        );
        surfaceRef.current.pose = nextSurfaceLook.pose;
        surfaceRef.current.pitch = nextSurfaceLook.pitch;
      };

      const onPointerLockChange = () => {
        const locked = document.pointerLockElement === renderer.domElement;
        pointerLockedRef.current = locked;
        setPointerLocked(locked);
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (shouldIgnoreKeyTarget(event.target)) return;
        const key = keyName(event);
        if (
          ['space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
          || event.code === 'Space'
        ) {
          event.preventDefault();
        }
        if (modeRef.current === 'surface' && key === 'space') {
          recordTutorialInput('surface-return');
          returnToSpace();
          return;
        }
        if (modeRef.current === 'space') {
          if (key === 'w' || key === 's') {
            recordTutorialInput('space-forward');
          } else if (key === 'a' || key === 'd') {
            recordTutorialInput('space-strafe');
          } else if (key === 'space') {
            recordTutorialInput('space-vertical');
          } else if (key === 'q' || key === 'e') {
            recordTutorialInput('space-roll');
          } else if (key.startsWith('arrow')) {
            recordTutorialInput('space-look');
          }
        } else if (modeRef.current === 'surface') {
          if (key === 'shift') {
            recordTutorialInput('surface-fast');
          } else if (key === 'w' || key === 's' || key === 'arrowup' || key === 'arrowdown') {
            recordTutorialInput('surface-walk');
          } else if (key === 'a' || key === 'd' || key === 'arrowleft' || key === 'arrowright') {
            recordTutorialInput('surface-strafe');
          }
        }
        keysRef.current.add(key);
      };

      const onKeyUp = (event: KeyboardEvent) => {
        keysRef.current.delete(keyName(event));
      };

      (window as Window & {
        __solarSystemExplorerReturnToSpace?: () => void;
        __solarSystemExplorerResetCamera?: () => void;
        __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void;
        __solarSystemExplorerSetDate?: (date: Date | string) => void;
      }).__solarSystemExplorerReturnToSpace = returnToSpace;
      (window as Window & {
        __solarSystemExplorerReturnToSpace?: () => void;
        __solarSystemExplorerResetCamera?: () => void;
        __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void;
        __solarSystemExplorerSetDate?: (date: Date | string) => void;
      }).__solarSystemExplorerResetCamera = resetCamera;
      (window as Window & {
        __solarSystemExplorerReturnToSpace?: () => void;
        __solarSystemExplorerResetCamera?: () => void;
        __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void;
        __solarSystemExplorerSetDate?: (date: Date | string) => void;
      }).__solarSystemExplorerFocusBody = focusBody;
      (window as Window & {
        __solarSystemExplorerReturnToSpace?: () => void;
        __solarSystemExplorerResetCamera?: () => void;
        __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void;
        __solarSystemExplorerSetDate?: (date: Date | string) => void;
      }).__solarSystemExplorerSetDate = (date: Date | string) => {
        const nextDate = typeof date === 'string' ? new Date(date) : date;
        simTimeRef.current = nextDate;
        latestSnapshot = getSolarSystemSnapshot(nextDate);
        updateSolarSystemObjects(objects, latestSnapshot, scaleModeRef.current, labelsVisibleRef.current, modeRef.current);
        setDisplayDate(new Date(nextDate));
        setBodyReadout(getBodyReadout(latestSnapshot, selectedBodyRef.current));
      };

      const animate = (now: number) => {
        if (disposed) return;

        const elapsed = Math.min(64, now - lastFrameRef.current);
        lastFrameRef.current = now;
        simTimeRef.current = advanceSimulationTime(
          simTimeRef.current,
          elapsed,
          speedRef.current,
          runningRef.current,
        );

        if (now - lastSnapshotUpdate > SNAPSHOT_UPDATE_MS) {
          latestSnapshot = getSolarSystemSnapshot(simTimeRef.current);
          lastSnapshotUpdate = now;
        }

        updateSolarSystemObjects(objects, latestSnapshot, scaleModeRef.current, labelsVisibleRef.current, modeRef.current);
        starField.position.copy(camera.position);

        const transition = transitionRef.current;
        if (transition) {
          const amount = Math.min(1, (now - transition.startTime) / transition.duration);
          const eased = amount < 0.5
            ? 4 * amount * amount * amount
            : 1 - Math.pow(-2 * amount + 2, 3) / 2;
          const transitionTarget = new THREE.Vector3();
          const transitionUp = new THREE.Vector3();
          camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
          transitionTarget.lerpVectors(transition.fromTarget, transition.toTarget, eased);
          transitionUp.lerpVectors(transition.fromUp, transition.toUp, eased);
          camera.up.copy(transitionUp.lengthSq() > 1e-8 ? transitionUp.normalize() : WORLD_CAMERA_UP);
          camera.lookAt(transitionTarget);
          if (amount >= 1) {
            transitionRef.current = null;
            transition.onComplete();
          }
        } else if (modeRef.current === 'surface' && surfaceRef.current) {
          const surface = surfaceRef.current;
          const definition = SOLAR_SYSTEM_BODIES[surface.body];
          const keys = keysRef.current;
          const forwardRaw = Number(keyed(keys, 'w', 'arrowup')) - Number(keyed(keys, 's', 'arrowdown'));
          const rightRaw = Number(keyed(keys, 'd', 'arrowright')) - Number(keyed(keys, 'a', 'arrowleft'));
          const input = normalizedAxisInput(forwardRaw, rightRaw);
          const speedBoost = keys.has('shift') ? 3.6 : 1;
          const walkSpeed = Math.max(definition.sceneRadius * 0.16, 0.16);
          const distanceScale = walkSpeed * speedBoost * (elapsed / 1000);

          if (input.forward !== 0 || input.right !== 0) {
            surface.pose = moveSurfacePose(surface.pose, definition.sceneRadius, {
              forwardDistance: input.forward * distanceScale,
              rightDistance: input.right * distanceScale,
            });
          }

          const { eye, target, headUp } = getSurfaceCameraVectors(objects, surface);
          camera.position.copy(eye);
          camera.up.copy(headUp);
          camera.lookAt(target);
        } else if (modeRef.current === 'space') {
          const keys = keysRef.current;
          const forwardRaw = Number(keyed(keys, 'w')) - Number(keyed(keys, 's'));
          const rightRaw = Number(keyed(keys, 'd')) - Number(keyed(keys, 'a'));
          const upRaw = keys.has('space') ? keys.has('shift') ? -1 : 1 : 0;
          const yawRaw = Number(keys.has('arrowright')) - Number(keys.has('arrowleft'));
          const pitchRaw = Number(keys.has('arrowup')) - Number(keys.has('arrowdown'));
          const rollRaw = Number(keys.has('e')) - Number(keys.has('q'));
          const input = normalizedAxisInput(forwardRaw, rightRaw, upRaw);
          const speedBoost = keys.has('shift') && !keys.has('space') ? 4 : 1;
          const baseSpeed = 150;
          const distance = baseSpeed * speedBoost * (elapsed / 1000);
          const lookDistance = SPACE_KEY_LOOK_SPEED * (elapsed / 1000);

          if (yawRaw !== 0 || pitchRaw !== 0) {
            spaceCameraRef.current = applySpaceLocalLook(
              spaceCameraRef.current,
              yawRaw * lookDistance,
              pitchRaw * lookDistance,
            );
          }

          if (rollRaw !== 0) {
            spaceCameraRef.current = applySpaceRoll(
              spaceCameraRef.current,
              rollRaw * SPACE_ROLL_SPEED * (elapsed / 1000),
            );
          }

          if (input.forward !== 0 || input.right !== 0 || input.up !== 0) {
            const basis = getCameraBasis(
              spaceCameraRef.current.yaw,
              spaceCameraRef.current.pitch,
              spaceCameraRef.current.roll,
            );
            camera.position.copy(vectorFromPlain(applySpaceTranslation(
              plainFromVector(camera.position),
              basis,
              input,
              distance,
            )));
          }

          applySpaceCameraLook(camera, spaceCameraRef.current);
        }

        if (modeRef.current === 'surface' && surfaceRef.current) {
          updateSurfaceLandmarks(objects, surfaceRef.current, homeSurfaceRef.current);
        } else {
          setSurfaceLandmarksHidden(objects);
        }

        if (now - lastUiSyncRef.current > UI_SYNC_MS) {
          const activeSurface = surfaceRef.current;
          setDisplayDate(new Date(simTimeRef.current));
          setBodyReadout(getBodyReadout(latestSnapshot, selectedBodyRef.current));
          if (activeSurface) {
            const coordinates = surfaceLatitudeLongitude(activeSurface.pose);
            const longitudeRadians = activeSurface.body === 'earth'
              ? -coordinates.longitudeRadians
              : coordinates.longitudeRadians;
            setSurfaceCoords({
              latitude: coordinates.latitudeRadians * 180 / Math.PI,
              longitude: longitudeRadians * 180 / Math.PI,
            });
            setSurfaceCompass(getSurfaceCompassState(activeSurface, homeSurfaceRef.current));
          } else {
            setSurfaceCompass(null);
          }
          lastUiSyncRef.current = now;
        }

        renderer.render(scene, camera);
        requestRef.current = window.requestAnimationFrame(animate);
      };

      window.addEventListener('resize', resize);
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('pointercancel', onPointerCancel);
      document.addEventListener('mousemove', onDocumentMouseMove);
      document.addEventListener('pointerlockchange', onPointerLockChange);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);

      setSceneStatus('ready');
      requestRef.current = window.requestAnimationFrame(animate);

      return () => {
        disposed = true;
        if (requestRef.current !== null) {
          window.cancelAnimationFrame(requestRef.current);
          requestRef.current = null;
        }
        window.removeEventListener('resize', resize);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('mousemove', onDocumentMouseMove);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        if (document.pointerLockElement === renderer.domElement) {
          document.exitPointerLock();
        }
        const windowWithHooks = window as Window & {
          __solarSystemExplorerReturnToSpace?: () => void;
          __solarSystemExplorerResetCamera?: () => void;
          __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void;
          __solarSystemExplorerSetDate?: (date: Date | string) => void;
        };
        delete windowWithHooks.__solarSystemExplorerReturnToSpace;
        delete windowWithHooks.__solarSystemExplorerResetCamera;
        delete windowWithHooks.__solarSystemExplorerFocusBody;
        delete windowWithHooks.__solarSystemExplorerSetDate;
        objectsRef.current = null;
        removeRendererCanvas(renderer, mount);
        Object.values(bodyTextures).forEach((texture) => texture?.dispose());
        earthTexture.dispose();
        moonTexture.dispose();
        moonBump.dispose();
        renderer.dispose();
        disposeSceneGraph(scene);
      };
    } catch (error) {
      disposed = true;
      removeRendererCanvas(startupRenderer, mount);
      startupRenderer?.dispose();
      disposeSceneGraph(startupScene);
      setSceneFailureMessage(error instanceof Error ? error.message : 'The 3D scene could not start on this machine.');
      setSceneStatus('unavailable');
      return undefined;
    }
  }, [sceneRetryKey]);

  const setSimDate = (date: Date) => {
    simTimeRef.current = date;
    setDisplayDate(date);
    (window as Window & { __solarSystemExplorerSetDate?: (date: Date | string) => void })
      .__solarSystemExplorerSetDate?.(date);
  };

  const setPresetSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    setRunning(true);
  };

  const focusBody = (bodyId: SolarSystemBodyId) => {
    setSelectedBodySynced(bodyId);
    (window as Window & { __solarSystemExplorerFocusBody?: (bodyId: SolarSystemBodyId) => void })
      .__solarSystemExplorerFocusBody?.(bodyId);
  };

  const resetCamera = () => {
    (window as Window & { __solarSystemExplorerResetCamera?: () => void })
      .__solarSystemExplorerResetCamera?.();
  };

  const returnToSpace = () => {
    (window as Window & { __solarSystemExplorerReturnToSpace?: () => void })
      .__solarSystemExplorerReturnToSpace?.();
  };

  const locationLabel = surfaceBody
    ? `${SOLAR_SYSTEM_BODIES[surfaceBody].label} ${surfaceCoords.latitude.toFixed(1)} deg, ${surfaceCoords.longitude.toFixed(1)} deg`
    : mode === 'transition'
      ? 'Transition'
      : `${SOLAR_SYSTEM_BODIES[selectedBody].label} space`;
  const controlModeLabel = mode === 'surface'
    ? pointerLocked ? 'Mouse look' : 'Drag to look'
    : 'True distance';
  const visibleCompassMarkers = surfaceCompass?.markers.filter(
    (marker) => Math.abs(marker.offsetDegrees) <= COMPASS_DISPLAY_DEGREES,
  ) ?? [];
  const surfaceInfoReadout: SurfaceInfoReadout | null = surfaceBody
    ? {
      body: SOLAR_SYSTEM_BODIES[surfaceBody].label,
      controls: controlModeLabel,
      latitude: formatDegrees(surfaceCoords.latitude, 'N', 'S'),
      longitude: formatDegrees(surfaceCoords.longitude, 'E', 'W'),
      landmark: surfaceCompass?.markers
        .filter((marker) => marker.kind !== 'cardinal')
        .map((marker) => marker.label)
        .join(' / ') || 'Poles marked',
    }
    : null;
  const selectedDistanceSceneUnits = solarSystemSceneDistanceForKilometers(
    getSolarSystemSnapshot(displayDate, 8).bodyMap[selectedBody].distanceFromSunKm,
    scaleMode,
  );
  const sceneUnavailable = sceneStatus === 'unavailable';
  const activeTutorialSteps = tutorialState
    ? tutorialStepsForMode(tutorialState.mode)
    : [];
  const activeTutorialStep = tutorialState
    ? activeTutorialSteps[tutorialState.stepIndex] ?? null
    : null;

  const releaseHudButtonFocus = (event: SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.solar-hud button')) return;
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.matches('button') && activeElement.closest('.solar-hud')) {
        activeElement.blur();
      }
    }, 0);
  };

  return (
    <div
      className={[
        'solar-system-explorer',
        mode === 'surface' ? 'is-surface' : '',
        sceneUnavailable ? 'is-scene-unavailable' : '',
        sceneStatus === 'initializing' ? 'is-scene-initializing' : '',
        timePanelOpen ? 'has-time-panel-open' : 'has-time-panel-collapsed',
        tutorialState ? 'has-tutorial' : '',
      ].filter(Boolean).join(' ')}
      onClickCapture={releaseHudButtonFocus}
    >
      <div ref={mountRef} className="solar-canvas" aria-label="Solar system 3D explorer" />

      {sceneUnavailable && (
        <section className="solar-hud solar-scene-fallback" aria-live="polite">
          <div>
            <span>3D scene unavailable</span>
            <strong>{sceneFailureMessage}</strong>
          </div>
          <button
            type="button"
            className="solar-text-button"
            onClick={() => setSceneRetryKey((value) => value + 1)}
          >
            Retry
          </button>
        </section>
      )}

      {activeTutorialStep && tutorialState && (
        <section
          className={`solar-hud solar-tutorial ${tutorialState.status === 'advancing' ? 'is-advancing' : ''}`}
          aria-live="polite"
          aria-label={`${tutorialState.mode} camera tutorial`}
        >
          <div className="solar-tutorial-header">
            <span>
              {tutorialState.mode === 'space' ? 'Space controls' : 'Surface controls'}
              {' '}
              {tutorialState.stepIndex + 1}/{activeTutorialSteps.length}
            </span>
            <button
              type="button"
              className="solar-icon-button solar-tutorial-close"
              onClick={dismissTutorial}
              aria-label="Close tutorial"
              title="Close tutorial"
            >
              <X size={16} />
            </button>
          </div>
          <div className="solar-tutorial-body">
            <strong>{activeTutorialStep.title}</strong>
            <p>{activeTutorialStep.prompt}</p>
            <kbd>{activeTutorialStep.hint}</kbd>
          </div>
        </section>
      )}

      {readoutsVisible ? (
        <header className="solar-hud solar-hud-primary" aria-label="Solar system information">
          <div className="solar-readouts">
            {surfaceInfoReadout ? (
              <>
                <div>
                  <span>Body</span>
                  <strong>{surfaceInfoReadout.body}</strong>
                </div>
                <div>
                  <span>Controls</span>
                  <strong>{surfaceInfoReadout.controls}</strong>
                </div>
                <div>
                  <span>Latitude</span>
                  <strong>{surfaceInfoReadout.latitude}</strong>
                </div>
                <div>
                  <span>Longitude</span>
                  <strong>{surfaceInfoReadout.longitude}</strong>
                </div>
                <div className="solar-readout-wide">
                  <span>Landmarks</span>
                  <strong>{surfaceInfoReadout.landmark}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Body</span>
                  <strong>{bodyReadout.name}</strong>
                </div>
                <div>
                  <span>Mode</span>
                  <strong>{bodyReadout.landing}</strong>
                </div>
                <div className="solar-readout-wide">
                  <span>Distance</span>
                  <strong>{bodyReadout.distance}</strong>
                </div>
                <div>
                  <span>Orbit</span>
                  <strong>{bodyReadout.orbit}</strong>
                </div>
                <div>
                  <span>Spin</span>
                  <strong>{bodyReadout.spin}</strong>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className="solar-icon-button solar-panel-action"
            onClick={() => setReadoutsVisible(false)}
            aria-label="Hide information"
            title="Hide info"
          >
            <EyeOff size={17} />
          </button>
        </header>
      ) : (
        <button
          type="button"
          className="solar-hud solar-icon-button solar-info-toggle"
          onClick={() => setReadoutsVisible(true)}
          aria-label="Show information"
          title="Show info"
        >
          <Info size={17} />
        </button>
      )}

      <section className="solar-hud solar-body-panel" aria-label="Body focus">
        <select
          value={selectedBody}
          onChange={(event) => {
            const select = event.currentTarget;
            focusBody(select.value as SolarSystemBodyId);
            window.setTimeout(() => select.blur(), 0);
          }}
          aria-label="Focused body"
        >
          {SOLAR_SYSTEM_BODY_LIST.map((body) => (
            <option key={body.id} value={body.id}>
              {body.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="solar-text-button"
          onClick={() => focusBody(selectedBody)}
        >
          Focus
        </button>
      </section>

      <section
        className={`solar-hud solar-time-panel ${timePanelOpen ? 'is-open' : 'is-collapsed'}`}
        aria-label="Time controls"
      >
        <div className="solar-time-header">
          <div className="solar-date">
            <span>{hydrated ? toDisplayDate(displayDate) : 'Starting clock'}</span>
          </div>
          <button
            type="button"
            className="solar-icon-button solar-panel-action"
            onClick={() => setTimePanelOpen((value) => !value)}
            aria-expanded={timePanelOpen}
            aria-label={timePanelOpen ? 'Collapse time controls' : 'Expand time controls'}
            title={timePanelOpen ? 'Collapse time controls' : 'Expand time controls'}
          >
            {timePanelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>

        {timePanelOpen && (
          <>
            <div className="solar-control-row">
              <button
                type="button"
                className="solar-icon-button"
                onClick={() => setRunning((value) => !value)}
                aria-label={running ? 'Pause time' : 'Play time'}
                title={running ? 'Pause' : 'Play'}
              >
                {running ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button
                type="button"
                className="solar-icon-button"
                onClick={() => setSimDate(new Date(simTimeRef.current.getTime() - DAY_MS))}
                aria-label="Step back one day"
                title="-1 day"
              >
                <SkipBack size={18} />
              </button>
              <button
                type="button"
                className="solar-icon-button"
                onClick={() => setSimDate(new Date(simTimeRef.current.getTime() + DAY_MS))}
                aria-label="Step forward one day"
                title="+1 day"
              >
                <SkipForward size={18} />
              </button>
              <button
                type="button"
                className="solar-text-button"
                onClick={() => setSimDate(new Date())}
              >
                Now
              </button>
              <button
                type="button"
                className="solar-icon-button"
                onClick={resetCamera}
                aria-label="Reset camera"
                title="Reset camera"
              >
                <RotateCcw size={18} />
              </button>
            </div>

            <div className="solar-speed">
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

            <div className="solar-presets" aria-label="Speed presets">
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
          </>
        )}
      </section>

      {mode === 'surface' && surfaceCompass && (
        <section
          className="solar-hud solar-surface-compass"
          aria-label={`Surface compass heading ${Math.round(surfaceCompass.headingDegrees)} degrees`}
        >
          <div className="solar-compass-bar">
            <span className="solar-compass-center" aria-hidden="true" />
            {visibleCompassMarkers.map((marker) => (
              <span
                key={marker.id}
                className={`solar-compass-marker is-${marker.kind}`}
                style={{ left: `${compassPositionPercent(marker.offsetDegrees)}%` }}
                title={marker.label}
              >
                {marker.shortLabel}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="solar-hud solar-view-panel" aria-label="View controls">
        <div className="solar-segmented" aria-label="Scale">
          <button
            type="button"
            aria-pressed="true"
            disabled
          >
            True distance
          </button>
        </div>
        <label className="solar-toggle">
          <input
            type="checkbox"
            checked={labelsVisible}
            onChange={(event) => setLabelsVisible(event.currentTarget.checked)}
          />
          <span>Labels</span>
        </label>
        {surfaceBody && (
          <button
            type="button"
            className="solar-text-button solar-space-button"
            onClick={() => {
              recordTutorialInput('surface-return');
              returnToSpace();
            }}
          >
            Space
          </button>
        )}
        <div className="solar-location-pill" title={`${Math.round(selectedDistanceSceneUnits)} scene units from center`}>
          <LocateFixed size={15} aria-hidden="true" />
          <span>{mode === 'surface' ? controlModeLabel : locationLabel}</span>
        </div>
      </section>
    </div>
  );
}
