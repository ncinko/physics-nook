import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button, ControlBar, Slider, Toggle } from '../shared/InlineControls';
import Readout from '../shared/Readout';
import './CircuitKit.css';

/**
 * CircuitKit — transient circuit builder and simulator.
 *
 * Drag components from the palette onto the workspace, wire them by dragging
 * endpoints together (they snap-merge within SNAP_RADIUS), and watch a live
 * voltage/current scope. The solver is modified nodal analysis with trapezoidal
 * companion models, so RC, RL and LC/RLC transients are integrated properly
 * rather than approximated.
 *
 * Colour comes entirely from the theme tokens in global.css, applied as
 * `var(--token)` SVG paint values and Tailwind arbitrary-value classes, so the
 * tool follows the site's light/dark toggle with no runtime theme reading.
 */

/******************* Visual & Interaction Constants *******************/
const WORK_OFFSET_Y = 72;
const SCALE = 2;
const CAPTURE_W = 24 * SCALE;
const END_R = 9 * SCALE;
const LABEL_OFF = 12 * SCALE;
const SNAP_RADIUS = 18 * SCALE;
const ANIM_EPS = 1e-3; // Increased to reduce jitter

// Theme tokens from global.css, inlined as SVG paint values. The browser re-resolves
// custom properties when data-theme flips, so there is nothing to observe or redraw.
//
// Two of these are mixes rather than plain tokens, because no single token survives
// the flip: --grid-line as a wire colour is ~1.2:1 on the light canvas (invisible),
// and --surface-elevated composites to ~#fdfdfe over the light canvas (the palette
// bar disappears). Anchoring both to --sim-bg keeps them correct in either direction.
const THEME = {
  canvas: "var(--sim-bg)",
  text: "var(--text-primary)",
  component: "var(--text-primary)",
  wire: "color-mix(in srgb, var(--text-primary) 55%, var(--sim-bg))",
  palette: "color-mix(in srgb, var(--text-primary) 8%, var(--sim-bg))",
  // Selection is purple, not blue: blue already means current, and a selected
  // element used to get a blue stroke with blue flow dots painted on top of it.
  select: "var(--accent-purple)",
  current: "var(--accent-blue)",
  border: "var(--grid-line)",
};

/******************* Circuit Modeling & Simulation *******************/
const GMIN = 1e-12;
const R_WIRE = 1e-9; // Further reduced for near-ideal LC oscillation
const R_SWITCH_OPEN = 1e14;
const SIM_DT = 1e-6; // 1 µs simulation time step for higher fidelity

const PALETTE = {
  WIRE: "wire",
  RESISTOR: "resistor",
  BATTERY: "battery",
  CAPACITOR: "capacitor",
  INDUCTOR: "inductor",
  SWITCH: "switch",
} as const;

type ElementType = (typeof PALETTE)[keyof typeof PALETTE];

interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }
interface CircuitNode { id: string; x: number; y: number }

// Params are flat and optional rather than a per-type discriminated union. This is a
// dynamic editor: the inspector patches params by string key, PALETTE_ITEMS[].def is
// heterogeneous, and resetSimulation clears v/i on unnarrowed clones. A union would
// need a cast at every one of those sites to buy safety the code cannot use.
interface ElementParams {
  R?: number; V?: number; C?: number; L?: number;
  v?: number; i?: number; closed?: boolean;
}

interface AnimState {
  active: boolean; dir: number; I_disp?: number;
  phasePx: number; spacingPx: number;
}

interface CircuitElement {
  id: string;
  type: ElementType;
  n1: string;
  n2: string;
  params: ElementParams;
  anim?: AnimState;
}

interface PaletteItem { type: ElementType; label: string; icon: string; def: ElementParams }

interface Solution {
  nodeV: Map<string, number>;
  elemI: Map<string, number>;
  ground?: string | null;
}
interface TransientResult extends Solution {
  ground: string | null;
  newStates: Record<string, ElementParams>;
}

interface ScopeSample { time: number; value: number }
type ScopeMode = 'voltage' | 'current';
interface SymbolProps { mx: number; my: number; ux: number; uy: number; px: number; py: number }

// Drag state, unlike params, IS worth a discriminated union: every handler already
// switches on `type` and then reaches for variant-only fields.
type Carry =
  | { type: 'selectbox'; start: Point; last: Point }
  | { type: 'palette'; item: PaletteItem }
  | { type: 'element'; id: string; start: Point; a_start: Point; b_start: Point }
  | { type: 'group'; start: Point; nodeStarts: Map<string, Point> }
  | { type: 'end'; id: string; end: 'n1' | 'n2'; nodeId: string; snapTargetId: string | null };

const PALETTE_ITEMS: PaletteItem[] = [
  { type: PALETTE.RESISTOR,  label: "Resistor",  icon: "Ω",  def: { R: 10 } },
  { type: PALETTE.BATTERY,   label: "Battery",   icon: "+−", def: { V: 5 } },
  { type: PALETTE.CAPACITOR, label: "Capacitor", icon: "∥",  def: { C: 1e-6, v: 0, i: 0 } },
  { type: PALETTE.INDUCTOR,  label: "Inductor",  icon: "∿",  def: { L: 1e-3, i: 0 } },
  { type: PALETTE.SWITCH,    label: "Switch",    icon: "⎍",  def: { closed: true } },
  { type: PALETTE.WIRE,      label: "Wire",      icon: "—",  def: {} },
];

const uid = (() => { let n = 1; return () => String(n++); })();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/******************* Pre-built Circuit Generators *******************/
function generateRCChargeDischargeCircuit(): { nodes: CircuitNode[]; elements: CircuitElement[] } {
  const l_uid = (() => { let n = 1; return () => `rc_${n++}`; })();

  // Grid helper
  const origin = { x: 350, y: 160 };
  const dx = 220, dy = 160;
  const grid = (c: number, r: number) => ({ x: origin.x + c * dx, y: origin.y + r * dy });

  // Top row: battery+ -> series R -> switch -> cap top
  // Bottom row: ground bus
  // Right column (col 3): parallel resistor branch to avoid overlap
  const nodeA   = { id: l_uid(), ...grid(0,0) }; // Battery +
  const nodeB   = { id: l_uid(), ...grid(0,2) }; // Battery - / ground
  const nodeC   = { id: l_uid(), ...grid(1,0) }; // After series R
  const nodeE   = { id: l_uid(), ...grid(2,0) }; // Cap top
  const gBus1   = { id: l_uid(), ...grid(1,2) }; // Ground bus mid
  const gBus2   = { id: l_uid(), ...grid(2,2) }; // Ground bus right

  // New: dedicated branch for the parallel resistor
  const rTop    = { id: l_uid(), ...grid(3,0) }; // Resistor top (right column)
  const rBottom = { id: l_uid(), ...grid(3,2) }; // Resistor bottom (right column)

  const nodes = [nodeA, nodeB, nodeC, nodeE, gBus1, gBus2, rTop, rBottom];

  const elements: CircuitElement[] = [
    // Battery
    { id: l_uid(), type: PALETTE.BATTERY,   n1: nodeA.id, n2: nodeB.id, params: { V: 10 } },

    // Series charge path (top row)
    { id: l_uid(), type: PALETTE.RESISTOR,  n1: nodeA.id, n2: nodeC.id, params: { R: 10 } },
    { id: l_uid(), type: PALETTE.SWITCH,    n1: nodeC.id, n2: nodeE.id, params: { closed: true } },

    // Capacitor: vertical at column 2 (no overlap now)
    { id: l_uid(), type: PALETTE.CAPACITOR, n1: nodeE.id, n2: gBus2.id, params: { C: 5e-6, v: 0 } },

    // Parallel resistor: separate vertical branch at column 3
    // Bridge from cap top to rTop, and from ground bus to rBottom
    { id: l_uid(), type: PALETTE.WIRE,      n1: nodeE.id, n2: rTop.id,    params: {} },
    { id: l_uid(), type: PALETTE.RESISTOR,  n1: rTop.id,  n2: rBottom.id, params: { R: 100 } },
    { id: l_uid(), type: PALETTE.WIRE,      n1: gBus2.id, n2: rBottom.id, params: {} },

    // Ground bus (bottom row)
    { id: l_uid(), type: PALETTE.WIRE,      n1: nodeB.id, n2: gBus1.id, params: {} },
    { id: l_uid(), type: PALETTE.WIRE,      n1: gBus1.id, n2: gBus2.id, params: {} },
  ];

  return { nodes, elements };
}



/******************* Linear Solver (Gauss, partial pivot) *******************/
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let max = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > max) { max = v; piv = r; }
    }
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const diag = M[col][col];
    if (Math.abs(diag) < 1e-15) {
      // System is singular, may be unstable. Return zero vector.
      return Array(n).fill(0);
    }
    for (let c = col; c <= n; c++) M[col][c] /= diag;
    for (let r = 0; r < n; r++) {
      if (r !== col) {
        const f = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
  }
  return M.map(row => row[n]);
}

/******************* Transient MNA Solver *******************/
function buildAndSolveTransient(nodes: CircuitNode[], elements: CircuitElement[], dt: number): TransientResult {
    if (!nodes.length || dt <= 0) return { nodeV: new Map(), elemI: new Map(), ground: null, newStates: {} };

    const ground = chooseGround(nodes);
    const nodeVarIndex = new Map<string, number>();
    let varCounter = 0;
    nodes.forEach(n => { if (n.id !== ground) nodeVarIndex.set(n.id, varCounter++); });

    const vSrcs = elements.filter(e => e.type === PALETTE.BATTERY);
    const inductors = elements.filter(e => e.type === PALETTE.INDUCTOR);
    const capacitors = elements.filter(e => e.type === PALETTE.CAPACITOR);

    const n = varCounter;
    const m = vSrcs.length;
    const p = inductors.length;
    const nVars = n + m + p;

    if (nVars === 0) return { nodeV: new Map(), elemI: new Map(), ground, newStates: {} };

    const A = Array.from({ length: nVars }, () => Array(nVars).fill(0));
    const b = Array(nVars).fill(0);
    const idx = (nodeId: string): number | null => (nodeId === ground ? null : nodeVarIndex.get(nodeId) ?? null);

    // Stamp GMIN for stability
    for (let i = 0; i < n; i++) A[i][i] += GMIN;
    
    // Stamp passive elements
    elements.forEach(e => {
        const i1 = idx(e.n1);
        const i2 = idx(e.n2);
        let G = 0;
        switch (e.type) {
            case PALETTE.RESISTOR: G = 1 / (e.params.R || 1e3); break;
            case PALETTE.WIRE: G = 1 / R_WIRE; break;
            case PALETTE.SWITCH: G = 1 / (e.params.closed ? R_WIRE : R_SWITCH_OPEN); break;
        }
        if (G > 0) {
            if (i1 != null) A[i1][i1] += G;
            if (i2 != null) A[i2][i2] += G;
            if (i1 != null && i2 != null) { A[i1][i2] -= G; A[i2][i1] -= G; }
        }
    });

    // Stamp capacitors (Trapezoidal rule companion model)
    capacitors.forEach(e => {
        const Gc = 2 * (e.params.C || 1e-6) / dt;
        const v_prev = e.params.v || 0;
        const i_prev = e.params.i || 0;
        const Ieq = Gc * v_prev + i_prev;

        const i1 = idx(e.n1);
        const i2 = idx(e.n2);

        // Stamp conductance
        if (i1 != null) A[i1][i1] += Gc;
        if (i2 != null) A[i2][i2] += Gc;
        if (i1 != null && i2 != null) { A[i1][i2] -= Gc; A[i2][i1] -= Gc; }

        // Stamp history current source
        if (i1 != null) b[i1] += Ieq;
        if (i2 != null) b[i2] -= Ieq;
    });
    
    // Stamp voltage sources
    vSrcs.forEach((e, k) => {
        const vk = n + k;
        const i1 = idx(e.n1);
        const i2 = idx(e.n2);
        if (i1 != null) { A[i1][vk] += 1; A[vk][i1] += 1; }
        if (i2 != null) { A[i2][vk] -= 1; A[vk][i2] -= 1; }
        b[vk] += e.params.V || 0;
    });

    // Stamp inductors (Trapezoidal rule)
    inductors.forEach((e, k) => {
        const R_parasitic = 1e-6; // Small parasitic resistance for stability
        const ik = n + m + k;
        const Rl = 2 * (e.params.L || 1e-3) / dt;
        const i_prev = e.params.i || 0;
        const i1 = idx(e.n1);
        const i2 = idx(e.n2);
        
        // KCL contribution
        if (i1 != null) { A[i1][ik] += 1; }
        if (i2 != null) { A[i2][ik] -= 1; }
        
        // Branch equation: v1 - v2 - (Rl + R_p)*i_L = -Rl*i_L_prev
        A[ik][ik] = -(Rl + R_parasitic);
        if (i1 != null) A[ik][i1] += 1;
        if (i2 != null) A[ik][i2] -= 1;
        b[ik] -= Rl * i_prev;
    });

    const x = solveLinearSystem(A, b);

    // Extract solutions
    const nodeV = new Map<string, number>();
    nodes.forEach(n => { const k = idx(n.id); nodeV.set(n.id, k != null ? x[k] : 0); });

    const elemI = new Map<string, number>();
    const newStates: Record<string, ElementParams> = {};

    elements.forEach(e => {
        const v1 = nodeV.get(e.n1) || 0;
        const v2 = nodeV.get(e.n2) || 0;
        let I = 0;
        switch(e.type) {
            case PALETTE.RESISTOR: I = (v1 - v2) / (e.params.R || 1e3); break;
            case PALETTE.WIRE: I = (v1 - v2) / R_WIRE; break;
            case PALETTE.SWITCH: I = (v1 - v2) / (e.params.closed ? R_WIRE : R_SWITCH_OPEN); break;
            case PALETTE.BATTERY:
                const vSrcIdx = vSrcs.findIndex(vs => vs.id === e.id);
                // This is the current leaving the positive (n1) terminal.
                // The animation will show flow from n1 to n2 for positive I.
                I = vSrcIdx > -1 ? (x[n + vSrcIdx] || 0) : 0;
                break;
            case PALETTE.CAPACITOR:
                const v_new = v1 - v2;
                const Gc_calc = 2 * (e.params.C || 1e-6) / dt;
                const v_prev_calc = e.params.v || 0;
                const i_prev_calc = e.params.i || 0;
                I = Gc_calc * (v_new - v_prev_calc) - i_prev_calc;
                newStates[e.id] = { v: v_new, i: I };
                break;
            case PALETTE.INDUCTOR:
                const indIdx = inductors.findIndex(l => l.id === e.id);
                I = indIdx > -1 ? (x[n + m + indIdx] || 0) : 0;
                newStates[e.id] = { i: I };
                break;
        }
        elemI.set(e.id, I);
    });
    
    return { nodeV, elemI, ground, newStates };
}


function chooseGround(nodes: CircuitNode[]): string | null {
  if (!nodes.length) return null;
  const minIdx = nodes.reduce((best, n, i) => {
    if (best === -1) return i;
    const b = nodes[best];
    return (n.y > b.y + 1e-6 || (Math.abs(n.y-b.y)<1e-6 && n.x < b.x)) ? i : best;
  }, -1);
  return nodes[minIdx]?.id ?? null;
}

function updateElementAnimations(elements: CircuitElement[], elemI: Map<string, number>, animSpeed: number, realDT: number, nodes: CircuitNode[], maxAbsI: number): CircuitElement[] {
  const getLen = (e: CircuitElement) => {
    const a = nodes.find(n => n.id === e.n1);
    const b = nodes.find(n => n.id === e.n2);
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  // Base speed to keep slow currents visible; scale is in px/s
  const BASE_PX_S = 12;           // small floor so tiny currents still move
  const EXP       = 0.6;          // smoothness of relative scaling
  const EPS_IREF  = 1e-12;        // avoid div by zero

  return elements.map(e => {
    const Iraw = elemI.get(e.id) || 0;

    // Stop animation on explicitly open switches, avoid jitter near zero
    const active = (e.type !== PALETTE.SWITCH || !!e.params.closed) && Math.abs(Iraw) > ANIM_EPS;
    const dir    = Math.sign(Iraw) || 1;

    // Length & spacing for anti-alias cap
    const L = getLen(e);
    const nDots = Math.max(1, Math.floor(L / (30 * SCALE)));
    const spacingPx = nDots > 0 ? (L / nDots) : L || 1;

    // Relative speed across branches
    const rel = maxAbsI > 0 ? Math.pow(Math.abs(Iraw) / (maxAbsI + EPS_IREF), EXP) : 0;
    const targetPxPerS = BASE_PX_S + (animSpeed / 10) * rel; // same rough scale as before

    // Per-frame travel in px; clamp to avoid wagon-wheel
    const maxStepPx = 0.45 * spacingPx;
    const stepPx = dir * Math.min(targetPxPerS * realDT, maxStepPx);

    // Accumulate phase in px
    const prevPhase = e.anim?.phasePx || 0;
    // Keep phase within [0, L) for numerical sanity
    let phasePx = (prevPhase + (active ? stepPx : 0)) % (L || 1);
    if (phasePx < 0) phasePx += (L || 1);

    return {
      ...e,
      anim: {
        active,
        dir,                   // for debug arrow when paused
        I_disp: Iraw,          // for overlay readout
        phasePx,               // NEW: accumulated phase in px
        spacingPx,             // NEW: to position dots uniformly
      }
    };
  });
}


/******************* Symbol Helpers *******************/
function ResSymbol({ mx, my, ux, uy, px, py }: SymbolProps) {
  // Half-length of the symbol along the element axis
  const L = 30 * SCALE;          // <-- keep this in sync with getSymbolLength (2*L)
  const steps = 3;               // number of interior peaks (adjust taste)
  const A = Math.min(8 * SCALE, 0.25 * L); // zig amplitude

  const pts = [];
  // Vertex spacing along the axis (includes endpoints)
  const dx = L / steps;          // since total span is 2L, vertex step is L/steps
  for (let k = 0; k <= 2 * steps; k++) {
    const x = -L + k * dx;       // from -L to +L
    // Half-zigs: endpoints on centerline, interior vertices alternate ±A
    const off = (k === 0 || k === 2 * steps) ? 0 : ((k % 2 === 1) ? +A : -A);
    const X = mx + x * ux + off * px;
    const Y = my + x * uy + off * py;
    pts.push([X, Y]);
  }

  return (
    <polyline
      points={pts.map(p => p.join(",")).join(" ")}
      fill="none"
      stroke={THEME.component}
      strokeWidth={3 * SCALE}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}
function BatSymbol({ mx,my,ux,uy,px,py }: SymbolProps){
  const L_long = 16*SCALE, L_short = 8*SCALE, separation = 6*SCALE;
  return (
    <g>
      {/* Positive plate (long, n1 side) */}
      <line x1={mx-separation*ux - L_long*px} y1={my-separation*uy - L_long*py} x2={mx-separation*ux + L_long*px} y2={my-separation*uy + L_long*py} stroke={THEME.component} strokeWidth={3*SCALE} />
      {/* Negative plate (short, n2 side) */}
      <line x1={mx+separation*ux - L_short*px} y1={my+separation*uy - L_short*py} x2={mx+separation*ux + L_short*px} y2={my+separation*uy + L_short*py} stroke={THEME.component} strokeWidth={3*SCALE} />
    </g>
  );
}
function SwSymbol({ mx,my,ux,uy,px,py,closed }: SymbolProps & { closed: boolean }){
  const L=20*SCALE; return (
    <g>
      {closed ? (
        <line x1={mx-L*ux} y1={my-L*uy} x2={mx+L*ux} y2={my+L*uy} stroke={THEME.component} strokeWidth={3*SCALE}/>
      ) : (
        <line x1={mx-L*ux} y1={my-L*uy} x2={mx+L*ux-12*px} y2={my+L*uy-12*py} stroke={THEME.component} strokeWidth={3*SCALE}/>
      )}
    </g>
  );
}
function CapSymbol({ mx,my,ux,uy,px,py }: SymbolProps){
  const L=6*SCALE, plateW=16*SCALE;
  return (
    <g>
      <line x1={mx-L*ux-plateW*px} y1={my-L*uy-plateW*py} x2={mx-L*ux+plateW*px} y2={my-L*uy+plateW*py} stroke={THEME.component} strokeWidth={3*SCALE} />
      <line x1={mx+L*ux-plateW*px} y1={my+L*uy-plateW*py} x2={mx+L*ux+plateW*px} y2={my+L*uy+plateW*py} stroke={THEME.component} strokeWidth={3*SCALE} />
    </g>
  );
}
function InductorSymbol({ mx,my,ux,uy,px,py }: SymbolProps){
    const len=40*SCALE, radius=8*SCALE, coils=4;
    const pts = [];
    for(let i=0; i<=coils*360; i+=30){
        const angle = i * Math.PI / 180;
        const dist = -len + (i/(coils*360)) * (2*len);
        const x = mx + dist*ux + radius*Math.sin(angle)*px;
        const y = my + dist*uy + radius*Math.sin(angle)*py;
        pts.push([x,y]);
    }
    return <polyline points={pts.map(p=>p.join(",")).join(" ")} fill="none" stroke={THEME.component} strokeWidth={3*SCALE} />;
}

/******************* Main Component *******************/
export default function CircuitKit() {
  const [size, setSize] = useState({ width: 800, height: 600 });
  const svgRef = useRef<HTMLDivElement | null>(null);

  // graph
  const [nodes, setNodes] = useState<CircuitNode[]>([]);
  const [elements, setElements] = useState<CircuitElement[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
  const nextIdRef = useRef(1000000);
  const allocNodeId = () => `n${nextIdRef.current++}`;


  // drag state
  const [carry, setCarry] = useState<Carry | null>(null);
  const [mouseWS, setMouseWS] = useState({ x: 0, y: 0 });

  // simulation state
  const [simTime, setSimTime] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [simRate, setSimRate] = useState(3.0);
  const [animSpeed, setAnimSpeed] = useState(1000);
  
  const [showDebug, setShowDebug] = useState(false);
  const [showNodeVoltages, setShowNodeVoltages] = useState(false);
  const [solution, setSolution] = useState<Solution>({ nodeV: new Map(), elemI: new Map() });
  const [scopeData, setScopeData] = useState<ScopeSample[]>([]);
  const [scopedElementId, setScopedElementId] = useState<string | null>(null);
  const [isScopeLocked, setIsScopeLocked] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('voltage');

  // Responsive canvas size
  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length > 0) {
        const { width, height } = entries[0].contentRect;
        setSize({ width, height });
      }
    });
    const container = svgRef.current;
    if (container) {
        resizeObserver.observe(container);
    }
    return () => {
        if (container) {
            resizeObserver.unobserve(container);
        }
    };
  }, []);

  // The loop reads the graph through refs rather than through the dep array. Putting
  // `nodes` in the deps tore the loop down on every pointer-move during a drag, which
  // reset lastTS and stalled the flow animation for the duration of the drag.
  const elementsRef = useRef(elements);
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Every write to `elements` goes through here. The sim loop overwrites
  // elementsRef each frame, so any writer that only called setElements would be
  // clobbered by the next frame before React had committed and re-synced the ref.
  // The loop never writes `nodes`, so nodesRef can stay a plain effect sync.
  const commitElements = useCallback((updater: CircuitElement[] | ((prev: CircuitElement[]) => CircuitElement[])) => {
    const next = typeof updater === 'function' ? updater(elementsRef.current) : updater;
    elementsRef.current = next;
    setElements(next);
    return next;
  }, []);

  // Main simulation loop
  useEffect(() => {
    let animFrameId = 0;
    let lastTS = performance.now() / 1000;
    const effectiveDT = SIM_DT * simRate;

    const step = () => {
      const now = performance.now() / 1000;
      const realDT = Math.max(0, Math.min(0.1, now - lastTS));
      lastTS = now;

      if (isRunning) {
        const currentNodes = nodesRef.current;
        const prevElements = elementsRef.current;
        const { nodeV, elemI, ground, newStates } =
          buildAndSolveTransient(currentNodes, prevElements, effectiveDT);

        // Carry state updates for reactive components. params.v / params.i ARE the
        // trapezoidal integrator's state, so they have to survive frame to frame.
        const nextElements = prevElements.map(el => (
          newStates[el.id]
            ? { ...el, params: { ...el.params, ...newStates[el.id] } }
            : el
        ));

        // Max current magnitude, for relative flow-dot scaling.
        let maxAbsI = 0;
        for (const v of elemI.values()) maxAbsI = Math.max(maxAbsI, Math.abs(v));

        // Phase-based animation update with anti-alias clamp.
        const withAnim = updateElementAnimations(
          nextElements, elemI, animSpeed, realDT, currentNodes, maxAbsI
        );

        // Keep the ref ahead of the commit: the next frame runs before React has
        // re-rendered, and reading pre-commit state would stall the integrator.
        commitElements(withAnim);
        setSolution({ nodeV, elemI, ground });
        setSimTime(t => t + effectiveDT);
      }

      animFrameId = requestAnimationFrame(step);
    };

    animFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameId);
  }, [isRunning, simRate, animSpeed]);


  // Scope data recording
  useEffect(() => {
    if (isRunning && scopedElementId) {
        const selElem = elements.find(e => e.id === scopedElementId);
        if (!selElem) return;
        
        let value = 0;
        if (scopeMode === 'current') {
            value = solution.elemI.get(scopedElementId) || 0;
        } else { // voltage
            const v1 = solution.nodeV.get(selElem.n1) || 0;
            const v2 = solution.nodeV.get(selElem.n2) || 0;
            value = v1 - v2;
        }

        setScopeData(prev => [...prev.slice(prev.length > 200 ? 1 : 0), { time: simTime, value }]);
    }
  }, [simTime, scopedElementId, isRunning, elements, solution, scopeMode]);

  useEffect(() => {
    const elem = elementById(scopedElementId);
    if (elem && (elem.type === PALETTE.BATTERY || elem.type === PALETTE.INDUCTOR)) {
      setScopeMode('current');
    } else {
      setScopeMode('voltage');
    }
  }, [scopedElementId]);


  // Helper functions
  const nodeById = (id: string) => nodes.find(n => n.id === id);
  const elementById = (id: string | null) => elements.find(e => e.id === id) ?? null;

  const resetSimulation = () => {
      setSimTime(0);
      setScopeData([]);
      commitElements(els => els.map(el => {
          const newParams = { ...el.params };
          if (el.type === PALETTE.CAPACITOR) { newParams.v = 0; newParams.i = 0; }
          if (el.type === PALETTE.INDUCTOR) newParams.i = 0;
          return { ...el, params: newParams };
      }));
  };
  
  const addNode = (x: number, y: number) => { const id = uid(); setNodes(arr => [...arr, { id, x, y }]); return id; };
  
  const addElement = (type: ElementType, x: number, y: number) => {
    const half = 50 * SCALE; // Increased default length
    const n1 = addNode(x - half, y);
    const n2 = addNode(x + half, y);
    const item = PALETTE_ITEMS.find(p => p.type === type);
    const params = item ? { ...item.def } : {};
    const id = uid();
    commitElements(arr => [...arr, { id, type, n1, n2, params }]);
    setSelection([id]);
    resetSimulation();
  };
  
  const deleteElement = (id: string) => {
    if (scopedElementId === id) {
        setScopedElementId(null);
        setIsScopeLocked(false);
    }
    // Read through the ref, and reap orphans functionally. Reading `nodes` from the
    // enclosing closure here used to snap surviving nodes back to their positions at
    // selection time, because the handler was memoized on [sel].
    const newEls = commitElements(arr => arr.filter(e => e.id !== id));
    setNodes(prev => reapOrphans(newEls, prev));
    setSelection([]);
  };
  
  const reapOrphans = (elArr: CircuitElement[], nodesArr: CircuitNode[]) => {
    const used = new Set<string>();
    elArr.forEach(e => { used.add(e.n1); used.add(e.n2); });
    return nodesArr.filter(n => used.has(n.id));
  };
  
  const nearestSnapTarget = (nodeId: string, nodesArr: CircuitNode[]) => {
    const self = nodesArr.find(n => n.id === nodeId); if (!self) return null;
    let best: CircuitNode | null = null, bestD2 = Infinity;
    for (const n of nodesArr) {
      if (n.id === nodeId) continue;
      const d2 = (n.x - self.x) ** 2 + (n.y - self.y) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = n; }
    }
    return (best && Math.sqrt(bestD2) <= SNAP_RADIUS) ? best : null;
  };
  
  const loadPrebuiltCircuit = (generator: () => { nodes: CircuitNode[]; elements: CircuitElement[] }) => {
    setIsRunning(false);
    setSelection([]);
    const { nodes: newNodes, elements: newElements } = generator();
    setNodes(newNodes);
    commitElements(newElements);
    setTimeout(resetSimulation, 0); 
  };


  
  // Selection helpers
  const rectFromPoints = (a: Point, b: Point) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    return { x, y, w, h };
  };
  const lineIntersectsRect = (x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number) => {
    const inside = (x: number, y: number) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    if (inside(x1, y1) || inside(x2, y2)) return true;
    const p = [-(x2 - x1), (x2 - x1), -(y2 - y1), (y2 - y1)];
    const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
    let u0 = 0, u1 = 1;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else {
        const t = q[i] / p[i];
        if (p[i] < 0) u0 = Math.max(u0, t); else u1 = Math.min(u1, t);
        if (u0 > u1) return false;
      }
    }
    return true;
  };
  const elementsInRect = (rect: Rect) => {
    const { x: rx, y: ry, w: rw, h: rh } = rect;
    const picked = [];
    for (const e of elements) {
      const a = nodeById(e.n1), b = nodeById(e.n2);
      if (!a || !b) continue;
      if (lineIntersectsRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh)) picked.push(e.id);
    }
    return picked;
  };

    const breakElementFree = (elId: string) => {
    const el = elementById(elId);
    if (!el) return;
    const a = nodeById(el.n1);
    const b = nodeById(el.n2);
    if (!a || !b) return;
    const n1 = allocNodeId();
    const n2 = allocNodeId();
    setNodes(arr => [...arr, { id: n1, x: a.x, y: a.y }, { id: n2, x: b.x, y: b.y }]);
    commitElements(arr => arr.map(e => e.id === elId ? { ...e, n1, n2 } : e));
  };
// Pointer Handlers
  const toWorkspaceCoords = (clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const xSVG = clamp(clientX - rect.left, 0, size.width);
    const ySVG = clamp(clientY - rect.top, 0, size.height);
    return { x: xSVG, y: ySVG - WORK_OFFSET_Y };
  };
  
  
  const onWorkspaceDown = (e: React.PointerEvent<SVGElement>) => {
    if (carry) return;
    const p = toWorkspaceCoords(e.clientX, e.clientY);
    setCarry({ type: 'selectbox', start: p, last: p });
    setSelectionBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };
const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const p = toWorkspaceCoords(e.clientX, e.clientY);
    setMouseWS(p);
    if (!carry) return;
    
    if (carry.type === 'selectbox') {
      const rect = rectFromPoints(carry.start, p);
      setSelectionBox(rect);
      setCarry(c => (c && c.type === 'selectbox' ? { ...c, last: p } : c));
      return;
    }
    
    if (carry.type === 'element') {
      const el = elementById(carry.id); if (!el) return;
      const a = nodeById(el.n1), b = nodeById(el.n2); if (!a || !b) return;
      const dx = p.x - carry.start.x;
      const dy = p.y - carry.start.y;
      setNodes(arr => arr.map(n =>
        n.id === a.id ? { ...n, x: carry.a_start.x + dx, y: carry.a_start.y + dy } :
        n.id === b.id ? { ...n, x: carry.b_start.x + dx, y: carry.b_start.y + dy } : n
      ));
    }
    
    if (carry.type === 'group') {
      const dx = p.x - carry.start.x;
      const dy = p.y - carry.start.y;
      setNodes(arr => arr.map(n => {
        const s = carry.nodeStarts ? carry.nodeStarts.get(n.id) : null;
        return s ? { ...n, x: s.x + dx, y: s.y + dy } : n;
      }));
      return;
    }
    
    if (carry.type === 'end') {
      setNodes(arr => arr.map(n => n.id === carry.nodeId ? { ...n, x: p.x, y: p.y } : n));
      const target = nearestSnapTarget(carry.nodeId, nodes);
      setCarry(c => (c && c.type === 'end' ? { ...c, snapTargetId: target ? target.id : null } : c));
    }
  };
  
  const onPointerUp = () => {
    if (!carry) return;
    if (carry.type === 'selectbox') {
      const rect = selectionBox;
      setSelectionBox(null);
      if (!rect || (rect.w < 4 && rect.h < 4)) {
        setSelection([]);
      } else {
        setSelection(elementsInRect(rect));
      }
      setCarry(null);
      return;
    }
    if (carry.type === 'palette') {
      addElement(carry.item.type, mouseWS.x, mouseWS.y);
      setCarry(null);
      return;
    }
    if (carry.type === 'end') {
      if (carry.snapTargetId) {
        const el = elementById(carry.id);
        if (el) {
          const updated = carry.end === 'n1' ? { ...el, n1: carry.snapTargetId } : { ...el, n2: carry.snapTargetId };
          const newEls = commitElements(arr => arr.map(e => e.id === el.id ? updated : e));
          setNodes(prev => reapOrphans(newEls, prev));
          resetSimulation();
        }
      }
      setCarry(null);
      return;
    }
    if (carry.type === 'element' || carry.type === 'group') {
      setCarry(null);
      return;
    }
  };
  
  const onPaletteDown = (item: PaletteItem, e: React.PointerEvent<SVGElement>) => { e.preventDefault(); e.stopPropagation(); setCarry({ type: 'palette', item }); };

  const onElementDown = (elId: string, e: React.PointerEvent<SVGElement>) => {
    e.preventDefault(); e.stopPropagation();
    const el = elementById(elId); if(!el) return;
    // SHIFT-CLICK: break element free
    if (e.shiftKey) {
      const a0 = nodeById(el.n1), b0 = nodeById(el.n2);
      if (!a0 || !b0) return;
      breakElementFree(elId);
      setSelection([elId]);
      setCarry({ type: 'element', id: elId, start: { ...mouseWS }, a_start: { x: a0.x, y: a0.y }, b_start: { x: b0.x, y: b0.y } });
      if (!isScopeLocked) { setScopedElementId(elId); setScopeData([]); }
      return;
    }
    const n1 = nodeById(el.n1); const n2 = nodeById(el.n2); if(!n1 || !n2) return;
const isInCurrent = selection.includes(elId);
    const multi = selection.length > 1;
    if (isInCurrent && multi) {
      const nodeStarts = new Map();
      for (const sid of selection) {
        const se = elementById(sid); if (!se) continue;
        const aN = nodeById(se.n1), bN = nodeById(se.n2);
        if (aN && !nodeStarts.has(aN.id)) nodeStarts.set(aN.id, { x: aN.x, y: aN.y });
        if (bN && !nodeStarts.has(bN.id)) nodeStarts.set(bN.id, { x: bN.x, y: bN.y });
      }
      setCarry({ type: 'group', start: { ...mouseWS }, nodeStarts });
    } else {
      setSelection([elId]);
      setCarry({ type: 'element', id: elId, start: { ...mouseWS }, a_start: {...n1}, b_start: {...n2} });
    }
    if (!isScopeLocked) {
        setScopedElementId(elId);
        setScopeData([]);
    }
  };

  const onEndDown = (elId: string, endKey: 'n1' | 'n2', e: React.PointerEvent<SVGElement>) => {
    e.preventDefault(); e.stopPropagation();
    const el = elementById(elId); if (!el) return;
    const nodeId = endKey === 'n1' ? el.n1 : el.n2;
    setCarry({ type: 'end', id: elId, end: endKey, nodeId, snapTargetId: null });
    setSelection([elId]);
    if (!isScopeLocked) {
        setScopedElementId(elId);
        setScopeData([]);
    }
  };

  const sel = selection.length === 1 ? elementById(selection[0]) : null;
  const scopedElement = scopedElementId ? elementById(scopedElementId) : null;

  // Not memoized: ElementInspector is memo'd on an `element` prop that gets a fresh
  // identity every frame from updateElementAnimations, so the memo never hit anyway,
  // and memoizing these on [sel] is what made the delete handler capture stale state.
  const handleElementChange = (patch: ElementParams) => {
    if (!sel) return;
    commitElements(arr => arr.map(e => e.id === sel.id ? { ...e, params: { ...e.params, ...patch } } : e));
  };

  const handleElementDelete = () => {
    if (!sel) return;
    deleteElement(sel.id);
  };

  const handleElementToggle = () => {
    if (!sel) return;
    commitElements(arr => arr.map(e => e.id === sel.id ? { ...e, params: { ...e.params, closed: !e.params.closed } } : e));
  };

  return (
    <div className="circuit-kit-container">
      <div className="circuit-kit-canvas-container" ref={svgRef}>
        <svg width={size.width} height={size.height}
             onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
             className="circuit-kit-svg">
          <rect x={0} y={0} width={size.width} height={size.height} fill={THEME.canvas} />
          {/* Palette */}
          <g transform="translate(8,8)">
            <rect x={0} y={0} rx={12} ry={12} width={size.width - 16} height={64} fill={THEME.palette} stroke={THEME.border} />
            {PALETTE_ITEMS.map((p, i) => (
              <g key={p.type} transform={`translate(${12 + i * (140 + 10)}, 8)`} style={{ cursor: 'grab' }} onPointerDown={(e) => onPaletteDown(p, e)}>
                <rect width={140} height={48} rx={12} ry={12} fill="transparent" />
                <text x={24} y={30} fontSize={24} fontWeight={800} fill={THEME.text}>{p.icon}</text>
                <text x={58} y={30} fontSize={18} fill={THEME.text}>{p.label}</text>
              </g>
            ))}
          </g>

          {/* Workspace */}
          <g transform={`translate(0,${WORK_OFFSET_Y})`}>
            {/* Invisible hit-rect to capture empty-space drags for marquee */}
            <rect
              data-workspace-hit
              x={0}
              y={0}
              width={size.width}
              height={size.height - WORK_OFFSET_Y}
              fill="transparent"
              pointerEvents="all"
              onPointerDown={onWorkspaceDown}
            />
            {carry?.type === 'palette' && <PreviewElement type={carry.item.type} x={mouseWS.x} y={mouseWS.y} />}
            {elements.map(e => (
              <ElementSVG key={e.id} e={e} nodes={nodes} solution={solution}
                onElementDown={onElementDown} onEndDown={onEndDown} selected={selection.includes(e.id)} showDebug={showDebug} />
            ))}
            {showNodeVoltages && nodes.map(n => {
              const voltage = solution.nodeV.get(n.id);
              if (voltage === undefined) return null;
              return (
                <text
                  key={`label_${n.id}`}
                  x={n.x}
                  y={n.y - 15 * SCALE}
                  fill={THEME.text}
                  fontSize={10 * SCALE}
                  textAnchor="middle"
                >
                  {voltage.toFixed(2)}V
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Controls & Inspector */}
      <div className="flex flex-shrink-0 flex-col gap-3 border-t border-[var(--grid-line)] bg-[var(--surface-elevated)] p-3 text-[var(--text-primary)] sm:flex-row sm:items-start sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ControlBar align="start">
                <Button onClick={() => setIsRunning(s => !s)}>{isRunning ? 'Pause' : 'Play'}</Button>
                <Button variant="secondary" onClick={resetSimulation}>Reset</Button>
                <Button variant="secondary" onClick={() => { setNodes([]); commitElements([]); setSelection([]); }}>Clear all</Button>
                <Button variant="secondary" onClick={() => loadPrebuiltCircuit(generateRCChargeDischargeCircuit)}>Load RC circuit</Button>
            </ControlBar>
            <ControlBar align="start">
                <Toggle label="Node voltages" checked={showNodeVoltages} onChange={setShowNodeVoltages} />
                <Toggle label="Element currents" checked={showDebug} onChange={setShowDebug} />
            </ControlBar>
            <ControlBar align="start">
                <Slider label="Sim speed" min={0.1} max={10} step={0.1} value={simRate} onChange={setSimRate} format={(v) => `${v.toFixed(1)}×`} />
                <Slider label="Flow speed" min={50} max={5000} step={50} value={animSpeed} onChange={setAnimSpeed} />
                <Readout variant="inline">
                  <Readout.Value label="Sim time" value={(simTime * 1000).toFixed(2)} unit="ms" />
                </Readout>
            </ControlBar>
        </div>
        {sel && <ElementInspector element={sel} onChange={handleElementChange} onDelete={handleElementDelete} onToggle={handleElementToggle} />}
        <ScopePlot data={scopeData} element={scopedElement} isLocked={isScopeLocked} onLockToggle={() => setIsScopeLocked(l => !l)} scopeMode={scopeMode} onScopeModeChange={() => setScopeMode(m => m === 'voltage' ? 'current' : 'voltage')} />
      </div>
    </div>
  );
}

/******************* Element SVG *******************/
const getSymbolLength = (type: ElementType) => {
    switch(type) {
        case PALETTE.RESISTOR: return 60 * SCALE;
        case PALETTE.INDUCTOR: return 80 * SCALE;
        case PALETTE.BATTERY: return 12 * SCALE;
        case PALETTE.SWITCH: return 40 * SCALE;
        case PALETTE.CAPACITOR: return 12 * SCALE;
        default: return 0; // Wires have no symbol
    }
};

interface ElementSVGProps {
  e: CircuitElement;
  nodes: CircuitNode[];
  solution: Solution;
  onElementDown: (id: string, ev: React.PointerEvent<SVGElement>) => void;
  onEndDown: (id: string, end: 'n1' | 'n2', ev: React.PointerEvent<SVGElement>) => void;
  selected: boolean;
  showDebug: boolean;
}

function ElementSVG({ e, nodes, solution, onElementDown, onEndDown, selected, showDebug }: ElementSVGProps){
  const a = nodes.find(n=>n.id===e.n1), b = nodes.find(n=>n.id===e.n2); if (!a||!b) return null;
  const {x:x1, y:y1} = a, {x:x2, y:y2} = b;
  const dx=x2-x1, dy=y2-y1; const L = Math.max(1e-6, Math.hypot(dx,dy)); // avoid 0
  const ux=dx/L, uy=dy/L; const px=-uy, py=ux; const mx=(x1+x2)/2, my=(y1+y2)/2;

  const bodyStroke = selected ? THEME.select : (e.type===PALETTE.WIRE ? THEME.wire : THEME.component);
  const I_disp_live = solution.elemI?.get(e.id) ?? 0;

  // --- NEW: pause-safe anim fallback (so dots show even before first anim update)
  const defaultSpacing = L / Math.max(1, Math.floor(L / (30 * SCALE)));
  const anim = e.anim ?? {
    active: Math.abs(I_disp_live) > ANIM_EPS,
    dir: Math.sign(I_disp_live) || 1,
    phasePx: 0,
    spacingPx: defaultSpacing
  };
  // ...
  const showDots = !!anim.active;
  const spacingPx = anim.spacingPx || defaultSpacing;
  const nDots = Math.max(1, Math.floor(L / Math.max(1e-6, spacingPx)));

  const isHoriz = Math.abs(dx) >= Math.abs(dy);
  const labelOffset = (e.type === PALETTE.BATTERY || e.type === PALETTE.CAPACITOR) ? LABEL_OFF + 6 * SCALE : LABEL_OFF;
  const labelX = isHoriz ? mx : mx + (labelOffset * Math.sign(px || 1));
  const labelY = isHoriz ? my - labelOffset : my;
  const labelAnchor = isHoriz ? 'middle' : (px >= 0 ? 'start' : 'end');

  const polarityX = isHoriz ? mx : mx - (LABEL_OFF * Math.sign(px || 1));
  const polarityY = isHoriz ? my + LABEL_OFF : my;
  const polarityAnchor = isHoriz ? 'middle' : (px >= 0 ? 'end' : 'start');

  const symbolLength = getSymbolLength(e.type);
  const hasSymbol = symbolLength > 0;
  const leadLength = (L - symbolLength) / 2;  

  return (
    <g>
      {/* Leads / body */}
      {hasSymbol && leadLength > 5 * SCALE ? (
        <>
          <line x1={x1} y1={y1} x2={x1 + leadLength * ux} y2={y1 + leadLength * uy} stroke={bodyStroke} strokeWidth={3*SCALE} strokeLinecap="round" pointerEvents="none" />
          <line x1={x2} y1={y2} x2={x2 - leadLength * ux} y2={y2 - leadLength * uy} stroke={bodyStroke} strokeWidth={3*SCALE} strokeLinecap="round" pointerEvents="none" />
        </>
      ) : (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={bodyStroke} strokeWidth={e.type===PALETTE.WIRE ? 3*SCALE : 4*SCALE} strokeLinecap="round" pointerEvents="none" />
      )}

      {/* Symbol */}
      {hasSymbol && leadLength > 5 * SCALE && (
        <>
          {e.type===PALETTE.RESISTOR  && (<ResSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
          {e.type===PALETTE.CAPACITOR && (<CapSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
          {e.type===PALETTE.INDUCTOR  && (<InductorSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
          {e.type===PALETTE.BATTERY   && (<BatSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
          {e.type===PALETTE.SWITCH    && (<SwSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} closed={!!e.params.closed} />)}
        </>
      )}

      {/* Polarity Indicators */}
      {e.type === PALETTE.BATTERY && (
          <>
            <text x={polarityX - 10*SCALE*ux} y={polarityY - 10*SCALE*uy} fontSize={16*SCALE} fill={THEME.text} fontWeight="bold" textAnchor={polarityAnchor}>+</text>
            <text x={polarityX + 10*SCALE*ux} y={polarityY + 10*SCALE*uy} fontSize={16*SCALE} fill={THEME.text} fontWeight="bold" textAnchor={polarityAnchor}>-</text>
          </>
      )}

      {e.type === PALETTE.CAPACITOR && Math.abs(e.params.v || 0) > 0.1 && (() => {
          const v = e.params.v || 0;
          const sign = Math.sign(v);
          if (sign === 0) return null;

          // v = v1 - v2. If v > 0, n1 is positive. Vector ux points from n1->n2.
          // So positive sign is on the -ux side of the center.
          const plusX = polarityX - sign * 10*SCALE*ux;
          const plusY = polarityY - sign * 10*SCALE*uy;
          const minusX = polarityX + sign * 10*SCALE*ux;
          const minusY = polarityY + sign * 10*SCALE*uy;

          return (
            <>
              <text x={plusX} y={plusY} fontSize={16*SCALE} fill={THEME.text} fontWeight="bold" textAnchor={polarityAnchor}>+</text>
              <text x={minusX} y={minusY} fontSize={16*SCALE} fill={THEME.text} fontWeight="bold" textAnchor={polarityAnchor}>-</text>
            </>
          );
      })()}

      {/* Label */}
        <text x={labelX} y={labelY} fontSize={12*SCALE} textAnchor={labelAnchor} fill={THEME.text}>{labelFor(e)}</text>

        {/* Hit areas */}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={CAPTURE_W} pointerEvents="stroke" style={{ cursor:'grab' }}
              onPointerDown={(ev)=>onElementDown(e.id, ev)} />
        {/* Opaque-centre rings. The old neon idiom (12% fill under a Gaussian blur)
            only read against a near-black canvas; on the light canvas it was a smudge. */}
        <circle cx={x1} cy={y1} r={END_R} fill={THEME.canvas} stroke={THEME.current} strokeWidth={3} style={{ cursor:'crosshair' }} onPointerDown={(ev)=>onEndDown(e.id,'n1',ev)} />
        <circle cx={x2} cy={y2} r={END_R} fill={THEME.canvas} stroke={THEME.current} strokeWidth={3} style={{ cursor:'crosshair' }} onPointerDown={(ev)=>onEndDown(e.id,'n2',ev)} />

        {/* Dots — NEW phasePx/spacingPx renderer (direction always correct) */}
        {showDots && Array.from({ length: nDots }).map((_, i) => {
          const sPx = (anim.phasePx + i * spacingPx) % L;
          const s = sPx / L;
          const cx = x1 + dx * s, cy = y1 + dy * s;
          // Halo in the canvas colour: dot-on-background is fine, but dot-on-wire is
          // only ~1.6:1 without it.
          return <circle key={i} cx={cx} cy={cy} r={2.5 * SCALE} fill={THEME.current} stroke={THEME.canvas} strokeWidth={2.5} pointerEvents="none" />;
      })}

      {/* Debug overlay */}
      {showDebug && (
        <g>
          {(() => {
            const v1 = solution.nodeV.get(e.n1) ?? 0;
            const v2 = solution.nodeV.get(e.n2) ?? 0;
            const dv = v1 - v2;
            const Idisp = e.anim?.I_disp ?? (solution.elemI?.get(e.id) ?? 0);
            const dirVal = e.anim?.dir ?? (Math.sign(Idisp) || 1);
            const dirArrow = dirVal > 0 ? "→" : "←";
            const fmt = (x: number) => {
              const a = Math.abs(x);
              if (a >= 1) return x.toFixed(2) + " A";
              if (a >= 1e-3) return (x*1e3).toFixed(2) + " mA";
              if (a >= 1e-6) return (x*1e6).toFixed(2) + " µA";
              if (a >= 1e-9) return (x*1e9).toFixed(2) + " nA";
              return x.toExponential(2) + " A";
            };
            const label = `${fmt(Idisp)} ${dirArrow}  (ΔV=${dv.toFixed(3)} V)`;
            const off = 16 * SCALE;
            return (
              <text x={mx + off * px} y={my + off * py} fill={THEME.text}
                    fontSize={10*SCALE} textAnchor="middle" opacity="0.85" pointerEvents="none">
                {label}
              </text>
            );
          })()}
        </g>
      )}

    </g>
  );
}

function labelFor(e: CircuitElement){
  const formatVal = (val: number | undefined, unit: string) => {
      if(val === undefined || val === null) return `? ${unit}`;
      if (Math.abs(val) >= 1e6) return `${(val/1e6).toPrecision(3)} M${unit}`;
      if (Math.abs(val) >= 1e3) return `${(val/1e3).toPrecision(3)} k${unit}`;
      if (Math.abs(val) < 1e-6) return `${(val*1e9).toPrecision(3)} n${unit}`;
      if (Math.abs(val) < 1e-3) return `${(val*1e6).toPrecision(3)} µ${unit}`;
      if (Math.abs(val) < 1) return `${(val*1e3).toPrecision(3)} m${unit}`;
      return `${val.toPrecision(3)} ${unit}`;
  }
  if (e.type===PALETTE.RESISTOR)  return formatVal(e.params.R, "Ω");
  if (e.type===PALETTE.BATTERY)   return formatVal(e.params.V, "V");
  if (e.type===PALETTE.CAPACITOR) return formatVal(e.params.C, "F");
  if (e.type===PALETTE.INDUCTOR)  return formatVal(e.params.L, "H");
  if (e.type===PALETTE.SWITCH)    return e.params.closed?"closed":"open";
  return "";
}

/******************* Inspector & Scope *******************/
// InlineControls has no text-input primitive, and adding one for a single caller
// would change a shared five-consumer API. ModeControls.tsx sets the precedent of a
// module-local class string instead. Note the arbitrary-value form: the Tailwind
// `theme-*` aliases in tailwind.config.mjs are never loaded and emit no CSS.
const numberFieldClass =
  'w-32 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-2 py-1 ' +
  'text-right font-mono tabular-nums text-[var(--text-primary)]';

interface ParamInputProps {
  label: string;
  unit: string;
  value: number | undefined;
  paramKey: keyof ElementParams;
  onChange: (patch: ElementParams) => void;
}

const ParamInput = React.memo(function ParamInput({ label, unit, value, paramKey, onChange }: ParamInputProps) {
  const [localValue, setLocalValue] = useState<string | number>(value ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalValue(value ?? '');
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    const numValue = Number(localValue);
    if (!isNaN(numValue) && numValue !== value) {
      onChange({ [paramKey]: numValue });
    } else {
      setLocalValue(value ?? ''); // revert
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setLocalValue(value ?? '');
      e.currentTarget.blur();
    }
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-10 font-medium">{label} ({unit})</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className={numberFieldClass}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
});

interface ElementInspectorProps {
  element: CircuitElement | null;
  onChange: (patch: ElementParams) => void;
  onDelete: () => void;
  onToggle: () => void;
}

const ElementInspector = React.memo(function ElementInspector({ element, onChange, onDelete, onToggle }: ElementInspectorProps) {
  if (!element) return null;

  return (
    <div className="flex flex-shrink-0 flex-col gap-2 rounded-lg border border-[var(--grid-line)] p-3">
      <div className="text-sm font-semibold">{element.type.charAt(0).toUpperCase() + element.type.slice(1)}</div>
      {element.type === PALETTE.RESISTOR && <ParamInput label="R" unit="Ω" value={element.params.R} paramKey="R" onChange={onChange} />}
      {element.type === PALETTE.BATTERY && <ParamInput label="V" unit="V" value={element.params.V} paramKey="V" onChange={onChange} />}
      {element.type === PALETTE.CAPACITOR && <ParamInput label="C" unit="F" value={element.params.C} paramKey="C" onChange={onChange} />}
      {element.type === PALETTE.INDUCTOR && <ParamInput label="L" unit="H" value={element.params.L} paramKey="L" onChange={onChange} />}
      {element.type === PALETTE.SWITCH && (
        <Toggle label="Closed" checked={!!element.params.closed} onChange={onToggle} />
      )}
      <Button variant="secondary" className="circuit-kit-delete self-start" onClick={onDelete}>Delete</Button>
    </div>
  );
});

interface ScopePlotProps {
  data: ScopeSample[];
  element: CircuitElement | null;
  isLocked: boolean;
  onLockToggle: () => void;
  scopeMode: ScopeMode;
  onScopeModeChange: () => void;
}

function ScopePlot({ data, element, isLocked, onLockToggle, scopeMode, onScopeModeChange }: ScopePlotProps) {
  const width = 400, height = 150;
  if (!element) return <div className="flex flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--grid-line)] p-3 text-sm text-[var(--text-muted)]">Select an element to scope its value.</div>;

  const values = data.map(d => d.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = (max - min) || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((d.value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const canToggleMode = element.type === PALETTE.RESISTOR || element.type === PALETTE.INDUCTOR;
  const unit = scopeMode === 'current' ? 'A' : 'V';
  const type = scopeMode === 'current' ? 'Current' : 'Voltage';
  const lastVal = data.length > 0 ? data[data.length-1].value : 0;

  return (
      <div className="flex flex-shrink-0 flex-col gap-2 rounded-lg border border-[var(--grid-line)] p-2">
        {/* The lock and mode buttons used to be absolutely-positioned overlays sized by
            a tiny padding override. `.btn` is unlayered in global.css, so Tailwind
            utilities cannot reach it — a header row is the honest layout anyway. */}
        <ControlBar align="start">
            <span className="text-sm font-semibold">Scope: {element.type} {type}</span>
            <span className="font-mono text-sm tabular-nums">{lastVal.toPrecision(3)} {unit}</span>
            <Toggle label="Lock" checked={isLocked} onChange={onLockToggle} />
            {canToggleMode && (
              <Button variant="secondary" onClick={onScopeModeChange}>
                {scopeMode === 'voltage' ? 'Show current' : 'Show voltage'}
              </Button>
            )}
        </ControlBar>
        <svg width={width} height={height}>
            {/* Grid lines */}
            <line x1={0} y1={height/2} x2={width} y2={height/2} stroke={THEME.border} strokeWidth={1} strokeDasharray="4 4" />
            <line x1={0} y1={0.5} x2={width} y2={0.5} stroke={THEME.border} strokeWidth={1} />
            <line x1={0} y1={height-0.5} x2={width} y2={height-0.5} stroke={THEME.border} strokeWidth={1} />
            <text x={5} y={12} fill={THEME.text} fontSize={11}>{max.toPrecision(2)}</text>
            <text x={5} y={height-4} fill={THEME.text} fontSize={11}>{min.toPrecision(2)}</text>

            {data.length > 1 && (
  <polyline
    points={points}
    fill="none"
    stroke={THEME.current}
    strokeWidth={2.5}
    strokeLinejoin="round"
    strokeLinecap="round"
  />
)}

        </svg>
      </div>
  );
}

/******************* Preview (ghost) *******************/
function PreviewElement({ type, x, y }: { type: ElementType; x: number; y: number }){
  const len = 90 * SCALE; const x1 = x - len/2, y1 = y, x2 = x + len/2, y2 = y;
  const dx=x2-x1, dy=y2-y1; const L=Math.hypot(dx,dy)||1; const ux=dx/L, uy=dy/L; const px=-uy, py=ux; const mx=(x1+x2)/2, my=(y1+y2)/2;
  const stroke = type===PALETTE.WIRE? THEME.wire : THEME.component;
  return (
    <g opacity={0.55}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={4*SCALE} strokeLinecap="round" />
      {type===PALETTE.RESISTOR  && (<ResSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
      {type===PALETTE.CAPACITOR && (<CapSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
      {type===PALETTE.INDUCTOR  && (<InductorSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
      {type===PALETTE.BATTERY   && (<BatSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} />)}
      {type===PALETTE.SWITCH    && (<SwSymbol mx={mx} my={my} ux={ux} uy={uy} px={px} py={py} closed={true} />)}
    </g>
  );


}