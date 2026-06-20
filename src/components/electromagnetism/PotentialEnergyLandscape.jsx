import React, { useEffect, useMemo, useRef, useState } from "react";
import { themeColors } from "../shared/themeColors";

/**
 * PotentialEnergyLandscape1D (layout + sync refinements v4 — Option B class isolation)
 * ------------------------------------------------------------
 * Full-bleed, no-gaps layout:
 *  • Uses a full-viewport-width wrapper to escape any page max-width constraints.
 *  • Computes pixel-precise column widths that exactly sum to the wrapper width
 *    (potential + motion + energy + gaps) — so there are no leftover gaps or scroll.
 *  • Uses a ResizeObserver on the wrapper to react to any layout change immediately.
 *  • Keeps the canvases wide and the axes long, while sharing a common height.
 */
export default function PotentialEnergyLandscape1D() {
  // --------------------------- UI state ---------------------------
  const [mode, setMode] = useState("quadratic"); // "quadratic" | "linear"
  const [paused, setPaused] = useState(false);

  // Physics parameters
  const [m, setM] = useState(2); // kg
  const [k, setK] = useState(12); // N/m (quadratic)
  const [g, setG] = useState(9.8); // m/s^2 (linear)
  const [damping, setDamping] = useState(0.05); // spring linear damping (N·s/m)
  const [restitution, setRestitution] = useState(0.90); // ground bounces (linear)

  // Generalized coordinate q and velocity v
  const qRef = useRef(0.3); // x or h
  const vRef = useRef(0);

  // Track initial total energy for a faint reference line
  const E0Ref = useRef(null);

  // Refs for canvases and wrappers
  const outerRef = useRef(null); // full-bleed wrapper
  const potWrapRef = useRef(null);
  const simWrapRef = useRef(null);
  const potRef = useRef(null); // potential plot canvas
  const simRef = useRef(null); // motion view canvas
  const rafRef = useRef(null);

  // Energy bar fills (DOM updates for smoothness)
  const uFillRef = useRef(null);
  const kFillRef = useRef(null);

  // Dragging state across both panels
  const dragging = useRef({ where: null }); // 'plot' | 'motion' | null

  // Plot domains/scales (logical units → meters; not pixels)
  const domain = useMemo(() => (mode === "quadratic" ? { qMin: -1.5, qMax: 1.5 } : { qMin: 0, qMax: 3.0 }), [mode]);

  // Shared panel height (in CSS px)
  const [sharedH, setSharedH] = useState(520);

  // Layout widths (in CSS px) computed to perfectly fill wrapper
  const [layout, setLayout] = useState({ potW: 900, simW: 700, barsW: 280, gap: 8 });

  // --------------- Helpers: Energies and acceleration ---------------
  const U = (q) => (mode === "quadratic" ? 0.5 * k * q * q : m * g * q);
  const K = (v) => 0.5 * m * v * v;
  const totalE = () => U(qRef.current) + K(vRef.current);

  const accel = (q, v) => (mode === "quadratic" ? -(k / m) * q - (damping / m) * v : -g);

  // --------------------------- Layout measurement ---------------------------
  useEffect(() => {
    if (!outerRef.current) return;

    const measure = () => {
      const outer = outerRef.current;
      if (!outer) return;
      const W = outer.clientWidth; // full-bleed width

      // Fixed energy column width; rest is for the two canvases
      const gap = 8;
      const barsW = 280;
      const available = Math.max(700, W - barsW - 2 * gap);

      // Target ratio between potential and motion panels
      const potWeight = 1.6; // emphasize potential
      const simWeight = 1.0;
      const totalWeight = potWeight + simWeight;
      let potW = Math.floor((available * potWeight) / totalWeight);
      let simW = available - potW; // exact fit (no leftover width)

      // Clamp minimums so they don't become "narrow"
      potW = Math.max(520, potW);
      simW = Math.max(460, simW);

      // If clamping pushed us wider than available, rescale together
      let sum = potW + simW;
      if (sum > available) {
        const scale = available / sum;
        potW = Math.floor(potW * scale);
        simW = available - potW;
      }

      // Shared height proportional to smaller width, within bounds
      const H = clamp(Math.round(Math.min(potW, simW) * 0.6), 420, 760);

      setLayout({ potW, simW, barsW, gap });

      // size canvases to CSS width/height with device pixel ratio
      const dpr = window.devicePixelRatio || 1;
      if (potRef.current) {
        potRef.current.width = Math.round(potW * dpr);
        potRef.current.height = Math.round(H * dpr);
        const ctx = potRef.current.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (simRef.current) {
        simRef.current.width = Math.round(simW * dpr);
        simRef.current.height = Math.round(H * dpr);
        const ctx = simRef.current.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      setSharedH(H);
      drawOnce(potW, simW, H);
    };

    // Initial measure and on any resize of the wrapper via ResizeObserver
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    ro.observe(outerRef.current);
    measure();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, k, g, damping, m]);

  // --------------------------- Mouse → q mapping ---------------------------
  function plotScale(potW, potH) {
    const margin = { L: 64, R: 20, T: 20, B: 48 };
    const innerW = potW - margin.L - margin.R;
    const innerH = potH - margin.T - margin.B;

    const qMin = domain.qMin;
    const qMax = domain.qMax;
    let Umax = mode === "quadratic" ? 0.5 * k * Math.max(qMin * qMin, qMax * qMax) : m * g * domain.qMax;
    if (E0Ref.current != null) {
      Umax = Math.max(Umax, E0Ref.current);
    }

    const qToX = (q) => margin.L + ((q - qMin) / (qMax - qMin)) * innerW;
    const UToY = (Uval) => margin.T + (1 - Math.min(Uval / (Umax || 1e-6), 1)) * innerH;

    return { margin, innerW, innerH, qToX, UToY, qMin, qMax, Umax };
  }

  const setQFromPlotPointer = (evt) => {
    const canvas = potRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const dpr = window.devicePixelRatio || 1;
    const xCSS = x / dpr;

    const { potW } = layout;
    const { qMin, qMax, margin, innerW } = plotScale(potW, sharedH);

    const xClamped = Math.max(margin.L, Math.min(potW - margin.R, xCSS));
    const q = qMin + ((xClamped - margin.L) / innerW) * (qMax - qMin);
    qRef.current = q;
    vRef.current = 0;
    E0Ref.current = totalE();
    drawOnce(layout.potW, layout.simW, sharedH);
  };

  const setQFromMotionPointer = (evt) => {
    const canvas = simRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);

    const dpr = window.devicePixelRatio || 1;
    const xCSS = px / dpr;
    const yCSS = py / dpr;

    const simW = layout.simW;
    const simH = sharedH;

    if (mode === "quadratic") {
      const leftWallX = 40;
      const rightPad = 40;
      const usable = simW - leftWallX - rightPad - 40;
      const pxPerM = usable / (domain.qMax - domain.qMin);
      const eqX = leftWallX + usable / 2;
      const xClamped = clamp(xCSS, leftWallX + 10, simW - rightPad - 10);
      const q = (xClamped - eqX) / pxPerM; // center as x=0
      qRef.current = clamp(q, domain.qMin, domain.qMax);
      vRef.current = 0;
    } else {
      const groundY = simH - 60;
      const usable = simH - 140;
      const pxPerM = usable / (domain.qMax - domain.qMin);
      const h = ((groundY - yCSS) / pxPerM) + domain.qMin;
      qRef.current = clamp(h, domain.qMin, domain.qMax);
      vRef.current = 0;
    }
    E0Ref.current = totalE();
    drawOnce(layout.potW, layout.simW, sharedH);
  };

  // --------------------------- Drawing ---------------------------
  function drawPotential(ctx, potW, potH) {
    const { margin, qToX, UToY, Umax } = plotScale(potW, potH);
    const palette = themeColors();

    ctx.clearRect(0, 0, potW, potH);

    // Background
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, potW, potH);

    // Axes
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(margin.L, potH - margin.B); // x/h axis
    ctx.lineTo(potW - margin.R, potH - margin.B);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(margin.L, potH - margin.B); // U axis
    ctx.lineTo(margin.L, margin.T);
    ctx.stroke();

    // Labels
    ctx.fillStyle = palette.text;
    ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    ctx.textAlign = "center";
    ctx.fillText(mode === "quadratic" ? "x" : "h", (potW + margin.L - margin.R) / 2, potH - 16);

    ctx.save();
    ctx.translate(18, (potH - margin.B + margin.T) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("U", 0, 0);
    ctx.restore();

    // Vertical gridlines
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    const tickCount = 7;
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const q = domain.qMin + t * (domain.qMax - domain.qMin);
      const x = qToX(q);
      ctx.beginPath();
      ctx.moveTo(x, potH - margin.B);
      ctx.lineTo(x, margin.T);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Potential curve
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 360;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const q = domain.qMin + t * (domain.qMax - domain.qMin);
      const y = UToY(U(q));
      const x = qToX(q);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Marker
    const q = clamp(qRef.current, domain.qMin, domain.qMax);
    const xM = qToX(q);
    const yM = UToY(U(q));
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xM, yM);
    ctx.lineTo(xM, potH - margin.B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(xM, yM, 7, 0, Math.PI * 2);
    ctx.fill();

    // Total energy reference (optional)
    if (E0Ref.current != null) {
      const Ey = UToY(E0Ref.current);
      ctx.strokeStyle = "#eab308";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(margin.L, Ey);
      ctx.lineTo(potW - margin.R, Ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = palette.text;
      ctx.textAlign = "left";
      ctx.fillText("E_total", margin.L + 8, Ey - 6);
    }
  }

  function drawMotion(ctx, simW, simH) {
    const palette = themeColors();
    ctx.clearRect(0, 0, simW, simH);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, simW, simH);

    if (mode === "quadratic") {
      const centerY = Math.round(simH / 2);
      const leftWallX = 40;
      const rightPad = 40;
      const usable = simW - leftWallX - rightPad - 40;
      const pxPerM = usable / (domain.qMax - domain.qMin);
      const eqX = leftWallX + usable / 2;

      const q = clamp(qRef.current, domain.qMin, domain.qMax);
      const bobX = eqX + q * pxPerM;

      // wall
      ctx.fillStyle = palette.grid;
      ctx.fillRect(leftWallX - 10, centerY - 60, 10, 120);

      // spring
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 2;
      const coils = 18;
      const springLeft = leftWallX;
      const springRight = bobX - 18;
      const seg = (springRight - springLeft) / coils;
      ctx.beginPath();
      ctx.moveTo(springLeft, centerY);
      for (let i = 1; i < coils; i++) {
        const x = springLeft + i * seg;
        ctx.lineTo(x, centerY + (i % 2 === 0 ? -12 : 12));
      }
      ctx.lineTo(springRight, centerY);
      ctx.stroke();

      // mass
      const r = 18 * Math.sqrt(m);
      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(bobX, centerY, r, 0, Math.PI * 2);
      ctx.fill();

      // drag halo
      ctx.strokeStyle = "rgba(16,185,129,0.35)";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(bobX, centerY, r + 6, 0, Math.PI * 2);
      ctx.stroke();

      // label
      ctx.fillStyle = palette.muted;
      ctx.font = "600 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Drag the mass", bobX, centerY + r + 18);
    } else {
      const groundY = simH - 60;
      const usable = simH - 140;
      const pxPerM = usable / (domain.qMax - domain.qMin);
      const q = clamp(qRef.current, domain.qMin, domain.qMax);
      const ballX = Math.round(simW / 2);
      const ballY = groundY - (q - domain.qMin) * pxPerM;

      ctx.fillStyle = palette.grid;
      ctx.fillRect(24, groundY, simW - 48, 6);

      const r = 18 * Math.sqrt(m);
      ctx.fillStyle = "#0ea5a0";
      ctx.beginPath();
      ctx.arc(ballX, ballY, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(14,165,160,0.35)";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(ballX, ballY, r + 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = palette.muted;
      ctx.font = "600 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Drag the mass", ballX, ballY + r + 18);
    }
  }

  // Energy numbers for the sidebar text (React state)
  const [bars, setBars] = useState({ U: 0, K: 0, E: 0 });

  // Update numeric readouts AND directly drive the bar fill heights
  function updateBars() {
    const Uval = U(qRef.current);
    const Kval = K(vRef.current);
    const Eval = Uval + Kval;
    setBars({ U: Uval, K: Kval, E: Eval });

    // DOM-driven fills for smooth, continuous updates
    const Umax_for_bars = mode === "quadratic"
        ? 0.5 * k * Math.max(domain.qMin ** 2, domain.qMax ** 2)
        : m * g * domain.qMax;
    const scale = Math.max(1e-6, Umax_for_bars);
    const upct = Math.max(0, Math.min(100, (Uval / scale) * 100));
    const kpct = Math.max(0, Math.min(100, (Kval / scale) * 100));
    if (uFillRef.current) uFillRef.current.style.height = upct + "%";
    if (kFillRef.current) kFillRef.current.style.height = kpct + "%";
  }

  // One-off draw used on init/resize/drag
  function drawOnce(potW, simW, H) {
    const potCtx = potRef.current?.getContext("2d");
    const simCtx = simRef.current?.getContext("2d");
    if (potCtx) drawPotential(potCtx, potW, H);
    if (simCtx) drawMotion(simCtx, simW, H);
    updateBars();
  }

  // --------------------------- Animation loop ---------------------------
  useEffect(() => {
    let last = performance.now();

    const step = (t) => {
      const dtRaw = Math.min(0.05, (t - last) / 1000);
      last = t;

      if (!paused && dragging.current.where == null) {
        let q = qRef.current;
        let v = vRef.current;

        if (mode === 'linear' && q <= domain.qMin && Math.abs(v) < 0.02) {
            vRef.current = 0;
            qRef.current = domain.qMin;
        } else {
            // midpoint (2× explicit Euler)
            const a1 = accel(q, v);
            const vMid = v + a1 * (dtRaw * 0.5);
            const qMid = q + v * (dtRaw * 0.5);
            const a2 = accel(qMid, vMid);
            v += a2 * dtRaw;
            q += vMid * dtRaw;

            if (mode === "linear") {
              if (q < domain.qMin) { q = domain.qMin; v = -vMid * restitution; if (Math.abs(v) < 0.15) v = 0; }
              if (q > domain.qMax) { q = domain.qMax; v = 0; }
            } else {
              q = clamp(q, domain.qMin, domain.qMax);
            }

            qRef.current = q;
            vRef.current = v;
        }
      }

      if (E0Ref.current == null) E0Ref.current = totalE();

      drawOnce(layout.potW, layout.simW, sharedH);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, mode, m, k, g, damping, restitution, domain.qMin, domain.qMax, sharedH, layout.potW, layout.simW]);

  // Reset energies when mode changes
  useEffect(() => {
    qRef.current = mode === "quadratic" ? 0.0 : 2.2;
    vRef.current = 0;
    E0Ref.current = null;
    // Trigger a re-measure on next frame
    requestAnimationFrame(() => {
      if (outerRef.current) {
        const evt = new Event("resize");
        window.dispatchEvent(evt);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --------------------------- Events: dragging ---------------------------
  useEffect(() => {
    const plot = potRef.current;
    const motion = simRef.current;
    if (!plot || !motion) return;

    const onPlotDown = (e) => { dragging.current.where = "plot"; setQFromPlotPointer(e); };
    const onPlotMove = (e) => { if (dragging.current.where === "plot") setQFromPlotPointer(e); };
    const onUp = () => (dragging.current.where = null);

    const onMotionDown = (e) => { dragging.current.where = "motion"; setQFromMotionPointer(e); };
    const onMotionMove = (e) => { if (dragging.current.where === "motion") setQFromMotionPointer(e); };

    plot.addEventListener("mousedown", onPlotDown);
    plot.addEventListener("mousemove", onPlotMove);
    motion.addEventListener("mousedown", onMotionDown);
    motion.addEventListener("mousemove", onMotionMove);
    window.addEventListener("mouseup", onUp);

    const touchToMouse = (handler) => (e) => { if (!e.touches?.length) return; const t = e.touches[0]; handler({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() }); };
    plot.addEventListener("touchstart", touchToMouse(onPlotDown), { passive: false });
    plot.addEventListener("touchmove", touchToMouse(onPlotMove), { passive: false });
    motion.addEventListener("touchstart", touchToMouse(onMotionDown), { passive: false });
    motion.addEventListener("touchmove", touchToMouse(onMotionMove), { passive: false });
    window.addEventListener("touchend", onUp);

    return () => {
      plot.removeEventListener("mousedown", onPlotDown);
      plot.removeEventListener("mousemove", onPlotMove);
      motion.removeEventListener("mousedown", onMotionDown);
      motion.removeEventListener("mousemove", onMotionMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [mode, sharedH, layout.potW, layout.simW]);

  // --------------------------- UI helpers ---------------------------
  const switchBtn = (name, label) => (
    <button className={`btn ${mode === name ? "" : "btn-secondary"}`} onClick={() => setMode(name)} style={{ minWidth: 120 }}>
      {label}
    </button>
  );

  const number = (x) => x.toFixed(3).replace(/\.000$/, ".0");

  const EScale = useMemo(() => {
    const Eval = totalE();
    const Eref = E0Ref.current ?? Eval;
    return Math.max(1e-6, Math.max(Eref, bars.E));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars.E, mode, m, k, g]);

  // --------------------------- Render ---------------------------
  return (
    // Contained wrapper — respects the site's usual text width (inherits parent .container)
    <div
      ref={outerRef}
      style={{
        width: "100%",
        margin: "0 auto",
        color: "var(--text-primary)"
      }}
    >

      {/* Top controls */}
      <div className="control-panel" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {switchBtn("quadratic", "Quadratic: U=½kx²")}
          {switchBtn("linear", "Linear: U=mgh")}
        </div>

        <button className="btn" onClick={() => setPaused((p) => !p)}>{paused ? "Play" : "Pause"}</button>
        <button className="btn btn-secondary" onClick={() => { vRef.current = 0; qRef.current = mode === "quadratic" ? 0.0 : 2.2; E0Ref.current = null; drawOnce(layout.potW, layout.simW, sharedH); }}>
          Reset
        </button>

        <div className="slider-group" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          
          {mode === "quadratic" ? (
            <label>
              Damping: {damping.toFixed(2)}
              <input type="range" min={0} max={0.2} step={0.01} value={damping} onChange={(e) => setDamping(parseFloat(e.target.value))} />
            </label>
          ) : (
            <label>
              Restitution: {restitution.toFixed(2)}
              <input type="range" min={0} max={1} step={0.01} value={restitution} onChange={(e) => setRestitution(parseFloat(e.target.value))} />
            </label>
          )}
        </div>
      </div>

      {/* Three side-by-side panels: exact widths to fit wrapper, shared height */}
      <div
        className="pel-canvases"
        style={{
          display: "grid",
          gridTemplateColumns: `${layout.potW}px ${layout.simW}px ${layout.barsW}px`,
          gap: layout.gap,
          alignItems: "stretch",
          marginTop: 12,
        }}
      >
        {/* Potential plot */}
        <div ref={potWrapRef} className="pel-panel" style={{ textAlign: "center", height: sharedH, margin: 0 }}>
          <canvas ref={potRef} style={{ width: "100%", height: sharedH, borderRadius: 8, boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }} />
        </div>

        {/* Motion view */}
        <div ref={simWrapRef} className="pel-panel" style={{ textAlign: "center", height: sharedH, margin: 0 }}>
          <canvas ref={simRef} style={{ width: "100%", height: sharedH, borderRadius: 8, boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }} />
        </div>

        {/* Energy bars */}
        <div className="pel-panel" style={{ padding: 12, height: sharedH, display: "flex", flexDirection: "column", margin: 0 }}>
          <h4 style={{ margin: "4px 0 8px", color: "var(--text-primary)" }}>Energy</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end", flex: 1, border: "1px solid var(--grid-line)", borderRadius: 10, padding: 10 }}>
            <Bar label="U" color="#0ea5a0" fillRef={uFillRef} />
            <Bar label="K" color="#10b981" fillRef={kFillRef} />
          </div>
          <EnergyReadout mode={mode} qRef={qRef} vRef={vRef} bars={bars} />
        </div>
      </div>
    </div>
  );
}

function EnergyReadout({ mode, qRef, vRef, bars }) {
  const number = (x) => x.toFixed(3).replace(/\.000$/, ".0");
  return (
    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: "var(--text-muted)" }}>

      
    </div>
  );
}

function Bar({ label, color, fillRef }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
      <div style={{ flex: 1, width: "80%", background: "color-mix(in srgb, var(--text-primary) 12%, transparent)", borderRadius: 10, position: "relative" }}>
        <div ref={fillRef} style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "0%", background: color, borderRadius: 10 }} />
      </div>
      <div style={{ marginTop: 6, fontWeight: 700, color: "var(--text-primary)" }}>{label}</div>
    </div>
  );
}

// --------------------------- Utils ---------------------------
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
