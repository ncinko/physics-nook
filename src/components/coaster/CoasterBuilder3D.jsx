// CoasterBuilder3D.jsx
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  GRAVITY,
  INITIAL_SPEED,
  stepRideSpeed,
  gForces,
  energy,
} from "../../lib/coaster/rideModel";
import "./coasterBuilder3D.css";

const SEGMENT_DEFS = {
  START: { label: "Station", icon: "flag", color: 0x334155 },
  STRAIGHT: {
    label: "Straight",
    len: 20,
    icon: "minus",
    variants: [
      { id: "NORMAL", label: "Standard", color: 0x3b82f6 },
      { id: "BOOST", label: "Booster", color: 0x10b981, force: 20 },
      { id: "BRAKE", label: "Brakes", color: 0xef4444, drag: 0.3 },
    ],
  },
  UP: {
    label: "Hill Up",
    len: 20,
    height: 10,
    icon: "arrow-up",
    variants: [
      { id: "NORMAL", label: "Standard", color: 0x3b82f6 },
      { id: "CHAIN", label: "Chain Lift", color: 0xb45309, chainSpeed: 8 },
    ],
  },
  DOWN: {
    label: "Drop",
    len: 20,
    height: -10,
    icon: "arrow-down",
    color: 0x3b82f6,
  },
  LEFT: {
    label: "Left Turn",
    len: 30,
    radius: 20,
    icon: "corner-up-left",
    color: 0x3b82f6,
    variants: [
      { id: "TIGHT", label: "Tight", radius: 10, color: 0x3b82f6 },
      { id: "NORMAL", label: "Normal", radius: 20, color: 0x3b82f6 },
      { id: "WIDE", label: "Wide", radius: 40, color: 0x3b82f6 },
    ],
  },
  RIGHT: {
    label: "Right Turn",
    len: 30,
    radius: 20,
    icon: "corner-up-right",
    color: 0x3b82f6,
    variants: [
      { id: "TIGHT", label: "Tight", radius: 10, color: 0x3b82f6 },
      { id: "NORMAL", label: "Normal", radius: 20, color: 0x3b82f6 },
      { id: "WIDE", label: "Wide", radius: 40, color: 0x3b82f6 },
    ],
  },
  LOOP: { label: "Loop", len: 10, radius: 12, icon: "rotate-ccw", color: 0x3b82f6 },
};

// Minimal SVG icon set (no dependency)
function Icon({ name, size = 18 }) {
  const icons = {
    flag: (
      <>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" x2="4" y1="22" y2="15" />
      </>
    ),
    "arrow-up": (
      <>
        <line x1="12" x2="12" y1="19" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </>
    ),
    "arrow-down": (
      <>
        <line x1="12" x2="12" y1="5" y2="19" />
        <polyline points="19 12 12 19 5 12" />
      </>
    ),
    "corner-up-left": (
      <>
        <polyline points="9 14 4 9 9 4" />
        <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
      </>
    ),
    "corner-up-right": (
      <>
        <polyline points="15 14 20 9 15 4" />
        <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
      </>
    ),
    minus: <line x1="5" x2="19" y1="12" y2="12" />,
    "refresh-cw": (
      <>
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 21h5v-5" />
      </>
    ),
    play: <polygon points="5 3 19 12 5 21 5 3" />,
    square: <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />,
    video: (
      <>
        <path d="m22 8-6 4 6 4V8Z" />
        <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
      </>
    ),
    "rotate-ccw": (
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    anchor: (
      <>
        <circle cx="12" cy="5" r="3" />
        <line x1="12" x2="12" y1="22" y2="8" />
        <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
      </>
    ),
    "chevrons-up": (
      <>
        <polyline points="17 11 12 6 7 11" />
        <polyline points="17 18 12 13 7 18" />
      </>
    ),
    minimize: (
      <>
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
      </>
    ),
    maximize: (
      <>
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
      </>
    ),
    activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </>
    ),
    move: (
      <>
        <polyline points="5 9 2 12 5 15" />
        <polyline points="9 5 12 2 15 5" />
        <polyline points="15 19 12 22 9 19" />
        <polyline points="19 9 22 12 19 15" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="12" y1="2" x2="12" y2="22" />
      </>
    ),
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name] || icons.square}
    </svg>
  );
}

// Map a g-force reading to a comfort color: green when gentle, ramping through
// amber to red as the magnitude approaches and passes an uncomfortable redline.
function gForceColor(value, redline) {
  const t = Math.min(1, Math.abs(Number(value) || 0) / redline);
  const hue = 120 - 120 * t; // 120 (green) -> 0 (red)
  return `hsl(${hue}, 78%, 45%)`;
}

export default function CoasterBuilder3D({ height = 820, className = "" }) {
  const [segments, setSegments] = useState([{ type: "START", variant: "NORMAL" }]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [cameraMode, setCameraMode] = useState("ORBIT");
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [safetyOn, setSafetyOn] = useState(true);
  const [autoOrbitOn, setAutoOrbitOn] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [stats, setStats] = useState({
    velocity: 0,
    gVertical: 0,
    gLateral: 0,
    gTotal: 0,
    pe: 0,
    ke: 0,
  });

  // DOM refs
  const wrapRef = useRef(null); // outer wrapper (for focus/fullscreen)
  const mountRef = useRef(null); // canvas sizing context

  // Three refs
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const curveRef = useRef(null);
  const cartRef = useRef(null);
  const birdsRef = useRef([]);
  const deerRef = useRef([]);

  // Track meta (used for lap wrap + deer boarding)
  const trackMetaRef = useRef({
    isCircuit: false,
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(0, 0, 0),
    startTangent: new THREE.Vector3(0, 0, 1),
    endTangent: new THREE.Vector3(0, 0, 1),
  });

  // When a circuit is formed, we choose ONE closest deer to the station and have it run to the cart.
  const riderRef = useRef(null);

  // Mirror sim state for hot loops
  const isSimulatingRef = useRef(isSimulating);
  useEffect(() => {
    isSimulatingRef.current = isSimulating;
  }, [isSimulating]);

  const safetyOnRef = useRef(safetyOn);
  useEffect(() => {
    safetyOnRef.current = safetyOn;
  }, [safetyOn]);

  const autoOrbitOnRef = useRef(autoOrbitOn);
  useEffect(() => {
    autoOrbitOnRef.current = autoOrbitOn;
  }, [autoOrbitOn]);

  // Control/physics refs
  const controlsRef = useRef({
    rotation: 0.5,
    pitch: 0.5,
    zoom: 120,
    target: new THREE.Vector3(0, 0, 0),
  });
  const keysRef = useRef({ w: false, a: false, s: false, d: false });

  const physicsRef = useRef({
    t: 0,
    velocity: INITIAL_SPEED,
    lastVel: new THREE.Vector3(),
    lastBinormal: new THREE.Vector3(1, 0, 0),
    isOffTrack: false,
    offTrackState: null,
  });

  const segmentsMapRef = useRef([]);
  const swarmModeRef = useRef(false);
  const maxEnergyRef = useRef(5000);

  // Pointer-over-canvas gate for wheel capture
  const isPointerOverSimRef = useRef(false);

  // State mirrors for hot loops
  const cameraModeRef = useRef(cameraMode);
  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  // Smooth render state (prev/curr) for interpolation + fixed-step accumulator
  const renderStateRef = useRef({
    prevT: 0,
    currT: 0,
    prevVel: INITIAL_SPEED,
    currVel: INITIAL_SPEED,
    prevBinormal: new THREE.Vector3(1, 0, 0),
    currBinormal: new THREE.Vector3(1, 0, 0),
    accumulator: 0,
    lastTime: performance.now(),
    statsTimer: 0,
  });

  // Fullscreen state tracking
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const resizeToContainer = () => {
    const mount = mountRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!mount || !renderer || !camera) return;

    const rect = mount.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const toggleFullscreen = async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      // Browser may block; focus mode still works.
    }
  };

  // --- Physics single fixed-step (called from RAF loop) ---
  const stepPhysics = (dt) => {
    const curve = curveRef.current;
    const cart = cartRef.current;
    if (!curve || !cart) return null;

    const phys = physicsRef.current;
    const map = segmentsMapRef.current;

    // Off-track projectile motion
    if (phys.isOffTrack) {
      if (phys.offTrackState) {
        const { pos, vel, angVel, quat } = phys.offTrackState;
        vel.y -= GRAVITY * dt;
        pos.addScaledVector(vel, dt);

        const deltaRotation = new THREE.Quaternion().setFromAxisAngle(angVel, dt).normalize();
        quat.premultiply(deltaRotation);
        
        if (pos.y < 0.6) {
           // Simplified ground collision
           resetSim();
        }
      }
      return null; // No telemetry when off-track
    }


    const currentSeg =
      map.find((s) => phys.t >= s.startT && phys.t < s.endT) || map[map.length - 1];

    const point = curve.getPointAt(phys.t);
    const tangent = curve.getTangentAt(phys.t).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Parallel transport-ish frame (your logic)
    let frameBinormal = phys.lastBinormal.clone().projectOnPlane(tangent).normalize();
    if (frameBinormal.length() === 0) frameBinormal = new THREE.Vector3(1, 0, 0);

    let worldBinormal = new THREE.Vector3().crossVectors(tangent, worldUp);
    if (worldBinormal.length() > 0.9 && worldBinormal.dot(frameBinormal) > 0.9) {
      frameBinormal.lerp(worldBinormal, 0.1).normalize();
    }
    phys.lastBinormal.copy(frameBinormal);

    const normal = new THREE.Vector3().crossVectors(frameBinormal, tangent).normalize();
    const localUp = normal;

    // Resolve active segment modifiers, then integrate the along-track velocity
    // with the pure model in lib/coaster/rideModel.
    let chainTarget = null;
    let boostForce = 0;
    let brakeDrag = 0;

    if (currentSeg) {
      if (currentSeg.type === "UP" && currentSeg.variant === "CHAIN") {
        const def = SEGMENT_DEFS.UP.variants.find((v) => v.id === "CHAIN");
        chainTarget = def?.chainSpeed ?? 5;
      }

      if (currentSeg.type === "STRAIGHT" && currentSeg.variant === "BOOST") {
        const def = SEGMENT_DEFS.STRAIGHT.variants.find((v) => v.id === "BOOST");
        boostForce = def?.force ?? 12;
      }

      if (currentSeg.type === "STRAIGHT" && currentSeg.variant === "BRAKE") {
        const def = SEGMENT_DEFS.STRAIGHT.variants.find((v) => v.id === "BRAKE");
        brakeDrag = def?.drag ?? 2.0;
      }
    }

    phys.velocity = stepRideSpeed({
      speed: phys.velocity,
      slopeY: tangent.y,
      dt,
      chainTarget,
      boostForce,
      brakeDrag,
    });

    // Integrate position along curve (Curve.getPointAt is arc-length parameterized)
    const len = curve.getLength();
    phys.t += (phys.velocity * dt) / len;

    // Wrap/clamp
    const isCircuitNow = !!trackMetaRef.current?.isCircuit;
    if (isCircuitNow) {
      while (phys.t >= 1) phys.t -= 1;
      while (phys.t < 0) phys.t += 1;
    } else {
      if (phys.t >= 1) {
        phys.t = 0;
        phys.velocity = INITIAL_SPEED;
        phys.lastVel.set(0, 0, 0);
      }
      if (phys.t < 0) {
        phys.t = 0;
        phys.velocity = 0;
      }
    }

    // Telemetry
    const vVec = tangent.clone().multiplyScalar(phys.velocity);
    const accelVec = vVec.clone().sub(phys.lastVel).divideScalar(dt);
    phys.lastVel.copy(vVec);

    const gVec = new THREE.Vector3(0, -GRAVITY, 0);
    const feltAccel = accelVec.sub(gVec);

    const { vertG, latG, totalG } = gForces(feltAccel, localUp, frameBinormal);

    // Swarm check
    const isRiderActive = riderRef.current !== null;
    if (isRiderActive && totalG > 8 && !swarmModeRef.current) {
        swarmModeRef.current = true;
    }
    
    // Safety check
    if (!safetyOnRef.current && !phys.isOffTrack) {
        if (vertG < 0 || Math.abs(latG) > 2.5) {
            phys.isOffTrack = true;
            phys.offTrackState = {
                pos: point.clone(),
                vel: vVec.clone(),
                angVel: new THREE.Vector3(
                  (Math.random() - 0.5) * 2,
                  (Math.random() - 0.5) * 2,
                  (Math.random() - 0.5) * 2,
                ).normalize(),
                quat: cart.quaternion.clone(),
            };
            return null;
        }
    }


    const { pe, ke } = energy(phys.velocity, point.y);
    const totalE = pe + ke;
    if (totalE > maxEnergyRef.current) maxEnergyRef.current = totalE;

    return { point, tangent, normal, frameBinormal, vertG, latG, totalG, pe, ke };
  };

  // --- Init Three ---
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f5ff);
    scene.fog = new THREE.Fog(0xf0f5ff, 50, 600);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(100, 200, 100);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    scene.add(dir);

    // Ground + grid
    scene.add(new THREE.GridHelper(1000, 100, 0x708090, 0xa0b0c0));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshBasicMaterial({ color: 0x9dcc9a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Trees
    const createTree = () => {
      const group = new THREE.Group();

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.8, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.9 })
      );
      trunk.position.y = 1.5;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      group.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(4, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.8 })
      );
      foliage.position.y = 6;
      foliage.castShadow = true;
      foliage.receiveShadow = true;
      group.add(foliage);

      return group;
    };

    for (let i = 0; i < 80; i++) {
      const tree = createTree();
      const x = (Math.random() - 0.5) * 1000;
      const z = (Math.random() - 0.5) * 1000;
      if (Math.abs(x) < 50 && Math.abs(z) < 50) continue;
      tree.position.set(x, 0, z);
      const s = 0.8 + Math.random() * 0.6;
      tree.scale.set(s, s, s);
      tree.rotation.y = Math.random() * Math.PI * 2;
      scene.add(tree);
    }

    // Deer
    const createDeer = (hasAntlers, isStrafing) => {
      const group = new THREE.Group();
      const internalGroup = new THREE.Group();
      group.add(internalGroup);

      if (isStrafing) internalGroup.rotation.y = Math.PI / 2;

      const deerMat = new THREE.MeshStandardMaterial({ color: 0x8c5e35, roughness: 0.8 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 3), deerMat);
      body.position.y = 2.2;
      body.castShadow = true;
      internalGroup.add(body);

      const neckPivot = new THREE.Group();
      neckPivot.position.set(0, 2.8, 1.3);
      neckPivot.rotation.x = -0.5;
      internalGroup.add(neckPivot);

      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), deerMat);
      neck.position.y = 1;
      neck.castShadow = true;
      neckPivot.add(neck);

      const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.2), deerMat);
      head.position.set(0, 2.2, 0.4);
      head.castShadow = true;
      neckPivot.add(head);

      const earGeo = new THREE.BoxGeometry(0.15, 0.45, 0.25);
      const leftEar = new THREE.Mesh(earGeo, deerMat);
      leftEar.position.set(0.5, 0.6, -0.2);
      leftEar.rotation.z = -0.3;
      head.add(leftEar);

      const rightEar = new THREE.Mesh(earGeo, deerMat);
      rightEar.position.set(-0.5, 0.6, -0.2);
      rightEar.rotation.z = 0.3;
      head.add(rightEar);

      if (hasAntlers) {
        const antlerGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5);
        const left = new THREE.Mesh(antlerGeo, darkMat);
        left.position.set(0.3, 0.8, 0);
        left.rotation.set(0.2, 0, -0.5);
        head.add(left);

        const right = new THREE.Mesh(antlerGeo, darkMat);
        right.position.set(-0.3, 0.8, 0);
        right.rotation.set(0.2, 0, 0.5);
        head.add(right);
      }

      const legGeo = new THREE.BoxGeometry(0.5, 2.5, 0.5);
      const legPositions = [
        [-0.4, 1.25, -1.2],
        [0.4, 1.25, -1.2],
        [-0.4, 1.25, 1.2],
        [0.4, 1.25, 1.2],
      ];
      const legs = legPositions.map(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeo, deerMat);
        leg.position.set(x, y, z);
        leg.castShadow = true;
        internalGroup.add(leg);
        return leg;
      });

      return { group, internalGroup, neckPivot, legs };
    };

    const deerList = [];
    for (let i = 0; i < 15; i++) {
      const hasAntlers = Math.random() > 0.6;
      const isStrafing = Math.random() > 0.5;
      const deer = createDeer(hasAntlers, isStrafing);
      const x = (Math.random() - 0.5) * 1000;
      const z = (Math.random() - 0.5) * 1000;
      if (Math.abs(x) < 60 && Math.abs(z) < 60) continue;

      deer.group.position.set(x, 0, z);
      deer.group.rotation.y = Math.random() * Math.PI * 2;
      scene.add(deer.group);

      deerList.push({
        ...deer,
        state: 0,
        timer: Math.random() * 5,
        target: new THREE.Vector3(x, 0, z),
        isStrafing,
        flipProgress: 0,
      });
    }
    deerRef.current = deerList;

    // Birds
    const birdGeo = new THREE.PlaneGeometry(1.2, 0.4);
    birdGeo.rotateX(-Math.PI / 2);
    const lWingGeo = birdGeo.clone();
    lWingGeo.translate(-0.6, 0, 0);
    const rWingGeo = birdGeo.clone();
    rWingGeo.translate(0.6, 0, 0);
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });

    const birdData = [];
    for (let i = 0; i < 15; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(lWingGeo, birdMat));
      g.add(new THREE.Mesh(rWingGeo, birdMat));
      g.position.set(
        (Math.random() - 0.5) * 800,
        30 + Math.random() * 40,
        (Math.random() - 0.5) * 800
      );
      scene.add(g);

      const v = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(0.2 + Math.random() * 0.1);

      birdData.push({
        group: g,
        lWing: g.children[0],
        rWing: g.children[1],
        velocity: v,
        phase: Math.random() * Math.PI * 2,
      });
    }
    birdsRef.current = birdData;

    // Cart
    const cart = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 3.5),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.2, metalness: 0.6 })
    );
    body.position.y = 1.2;
    body.castShadow = true;
    cart.add(body);

    [-1, 1].forEach((z) => {
      const axle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e293b })
      );
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, 0.5, z * 1.2);
      cart.add(axle);
    });

    scene.add(cart);
    cartRef.current = cart;

    // --- Input wiring ---
    let dragType = null;
    let lastMouse = { x: 0, y: 0 };

    const onPointerEnter = () => {
      isPointerOverSimRef.current = true;
    };
    const onPointerLeave = () => {
      isPointerOverSimRef.current = false;
    };

    const onDown = (e) => {
      // Deer click raycast
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const deerGroups = deerRef.current.map((d) => d.group);
      const hits = raycaster.intersectObjects(deerGroups, true);

      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const deer = deerRef.current.find((d) => {
          let p = hitObj;
          while (p) {
            if (p === d.group) return true;
            p = p.parent;
          }
          return false;
        });
        if (deer) {
          deer.state = 3;
          deer.flipProgress = 0;
          return;
        }
      }

      if (e.button === 2) dragType = "PAN";
      else if (e.button === 0) dragType = "ROTATE";
      lastMouse = { x: e.clientX, y: e.clientY };
    };

    const onUp = () => {
      dragType = null;
    };

    const onMove = (e) => {
      if (!dragType || cameraModeRef.current === "RIDE") return;

      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      lastMouse = { x: e.clientX, y: e.clientY };

      if (dragType === "ROTATE") {
        controlsRef.current.rotation -= dx * 0.005;
        controlsRef.current.pitch = Math.max(
          0.1,
          Math.min(1.5, controlsRef.current.pitch + dy * 0.005)
        );
      } else if (dragType === "PAN") {
        const sensitivity = Math.sqrt(controlsRef.current.zoom) * 0.01;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        controlsRef.current.target.addScaledVector(right, -dx * sensitivity);
        controlsRef.current.target.addScaledVector(up, dy * sensitivity);
        controlsRef.current.target.y = Math.max(0, controlsRef.current.target.y);
      }
    };

    // Wheel zoom without scrolling page (only when pointer over canvas)
    const onWheel = (e) => {
      if (!isPointerOverSimRef.current) return;
      if (cameraModeRef.current === "RIDE") return;
      e.preventDefault();
      controlsRef.current.zoom = Math.max(10, Math.min(400, controlsRef.current.zoom + e.deltaY * 0.1));
    };

    const onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (keysRef.current[k] !== undefined) keysRef.current[k] = true;
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (keysRef.current[k] !== undefined) keysRef.current[k] = false;
    };

    const onContext = (e) => e.preventDefault();

    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.zIndex = "0";
    canvas.style.outline = "none";
    canvas.addEventListener("pointerenter", onPointerEnter);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // Container resize: ResizeObserver handles “inner width” pages
    const ro = new ResizeObserver(() => resizeToContainer());
    ro.observe(mountRef.current);

    // Initial size
    resizeToContainer();

    // --- Render loop ---
    let raf = 0;

    const FIXED_DT = 1 / 120; // 120Hz physics = smooth
    const MAX_DT = 0.05; // clamp tab-switch spikes

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const rs = renderStateRef.current;
      const now = performance.now();
      let frameDt = (now - rs.lastTime) / 1000;
      rs.lastTime = now;
      frameDt = Math.min(MAX_DT, Math.max(0, frameDt));

      // Birds (use frameDt instead of hardcoded dt)
      birdsRef.current.forEach((b) => {
        if (swarmModeRef.current && cartRef.current) {
            const target = cartRef.current.position;
            const dir = new THREE.Vector3().subVectors(target, b.group.position);
            const desiredVel = dir.normalize().multiplyScalar(0.4);
            b.velocity.lerp(desiredVel, 0.05);
        }

        b.group.position.addScaledVector(b.velocity, frameDt * 60);
        if (Math.abs(b.group.position.x) > 500) b.group.position.x *= -1;
        if (Math.abs(b.group.position.z) > 500) b.group.position.z *= -1;

        const lookTarget = b.group.position.clone().add(b.velocity);
        b.group.lookAt(lookTarget);

        if (Math.random() < 0.02) {
          b.velocity.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.5);
        }

        const flap = Math.sin(now * 0.01 + b.phase) * 0.4;
        b.lWing.rotation.z = flap;
        b.rWing.rotation.z = -flap;
      });

      // Deer animation
      deerRef.current.forEach((d) => {
        if (swarmModeRef.current && riderRef.current !== null && deerRef.current[riderRef.current] !== d) {
            d.state = 6;
        }

        // State 6: SWARM
        if (d.state === 6 && cartRef.current) {
            const target = cartRef.current.position;
            const dirV = new THREE.Vector3().subVectors(target, d.group.position);
            dirV.y = 0;
            const dist = dirV.length();

            if (dist > 15) { // Keep some distance
                dirV.normalize();
                d.group.lookAt(target.x, d.group.position.y, target.z);
                d.group.position.add(dirV.multiplyScalar(0.8));
                if (d.internalGroup.rotation.y !== 0) d.internalGroup.rotation.y = 0;

                const legPhase = now * 0.025; // Faster run
                d.legs[0].rotation.x = Math.sin(legPhase) * 0.9;
                d.legs[1].rotation.x = Math.sin(legPhase + Math.PI) * 0.9;
                d.legs[2].rotation.x = Math.sin(legPhase + Math.PI) * 0.9;
                d.legs[3].rotation.x = Math.sin(legPhase) * 0.9;

                d.neckPivot.rotation.x = -0.8;
            }
            return;
        }

        // FLIP state
        if (d.state === 3) {
          d.flipProgress += frameDt * 2.0;
          if (d.flipProgress >= 1) {
            d.state = 0;
            d.internalGroup.rotation.x = 0;
            d.internalGroup.position.y = 0;
          } else {
            d.internalGroup.rotation.x = -d.flipProgress * Math.PI * 2;
            d.internalGroup.position.y = 15 * Math.sin(d.flipProgress * Math.PI);
            d.group.translateZ(0.2);
          }
          d.legs.forEach((l) => {
            l.rotation.x = 0;
            l.rotation.z = 0;
          });
          return;
        }

        // State 4: RUN TO CART
        if (d.state === 4 && cartRef.current) {
          const target = cartRef.current.position;
          const dirV = new THREE.Vector3().subVectors(target, d.group.position);
          dirV.y = 0;
          const dist = dirV.length();

          if (dist < 8) {
            d.state = 5; // RIDING
          } else {
            dirV.normalize();
            d.group.lookAt(target.x, d.group.position.y, target.z);
            d.group.position.add(dirV.multiplyScalar(0.8));
            if (d.internalGroup.rotation.y !== 0) d.internalGroup.rotation.y = 0;

            const legPhase = now * 0.02;
            d.legs[0].rotation.x = Math.sin(legPhase) * 0.8;
            d.legs[1].rotation.x = Math.sin(legPhase + Math.PI) * 0.8;
            d.legs[2].rotation.x = Math.sin(legPhase + Math.PI) * 0.8;
            d.legs[3].rotation.x = Math.sin(legPhase) * 0.8;

            d.neckPivot.rotation.x = -0.8;
          }
          return;
        }

        // State 5: RIDING
        if (d.state === 5 && cartRef.current) {
          d.group.position.copy(cartRef.current.position);
          d.group.quaternion.copy(cartRef.current.quaternion);

          d.group.translateY(-0.5);
          d.group.translateZ(-1.0);

          d.legs.forEach((l) => {
            l.rotation.x = -1.5;
            l.rotation.z = 0;
          });
          d.neckPivot.rotation.x = -0.5;
          return;
        }

        d.timer -= frameDt;
        if (d.timer <= 0) {
          const roll = Math.random();
          if (roll < 0.3) {
            d.state = 0;
            d.timer = 2 + Math.random() * 3;
          } else if (roll < 0.6) {
            d.state = 2;
            d.timer = 3 + Math.random() * 4;
          } else {
            d.state = 1;
            d.timer = 4 + Math.random() * 5;
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 30;
            d.target.x = d.group.position.x + Math.cos(angle) * dist;
            d.target.z = d.group.position.z + Math.sin(angle) * dist;
          }
        }

        if (d.state === 1) {
          d.neckPivot.rotation.x = THREE.MathUtils.lerp(d.neckPivot.rotation.x, -0.5, 0.1);

          const dirV = new THREE.Vector3().subVectors(d.target, d.group.position);
          if (dirV.length() > 0.5) {
            dirV.normalize();
            const targetRot = Math.atan2(dirV.x, dirV.z);
            let rotDiff = targetRot - d.group.rotation.y;
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            d.group.rotation.y += rotDiff * 0.05;

            d.group.translateZ(0.08);

            const legPhase = now * 0.008;
            if (d.isStrafing) {
              d.legs[0].rotation.z = Math.sin(legPhase) * 0.4;
              d.legs[1].rotation.z = Math.sin(legPhase + Math.PI) * 0.4;
              d.legs[2].rotation.z = Math.sin(legPhase + Math.PI) * 0.4;
              d.legs[3].rotation.z = Math.sin(legPhase) * 0.4;
              d.legs.forEach((l) => (l.rotation.x = 0));
            } else {
              d.legs[0].rotation.x = Math.sin(legPhase) * 0.4;
              d.legs[1].rotation.x = Math.sin(legPhase + Math.PI) * 0.4;
              d.legs[2].rotation.x = Math.sin(legPhase + Math.PI) * 0.4;
              d.legs[3].rotation.x = Math.sin(legPhase) * 0.4;
              d.legs.forEach((l) => (l.rotation.z = 0));
            }
          } else {
            d.state = 0;
          }
        } else if (d.state === 2) {
          d.neckPivot.rotation.x = THREE.MathUtils.lerp(d.neckPivot.rotation.x, 2.5, 0.05);
          d.legs.forEach((l) => {
            l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, 0, 0.1);
            l.rotation.z = THREE.MathUtils.lerp(l.rotation.z, 0, 0.1);
          });
        } else {
          d.neckPivot.rotation.x = THREE.MathUtils.lerp(d.neckPivot.rotation.x, -0.5, 0.1);
          d.legs.forEach((l) => {
            l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, 0, 0.1);
            l.rotation.z = THREE.MathUtils.lerp(l.rotation.z, 0, 0.1);
          });
        }
      });

      // --- Smooth physics + interpolated render ---
      if (isSimulatingRef.current && curveRef.current && cartRef.current) {
        rs.accumulator += frameDt;

        while (rs.accumulator >= FIXED_DT) {
          const phys = physicsRef.current;
          
          if (phys.isOffTrack) {
            // If off-track, we just step physics and the render part will pick it up
            stepPhysics(FIXED_DT);
          } else {
            // If on-track, we do the whole interpolation dance
            rs.prevT = phys.t;
            rs.prevVel = phys.velocity;
            rs.prevBinormal.copy(phys.lastBinormal);

            const telem = stepPhysics(FIXED_DT);

            rs.currT = phys.t;
            rs.currVel = phys.velocity;
            rs.currBinormal.copy(phys.lastBinormal);

            // Throttle React updates
            rs.statsTimer += FIXED_DT;
            if (telem && rs.statsTimer >= 0.05) {
              rs.statsTimer = 0;
              setStats({
                velocity: Math.abs(phys.velocity * 3.6).toFixed(0),
                gVertical: telem.vertG.toFixed(1),
                gLateral: telem.latG.toFixed(1),
                gTotal: telem.totalG.toFixed(1),
                pe: telem.pe.toFixed(0),
                ke: telem.ke.toFixed(0),
              });
            }
          }
          rs.accumulator -= FIXED_DT;
        }
        
        const phys = physicsRef.current;
        const cart = cartRef.current;

        if (phys.isOffTrack && phys.offTrackState) {
          // Directly render the off-track state
          cart.position.copy(phys.offTrackState.pos);
          cart.quaternion.copy(phys.offTrackState.quat);
        } else {
          // Interpolate for smooth on-track rendering
          const alpha = rs.accumulator / FIXED_DT;
          const isCircuitNow = !!trackMetaRef.current?.isCircuit;

          let t0 = rs.prevT;
          let t1 = rs.currT;
          if (isCircuitNow) {
            const d = t1 - t0;
            if (d > 0.5) t0 += 1;
            else if (d < -0.5) t1 += 1;
          }
          let tInterp = THREE.MathUtils.lerp(t0, t1, alpha);
          if (isCircuitNow) tInterp = ((tInterp % 1) + 1) % 1;
          
          const curve = curveRef.current;
          const p = curve.getPointAt(tInterp);
          const tan = curve.getTangentAt(tInterp).normalize();
          
          const vInterp = THREE.MathUtils.lerp(rs.prevVel, rs.currVel, alpha);
          const travelSign = vInterp >= 0 ? 1 : -1;
          const travelTan = tan.clone().multiplyScalar(travelSign);
          
          const interpBinormal = rs.prevBinormal.clone().lerp(rs.currBinormal, alpha).normalize();
          const bin = interpBinormal.clone().projectOnPlane(tan).normalize();
          const nrm = new THREE.Vector3().crossVectors(bin.length() ? bin : new THREE.Vector3(1,0,0), tan).normalize();

          const m = new THREE.Matrix4().lookAt(p, p.clone().add(travelTan), nrm);
          const targetQ = new THREE.Quaternion().setFromRotationMatrix(m);
          
          cart.position.copy(p);
          cart.quaternion.copy(targetQ);
        }
      }

      // Camera controls / ride cam
      if (cameraModeRef.current === "ORBIT") {
        const { w, a, s, d } = keysRef.current;
        if (w || a || s || d) {
          const speed = Math.sqrt(controlsRef.current.zoom) * 0.2;
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          forward.y = 0;
          forward.normalize();
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          right.y = 0;
          right.normalize();

          const move = new THREE.Vector3();
          if (w) move.add(forward);
          if (s) move.sub(forward);
          if (d) move.add(right);
          if (a) move.sub(right);

          controlsRef.current.target.add(move.multiplyScalar(speed));
        }

        if (cartRef.current) cartRef.current.visible = true;

        const { rotation, pitch, zoom, target } = controlsRef.current;
        if(autoOrbitOnRef.current && cartRef.current && (isSimulatingRef.current || physicsRef.current.isOffTrack)){
          target.lerp(cartRef.current.position, 0.05);
        }

        const x = Math.sin(rotation) * zoom * Math.cos(pitch);
        const z = Math.cos(rotation) * zoom * Math.cos(pitch);
        const y = zoom * Math.sin(pitch);
        camera.position.set(target.x + x, target.y + y, target.z + z);
        // RIDE cam tilts camera.up to the cart's normal; reset it to world up so
        // the orbit view doesn't inherit the cart's roll when switching back.
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
      } else if (cameraModeRef.current === "RIDE" && cartRef.current) {
        if (cartRef.current) {
          cartRef.current.visible = physicsRef.current.isOffTrack;
        }

        const phys = physicsRef.current;
        let eyePos, lookAt;

        if (phys.isOffTrack && phys.offTrackState) {
            const { pos, vel, quat } = phys.offTrackState;
            const forward = vel.clone().normalize();
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
            
            const eyeOffset = up.clone().multiplyScalar(1.2).add(forward.clone().multiplyScalar(0.5));
            eyePos = pos.clone().add(eyeOffset);
            lookAt = eyePos.clone().add(forward);
            
            camera.up.copy(up);

            } else if(curveRef.current) {
                const alpha = rs.accumulator / FIXED_DT;
                const isCircuitNow = !!trackMetaRef.current?.isCircuit;
                let t0 = rs.prevT;
                let t1 = rs.currT;
                if (isCircuitNow) {
                    const d = t1 - t0;
                    if (d > 0.5) t0 += 1;
                    else if (d < -0.5) t1 += 1;
                }
                let tInterp = THREE.MathUtils.lerp(t0, t1, alpha);
                if (isCircuitNow) tInterp = ((tInterp % 1) + 1) % 1;
                
                const point = curveRef.current.getPointAt(tInterp);
                const tangent = curveRef.current.getTangentAt(tInterp).normalize();
                
                const vInterp = THREE.MathUtils.lerp(rs.prevVel, rs.currVel, alpha);
                const sign = vInterp >= 0 ? 1 : -1;
                const forward = tangent.clone().multiplyScalar(sign);
        
                const interpBinormal = rs.prevBinormal.clone().lerp(rs.currBinormal, alpha).normalize();
                const binormal = interpBinormal.clone().projectOnPlane(tangent).normalize();
                const normal = new THREE.Vector3().crossVectors(binormal.length() ? binormal : new THREE.Vector3(1,0,0), tangent).normalize();
        
                const eyeOffset = normal.clone().multiplyScalar(1.2).add(forward.clone().multiplyScalar(0.5));
                eyePos = point.clone().add(eyeOffset);
                lookAt = eyePos.clone().add(forward)
                
                camera.up.copy(normal);
            }        
        if (eyePos && lookAt) {
            camera.position.copy(eyePos);
            camera.lookAt(lookAt);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();

      canvas.removeEventListener("pointerenter", onPointerEnter);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);

      if (mountRef.current && renderer.domElement) mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Build track whenever segments change ---
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // --- Preserve cart state if simulating ---
    const oldCurve = curveRef.current;
    let oldPos = null;
    if (isSimulatingRef.current && oldCurve) {
      const oldT = physicsRef.current.t;
      if (oldT >= 0 && oldT <= 1) {
        oldPos = oldCurve.getPointAt(oldT);
      }
    }

    // Clear previous track/supports
    ["TRACK", "SUPPORTS"].forEach((name) => {
      const obj = scene.getObjectByName(name);
      if (obj) scene.remove(obj);
    });

    const points = [];
    const colors = [];
    const segmentInfoList = [];

    let pos = new THREE.Vector3(0, 5, 0);
    let dir = new THREE.Vector3(0, 0, 1);
    let up = new THREE.Vector3(0, 1, 0);

    points.push(pos.clone());
    colors.push(0.3, 0.3, 0.3);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const def = SEGMENT_DEFS[seg.type];
      let segColor = def.color || 0xff3333;

      if (def.variants) {
        const v = def.variants.find((vv) => vv.id === seg.variant);
        if (v?.color) segColor = v.color;
      }

      const colorObj = new THREE.Color(segColor);
      const startIdx = points.length;

      if (seg.type === "START") {
        pos.add(dir.clone().multiplyScalar(15));
        points.push(pos.clone());
      } else if (seg.type === "STRAIGHT") {
        const len = def.len;
        const steps = Math.max(2, Math.ceil(len / 1.5));
        const startPos = pos.clone();
        for (let k = 1; k <= steps; k++) {
          points.push(startPos.clone().add(dir.clone().multiplyScalar((k * len) / steps)));
        }
        pos.copy(points[points.length - 1]);
      } else if (seg.type === "UP" || seg.type === "DOWN") {
        let count = 1;
        let j = i + 1;
        while (j < segments.length && segments[j].type === seg.type) {
          count += 1;
          j += 1;
        }

        const totalLen = def.len * count;
        const totalHeight = def.height * count;
        const steps = 15 * count;
        const startPos = pos.clone();
        const endPos = pos.clone().add(dir.clone().multiplyScalar(totalLen));
        endPos.y += totalHeight;

        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const smoothT = t * t * (3 - 2 * t);
          const curPos = startPos.clone().lerp(endPos, t);
          curPos.y = startPos.y + smoothT * totalHeight;
          points.push(curPos);
        }

        pos.copy(points[points.length - 1]);

        const endIdx = points.length;
        for (let k = startIdx; k < endIdx; k++) {
          colors.push(colorObj.r, colorObj.g, colorObj.b);
        }

        segmentInfoList.push({
          type: seg.type,
          variant: seg.variant,
          endPointIndex: endIdx - 1,
        });

        i += count - 1;
        continue;
      } else if (seg.type === "LEFT" || seg.type === "RIGHT") {
        let r = def.radius || 25;
        if (def.variants) {
          const v = def.variants.find((vv) => vv.id === seg.variant);
          if (v?.radius) r = v.radius;
        }
        const steps = 20;

        const rightVec = new THREE.Vector3().crossVectors(dir, up).normalize();
        const leftVec = new THREE.Vector3().crossVectors(up, dir).normalize();
        const turnCenterDir = seg.type === "LEFT" ? leftVec : rightVec;

        const turnCenter = pos.clone().add(turnCenterDir.clone().multiplyScalar(r));
        const startVec = pos.clone().sub(turnCenter);
        const totalAngle = seg.type === "LEFT" ? Math.PI / 2 : -Math.PI / 2;

        for (let k = 1; k <= steps; k++) {
          const tt = k / steps;
          const theta = tt * totalAngle;
          const rotatedVec = startVec.clone().applyAxisAngle(up, theta);
          const nextPt = turnCenter.clone().add(rotatedVec);
          nextPt.y = pos.y;
          points.push(nextPt);
        }

        pos.copy(points[points.length - 1]);
        dir.applyAxisAngle(up, totalAngle);
      } else if (seg.type === "LOOP") {
        const r = def.radius;
        const steps = 40;
        const forward = dir.clone().normalize();
        const upVec = new THREE.Vector3(0, 1, 0);

        for (let k = 1; k <= steps; k++) {
          const tt = k / steps;
          const angle = tt * Math.PI * 2;
          const loopY = (1 - Math.cos(angle)) * r;
          const loopFwd = Math.sin(angle) * r;
          const spacing = tt * 5;

          const finalPt = pos
            .clone()
            .add(forward.clone().multiplyScalar(loopFwd + spacing))
            .add(upVec.clone().multiplyScalar(loopY));

          points.push(finalPt);
        }
        pos.copy(points[points.length - 1]);
      }

      const endIdx = points.length;
      for (let k = startIdx; k < endIdx; k++) {
        colors.push(colorObj.r, colorObj.g, colorObj.b);
      }

      segmentInfoList.push({
        type: seg.type,
        variant: seg.variant,
        endPointIndex: endIdx - 1,
      });
    }

    // Energy scaling
    const maxY = points.reduce((m, p) => Math.max(m, p.y), 0);
    maxEnergyRef.current = GRAVITY * (maxY + 15);

    if (points.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(points);
    curve.tension = 0.2;
    curveRef.current = curve;

    // --- Remap cart position to new curve ---
    if (oldPos) {
      const divisions = Math.max(200, curve.points.length * 10);
      const searchPoints = curve.getPoints(divisions);
      let closestDistSq = Infinity;
      let closestIdx = -1;

      for (let i = 0; i < searchPoints.length; i++) {
        const distSq = searchPoints[i].distanceToSquared(oldPos);
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestIdx = i;
        }
      }

      if (closestIdx !== -1) {
        const newT = closestIdx / divisions;
        physicsRef.current.t = newT;
        renderStateRef.current.prevT = newT;
        renderStateRef.current.currT = newT;

        // Re-initialize orientation to prevent flips
        const newTangent = curve.getTangentAt(newT).normalize();
        const newBinormal = new THREE.Vector3().crossVectors(newTangent, new THREE.Vector3(0, 1, 0)).normalize();
        if (newBinormal.length() > 0) {
          physicsRef.current.lastBinormal.copy(newBinormal);
          renderStateRef.current.prevBinormal.copy(newBinormal);
          renderStateRef.current.currBinormal.copy(newBinormal);
        }
      }
    }


    // --- Circuit detection (used for lap wrap + deer boarding) ---
    const startPt = points[0].clone();
    const endPt = points[points.length - 1].clone();
    const startTan = curve.getTangentAt(0).normalize();
    const endTan = curve.getTangentAt(1 - 1e-4).normalize();
    const dist = startPt.distanceTo(endPt);

    const isCircuit = points.length > 20 && dist < 20;

    trackMetaRef.current = {
      isCircuit,
      start: startPt,
      end: endPt,
      startTangent: startTan,
      endTangent: endTan,
    };

    // Circuit Detection & Deer Assignment
    if (isCircuit && riderRef.current === null) {
      let minDist = Infinity;
      let closestIdx = -1;

      deerRef.current.forEach((d, i) => {
        const dDist = d.group.position.distanceTo(startPt);
        if (dDist < minDist) {
          minDist = dDist;
          closestIdx = i;
        }
      });

      if (closestIdx !== -1) {
        riderRef.current = closestIdx;
        deerRef.current[closestIdx].state = 4; // RUN_TO_CART
      }
    } else if (!isCircuit && riderRef.current !== null) {
      const d = deerRef.current[riderRef.current];
      if (d) {
        d.state = 0;
        d.group.rotation.set(0, 0, 0);
        if (d.isStrafing) d.internalGroup.rotation.y = Math.PI / 2;
        d.group.position.y = 0;
      }
      riderRef.current = null;
    }

    // Polyline length mapping
    const pointLengths = [0];
    let totalPolyLength = 0;
    for (let i = 1; i < points.length; i++) {
      totalPolyLength += points[i].distanceTo(points[i - 1]);
      pointLengths.push(totalPolyLength);
    }

    // Tube + per-vertex color
    const tubeGeo = new THREE.TubeGeometry(curve, 400, 0.4, 6, isCircuit);
    const count = tubeGeo.attributes.position.count;
    const colorAttr = new Float32Array(count * 3);
    const radial = 6;
    const tubular = 400;
    let currentPtIdx = 0;

    for (let i = 0; i < count; i++) {
      const ringIndex = Math.floor(i / (radial + 1));
      const t = ringIndex / tubular;
      const targetLen = t * totalPolyLength;

      while (currentPtIdx < pointLengths.length - 1 && targetLen > pointLengths[currentPtIdx + 1])
        currentPtIdx++;
      while (currentPtIdx > 0 && targetLen < pointLengths[currentPtIdx]) currentPtIdx--;

      if (colors[currentPtIdx * 3] !== undefined) {
        colorAttr[i * 3] = colors[currentPtIdx * 3];
        colorAttr[i * 3 + 1] = colors[currentPtIdx * 3 + 1];
        colorAttr[i * 3 + 2] = colors[currentPtIdx * 3 + 2];
      } else {
        colorAttr[i * 3] = 1;
        colorAttr[i * 3 + 1] = 1;
        colorAttr[i * 3 + 2] = 1;
      }
    }

    tubeGeo.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
    const track = new THREE.Mesh(
      tubeGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4 })
    );
    track.name = "TRACK";
    track.castShadow = true;
    track.receiveShadow = true;
    track.frustumCulled = false;
    scene.add(track);

    // Supports
    const supports = new THREE.Group();
    supports.name = "SUPPORTS";
    const suppMat = new THREE.MeshStandardMaterial({ color: 0x64748b });

    const totalLen = curve.getLength();
    const supCount = Math.max(2, Math.floor(totalLen / 15));

    const pointSegmentTypes = new Array(points.length).fill("NORMAL");
    let curSegIdx = 0;
    let nextEndIdx = segmentInfoList[0]?.endPointIndex ?? points.length - 1;

    for (let i = 0; i < points.length; i++) {
      if (i > nextEndIdx && curSegIdx < segmentInfoList.length - 1) {
        curSegIdx++;
        nextEndIdx = segmentInfoList[curSegIdx].endPointIndex;
      }
      pointSegmentTypes[i] = segmentInfoList[curSegIdx]?.type ?? "NORMAL";
    }

    let supportPtIdx = 0;
    for (let i = 0; i <= supCount; i++) {
      const t = i / supCount;
      const targetLen2 = t * totalPolyLength;
      while (supportPtIdx < pointLengths.length - 1 && targetLen2 > pointLengths[supportPtIdx + 1])
        supportPtIdx++;

      if (pointSegmentTypes[supportPtIdx] === "LOOP") continue;

      const pt = curve.getPointAt(t);
      if (pt.y > 1) {
        const h = pt.y;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, h, 6), suppMat);
        col.position.set(pt.x, h / 2, pt.z);
        col.frustumCulled = false;
        supports.add(col);
      }
    }
    scene.add(supports);

    // Segment map for physics
    const map = [];
    let lastEndT = 0;
    segmentInfoList.forEach((info) => {
      const endPtIdx = info.endPointIndex;
      const lenAtEnd = pointLengths[endPtIdx];
      const endT = lenAtEnd / totalPolyLength;
      map.push({ startT: lastEndT, endT, type: info.type, variant: info.variant });
      lastEndT = endT;
    });
    segmentsMapRef.current = map;

    if (!isSimulatingRef.current) {
      resetSim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  const resetSim = () => {
    setIsSimulating(false);
    // Clear the live telemetry so it reads zero back at the station.
    setStats({ velocity: 0, gVertical: 0, gLateral: 0, gTotal: 0, pe: 0, ke: 0 });

    const curve = curveRef.current;
    if (!curve) return;

    const t = 0;
    const tangent = curve.getTangentAt(t).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

    const startVel = tangent.clone().multiplyScalar(INITIAL_SPEED);
    physicsRef.current = {
      t: 0,
      velocity: INITIAL_SPEED,
      lastVel: startVel,
      lastBinormal: binormal,
      isOffTrack: false,
      offTrackState: null,
    };

    // Reset render interpolation state too
    const rs = renderStateRef.current;
    rs.prevT = 0;
    rs.currT = 0;
    rs.prevVel = INITIAL_SPEED;
    rs.currVel = INITIAL_SPEED;
    rs.accumulator = 0;
    rs.lastTime = performance.now();
    rs.statsTimer = 0;
    rs.prevBinormal.copy(binormal);
    rs.currBinormal.copy(binormal);

    const cart = cartRef.current;
    if (cart) {
      cart.visible = true;
      const p = curve.getPointAt(0);
      cart.position.copy(p);
      const upVec = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
      cart.up.copy(upVec);
      cart.lookAt(p.clone().add(tangent));
    }
  };

  const resetSwarm = () => {
    if (swarmModeRef.current) {
        swarmModeRef.current = false;
        deerRef.current.forEach(d => {
            if (d.state === 6) {
                d.state = 0;
            }
        });
    }
  }

  const addSegment = (type, variant = "NORMAL") => {
    setSegments((prev) => [...prev, { type, variant }]);
  };

  const undo = () => {
    resetSwarm();
    setSegments((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const clearTrack = () => {
    resetSwarm();
    setSegments([{ type: "START", variant: "NORMAL" }]);
  };

  // Re-resize when fullscreen changes (container geometry changes)
  useEffect(() => {
    const id = requestAnimationFrame(() => resizeToContainer());
    return () => cancelAnimationFrame(id);
  }, [isFullscreen]);

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
    >
      <div
        className={
          isFullscreen
            ? "absolute inset-0 overflow-hidden bg-[#eef2f5]"
            : "relative"
        }
        style={!isFullscreen ? { height } : undefined}
      >
        <div
          className="relative w-full h-full select-none overflow-hidden font-sans"
          style={{
            overscrollBehavior: "contain",
            touchAction: "none",
          }}
        >
          <div ref={mountRef} className="absolute inset-0 z-0" />

          {/* UI Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">
            {/* Top Bar */}
            <div className="flex justify-between items-start pointer-events-auto">
              <div className="bg-white/85 backdrop-blur-md border border-white/60 shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-6 py-4 rounded-2xl">
                <h1 className="text-2xl font-black italic tracking-tighter text-blue-600">
                  COASTER<span className="text-slate-800">BUILDER</span>
                </h1>
                <div className="text-xs text-slate-500 font-mono mt-1 font-semibold">
                  {segments.length} SEGM • BUILD MODE
                </div>
              </div>

              <div className="flex gap-2 pointer-events-auto">
                <button
                  onClick={() => setShowTelemetry((v) => !v)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl backdrop-blur-md transition-all border shadow-sm ${
                    showTelemetry
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-white/90 border-white/60 hover:bg-white text-slate-700"
                  }`}
                >
                  <Icon name="activity" size={20} />
                  <span className="font-bold text-sm">TELEMETRY</span>
                </button>

                <button
                  onClick={() => setSafetyOn((v) => !v)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl backdrop-blur-md transition-all border shadow-sm ${
                    safetyOn
                      ? "bg-green-600 text-white border-green-500"
                      : "bg-red-600 text-white border-red-500"
                  }`}
                >
                  <Icon name="shield" size={20} />
                  <span className="font-bold text-sm">SAFETY {safetyOn ? "ON" : "OFF"}</span>
                </button>

                <button
                  onClick={() => setAutoOrbitOn((v) => !v)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl backdrop-blur-md transition-all border shadow-sm ${
                    autoOrbitOn
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-white/90 border-white/60 hover:bg-white text-slate-700"
                  }`}
                >
                  <Icon name="move" size={20} />
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/90 border border-white/60 text-slate-700 hover:bg-white shadow-sm"
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  <Icon name={isFullscreen ? "minimize" : "maximize"} size={20} />
                </button>
              </div>
            </div>

            {/* Telemetry Panel */}
            {showTelemetry && (
              <div className="absolute top-24 right-6 w-60 bg-white/85 backdrop-blur-md border border-white/60 shadow-[0_4px_20px_rgba(0,0,0,0.08)] p-4 rounded-xl pointer-events-auto">
                <div className="flex justify-end -mt-1 -mr-1 mb-1">
                  <button
                    onClick={() => setShowTelemetry(false)}
                    aria-label="Close telemetry"
                    className="text-slate-400 hover:text-red-500"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-xs font-bold uppercase text-slate-500">Energy</span>
                      <span className="text-[10px] font-medium text-slate-400">J/kg</span>
                    </div>
                    <div className="flex items-stretch gap-3">
                      <div className="relative w-9 h-28 bg-slate-100 rounded-md border border-slate-200 overflow-hidden shrink-0">
                        <div
                          className="absolute left-0 right-0 bottom-0 bg-purple-500"
                          style={{ height: `${Math.min(100, (stats.pe / maxEnergyRef.current) * 100)}%` }}
                        />
                        <div
                          className="absolute left-0 right-0 bg-emerald-500"
                          style={{
                            height: `${Math.min(100, (stats.ke / maxEnergyRef.current) * 100)}%`,
                            bottom: `${Math.min(100, (stats.pe / maxEnergyRef.current) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="flex flex-1 flex-col justify-center gap-2 text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm bg-emerald-500" />
                          <span className="text-slate-500">KE</span>
                          <span className="ml-auto font-mono font-bold text-slate-800">{stats.ke}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm bg-purple-500" />
                          <span className="text-slate-500">PE</span>
                          <span className="ml-auto font-mono font-bold text-slate-800">{stats.pe}</span>
                        </div>
                        <div className="flex items-center gap-2 border-t border-slate-200 pt-2 mt-0.5">
                          <span className="font-semibold text-slate-500">Total</span>
                          <span className="ml-auto font-mono font-bold text-slate-800">{Number(stats.ke) + Number(stats.pe)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-3 border-t border-slate-200">
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1 font-bold">
                        <span>VERTICAL G</span>
                        <span className="font-mono" style={{ color: gForceColor(stats.gVertical, 5) }}>
                          {stats.gVertical} G
                        </span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 left-1/2 z-10" />
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            width: `${Math.min(50, Math.abs(Number(stats.gVertical)) * 10)}%`,
                            left: Number(stats.gVertical) < 0 ? `${50 - Math.min(50, Math.abs(Number(stats.gVertical)) * 10)}%` : "50%",
                            background: gForceColor(stats.gVertical, 5),
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1 font-bold">
                        <span>LATERAL G</span>
                        <span className="font-mono" style={{ color: gForceColor(stats.gLateral, 2.5) }}>
                          {stats.gLateral} G
                        </span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 left-1/2 z-10" />
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            width: `${Math.min(50, Math.abs(Number(stats.gLateral)) * 20)}%`,
                            left: Number(stats.gLateral) < 0 ? `${50 - Math.min(50, Math.abs(Number(stats.gLateral)) * 20)}%` : "50%",
                            background: gForceColor(stats.gLateral, 2.5),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Builder Toolbar */}
            <div className="pointer-events-auto self-start mt-4 flex flex-col gap-3">
              {Object.entries(SEGMENT_DEFS).map(([key, def]) => {
                if (key === "START") return null;
                return (
                  <div key={key} className="group relative flex items-center hover:z-30">
                    <button
                      onClick={() => addSegment(key)}
                      className="w-14 h-14 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded-xl flex flex-col items-center justify-center gap-1 transition-all shadow-md active:scale-95 z-20 relative"
                    >
                      <Icon name={def.icon} />
                      <span className="text-[10px] font-bold uppercase">{def.label.split(" ")[0]}</span>
                    </button>

                    {def.variants && (
                      <div className="submenu absolute left-12 ml-2 pl-4 flex gap-2 opacity-0 invisible -translate-x-4 transition-all duration-200 z-10">
                        <div className="relative z-10 flex gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-xl">
                          {def.variants.map((v) => (
                            <button
                              key={v.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                addSegment(key, v.id);
                              }}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-xs font-bold whitespace-nowrap transition-colors border border-transparent hover:border-slate-200"
                              style={{ color: "#" + v.color.toString(16).padStart(6, "0") }}
                            >
                              {v.id === "CHAIN" && <Icon name="chevrons-up" size={14} />}
                              {v.id === "BOOST" && <Icon name="zap" size={14} />}
                              {v.id === "BRAKE" && <Icon name="anchor" size={14} />}
                              {v.id === "TIGHT" && <Icon name="minimize" size={14} />}
                              {v.id === "WIDE" && <Icon name="maximize" size={14} />}
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="h-px bg-slate-300 my-2 w-14" />

              <button
                onClick={undo}
                className="w-14 h-14 bg-white hover:bg-red-50 text-slate-600 hover:text-red-500 border border-slate-200 hover:border-red-200 rounded-xl flex items-center justify-center transition-all shadow-md"
              >
                <Icon name="rotate-ccw" />
              </button>

              <button
                onClick={clearTrack}
                className="w-14 h-14 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 rounded-xl flex items-center justify-center transition-all shadow-md text-xs font-bold"
              >
                CLR
              </button>
            </div>

            {/* Dashboard */}
            <div className="pointer-events-auto self-center bg-white/85 backdrop-blur-md border border-white/60 shadow-[0_4px_20px_rgba(0,0,0,0.08)] rounded-2xl p-2 flex items-center gap-4 pr-6 mt-auto flex-wrap">
              <button
                onClick={() => setIsSimulating((v) => !v)}
                className={`w-16 h-16 rounded-xl flex items-center justify-center transition-all shadow-lg ${
                  isSimulating ? "bg-amber-400 text-black animate-pulse" : "bg-green-500 hover:bg-green-400 text-white"
                }`}
              >
                <Icon name={isSimulating ? "square" : "play"} size={24} />
              </button>

              <button
                onClick={resetSim}
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center"
              >
                <Icon name="refresh-cw" />
              </button>

              <button
                onClick={() => setCameraMode((m) => (m === "ORBIT" ? "RIDE" : "ORBIT"))}
                className={`px-4 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors ${
                  cameraMode === "RIDE" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Icon name="video" />
                {cameraMode === "RIDE" ? "RIDE CAM" : "ORBIT"}
              </button>

              <div className="flex gap-8 ml-2">
                <div>
                  <div className="text-[10px] text-slate-400 font-bold tracking-wider">SPEED</div>
                  <div className="text-2xl font-mono font-bold text-slate-800">
                    {stats.velocity} <span className="text-sm text-slate-500">km/h</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-bold tracking-wider">TOTAL G</div>
                  <div
                    className={`text-2xl font-mono font-bold ${
                      Math.abs(stats.gTotal) > 4 ? "text-red-500" : "text-slate-800"
                    }`}
                  >
                    {stats.gTotal} <span className="text-sm text-slate-500">G</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tiny hint */}
            <div className="pointer-events-none self-center mb-2 text-xs text-slate-600/80">
              Scroll to zoom • Right-drag to pan • WASD to move
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
