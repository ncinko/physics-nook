import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import * as THREE from 'three';

import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { onThemeChange } from '../shared/themeColors';
import {
  buildCurtainGrid,
  buildCurtainIndices,
  curtainTaper,
  curtainTiltRad,
  type CurtainVertex,
} from '../../lib/aurora/curtain.ts';
import { ovalLatitudeDeg } from '../../lib/aurora/dipole.ts';
import { lossConeAngleRad, mirrorLatitudeRad } from '../../lib/aurora/mirroring.ts';
import { numberDensity } from '../../lib/aurora/atmosphere.ts';
import {
  AURORAL_LINES,
  columnBrightness,
  emissionProfile,
  quenchEfficiency,
  quenchRate,
  type EmissionSample,
} from '../../lib/aurora/emission.ts';
import { peakDepositionAltitudeKm } from '../../lib/aurora/penetration.ts';
import { compositeColour, wavelengthToHex } from '../../lib/aurora/spectrum.ts';

// Scene units are kilometres, with the observer at the origin: +x east,
// +y up, -z north (Three's camera looks down -z). The curtain module works in
// an ENU frame, so north maps to -z on the way in.

const MIN_ALT_KM = 90;
const MAX_ALT_KM = 400;
const ARC_SAMPLES = 420;
const ALT_SAMPLES = 44;
const OBSERVER_LAT_DEG = 63.3;
const CAMERA_PITCH_DEG = 20;
const CAMERA_FOV_DEG = 42;

const DEFAULT_ENERGY_KEV = 1.3;
const DEFAULT_FLUX = 1;
const DEFAULT_L = 6.5;

interface CurtainConfig {
  arcHalfWidthRad: number;
  foldAmplitudeKm: number;
  foldWaves: number;
  phase: number;
  gain: number;
  offsetKm: number;
  driftRate: number;
}

const CURTAINS: CurtainConfig[] = [
  {
    arcHalfWidthRad: 0.3,
    foldAmplitudeKm: 26,
    foldWaves: 5,
    phase: 0,
    gain: 1,
    offsetKm: 0,
    driftRate: 0.16,
  },
  {
    arcHalfWidthRad: 0.22,
    foldAmplitudeKm: 38,
    foldWaves: 7.3,
    phase: 1.9,
    gain: 0.42,
    offsetKm: 150,
    driftRate: -0.11,
  },
  {
    arcHalfWidthRad: 0.36,
    foldAmplitudeKm: 18,
    foldWaves: 3.2,
    phase: 3.4,
    gain: 0.26,
    offsetKm: -110,
    driftRate: 0.07,
  },
];

/**
 * Per-ray brightness variation. Real curtains are made of discrete rays of
 * uneven brightness; an evenly lit sheet reads as a comb, not as fabric.
 */
const rayGain = (arcT: number, seed: number): number =>
  0.35 +
  0.65 *
    Math.abs(
      Math.sin(arcT * 41.3 + seed * 2.1) * 0.5 +
        Math.sin(arcT * 13.7 - seed) * 0.35 +
        Math.sin(arcT * 97.1 + 1.7) * 0.15,
    );

/**
 * Line indices for every `stride`-th column of the grid, as vertical segments.
 *
 * The shaded sheet alone reads as a soft wash; real curtains are visibly made
 * of discrete field-aligned rays. These share the mesh's position and colour
 * attributes, so they cost nothing extra per frame.
 */
const buildRayIndices = (
  arcSamples: number,
  altitudeSamples: number,
  stride: number,
): number[] => {
  const indices: number[] = [];
  for (let column = 0; column < arcSamples; column += stride) {
    for (let row = 0; row < altitudeSamples - 1; row += 1) {
      indices.push(row * arcSamples + column, (row + 1) * arcSamples + column);
    }
  }
  return indices;
};

interface CurtainMesh {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  config: CurtainConfig;
  vertices: CurtainVertex[];
}

const sampleProfile = (
  profile: EmissionSample[],
  altitudeKm: number,
): EmissionSample | null => {
  if (profile.length === 0) return null;
  const first = profile[0]!.altitudeKm;
  const last = profile[profile.length - 1]!.altitudeKm;
  const t = (altitudeKm - first) / (last - first);
  const index = Math.round(t * (profile.length - 1));
  return profile[Math.max(0, Math.min(profile.length - 1, index))] ?? null;
};

export default function AuroraScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const insetRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const curtainsRef = useRef<CurtainMesh[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const clockRef = useRef(0);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const draggingRef = useRef(false);

  const [energyKeV, setEnergyKeV] = useState(DEFAULT_ENERGY_KEV);
  const [flux, setFlux] = useState(DEFAULT_FLUX);
  const [shellL, setShellL] = useState(DEFAULT_L);
  const [pitchDeg, setPitchDeg] = useState(6);
  const [showSpectrometer, setShowSpectrometer] = useState(false);
  const [probeAltitude, setProbeAltitude] = useState(240);
  const [probeActive, setProbeActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // --- physics derived from the controls, recomputed only when they change ---
  const profile = useMemo(
    () =>
      emissionProfile(energyKeV, {
        minAltitudeKm: MIN_ALT_KM,
        maxAltitudeKm: MAX_ALT_KM,
        samples: 160,
      }),
    [energyKeV],
  );

  const brightness = useMemo(() => columnBrightness(energyKeV), [energyKeV]);
  const peakAltitude = useMemo(
    () => peakDepositionAltitudeKm(energyKeV),
    [energyKeV],
  );
  const lossCone = useMemo(
    () => (lossConeAngleRad(shellL) * 180) / Math.PI,
    [shellL],
  );
  const oval = useMemo(() => ovalLatitudeDeg(shellL), [shellL]);
  const tilt = useMemo(
    () => (curtainTiltRad(shellL, 200) * 180) / Math.PI,
    [shellL],
  );

  const probeDensities = useMemo(
    () => numberDensity(probeAltitude),
    [probeAltitude],
  );
  const probeLines = useMemo(
    () =>
      AURORAL_LINES.map((line) => ({
        line,
        efficiency: quenchEfficiency(line, probeAltitude),
        collisionRate: quenchRate(line, probeAltitude),
      })),
    [probeAltitude],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  // --- build the WebGL scene once ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x03060f, 1);
    // Additive curtains overlap heavily; without tonemapping the bright core
    // clips every channel and a green aurora turns white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 1, 6000);
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.x = (CAMERA_PITCH_DEG * Math.PI) / 180;
    cameraRef.current = camera;

    // Star field on a distant shell.
    const starCount = 1400;
    const starPositions = new Float32Array(starCount * 3);
    const starColours = new Float32Array(starCount * 3);
    let seed = 20260908;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < starCount; index += 1) {
      const theta = random() * Math.PI * 2;
      const elevation = Math.pow(random(), 0.7) * (Math.PI / 2);
      const radius = 4200;
      starPositions[index * 3] = radius * Math.cos(elevation) * Math.sin(theta);
      starPositions[index * 3 + 1] = radius * Math.sin(elevation);
      starPositions[index * 3 + 2] = -radius * Math.cos(elevation) * Math.cos(theta);
      const magnitude = Math.pow(random(), 3) * 0.85 + 0.15;
      starColours[index * 3] = magnitude;
      starColours[index * 3 + 1] = magnitude;
      starColours[index * 3 + 2] = magnitude * 1.08;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColours, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 9,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(stars);

    // Ground: a dark disc that hides everything below the horizon.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5000, 64),
      new THREE.MeshBasicMaterial({ color: 0x01030a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    scene.add(ground);

    curtainsRef.current = CURTAINS.map((config) => {
      const geometry = new THREE.BufferGeometry();
      const vertexCount = ARC_SAMPLES * ALT_SAMPLES;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3),
      );
      geometry.setIndex(buildCurtainIndices(ARC_SAMPLES, ALT_SAMPLES));

      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);

      // Discrete rays over the sheet, sharing its buffers.
      const rayGeometry = new THREE.BufferGeometry();
      rayGeometry.setAttribute('position', geometry.getAttribute('position'));
      rayGeometry.setAttribute('color', geometry.getAttribute('color'));
      rayGeometry.setIndex(buildRayIndices(ARC_SAMPLES, ALT_SAMPLES, 3));
      const rays = new THREE.LineSegments(
        rayGeometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.85,
        }),
      );
      rays.frustumCulled = false;
      scene.add(rays);

      return { mesh, geometry, config, vertices: [] };
    });

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const overlay = overlayRef.current;
      if (overlay) {
        const dpr = window.devicePixelRatio || 1;
        overlay.width = Math.round(width * dpr);
        overlay.height = Math.round(height * dpr);
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
      }
      setOverlaySize({ width, height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;

      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });

      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      curtainsRef.current = [];
    };
  }, []);

  // --- rebuild curtain geometry and colours when the physics changes ---
  useEffect(() => {
    const curtains = curtainsRef.current;
    if (curtains.length === 0) return;

    const observerLatRad = (OBSERVER_LAT_DEG * Math.PI) / 180;

    for (const curtain of curtains) {
      const vertices = buildCurtainGrid({
        L: shellL,
        observerLatRad,
        arcHalfWidthRad: curtain.config.arcHalfWidthRad,
        arcSamples: ARC_SAMPLES,
        minAltitudeKm: MIN_ALT_KM,
        maxAltitudeKm: MAX_ALT_KM,
        altitudeSamples: ALT_SAMPLES,
        // Built unfolded: the fold is a per-frame term in the animation loop,
        // so baking it in here would apply it twice.
        foldAmplitudeKm: 0,
        foldWaves: curtain.config.foldWaves,
        phase: curtain.config.phase,
      });
      curtain.vertices = vertices;

      const colours = curtain.geometry.getAttribute('color') as THREE.BufferAttribute;
      const array = colours.array as Float32Array;

      for (let index = 0; index < vertices.length; index += 1) {
        const vertex = vertices[index]!;
        const sample = sampleProfile(profile, vertex.altitudeKm);
        if (!sample) {
          array[index * 3] = 0;
          array[index * 3 + 1] = 0;
          array[index * 3 + 2] = 0;
          continue;
        }

        const peak = Math.max(sample.green, sample.red, sample.blue);
        const colour = compositeColour(
          { green: sample.green, red: sample.red, blue: sample.blue },
          1,
        );
        const strength =
          peak *
          curtainTaper(vertex.arcT) *
          curtain.config.gain *
          rayGain(vertex.arcT, curtain.config.phase) *
          flux *
          0.4;

        array[index * 3] = colour.r * strength;
        array[index * 3 + 1] = colour.g * strength;
        array[index * 3 + 2] = colour.b * strength;
      }

      colours.needsUpdate = true;
    }
  }, [profile, flux, shellL]);

  // --- animation loop ---
  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    const writePositions = () => {
      for (const curtain of curtainsRef.current) {
        const positions = curtain.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute;
        const array = positions.array as Float32Array;
        const drift = reducedMotion
          ? curtain.config.phase
          : curtain.config.phase + clockRef.current * curtain.config.driftRate;

        for (let index = 0; index < curtain.vertices.length; index += 1) {
          const vertex = curtain.vertices[index]!;
          // Re-evaluate only the fold term; the field-line shape is fixed.
          const fold =
            curtain.config.foldAmplitudeKm *
            0.7 *
            (Math.sin(vertex.arcT * curtain.config.foldWaves * Math.PI * 2 + drift) +
              0.42 *
                Math.sin(
                  vertex.arcT * curtain.config.foldWaves * 1.618 * Math.PI * 2 -
                    drift * 0.73,
                ));

          array[index * 3] = vertex.x;
          array[index * 3 + 1] = vertex.z;
          array[index * 3 + 2] = -(vertex.y + fold + curtain.config.offsetKm);
        }

        positions.needsUpdate = true;
        curtain.geometry.computeBoundingSphere();
      }
    };

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const dt = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        clockRef.current += dt;
      }
      lastFrameRef.current = timestamp;

      writePositions();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [shellL, reducedMotion]);

  // --- spectrometer overlay ---
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!showSpectrometer) return;

      const panelWidth = Math.min(560, width - 48);
      const panelHeight = 190;
      const x = (width - panelWidth) / 2;
      const y = height - panelHeight - 28;

      context.fillStyle = 'rgba(4, 8, 18, 0.86)';
      context.strokeStyle = 'rgba(160, 200, 255, 0.35)';
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(x, y, panelWidth, panelHeight, 12);
      context.fill();
      context.stroke();

      const plotX = x + 44;
      const plotY = y + 34;
      const plotWidth = panelWidth - 64;
      const plotHeight = panelHeight - 74;

      const minNm = 400;
      const maxNm = 700;
      const toX = (nm: number) =>
        plotX + ((nm - minNm) / (maxNm - minNm)) * plotWidth;

      // Spectral reference strip.
      for (let nm = minNm; nm <= maxNm; nm += 1) {
        context.fillStyle = wavelengthToHex(nm);
        context.globalAlpha = 0.5;
        context.fillRect(toX(nm), plotY + plotHeight + 6, plotWidth / (maxNm - minNm) + 1, 9);
      }
      context.globalAlpha = 1;

      context.strokeStyle = 'rgba(190, 215, 255, 0.28)';
      context.beginPath();
      context.moveTo(plotX, plotY + plotHeight);
      context.lineTo(plotX + plotWidth, plotY + plotHeight);
      context.stroke();

      const peak = Math.max(brightness.green, brightness.red, brightness.blue, 1e-9);

      for (const line of AURORAL_LINES) {
        const value = brightness[line.id] / peak;
        const barX = toX(line.wavelengthNm);
        const barHeight = Math.max(1, value * (plotHeight - 16));
        context.strokeStyle = wavelengthToHex(line.wavelengthNm);
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(barX, plotY + plotHeight);
        context.lineTo(barX, plotY + plotHeight - barHeight);
        context.stroke();

        context.fillStyle = 'rgba(226, 236, 255, 0.92)';
        context.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(
          `${line.wavelengthNm.toFixed(1)}`,
          barX,
          plotY + plotHeight - barHeight - 6,
        );
      }

      context.fillStyle = 'rgba(226, 236, 255, 0.92)';
      context.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'left';
      context.fillText('Emission spectrum', x + 16, y + 22);
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = 'rgba(190, 210, 240, 0.72)';
      context.textAlign = 'left';
      context.fillText('discrete lines, not a continuum', x + 16 + 132, y + 22);
      context.textAlign = 'center';
      context.fillText(
        'wavelength (nm)',
        x + panelWidth / 2,
        y + panelHeight - 8,
      );
    };

    draw();
    return onThemeChange(draw);
  }, [showSpectrometer, brightness, overlaySize]);

  // --- field-line inset: mirroring and the loss cone ---
  useEffect(() => {
    const canvas = insetRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = 250;
      const height = 190;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const centreX = width * 0.34;
      const centreY = height * 0.5;
      const earthRadius = 22;
      const scale = earthRadius;

      context.fillStyle = 'rgba(4, 8, 18, 0.82)';
      context.strokeStyle = 'rgba(160, 200, 255, 0.3)';
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(0.5, 0.5, width - 1, height - 1, 10);
      context.fill();
      context.stroke();

      // Earth.
      context.fillStyle = 'rgba(70, 100, 150, 0.55)';
      context.beginPath();
      context.arc(centreX, centreY, earthRadius, 0, Math.PI * 2);
      context.fill();

      // Field line for the current shell.
      const drawLine = (L: number, alpha: number, colour: string) => {
        context.strokeStyle = colour;
        context.globalAlpha = alpha;
        context.lineWidth = 1.4;
        context.beginPath();
        let started = false;
        for (let latDeg = -84; latDeg <= 84; latDeg += 1.5) {
          const lat = (latDeg * Math.PI) / 180;
          const r = L * Math.cos(lat) ** 2;
          if (r < 1) continue;
          const px = centreX + r * scale * Math.cos(lat);
          const py = centreY - r * scale * Math.sin(lat);
          if (!started) {
            context.moveTo(px, py);
            started = true;
          } else {
            context.lineTo(px, py);
          }
        }
        context.stroke();
        context.globalAlpha = 1;
      };

      drawLine(shellL, 0.85, 'rgba(120, 200, 255, 0.9)');

      // Mirror points for the selected pitch angle.
      const pitchRad = (pitchDeg * Math.PI) / 180;
      const mirrorLat = mirrorLatitudeRad(pitchRad);
      const inLossCone = pitchDeg < lossCone;

      for (const sign of [1, -1]) {
        const lat = sign * mirrorLat;
        const r = shellL * Math.cos(lat) ** 2;
        if (r < 1) continue;
        const px = centreX + r * scale * Math.cos(lat);
        const py = centreY - r * scale * Math.sin(lat);
        context.fillStyle = inLossCone
          ? 'rgba(255, 140, 90, 0.95)'
          : 'rgba(190, 255, 190, 0.95)';
        context.beginPath();
        context.arc(px, py, 3.4, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = 'rgba(226, 236, 255, 0.9)';
      context.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'left';
      context.fillText(`L = ${shellL.toFixed(1)}`, 10, 16);
      context.font = '9px ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = 'rgba(190, 210, 240, 0.75)';
      context.fillText(`oval ${oval.toFixed(1)}°`, 10, 30);
      context.fillText(`loss cone ${lossCone.toFixed(2)}°`, 10, 43);
      context.fillStyle = inLossCone
        ? 'rgba(255, 170, 120, 0.95)'
        : 'rgba(170, 235, 175, 0.95)';
      context.fillText(
        inLossCone ? 'precipitates → light' : 'trapped → mirrors',
        10,
        height - 12,
      );
    };

    draw();
    return onThemeChange(draw);
  }, [shellL, pitchDeg, lossCone, oval]);

  const probeColour = useMemo(() => {
    const sample = sampleProfile(profile, probeAltitude);
    if (!sample) return 'rgb(120,140,170)';
    const { r, g, b } = compositeColour(
      { green: sample.green, red: sample.red, blue: sample.blue },
      1,
    );
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }, [profile, probeAltitude]);

  const handleProbePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const t = 1 - (event.clientY - rect.top) / rect.height;
    const altitude = MIN_ALT_KM + (MAX_ALT_KM - MIN_ALT_KM) * Math.min(1, Math.max(0, t));
    setProbeAltitude(Math.round(altitude));
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="relative min-h-[32rem] flex-1 overflow-hidden"
        style={{ backgroundColor: '#03060f', touchAction: 'none' }}
        onPointerDown={(event) => {
          if (!probeActive) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          handleProbePointer(event);
        }}
        onPointerMove={handleProbePointer}
        onPointerUp={(event) => {
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div
          ref={mountRef}
          className="absolute inset-0"
          aria-label={`Aurora over a ${OBSERVER_LAT_DEG} degree magnetic latitude horizon. Curtains of light hang along field lines on shell L equals ${shellL.toFixed(1)}, coloured by which emission lines survive collisional quenching at each altitude. Precipitating electron energy is ${energyKeV.toFixed(1)} kiloelectronvolts, depositing most of its energy near ${peakAltitude.toFixed(0)} kilometres.`}
          role="img"
        />

        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        />

        <canvas
          ref={insetRef}
          className="pointer-events-none absolute top-4 left-4 hidden rounded-lg md:block"
          aria-hidden="true"
        />

        {probeActive && (
          <div
            className="pointer-events-none absolute right-0 left-0"
            style={{
              top: `${(1 - (probeAltitude - MIN_ALT_KM) / (MAX_ALT_KM - MIN_ALT_KM)) * 100}%`,
            }}
          >
            <div
              className="h-px w-full"
              style={{ backgroundColor: probeColour, opacity: 0.75 }}
            />
            <div
              className="absolute right-4 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{
                backgroundColor: 'rgba(4, 8, 18, 0.86)',
                color: probeColour,
                border: `1px solid ${probeColour}`,
              }}
            >
              {probeAltitude} km
            </div>
          </div>
        )}

        <div className="absolute right-4 bottom-4 flex flex-col gap-2">
          <Button
            variant={showSpectrometer ? 'primary' : 'secondary'}
            onClick={() => setShowSpectrometer((value) => !value)}
          >
            Spectrometer
          </Button>
          <Button
            variant={probeActive ? 'primary' : 'secondary'}
            onClick={() => setProbeActive((value) => !value)}
          >
            Altitude probe
          </Button>
        </div>
      </div>

      <div className="border-t border-[var(--grid-line)] bg-[var(--sim-bg)] px-5 py-4">
        <ControlBar align="start">
          <Slider
            label="Electron energy"
            min={0.3}
            max={30}
            step={0.1}
            value={energyKeV}
            onChange={setEnergyKeV}
            unit="keV"
            format={(value) => value.toFixed(1)}
          />
          <Slider
            label="Flux"
            min={0.2}
            max={2.5}
            step={0.05}
            value={flux}
            onChange={setFlux}
            format={(value) => `${value.toFixed(2)}×`}
          />
          <Slider
            label="Shell"
            min={4}
            max={12}
            step={0.1}
            value={shellL}
            onChange={setShellL}
            format={(value) => `L = ${value.toFixed(1)}`}
          />
          <Slider
            label="Pitch angle"
            min={0.5}
            max={90}
            step={0.5}
            value={pitchDeg}
            onChange={setPitchDeg}
            unit="°"
            format={(value) => value.toFixed(1)}
          />
        </ControlBar>

        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          Energy deposition peaks near{' '}
          <strong className="text-[var(--text-primary)]">
            {peakAltitude.toFixed(0)} km
          </strong>
          , the oval sits at{' '}
          <strong className="text-[var(--text-primary)]">{oval.toFixed(1)}°</strong>{' '}
          magnetic latitude, and the curtain leans{' '}
          <strong className="text-[var(--text-primary)]">{tilt.toFixed(0)}°</strong>{' '}
          from vertical. Only particles inside the{' '}
          <strong className="text-[var(--text-primary)]">
            {lossCone.toFixed(2)}°
          </strong>{' '}
          loss cone ever reach the atmosphere.
        </p>

        {probeActive && (
          <div className="mt-3 rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-3">
            <Readout variant="inline">
              <Readout.Group label={`At ${probeAltitude} km`}>
                <Readout.Value
                  label="N₂"
                  value={probeDensities.n2.toExponential(1)}
                  unit="cm⁻³"
                />
                <Readout.Value
                  label="O"
                  value={probeDensities.o.toExponential(1)}
                  unit="cm⁻³"
                />
              </Readout.Group>
            </Readout>
            <ul className="mt-2 space-y-1 text-sm text-[var(--text-muted)]">
              {probeLines.map(({ line, efficiency, collisionRate }) => (
                <li key={line.id}>
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: wavelengthToHex(line.wavelengthNm) }}
                  />
                  <strong className="text-[var(--text-primary)]">
                    {line.wavelengthNm.toFixed(1)} nm
                  </strong>{' '}
                  {line.transition} — radiates{' '}
                  <strong className="text-[var(--text-primary)]">
                    {(efficiency * 100).toFixed(efficiency < 0.1 ? 2 : 0)}%
                  </strong>{' '}
                  of the time here (collisions {collisionRate.toExponential(1)} s⁻¹
                  against A = {line.einsteinA.toExponential(1)} s⁻¹)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
