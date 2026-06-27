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
  EARTH_RADIUS_KM,
  MEAN_MOON_DISTANCE_KM,
  MOON_PATH_SAMPLE_COUNT,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  BINARY_PATH_SAMPLE_COUNT,
  TIME_SPEED_PRESETS,
  advanceSimulationTime,
  applySpaceLookDrag,
  applySpaceRoll,
  applySpaceTranslation,
  applySurfaceLookDrag,
  buildLiveEarthWmsUrl,
  canUseClickForDescent,
  clampCameraPitch,
  compositeLiveEarthLayers,
  createSurfacePose,
  formatSpeedLabel,
  getBinarySystemSnapshot,
  getCameraBasis,
  getEarthMoonSunSnapshot,
  getSurfaceSkyBodies,
  getSurfaceSkyState,
  getSurfaceViewFrame,
  getSunRenderMode,
  isAlienCaught,
  LIVE_EARTH_TEXTURE_HEIGHT,
  LIVE_EARTH_TEXTURE_WIDTH,
  liveEarthTextureKey,
  moveAlienTowardPose,
  moveSurfacePose,
  nextAlienWorldMode,
  spawnAlienFarFromPlayer,
  apparentAngularRadiusRadians,
  resolveLiveEarthLayers,
  scaleBinaryScenePosition,
  skyProxyRadiusForAngularSize,
  speedFromLogSlider,
  surfaceDirectionVisibility,
  surfaceLatitudeLongitude,
  validLiveEarthCompositeLayerKeys,
  BRIGHT_STAR_CATALOG,
  celestialDirectionFromRaDec,
  starVisualStyle,
  type AlienWorldMode,
  type AstronomyScaleMode,
  type BinarySystemSnapshot,
  type CameraMode,
  type EclipseState,
  type MoonPhaseSummary,
  type ResolvedLiveEarthLayer,
  type SpaceLookState,
  type SurfacePose,
  type SurfaceSkyBodySnapshot,
  type Vec3,
} from '../../lib/astronomy/index.ts';
import './moonPhaseSandbox.css';

type WorldMode = AlienWorldMode;
type BodyId = 'earth' | 'moon' | 'binaryMoon';
type ScaleMode = AstronomyScaleMode;
type LabelId = 'earth' | 'moon' | 'sun' | 'path' | 'eclipse';
type BinaryLabelId = 'primaryStar' | 'secondaryStar' | 'planet' | 'binaryMoon' | 'planetPath' | 'moonPath';
type SceneStatus = 'initializing' | 'ready' | 'unavailable';

interface SceneObjects {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  starField: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  earthGroup: THREE.Group;
  moonGroup: THREE.Group;
  binaryGroup: THREE.Group;
  binaryPrimaryStar: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  binarySecondaryStar: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  binaryPlanetGroup: THREE.Group;
  binaryMoonGroup: THREE.Group;
  binaryPlanetMesh: THREE.Mesh;
  binaryMoonMesh: THREE.Mesh;
  earthMesh: THREE.Mesh;
  earthNightOverlay: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  moonMesh: THREE.Mesh;
  sunMesh: THREE.Mesh;
  infiniteSunDisk: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sunLight: THREE.DirectionalLight;
  binaryPrimaryLight: THREE.DirectionalLight;
  binarySecondaryLight: THREE.DirectionalLight;
  earthAtmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  surfaceMoonProxy: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  surfaceEarthProxy: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  surfaceSunProxy: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  binaryPrimaryProxy: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  binarySecondaryProxy: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  moonPathLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  binaryPlanetPathLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  binaryMoonPathLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  eclipseLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lunarEclipseTint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  alienGroup: THREE.Group;
  northPoleGroup: THREE.Group;
  southPoleGroup: THREE.Group;
  homeMarkerGroup: THREE.Group;
  penguinFamilyGroup: THREE.Group;
  labels: Record<LabelId, THREE.Sprite>;
  binaryLabels: Record<BinaryLabelId, THREE.Sprite>;
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
  fromUp: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toUp: THREE.Vector3;
  onComplete: () => void;
}

interface AlienState {
  worldMode: WorldMode;
  pose: SurfacePose;
  anchorPose: SurfacePose;
  status: 'idle' | 'caught';
  bobSeed: number;
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

interface CompassMarker {
  id: string;
  label: string;
  shortLabel: string;
  offsetDegrees: number;
  kind: 'cardinal' | 'pole' | 'home' | 'alien';
}

interface SurfaceCompassState {
  headingDegrees: number;
  markers: CompassMarker[];
}

const EARTH_SCENE_RADIUS = 9.5;
const MOON_SCENE_RADIUS = EARTH_SCENE_RADIUS * (MOON_RADIUS_KM / EARTH_RADIUS_KM);
const BINARY_MOON_SCENE_RADIUS = 2.35;
const EARTH_ATMOSPHERE_RADIUS = EARTH_SCENE_RADIUS * 1.035;
const COMPACT_MOON_DISTANCE = EARTH_SCENE_RADIUS * 11.6;
const SPACE_CAMERA_POSITION = new THREE.Vector3(38, 92, 240);
const BINARY_SPACE_CAMERA_POSITION = new THREE.Vector3(42, 48, 150);
const INITIAL_SIM_DATE = new Date('2000-01-01T12:00:00.000Z');
const SNAPSHOT_UPDATE_MS = 180;
const UI_SYNC_MS = 220;
const SPACE_LOOK_SENSITIVITY = 0.0036;
const SPACE_KEY_LOOK_SPEED = Math.PI * 0.36;
const SPACE_ROLL_SPEED = Math.PI * 0.55;
const SURFACE_LOOK_SENSITIVITY = 0.0024;
const SURFACE_SKY_BODY_DISTANCE = 420;
const ALIEN_CATCH_DISTANCE_RATIO = 0.075;
const ALIEN_RESPAWN_SEED = 0.74;
const ALIEN_SCALE_EYE_HEIGHT_RATIO = 1.95;
const ALIEN_IDLE_SPEED_RATIO = 0.24;
const COMPACT_SUN_DISTANCE = 260;
const INFINITE_SUN_DISTANCE = 1200;
const INFINITE_SUN_HALO_SCALE = 7;
const STAR_FIELD_RADIUS = 1800;
const LIVE_EARTH_TEXTURE_CACHE_LIMIT = 8;
const STAR_OCCLUSION_FEATHER_RADIANS = 0.005;
const STAR_HORIZON_FEATHER = 0.026;
const WORLD_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const SPACE_CAMERA_LIFT = 32;
const TRUE_DISTANCE_SPACE_CAMERA_LIFT = 96;
const SPACE_CAMERA_SIDE_OFFSET = 22;
const TRUE_DISTANCE_SPACE_CAMERA_SIDE_OFFSET = 75;
const POLE_COMPASS_VISIBLE_RADIANS = 0.52;
const ALIEN_COMPASS_VISIBLE_RADIANS = 0.65;
const COMPASS_DISPLAY_DEGREES = 110;
const IP_LOCATION_ENDPOINT = '/api/ip-location';
const IP_LOCATION_TIMEOUT_MS = 4200;
const TUTORIAL_ADVANCE_DELAY_MS = 620;
const TUTORIAL_STORAGE_KEYS: Record<TutorialMode, string> = {
  space: 'physics-nook:moon-phases:tutorial:space',
  surface: 'physics-nook:moon-phases:tutorial:surface',
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
    prompt: 'Click Earth or the Moon to land on the surface.',
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
    prompt: 'Use the Space button to leave surface view.',
    hint: 'Space button',
  },
];

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
  binaryMoon: {
    label: 'Binary moon',
    radius: BINARY_MOON_SCENE_RADIUS,
    eyeHeight: BINARY_MOON_SCENE_RADIUS * 0.016,
    walkSpeed: BINARY_MOON_SCENE_RADIUS * 0.16,
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

const normalizeDegrees = (degrees: number) => {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
};

const compassPositionPercent = (offsetDegrees: number) =>
  50 + (offsetDegrees / COMPASS_DISPLAY_DEGREES) * 50;

const seededUnit = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const createProceduralStarEntries = () => {
  const count = 620;
  return Array.from({ length: count }, (_, index) => ({
    direction: {
      x: Math.cos(seededUnit(index, 2) * Math.PI * 2) * Math.sqrt(1 - (seededUnit(index, 1) * 2 - 1) ** 2),
      y: seededUnit(index, 1) * 2 - 1,
      z: Math.sin(seededUnit(index, 2) * Math.PI * 2) * Math.sqrt(1 - (seededUnit(index, 1) * 2 - 1) ** 2),
    },
    color: {
      x: 0.7 + seededUnit(index, 4) * 0.25,
      y: 0.74 + seededUnit(index, 5) * 0.2,
      z: 0.9 + seededUnit(index, 6) * 0.1,
    },
    size: 0.65 + seededUnit(index, 7) * 1.15,
    alpha: 0.08 + seededUnit(index, 8) * 0.22,
  }));
};

const createStarField = () => {
  const catalogStars = BRIGHT_STAR_CATALOG.map((star) => {
    const style = starVisualStyle(star);
    return {
      direction: celestialDirectionFromRaDec(star.raHours, star.decDegrees),
      color: style.color,
      size: style.size,
      alpha: style.alpha,
    };
  });
  const stars = catalogStars.length > 0
    ? [...createProceduralStarEntries(), ...catalogStars]
    : createProceduralStarEntries();
  const count = stars.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  stars.forEach((star, index) => {
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
  geometry.userData.baseAlphas = Array.from(alphas);

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

interface StarBlocker {
  direction: THREE.Vector3;
  angularRadius: number;
  feather: number;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

const addDirectionalStarBlocker = (
  blockers: StarBlocker[],
  direction: THREE.Vector3,
  angularRadius: number,
  feather = STAR_OCCLUSION_FEATHER_RADIANS,
) => {
  if (angularRadius <= 0 || direction.lengthSq() < 1e-8) return;
  blockers.push({
    direction: direction.clone().normalize(),
    angularRadius,
    feather,
  });
};

const addSceneSphereStarBlocker = (
  blockers: StarBlocker[],
  cameraPosition: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  visible: boolean,
) => {
  if (!visible || radius <= 0) return;
  const offset = center.clone().sub(cameraPosition);
  const distance = offset.length();
  if (distance <= 1e-6) return;
  const angularRadius = Math.asin(Math.min(1, radius / distance));
  addDirectionalStarBlocker(
    blockers,
    offset,
    angularRadius,
    Math.max(STAR_OCCLUSION_FEATHER_RADIANS, angularRadius * 0.035),
  );
};

const addProxyStarBlocker = (
  blockers: StarBlocker[],
  cameraPosition: THREE.Vector3,
  proxy: THREE.Object3D,
) => {
  if (!proxy.visible) return;
  const center = new THREE.Vector3();
  proxy.getWorldPosition(center);
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    center,
    Math.max(proxy.scale.x, proxy.scale.y, proxy.scale.z),
    true,
  );
};

const collectStarBlockers = (
  objects: SceneObjects,
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
): StarBlocker[] => {
  const blockers: StarBlocker[] = [];
  const cameraPosition = objects.camera.position;

  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.earthGroup.position,
    EARTH_ATMOSPHERE_RADIUS,
    objects.earthGroup.visible,
  );
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.moonGroup.position,
    MOON_SCENE_RADIUS,
    objects.moonGroup.visible,
  );
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.sunMesh.position,
    15.5,
    objects.sunMesh.visible,
  );
  addDirectionalStarBlocker(
    blockers,
    vectorFromPlain(snapshot.sunDirection),
    apparentAngularRadiusRadians(SUN_RADIUS_KM, snapshot.sunDistanceKm) * 2.2,
    0.006,
  );
  addProxyStarBlocker(blockers, cameraPosition, objects.surfaceMoonProxy);
  addProxyStarBlocker(blockers, cameraPosition, objects.surfaceEarthProxy);
  addProxyStarBlocker(blockers, cameraPosition, objects.surfaceSunProxy);
  addProxyStarBlocker(blockers, cameraPosition, objects.binaryPrimaryProxy);
  addProxyStarBlocker(blockers, cameraPosition, objects.binarySecondaryProxy);
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.binaryPrimaryStar.position,
    objects.binaryPrimaryStar.scale.x * 1.55,
    objects.binaryPrimaryStar.visible,
  );
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.binarySecondaryStar.position,
    objects.binarySecondaryStar.scale.x * 1.55,
    objects.binarySecondaryStar.visible,
  );
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.binaryPlanetGroup.position,
    objects.binaryPlanetMesh.scale.x * 7.8,
    objects.binaryGroup.visible,
  );
  addSceneSphereStarBlocker(
    blockers,
    cameraPosition,
    objects.binaryMoonGroup.position,
    BINARY_MOON_SCENE_RADIUS,
    objects.binaryMoonGroup.visible,
  );

  return blockers;
};

const updateStarFieldOcclusion = (
  objects: SceneObjects,
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  horizonUp: THREE.Vector3 | null,
) => {
  const geometry = objects.starField.geometry;
  const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
  const alphaAttribute = geometry.getAttribute('alpha') as THREE.BufferAttribute;
  const blockers = collectStarBlockers(objects, snapshot);

  for (let index = 0; index < alphaAttribute.count; index += 1) {
    const starDirection = new THREE.Vector3(
      positionAttribute.getX(index),
      positionAttribute.getY(index),
      positionAttribute.getZ(index),
    ).normalize();
    const baseAlphas = geometry.userData.baseAlphas as number[] | undefined;
    let opacity = baseAlphas?.[index] ?? alphaAttribute.getX(index);

    if (horizonUp) {
      opacity *= smoothstep(
        -STAR_HORIZON_FEATHER,
        STAR_HORIZON_FEATHER,
        starDirection.dot(horizonUp),
      );
    }

    blockers.forEach((blocker) => {
      const dot = Math.max(-1, Math.min(1, starDirection.dot(blocker.direction)));
      const angle = Math.acos(dot);
      opacity *= smoothstep(
        Math.max(0, blocker.angularRadius - blocker.feather),
        blocker.angularRadius + blocker.feather,
        angle,
      );
    });

    alphaAttribute.setX(index, opacity);
  }

  alphaAttribute.needsUpdate = true;
};

const createPathLine = (pointCount: number, color: number, opacity: number) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3),
  );
  geometry.setDrawRange(0, pointCount);

  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
};

const createMoonPathLine = () => createPathLine(MOON_PATH_SAMPLE_COUNT, 0x8dd7ff, 0.45);

const createBinaryPathLine = (color: number, opacity = 0.34) =>
  createPathLine(BINARY_PATH_SAMPLE_COUNT, color, opacity);

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

const createEarthNightOverlay = (texture: THREE.Texture) =>
  new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_SCENE_RADIUS * 1.006, 160, 80),
    new THREE.ShaderMaterial({
      uniforms: {
        earthMap: { value: texture },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vUv = uv;
          vWorldPosition = worldPosition.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D earthMap;
        uniform vec3 sunDirection;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec3 normalDirection = normalize(vWorldNormal);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float sunFacing = dot(normalDirection, normalize(sunDirection));
          float viewFacing = max(dot(normalDirection, viewDirection), 0.0);
          float night = smoothstep(0.06, -0.24, sunFacing);
          vec3 textureColor = texture2D(earthMap, vUv).rgb;
          float luminance = dot(textureColor, vec3(0.299, 0.587, 0.114));
          float warm = smoothstep(0.08, 0.42, textureColor.r - textureColor.b)
            * smoothstep(0.05, 0.34, textureColor.g - textureColor.b)
            * smoothstep(0.14, 0.72, luminance);
          vec3 nightColor = textureColor * vec3(0.11, 0.15, 0.25);
          nightColor += vec3(1.0, 0.72, 0.28) * warm * 0.24;
          float limbFade = smoothstep(0.02, 0.18, viewFacing);
          gl_FragColor = vec4(nightColor, night * limbFade * 0.58);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
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
          vec3 sunHorizon = sun - up * dot(sun, up);
          vec3 viewHorizon = direction - up * upDot;
          sunHorizon = sunHorizon / max(length(sunHorizon), 0.001);
          viewHorizon = viewHorizon / max(length(viewHorizon), 0.001);
          float sunAzimuth = dot(viewHorizon, sunHorizon);
          float duskBand = horizon * (0.24 + 0.76 * smoothstep(-0.28, 0.84, sunAzimuth));

          vec3 nightColor = mix(vec3(0.004, 0.008, 0.028), vec3(0.018, 0.034, 0.075), max(upDot, 0.0));
          vec3 dayColor = mix(vec3(0.38, 0.62, 0.98), vec3(0.08, 0.21, 0.48), clamp(upDot, 0.0, 1.0));
          vec3 twilightColor = vec3(1.0, 0.36, 0.17) * duskBand;
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

const createInfiniteSunDisk = () => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      coreRadius: { value: 1 / INFINITE_SUN_HALO_SCALE },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float coreRadius;
      varying vec2 vUv;

      void main() {
        vec2 centered = (vUv - 0.5) * 2.0;
        float radius = length(centered);
        if (radius > 1.0) discard;

        float core = 1.0 - smoothstep(coreRadius * 0.82, coreRadius, radius);
        float halo = (1.0 - smoothstep(coreRadius, 1.0, radius))
          * pow(max(0.0, 1.0 - radius), 2.4)
          * 0.42;
        float intensity = max(core, halo);
        if (intensity < 0.004) discard;

        vec3 coreColor = mix(vec3(1.0, 0.69, 0.26), vec3(1.0, 0.96, 0.73), core);
        vec3 haloColor = vec3(1.0, 0.43, 0.12);
        vec3 color = coreColor * core * 1.35 + haloColor * halo;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    transparent: false,
  });
  material.toneMapped = false;

  const disk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  disk.frustumCulled = false;
  disk.renderOrder = -20;
  disk.visible = false;
  return disk;
};

const createBinaryStarMesh = (color: number) => {
  const star = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.MeshBasicMaterial({ color }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 48, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  star.add(halo);
  return star;
};

const createStarProxy = (color: number) => {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const proxy = new THREE.Mesh(new THREE.CircleGeometry(1, 96), material);
  proxy.renderOrder = 6;
  proxy.visible = false;
  return proxy;
};

const createAlienGroup = () => {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: 0xa7f3d0,
    emissive: 0x123c2f,
    emissiveIntensity: 0.08,
    roughness: 0.58,
    metalness: 0.02,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x08111f,
    roughness: 0.38,
  });
  const sparkle = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.25,
  });
  const blush = new THREE.MeshStandardMaterial({
    color: 0xff9fb2,
    emissive: 0x4a1020,
    emissiveIntensity: 0.05,
    roughness: 0.72,
  });
  const suit = new THREE.MeshStandardMaterial({
    color: 0xc4b5fd,
    roughness: 0.7,
    metalness: 0.04,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.073, 20, 14), suit);
  body.scale.set(0.88, 1.08, 0.76);
  body.position.y = 0.1;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 10), skin);
  belly.scale.set(1.05, 0.7, 0.34);
  belly.position.set(0, 0.096, -0.055);
  group.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.088, 24, 16), skin);
  head.scale.set(1.16, 0.92, 1);
  head.position.y = 0.214;
  group.add(head);

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 10), dark);
    eye.scale.set(0.82, 1.18, 0.38);
    eye.position.set(side * 0.034, 0.222, -0.079);
    group.add(eye);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 8, 6), sparkle);
    glint.position.set(side * 0.028, 0.229, -0.087);
    group.add(glint);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), blush);
    cheek.scale.set(1.25, 0.75, 0.28);
    cheek.position.set(side * 0.059, 0.203, -0.071);
    group.add(cheek);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.008, 0.074, 8), skin);
    arm.position.set(side * 0.067, 0.112, -0.006);
    arm.rotation.z = side * 0.52;
    group.add(arm);

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.085, 8), skin);
    leg.position.set(side * 0.032, 0.043, 0.012);
    leg.rotation.z = side * 0.13;
    leg.name = `alien-leg-${side}`;
    group.add(leg);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), skin);
    foot.scale.set(1.35, 0.44, 0.92);
    foot.position.set(side * 0.036, 0.004, -0.008);
    foot.name = `alien-foot-${side}`;
    group.add(foot);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.068, 8), skin);
    antenna.position.set(side * 0.03, 0.295, -0.003);
    antenna.rotation.z = side * 0.34;
    group.add(antenna);

    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), blush);
    bead.position.set(side * 0.044, 0.327, -0.004);
    group.add(bead);
  });

  group.visible = false;
  return group;
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

const createPenguinGroup = (
  originX: number,
  originZ: number,
  scale: number,
  phase: number,
) => {
  const group = new THREE.Group();
  group.name = `penguin-${phase}`;
  group.userData.originX = originX;
  group.userData.originZ = originZ;
  group.userData.phase = phase;
  group.userData.radius = 0.12 + phase * 0.026;
  group.userData.speed = 0.00032 + phase * 0.00005;

  const black = new THREE.MeshStandardMaterial({ color: 0x07111f, roughness: 0.62 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.54 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xfb923c, roughness: 0.56 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 14), black);
  body.scale.set(0.78, 1.18, 0.66);
  body.position.y = 0.115;
  body.name = 'penguin-body';
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 10), white);
  belly.scale.set(0.82, 1.02, 0.28);
  belly.position.set(0, 0.105, -0.052);
  group.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.064, 18, 12), black);
  head.position.y = 0.245;
  group.add(head);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), white);
  face.scale.set(0.92, 0.82, 0.25);
  face.position.set(0, 0.242, -0.048);
  group.add(face);

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), black);
    eye.position.set(side * 0.018, 0.254, -0.079);
    group.add(eye);

    const flipper = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.11, 8), black);
    flipper.position.set(side * 0.068, 0.122, -0.004);
    flipper.rotation.z = side * 0.42;
    flipper.name = `penguin-flipper-${side}`;
    group.add(flipper);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), orange);
    foot.scale.set(1.8, 0.34, 0.78);
    foot.position.set(side * 0.034, 0.014, -0.032);
    foot.name = `penguin-foot-${side}`;
    group.add(foot);
  });

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.042, 12), orange);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.239, -0.092);
  group.add(beak);

  group.position.set(originX, 0, originZ);
  group.scale.setScalar(scale);
  return group;
};

const createPenguinFamilyGroup = () => {
  const group = new THREE.Group();
  [
    { x: -0.42, z: -0.18, scale: 0.8, phase: 1 },
    { x: -0.12, z: 0.3, scale: 0.62, phase: 2 },
    { x: 0.28, z: -0.08, scale: 0.72, phase: 3 },
    { x: 0.52, z: 0.26, scale: 0.52, phase: 4 },
  ].forEach((penguin) => {
    group.add(createPenguinGroup(penguin.x, penguin.z, penguin.scale, penguin.phase));
  });
  group.visible = false;
  return group;
};

const animatePenguinFamily = (penguinFamilyGroup: THREE.Group, now: number) => {
  penguinFamilyGroup.children.forEach((child) => {
    const penguin = child as THREE.Group;
    const phase = Number(penguin.userData.phase ?? 0);
    const originX = Number(penguin.userData.originX ?? 0);
    const originZ = Number(penguin.userData.originZ ?? 0);
    const radius = Number(penguin.userData.radius ?? 0.04);
    const speed = Number(penguin.userData.speed ?? 0.0005);
    const t = now * speed + phase * 1.7;
    const wobble = Math.sin(t * 6.2) * 0.16;
    penguin.position.set(
      originX + Math.cos(t) * radius,
      Math.abs(Math.sin(t * 6.2)) * 0.004,
      originZ + Math.sin(t * 0.8) * radius,
    );
    penguin.rotation.y = -t + wobble;
    penguin.rotation.z = wobble * 0.34;

    const leftFoot = penguin.getObjectByName('penguin-foot--1');
    const rightFoot = penguin.getObjectByName('penguin-foot-1');
    const leftFlipper = penguin.getObjectByName('penguin-flipper--1');
    const rightFlipper = penguin.getObjectByName('penguin-flipper-1');
    if (leftFoot) leftFoot.rotation.x = Math.sin(t * 6.2) * 0.32;
    if (rightFoot) rightFoot.rotation.x = -Math.sin(t * 6.2) * 0.32;
    if (leftFlipper) leftFlipper.rotation.z = -0.42 + wobble * 0.45;
    if (rightFlipper) rightFlipper.rotation.z = 0.42 + wobble * 0.45;
  });
};

const easeInOutCubic = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

const getMoonDistance = (scaleMode: ScaleMode, moonDistanceKm: number) =>
  scaleMode === 'true'
    ? (moonDistanceKm / EARTH_RADIUS_KM) * EARTH_SCENE_RADIUS
    : COMPACT_MOON_DISTANCE * (moonDistanceKm / MEAN_MOON_DISTANCE_KM);

const getCompactSunPosition = (sunDirection: THREE.Vector3) =>
  sunDirection.clone().multiplyScalar(COMPACT_SUN_DISTANCE);

const getScenePositionFromGeocentric = (vector: Vec3, scaleMode: ScaleMode) => {
  const position = vectorFromPlain(vector);
  const distanceKm = position.length();
  return position.normalize().multiplyScalar(getMoonDistance(scaleMode, distanceKm));
};

const getMoonScenePosition = (
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  scaleMode: ScaleMode,
) => getScenePositionFromGeocentric(snapshot.moonGeocentricKm, scaleMode);

const getBinaryScenePosition = (position: Vec3, scaleMode: ScaleMode) =>
  vectorFromPlain(scaleBinaryScenePosition(position, scaleMode));

const getSpaceView = (
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  scaleMode: ScaleMode,
) => {
  const moonPosition = getMoonScenePosition(snapshot, scaleMode);
  const sunDirection = vectorFromPlain(snapshot.sunDirection).normalize();
  const side = new THREE.Vector3().crossVectors(sunDirection, WORLD_CAMERA_UP);
  if (side.lengthSq() < 1e-6) {
    side.set(1, 0, 0);
  } else {
    side.normalize();
  }
  const target = moonPosition.clone().multiplyScalar(scaleMode === 'true' ? 0.18 : 0.24);
  const cameraDistance = scaleMode === 'true'
    ? COMPACT_SUN_DISTANCE * 1.38
    : COMPACT_SUN_DISTANCE * 0.52;
  const cameraLift = scaleMode === 'true'
    ? TRUE_DISTANCE_SPACE_CAMERA_LIFT
    : SPACE_CAMERA_LIFT;
  const sideOffset = scaleMode === 'true'
    ? TRUE_DISTANCE_SPACE_CAMERA_SIDE_OFFSET
    : SPACE_CAMERA_SIDE_OFFSET;
  const position = sunDirection
    .multiplyScalar(cameraDistance)
    .add(WORLD_CAMERA_UP.clone().multiplyScalar(cameraLift))
    .add(side.multiplyScalar(sideOffset));

  return {
    position,
    target,
  };
};

const getBinarySpaceView = (
  snapshot: BinarySystemSnapshot,
  _scaleMode: ScaleMode,
) => {
  const scaleMode: ScaleMode = 'compact';
  const planetPosition = getBinaryScenePosition(snapshot.planetPosition, scaleMode);
  const moonPosition = getBinaryScenePosition(snapshot.moonPosition, scaleMode);
  const target = planetPosition.clone().lerp(moonPosition, 0.38);
  const offset = BINARY_SPACE_CAMERA_POSITION.clone();

  return {
    position: target.clone().add(offset),
    target,
  };
};

const getActiveSpaceView = (
  worldMode: WorldMode,
  earthMoonSnapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  binarySnapshot: BinarySystemSnapshot,
  scaleMode: ScaleMode,
) => worldMode === 'binarySystem'
  ? getBinarySpaceView(binarySnapshot, 'compact')
  : getSpaceView(earthMoonSnapshot, scaleMode);

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

const getCanvasImageSize = (image: CanvasImageSource) => {
  const candidate = image as HTMLImageElement & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width: number;
    height: number;
  };
  const width = Number(candidate.naturalWidth || candidate.videoWidth || candidate.width);
  const height = Number(candidate.naturalHeight || candidate.videoHeight || candidate.height);
  return {
    width: Number.isFinite(width) ? Math.floor(width) : 0,
    height: Number.isFinite(height) ? Math.floor(height) : 0,
  };
};

const imageToEarthImageData = (
  image: CanvasImageSource | undefined,
  width: number,
  height: number,
) => {
  if (!image) return null;

  const imageSize = getCanvasImageSize(image);
  if (imageSize.width <= 0 || imageSize.height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  try {
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
};

const createLiveEarthCompositeTexture = (
  layers: Array<{ layer: ResolvedLiveEarthLayer; texture: THREE.Texture }>,
  fallbackTexture: THREE.Texture,
  anisotropy: number,
) => {
  const fallbackImage = fallbackTexture.image as CanvasImageSource | undefined;
  const baseData = imageToEarthImageData(fallbackImage, LIVE_EARTH_TEXTURE_WIDTH, LIVE_EARTH_TEXTURE_HEIGHT);
  if (!baseData) return null;

  const compositeLayers = layers
    .map(({ layer, texture }) => {
      const imageData = imageToEarthImageData(texture.image as CanvasImageSource | undefined, baseData.width, baseData.height);
      if (!imageData) return null;
      return {
        id: layer.cacheKey,
        imageData,
        priority: layer.provider.priority,
        opacity: layer.provider.blendOpacity,
      };
    })
    .filter((layer): layer is NonNullable<typeof layer> => layer !== null);

  const firstComposite = compositeLiveEarthLayers(baseData, compositeLayers);
  const validLayerKeys = validLiveEarthCompositeLayerKeys(
    layers.map(({ layer }) => layer),
    firstComposite.stats,
  );

  if (validLayerKeys.length === 0) return null;
  const validLayerKeySet = new Set(validLayerKeys);
  const composite = validLayerKeys.length === compositeLayers.length
    ? firstComposite
    : compositeLiveEarthLayers(
      baseData,
      compositeLayers.filter((layer) => validLayerKeySet.has(layer.id)),
    );

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = composite.imageData.width;
  outputCanvas.height = composite.imageData.height;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) return null;

  const outputData = outputContext.createImageData(composite.imageData.width, composite.imageData.height);
  outputData.data.set(composite.imageData.data);
  outputContext.putImageData(outputData, 0, 0);

  const texture = new THREE.CanvasTexture(outputCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  return {
    texture,
    validLayerKeys,
  };
};

const createMoonSandboxRenderer = () => {
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

const getBodyCenter = (objects: SceneObjects, body: BodyId) => {
  if (body === 'earth') return objects.earthGroup.position;
  if (body === 'moon') return objects.moonGroup.position;
  return objects.binaryMoonGroup.position;
};

const getBodyGroup = (objects: SceneObjects, body: BodyId) => {
  if (body === 'earth') return objects.earthGroup;
  if (body === 'moon') return objects.moonGroup;
  return objects.binaryMoonGroup;
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

const applySpaceKeyLook = (
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

const getSurfaceCameraVectors = (
  objects: SceneObjects,
  surface: SurfaceState,
) => {
  const config = BODY_CONFIG[surface.body];
  const bodyGroup = getBodyGroup(objects, surface.body);
  const bodyCenter = getBodyCenter(objects, surface.body);
  const frame = getSurfaceViewFrame(surface.pose, surface.pitch);
  const localEye = vectorFromPlain(frame.eyeUp).multiplyScalar(config.radius + config.eyeHeight);

  const eye = localEye.applyQuaternion(bodyGroup.quaternion).add(bodyCenter);
  const lookDirection = vectorFromPlain(frame.lookDirection).applyQuaternion(bodyGroup.quaternion).normalize();
  const headUp = vectorFromPlain(frame.headUp).applyQuaternion(bodyGroup.quaternion).normalize();
  const worldUp = vectorFromPlain(frame.eyeUp).applyQuaternion(bodyGroup.quaternion).normalize();
  const target = eye.clone().add(lookDirection.multiplyScalar(config.radius * 2));

  return {
    eye,
    target,
    headUp,
    worldUp,
  };
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

const setSurfaceSkyProxiesHidden = (objects: SceneObjects) => {
  objects.surfaceMoonProxy.visible = false;
  objects.surfaceEarthProxy.visible = false;
  objects.surfaceSunProxy.visible = false;
  objects.surfaceMoonProxy.material.opacity = 0;
  objects.surfaceEarthProxy.material.opacity = 0;
  objects.surfaceSunProxy.material.opacity = 0;
};

const updateSurfaceSphereProxy = (
  proxy: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>,
  body: SurfaceSkyBodySnapshot | null,
  cameraPosition: THREE.Vector3,
  worldUp: THREE.Vector3,
  bodyRadiusKm: number,
  bodyQuaternion: THREE.Quaternion,
) => {
  if (!body) {
    proxy.visible = false;
    proxy.material.opacity = 0;
    return;
  }

  const direction = vectorFromPlain(body.direction).normalize();
  const visibility = surfaceDirectionVisibility(
    plainFromVector(direction),
    plainFromVector(worldUp),
    body.angularRadiusRadians,
  );

  if (visibility <= 0) {
    proxy.visible = false;
    proxy.material.opacity = 0;
    return;
  }

  const radius = skyProxyRadiusForAngularSize(
    SURFACE_SKY_BODY_DISTANCE,
    bodyRadiusKm,
    body.distanceKm,
  );
  proxy.position.copy(cameraPosition.clone().add(direction.multiplyScalar(SURFACE_SKY_BODY_DISTANCE)));
  proxy.quaternion.copy(bodyQuaternion);
  proxy.scale.setScalar(radius);
  proxy.material.opacity = visibility;
  proxy.visible = true;
};

const setBinaryStarProxiesHidden = (objects: SceneObjects) => {
  objects.binaryPrimaryProxy.visible = false;
  objects.binarySecondaryProxy.visible = false;
  objects.binaryPrimaryProxy.material.opacity = 0;
  objects.binarySecondaryProxy.material.opacity = 0;
};

const setInfiniteSunDiskHidden = (objects: SceneObjects) => {
  objects.infiniteSunDisk.visible = false;
};

const updateInfiniteSunDisk = (
  objects: SceneObjects,
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  enabled: boolean,
) => {
  if (!enabled) {
    setInfiniteSunDiskHidden(objects);
    return;
  }

  const cameraInverse = objects.camera.quaternion.clone().invert();
  const sunViewDirection = vectorFromPlain(snapshot.sunDirection)
    .normalize()
    .applyQuaternion(cameraInverse)
    .normalize();

  if (sunViewDirection.z >= -0.001) {
    setInfiniteSunDiskHidden(objects);
    return;
  }

  const angularRadius = apparentAngularRadiusRadians(SUN_RADIUS_KM, snapshot.sunDistanceKm);
  const diskPosition = sunViewDirection.multiplyScalar(INFINITE_SUN_DISTANCE);
  const viewDepth = Math.max(1, -diskPosition.z);
  const haloAngularRadius = angularRadius * INFINITE_SUN_HALO_SCALE;
  const haloDiameter = 2 * viewDepth * Math.tan(haloAngularRadius);

  objects.infiniteSunDisk.position.copy(diskPosition);
  objects.infiniteSunDisk.scale.set(haloDiameter, haloDiameter, 1);
  objects.infiniteSunDisk.material.uniforms.coreRadius.value = 1 / INFINITE_SUN_HALO_SCALE;
  objects.infiniteSunDisk.visible = true;
};

const updateSurfaceSkyProxies = (
  objects: SceneObjects,
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  cameraPosition: THREE.Vector3,
  worldUp: THREE.Vector3,
  surfaceBody: BodyId,
) => {
  if (surfaceBody !== 'earth' && surfaceBody !== 'moon') {
    setSurfaceSkyProxiesHidden(objects);
    return;
  }

  const skyBodies = getSurfaceSkyBodies(snapshot, surfaceBody, plainFromVector(worldUp));
  const sunDirection = vectorFromPlain(skyBodies.sun.direction).normalize();
  const sunVisibility = surfaceDirectionVisibility(
    plainFromVector(sunDirection),
    plainFromVector(worldUp),
    skyBodies.sun.angularRadiusRadians,
  );
  const sunRadius = skyProxyRadiusForAngularSize(
    SURFACE_SKY_BODY_DISTANCE,
    SUN_RADIUS_KM,
    skyBodies.sun.distanceKm,
  );

  updateSurfaceSphereProxy(
    objects.surfaceMoonProxy,
    skyBodies.moon,
    cameraPosition,
    worldUp,
    MOON_RADIUS_KM,
    objects.moonGroup.quaternion,
  );
  updateSurfaceSphereProxy(
    objects.surfaceEarthProxy,
    skyBodies.earth,
    cameraPosition,
    worldUp,
    EARTH_RADIUS_KM,
    objects.earthGroup.quaternion,
  );

  objects.surfaceSunProxy.position.copy(
    cameraPosition.clone().add(sunDirection.multiplyScalar(SURFACE_SKY_BODY_DISTANCE)),
  );
  objects.surfaceSunProxy.quaternion.copy(objects.camera.quaternion);
  objects.surfaceSunProxy.scale.setScalar(sunRadius);
  objects.surfaceSunProxy.material.opacity = sunVisibility;
  objects.surfaceSunProxy.visible = sunVisibility > 0;
};

const updateBinaryStarProxy = (
  proxy: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>,
  camera: THREE.PerspectiveCamera,
  cameraPosition: THREE.Vector3,
  direction: THREE.Vector3,
  worldUp: THREE.Vector3,
  starRadiusKm: number,
  starDistanceKm: number,
) => {
  const angularRadius = apparentAngularRadiusRadians(starRadiusKm, starDistanceKm);
  const visibility = surfaceDirectionVisibility(
    plainFromVector(direction),
    plainFromVector(worldUp),
    angularRadius,
  );

  if (visibility <= 0) {
    proxy.visible = false;
    proxy.material.opacity = 0;
    return;
  }

  const radius = skyProxyRadiusForAngularSize(
    SURFACE_SKY_BODY_DISTANCE,
    starRadiusKm,
    starDistanceKm,
  );
  proxy.position.copy(cameraPosition.clone().add(direction.multiplyScalar(SURFACE_SKY_BODY_DISTANCE)));
  proxy.quaternion.copy(camera.quaternion);
  proxy.scale.setScalar(radius);
  proxy.material.opacity = visibility;
  proxy.visible = true;
};

const updateBinaryStarProxies = (
  objects: SceneObjects,
  snapshot: BinarySystemSnapshot,
  cameraPosition: THREE.Vector3,
  worldUp: THREE.Vector3,
) => {
  updateBinaryStarProxy(
    objects.binaryPrimaryProxy,
    objects.camera,
    cameraPosition,
    vectorFromPlain(snapshot.primaryDirectionFromMoon).normalize(),
    worldUp,
    snapshot.primaryStar.radiusKm,
    snapshot.primaryDistanceFromMoonKm,
  );
  updateBinaryStarProxy(
    objects.binarySecondaryProxy,
    objects.camera,
    cameraPosition,
    vectorFromPlain(snapshot.secondaryDirectionFromMoon).normalize(),
    worldUp,
    snapshot.secondaryStar.radiusKm,
    snapshot.secondaryDistanceFromMoonKm,
  );
};

const updateBinaryPathLines = (
  objects: SceneObjects,
  snapshot: BinarySystemSnapshot,
  scaleMode: ScaleMode,
) => {
  const planetPath = snapshot.planetPath.map((point) => getBinaryScenePosition(point, scaleMode));
  const moonPath = snapshot.moonPath.map((point) => getBinaryScenePosition(point, scaleMode));
  updateLinePositions(objects.binaryPlanetPathLine, planetPath);
  updateLinePositions(objects.binaryMoonPathLine, moonPath);

  const planetLabelPoint = planetPath[Math.floor(planetPath.length * 0.11)] ?? planetPath[0];
  const moonLabelPoint = moonPath[Math.floor(moonPath.length * 0.28)] ?? moonPath[0];
  if (planetLabelPoint) {
    objects.binaryLabels.planetPath.position.copy(planetLabelPoint).add(new THREE.Vector3(0, 7, 0));
  }
  if (moonLabelPoint) {
    objects.binaryLabels.moonPath.position.copy(moonLabelPoint).add(new THREE.Vector3(0, 4.2, 0));
  }
};

const updateBinaryScene = (
  objects: SceneObjects,
  snapshot: BinarySystemSnapshot,
  scaleMode: ScaleMode,
) => {
  const primaryPosition = getBinaryScenePosition(snapshot.primaryStar.position, scaleMode);
  const secondaryPosition = getBinaryScenePosition(snapshot.secondaryStar.position, scaleMode);
  const planetPosition = getBinaryScenePosition(snapshot.planetPosition, scaleMode);
  const moonPosition = getBinaryScenePosition(snapshot.moonPosition, scaleMode);
  const radiusScale = scaleMode === 'true' ? 1.18 : 1;

  objects.binaryPrimaryStar.position.copy(primaryPosition);
  objects.binaryPrimaryStar.scale.setScalar(snapshot.primaryStar.radius * radiusScale);
  objects.binarySecondaryStar.position.copy(secondaryPosition);
  objects.binarySecondaryStar.scale.setScalar(snapshot.secondaryStar.radius * radiusScale);
  objects.binaryPlanetGroup.position.copy(planetPosition);
  objects.binaryPlanetGroup.rotation.y = (snapshot.date.getTime() / DAY_MS) * 0.22;
  objects.binaryMoonGroup.position.copy(moonPosition);
  objects.binaryMoonGroup.rotation.y = (snapshot.date.getTime() / DAY_MS) * 0.45;
  objects.binaryPlanetMesh.scale.setScalar(snapshot.planetRadius / 7.8);
  objects.binaryMoonMesh.scale.setScalar(snapshot.moonRadius / BINARY_MOON_SCENE_RADIUS);
  objects.binaryPrimaryLight.position.copy(primaryPosition);
  objects.binaryPrimaryLight.target.position.copy(moonPosition);
  objects.binarySecondaryLight.position.copy(secondaryPosition);
  objects.binarySecondaryLight.target.position.copy(moonPosition);

  updateBinaryPathLines(objects, snapshot, scaleMode);
  objects.binaryLabels.primaryStar.position.copy(primaryPosition).add(new THREE.Vector3(0, snapshot.primaryStar.radius + 5.5, 0));
  objects.binaryLabels.secondaryStar.position.copy(secondaryPosition).add(new THREE.Vector3(0, snapshot.secondaryStar.radius + 4.2, 0));
  objects.binaryLabels.planet.position.copy(planetPosition).add(new THREE.Vector3(0, snapshot.planetRadius + 5, 0));
  objects.binaryLabels.binaryMoon.position.copy(moonPosition).add(new THREE.Vector3(0, BINARY_MOON_SCENE_RADIUS + 3.6, 0));
};

const setLabelRecordVisible = <T extends string>(
  labels: Record<T, THREE.Sprite>,
  visible: boolean,
) => {
  (Object.keys(labels) as T[]).forEach((key) => {
    labels[key].visible = visible;
  });
};

const isAlienSurface = (worldMode: WorldMode, body: BodyId) =>
  (worldMode === 'earthMoonSun' && body === 'moon')
  || (worldMode === 'binarySystem' && body === 'binaryMoon');

const getAlienCatchDistance = (body: BodyId) =>
  BODY_CONFIG[body].radius * ALIEN_CATCH_DISTANCE_RATIO;

const getSurfaceHorizonArcDistance = (body: BodyId) => {
  const config = BODY_CONFIG[body];
  return config.radius * Math.acos(config.radius / (config.radius + config.eyeHeight));
};

const getAlienIdlePatrolPose = (
  surface: SurfaceState,
  now: number,
  seed: number,
) => {
  const config = BODY_CONFIG[surface.body];
  const horizonDistance = getSurfaceHorizonArcDistance(surface.body);
  const catchDistance = getAlienCatchDistance(surface.body);
  const patrolDistance = Math.min(
    horizonDistance * 0.94,
    Math.max(horizonDistance * 0.78, catchDistance * 1.7),
  );
  const phase = now * 0.00022 + seed;
  const forwardDistance = patrolDistance * (0.86 + Math.cos(phase * 0.7) * 0.06);
  const rightDistance = Math.sin(phase) * patrolDistance * 0.48;

  return moveSurfacePose(surface.pose, config.radius, {
    forwardDistance,
    rightDistance,
  });
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

const polePose = (body: BodyId, hemisphere: 'north' | 'south') =>
  createSurfacePose(
    BODY_CONFIG[body].radius,
    hemisphere === 'north' ? Math.PI / 2 : -Math.PI / 2,
    0,
    0,
  );

const greatCircleDistanceRadians = (from: Vec3, to: Vec3) => {
  const fromVector = vectorFromPlain(from).normalize();
  const toVector = vectorFromPlain(to).normalize();
  return Math.acos(Math.max(-1, Math.min(1, fromVector.dot(toVector))));
};

const bearingOffsetToSurfaceTarget = (
  pose: SurfacePose,
  targetUp: Vec3,
) => {
  const up = vectorFromPlain(pose.up).normalize();
  const target = vectorFromPlain(targetUp).normalize();
  const tangent = target.sub(up.clone().multiplyScalar(target.dot(up)));
  if (tangent.lengthSq() < 1e-8) return 0;
  tangent.normalize();

  const forward = vectorFromPlain(pose.forward).normalize();
  const right = vectorFromPlain(pose.right).normalize();
  return Math.atan2(tangent.dot(right), tangent.dot(forward)) * 180 / Math.PI;
};

const headingDegreesForSurfacePose = (pose: SurfacePose) => {
  const up = vectorFromPlain(pose.up).normalize();
  const north = WORLD_CAMERA_UP.clone().sub(up.clone().multiplyScalar(WORLD_CAMERA_UP.dot(up)));
  if (north.lengthSq() < 1e-8) {
    return 0;
  }
  north.normalize();
  const east = new THREE.Vector3().crossVectors(north, up).normalize();
  const forward = vectorFromPlain(pose.forward).normalize();
  return (Math.atan2(forward.dot(east), forward.dot(north)) * 180 / Math.PI + 360) % 360;
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
    pose: createSurfacePose(EARTH_SCENE_RADIUS, latitude, longitude, 0),
    pitch: 0.02,
  };
};

const getSurfaceCompassState = (
  surface: SurfaceState,
  homeSurface: SurfaceState | null,
  alien: AlienState | null,
): SurfaceCompassState => {
  const headingDegrees = headingDegreesForSurfacePose(surface.pose);
  const cardinalMarkers: CompassMarker[] = [
    { id: 'north', label: 'North', shortLabel: 'N', offsetDegrees: normalizeDegrees(0 - headingDegrees), kind: 'cardinal' },
    { id: 'east', label: 'East', shortLabel: 'E', offsetDegrees: normalizeDegrees(90 - headingDegrees), kind: 'cardinal' },
    { id: 'south', label: 'South', shortLabel: 'S', offsetDegrees: normalizeDegrees(180 - headingDegrees), kind: 'cardinal' },
    { id: 'west', label: 'West', shortLabel: 'W', offsetDegrees: normalizeDegrees(270 - headingDegrees), kind: 'cardinal' },
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
      offsetDegrees: normalizeDegrees(bearingOffsetToSurfaceTarget(surface.pose, target.up)),
      kind: 'pole',
    }));
  const homeMarker = surface.body === 'earth' && homeSurface?.body === 'earth'
    ? [{
      id: 'home',
      label: 'Home',
      shortLabel: 'Home',
      offsetDegrees: normalizeDegrees(bearingOffsetToSurfaceTarget(surface.pose, homeSurface.pose.up)),
      kind: 'home' as const,
    }]
    : [];
  const alienDistance = alien && alien.status === 'idle'
    ? greatCircleDistanceRadians(surface.pose.up, alien.pose.up)
    : Infinity;
  const alienMarker = alien
    && alien.status === 'idle'
    && alienDistance <= ALIEN_COMPASS_VISIBLE_RADIANS
    ? [{
      id: 'alien',
      label: 'Alien',
      shortLabel: '?',
      offsetDegrees: normalizeDegrees(bearingOffsetToSurfaceTarget(surface.pose, alien.pose.up)),
      kind: 'alien' as const,
    }]
    : [];

  return {
    headingDegrees,
    markers: [...cardinalMarkers, ...poleMarkers, ...homeMarker, ...alienMarker],
  };
};

const setSurfaceLandmarksHidden = (objects: SceneObjects) => {
  objects.northPoleGroup.visible = false;
  objects.southPoleGroup.visible = false;
  objects.homeMarkerGroup.visible = false;
  objects.penguinFamilyGroup.visible = false;
};

const updateSurfaceLandmarks = (
  objects: SceneObjects,
  surface: SurfaceState,
  homeSurface: SurfaceState | null,
  now: number,
) => {
  const config = BODY_CONFIG[surface.body];
  const bodyGroup = getBodyGroup(objects, surface.body);
  const markerScale = config.eyeHeight * 5.8;

  placeSurfaceGroup(
    objects.northPoleGroup,
    bodyGroup,
    polePose(surface.body, 'north'),
    config.radius,
    config.eyeHeight * 0.04,
    markerScale,
  );
  placeSurfaceGroup(
    objects.southPoleGroup,
    bodyGroup,
    polePose(surface.body, 'south'),
    config.radius,
    config.eyeHeight * 0.04,
    markerScale,
  );

  if (surface.body === 'earth' && homeSurface?.body === 'earth') {
    placeSurfaceGroup(
      objects.homeMarkerGroup,
      bodyGroup,
      homeSurface.pose,
      config.radius,
      config.eyeHeight * 0.045,
      config.eyeHeight * 4.2,
    );
  } else {
    objects.homeMarkerGroup.visible = false;
  }

  if (surface.body === 'earth') {
    animatePenguinFamily(objects.penguinFamilyGroup, now);
    placeSurfaceGroup(
      objects.penguinFamilyGroup,
      bodyGroup,
      polePose('earth', 'south'),
      config.radius,
      config.eyeHeight * 0.05,
      config.eyeHeight * 1.9,
    );
  } else {
    objects.penguinFamilyGroup.visible = false;
  }
};

const animateAlienLegs = (
  alienGroup: THREE.Group,
  now: number,
  seed: number,
  walkAmount: number,
) => {
  const stride = Math.sin(now * 0.018 + seed * 3.7) * walkAmount;
  const leftLeg = alienGroup.getObjectByName('alien-leg--1');
  const rightLeg = alienGroup.getObjectByName('alien-leg-1');
  const leftFoot = alienGroup.getObjectByName('alien-foot--1');
  const rightFoot = alienGroup.getObjectByName('alien-foot-1');

  if (leftLeg) leftLeg.rotation.x = stride * 0.5;
  if (rightLeg) rightLeg.rotation.x = -stride * 0.5;
  if (leftFoot) leftFoot.rotation.x = -stride * 0.32;
  if (rightFoot) rightFoot.rotation.x = stride * 0.32;
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
  const worldModeRef = useRef<WorldMode>('earthMoonSun');
  const modeRef = useRef<CameraMode>('space');
  const surfaceRef = useRef<SurfaceState | null>(null);
  const homeSurfaceRef = useRef<SurfaceState | null>(null);
  const transitionRef = useRef<TransitionState | null>(null);
  const alienRef = useRef<AlienState | null>(null);
  const earthMoonReturnPoseRef = useRef<SurfacePose | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const spaceCameraRef = useRef<SpaceLookState>({ yaw: 0, pitch: -0.18, roll: 0 });
  const pointerLockedRef = useRef(false);
  const tutorialStateRef = useRef<TutorialState | null>(null);
  const tutorialAdvanceTimerRef = useRef<number | null>(null);
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
  const [timePanelOpen, setTimePanelOpen] = useState(false);
  const [readoutsVisible, setReadoutsVisible] = useState(false);
  const [mode, setMode] = useState<CameraMode>('space');
  const [worldMode, setWorldMode] = useState<WorldMode>('earthMoonSun');
  const [surfaceBody, setSurfaceBody] = useState<BodyId | null>(null);
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
      // Storage can be unavailable in private or restricted browsing contexts.
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
    if (!step || step.input !== input) return;

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
    const snapshot = getEarthMoonSunSnapshot(now);
    simTimeRef.current = now;
    setDisplayDate(now);
    setPhase(snapshot.phase);
    setEclipseState(snapshot.eclipseState);
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
    worldModeRef.current = worldMode;
  }, [worldMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let startupScene: THREE.Scene | null = null;
    let startupRenderer: THREE.WebGLRenderer | null = null;
    setSceneStatus('initializing');
    setSceneFailureMessage('The 3D scene could not start on this machine.');

    try {
    const scene = new THREE.Scene();
    startupScene = scene;
    let latestSnapshot = getEarthMoonSunSnapshot(simTimeRef.current);
    let latestBinarySnapshot = getBinarySystemSnapshot(simTimeRef.current);
    let lastSnapshotUpdate = 0;
    scene.background = new THREE.Color(0x02040b);
    scene.fog = new THREE.FogExp2(0x02040b, 0.0008);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.005, 2200);
    camera.position.copy(SPACE_CAMERA_POSITION);
    scene.add(camera);

    const { renderer, lowResource } = createMoonSandboxRenderer();
    startupRenderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowResource ? 1 : 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !lowResource;
    if (!lowResource) {
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    mount.appendChild(renderer.domElement);

    const initialSpaceView = getActiveSpaceView(
      worldModeRef.current,
      latestSnapshot,
      latestBinarySnapshot,
      scaleModeRef.current,
    );
    camera.position.copy(initialSpaceView.position);
    setSpaceCameraFromLookAt(camera.position, initialSpaceView.target, spaceCameraRef.current);
    applySpaceCameraLook(camera, spaceCameraRef.current);

    const starField = createStarField();
    scene.add(starField);
    scene.add(new THREE.AmbientLight(0x182033, 0.12));

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');
    let baseEarthTextureReady = false;
    let disposed = false;
    let pendingLiveEarthDate: Date | null = null;
    let syncEarthTextureForDate: (date: Date) => void = () => undefined;
    const earthTexture = textureLoader.load('/textures/astronomy/earth-blue-marble-july.jpg', () => {
      baseEarthTextureReady = true;
      if (pendingLiveEarthDate) {
        const pendingDate = pendingLiveEarthDate;
        pendingLiveEarthDate = null;
        syncEarthTextureForDate(pendingDate);
      }
    });
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthTextureCache = new Map<string, THREE.Texture>();
    const unavailableEarthLayerKeys = new Set<string>();
    let activeEarthTextureKey = 'static';
    let loadingEarthTextureKey: string | null = null;

    const moonTexture = textureLoader.load('/textures/astronomy/moon-lroc-color-2k.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    moonTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const moonBump = textureLoader.load('/textures/astronomy/moon-ldem-1k.jpg');
    moonBump.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const earthGroup = new THREE.Group();
    const moonGroup = new THREE.Group();
    const binaryGroup = new THREE.Group();
    binaryGroup.visible = false;
    scene.add(earthGroup);
    scene.add(moonGroup);
    scene.add(binaryGroup);

    const earthMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.78,
      metalness: 0,
    });
    const earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 160, 80),
      earthMaterial,
    );
    earthMesh.castShadow = true;
    earthMesh.receiveShadow = true;
    earthMesh.userData.body = 'earth';
    earthGroup.add(earthMesh);

    const earthNightOverlay = createEarthNightOverlay(earthTexture);
    earthNightOverlay.renderOrder = 2;
    earthNightOverlay.visible = false;
    earthGroup.add(earthNightOverlay);

    let surfaceEarthMaterial: THREE.MeshStandardMaterial | null = null;
    const applyEarthTexture = (key: string, texture: THREE.Texture) => {
      activeEarthTextureKey = key;
      earthMaterial.map = texture;
      earthMaterial.needsUpdate = true;
      earthNightOverlay.material.uniforms.earthMap.value = texture;
      if (surfaceEarthMaterial) {
        surfaceEarthMaterial.map = texture;
        surfaceEarthMaterial.needsUpdate = true;
      }
    };

    const rememberEarthTexture = (key: string, texture: THREE.Texture) => {
      earthTextureCache.set(key, texture);

      while (earthTextureCache.size > LIVE_EARTH_TEXTURE_CACHE_LIMIT) {
        const removable = Array.from(earthTextureCache.entries())
          .find(([cacheKey]) => cacheKey !== activeEarthTextureKey && cacheKey !== key);
        if (!removable) break;
        earthTextureCache.delete(removable[0]);
        removable[1].dispose();
      }
    };

    const loadLiveEarthLayerTexture = (layer: ResolvedLiveEarthLayer) =>
      new Promise<{ layer: ResolvedLiveEarthLayer; texture: THREE.Texture | null }>((resolve) => {
        textureLoader.load(
          buildLiveEarthWmsUrl(layer),
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            resolve({ layer, texture });
          },
          undefined,
          () => resolve({ layer, texture: null }),
        );
      });

    syncEarthTextureForDate = (date: Date) => {
      if (!baseEarthTextureReady) {
        pendingLiveEarthDate = new Date(date);
        return;
      }

      let layers: ResolvedLiveEarthLayer[] = [];
      try {
        layers = resolveLiveEarthLayers(date)
          .filter((layer) => !unavailableEarthLayerKeys.has(layer.cacheKey));
      } catch {
        loadingEarthTextureKey = null;
        applyEarthTexture('static', earthTexture);
        return;
      }

      const key = liveEarthTextureKey(layers);
      if (key === activeEarthTextureKey || key === loadingEarthTextureKey) return;

      if (key === 'static') {
        loadingEarthTextureKey = null;
        applyEarthTexture('static', earthTexture);
        return;
      }

      const cached = earthTextureCache.get(key);
      if (cached) {
        applyEarthTexture(key, cached);
        return;
      }

      loadingEarthTextureKey = key;
      Promise.all(layers.map(loadLiveEarthLayerTexture)).then((results) => {
        const loadedLayers = results
          .filter((result): result is { layer: ResolvedLiveEarthLayer; texture: THREE.Texture } => result.texture !== null);

        results.forEach((result) => {
          if (!result.texture) unavailableEarthLayerKeys.add(result.layer.cacheKey);
        });

        if (disposed || loadingEarthTextureKey !== key) {
          loadedLayers.forEach((result) => result.texture.dispose());
          return;
        }

        loadingEarthTextureKey = null;

        if (loadedLayers.length === 0) {
          applyEarthTexture('static', earthTexture);
          return;
        }

        let composite: ReturnType<typeof createLiveEarthCompositeTexture> = null;
        try {
          composite = createLiveEarthCompositeTexture(
            loadedLayers,
            earthTexture,
            renderer.capabilities.getMaxAnisotropy(),
          );
        } catch {
          loadedLayers.forEach((result) => {
            unavailableEarthLayerKeys.add(result.layer.cacheKey);
          });
          applyEarthTexture('static', earthTexture);
          return;
        } finally {
          loadedLayers.forEach((result) => result.texture.dispose());
        }

        if (!composite) {
          loadedLayers.forEach((result) => unavailableEarthLayerKeys.add(result.layer.cacheKey));
          applyEarthTexture('static', earthTexture);
          return;
        }

        loadedLayers.forEach((result) => {
          if (!composite.validLayerKeys.includes(result.layer.cacheKey)) {
            unavailableEarthLayerKeys.add(result.layer.cacheKey);
          }
        });

        const validKey = liveEarthTextureKey(
          layers.filter((layer) => composite.validLayerKeys.includes(layer.cacheKey)),
        );

        if (validKey === 'static') {
          composite.texture.dispose();
          applyEarthTexture('static', earthTexture);
          return;
        }

        rememberEarthTexture(validKey, composite.texture);
        applyEarthTexture(validKey, composite.texture);
      }).catch(() => {
        if (!disposed && loadingEarthTextureKey === key) {
          layers.forEach((layer) => unavailableEarthLayerKeys.add(layer.cacheKey));
          loadingEarthTextureKey = null;
          applyEarthTexture('static', earthTexture);
        }
      });
    };
    syncEarthTextureForDate(simTimeRef.current);

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

    const binaryPrimaryStar = createBinaryStarMesh(0xffc46b);
    const binarySecondaryStar = createBinaryStarMesh(0xaed7ff);
    binaryGroup.add(binaryPrimaryStar, binarySecondaryStar);

    const binaryPlanetGroup = new THREE.Group();
    const binaryPlanetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(7.8, 96, 48),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0f172a,
        emissiveIntensity: 0.08,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    binaryPlanetMesh.castShadow = true;
    binaryPlanetMesh.receiveShadow = true;
    binaryPlanetMesh.userData.body = 'binaryPlanet';
    const binaryPlanetBand = new THREE.Mesh(
      new THREE.SphereGeometry(7.86, 96, 24),
      new THREE.MeshBasicMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    binaryPlanetBand.scale.set(1.012, 0.82, 1.012);
    binaryPlanetGroup.add(binaryPlanetMesh, binaryPlanetBand);
    binaryGroup.add(binaryPlanetGroup);

    const binaryMoonGroup = new THREE.Group();
    const binaryMoonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BINARY_MOON_SCENE_RADIUS, 96, 48),
      new THREE.MeshStandardMaterial({
        color: 0x9c89c9,
        roughness: 0.94,
        metalness: 0.01,
      }),
    );
    binaryMoonMesh.castShadow = true;
    binaryMoonMesh.receiveShadow = true;
    binaryMoonMesh.userData.body = 'binaryMoon';
    binaryMoonGroup.add(binaryMoonMesh);
    binaryGroup.add(binaryMoonGroup);

    const binaryPlanetPathLine = createBinaryPathLine(0x93c5fd, 0.3);
    const binaryMoonPathLine = createBinaryPathLine(0xd8b4fe, 0.42);
    binaryGroup.add(binaryPlanetPathLine, binaryMoonPathLine);

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

    const infiniteSunDisk = createInfiniteSunDisk();
    camera.add(infiniteSunDisk);

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

    const binaryPrimaryLight = new THREE.DirectionalLight(0xffd6a1, 3.2);
    const binarySecondaryLight = new THREE.DirectionalLight(0xc7ddff, 1.9);
    binaryPrimaryLight.castShadow = true;
    binaryPrimaryLight.shadow.mapSize.set(1024, 1024);
    binarySecondaryLight.castShadow = true;
    binarySecondaryLight.shadow.mapSize.set(1024, 1024);
    binaryPrimaryLight.visible = false;
    binarySecondaryLight.visible = false;
    scene.add(binaryPrimaryLight, binaryPrimaryLight.target);
    scene.add(binarySecondaryLight, binarySecondaryLight.target);

    const moonPathLine = createMoonPathLine();
    scene.add(moonPathLine);

    const eclipseLine = createTwoPointLine(0xf97316);
    scene.add(eclipseLine);

    const skyDome = createSurfaceSkyDome();
    skyDome.visible = false;
    scene.add(skyDome);

    const surfaceMoonProxy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.MeshStandardMaterial({
        map: moonTexture,
        bumpMap: moonBump,
        bumpScale: 0.012,
        roughness: 0.94,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      }),
    );
    surfaceMoonProxy.renderOrder = 7;
    surfaceMoonProxy.frustumCulled = false;
    surfaceMoonProxy.visible = false;
    scene.add(surfaceMoonProxy);

    surfaceEarthMaterial = new THREE.MeshStandardMaterial({
      map: earthMaterial.map,
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const surfaceEarthProxy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      surfaceEarthMaterial,
    );
    surfaceEarthProxy.renderOrder = 7;
    surfaceEarthProxy.frustumCulled = false;
    surfaceEarthProxy.visible = false;
    scene.add(surfaceEarthProxy);

    const surfaceSunProxy = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xfff1b8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    surfaceSunProxy.renderOrder = 6;
    surfaceSunProxy.frustumCulled = false;
    surfaceSunProxy.visible = false;
    scene.add(surfaceSunProxy);

    const binaryPrimaryProxy = createStarProxy(0xffd59b);
    const binarySecondaryProxy = createStarProxy(0xbddcff);
    binaryPrimaryProxy.frustumCulled = false;
    binarySecondaryProxy.frustumCulled = false;
    scene.add(binaryPrimaryProxy, binarySecondaryProxy);

    const alienGroup = createAlienGroup();
    scene.add(alienGroup);

    const northPoleGroup = createPoleMarkerGroup('north');
    const southPoleGroup = createPoleMarkerGroup('south');
    const homeMarkerGroup = createHomeMarkerGroup();
    const penguinFamilyGroup = createPenguinFamilyGroup();
    scene.add(northPoleGroup, southPoleGroup, homeMarkerGroup, penguinFamilyGroup);

    const labels = {
      earth: createLabelSprite('Earth'),
      moon: createLabelSprite('Moon'),
      sun: createLabelSprite('Sun'),
      path: createLabelSprite('Moon path', new THREE.Vector3(5.6, 1.7, 1)),
      eclipse: createLabelSprite('Eclipse window', new THREE.Vector3(6.4, 1.7, 1)),
    };
    scene.add(labels.earth, labels.moon, labels.sun, labels.path, labels.eclipse);

    const binaryLabels = {
      primaryStar: createLabelSprite('Primary', new THREE.Vector3(5.1, 1.6, 1)),
      secondaryStar: createLabelSprite('Secondary', new THREE.Vector3(5.6, 1.6, 1)),
      planet: createLabelSprite('Aster', new THREE.Vector3(4.4, 1.6, 1)),
      binaryMoon: createLabelSprite('Binary moon', new THREE.Vector3(6.2, 1.6, 1)),
      planetPath: createLabelSprite('Planet path', new THREE.Vector3(6.2, 1.6, 1)),
      moonPath: createLabelSprite('Moon path', new THREE.Vector3(5.8, 1.6, 1)),
    };
    scene.add(
      binaryLabels.primaryStar,
      binaryLabels.secondaryStar,
      binaryLabels.planet,
      binaryLabels.binaryMoon,
      binaryLabels.planetPath,
      binaryLabels.moonPath,
    );

    const objects: SceneObjects = {
      scene,
      camera,
      renderer,
      starField,
      earthGroup,
      moonGroup,
      binaryGroup,
      binaryPrimaryStar,
      binarySecondaryStar,
      binaryPlanetGroup,
      binaryMoonGroup,
      binaryPlanetMesh,
      binaryMoonMesh,
      earthMesh,
      earthNightOverlay,
      moonMesh,
      sunMesh,
      infiniteSunDisk,
      sunLight,
      binaryPrimaryLight,
      binarySecondaryLight,
      earthAtmosphere,
      skyDome,
      surfaceMoonProxy,
      surfaceEarthProxy,
      surfaceSunProxy,
      binaryPrimaryProxy,
      binarySecondaryProxy,
      moonPathLine,
      binaryPlanetPathLine,
      binaryMoonPathLine,
      eclipseLine,
      lunarEclipseTint,
      alienGroup,
      northPoleGroup,
      southPoleGroup,
      homeMarkerGroup,
      penguinFamilyGroup,
      labels,
      binaryLabels,
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

    const setActiveWorldMode = (nextWorldMode: WorldMode) => {
      worldModeRef.current = nextWorldMode;
      setWorldMode(nextWorldMode);
    };

    const syncEarthMoonTransforms = () => {
      moonGroup.position.copy(getMoonScenePosition(latestSnapshot, scaleModeRef.current));
      earthGroup.rotation.y = latestSnapshot.earthRotationRadians;
      moonGroup.rotation.y = latestSnapshot.moonRotationRadians;
    };

    const syncBinaryTransforms = () => {
      updateBinaryScene(objects, latestBinarySnapshot, 'compact');
    };

    const createAlienState = (
      nextWorldMode: WorldMode,
      surface: SurfaceState,
    ): AlienState => {
      const bobSeed = ALIEN_RESPAWN_SEED + simTimeRef.current.getTime() * 0.000001;
      const anchorPose = spawnAlienFarFromPlayer(
        surface.pose,
        BODY_CONFIG[surface.body].radius,
        bobSeed,
      );
      return {
        worldMode: nextWorldMode,
        pose: getAlienIdlePatrolPose(
          { ...surface, pose: anchorPose },
          performance.now(),
          bobSeed,
        ),
        anchorPose,
        status: 'idle',
        bobSeed,
      };
    };

    const startSurfaceTransition = (
      surface: SurfaceState,
      duration = 950,
    ) => {
      if (surface.body === 'binaryMoon') {
        syncBinaryTransforms();
      } else {
        syncEarthMoonTransforms();
      }

      const { eye, target, headUp } = getSurfaceCameraVectors(objects, surface);
      surfaceRef.current = surface;
      setSurfaceBody(surface.body);
      requestPointerLock();
      beginTransition(eye, target, () => {
        modeRef.current = 'surface';
        setMode('surface');
      }, duration, headUp);
    };

    const teleportAfterAlienCatch = () => {
      const currentSurface = surfaceRef.current;
      if (!currentSurface || !isAlienSurface(worldModeRef.current, currentSurface.body)) return;

      const nextWorldMode = nextAlienWorldMode(worldModeRef.current);
      if (worldModeRef.current === 'earthMoonSun') {
        earthMoonReturnPoseRef.current = currentSurface.pose;
      }

      const nextBody: BodyId = nextWorldMode === 'binarySystem' ? 'binaryMoon' : 'moon';
      const nextConfig = BODY_CONFIG[nextBody];
      const savedPose = nextWorldMode === 'earthMoonSun'
        ? earthMoonReturnPoseRef.current
        : null;
      const nextPose = savedPose && nextBody === 'moon'
        ? savedPose
        : createSurfacePose(
          nextConfig.radius,
          nextWorldMode === 'binarySystem' ? 0.18 : 0.08,
          nextWorldMode === 'binarySystem' ? -0.72 : -0.42,
          nextWorldMode === 'binarySystem' ? 0.46 : 0.18,
        );
      const nextSurface: SurfaceState = {
        body: nextBody,
        pose: nextPose,
        pitch: 0.06,
      };

      alienRef.current = createAlienState(nextWorldMode, nextSurface);
      keysRef.current.clear();
      setActiveWorldMode(nextWorldMode);
      startSurfaceTransition(nextSurface, 1250);
    };

    const updateAlienForSurface = (
      surface: SurfaceState,
      elapsed: number,
      now: number,
    ) => {
      const activeWorld = worldModeRef.current;
      if (!isAlienSurface(activeWorld, surface.body)) {
        alienGroup.visible = false;
        return;
      }

      if (!alienRef.current || alienRef.current.worldMode !== activeWorld) {
        alienRef.current = createAlienState(activeWorld, surface);
      }

      const alien = alienRef.current;
      if (alien.status === 'caught') {
        alienGroup.visible = false;
        return;
      }

      const config = BODY_CONFIG[surface.body];
      let walkAmount = 0;
      if (alien.status === 'idle') {
        const patrolPose = getAlienIdlePatrolPose(
          { ...surface, pose: alien.anchorPose },
          now,
          alien.bobSeed,
        );
        const distanceToPatrol = vectorFromPlain(patrolPose.position)
          .distanceTo(vectorFromPlain(alien.pose.position));
        const strollGate = Math.sin(now * 0.0008 + alien.bobSeed * 2.1);
        walkAmount = strollGate > -0.2
          ? 0.25 + Math.max(0, strollGate) * 0.75
          : 0;
        const idleStep = Math.min(
          distanceToPatrol,
          config.walkSpeed * ALIEN_IDLE_SPEED_RATIO * walkAmount * (elapsed / 1000),
        );
        if (idleStep > 0.0001) {
          alien.pose = moveAlienTowardPose(
            alien.pose,
            patrolPose,
            config.radius,
            idleStep,
          );
        }
      }
      animateAlienLegs(alienGroup, now, alien.bobSeed, walkAmount);

      if (isAlienCaught(surface.pose, alien.pose, getAlienCatchDistance(surface.body))) {
        alien.status = 'caught';
        alienGroup.visible = false;
        teleportAfterAlienCatch();
        return;
      }

      const bodyGroup = getBodyGroup(objects, surface.body);
      placeSurfaceGroup(
        alienGroup,
        bodyGroup,
        alien.pose,
        config.radius,
        config.eyeHeight * 0.04,
        config.eyeHeight * ALIEN_SCALE_EYE_HEIGHT_RATIO,
      );
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
      startSurfaceTransition(surface);
    };

    const returnToSpace = () => {
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      surfaceRef.current = null;
      setSurfaceBody(null);
      setSurfaceCompass(null);
      alienGroup.visible = false;
      const spaceView = getActiveSpaceView(
        worldModeRef.current,
        latestSnapshot,
        latestBinarySnapshot,
        scaleModeRef.current,
      );
      beginTransition(spaceView.position, spaceView.target, () => {
        modeRef.current = 'space';
        setMode('space');
        camera.up.copy(WORLD_CAMERA_UP);
        setSpaceCameraFromLookAt(camera.position, spaceView.target, spaceCameraRef.current);
        applySpaceCameraLook(camera, spaceCameraRef.current);
      });
    };

    const resetCamera = () => {
      if (modeRef.current === 'surface') {
        returnToSpace();
        return;
      }

      const spaceView = getActiveSpaceView(
        worldModeRef.current,
        latestSnapshot,
        latestBinarySnapshot,
        scaleModeRef.current,
      );
      beginTransition(spaceView.position, spaceView.target, () => {
        modeRef.current = 'space';
        setMode('space');
        camera.up.copy(WORLD_CAMERA_UP);
        setSpaceCameraFromLookAt(camera.position, spaceView.target, spaceCameraRef.current);
        applySpaceCameraLook(camera, spaceCameraRef.current);
      }, 700);
    };

    const releaseCanvasPointer = (pointerId: number) => {
      if (renderer.domElement.hasPointerCapture?.(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
        return;
      }

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
      if (!pointerState.down || pointerState.pointerId !== event.pointerId) {
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

      if (modeRef.current !== 'space') {
        return;
      }

      spaceCameraRef.current = applySpaceLookDrag(
        spaceCameraRef.current,
        dx,
        dy,
        SPACE_LOOK_SENSITIVITY,
      );
      if (Math.hypot(dx, dy) > 1) {
        recordTutorialInput('space-look');
      }
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

      const intersections = worldModeRef.current === 'binarySystem'
        ? raycaster.intersectObjects([binaryPlanetMesh, binaryMoonMesh], false)
        : raycaster.intersectObjects([earthMesh, moonMesh], false);
      const hit = intersections[0];
      const body = hit?.object.userData.body as BodyId | 'binaryPlanet' | undefined;
      if (hit && (body === 'earth' || body === 'moon')) {
        recordTutorialInput('space-land');
        enterSurface(body, hit.point);
      } else if (hit && body === 'binaryMoon') {
        recordTutorialInput('space-land');
        enterSurface('binaryMoon', hit.point);
      } else if (hit && body === 'binaryPlanet') {
        recordTutorialInput('space-land');
        const landingLocal = binaryMoonGroup.worldToLocal(camera.position.clone())
          .normalize()
          .multiplyScalar(BODY_CONFIG.binaryMoon.radius);
        enterSurface('binaryMoon', binaryMoonGroup.localToWorld(landingLocal));
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (pointerRef.current.pointerId !== event.pointerId) return;

      pointerRef.current.down = false;
      releaseCanvasPointer(event.pointerId);
    };

    const onDocumentMouseMove = (event: MouseEvent) => {
      if (!pointerLockedRef.current || modeRef.current !== 'surface' || !surfaceRef.current) {
        return;
      }

      if (Math.hypot(event.movementX, event.movementY) > 1) {
        recordTutorialInput('surface-look');
      }
      const surface = surfaceRef.current;
      const nextSurfaceLook = applySurfaceLookDrag(
        surface,
        event.movementX,
        event.movementY,
        SURFACE_LOOK_SENSITIVITY,
      );
      surface.pose = nextSurfaceLook.pose;
      surface.pitch = nextSurfaceLook.pitch;
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      pointerLockedRef.current = locked;
      setPointerLocked(locked);
    };

    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = keyName(event);
      if (
        key === 'arrowup'
        || key === 'arrowdown'
        || key === 'arrowleft'
        || key === 'arrowright'
        || key === 'space'
      ) {
        event.preventDefault();
      }
      if (modeRef.current === 'surface' && key === 'space') {
        recordTutorialInput('surface-return');
        returnToSpace();
        return;
      }
      keysRef.current.add(key);
      if (modeRef.current === 'space') {
        if (keyed(new Set([key]), 'w', 's')) {
          recordTutorialInput('space-forward');
        } else if (keyed(new Set([key]), 'a', 'd')) {
          recordTutorialInput('space-strafe');
        } else if (key === 'space') {
          recordTutorialInput('space-vertical');
        } else if (key === 'q' || key === 'e') {
          recordTutorialInput('space-roll');
        } else if (keyed(new Set([key]), 'arrowup', 'arrowdown', 'arrowleft', 'arrowright')) {
          recordTutorialInput('space-look');
        }
      } else if (modeRef.current === 'surface') {
        if (key === 'shift') {
          recordTutorialInput('surface-fast');
        } else if (keyed(new Set([key]), 'w', 's', 'arrowup', 'arrowdown')) {
          recordTutorialInput('surface-walk');
        } else if (keyed(new Set([key]), 'a', 'd', 'arrowleft', 'arrowright')) {
          recordTutorialInput('surface-strafe');
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(keyName(event));
    };

    const clearActiveKeys = () => {
      keysRef.current.clear();
    };

    const onWebglContextLost = (event: Event) => {
      event.preventDefault();
      disposed = true;
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      setSceneFailureMessage('The 3D graphics context stopped on this machine.');
      setSceneStatus('unavailable');
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    renderer.domElement.addEventListener('webglcontextlost', onWebglContextLost);
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearActiveKeys);

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
      latestBinarySnapshot = getBinarySystemSnapshot(simTimeRef.current);
      syncEarthTextureForDate(simTimeRef.current);
      setDisplayDate(new Date(simTimeRef.current));
      setPhase(latestSnapshot.phase);
      setEclipseState(latestSnapshot.eclipseState);
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
        latestSnapshot = getEarthMoonSunSnapshot(simTimeRef.current);
        latestBinarySnapshot = getBinarySystemSnapshot(simTimeRef.current);
        syncEarthTextureForDate(simTimeRef.current);
        lastSnapshotUpdate = now;
      }

      const snapshot = latestSnapshot;
      const binarySnapshot = latestBinarySnapshot;
      const activeWorld = worldModeRef.current;
      const isEarthMoonWorld = activeWorld === 'earthMoonSun';
      const isBinaryWorld = activeWorld === 'binarySystem';
      const activeSceneScaleMode: ScaleMode = isBinaryWorld ? 'compact' : scaleModeRef.current;
      const moonPosition = getMoonScenePosition(snapshot, scaleModeRef.current);
      const sunDirection = vectorFromPlain(snapshot.sunDirection).normalize();
      const compactSunPosition = getCompactSunPosition(sunDirection);
      const surfaceForScene = surfaceRef.current;
      const sunRenderMode = getSunRenderMode(
        activeSceneScaleMode,
        modeRef.current,
        surfaceForScene?.body ?? null,
      );
      const trueDistanceEarthSurface = modeRef.current === 'surface'
        && isEarthMoonWorld
        && surfaceForScene?.body === 'earth'
        && scaleModeRef.current === 'true';
      const trueDistanceMoonSurface = modeRef.current === 'surface'
        && isEarthMoonWorld
        && surfaceForScene?.body === 'moon'
        && scaleModeRef.current === 'true';
      const trueDistanceBinarySurface = modeRef.current === 'surface'
        && isBinaryWorld
        && surfaceForScene?.body === 'binaryMoon'
        && activeSceneScaleMode === 'true';
      let starHorizonUp: THREE.Vector3 | null = null;

      starField.position.copy(camera.position);
      moonGroup.position.copy(moonPosition);
      sunMesh.position.copy(compactSunPosition);
      earthGroup.visible = isEarthMoonWorld && !trueDistanceMoonSurface;
      moonGroup.visible = isEarthMoonWorld && !trueDistanceEarthSurface;
      objects.earthNightOverlay.visible = isEarthMoonWorld && modeRef.current === 'space';
      sunMesh.visible = isEarthMoonWorld && sunRenderMode === 'finite-scene';
      sunLight.visible = isEarthMoonWorld;
      binaryGroup.visible = isBinaryWorld;
      binaryPrimaryLight.visible = isBinaryWorld;
      binarySecondaryLight.visible = isBinaryWorld;
      binaryPrimaryStar.visible = isBinaryWorld && !trueDistanceBinarySurface;
      binarySecondaryStar.visible = isBinaryWorld && !trueDistanceBinarySurface;
      updateInfiniteSunDisk(objects, snapshot, isEarthMoonWorld && sunRenderMode === 'infinite-space');
      setSurfaceSkyProxiesHidden(objects);
      setBinaryStarProxiesHidden(objects);
      setSurfaceLandmarksHidden(objects);
      sunLight.position.copy(sunDirection.clone().multiplyScalar(180));
      sunLight.target.position.set(0, 0, 0);
      earthGroup.rotation.y = snapshot.earthRotationRadians;
      moonGroup.rotation.y = snapshot.moonRotationRadians;
      earthAtmosphere.material.uniforms.sunDirection.value.copy(sunDirection);
      objects.earthNightOverlay.material.uniforms.sunDirection.value.copy(sunDirection);
      updateMoonPathLine(objects, snapshot, scaleModeRef.current);
      if (isBinaryWorld) {
        updateBinaryScene(objects, binarySnapshot, activeSceneScaleMode);
      }
      if (isEarthMoonWorld) {
        setEclipseIndicator(objects, snapshot.eclipseState, moonPosition);
      } else {
        setEclipseIndicator(objects, null, moonPosition);
      }

      setLabelRecordVisible(labels, false);
      setLabelRecordVisible(binaryLabels, false);
      objects.moonPathLine.visible = isEarthMoonWorld && labelsVisibleRef.current && modeRef.current === 'space';
      labels.earth.visible = isEarthMoonWorld && labelsVisibleRef.current && modeRef.current === 'space';
      labels.moon.visible = isEarthMoonWorld && labelsVisibleRef.current && modeRef.current === 'space';
      labels.sun.visible = isEarthMoonWorld
        && labelsVisibleRef.current
        && modeRef.current === 'space'
        && sunRenderMode === 'finite-scene';
      labels.path.visible = isEarthMoonWorld && labelsVisibleRef.current && modeRef.current === 'space';
      labels.eclipse.visible = isEarthMoonWorld
        && labelsVisibleRef.current
        && Boolean(snapshot.eclipseState)
        && modeRef.current === 'space';
      labels.earth.position.set(0, EARTH_SCENE_RADIUS + 6.2, 0);
      labels.moon.position.copy(moonPosition).add(new THREE.Vector3(0, MOON_SCENE_RADIUS + 4.3, 0));
      labels.sun.position.copy(compactSunPosition).add(new THREE.Vector3(0, 14, 0));
      binaryPlanetPathLine.visible = isBinaryWorld && labelsVisibleRef.current && modeRef.current === 'space';
      binaryMoonPathLine.visible = isBinaryWorld && labelsVisibleRef.current && modeRef.current === 'space';
      if (isBinaryWorld && labelsVisibleRef.current && modeRef.current === 'space') {
        setLabelRecordVisible(binaryLabels, true);
      }

      const transition = transitionRef.current;
      if (transition) {
        const amount = Math.min(1, (now - transition.startTime) / transition.duration);
        const eased = easeInOutCubic(amount);
        const transitionTarget = new THREE.Vector3();
        const transitionUp = new THREE.Vector3();
        camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
        transitionTarget.lerpVectors(transition.fromTarget, transition.toTarget, eased);
        transitionUp.lerpVectors(transition.fromUp, transition.toUp, eased);
        camera.up.copy(
          transitionUp.lengthSq() > 1e-8
            ? transitionUp.normalize()
            : WORLD_CAMERA_UP,
        );
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

        const { eye, target, headUp, worldUp } = getSurfaceCameraVectors(objects, surface);
        const sky = getSurfaceSkyState(snapshot.sunDirection, plainFromVector(worldUp));
        starHorizonUp = worldUp.clone();

        camera.position.copy(eye);
        camera.up.copy(headUp);
        camera.lookAt(target);
        skyDome.visible = isEarthMoonWorld && surface.body === 'earth';
        skyDome.position.copy(camera.position);
        skyDome.material.uniforms.sunDirection.value.copy(sunDirection);
        skyDome.material.uniforms.upDirection.value.copy(worldUp);
        skyDome.material.uniforms.daylight.value = sky.daylight;
        skyDome.material.uniforms.twilight.value = sky.twilight;
        skyDome.material.uniforms.night.value = sky.night;
        if (
          isEarthMoonWorld
          && (surface.body === 'earth' || surface.body === 'moon')
          && scaleModeRef.current === 'true'
        ) {
          updateSurfaceSkyProxies(objects, snapshot, camera.position, worldUp, surface.body);
        }
        if (trueDistanceBinarySurface) {
          updateBinaryStarProxies(objects, binarySnapshot, camera.position, worldUp);
        }
        updateAlienForSurface(surface, elapsed, now);
        updateSurfaceLandmarks(objects, surface, homeSurfaceRef.current, now);
      } else {
        skyDome.visible = false;
        alienGroup.visible = false;
        setSurfaceLandmarksHidden(objects);
        if (modeRef.current === 'space') {
          const keys = keysRef.current;
          const forwardRaw = Number(keyed(keys, 'w')) - Number(keyed(keys, 's'));
          const rightRaw = Number(keyed(keys, 'd')) - Number(keyed(keys, 'a'));
          const upRaw = keys.has('space')
            ? keys.has('shift') ? -1 : 1
            : 0;
          const yawRaw = Number(keys.has('arrowright')) - Number(keys.has('arrowleft'));
          const pitchRaw = Number(keys.has('arrowup')) - Number(keys.has('arrowdown'));
          const rollRaw = Number(keys.has('e')) - Number(keys.has('q'));
          const input = normalizedAxisInput(forwardRaw, rightRaw, upRaw);
          const speedBoost = keys.has('shift') && !keys.has('space') ? 4 : 1;
          const baseSpeed = activeSceneScaleMode === 'true' ? 185 : 58;
          const distance = baseSpeed * speedBoost * (elapsed / 1000);
          const lookDistance = SPACE_KEY_LOOK_SPEED * (elapsed / 1000);

          if (yawRaw !== 0 || pitchRaw !== 0) {
            spaceCameraRef.current = applySpaceKeyLook(
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
            const nextPosition = applySpaceTranslation(
              plainFromVector(camera.position),
              basis,
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
          const longitudeRadians = surface.body === 'earth'
            ? -coords.longitudeRadians
            : coords.longitudeRadians;
          setSurfaceCoords({
            latitude: coords.latitudeRadians * 180 / Math.PI,
            longitude: longitudeRadians * 180 / Math.PI,
          });
          setSurfaceCompass(getSurfaceCompassState(
            surface,
            homeSurfaceRef.current,
            isAlienSurface(worldModeRef.current, surface.body) ? alienRef.current : null,
          ));
        } else {
          setSurfaceCompass(null);
        }
      }

      updateStarFieldOcclusion(objects, snapshot, starHorizonUp);
      renderer.render(scene, camera);
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    setSceneFailureMessage('The 3D scene could not start on this machine.');
    setSceneStatus('ready');

    return () => {
      disposed = true;
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      renderer.domElement.removeEventListener('webglcontextlost', onWebglContextLost);
      document.removeEventListener('mousemove', onDocumentMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearActiveKeys);
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
      earthTextureCache.forEach((texture) => texture.dispose());
      renderer.dispose();
      disposeSceneGraph(scene);
      removeRendererCanvas(renderer, mount);
      objectsRef.current = null;
    };
    } catch {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      if (startupRenderer && document.pointerLockElement === startupRenderer.domElement) {
        document.exitPointerLock();
      }
      startupRenderer?.dispose();
      disposeSceneGraph(startupScene);
      removeRendererCanvas(startupRenderer, mount);
      objectsRef.current = null;
      setPointerLocked(false);
      setMode('space');
      setSurfaceBody(null);
      setSurfaceCompass(null);
      setSceneFailureMessage('The 3D scene could not start on this machine.');
      setSceneStatus('unavailable');
      return undefined;
    }
  }, [sceneRetryKey]);

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
      : worldMode === 'binarySystem'
        ? 'Binary space'
        : 'Space';

  const hudScaleMode: ScaleMode = worldMode === 'binarySystem' ? 'compact' : scaleMode;

  const controlModeLabel = mode === 'surface'
    ? pointerLocked
      ? 'Mouse look'
      : 'Drag to look'
    : hudScaleMode;
  const sceneUnavailable = sceneStatus === 'unavailable';
  const activeTutorialSteps = tutorialState
    ? tutorialStepsForMode(tutorialState.mode)
    : [];
  const activeTutorialStep = tutorialState
    ? activeTutorialSteps[tutorialState.stepIndex] ?? null
    : null;
  const visibleCompassMarkers = surfaceCompass && mode === 'surface'
    ? surfaceCompass.markers.filter((marker) => Math.abs(marker.offsetDegrees) <= COMPASS_DISPLAY_DEGREES)
    : [];
  const releaseHudButtonFocus = (event: SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.moon-hud button')) return;
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('.moon-hud') && activeElement.matches('button')) {
        activeElement.blur();
      }
    }, 0);
  };

  return (
    <div
      className={[
        'moon-phase-sandbox',
        mode === 'surface' ? 'is-surface' : '',
        sceneUnavailable ? 'is-scene-unavailable' : '',
        sceneStatus === 'initializing' ? 'is-scene-initializing' : '',
        timePanelOpen ? 'has-time-panel-open' : 'has-time-panel-collapsed',
        readoutsVisible ? 'has-readouts' : 'has-hidden-readouts',
      ].filter(Boolean).join(' ')}
      onClickCapture={releaseHudButtonFocus}
    >
      <div ref={mountRef} className="moon-phase-canvas" aria-label="Earth Moon Sun 3D sandbox" />

      {sceneUnavailable && (
        <section className="moon-hud moon-scene-fallback" aria-live="polite">
          <div>
            <span>3D scene unavailable</span>
            <strong>{sceneFailureMessage}</strong>
          </div>
          <button
            type="button"
            className="moon-text-button"
            onClick={() => setSceneRetryKey((value) => value + 1)}
          >
            Retry
          </button>
        </section>
      )}

      {activeTutorialStep && tutorialState && (
        <section
          className={`moon-hud moon-tutorial ${tutorialState.status === 'advancing' ? 'is-advancing' : ''}`}
          aria-live="polite"
          aria-label={`${tutorialState.mode} camera tutorial`}
        >
          <div className="moon-tutorial-header">
            <span>
              {tutorialState.mode === 'space' ? 'Space controls' : 'Surface controls'}
              {' '}
              {tutorialState.stepIndex + 1}/{activeTutorialSteps.length}
            </span>
            <button
              type="button"
              className="moon-icon-button moon-tutorial-close"
              onClick={dismissTutorial}
              aria-label="Close tutorial"
              title="Close tutorial"
            >
              <X size={16} />
            </button>
          </div>
          <div className="moon-tutorial-body">
            <strong>{activeTutorialStep.title}</strong>
            <p>{activeTutorialStep.prompt}</p>
            <kbd>{activeTutorialStep.hint}</kbd>
          </div>
        </section>
      )}

      {readoutsVisible ? (
        <header className="moon-hud moon-hud-primary" aria-label="Moon phase information">
          <div className="moon-readouts">
            {worldMode === 'earthMoonSun' && (
              <>
                <div className="moon-readout-phase">
                  <span>Phase</span>
                  <strong>{phase.phaseName}</strong>
                </div>
                <div className="moon-readout-lit">
                  <span>Lit</span>
                  <strong>{formatPercent(phase.illuminationFraction)}</strong>
                </div>
              </>
            )}
            <div className="moon-readout-view">
              <span>View</span>
              <strong>{locationLabel}</strong>
            </div>
            {worldMode === 'earthMoonSun' && eclipseState && (
              <div className="moon-eclipse-readout">
                <span>Eclipse</span>
                <strong>{eclipseState.label}</strong>
              </div>
            )}
          </div>
          <button
            type="button"
            className="moon-icon-button moon-panel-action"
            onClick={() => setReadoutsVisible(false)}
            aria-label="Hide phase information"
            title="Hide info"
          >
            <EyeOff size={17} />
          </button>
        </header>
      ) : (
        <button
          type="button"
          className="moon-hud moon-icon-button moon-info-toggle"
          onClick={() => setReadoutsVisible(true)}
          aria-label="Show phase information"
          title="Show info"
        >
          <Info size={17} />
        </button>
      )}

      <section
        className={`moon-hud moon-time-panel ${timePanelOpen ? 'is-open' : 'is-collapsed'}`}
        aria-label="Time controls"
      >
        <div className="moon-time-header">
          <div className="moon-date">
            <span>{hydrated ? toDisplayDate(displayDate) : 'Starting clock'}</span>
          </div>
          <button
            type="button"
            className="moon-icon-button moon-panel-action"
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
          </>
        )}
      </section>

      {mode === 'surface' && surfaceCompass && (
        <section className="moon-hud moon-surface-compass" aria-label="Surface compass">
          <div className="moon-compass-bar">
            <span className="moon-compass-center" aria-hidden="true" />
            {visibleCompassMarkers.map((marker) => (
              <span
                key={marker.id}
                className={`moon-compass-marker is-${marker.kind}`}
                style={{ left: `${compassPositionPercent(marker.offsetDegrees)}%` }}
                title={marker.label}
              >
                {marker.shortLabel}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="moon-hud moon-view-panel" aria-label="View controls">
        {worldMode === 'earthMoonSun' ? (
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
        ) : (
          <div className="moon-segmented" aria-label="Binary system scale">
            <button type="button" aria-pressed="true" disabled>
              Compact
            </button>
          </div>
        )}
        <label className="moon-toggle">
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
            className="moon-text-button moon-space-button"
            onClick={() => {
              recordTutorialInput('surface-return');
              returnToSpace();
            }}
          >
            Space
          </button>
        )}
        <div className="moon-location-pill">
          <LocateFixed size={15} aria-hidden="true" />
          <span>{mode === 'surface' ? controlModeLabel : hudScaleMode}</span>
        </div>
      </section>
    </div>
  );
}
