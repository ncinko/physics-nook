// PointChargeField.jsx — single point charge with r̂, snapping, shared-exponent readout
import React, { useRef, useEffect, useState } from "react";
import { themeColors, onThemeChange } from "../shared/themeColors";

export default function PointChargeUnitVectorDemo() {
  const canvasRef = useRef(null);

  // --- Responsive sizing (based on parent container) ---
  const ASPECT = 0.55; // height = ASPECT * width
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const getParentWidth = () => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return undefined;
    const w = parent.getBoundingClientRect().width;
    // Keep within sensible bounds for layout and labels
    return clamp(w, 280, 900);
  };

  const computeSize = () => {
    const w = getParentWidth() ?? clamp(window.innerWidth - 48, 280, 900);
    return { width: Math.round(w), height: Math.round(w * ASPECT) };
  };

  const [size, setSize] = useState(computeSize());

  useEffect(() => {
    const update = () => setSize(computeSize());
    update(); // initial

    // Observe the parent for container-based resizes (reflows, grid changes, etc.)
    const parent = canvasRef.current?.parentElement;
    let ro;
    if (parent && "ResizeObserver" in window) {
      ro = new ResizeObserver(update);
      ro.observe(parent);
    }
    // Fallback: watch window resizes
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      if (ro) ro.disconnect();
    };
  }, []);

  // --- Units / constants ---
  const PIXEL_TO_MICROMETER = 1;   // 1 px = 1 µm
  const UM_TO_M = 1e-6;            // µm → m
  const GRID_SPACING_UM = 50;      // every 50 µm
  const k = 9e9;                   // N·m^2/C^2

  const E_PIXELS_PER_SI = 6.5e-8;  // px per (N/C)
  const E_LEN_MAX = 260;           // px cap
  const soft_um = 5;
  const soft_m  = soft_um * UM_TO_M;

  // --- State: charge, positions, snapping ---
  const [qNanoC, setQNanoC] = useState(5.0);   // nC
  const q = qNanoC * 1e-9;                     // C

  const [charge, setCharge] = useState({ x: size.width * 0.40, y: size.height * 0.55 });
  const [probe,  setProbe ] = useState({ x: size.width * 0.65, y: size.height * 0.30 });
  const [snap, setSnap] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  // Grid origin (fixed so grid doesn't slide)
  const gridStepPx = GRID_SPACING_UM / PIXEL_TO_MICROMETER;
  const getOrigin = () => ({ x: Math.round(size.width / 2), y: Math.round(size.height / 2) });

  // Snap helper (kept in bounds and aligned to visible grid)
  const snapPoint = (p) => {
    const clampPt = (x, y) => ({
      x: Math.max(0, Math.min(size.width,  x)),
      y: Math.max(0, Math.min(size.height, y)),
    });
    if (!snap) return clampPt(p.x, p.y);
    const { x: ox, y: oy } = getOrigin();
    const ix = Math.round((p.x - ox) / gridStepPx);
    const iy = Math.round((p.y - oy) / gridStepPx);
    const ixMin = Math.ceil((0 - ox) / gridStepPx);
    const ixMax = Math.floor((size.width  - ox) / gridStepPx);
    const iyMin = Math.ceil((0 - oy) / gridStepPx);
    const iyMax = Math.floor((size.height - oy) / gridStepPx);
    const clampedIx = Math.max(ixMin, Math.min(ixMax, ix));
    const clampedIy = Math.max(iyMin, Math.min(iyMax, iy));
    return { x: ox + clampedIx * gridStepPx, y: oy + clampedIy * gridStepPx };
  };

  // Scale positions on resize; re-snap afterward if needed
  const prevSize = useRef(size);
  useEffect(() => {
    const sx = size.width / prevSize.current.width;
    const sy = size.height / prevSize.current.height;
    setCharge(p => ({ x: p.x * sx, y: p.y * sy }));
    setProbe (p => ({ x: p.x * sx, y: p.y * sy }));
    prevSize.current = size;
  }, [size]);
  useEffect(() => {
    if (snap) {
      setCharge(p => snapPoint(p));
      setProbe (p => snapPoint(p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, size.width, size.height]);

  // --- Dragging (mouse + touch) ---
  const HIT_R = 16;
  const dragRef = useRef({ type: null }); // 'probe' | 'charge' | null
  const getMousePos = (evt) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };
  const getTouchPos = (touch) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pick = (x, y) => {
      if (Math.hypot(x - charge.x, y - charge.y) <= HIT_R) return "charge";
      if (Math.hypot(x - probe.x,  y - probe.y ) <= HIT_R) return "probe";
      return null;
    };

    // Mouse
    const down = (e) => { const p = getMousePos(e); dragRef.current.type = pick(p.x, p.y); };
    const move = (e) => {
      const t = dragRef.current.type; if (!t) return;
      const p = snapPoint(getMousePos(e));
      if (t === "charge") setCharge(p);
      else if (t === "probe") setProbe(p);
    };
    const up = () => { dragRef.current.type = null; };

    // Touch
    const tdown = (e) => {
      if (e.touches.length === 0) return;
      const p = snapPoint(getTouchPos(e.touches[0]));
      dragRef.current.type = pick(p.x, p.y);
      e.preventDefault();
    };
    const tmove = (e) => {
      const t = dragRef.current.type; if (!t || e.touches.length === 0) return;
      const p = snapPoint(getTouchPos(e.touches[0]));
      if (t === "charge") setCharge(p);
      else if (t === "probe") setProbe(p);
      e.preventDefault();
    };
    const tup = () => { dragRef.current.type = null; };

    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", up);
    canvas.addEventListener("mouseleave", up);

    canvas.addEventListener("touchstart", tdown, { passive: false });
    canvas.addEventListener("touchmove",  tmove, { passive: false });
    canvas.addEventListener("touchend",   tup);
    canvas.addEventListener("touchcancel",tup);

    return () => {
      canvas.removeEventListener("mousedown", down);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup", up);
      canvas.removeEventListener("mouseleave", up);
      canvas.removeEventListener("touchstart", tdown);
      canvas.removeEventListener("touchmove",  tmove);
      canvas.removeEventListener("touchend",   tup);
      canvas.removeEventListener("touchcancel",tup);
    };
  }, [charge, probe, size, snap]);

  // --- Geometry / physics helpers ---
  const vecAndUnit = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const r  = Math.hypot(dx, dy);
    const ux = r > 1e-9 ? dx / r : 0;
    const uy = r > 1e-9 ? dy / r : 0;
    return { dx, dy, r, ux, uy };
  };
  const v = vecAndUnit(charge, probe);

  const fieldAt = (vec, qC) => {
    const r_um = vec.r * PIXEL_TO_MICROMETER;
    const r_m  = Math.max(r_um * UM_TO_M, soft_m);
    const Emag = k * Math.abs(qC) / (r_m * r_m);
    // Direction along r-hat; include sign via q
    return { Ex: Emag * vec.ux * Math.sign(qC), Ey: Emag * vec.uy * Math.sign(qC), Emag };
  };
  const E = fieldAt(v, q);

  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), []);

  // --- Drawing ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.width * dpr), H = Math.round(size.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const c = themeColors();
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, size.width, size.height);

    // Grid (fixed to canvas center)
    const origin = getOrigin();
    const crisp = (v) => Math.round(v) + 0.5; // crisp 1px lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.grid;
    for (let x = origin.x; x < size.width; x += gridStepPx) { ctx.beginPath(); ctx.moveTo(crisp(x), 0); ctx.lineTo(crisp(x), size.height); ctx.stroke(); }
    for (let x = origin.x - gridStepPx; x >= 0; x -= gridStepPx) { ctx.beginPath(); ctx.moveTo(crisp(x), 0); ctx.lineTo(crisp(x), size.height); ctx.stroke(); }
    for (let y = origin.y; y < size.height; y += gridStepPx) { ctx.beginPath(); ctx.moveTo(0, crisp(y)); ctx.lineTo(size.width, crisp(y)); ctx.stroke(); }
    for (let y = origin.y - gridStepPx; y >= 0; y -= gridStepPx) { ctx.beginPath(); ctx.moveTo(0, crisp(y)); ctx.lineTo(size.width, crisp(y)); ctx.stroke(); }

    // Charge
    const drawCharge = (p, qC) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = qC >= 0 ? c.positive : c.negative;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.text;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(qC >= 0 ? "+" : "−", p.x, p.y);
    };
    drawCharge(charge, q);

    // r vector (dashed)
    ctx.beginPath();
    ctx.moveTo(charge.x, charge.y);
    ctx.lineTo(probe.x, probe.y);
    ctx.strokeStyle = c.muted;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);

    // r-hat (purple) — fixed length from source
    const RhatLen = 60;
    const rhx_screen = v.ux; // unit already
    const rhy_screen = v.uy;
    const rx = charge.x + RhatLen * rhx_screen;
    const ry = charge.y + RhatLen * rhy_screen;
    drawArrow(ctx, charge.x, charge.y, rx, ry, "#7e57c2", 3);
    drawLabel(ctx, "r̂", rx, ry, rhx_screen, rhy_screen, "#7e57c2", 16);

    // E arrow at probe — length ~ |E| (capped)
    const Em = Math.hypot(E.Ex, E.Ey);
    const EL = Math.min(E_LEN_MAX, Em * E_PIXELS_PER_SI);
    const ux = Em > 0 ? E.Ex / Em : 0;
    const uy = Em > 0 ? E.Ey / Em : 0;
    const eEnd = { x: probe.x + EL * ux, y: probe.y + EL * uy };

    drawArrow(ctx, probe.x, probe.y, eEnd.x, eEnd.y, "#fb8c00", 3.25);
    drawLabel(ctx, "E", eEnd.x, eEnd.y, E.Ex, E.Ey, "#fb8c00", 16);

    // Probe handle
    ctx.beginPath();
    ctx.arc(probe.x, probe.y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = c.probe;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.text;
    ctx.stroke();
  }, [size, charge, probe, q, E, themeTick]);

  // ---------- Readout (display with y-up) ----------
  const r_disp = { x: (probe.x - charge.x), y: -(probe.y - charge.y) };
  const r_mag  = Math.hypot(r_disp.x, r_disp.y);
  const rhat   = r_mag > 0 ? { x: r_disp.x / r_mag, y: r_disp.y / r_mag } : { x: 0, y: 0 };
  const phys = {
    r: r_disp,
    rhat,
    E: { x: E.Ex, y: -E.Ey },
    mags: {
      r:  r_mag,
      E:  Math.hypot(E.Ex, E.Ey),
    }
  };

  return (
    <div style={{ textAlign: "center", color: "var(--text-primary)" }}>
      <div style={{ marginBottom: 8, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
        <label>
          q (nC):{" "}
          <input
            type="range"
            min={-10} max={10} step={0.1}
            value={qNanoC}
            onChange={(e) => setQNanoC(+e.target.value)}
          />{" "}
          <span style={{ display: "inline-block", minWidth: 56, textAlign: "left" }}>
            {qNanoC.toFixed(1)}
          </span>
        </label>
        <label style={{ userSelect: "none" }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          {" "}Snap to grid
        </label>
      </div>

      {/* Centered, fluid canvas */}
      <canvas
        ref={canvasRef}
        style={{
          border: "1px solid var(--grid-line)",
          borderRadius: 12,
          maxWidth: "100%",
          height: "auto",
          display: "block",
          marginInline: "auto",
          cursor: "pointer"
        }}
      />

      {/* Info panel (responsive 2-column grid like the two-charge sim) */}
      <div
        style={{
          marginTop: 8,
          width: "100%",
          textAlign: "left",
          fontFamily: "system-ui, sans-serif",
          fontSize: 16,
          background: "var(--surface-elevated)",
          border: "1px solid var(--grid-line)",
          borderRadius: 8,
          padding: "8px 12px",
          color: "var(--text-primary)",
          maxWidth: 820,
          marginInline: "auto"
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            alignItems: "start"
          }}
        >
          {/* Geometry */}
          <section>
            <div style={{ fontWeight: 600, marginBottom: 6, marginLeft:0 }}>Geometry</div>
            <div>r = <VecFixed x={phys.r.x} y={phys.r.y} decimals={0} /> µm</div>
            <div>|r| = <Fixed value={phys.mags.r} decimals={0} /> µm</div>
            <div style={{ marginTop: 6 }}>
              r̂ = <VecFixed x={phys.rhat.x} y={phys.rhat.y} decimals={2} />
            </div>
          </section>

          {/* Field */}
          <section>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Field</div>
            <div>E = <VecSci2 vec={phys.E} /> N/C</div>
            <div>|E| = <Sci2 value={phys.mags.E} /> N/C</div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------- Canvas helpers ----------
function drawArrow(ctx, x1, y1, x2, y2, color = "#000", width = 2) {
  const head = 15;
  const dx = x2 - x1, dy = y2 - y1;
  const ang = Math.atan2(dy, dx);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2 + 5 * Math.cos(ang), y2 + 5 * Math.sin(ang));
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawLabel(ctx, text, x, y, dx, dy, color, fontPx = 15) {
  const mag = Math.hypot(dx, dy) || 1;
  const offx = -(dy / mag) * 16;
  const offy = (dx / mag) * 16;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + offx, y + offy);
  ctx.restore();
}

// ---------- Consistent numeric typography helpers ----------
const MONO_NUM_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontVariantNumeric: 'tabular-nums' // stable digit widths
};

function SignedFixed({ value, decimals = 0 }) {
  const sign = value < 0 ? '−' : '+'; // U+2212 minus
  const mant = Math.abs(value).toFixed(decimals);
  return (
    <span style={MONO_NUM_STYLE}>
      <span style={{ display: 'inline-block', width: '0.8em', textAlign: 'right' }}>{sign}</span>
      {mant}
    </span>
  );
}

function Fixed({ value, decimals = 0 }) {
  return <span style={MONO_NUM_STYLE}>{Math.abs(value).toFixed(decimals)}</span>;
}

function VecFixed({ x, y, decimals = 0 }) {
  return (
    <span style={MONO_NUM_STYLE}>
      ⟨<SignedFixed value={x} decimals={decimals} />, <SignedFixed value={y} decimals={decimals} />⟩
    </span>
  );
}

function Sci2({ value }) {
  if (!isFinite(value) || value === 0) return <span style={MONO_NUM_STYLE}>0</span>;
  const exp = Math.floor(Math.log10(Math.abs(value)));
  const mant = value / Math.pow(10, exp);
  const mantStr = mant.toFixed(2);
  return (
    <span style={MONO_NUM_STYLE}>
      {mantStr} × 10<sup>{exp}</sup>
    </span>
  );
}

function VecSci2({ vec }) {
  const ax = Math.abs(vec.x);
  const ay = Math.abs(vec.y);
  if (!isFinite(ax + ay) || (ax === 0 && ay === 0)) {
    return <span style={MONO_NUM_STYLE}>⟨0.00, 0.00⟩</span>;
  }
  const maxv = Math.max(ax, ay);
  const exp = Math.floor(Math.log10(maxv));
  const scale = Math.pow(10, exp);
  const mx = (vec.x / scale).toFixed(2);
  const my = (vec.y / scale).toFixed(2);
  return (
    <span style={MONO_NUM_STYLE}>
      ⟨<SignedFixed value={parseFloat(mx)} decimals={2} />, <SignedFixed value={parseFloat(my)} decimals={2} />⟩
      {" "}× 10<sup>{exp}</sup>
    </span>
  );
}
