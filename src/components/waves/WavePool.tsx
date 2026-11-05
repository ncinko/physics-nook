import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button, ControlBar, Select, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  MAX_PITCH,
  MIN_DISTANCE,
  MIN_PITCH,
  TAN_HALF_FOV,
  cameraBasis,
  clampTarget,
  maxDistance,
  pickGround,
  type PoolView,
} from '../../lib/wavepool/camera.ts';
import {
  DEFAULT_AMP,
  DEFAULT_FREQ,
  PRESETS,
  SHOAL_DEPTH,
  buildPreset,
  stampDisc,
  stampSegment,
} from '../../lib/wavepool/presets.ts';
import { PARAMS_FLOATS, PARAMS_STRIDE, RENDER_FLOATS, renderShader, simShader } from '../../lib/wavepool/shaders.ts';
import {
  ABSORBER_TUNING,
  DEFAULT_ABSORBER,
  DEFAULT_N,
  DT,
  MAX_BETA,
  MAX_SOURCES,
  wavelength,
  type Source,
} from '../../lib/wavepool/solver.ts';

// The WebGPU typings are not part of this project's TypeScript libs, so the device is
// treated structurally. Flag values are from the WebGPU spec.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Gpu = any;
const BUFFER = { COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };

const N = DEFAULT_N;
const ABSORBER = DEFAULT_ABSORBER;
const MAX_SUBSTEPS = 8;

type Tool = 'view' | 'source' | 'maker' | 'wall' | 'shoal' | 'erase' | 'pebble';
type ViewMode = 'lit' | 'top';

const TOOLS: Array<{ value: Tool; label: string }> = [
  { value: 'source', label: 'Source' },
  { value: 'maker', label: 'Wavemaker' },
  { value: 'wall', label: 'Barrier' },
  { value: 'shoal', label: 'Shoal' },
  { value: 'erase', label: 'Erase' },
  { value: 'pebble', label: 'Pebble' },
  { value: 'view', label: 'Orbit' },
];

const TOOL_HINT: Record<Tool, string> = {
  source: 'Click to place an oscillating source; click one to select or drag it.',
  maker: 'Click to place a line wavemaker that sends out a plane wave.',
  wall: 'Drag to draw a reflecting barrier. Leave gaps to make slits.',
  shoal: 'Drag to raise the bottom. Shallow water is slow water, so waves bend toward it.',
  erase: 'Drag to remove barriers and shoals.',
  pebble: 'Click to drop a single splash.',
  view: 'Drag to orbit, shift-drag to pan, scroll to zoom. Right-drag orbits in any tool. WASD pans, Q/E lowers and raises the camera.',
};

interface InputState {
  mode: 'none' | 'orbit' | 'pan' | 'paint' | 'dragSource';
  lastX: number;
  lastY: number;
  anchor: { x: number; y: number } | null;
  sourceId: number;
}

interface Runtime {
  device: Gpu;
  context: Gpu;
  format: string;
  simPipelines: { velocity: Gpu; height: Gpu; bump: Gpu };
  renderPipeline: Gpu;
  simBind: Gpu;
  renderBind: Gpu;
  buffers: { h: Gpu; ux: Gpu; uy: Gpu; d: Gpu; params: Gpu; render: Gpu };
  depth: Float32Array;
  depthDirty: boolean;
  time: number;
  pendingBump: { x: number; y: number; amp: number; radius: number } | null;
  stepOnce: boolean;
  clearRequested: boolean;
}

interface UiSource extends Source {
  id: number;
}

function paramsData(
  out: Float32Array,
  nsrc: number,
  sources: UiSource[],
  time: number,
  beta: number,
  friction: number,
  bump: Runtime['pendingBump'],
): void {
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length);
  out.fill(0);
  u32[0] = N;
  u32[1] = nsrc;
  out[4] = DT;
  out[5] = time;
  out[6] = beta;
  out[7] = friction;
  out[8] = ABSORBER;
  out[9] = ABSORBER_TUNING.factor;
  out[10] = ABSORBER_TUNING.power;
  if (bump) {
    out[12] = bump.x;
    out[13] = bump.y;
    out[14] = bump.amp;
    out[15] = bump.radius;
  }
  for (let k = 0; k < nsrc; k += 1) {
    const s = sources[k]!;
    const o = 16 + k * 8;
    out[o] = s.x;
    out[o + 1] = s.y;
    out[o + 2] = 2 * Math.PI * s.freq;
    out[o + 3] = s.amp;
    out[o + 4] = s.phase;
    out[o + 5] = s.half;
    out[o + 6] = s.angle;
  }
}

export default function WavePool() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const sourcesRef = useRef<UiSource[]>([]);
  const nextIdRef = useRef(1);
  const viewRef = useRef<PoolView>({ yaw: -Math.PI / 2, pitch: 0.55, distance: 560, targetX: N / 2, targetY: N / 2 });
  const cursorRef = useRef({ x: 0, y: 0, visible: false });
  const inputRef = useRef<InputState>({ mode: 'none', lastX: 0, lastY: 0, anchor: null, sourceId: 0 });
  const sizeRef = useRef({ width: 1, height: 1, dirty: true });
  const keysRef = useRef(new Set<string>());

  const [status, setStatus] = useState<'init' | 'ready' | 'unsupported' | 'error'>('init');
  const [errorText, setErrorText] = useState('');
  const [tool, setTool] = useState<Tool>('source');
  const [brush, setBrush] = useState(4);
  const [presetId, setPresetId] = useState('double-slit');
  const [viewMode, setViewMode] = useState<ViewMode>('lit');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [exaggeration, setExaggeration] = useState(8);
  const [beta, setBeta] = useState(0);
  const [friction, setFriction] = useState(0.0005);
  const [defaultFreq, setDefaultFreq] = useState(DEFAULT_FREQ);
  const [defaultStrength, setDefaultStrength] = useState(1);
  const [, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(0);
  const [simTime, setSimTime] = useState(0);

  const live = useRef({ tool, brush, viewMode, paused, speed, exaggeration, beta, friction, defaultFreq, defaultStrength, selectedId });
  live.current = { tool, brush, viewMode, paused, speed, exaggeration, beta, friction, defaultFreq, defaultStrength, selectedId };

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const loadPreset = useCallback(
    (id: string) => {
      const built = buildPreset(id, N, ABSORBER);
      const rt = runtimeRef.current;
      sourcesRef.current = built.sources.map((s) => ({ ...s, id: nextIdRef.current++ }));
      setSelectedId(0);
      if (rt) {
        rt.depth.set(built.depth);
        rt.depthDirty = true;
        rt.clearRequested = true;
      }
      bump();
    },
    [bump],
  );

  // ---- WebGPU setup and the frame loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let raf = 0;
    let lastReadout = 0;
    const observer = new ResizeObserver(() => {
      sizeRef.current.dirty = true;
    });
    observer.observe(canvas);

    const gpu = (navigator as any).gpu;
    if (!gpu) {
      setStatus('unsupported');
      return () => observer.disconnect();
    }

    (async () => {
      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter available.');
        const device: Gpu = await adapter.requestDevice();
        if (disposed) {
          device.destroy?.();
          return;
        }
        device.lost?.then((info: any) => {
          if (!disposed) {
            setErrorText(`GPU device lost: ${info?.message ?? 'unknown'}`);
            setStatus('error');
          }
        });
        const context: Gpu = canvas.getContext('webgpu');
        const format: string = gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });

        const cells = N * N * 4;
        const mk = (size: number, usage: number): Gpu => device.createBuffer({ size, usage });
        const storage = BUFFER.STORAGE | BUFFER.COPY_DST;
        const buffers = {
          h: mk(cells, storage),
          ux: mk(cells, storage),
          uy: mk(cells, storage),
          d: mk(cells, storage),
          params: mk(PARAMS_STRIDE * MAX_SUBSTEPS, BUFFER.UNIFORM | BUFFER.COPY_DST),
          render: mk(RENDER_FLOATS * 4, BUFFER.UNIFORM | BUFFER.COPY_DST),
        };

        const simModule = device.createShaderModule({ code: simShader });
        const renderModule = device.createShaderModule({ code: renderShader });
        for (const [label, mod] of [['sim', simModule], ['render', renderModule]] as const) {
          const info = await mod.getCompilationInfo();
          const errors = info.messages.filter((m: any) => m.type === 'error');
          if (errors.length) {
            throw new Error(`${label} shader: ${errors.map((m: any) => `${m.lineNum}: ${m.message}`).join('; ')}`);
          }
        }

        const simLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: STAGE.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
            { binding: 1, visibility: STAGE.COMPUTE, buffer: { type: 'storage' } },
            { binding: 2, visibility: STAGE.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: STAGE.COMPUTE, buffer: { type: 'storage' } },
            { binding: 4, visibility: STAGE.COMPUTE, buffer: { type: 'read-only-storage' } },
          ],
        });
        const simPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
        const compute = (entryPoint: string): Gpu =>
          device.createComputePipeline({ layout: simPipeLayout, compute: { module: simModule, entryPoint } });
        const simPipelines = { velocity: compute('stepVelocity'), height: compute('stepHeight'), bump: compute('addBump') };
        const simBind = device.createBindGroup({
          layout: simLayout,
          entries: [
            { binding: 0, resource: { buffer: buffers.params, offset: 0, size: PARAMS_FLOATS * 4 } },
            { binding: 1, resource: { buffer: buffers.h } },
            { binding: 2, resource: { buffer: buffers.ux } },
            { binding: 3, resource: { buffer: buffers.uy } },
            { binding: 4, resource: { buffer: buffers.d } },
          ],
        });

        const renderLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: STAGE.FRAGMENT | STAGE.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } },
          ],
        });
        const renderPipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
          vertex: { module: renderModule, entryPoint: 'vs' },
          fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
        const renderBind = device.createBindGroup({
          layout: renderLayout,
          entries: [
            { binding: 0, resource: { buffer: buffers.render } },
            { binding: 1, resource: { buffer: buffers.h } },
            { binding: 2, resource: { buffer: buffers.d } },
          ],
        });

        const rt: Runtime = {
          device,
          context,
          format,
          simPipelines,
          renderPipeline,
          simBind,
          renderBind,
          buffers,
          depth: new Float32Array(N * N).fill(1),
          depthDirty: true,
          time: 0,
          pendingBump: null,
          stepOnce: false,
          clearRequested: true,
        };
        runtimeRef.current = rt;
        loadPreset('double-slit');
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          setPaused(true);
        }
        setStatus('ready');

        const paramScratch = new Float32Array(PARAMS_FLOATS);
        const renderScratch = new Float32Array(RENDER_FLOATS);
        const zeros = new Float32Array(N * N);
        const groups = Math.ceil(N / 8);
        let lastTime = performance.now();

        const frame = (now: number) => {
          if (disposed) return;
          raf = requestAnimationFrame(frame);
          const ui = live.current;
          const frameDt = Math.min(0.1, (now - lastTime) / 1000);
          lastTime = now;

          // WASD pans across the water; Q/E change the camera height. Panning moves the
          // orbit target, so the eye height stays the same whatever the viewing angle.
          const keys = keysRef.current;
          if (keys.size > 0) {
            const v = viewRef.current;
            const fx = -Math.cos(v.yaw);
            const fy = -Math.sin(v.yaw);
            const move = v.distance * 0.9 * frameDt;
            let dx = 0;
            let dy = 0;
            if (keys.has('w')) { dx += fx; dy += fy; }
            if (keys.has('s')) { dx -= fx; dy -= fy; }
            if (keys.has('d')) { dx -= fy; dy += fx; }
            if (keys.has('a')) { dx += fy; dy -= fx; }
            if (dx !== 0 || dy !== 0) {
              const len = Math.hypot(dx, dy);
              const next = clampTarget(v.targetX + (dx / len) * move, v.targetY + (dy / len) * move, N, ABSORBER);
              v.targetX = next.x;
              v.targetY = next.y;
            }
            if (keys.has('e')) v.distance *= Math.exp(-1.2 * frameDt);
            if (keys.has('q')) v.distance *= Math.exp(1.2 * frameDt);
            v.distance = Math.min(maxDistance(N, ABSORBER), Math.max(MIN_DISTANCE, v.distance));
          }

          if (sizeRef.current.dirty) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
            const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
            canvas.width = w;
            canvas.height = h;
            sizeRef.current = { width: w, height: h, dirty: false };
          }

          if (rt.clearRequested) {
            device.queue.writeBuffer(buffers.h, 0, zeros);
            device.queue.writeBuffer(buffers.ux, 0, zeros);
            device.queue.writeBuffer(buffers.uy, 0, zeros);
            rt.time = 0;
            rt.clearRequested = false;
          }
          if (rt.depthDirty) {
            device.queue.writeBuffer(buffers.d, 0, rt.depth);
            rt.depthDirty = false;
          }

          const encoder = device.createCommandEncoder();
          const running = !ui.paused || rt.stepOnce;
          const substeps = running ? (ui.paused ? 1 : ui.speed) : 0;
          rt.stepOnce = false;
          if (substeps > 0) {
            const sources = sourcesRef.current;
            const pass = encoder.beginComputePass();
            for (let k = 0; k < substeps; k += 1) {
              paramsData(paramScratch, sources.length, sources, rt.time, ui.beta, ui.friction, k === 0 ? rt.pendingBump : null);
              device.queue.writeBuffer(buffers.params, k * PARAMS_STRIDE, paramScratch);
              pass.setBindGroup(0, simBind, [k * PARAMS_STRIDE]);
              if (k === 0 && rt.pendingBump) {
                pass.setPipeline(simPipelines.bump);
                pass.dispatchWorkgroups(groups, groups);
              }
              pass.setPipeline(simPipelines.velocity);
              pass.dispatchWorkgroups(groups, groups);
              pass.setPipeline(simPipelines.height);
              pass.dispatchWorkgroups(groups, groups);
              rt.time += DT;
            }
            pass.end();
            rt.pendingBump = null;
          } else if (rt.pendingBump) {
            // Paused: apply a splash without advancing time.
            paramsData(paramScratch, 0, sourcesRef.current, rt.time, ui.beta, ui.friction, rt.pendingBump);
            device.queue.writeBuffer(buffers.params, 0, paramScratch);
            const pass = encoder.beginComputePass();
            pass.setBindGroup(0, simBind, [0]);
            pass.setPipeline(simPipelines.bump);
            pass.dispatchWorkgroups(groups, groups);
            pass.end();
            rt.pendingBump = null;
          }

          // ---- render ----
          const view = viewRef.current;
          const basis = cameraBasis(view);
          const size = sizeRef.current;
          const r = renderScratch;
          r.fill(0);
          r.set([basis.eye.x, basis.eye.y, basis.eye.z, 0], 0);
          r.set([basis.forward.x, basis.forward.y, basis.forward.z, 0], 4);
          r.set([basis.right.x, basis.right.y, basis.right.z, 0], 8);
          r.set([basis.up.x, basis.up.y, basis.up.z, 0], 12);
          r.set([size.width / size.height, TAN_HALF_FOV, N, ABSORBER], 16);
          const overlayRadius = Math.max(3.5, view.distance * 0.011);
          r.set([ui.exaggeration * 4, ui.viewMode === 'top' ? 1 : 0, ui.viewMode === 'top' ? 0 : 5, overlayRadius], 20);
          const cur = cursorRef.current;
          const paints = ['wall', 'shoal', 'erase'].includes(ui.tool);
          r.set([cur.x, cur.y, ui.brush, cur.visible && paints ? 1 : 0], 24);
          const sun = [Math.cos(0.5) * 0.9, Math.sin(0.5) * 0.9, 0.16];
          const sl = Math.hypot(sun[0]!, sun[1]!, sun[2]!);
          r.set([sun[0]! / sl, sun[1]! / sl, sun[2]! / sl, 0], 28);
          sourcesRef.current.forEach((s, k) => {
            r.set([s.x, s.y, s.half, s.angle], 32 + k * 4);
            r.set([1, s.id === ui.selectedId ? 1 : 0, 0, 0], 32 + MAX_SOURCES * 4 + k * 4);
          });
          device.queue.writeBuffer(buffers.render, 0, r);

          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(renderPipeline);
          pass.setBindGroup(0, renderBind);
          pass.draw(3);
          pass.end();
          device.queue.submit([encoder.finish()]);

          if (now - lastReadout > 250) {
            lastReadout = now;
            setSimTime(rt.time);
          }
        };
        raf = requestAnimationFrame(frame);
      } catch (err) {
        if (!disposed) {
          setErrorText(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      const rt = runtimeRef.current;
      if (rt) {
        for (const b of Object.values(rt.buffers)) (b as any).destroy?.();
        rt.device.destroy?.();
      }
      runtimeRef.current = null;
    };
  }, [loadPreset]);

  // ---- pointer input ----
  const toNdc = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      aspect: rect.width / rect.height,
    };
  };

  const pick = (event: { clientX: number; clientY: number }) => {
    const ndc = toNdc(event);
    return pickGround(viewRef.current, ndc.x, ndc.y, ndc.aspect);
  };

  const inInterior = (x: number, y: number) => x > ABSORBER + 8 && x < N - ABSORBER - 8 && y > ABSORBER + 8 && y < N - ABSORBER - 8;

  const paintAt = (x: number, y: number, fromX?: number, fromY?: number) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const ui = live.current;
    const mode = ui.tool === 'wall' ? 'wall' : ui.tool === 'erase' ? 'erase' : 'shoal';
    if (fromX === undefined || fromY === undefined) {
      stampDisc(rt.depth, N, x, y, ui.brush, mode, SHOAL_DEPTH, ABSORBER + 4);
    } else {
      stampSegment(rt.depth, N, fromX, fromY, x, y, ui.brush, mode, SHOAL_DEPTH, ABSORBER + 4);
    }
    rt.depthDirty = true;
  };

  const sourceAt = (x: number, y: number): UiSource | null => {
    const reach = Math.max(8, viewRef.current.distance * 0.02);
    let best: UiSource | null = null;
    let bestDist = reach;
    for (const s of sourcesRef.current) {
      // Distance to the (possibly line) source.
      const dx = x - s.x;
      const dy = y - s.y;
      const along = dx * Math.cos(s.angle) + dy * Math.sin(s.angle);
      const across = -dx * Math.sin(s.angle) + dy * Math.cos(s.angle);
      const clamped = Math.min(s.half, Math.max(-s.half, along));
      const dist = Math.hypot(along - clamped, across);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    return best;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const input = inputRef.current;
    input.lastX = event.clientX;
    input.lastY = event.clientY;
    const ui = live.current;
    const ground = pick(event);

    if (event.button === 2) {
      input.mode = 'orbit';
      return;
    }
    if (event.button === 1 || (ui.tool === 'view' && event.shiftKey)) {
      input.mode = 'pan';
      input.anchor = ground;
      return;
    }
    if (ui.tool === 'view') {
      input.mode = 'orbit';
      return;
    }
    if (!ground) return;

    if (ui.tool === 'source' || ui.tool === 'maker') {
      const hit = sourceAt(ground.x, ground.y);
      if (hit) {
        setSelectedId(hit.id);
        input.mode = 'dragSource';
        input.sourceId = hit.id;
        return;
      }
      if (!inInterior(ground.x, ground.y) || sourcesRef.current.length >= MAX_SOURCES) return;
      const isLine = ui.tool === 'maker';
      const created: UiSource = {
        id: nextIdRef.current++,
        x: ground.x,
        y: ground.y,
        freq: ui.defaultFreq,
        amp: DEFAULT_AMP * ui.defaultStrength,
        phase: 0,
        half: isLine ? 60 : 0,
        angle: Math.PI / 2,
      };
      sourcesRef.current = [...sourcesRef.current, created];
      setSelectedId(created.id);
      bump();
      return;
    }
    if (ui.tool === 'pebble') {
      const rt = runtimeRef.current;
      if (rt && inInterior(ground.x, ground.y)) rt.pendingBump = { x: ground.x, y: ground.y, amp: 0.1, radius: 3 };
      return;
    }
    // Painting tools.
    input.mode = 'paint';
    input.anchor = ground;
    paintAt(ground.x, ground.y);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const input = inputRef.current;
    const view = viewRef.current;
    const ground = pick(event);
    cursorRef.current = ground ? { x: ground.x, y: ground.y, visible: true } : { ...cursorRef.current, visible: false };

    if (input.mode === 'orbit') {
      const dx = event.clientX - input.lastX;
      const dy = event.clientY - input.lastY;
      view.yaw -= dx * 0.006;
      view.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, view.pitch + dy * 0.006));
    } else if (input.mode === 'pan' && ground && input.anchor) {
      const next = clampTarget(view.targetX + input.anchor.x - ground.x, view.targetY + input.anchor.y - ground.y, N, ABSORBER);
      view.targetX = next.x;
      view.targetY = next.y;
    } else if (input.mode === 'paint' && ground && input.anchor) {
      paintAt(ground.x, ground.y, input.anchor.x, input.anchor.y);
      input.anchor = ground;
    } else if (input.mode === 'dragSource' && ground) {
      const s = sourcesRef.current.find((q) => q.id === input.sourceId);
      if (s && inInterior(ground.x, ground.y)) {
        s.x = ground.x;
        s.y = ground.y;
      }
    }
    input.lastX = event.clientX;
    input.lastY = event.clientY;
  };

  const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const input = inputRef.current;
    if (input.mode === 'dragSource') bump();
    input.mode = 'none';
    input.anchor = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Held-key camera movement (applied each frame in the render loop).
  useEffect(() => {
    const keys = keysRef.current;
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!'wasdqe'.includes(k) || k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      keys.add(k);
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const clear = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      view.distance = Math.min(maxDistance(N, ABSORBER), Math.max(MIN_DISTANCE, view.distance * Math.exp(event.deltaY * 0.0012)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const selected = sourcesRef.current.find((s) => s.id === selectedId) ?? null;
  const patchSelected = (patch: Partial<Source>) => {
    if (!selected) return;
    Object.assign(selected, patch);
    bump();
  };
  const readFreq = selected ? selected.freq : defaultFreq;
  const lambdaOpen = wavelength(readFreq, 1, beta);
  const lambdaShoal = wavelength(readFreq, SHOAL_DEPTH, beta);
  const presetInfo = PRESETS.find((p) => p.id === presetId);

  const setMode = (mode: ViewMode) => {
    setViewMode(mode);
    viewRef.current.pitch = mode === 'top' ? MAX_PITCH : 0.55;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-[34rem] flex-1 overflow-hidden" style={{ backgroundColor: '#03060f' }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: 'none', cursor: tool === 'view' ? 'grab' : 'crosshair' }}
          role="img"
          aria-label="A wave pool. Sources and barriers can be placed on the water and the resulting waves are simulated live."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={() => {
            cursorRef.current.visible = false;
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            {status === 'init' && 'Starting the GPU…'}
            {status === 'unsupported' &&
              'This simulation needs WebGPU, which this browser does not provide. A recent desktop Chrome, Edge, or Safari works.'}
            {status === 'error' && `The wave pool could not start: ${errorText}`}
          </div>
        )}
        <div className="pointer-events-none absolute top-3 left-3 max-w-[22rem] rounded-md bg-black/55 px-3 py-1.5 text-xs text-white/85">
          {TOOL_HINT[tool]}
        </div>
      </div>

      <div className="border-t border-[var(--grid-line)] bg-[var(--sim-bg)] px-5 py-4">
        <ControlBar align="start" className="mb-3">
          <Select
            label="Scene"
            value={presetId}
            onChange={(id) => {
              setPresetId(id);
              loadPreset(id);
            }}
            options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Tool">
            {TOOLS.map((t) => (
              <Button key={t.value} variant={tool === t.value ? 'primary' : 'secondary'} onClick={() => setTool(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
          {(tool === 'wall' || tool === 'shoal' || tool === 'erase') && (
            <Slider label="Brush" min={2} max={24} value={brush} onChange={setBrush} unit="cells" />
          )}
        </ControlBar>

        <ControlBar align="start" className="mb-3">
          <Button variant="secondary" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Play' : 'Pause'}
          </Button>
          {paused && (
            <Button
              variant="secondary"
              onClick={() => {
                if (runtimeRef.current) runtimeRef.current.stepOnce = true;
              }}
            >
              Step
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              if (runtimeRef.current) runtimeRef.current.clearRequested = true;
            }}
          >
            Still the water
          </Button>
          <Button variant="secondary" onClick={() => loadPreset(presetId)}>
            Reset scene
          </Button>
          <Slider label="Speed" min={1} max={MAX_SUBSTEPS} value={speed} onChange={setSpeed} format={(v) => `${v}×`} />
          <Select
            label="View"
            value={viewMode}
            onChange={(v) => setMode(v as ViewMode)}
            options={[
              { value: 'lit', label: 'Lit water' },
              { value: 'top', label: 'Ripple tank' },
            ]}
          />
        </ControlBar>

        <ControlBar align="start" className="mb-3">
          {selected ? (
            <>
              <span className="text-sm font-semibold">Selected source</span>
              <Slider
                label="Frequency"
                min={0.02}
                max={0.12}
                step={0.0025}
                value={selected.freq}
                onChange={(v) => patchSelected({ freq: v })}
                format={(v) => v.toFixed(3)}
              />
              <Slider
                label="Strength"
                min={0.25}
                max={4}
                step={0.05}
                value={selected.amp / DEFAULT_AMP}
                onChange={(v) => patchSelected({ amp: v * DEFAULT_AMP })}
                format={(v) => `${v.toFixed(2)}×`}
              />
              {selected.half > 0 && (
                <Slider
                  label="Angle"
                  min={0}
                  max={180}
                  step={5}
                  value={Math.round((selected.angle * 180) / Math.PI) % 180}
                  onChange={(v) => patchSelected({ angle: (v * Math.PI) / 180 })}
                  format={(v) => `${v}°`}
                />
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  sourcesRef.current = sourcesRef.current.filter((s) => s.id !== selected.id);
                  setSelectedId(0);
                  bump();
                }}
              >
                Delete source
              </Button>
              <Button variant="secondary" onClick={() => setSelectedId(0)}>
                Deselect
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">New sources</span>
              <Slider label="Frequency" min={0.02} max={0.12} step={0.0025} value={defaultFreq} onChange={setDefaultFreq} format={(v) => v.toFixed(3)} />
              <Slider label="Strength" min={0.25} max={4} step={0.05} value={defaultStrength} onChange={setDefaultStrength} format={(v) => `${v.toFixed(2)}×`} />
            </>
          )}
        </ControlBar>

        <ControlBar align="start" className="mb-3">
          <Slider label="Wave height" min={1} max={16} step={0.5} value={exaggeration} onChange={setExaggeration} format={(v) => `${v}×`} />
          <Slider
            label="Surface tension"
            min={0}
            max={MAX_BETA}
            step={0.005}
            value={beta}
            onChange={setBeta}
            format={(v) => v.toFixed(3)}
          />
          <Slider label="Friction" min={0} max={0.01} step={0.0005} value={friction} onChange={setFriction} format={(v) => v.toFixed(4)} />
        </ControlBar>

        <Readout variant="inline">
          <Readout.Value label="Wavelength (deep)" value={lambdaOpen.toFixed(1)} unit="cells" />
          <Readout.Value label="Wavelength (shoal)" value={lambdaShoal.toFixed(1)} unit="cells" />
          <Readout.Value label="Period" value={(1 / readFreq).toFixed(1)} unit="time units" />
          <Readout.Value label="Time" value={simTime.toFixed(0)} unit="time units" />
        </Readout>
        {presetInfo && <p className="mt-2 text-sm text-[var(--text-muted)]">{presetInfo.description}</p>}
      </div>
    </div>
  );
}
