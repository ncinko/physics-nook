import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import './CircuitKit.css';

/**
 * CircuitKit.jsx — Transient Circuit Simulator
 *
 * This refactored version includes:
 * - A full transient simulation engine using the Trapezoidal method.
 * - Time-dependent simulation for Capacitors.
 * - A new Inductor component.
 * - A responsive layout that adapts to window size.
 * - A dark theme for the canvas and UI elements.
 * - A real-time Voltage/Current scope to plot component values.
 * - Simulation controls (Play, Pause, Reset).
 * - Live updating of component values during simulation.
 * - Scope locking to observe one component while interacting with another.
 * - Self-contained styling CircuitKit.css.
 * - Adjustable simulation speed control
 * - Cleaner component visuals where symbols break the wire.
 * - Reduced internal wire resistance for near-ideal LC oscillations.
 * - Slider controls for simulation and animation speed.
 * - Improved battery and capacitor visual symbols with correct polarity.
 * - Relocated polarity symbols for better visual separation from labels.
 * - Added a pre-built circuit menu with an RC charging/discharging example.
 */

/******************* Visual & Interaction Constants *******************/
const WORK_OFFSET_Y = 72;
const SCALE = 2;
const CAPTURE_W = 24 * SCALE;
const END_R = 9 * SCALE;
const LABEL_OFF = 12 * SCALE;
const SNAP_RADIUS = 18 * SCALE;
const ANIM_EPS = 1e-3; // Increased to reduce jitter

const THEME = {
  background: "#1f2937",
  canvas: "#111827",
  text: "#f9fafb",
  textMuted: "#9ca3af",
  component: "#d1d5db",
  wire: "#6b7280",
  palette: "#374151",
  paletteHover: "#4b5563",
  select: "#2563eb",
  glow: "#38bdf8",
  snap: "#16a34a",
  current: "#3b82f6",
  button: "#374151",
  buttonText: "#f9fafb",
  border: "#4b5563",
  scopeGrid: "#374151",
  scopePlot: "#2563eb",
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
};

const PALETTE_ITEMS = [
  { type: PALETTE.RESISTOR,  label: "Resistor",  icon: "Ω",  def: { R: 10 } },
  { type: PALETTE.BATTERY,   label: "Battery",   icon: "+−", def: { V: 5 } },
  { type: PALETTE.CAPACITOR, label: "Capacitor", icon: "∥",  def: { C: 1e-6, v: 0, i: 0 } },
  { type: PALETTE.INDUCTOR,  label: "Inductor",  icon: "∿",  def: { L: 1e-3, i: 0 } },
  { type: PALETTE.SWITCH,    label: "Switch",    icon: "⎍",  def: { closed: true } },
  { type: PALETTE.WIRE,      label: "Wire",      icon: "—",  def: {} },
];

const uid = (() => { let n = 1; return () => String(n++); })();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/******************* Pre-built Circuit Generators *******************/
function generateRCChargeDischargeCircuit() {
  const l_uid = (() => { let n = 1; return () => `rc_${n++}`; })();

  // Grid helper
  const origin = { x: 350, y: 160 };
  const dx = 220, dy = 160;
  const grid = (c, r) => ({ x: origin.x + c * dx, y: origin.y + r * dy });

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

  const elements = [
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
function solveLinearSystem(A, b) {
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
function buildAndSolveTransient(nodes, elements, groundNodeId, dt) {
    if (!nodes.length || dt <= 0) return { nodeV: new Map(), elemI: new Map(), ground: null, newStates: {} };

    const ground = groundNodeId || chooseGround(nodes);
    const nodeVarIndex = new Map();
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
    const idx = (nodeId) => nodeId === ground ? null : nodeVarIndex.get(nodeId);

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
    const nodeV = new Map();
    nodes.forEach(n => { nodeV.set(n.id, idx(n.id) != null ? x[idx(n.id)] : 0); });

    const elemI = new Map();
    const newStates = {};

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


function chooseGround(nodes){
  if (!nodes.length) return null;
  const minIdx = nodes.reduce((best, n, i) => {
    if (best === -1) return i;
    const b = nodes[best];
    return (n.y > b.y + 1e-6 || (Math.abs(n.y-b.y)<1e-6 && n.x < b.x)) ? i : best;
  }, -1);
  return nodes[minIdx]?.id ?? null;
}

function updateElementAnimations(elements, elemI, animSpeed, realDT, nodes, maxAbsI) {
  const getLen = (e) => {
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
function ResSymbol({ mx, my, ux, uy, px, py }) {
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
function BatSymbol({ mx,my,ux,uy,px,py }){
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
function SwSymbol({ mx,my,ux,uy,px,py,closed }){
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
function CapSymbol({ mx,my,ux,uy,px,py }){
  const L=6*SCALE, plateW=16*SCALE;
  return (
    <g>
      <line x1={mx-L*ux-plateW*px} y1={my-L*uy-plateW*py} x2={mx-L*ux+plateW*px} y2={my-L*uy+plateW*py} stroke={THEME.component} strokeWidth={3*SCALE} />
      <line x1={mx+L*ux-plateW*px} y1={my+L*uy-plateW*py} x2={mx+L*ux+plateW*px} y2={my+L*uy+plateW*py} stroke={THEME.component} strokeWidth={3*SCALE} />
    </g>
  );
}
function InductorSymbol({ mx,my,ux,uy,px,py }){
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
  const svgRef = useRef(null);

  // graph
  const [nodes, setNodes] = useState([]);
  const [elements, setElements] = useState([]);
  const [selection, setSelection] = useState([]);
  const [groundNodeId, setGroundNodeId] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const nextIdRef = useRef(1000000);
  const allocNodeId = () => `n${nextIdRef.current++}`;


  // drag state
  const [carry, setCarry] = useState(null);
  const [mouseWS, setMouseWS] = useState({ x: 0, y: 0 });

  // simulation state
  const [simTime, setSimTime] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [simRate, setSimRate] = useState(3.0);
  const [animSpeed, setAnimSpeed] = useState(1000);
  
  const [visTime, setVisTime] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [showNodeVoltages, setShowNodeVoltages] = useState(false);
  const [solution, setSolution] = useState({ nodeV: new Map(), elemI: new Map() });
  const [scopeData, setScopeData] = useState([]);
  const [scopedElementId, setScopedElementId] = useState(null);
  const [isScopeLocked, setIsScopeLocked] = useState(false);
  const [scopeMode, setScopeMode] = useState('voltage');

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

  // Main simulation loop
useEffect(() => {
  let animFrameId;
  let lastTS = performance.now() / 1000;
  const effectiveDT = SIM_DT * simRate;

  const step = () => {
    const now = performance.now() / 1000;
    const realDT = Math.max(0, Math.min(0.1, now - lastTS));
    lastTS = now;
    setVisTime(tv => tv + realDT);

    if (isRunning) {
      setElements(prevElements => {
        const { nodeV, elemI, ground, newStates } =
          buildAndSolveTransient(nodes, prevElements, groundNodeId, effectiveDT);

        setSolution({ nodeV, elemI, ground });
        setSimTime(t => t + effectiveDT);

        // carry state updates for reactive components
        const nextElements = prevElements.map(el => {
          if (newStates[el.id]) {
            return { ...el, params: { ...el.params, ...newStates[el.id] } };
          }
          return el;
        });

        // NEW: compute max current magnitude for relative scaling
        let maxAbsI = 0;
        for (const v of elemI.values()) maxAbsI = Math.max(maxAbsI, Math.abs(v));

        // NEW: phase-based animation update with anti-alias clamp
        const withAnim = updateElementAnimations(
          nextElements, elemI, animSpeed, realDT, nodes, maxAbsI
        );
        return withAnim;
      });
    }

    animFrameId = requestAnimationFrame(step);
  };

  animFrameId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(animFrameId);
}, [isRunning, nodes, groundNodeId, simRate, animSpeed]);


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
  const nodeById = (id) => nodes.find(n => n.id === id);
  const elementById = (id) => elements.find(e => e.id === id);

  const resetSimulation = () => {
      setSimTime(0);
      setScopeData([]);
      setElements(els => els.map(el => {
          const newParams = { ...el.params };
          if (el.type === PALETTE.CAPACITOR) { newParams.v = 0; newParams.i = 0; }
          if (el.type === PALETTE.INDUCTOR) newParams.i = 0;
          return { ...el, params: newParams };
      }));
  };
  
  const addNode = (x, y) => { const id = uid(); setNodes(arr => [...arr, { id, x, y }]); return id; };
  
  const addElement = (type, x, y) => {
    const half = 50 * SCALE; // Increased default length
    const n1 = addNode(x - half, y);
    const n2 = addNode(x + half, y);
    const item = PALETTE_ITEMS.find(p => p.type === type);
    const params = item ? { ...item.def } : {};
    const id = uid();
    setElements(arr => [...arr, { id, type, n1, n2, params }]);
    setSelection([id]);
    resetSimulation();
  };
  
  const deleteElement = (id) => {
    if (scopedElementId === id) {
        setScopedElementId(null);
        setIsScopeLocked(false);
    }
    setElements(arr => {
        const newEls = arr.filter(e => e.id !== id);
        setNodes(reapOrphans(newEls, nodes));
        return newEls;
    });
    setSelection([]);
  };
  
  const reapOrphans = (elArr, nodesArr) => {
    const used = new Set();
    elArr.forEach(e => { used.add(e.n1); used.add(e.n2); });
    return nodesArr.filter(n => used.has(n.id));
  };
  
  const nearestSnapTarget = (nodeId, nodesArr) => {
    const self = nodesArr.find(n => n.id === nodeId); if (!self) return null;
    let best = null, bestD2 = Infinity;
    for (const n of nodesArr) {
      if (n.id === nodeId) continue;
      const d2 = (n.x - self.x) ** 2 + (n.y - self.y) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = n; }
    }
    return (best && Math.sqrt(bestD2) <= SNAP_RADIUS) ? best : null;
  };
  
  const loadPrebuiltCircuit = (generator) => {
    setIsRunning(false);
    setSelection([]);
    const { nodes: newNodes, elements: newElements } = generator();
    setNodes(newNodes);
    setElements(newElements);
    setTimeout(resetSimulation, 0); 
  };


  
  // Selection helpers
  const rectFromPoints = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    return { x, y, w, h };
  };
  const lineIntersectsRect = (x1, y1, x2, y2, rx, ry, rw, rh) => {
    const inside = (x, y) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
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
  const elementsInRect = (rect) => {
    const { x: rx, y: ry, w: rw, h: rh } = rect;
    const picked = [];
    for (const e of elements) {
      const a = nodeById(e.n1), b = nodeById(e.n2);
      if (!a || !b) continue;
      if (lineIntersectsRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh)) picked.push(e.id);
    }
    return picked;
  };

    const breakElementFree = (elId) => {
    const el = elementById(elId);
    if (!el) return;
    const a = nodeById(el.n1);
    const b = nodeById(el.n2);
    if (!a || !b) return;
    const n1 = allocNodeId();
    const n2 = allocNodeId();
    setNodes(arr => [...arr, { id: n1, x: a.x, y: a.y }, { id: n2, x: b.x, y: b.y }]);
    setElements(arr => arr.map(e => e.id === elId ? { ...e, n1, n2 } : e));
  };
// Pointer Handlers
  const toWorkspaceCoords = (clientX, clientY) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const xSVG = clamp(clientX - rect.left, 0, size.width);
    const ySVG = clamp(clientY - rect.top, 0, size.height);
    return { x: xSVG, y: ySVG - WORK_OFFSET_Y };
  };
  
  
  const onWorkspaceDown = (e) => {
    if (carry) return;
    const p = toWorkspaceCoords(e.clientX, e.clientY);
    setCarry({ type: 'selectbox', start: p, last: p });
    setSelectionBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };
const onPointerMove = (e) => {
    const p = toWorkspaceCoords(e.clientX, e.clientY);
    setMouseWS(p);
    if (!carry) return;
    
    if (carry.type === 'selectbox') {
      const rect = rectFromPoints(carry.start, p);
      setSelectionBox(rect);
      setCarry(c => ({ ...c, last: p }));
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
      setCarry(c => ({ ...c, snapTargetId: target ? target.id : null }));
    }
  };
  
  const onPointerUp = (e) => {
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
          const newEls = elements.map(e => e.id === el.id ? updated : e);
          setElements(newEls);
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
  
  const onPaletteDown = (item, e) => { e.preventDefault(); e.stopPropagation(); setCarry({ type: 'palette', item }); };

  const onElementDown = (elId, e) => {
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

  const onEndDown = (elId, endKey, e) => {
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

  const maxCurrent = useMemo(() => {
    if (!solution.elemI || solution.elemI.size === 0) return 0;
    return Math.max(0, ...Array.from(solution.elemI.values()).map(Math.abs));
  }, [solution.elemI]);

  const handleElementChange = useCallback((patch) => {
    if (!sel) return;
    setElements(arr => arr.map(e => e.id === sel.id ? { ...e, params: { ...e.params, ...patch } } : e));
  }, [sel]);

  const handleElementDelete = useCallback(() => {
    if (!sel) return;
    deleteElement(sel.id);
  }, [sel]);

  const handleElementToggle = useCallback(() => {
    if (!sel) return;
    setElements(arr => arr.map(e => e.id === sel.id ? { ...e, params: { ...e.params, closed: !e.params.closed } } : e));
  }, [sel]);

  return (
    <div className="circuit-kit-container">
      <div className="circuit-kit-canvas-container" ref={svgRef}>
        <svg width={size.width} height={size.height}
             onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
             className="circuit-kit-svg">
          <rect x={0} y={0} width={size.width} height={size.height} fill={THEME.canvas} />
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

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
          <g transform={`translate(0,${WORK_OFFSET_Y})`} onPointerDown={onWorkspaceDown}>
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
              <ElementSVG key={e.id} e={e} nodes={nodes} solution={solution} t={visTime} dragInfo={carry}
                animSpeed={animSpeed}
                maxCurrent={maxCurrent}
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
      <div className="circuit-kit-controls-inspector">
        <div className="circuit-kit-controls">
            <div className="circuit-kit-buttons">
                <button className="circuit-kit-button" onClick={() => setIsRunning(s => !s)}>{isRunning ? 'Pause' : 'Play'}</button>
                <button className="circuit-kit-button" onClick={resetSimulation}>Reset</button>
                <button className="circuit-kit-button" onClick={() => { setNodes([]); setElements([]); setSelection([]); }}>Clear All</button>
                <button className="circuit-kit-button" onClick={() => loadPrebuiltCircuit(generateRCChargeDischargeCircuit)}>Load RC Circuit</button>
                <button className="circuit-kit-button" onClick={() => setShowNodeVoltages(s => !s)}>{showNodeVoltages ? 'Hide' : 'Show'} Voltages</button>
            </div>
            <div className="circuit-kit-sliders">
                <label className="circuit-kit-slider-label">
                    Sim Speed ({simRate.toFixed(1)}x)
                    <input type="range" min="0.1" max="10" step="0.1" value={simRate} onChange={(e) => setSimRate(Number(e.target.value))} />
                </label>
                 <label className="circuit-kit-slider-label">
                    Anim. Speed ({animSpeed})
                    <input type="range" min="50" max="5000" step="50" value={animSpeed} onChange={(e) => setAnimSpeed(Number(e.target.value))} />
                </label>
            </div>
                            <label className="circuit-kit-slider-label">
                    
                </label>
<div className="circuit-kit-sim-time">Sim Time: {(simTime * 1000).toFixed(2)} ms</div>
        </div>
        {sel && <ElementInspector element={sel} onChange={handleElementChange} onDelete={handleElementDelete} onToggle={handleElementToggle} />}
         <ScopePlot data={scopeData} element={scopedElement} isLocked={isScopeLocked} onLockToggle={() => setIsScopeLocked(l => !l)} scopeMode={scopeMode} onScopeModeChange={() => setScopeMode(m => m === 'voltage' ? 'current' : 'voltage')} />
      </div>
    </div>
  );
}

/******************* Element SVG *******************/
const getSymbolLength = (type) => {
    switch(type) {
        case PALETTE.RESISTOR: return 60 * SCALE;
        case PALETTE.INDUCTOR: return 80 * SCALE;
        case PALETTE.BATTERY: return 12 * SCALE;
        case PALETTE.SWITCH: return 40 * SCALE;
        case PALETTE.CAPACITOR: return 12 * SCALE;
        default: return 0; // Wires have no symbol
    }
};

function ElementSVG({ e, nodes, solution, t, dragInfo, animSpeed, maxCurrent, onElementDown, onEndDown, selected, showDebug }){
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
        <circle cx={x1} cy={y1} r={END_R} fill={THEME.glow} fillOpacity={0.12} stroke={THEME.glow} strokeWidth={3} filter="url(#glow)" style={{ cursor:'crosshair' }} onPointerDown={(ev)=>onEndDown(e.id,'n1',ev)} />
        <circle cx={x2} cy={y2} r={END_R} fill={THEME.glow} fillOpacity={0.12} stroke={THEME.glow} strokeWidth={3} filter="url(#glow)" style={{ cursor:'crosshair' }} onPointerDown={(ev)=>onEndDown(e.id,'n2',ev)} />

        {/* Dots — NEW phasePx/spacingPx renderer (direction always correct) */}
        {showDots && Array.from({ length: nDots }).map((_, i) => {
          const sPx = (anim.phasePx + i * spacingPx) % L;
          const s = sPx / L;
          const cx = x1 + dx * s, cy = y1 + dy * s;
          return <circle key={i} cx={cx} cy={cy} r={2.5 * SCALE} fill={THEME.current} pointerEvents="none" />;
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
            const fmt = (x) => {
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

function labelFor(e){
  const formatVal = (val, unit) => {
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
const ParamInput = React.memo(function ParamInput({ label, unit, value, paramKey, onChange }) {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    const numValue = Number(localValue);
    if (!isNaN(numValue) && numValue !== value) {
      onChange({ [paramKey]: numValue });
    } else {
      setLocalValue(value); // revert
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleBlur();
      e.target.blur();
    } else if (e.key === 'Escape') {
      setLocalValue(value);
      e.target.blur();
    }
  };

  return (
    <label className="element-inspector-param">
      <span className="element-inspector-param-label">{label} ({unit}):</span>
      <input
        ref={inputRef}
        type="text"
        className="element-inspector-input"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
});

const ElementInspector = React.memo(function ElementInspector({ element, onChange, onDelete, onToggle }) {
  if (!element) return null;

  return (
    <div className="element-inspector">
      <div className="element-inspector-title">{element.type.charAt(0).toUpperCase() + element.type.slice(1)}</div>
      {element.type === PALETTE.RESISTOR && <ParamInput label="R" unit="Ω" value={element.params.R} paramKey="R" onChange={onChange} />}
      {element.type === PALETTE.BATTERY && <ParamInput label="V" unit="V" value={element.params.V} paramKey="V" onChange={onChange} />}
      {element.type === PALETTE.CAPACITOR && <ParamInput label="C" unit="F" value={element.params.C} paramKey="C" onChange={onChange} />}
      {element.type === PALETTE.INDUCTOR && <ParamInput label="L" unit="H" value={element.params.L} paramKey="L" onChange={onChange} />}
      {element.type === PALETTE.SWITCH && (
        <label className="element-inspector-checkbox">
          <input type="checkbox" checked={!!element.params.closed} onChange={onToggle} /> Closed
        </label>
      )}
      <div className="element-inspector-actions">
        <button className="element-inspector-delete-button" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
});

function ScopePlot({ data, element, isLocked, onLockToggle, scopeMode, onScopeModeChange }) {
  const width = 400, height = 150;
  if (!element) return <div className="scope-plot-no-element">Select an element to scope its value.</div>;

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
      <div className="scope-plot-container">
        <button onClick={onLockToggle} className={`scope-plot-lock-button ${isLocked ? 'locked' : ''}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              {isLocked ? 
                <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/> :
                <path d="M11 1a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5V3a3 3 0 0 1 6 0v4a.5.5 0 0 1-1 0V3a2 2 0 0 0-2-2z"/>
              }
            </svg>
        </button>
        {canToggleMode && <button onClick={onScopeModeChange} className="scope-plot-mode-button">{scopeMode === 'voltage' ? 'Show Current' : 'Show Voltage'}</button>}
        <div className="scope-plot-header" style={{ marginBottom: 8 }}>
        
            <span>Scope: {element.type} {type}</span>
            <span className="scope-plot-value">{lastVal.toPrecision(3)} {unit}</span>
        </div>
        <svg width={width} height={height}>
            {/* Grid lines */}
            <line x1={0} y1={height/2} x2={width} y2={height/2} className="scope-grid" />
            <line x1={0} y1={0} x2={width} y2={0} className="scope-grid" />
            <line x1={0} y1={height} x2={width} y2={height} className="scope-grid" />
            <text x={5} y={12} className="scope-text">{max.toPrecision(2)}</text>
            <text x={5} y={height-4} className="scope-text">{min.toPrecision(2)}</text>
            
            {data.length > 1 && (
  <polyline
    points={points}
    className="scope-plot"
    fill="none"
    stroke={THEME.current}        // or a hard-coded color like "#1f6feb"
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
function PreviewElement({ type, x, y }){
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