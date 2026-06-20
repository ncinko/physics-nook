import React, { useEffect, useMemo, useRef, useState } from "react";
import { themeColors, onThemeChange } from "../shared/themeColors";

/**
 * ScalarPotential2D (v3)
 * ------------------------------------------------------------
 * Visualizes a scalar field V(x, y) as a color map on a canvas.
 * Default field: electric potential of a single positive point charge: V = k q / r.
 *
 * Changes in v3 per request:
 *  - Half-size L is FIXED at its default (3.0 m). No UI to change it.
 *  - Grid step is FIXED at its default (0.25 m). No UI to change it.
 *  - Mapping is FIXED to logarithmic.
 *  - Color scale is FIXED to the 1 µC case, so changing q visibly brightens/darkens
 *    the map (the normalization no longer tracks q).
 */
export default function ScalarPotential2D() {
  // --------------------------- Physics params ---------------------------
  const k = 8.9875517923e9; // 1/(4πɛ0) in SI
  const [qMicroC, setQMicroC] = useState(3.0); // microcoulombs (positive)

  // Fixed domain and grid
  const L = 3.0;            // half-span of the square view (meters); domain = [-L, L] × [-L, L]
  const GRID_STEP = 0.25;   // meters
  const mapping = "log";    // fixed

  // Render perf
  const [quality, setQuality] = useState(0.6); // render scale (0.5 .. 1), default low for speed

  // Toggles
  const [snap, setSnap] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  // --------------------------- State & refs ---------------------------
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const legendRef = useRef(null);
  const rafRef = useRef(0);
  const renderingRef = useRef(false);

  // Charge position in world units (meters). Start centered.
  const [charge, setCharge] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);

  // Cursor readout state
  const [readout, setReadout] = useState({ x: 0, y: 0, r: 0, V: 0 });

  // Derived quantities
  const q = useMemo(() => qMicroC * 1e-6, [qMicroC]); // C

  // --------------------------- Coordinate transforms ---------------------------
  const buildTransforms = (w, h) => {
    // keep square aspect (use min of w,h for plot; center inside canvas if needed)
    const plotSize = Math.min(w, h);
    const x0 = Math.floor((w - plotSize) / 2);
    const y0 = Math.floor((h - plotSize) / 2);
    const scale = plotSize / (2 * L); // pixels per meter
    return {
      wx2px: (x) => x0 + (x + L) * scale,
      wy2py: (y) => y0 + (L - y) * scale,
      px2wx: (px) => (px - x0) / scale - L,
      py2wy: (py) => L - (py - y0) / scale,
      plotSize, x0, y0, scale,
    };
  };

  // --------------------------- Rendering ---------------------------
  const requestRender = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  };

  useEffect(() => {
    const ob = new ResizeObserver(() => requestRender());
    if (wrapRef.current) ob.observe(wrapRef.current);
    requestRender();
    return () => { ob.disconnect(); cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, quality, charge.x, charge.y, snap, showContours, themeTick]);

  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), []);

  function render() {
    if (renderingRef.current) return; // drop frame if still computing
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(640, Math.min(800, wrap.clientWidth)); // within typical text column
    const cssH = Math.round(cssW * 0.8);
    const w = Math.round(cssW * dpr * quality);
    const h = Math.round(cssH * dpr * quality);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    }

    const ctx = canvas.getContext("2d");
    const palette = themeColors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { wx2px, wy2py, px2wx, py2wy, plotSize, x0, y0, scale } = buildTransforms(canvas.width, canvas.height);

    // Fixed normalization based on 1 µC
    const eps = 0.02 * L;             // singularity softening (meters)
    const qRef = 1e-6;                // 1 microcoulomb in C
    const VmaxRef = k * Math.abs(qRef) / eps; // upper clip for color scale (fixed)

    // Prepare color-mapped image
    const img = ctx.createImageData(canvas.width, canvas.height);
    const data = img.data;
    renderingRef.current = true;

    // Prebuild color lookup (0..255)
    const LUT = buildSequentialLUT(); // high = bright/white-yellow, low = deep blue

    // Log mapping parameter uses VmaxRef to keep contrast stable
    const a = 1 / Math.max(1, VmaxRef * 0.1);
    const den = Math.log(1 + a * VmaxRef);

    // Iterate pixels
    let idx = 0;
    for (let py = 0; py < canvas.height; py++) {
      const y = py2wy(py + 0.5);
      for (let px = 0; px < canvas.width; px++) {
        const x = px2wx(px + 0.5);
        const dx = x - charge.x;
        const dy = y - charge.y;
        const r = Math.hypot(dx, dy);
        const V = k * q / Math.max(eps, r);

        // fixed-log mapping (0..VmaxRef → 0..1)
        const t = den > 0 ? clamp01(Math.log(1 + a * Math.max(0, V)) / den) : 0;
        const c = LUT[(t * 255) | 0];
        data[idx++] = c[0]; data[idx++] = c[1]; data[idx++] = c[2]; data[idx++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Optional: grid for snapping (draw over plot only)
    if (snap) {
      ctx.save();
      ctx.strokeStyle = "rgba(17,24,39,0.12)"; // slate-900 at low alpha
      ctx.lineWidth = 1;
      for (let gx = -L; gx <= L + 1e-9; gx += GRID_STEP) {
        const px = Math.round(wx2px(gx)) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y0 + plotSize); ctx.stroke();
      }
      for (let gy = -L; gy <= L + 1e-9; gy += GRID_STEP) {
        const py = Math.round(wy2py(gy)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x0 + plotSize, py); ctx.stroke();
      }
      ctx.restore();
    }

    // Equipotential lines (analytical circles) based on fixed legend levels
    if (showContours && q !== 0) {
      const levelsT = linspace(0.15, 0.95, 9); // 9 levels in fixed legend space
      ctx.save();
      ctx.strokeStyle = "rgba(17,24,39,0.55)"; // dark gray
      ctx.lineWidth = 1.25;
      for (const t of levelsT) {
        const Vlev = invLogMap(t, VmaxRef); // *fixed* V levels per legend
        if (Vlev <= 0) continue;
        const rMeters = (k * Math.abs(q)) / Vlev; // r = kq / V (depends on current q)
        if (!isFinite(rMeters) || rMeters <= 0) continue;
        const rp = rMeters * scale; // pixels
        const cx = wx2px(charge.x);
        const cy = wy2py(charge.y);
        if (rp < 0.5) continue;
        ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    // Frame, axes, charge marker
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = palette.text; ctx.lineWidth = Math.max(1, 1 * (window.devicePixelRatio || 1));
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, plotSize - 1, plotSize - 1);
    ctx.strokeStyle = palette.muted; ctx.lineWidth = 1;
    if (-L <= 0 && 0 <= L) {
      const yAxisY = wy2py(0); ctx.beginPath(); ctx.moveTo(x0, yAxisY + 0.5); ctx.lineTo(x0 + plotSize, yAxisY + 0.5); ctx.stroke();
      const xAxisX = wx2px(0); ctx.beginPath(); ctx.moveTo(xAxisX + 0.5, y0); ctx.lineTo(xAxisX + 0.5, y0 + plotSize); ctx.stroke();
    }
    const cxp = wx2px(charge.x), cyp = wy2py(charge.y);
    ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(cxp, cyp, 6 * (window.devicePixelRatio || 1), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b91c1c"; ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui, -apple-system, Segoe UI, Roboto`; ctx.textAlign = "center"; ctx.fillText("+q", cxp, cyp - 10 * (window.devicePixelRatio || 1));
    ctx.restore();

    // Legend (fixed to 1 µC)
    drawLegend(legendRef.current, VmaxRef, LUT);

    renderingRef.current = false;
  }

  // --------------------------- Legend ---------------------------
  function drawLegend(canvas, VmaxRef, LUT) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = 260, cssH = 68;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const grad = ctx.createLinearGradient(12, 20, cssW - 12, 20);
    for (let i = 0; i <= 255; i++) {
      const c = LUT[i]; grad.addColorStop(i / 255, `rgb(${c[0]},${c[1]},${c[2]})`);
    }
    const palette = themeColors();
    ctx.fillStyle = grad; ctx.fillRect(12, 12, cssW - 24, 16);
    ctx.strokeStyle = palette.text; ctx.strokeRect(12 + 0.5, 12 + 0.5, cssW - 24 - 1, 16 - 1);

    ctx.fillStyle = palette.text; ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto"; ctx.textAlign = "center";
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const x = 12 + t * (cssW - 24);
      ctx.beginPath(); ctx.moveTo(x + 0.5, 28); ctx.lineTo(x + 0.5, 32); ctx.stroke();
      const labelV = invLogMap(t, VmaxRef);
      ctx.fillText(formatSI(labelV, "V"), x, 54);
    }
  }

  function invLogMap(t, VmaxRef) {
    const a = 1 / Math.max(1, VmaxRef * 0.1);
    const num = Math.exp(t * Math.log(1 + a * VmaxRef)) - 1;
    return num / a;
  }

  // --------------------------- Interaction ---------------------------
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;

    const handleDown = (e) => { dragging.current = true; moveCharge(e); };
    const handleMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      readoutAt(px, py);
      if (dragging.current) moveCharge(e);
    };
    const handleUp = () => { dragging.current = false; };

    canvas.addEventListener("mousedown", handleDown);
    canvas.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    const touchToMouse = (handler) => (evt) => { if (!evt.touches?.length) return; const t = evt.touches[0]; handler({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => evt.preventDefault() }); };
    canvas.addEventListener("touchstart", touchToMouse(handleDown), { passive: false });
    canvas.addEventListener("touchmove", touchToMouse(handleMove), { passive: false });
    window.addEventListener("touchend", handleUp);

    return () => {
      canvas.removeEventListener("mousedown", handleDown);
      canvas.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      canvas.removeEventListener("touchstart", touchToMouse(handleDown));
      canvas.removeEventListener("touchmove", touchToMouse(handleMove));
      window.removeEventListener("touchend", handleUp);
    };
  }, [q, snap, showContours]);

  function snapIf(x) { return snap ? Math.round(x / GRID_STEP) * GRID_STEP : x; }

  function readoutAt(px, py) {
    const canvas = canvasRef.current; if (!canvas) return;
    const { px2wx, py2wy } = buildTransforms(canvas.width, canvas.height);
    const xRaw = px2wx(px), yRaw = py2wy(py);
    const x = snapIf(xRaw), y = snapIf(yRaw);
    const dx = x - charge.x, dy = y - charge.y;
    const r = Math.hypot(dx, dy);
    const eps = 0.02 * L; const V = k * q / Math.max(eps, r);
    setReadout({ x, y, r, V });
  }

  function moveCharge(e) {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { px2wx, py2wy } = buildTransforms(canvas.width, canvas.height);
    let x = clamp(px2wx(px), -L, L);
    let y = clamp(py2wy(py), -L, L);
    x = snapIf(x); y = snapIf(y);
    setCharge({ x, y });
  }

  // --------------------------- Render helpers ---------------------------
  function buildSequentialLUT() {
    // 256-color sequential gradient: deep blue → teal → yellow → white
    const stops = [
      { t: 0.0, c: [12, 18, 45] },     // deep blue
      { t: 0.25, c: [25, 98, 184] },   // blue
      { t: 0.50, c: [0, 178, 169] },   // teal
      { t: 0.75, c: [255, 196, 37] },  // yellow
      { t: 1.0, c: [255, 255, 255] },  // white
    ];
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s].t && t <= stops[s + 1].t) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const u = (t - a.t) / (b.t - a.t);
      lut[i] = [
        Math.round(lerp(a.c[0], b.c[0], u)),
        Math.round(lerp(a.c[1], b.c[1], u)),
        Math.round(lerp(a.c[2], b.c[2], u)),
      ];
    }
    return lut;
  }

  function linspace(a, b, n) { const arr = []; if (n <= 1) return [a]; const step = (b - a) / (n - 1); for (let i = 0; i < n; i++) arr.push(a + i * step); return arr; }

  // Formatting helpers
  const fmt = { num: (x) => x.toFixed(3).replace(/\.000$/, ".0"), si: (x, unit) => formatSI(x, unit) };

  // --------------------------- JSX ---------------------------
  return (
    <div className="sp2d" style={{ width: "100%", color: "var(--text-primary)" }}>

      {/* Controls */}
      <div className="control-panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          q (µC): {qMicroC.toFixed(2)}
          <input type="range" min={0.1} max={5} step={0.05} value={qMicroC} onChange={(e) => setQMicroC(parseFloat(e.target.value))} />
        </label>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} /> Show equipotential lines
        </label>
        <button className="btn btn-secondary" onClick={() => { setCharge({ x: 0, y: 0 }); }}>Reset charge</button>
      </div>

      {/* Layout: canvas + legend/readout */}
      <div className="sp2d-grid" ref={wrapRef} style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, alignItems: "start" }}>
        <div className="sp2d-canvaswrap" style={{ position: "relative" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "auto", borderRadius: 8, border: "1px solid var(--grid-line)", background: "var(--sim-bg)", cursor: "crosshair" }} />
          <div style={{ position: "absolute", left: 8, bottom: 8, padding: "6px 8px", background: "var(--surface-elevated)", color: "var(--text-primary)", border: "1px solid var(--grid-line)", borderRadius: 6, fontSize: 12, lineHeight: 1.4 }}>
            <div><strong>x</strong> = {fmt.num(readout.x)} m, <strong>y</strong> = {fmt.num(readout.y)} m</div>
            <div><strong>r</strong> = {fmt.num(readout.r)} m</div>
            <div><strong>V</strong> = {fmt.si(readout.V, "V")} <span style={{opacity:0.75}}></span></div>
            <div style={{ opacity: 0.8 }}>{snap ? "Snapping on — 0.25 m grid" : "(Drag the red +q to move)"}</div>
          </div>
        </div>
        <div className="sp2d-side" style={{ padding: 8, border: "1px solid var(--grid-line)", borderRadius: 10, background: "var(--surface-elevated)" }}>
          <h4 style={{ margin: "4px 0 8px", color: "var(--text-primary)" }}></h4>
          <canvas ref={legendRef} style={{ display: "block", marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
            <p style={{ margin: 0 }}>Color encodes potential <em>V(x,y)</em> of a positive point charge. Brighter colors mean higher potential. Potential decreases with distance: <em>V ∝ 1/r</em>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------- Utils ---------------------------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function formatSI(value, unit = "") {
  if (!isFinite(value)) return `— ${unit}`.trim();
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  const prefixes = [
    { p: 1e9, s: "G" }, { p: 1e6, s: "M" }, { p: 1e3, s: "k" }, { p: 1, s: "" }, { p: 1e-3, s: "m" }, { p: 1e-6, s: "µ" }, { p: 1e-9, s: "n" },
  ];
  for (const { p, s } of prefixes) {
    if (v >= p) return `${sign}${(v / p).toFixed(v / p >= 100 ? 0 : v / p >= 10 ? 1 : 2)} ${s}${unit}`.trim();
  }
  return `${sign}${(v / 1e-12).toFixed(2)} p${unit}`; // pico fallback
}
