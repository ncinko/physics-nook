import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Button, ControlBar } from '../shared/InlineControls';
import { themeColors, onThemeChange, getCssColor } from '../shared/themeColors';
// The landscape this figure draws. Swap this one import for
// '../../lib/electromagnetism/terrain' to go back to the modelled volcano;
// both modules expose the same names.
import { shortestTurn, orbitEye, frameHalfWidth, nearestSegment, hitScore,
  type Vector3 } from '../../lib/electromagnetism/landscapeView';
import { buildTerrain, terrainCover, TERRAIN_WIDTH, TERRAIN_DEPTH, VERTICAL_SCALE,
  LIGHT_CONTOUR_MAX, LANDSCAPE_DESCRIPTION, ELEVATION_CREDIT,
  ELEVATION_LEVELS, EXAGGERATION } from '../../lib/electromagnetism/terrainHakone';

// Camera elevation above the horizontal: the default three-quarter view, a true
// overhead orthographic view that reads as a flat contour map, and how far down
// a drag may push the eye before the landscape goes edge-on and unreadable.
const TILTED = 34, OVERHEAD = 90, GRAZING = 12, SWEEP = OVERHEAD - TILTED;
// Unhurried enough to follow a single contour from the flank onto the map.
const FULL_TURN_MS = 1800;
// Degrees turned per pixel dragged.
const SPIN_PER_PIXEL = 0.32, PITCH_PER_PIXEL = 0.3;
// How close the pointer must come to a contour, in CSS pixels, to read it.
const PROBE_RADIUS = 9;
// The framing the two fixed views use; a spin only ever widens it from here.
const FRAME_HALF_WIDTH = 1280, FRAME_MARGIN = 1.04;

type View = 'tilted' | 'overhead' | 'free';

export default function TopographicLandscape() {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<(view: View) => void>(() => {});
  const [view, setView] = useState<View>('tilted');
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1300, 1300, 900, -900, 1, 10000);
    const terrain = buildTerrain();
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let row = 0; row < terrain.rows; row++) {
      for (let col = 0; col < terrain.columns; col++) {
        positions.push(col / (terrain.columns - 1) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2,
          terrain.heights[row * terrain.columns + col] * VERTICAL_SCALE,
          row / (terrain.rows - 1) * TERRAIN_DEPTH - TERRAIN_DEPTH / 2);
        colors.push(0, 0, 0);
        if (row < terrain.rows - 1 && col < terrain.columns - 1) {
          const a = row * terrain.columns + col, b = a + 1;
          const d = a + terrain.columns, c = d + 1;
          // Match the contour helper's diagonal, with upward-facing normals.
          indices.push(a, c, b, a, d, c);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    scene.add(new THREE.Mesh(geometry, material));
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-800, 1800, 600);
    scene.add(ambient, sun);

    const lines = terrain.contours.map(contour => {
      const coords: number[] = [];
      for (const segment of contour.segments) {
        for (const [x, z] of segment) coords.push(x - TERRAIN_WIDTH / 2,
          contour.level * VERTICAL_SCALE + 1, z - TERRAIN_DEPTH / 2);
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      const lineMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
      const line = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(line);
      return { level: contour.level, line, points: coords };
    });
    const pointCount = lines.reduce((total, item) => total + item.points.length / 3, 0);
    // Corners of the box the landscape sits in, for keeping it inside the frame.
    let ceiling = 0;
    for (let i = 1; i < positions.length; i += 3) ceiling = Math.max(ceiling, positions[i]);
    const bounds: Vector3[] = [];
    for (const x of [-TERRAIN_WIDTH / 2, TERRAIN_WIDTH / 2]) for (const y of [0, ceiling]) {
      for (const z of [-TERRAIN_DEPTH / 2, TERRAIN_DEPTH / 2]) bounds.push([x, y, z]);
    }

    let width = 700, height = 460, frame = 0;
    let elevation = TILTED, azimuth = 0;
    let startElevation = elevation, startAzimuth = azimuth;
    let elevationTurn = 0, azimuthTurn = 0, startTime = 0, duration = 0;
    let palette = themeColors();
    let reading: { level: number; x: number; y: number } | null = null;
    const ctx = overlay.getContext('2d')!;

    // Every contour point in screen pixels, refilled only when something asks
    // to read the map after the camera has moved.
    const screen = new Float32Array(pointCount * 3);
    let projectionStale = true;
    const scratch = new THREE.Vector3();
    const project = () => {
      let k = 0;
      for (const item of lines) {
        for (let i = 0; i < item.points.length; i += 3) {
          scratch.set(item.points[i], item.points[i + 1], item.points[i + 2]).project(camera);
          screen[k++] = (scratch.x + 1) * width / 2;
          screen[k++] = (1 - scratch.y) * height / 2;
          screen[k++] = scratch.z;
        }
      }
      projectionStale = false;
    };

    /** The contour nearest a point on screen, or null if none is close enough. */
    const readAt = (px: number, py: number) => {
      if (projectionStale) project();
      let best: { level: number; x: number; y: number } | null = null;
      let bestScore = Infinity, offset = 0;
      for (const item of lines) {
        const count = item.points.length / 3;
        const hit = nearestSegment(screen, offset, count, px, py, PROBE_RADIUS);
        offset += count;
        if (!hit) continue;
        const score = hitScore(hit);
        if (score < bestScore) { bestScore = score; best = { level: item.level, x: hit.x, y: hit.y }; }
      }
      return best;
    };

    const place = () => {
      // Keep the whole landscape framed as the eye rises: the look-at point
      // drops from the hillside to the ground plane on the way overhead.
      const eye = orbitEye(elevation, azimuth, 3000, 180 * (1 - (elevation - TILTED) / SWEEP));
      camera.position.set(...eye.position);
      camera.up.set(...eye.up);
      camera.lookAt(...eye.target);
      camera.updateMatrixWorld();
      // Turned off the axes the map is drawn on, its corners swing well outside
      // the fixed views' frame, so widen to hold them — never tighten.
      const aspect = height / width;
      const half = Math.max(FRAME_HALF_WIDTH, FRAME_MARGIN * frameHalfWidth(bounds, eye, aspect));
      camera.left = -half; camera.right = half;
      camera.top = half * aspect; camera.bottom = -half * aspect;
      camera.updateProjectionMatrix();
      projectionStale = true;
    };

    /** The readout and its marker, over the rendered scene. */
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!reading) return;
      ctx.font = `${width < 450 ? 11 : 13}px system-ui`;
      ctx.textBaseline = 'middle';
      const text = `${reading.level} m`;
      const boxWidth = ctx.measureText(text).width + 14;
      const x = Math.min(width - boxWidth - 4, Math.max(4, reading.x + 14));
      const y = Math.max(14, reading.y - 18);
      ctx.strokeStyle = palette.muted;
      ctx.fillStyle = palette.surface;
      ctx.beginPath(); ctx.rect(x, y - 10, boxWidth, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = palette.text;
      ctx.fillText(text, x + 7, y);
      ctx.beginPath(); ctx.arc(reading.x, reading.y, 3.5, 0, Math.PI * 2); ctx.fill();
    };

    const draw = () => {
      place();
      // Remove directional shading overhead so this reads as a 2D contour map.
      const flat = Math.max(0, Math.min(1, (elevation - TILTED) / SWEEP));
      sun.intensity = 1.7 * (1 - flat);
      ambient.intensity = 1.1 + 1.1 * flat;
      renderer.render(scene, camera);
      paint();
    };

    /** Lift the contour being read out of the pack. */
    const highlight = () => {
      for (const item of lines) item.line.material.opacity = item.level === reading?.level ? 1 : 0.5;
    };

    const applyTheme = () => {
      palette = themeColors();
      const forest = new THREE.Color(getCssColor('--terrain-forest', palette.probe));
      const rock = new THREE.Color(getCssColor('--terrain-rock', palette.muted));
      const snow = new THREE.Color(getCssColor('--terrain-snow', palette.bg));
      const water = new THREE.Color(getCssColor('--terrain-water', palette.probe));
      const colorAttribute = geometry.getAttribute('color');
      terrain.heights.forEach((h, i) => {
        const cover = terrainCover(positions[i * 3], positions[i * 3 + 2], h);
        const color = rock.clone().lerp(forest, cover.forest)
          .lerp(snow, cover.snow).lerp(water, cover.water);
        colorAttribute.setXYZ(i, color.r, color.g, color.b);
      });
      colorAttribute.needsUpdate = true;
      for (const item of lines) {
        item.line.material.color.set(item.level <= LIGHT_CONTOUR_MAX
          ? getCssColor('--terrain-snow', palette.bg) : getCssColor('--terrain-contour', palette.text));
      }
      draw();
    };

    const animate = (time: number) => {
      // Start the clock on the first painted frame, so click-to-paint latency
      // is not silently spent and the turn always opens from a standstill.
      if (startTime < 0) startTime = time;
      const t = Math.max(0, Math.min(1, (time - startTime) / duration));
      // Smootherstep: acceleration as well as speed starts and ends at zero,
      // so the turn eases off the standstill instead of snapping into it.
      const eased = t * t * t * (t * (6 * t - 15) + 10);
      elevation = startElevation + elevationTurn * eased;
      azimuth = startAzimuth + azimuthTurn * eased;
      draw();
      frame = t < 1 ? requestAnimationFrame(animate) : 0;
    };

    controlsRef.current = next => {
      if (next === 'free') return;
      const wanted = next === 'overhead' ? OVERHEAD : TILTED;
      const pitch = wanted - elevation, spin = shortestTurn(azimuth, 0);
      if (!pitch && !spin) return;
      cancelAnimationFrame(frame);
      startElevation = elevation; startAzimuth = azimuth;
      elevationTurn = pitch; azimuthTurn = spin;
      // Time the turn by the sweep still to cover, so an interrupted or partial
      // turn travels at the same rate instead of crawling through what is left.
      // Half a revolution of spin is worth a full sweep of pitch.
      duration = FULL_TURN_MS * Math.max(Math.abs(pitch) / SWEEP, Math.abs(spin) / 180);
      if (!duration || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        elevation = wanted; azimuth = 0; frame = 0; draw();
        return;
      }
      startTime = -1;
      frame = requestAnimationFrame(animate);
    };

    let draggingPointer = -1, lastX = 0, lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      draggingPointer = event.pointerId;
      lastX = event.clientX; lastY = event.clientY;
      host.setPointerCapture(event.pointerId);
      cancelAnimationFrame(frame); frame = 0;
      if (reading) { reading = null; highlight(); }
      setView('free');
      draw();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointer) {
        const box = host.getBoundingClientRect();
        const found = readAt(event.clientX - box.left, event.clientY - box.top);
        const swapped = found?.level !== reading?.level;
        reading = found;
        // Only the highlight needs the scene again; a readout that has merely
        // slid along the same contour is a repaint of the overlay.
        if (swapped) { highlight(); draw(); } else paint();
        return;
      }
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      // Drag right and the near face follows the pointer, so the eye goes left.
      azimuth = (azimuth - dx * SPIN_PER_PIXEL) % 360;
      // Touch keeps its vertical axis for scrolling the page; see touch-pan-y.
      if (event.pointerType !== 'touch') {
        elevation = Math.max(GRAZING, Math.min(OVERHEAD, elevation + dy * PITCH_PER_PIXEL));
      }
      draw();
    };
    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointer) return;
      draggingPointer = -1;
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    };
    const onPointerLeave = () => {
      if (draggingPointer === -1 && reading) { reading = null; highlight(); draw(); }
    };
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);
    host.addEventListener('pointerleave', onPointerLeave);

    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      overlay.width = Math.round(width * dpr); overlay.height = Math.round(height * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const unwatch = onThemeChange(applyTheme);
    applyTheme(); resize();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); unwatch();
      controlsRef.current = () => {};
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', endDrag);
      host.removeEventListener('pointercancel', endDrag);
      host.removeEventListener('pointerleave', onPointerLeave);
      geometry.dispose(); material.dispose();
      for (const item of lines) { item.line.geometry.dispose(); item.line.material.dispose(); }
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { controlsRef.current(view); }, [view]);

  const interval = ELEVATION_LEVELS[1] - ELEVATION_LEVELS[0];
  const highest = ELEVATION_LEVELS[ELEVATION_LEVELS.length - 1];
  return (
    <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
      <ControlBar>
        <Button variant={view === 'tilted' ? 'primary' : 'secondary'} aria-pressed={view === 'tilted'}
          onClick={() => setView('tilted')}>3D landscape</Button>
        <Button variant={view === 'overhead' ? 'primary' : 'secondary'} aria-pressed={view === 'overhead'}
          onClick={() => setView('overhead')}>Top-down map</Button>
      </ControlBar>
      {unavailable ? <p className="p-6 text-center" role="status">
        This 3D view needs WebGL. Each contour joins places at the same elevation:
        {' '}{ELEVATION_LEVELS.join(', ')} m. Close contours indicate a steep slope,
        widely spaced ones a gentle slope. The landscape is {LANDSCAPE_DESCRIPTION}.
      </p> : <div ref={hostRef}
        className="relative my-3 aspect-[3/2] w-full cursor-grab touch-pan-y active:cursor-grabbing"
        role="img" aria-label={`${view === 'overhead' ? 'Top-down contour map' : 'Three-dimensional landscape'} of ${LANDSCAPE_DESCRIPTION}. Contours every ${interval} metres from ${ELEVATION_LEVELS[0]} m to ${highest} m: crowded where the ground is steep, widely spaced where it is gentle.`}>
        <canvas ref={overlayRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>}
      <figcaption className="text-center text-sm leading-relaxed text-[var(--text-muted)]">
        Drag the landscape to turn it, or switch to the map to see the same hills from
        above. Point at a contour to read its height; they run every {interval} m, from
        {' '}{ELEVATION_LEVELS[0]} m to {highest} m. Close lines mean steep slopes,
        widely spaced lines gentler ones.
        {ELEVATION_CREDIT && <><br /><span className="text-xs">{ELEVATION_CREDIT}. Heights shown with {EXAGGERATION}x vertical exaggeration.</span></>}
      </figcaption>
    </figure>
  );
}
