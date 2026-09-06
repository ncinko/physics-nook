import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Button, ControlBar, Select, Slider, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { themeColors, onThemeChange } from '../shared/themeColors';
import { formatFlux, gaussianSurface, gaussPreset, measureFlux, type Charge3D, type GaussianShape, type Vector3 } from '../../lib/electromagnetism/gauss';

type SceneState = {
  charges: Charge3D[];
  surface: ReturnType<typeof gaussianSurface>;
  measurement: ReturnType<typeof measureFlux>;
  arrows: boolean;
  normals: boolean;
};

export default function GaussLawExplorer() {
  const [preset, setPreset] = useState('centered');
  const [shape, setShape] = useState<GaussianShape>('sphere');
  const [radius, setRadius] = useState(1.2);
  const [charges, setCharges] = useState<Charge3D[]>(() => gaussPreset('centered'));
  const [selected, setSelected] = useState(1);
  const [arrows, setArrows] = useState(true), [normals, setNormals] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; density: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const updateScene = useRef<(state: SceneState) => void>(() => {});
  const resetCamera = useRef<() => void>(() => {});
  const moveCharge = useRef<(id: number, position: Vector3) => void>(() => {});
  const surface = useMemo(() => gaussianSurface(shape, radius), [shape, radius]);
  const measurement = useMemo(() => measureFlux(surface, charges), [surface, charges]);
  moveCharge.current = (id, position) => {
    setSelected(id); setPreset('custom');
    setCharges(previous => previous.map(c => c.id === id ? { ...c, position } : c));
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    renderer.domElement.setAttribute('aria-label', 'Rotatable three-dimensional Gaussian surface with draggable charges');
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(4.4, 3.1, 5.8);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enablePan = false; orbit.enableZoom = false;
    orbit.minPolarAngle = 0.15; orbit.maxPolarAngle = Math.PI - 0.15;
    orbit.update();
    let group = new THREE.Group(); scene.add(group);
    let latest: SceneState | null = null;
    let surfaceMesh: THREE.Mesh | null = null;
    let chargeMeshes: THREE.Mesh[] = [];
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane();
    let dragging: number | null = null;
    const render = () => renderer.render(scene, camera);
    orbit.addEventListener('change', render);
    const disposeGroup = () => {
      group.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          (material as THREE.SpriteMaterial).map?.dispose(); material.dispose();
        }
      });
      scene.remove(group);
    };
    const rebuild = (state: SceneState) => {
      latest = state;
      setHover(null);
      disposeGroup(); group = new THREE.Group(); scene.add(group);
      const palette = themeColors();
      const positions: number[] = [], colors: number[] = [];
      const magnitudes = state.measurement.patches.map(p => Math.abs(p.density)).filter(Number.isFinite).sort((a, b) => a - b);
      const scale = magnitudes[Math.floor(magnitudes.length * 0.9)] || 1;
      const neutral = new THREE.Color(palette.bg), positive = new THREE.Color(palette.positive), negative = new THREE.Color(palette.negative);
      state.surface.forEach((triangle, index) => {
        const density = state.measurement.patches[index].density;
        const strength = Number.isFinite(density) ? Math.min(1, Math.abs(density) / scale) : 0;
        const color = neutral.clone().lerp(density < 0 ? negative : positive, strength * 0.85);
        for (const vertex of triangle.vertices) { positions.push(...vertex); colors.push(color.r, color.g, color.b); }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      surfaceMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      group.add(surfaceMesh);
      // Thin edges expose the closed surface without overwhelming the shading.
      const edges = new THREE.EdgesGeometry(geometry, 12);
      group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: palette.muted, transparent: true, opacity: 0.45 })));
      const spacing = Math.max(...state.surface.map(t => Math.hypot(...t.center))) * 0.42;
      const sampled: THREE.Vector3[] = [];
      state.surface.forEach((t, i) => {
        if (state.measurement.onBoundary) return;
        const center = new THREE.Vector3(...t.center);
        if (sampled.some(other => other.distanceTo(center) < spacing)) return;
        sampled.push(center);
        const field = new THREE.Vector3(...state.measurement.patches[i].field);
        if (state.arrows && field.length() > 1e-8 && Number.isFinite(field.length())) {
          group.add(new THREE.ArrowHelper(field.clone().normalize(), center, 0.23 + 0.13 * Math.min(1, field.length() / scale), palette.text, 0.08, 0.04));
        }
        if (state.normals && sampled.length % 3 === 1) group.add(new THREE.ArrowHelper(new THREE.Vector3(...t.normal), center, 0.32, palette.probe, 0.08, 0.04));
      });
      chargeMeshes = state.charges.map(charge => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), new THREE.MeshBasicMaterial({ color: charge.q > 0 ? palette.positive : palette.negative }));
        ball.position.set(...charge.position); ball.userData.chargeId = charge.id;
        group.add(ball);
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = palette.text; ctx.font = 'bold 46px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(charge.q > 0 ? '+' : '−', 32, 32);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
        sprite.position.copy(ball.position); sprite.scale.set(0.16, 0.16, 1); sprite.renderOrder = 5; group.add(sprite);
        return ball;
      });
      render();
    };
    updateScene.current = rebuild;
    resetCamera.current = () => { camera.position.set(4.4, 3.1, 5.8); orbit.target.set(0, 0, 0); orbit.update(); render(); };
    const locate = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      return rect;
    };
    const down = (event: PointerEvent) => {
      locate(event); setHover(null);
      const hit = ray.intersectObjects(chargeMeshes)[0];
      if (!hit) return;
      dragging = hit.object.userData.chargeId;
      setSelected(dragging!);
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hit.object.position);
      orbit.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const rect = locate(event);
      if (dragging !== null) {
        const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (hit) moveCharge.current(dragging, hit.toArray().map(x => Math.max(-3, Math.min(3, x))) as unknown as Vector3);
        return;
      }
      if (event.buttons || !surfaceMesh || latest?.measurement.onBoundary) { setHover(null); return; }
      const hit = ray.intersectObject(surfaceMesh)[0];
      if (hit && hit.faceIndex !== undefined && hit.faceIndex !== null && latest) {
        setHover({ x: Math.max(6, Math.min(rect.width - 170, event.clientX - rect.left + 12)),
          y: Math.max(6, event.clientY - rect.top - 35), density: latest.measurement.patches[hit.faceIndex].density });
      } else setHover(null);
    };
    const up = () => { dragging = null; orbit.enabled = true; };
    const leave = () => setHover(null);
    // Capture runs before OrbitControls' pointer handler, so charge drags do not rotate the view.
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    renderer.domElement.addEventListener('pointerleave', leave);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // Preserve horizontal room for external charges on portrait screens.
      camera.fov = w < 500 ? 46 : 38; camera.updateProjectionMatrix(); render();
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    const unwatch = onThemeChange(() => { if (latest) rebuild(latest); });
    resize();
    return () => {
      observer.disconnect(); unwatch(); orbit.dispose(); disposeGroup(); renderer.dispose();
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('pointerleave', leave);
      renderer.domElement.remove(); updateScene.current = () => {}; resetCamera.current = () => {};
    };
  }, []);

  useEffect(() => { updateScene.current({ charges, surface, measurement, arrows, normals }); }, [charges, surface, measurement, arrows, normals]);
  const selectedCharge = charges.find(c => c.id === selected);
  const setCoordinate = (index: number, value: number) => {
    if (!selectedCharge) return;
    const position = [...selectedCharge.position]; position[index] = value;
    moveCharge.current(selected, position as unknown as Vector3);
  };
  const loadPreset = (name: string) => {
    setPreset(name); setCharges(gaussPreset(name)); setSelected(1); setRadius(1.2);
  };
  const addCharge = (q: number) => {
    const id = Math.max(0, ...charges.map(c => c.id)) + 1;
    setCharges([...charges, { id, q, position: [1.9, 0.4 * (charges.length - 1), 0] }]); setSelected(id); setPreset('custom');
  };
  return <div className="not-prose mx-auto max-w-5xl p-3 text-[var(--text-primary)]">
    <ControlBar>
      <Select label="Preset" value={preset} onChange={loadPreset} options={[
        { value: 'centered', label: 'Centered charge' }, { value: 'off-center', label: 'Off-center charge' },
        { value: 'external', label: 'External charge' }, { value: 'dipole', label: 'Enclosed dipole' },
        ...(preset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
      ]} />
      <Select label="Surface" value={shape} onChange={v => setShape(v as GaussianShape)} options={[
        { value: 'sphere', label: 'Sphere' }, { value: 'ellipsoid', label: 'Ellipsoid' }, { value: 'box', label: 'Box' },
      ]} />
      <Slider label="Size" unit="m" min={0.6} max={1.7} step={0.1} value={radius} onChange={setRadius} format={v => v.toFixed(1)} />
    </ControlBar>
    {unavailable ? <p className="my-8 text-center" role="status">The 3D scene needs WebGL. The controls and flux readouts below still work.</p> :
      <div ref={hostRef} className="relative my-2 aspect-[3/2] min-h-[280px] max-h-[520px] w-full overflow-hidden rounded-lg bg-[var(--sim-bg)]">
        {hover && <div role="tooltip" className="pointer-events-none absolute rounded border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-xs"
          style={{ left: hover.x, top: hover.y }}>E · n̂ ≈ {formatFlux(hover.density)} N/C</div>}
      </div>}
    <ControlBar className="mb-3">
      <Toggle label="Field arrows" checked={arrows} onChange={setArrows} />
      <Toggle label="Outward normals" checked={normals} onChange={setNormals} />
      <Button variant="secondary" onClick={() => resetCamera.current()}>Reset view</Button>
    </ControlBar>
    <Readout>
      <Readout.Value label="Enclosed charge" value={measurement.enclosedCharge === null ? '—' : formatFlux(measurement.enclosedCharge * 1e9)} unit="nC" />
      <Readout.Value label="Total flux" value={formatFlux(measurement.flux)} unit="N·m²/C" />
    </Readout>
    {measurement.onBoundary && <p role="status" className="my-2 text-center text-sm">Move the charge clear of the surface to measure its flux.</p>}
    <p className="my-3 text-center text-sm text-[var(--text-muted)]"><span className="text-[var(--accent-red)]">Red: outward flux.</span>{' '}
      <span className="text-[var(--accent-blue)]">Blue: inward flux.</span> Drag a charge to move it; drag empty space to rotate.</p>
    <ControlBar className="mb-3">
      {charges.length > 0 && <Select label="Charge" value={String(selected)} onChange={v => setSelected(Number(v))}
        options={charges.map(c => ({ value: String(c.id), label: `${c.id}: ${c.q > 0 ? '+' : '−'}1 nC` }))} />}
      <Button variant="secondary" disabled={charges.length >= 4} onClick={() => addCharge(1e-9)}>Add +</Button>
      <Button variant="secondary" disabled={charges.length >= 4} onClick={() => addCharge(-1e-9)}>Add −</Button>
      <Button variant="secondary" disabled={!selectedCharge} onClick={() => {
        const remaining = charges.filter(c => c.id !== selected); setCharges(remaining); setSelected(remaining[0]?.id ?? 0); setPreset('custom');
      }}>Remove</Button>
    </ControlBar>
    {selectedCharge && <ControlBar>
      {['x', 'y', 'z'].map((axis, index) => <Slider key={axis} label={axis} unit="m" min={-3} max={3} step={0.05}
        value={selectedCharge.position[index]} onChange={v => setCoordinate(index, v)} format={v => v.toFixed(2)} />)}
    </ControlBar>}
  </div>;
}
