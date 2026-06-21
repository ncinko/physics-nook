import React, { useRef, useEffect, useState } from "react";
import { themeColors, onThemeChange } from "../shared/themeColors";
import { ControlBar, Slider, Toggle } from "../shared/InlineControls";
import { Readout } from "../shared/Readout";

export default function TwoChargeSuperposition() {
  const canvasRef = useRef(null);

  // --- Responsive sizing using parent container ---
  const ASPECT = 0.55; // height = aspect * width
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const computeSize = () => {
    const parent = canvasRef.current?.parentElement;
    const parentWidth = parent
      ? parent.getBoundingClientRect().width
      : window.innerWidth - 48;
    const w = clamp(parentWidth, 320, 900);
    return { width: Math.round(w), height: Math.round(w * ASPECT) };
  };

  const [size, setSize] = useState(computeSize());

  useEffect(() => {
    const update = () => setSize(computeSize());
    update();
    const parent = canvasRef.current?.parentElement;
    let ro;
    if (parent && "ResizeObserver" in window) {
      ro = new ResizeObserver(update);
      ro.observe(parent);
    }
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (ro) ro.disconnect();
    };
  }, []);

  // --- Units / constants ---
  const PIXEL_TO_MICROMETER = 1;
  const UM_TO_M = 1e-6;
  const GRID_SPACING_UM = 50;
  const k = 9e9;

  const E_PIXELS_PER_SI = 6.5e-8;
  const E_LEN_MAX = 260;

  // --- Charges (nC) ---
  const [q1NanoC, setQ1NanoC] = useState(5.0);
  const [q2NanoC, setQ2NanoC] = useState(-5.0);
  const q1 = q1NanoC * 1e-9;
  const q2 = q2NanoC * 1e-9;

  // Positions (draggable)
  const [charge1, setCharge1] = useState({
    x: size.width * 0.35,
    y: size.height * 0.55,
  });
  const [charge2, setCharge2] = useState({
    x: size.width * 0.65,
    y: size.height * 0.55,
  });
  const [probe, setProbe] = useState({
    x: size.width * 0.5,
    y: size.height * 0.3,
  });

  // Snap toggle
  const [snap, setSnap] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  const getOrigin = () => ({
    x: Math.round(size.width / 2),
    y: Math.round(size.height / 2),
  });
  const gridStepPx = GRID_SPACING_UM / PIXEL_TO_MICROMETER;

  const snapPoint = (p) => {
    if (!snap)
      return {
        x: Math.max(0, Math.min(size.width, p.x)),
        y: Math.max(0, Math.min(size.height, p.y)),
      };
    const { x: ox, y: oy } = getOrigin();
    const ix = Math.round((p.x - ox) / gridStepPx);
    const iy = Math.round((p.y - oy) / gridStepPx);
    const ixMin = Math.ceil((0 - ox) / gridStepPx);
    const ixMax = Math.floor((size.width - ox) / gridStepPx);
    const iyMin = Math.ceil((0 - oy) / gridStepPx);
    const iyMax = Math.floor((size.height - oy) / gridStepPx);
    const clampedIx = Math.max(ixMin, Math.min(ixMax, ix));
    const clampedIy = Math.max(iyMin, Math.min(iyMax, iy));
    return { x: ox + clampedIx * gridStepPx, y: oy + clampedIy * gridStepPx };
  };

  // Keep layout responsive
  const prevSize = useRef(size);
  useEffect(() => {
    const sx = size.width / prevSize.current.width;
    const sy = size.height / prevSize.current.height;
    setCharge1((p) => ({ x: p.x * sx, y: p.y * sy }));
    setCharge2((p) => ({ x: p.x * sx, y: p.y * sy }));
    setProbe((p) => ({ x: p.x * sx, y: p.y * sy }));
    prevSize.current = size;
  }, [size]);
  useEffect(() => {
    if (snap) {
      setCharge1((p) => snapPoint(p));
      setCharge2((p) => snapPoint(p));
      setProbe((p) => snapPoint(p));
    }
  }, [snap, size.width, size.height]);

  // --- Drag state ---
  const HIT_R = 16;
  const dragRef = useRef({ type: null });

  const getMousePos = (evt) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };
  const getTouchPos = (touch) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  // --- Geometry helper ---
  function vecAndUnit(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const r = Math.hypot(dx, dy);
    return { dx, dy, r, ux: r > 1e-9 ? dx / r : 0, uy: r > 1e-9 ? dy / r : 0 };
  }

  const v1 = vecAndUnit(charge1, probe);
  const v2 = vecAndUnit(charge2, probe);

  // --- Physics ---
  const soft_um = 5;
  const soft_m = soft_um * UM_TO_M;

  function fieldAt(vec, qC) {
    const r_um = vec.r * PIXEL_TO_MICROMETER;
    const r_m = Math.max(r_um * UM_TO_M, soft_m);
    const Emag = k * Math.abs(qC) / (r_m * r_m);
    return {
      Ex: Emag * vec.ux * Math.sign(qC),
      Ey: Emag * vec.uy * Math.sign(qC),
      Emag,
    };
  }

  const E1 = fieldAt(v1, q1);
  const E2 = fieldAt(v2, q2);
  const Esum = { Ex: E1.Ex + E2.Ex, Ey: E1.Ey + E2.Ey };

  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), []);

// --- Drawing ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.width * dpr),
      H = Math.round(size.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const c = themeColors();
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, size.width, size.height);

    // Grid anchored to canvas center (fixed, doesn’t slide)
    const origin = getOrigin();
    const snapPx = (v) => Math.round(v) + 0.5; // crisp 1px lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.grid;
    for (let x = origin.x; x < size.width; x += gridStepPx) { ctx.beginPath(); ctx.moveTo(snapPx(x), 0); ctx.lineTo(snapPx(x), size.height); ctx.stroke(); }
    for (let x = origin.x - gridStepPx; x >= 0; x -= gridStepPx) { ctx.beginPath(); ctx.moveTo(snapPx(x), 0); ctx.lineTo(snapPx(x), size.height); ctx.stroke(); }
    for (let y = origin.y; y < size.height; y += gridStepPx) { ctx.beginPath(); ctx.moveTo(0, snapPx(y)); ctx.lineTo(size.width, snapPx(y)); ctx.stroke(); }
    for (let y = origin.y - gridStepPx; y >= 0; y -= gridStepPx) { ctx.beginPath(); ctx.moveTo(0, snapPx(y)); ctx.lineTo(size.width, snapPx(y)); ctx.stroke(); }

    // Charges
    function drawCharge(p, q) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = q >= 0 ? c.positive : c.negative;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.text;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(q >= 0 ? "+" : "−", p.x, p.y);
    }
    drawCharge(charge1, q1);
    drawCharge(charge2, q2);

    // r vectors (dashed gray) from each charge to probe
    function dashedR(from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(probe.x, probe.y);
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    dashedR(charge1);
    dashedR(charge2);

    // Arrows
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
      ctx.fillStyle = color;
      ctx.font = `${fontPx}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + offx, y + offy);
    }
    function arrowEnd(Evec) {
      const Em = Math.hypot(Evec.Ex, Evec.Ey);
      const EL = Math.min(E_PIXELS_PER_SI * Em, E_LEN_MAX);
      const ux = Em > 0 ? Evec.Ex / Em : 0;
      const uy = Em > 0 ? Evec.Ey / Em : 0;
      return { x: probe.x + EL * ux, y: probe.y + EL * uy };
    }

    // Constituents (faint) + net (orange)
    const e1End = arrowEnd(E1);
    drawArrow(ctx, probe.x, probe.y, e1End.x, e1End.y, c.muted, 3);
    drawLabel(ctx, "E₁", e1End.x, e1End.y, E1.Ex, E1.Ey, c.muted, 15);

    const e2End = arrowEnd(E2);
    drawArrow(ctx, probe.x, probe.y, e2End.x, e2End.y, c.muted, 3);
    drawLabel(ctx, "E₂", e2End.x, e2End.y, E2.Ex, E2.Ey, c.muted, 15);

    const eSumEnd = arrowEnd(Esum);
    drawArrow(ctx, probe.x, probe.y, eSumEnd.x, eSumEnd.y, "#fb8c00", 3.25);
    drawLabel(ctx, "E", eSumEnd.x, eSumEnd.y, Esum.Ex, Esum.Ey, "#fb8c00", 16);

    // Probe handle
    ctx.beginPath();
    ctx.arc(probe.x, probe.y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = c.probe;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.text;
    ctx.stroke();
  }, [size, q1, q2, charge1, charge2, probe, themeTick]);

  // --- Events (mouse + touch) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pickTarget = (x, y) => {
      if (Math.hypot(x - charge1.x, y - charge1.y) <= HIT_R) return "c1";
      if (Math.hypot(x - charge2.x, y - charge2.y) <= HIT_R) return "c2";
      if (Math.hypot(x - probe.x,   y - probe.y)   <= HIT_R) return "probe";
      return null;
    };

    const down = (e) => {
      const { x, y } = getMousePos(e);
      dragRef.current.type = pickTarget(x, y);
    };
    const move = (e) => {
      const t = dragRef.current.type;
      if (!t) return;
      const p = snapPoint(getMousePos(e));
      if (t === "c1") setCharge1(p);
      else if (t === "c2") setCharge2(p);
      else if (t === "probe") setProbe(p);
    };
    const up = () => { dragRef.current.type = null; };

    // Touch
    const tdown = (e) => {
      if (e.touches.length === 0) return;
      const p = snapPoint(getTouchPos(e.touches[0]));
      dragRef.current.type = pickTarget(p.x, p.y);
      e.preventDefault();
    };
    const tmove = (e) => {
      const t = dragRef.current.type;
      if (!t || e.touches.length === 0) return;
      const p = snapPoint(getTouchPos(e.touches[0]));
      if (t === "c1") setCharge1(p);
      else if (t === "c2") setCharge2(p);
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
  }, [charge1, charge2, probe, size, snap]); // include `snap` so move handler uses latest

  // ---------- Readout (y-up) ----------
  const phys = {
    r1: { x: (probe.x - charge1.x), y: -(probe.y - charge1.y) },
    r2: { x: (probe.x - charge2.x), y: -(probe.y - charge2.y) },
    E1: { x:  E1.Ex, y: -E1.Ey },
    E2: { x:  E2.Ex, y: -E2.Ey },
    Es: { x: Esum.Ex, y: -Esum.Ey },
    mags: {
      r1: Math.hypot(probe.x - charge1.x, probe.y - charge1.y),
      r2: Math.hypot(probe.x - charge2.x, probe.y - charge2.y),
      E1: Math.hypot(E1.Ex, E1.Ey),
      E2: Math.hypot(E2.Ex, E2.Ey),
      Es: Math.hypot(Esum.Ex, Esum.Ey),
    }
    
  };

  return (
    <div style={{ textAlign: "center", color: "var(--text-primary)" }}>
      <ControlBar className="mb-2">
        <Slider label="q₁" unit="nC" min={-10} max={10} step={0.1} value={q1NanoC} onChange={setQ1NanoC} format={(v) => v.toFixed(1)} />
        <Slider label="q₂" unit="nC" min={-10} max={10} step={0.1} value={q2NanoC} onChange={setQ2NanoC} format={(v) => v.toFixed(1)} />
        <Toggle label="Snap to grid" checked={snap} onChange={setSnap} />
      </ControlBar>

            <canvas
        ref={canvasRef}
        style={{
          border: "1px solid var(--grid-line)",
          borderRadius: 12,
          maxWidth: "100%",
          height: "auto",
          display: "block",
          marginInline: "auto",
          cursor: "pointer",
          touchAction: "none",
        }}
      />

      <p style={{ marginTop: 8, maxWidth: 800, marginInline: "auto" }}>
        Drag the charges and the{" "}
        <span style={{ color: "#22c55e" }}><b>probe point</b></span>. The {" "}
        <span style={{ color: "#fb8c00" }}><b>net field</b></span> is the tip-to-tail sum of the individual fields.
      </p>

      {/* Readout (grouped panel) */}
      <div className="mx-auto mt-2 max-w-[820px]">
        <Readout variant="panel">
          <Readout.Group label="Geometry">
            <Readout.Value label="r₁" value={<VecFixed x={phys.r1.x} y={phys.r1.y} decimals={0} />} unit="µm" />
            <Readout.Value label="|r₁|" value={<Fixed value={phys.mags.r1} decimals={0} />} unit="µm" />
            <Readout.Value label="r₂" value={<VecFixed x={phys.r2.x} y={phys.r2.y} decimals={0} />} unit="µm" />
            <Readout.Value label="|r₂|" value={<Fixed value={phys.mags.r2} decimals={0} />} unit="µm" />
          </Readout.Group>
          <Readout.Group label="Constituent Fields">
            <Readout.Value label="E₁" value={<VecSci2 vec={phys.E1} />} unit="N/C" />
            <Readout.Value label="|E₁|" value={<Sci2 value={phys.mags.E1} />} unit="N/C" />
            <Readout.Value label="E₂" value={<VecSci2 vec={phys.E2} />} unit="N/C" />
            <Readout.Value label="|E₂|" value={<Sci2 value={phys.mags.E2} />} unit="N/C" />
          </Readout.Group>
          <Readout.Group label="Net Field">
            <Readout.Value label="E" value={<VecSci2 vec={phys.Es} />} unit="N/C" />
            <Readout.Value label="|E|" value={<Sci2 value={phys.mags.Es} />} unit="N/C" />
          </Readout.Group>
        </Readout>
      </div>

    </div>
  );
}

// ---------- Utilities ----------
// ---------- Consistent numeric typography helpers ----------
const MONO_NUM_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontVariantNumeric: 'tabular-nums' // stable digit widths
};

// Fixed-width sign + fixed decimals (general-purpose for Geometry, r̂, etc.)
function SignedFixed({ value, decimals = 0 }) {
  const sign = value < 0 ? '−' : '+'; // U+2212 minus
  const mant = Math.abs(value).toFixed(decimals);
  return (
    <span style={MONO_NUM_STYLE}>
      <span style={{ display: 'inline-block', width: '1ch', textAlign: 'center' }}>
        {sign}
      </span>
      {mant}
    </span>
  );
}

// Unsigned fixed decimals (no +/−), still monospaced/tabular
function Fixed({ value, decimals = 0 }) {
  return (
    <span style={MONO_NUM_STYLE}>
      {Math.abs(value).toFixed(decimals)}
    </span>
  );
}


// Vector of SignedFixed (e.g., Geometry vectors)
function VecFixed({ x, y, decimals = 0 }) {
  return (
    <span style={MONO_NUM_STYLE}>
      ⟨<SignedFixed value={x} decimals={decimals} />,{' '}
       <SignedFixed value={y} decimals={decimals} />⟩
    </span>
  );
}

// Scientific notation (magnitude) with superscript, 2-decimal mantissas
function Sci2({ value }) {
  if (!isFinite(value) || value === 0) return <span style={MONO_NUM_STYLE}>0.00</span>;
  const e = Math.floor(Math.log10(Math.abs(value)));
  const m = value / Math.pow(10, e);
  return (
    <span style={MONO_NUM_STYLE}>
      {e !== 0 ? (
        <>
          {m.toFixed(2)} × 10<sup>{e}</sup>
        </>
      ) : (
        <>{value.toFixed(2)}</>
      )}
    </span>
  );
}

// Vector with shared exponent, superscript, fixed-width signs, 2-dec mantissas
function VecSci2({ vec }) {
  const ax = Math.abs(vec.x), ay = Math.abs(vec.y);
  const maxAbs = Math.max(ax, ay);
  if (!isFinite(maxAbs) || maxAbs === 0) {
    return (
      <span style={MONO_NUM_STYLE}>
        ⟨<span style={{ display:'inline-block', width:'1ch', textAlign:'center' }}>+</span>0.00,{' '}
          <span style={{ display:'inline-block', width:'1ch', textAlign:'center' }}>+</span>0.00⟩
      </span>
    );
  }
  const e = Math.floor(Math.log10(maxAbs));
  const s = Math.pow(10, e);
  const mx = vec.x / s, my = vec.y / s;
  return (
    <span style={MONO_NUM_STYLE}>
      ⟨<SignedFixed value={mx} decimals={2} />,{' '}
       <SignedFixed value={my} decimals={2} />⟩
      {e !== 0 ? <> × 10<sup>{e}</sup></> : null}
    </span>
  );
}
// ---------- End utilities ----------


