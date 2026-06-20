import React, { useEffect, useRef, useState } from "react";
import { themeColors } from "../electromagnetism/themeColors";

/**
 * BeadOnRotatingRod.jsx
 * -------------------------------------------------------------
 * Visualizes a light bead sliding without friction on a straight
 * rod that rotates at constant angular speed ω about the origin.
 * The actuator drives the bead outward so r(t) = v t and θ(t) = ω t.
 *
 * Shows velocity/acceleration vectors in {r̂, θ̂}, and the forces:
 *  - Rod force (constraint): F_rod = m a_θ in +θ̂ (tangential only)
 *  - Actuator radial force:  F_act = m a_r  in r̂ (inward since a_r<0)
 *
 * Controls: v, ω, m, time scale, toggles for vectors/forces, play/pause.
 * The sim auto-rescales to fit in view; pixels-per-meter can be adjusted.
 *
 * No external libs; pure React + <canvas>.
 * -------------------------------------------------------------
 */

export default function BeadOnRotatingRod() {
  // --- Simulation params ---
  const [v, setV] = useState(0.4);          // m/s (radial speed)
  const [omega, setOmega] = useState(1.5 * Math.PI); // rad/s (angular speed)
  const [m, setM] = useState(1.0);          // kg (mass)
  const [timeScale, setTimeScale] = useState(1); // speed multiplier
  const [pxPerMeter, setPxPerMeter] = useState(80); // base scale; auto-fit applied on top

  const [showVelocity, setShowVelocity] = useState(true);
  const [showAcceleration, setShowAcceleration] = useState(true);
  const [showForces, setShowForces] = useState(true);
  const [playing, setPlaying] = useState(true);

  // internal clock
  const tRef = useRef(0);
  const lastTsRef = useRef(null);

  // canvas refs
  const canvasRef = useRef(null);
  const parentRef = useRef(null);

  // size state (width drives height to avoid feedback loops)
  const [size, setSize] = useState({ w: 800, h: 480 });

  // ResizeObserver: derive height from width to prevent unbounded growth
  useEffect(() => {
    if (!parentRef.current) return;
    const ro = new ResizeObserver(() => {
      const rect = parentRef.current.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      // Height is a function of width (fixed aspect). This breaks the width↔height feedback.
      const hTarget = Math.max(360, Math.min(720, Math.round(w * 0.6)));
      setSize(prev => (prev.w !== w || prev.h !== hTarget ? { w, h: hTarget } : prev));
    });
    ro.observe(parentRef.current);
    return () => ro.disconnect();
  }, []);

  // animation loop
  useEffect(() => {
    let raf = 0;
    function frame(ts) {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt_real = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (playing) {
        tRef.current += dt_real * timeScale;
      }
      draw();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeScale, v, omega, m, size.w, size.h, showVelocity, showAcceleration, showForces, pxPerMeter]);

  // Utility: draw arrow from (x,y) in direction (dx,dy)
  function arrow(ctx, x, y, dx, dy, { head=10, width=3 } = {}) {
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len, uy = dy / len;
    const hx = x + dx, hy = y + dy;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - head * (ux * Math.cos(Math.PI/6) - uy * Math.sin(Math.PI/6)), hy - head * (uy * Math.cos(Math.PI/6) + ux * Math.sin(Math.PI/6)));
    ctx.lineTo(hx - head * (ux * Math.cos(-Math.PI/6) - uy * Math.sin(-Math.PI/6)), hy - head * (uy * Math.cos(-Math.PI/6) + ux * Math.sin(-Math.PI/6)));
    ctx.closePath();
    ctx.fill();
  }

  // world→screen transform (origin centered)
  function toScreen(x, y) {
    const cx = size.w / 2;
    const cy = size.h / 2;
    const k = autoScale();
    return [cx + x * k, cy - y * k];
  }

  function autoScale() {
    // Fit so that rod length up to r_max stays on screen with margin
    const margin = 0.1; // 10%
    const r = v * tRef.current; // current r
    const rMax = Math.max(2, r * 1.2 + 1.0); // generous bound
    const kx = (size.w * (1 - margin)) / (2 * rMax);
    const ky = (size.h * (1 - margin)) / (2 * rMax);
    return Math.min(pxPerMeter, Math.max(20, Math.min(kx, ky)));
  }

  function drawGrid(ctx) {
    const palette = themeColors();
    const k = autoScale();
    const stepWorld = niceStep( (size.w / k) / 8 );
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    // verticals
    for (let x = -100; x <= 100; x += stepWorld) {
      const [sx1, sy1] = toScreen(x, -100);
      const [sx2, sy2] = toScreen(x, 100);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    }
    // horizontals
    for (let y = -100; y <= 100; y += stepWorld) {
      const [sx1, sy1] = toScreen(-100, y);
      const [sx2, sy2] = toScreen(100, y);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    }
    // axes
    ctx.strokeStyle = palette.muted;
    const [sx0, syT] = toScreen(0, 100);
    const [sxB, sy0] = toScreen(-100, 0);
    const [sx1, sy1] = toScreen(0, -100);
    const [sx2, sy2] = toScreen(100, 0);
    ctx.beginPath(); ctx.moveTo(sx0, syT); ctx.lineTo(sx1, sy1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sxB, sy0); ctx.lineTo(sx2, sy2); ctx.stroke();
    ctx.restore();
  }

  function niceStep(rangeGuess) {
    // returns a "nice" grid step near rangeGuess
    const p = Math.pow(10, Math.floor(Math.log10(rangeGuess)));
    const candidates = [1, 2, 5, 10].map(c => c * p);
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c - rangeGuess) < Math.abs(best - rangeGuess)) best = c;
    return best;
  }

  function draw() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const palette = themeColors();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // world state
    const t = tRef.current;
    const r = Math.max(0, v * t); // outward from origin
    const theta = omega * t;      // angle from +x CCW

    // unit vectors at bead
    const er = [Math.cos(theta), Math.sin(theta)];
    const et = [-Math.sin(theta), Math.cos(theta)]; // +θ̂ is CCW tangent

    // position in world
    const x = r * er[0];
    const y = r * er[1];

    // kinematics
    const vr = v;
    const vt = r * omega;
    const ar = - r * omega * omega;
    const at = 2 * v * omega;

    // forces
    const F_act_r = m * ar;      // radial actuator (inward negative)
    const F_rod_t = m * at;      // rod provides tangential only

    // transform
    const [cx, cy] = toScreen(0, 0);
    const [bx, by] = toScreen(x, y);

    drawGrid(ctx);

    // rod
    ctx.save();
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // origin hub
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // bead
    ctx.fillStyle = "#2563eb"; // blue
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 2;
    ctx.stroke();

    // local basis glyph at bead
    ctx.save();
    ctx.translate(bx, by);
    ctx.lineWidth = 2;

    // scale arrows for visibility (heuristic)
    const k = autoScale();
    const velScale = 40 / (1 + Math.hypot(vr, vt));
    const accScale = 25 / (1 + Math.hypot(ar, at));
    const forceScale = 25 / (1 + Math.hypot(F_act_r, F_rod_t));

    if (showVelocity) {
      ctx.strokeStyle = "#059669"; // green-ish
      ctx.fillStyle = "#059669";
      // v = v_r r̂ + v_θ θ̂
      const vx = velScale * (vr * er[0] + vt * et[0]);
      const vy = velScale * (vr * er[1] + vt * et[1]);
      arrow(ctx, 0, 0, vx, vy, { head: 10, width: 3 });
    }

    if (showAcceleration) {
      ctx.strokeStyle = "#dc2626"; // red-ish
      ctx.fillStyle = "#dc2626";
      // a = a_r r̂ + a_θ θ̂
      const ax = accScale * (ar * er[0] + at * et[0]);
      const ay = accScale * (ar * er[1] + at * et[1]);
      arrow(ctx, 0, 0, ax, ay, { head: 10, width: 3 });
    }

    if (showForces) {
      // actuator radial (into -r for ar<0)
      ctx.strokeStyle = "#7c3aed"; // purple
      ctx.fillStyle = "#7c3aed";
      const Fax = forceScale * (F_act_r * er[0]);
      const Fay = forceScale * (F_act_r * er[1]);
      arrow(ctx, 0, 0, Fax, Fay, { head: 10, width: 3 });

      // rod tangential (+θ̂)
      ctx.strokeStyle = "#ea580c"; // orange
      ctx.fillStyle = "#ea580c";
      const Frx = forceScale * (F_rod_t * et[0]);
      const Fry = forceScale * (F_rod_t * et[1]);
      arrow(ctx, 0, 0, Frx, Fry, { head: 10, width: 3 });
    }

    ctx.restore();

    // labels
    ctx.fillStyle = palette.text;
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("origin", cx + 8, cy + 6);

    // HUD panel (top-left)
    const pad = 10;
    const hudX = 12, hudY = 12;
    const hudW = Math.min(420, size.w - 24);
    const hudH = 160;

    // background
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRect(ctx, hudX, hudY, hudW, hudH, 12);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const line = (s, i) => ctx.fillText(s, hudX + pad, hudY + pad + 18 * (i+1));

    line(`t = ${t.toFixed(2)} s     r = v t = ${(r).toFixed(2)} m     θ = ω t = ${(theta).toFixed(2)} rad`, 0);
    line(`v = v_r r̂ + v_θ θ̂  →  v_r = ${vr.toFixed(2)} m/s,  v_θ = r ω = ${(vt).toFixed(2)} m/s`, 1);
    line(`a = a_r r̂ + a_θ θ̂  →  a_r = - r ω² = ${(ar).toFixed(2)} m/s²,  a_θ = 2 v ω = ${(at).toFixed(2)} m/s²`, 2);
    line(`Forces (m = ${m.toFixed(2)} kg):  F_act,r = m a_r = ${(F_act_r).toFixed(2)} N,  F_rod,θ = m a_θ = ${(F_rod_t).toFixed(2)} N`, 3);
    line(`Directions: r̂ (radial), θ̂ (CCW tangential)`, 4);

    // Edge condition: stop if bead is almost off-screen (safety)
    const kfit = autoScale();
    const safe = Math.min(size.w, size.h) * 0.48 / kfit;
    if (r > safe * 0.98 && playing) {
      setPlaying(false);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }

  // Controls UI
  return (
    <div ref={parentRef} className="w-full" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, color: "var(--text-primary)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <PlayPauseButton playing={playing} onClick={() => setPlaying(p => !p)} />
        <button onClick={() => { tRef.current = 0; setPlaying(false); }}
                style={btnStyle}>Reset</button>
        <Toggle checked={showVelocity} onChange={setShowVelocity} label="Show velocity" />
        <Toggle checked={showAcceleration} onChange={setShowAcceleration} label="Show acceleration" />
        <Toggle checked={showForces} onChange={setShowForces} label="Show forces" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Slider label={`v (radial speed) = ${v.toFixed(2)} m/s`} min={0.05} max={1.5} step={0.01} value={v} onChange={setV} />
        <Slider label={`ω (angular speed) = ${omega.toFixed(2)} rad/s`} min={0.2} max={6.0} step={0.01} value={omega} onChange={setOmega} />
        <Slider label={`m (mass) = ${m.toFixed(2)} kg`} min={0.2} max={5.0} step={0.01} value={m} onChange={setM} />
        <Slider label={`time scale × = ${timeScale.toFixed(2)}`} min={0.2} max={3.0} step={0.01} value={timeScale} onChange={setTimeScale} />
        <Slider label={`pixels per meter (cap) = ${pxPerMeter.toFixed(0)}`} min={30} max={160} step={1} value={pxPerMeter} onChange={setPxPerMeter} />
      </div>

      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{ width: "100%", height: `${size.h}px`, background: "var(--sim-bg)", borderRadius: 12, border: "1px solid var(--grid-line)" }}
      />
    </div>
  );
}

// ------- UI bits -------
const btnStyle = {
  appearance: "none",
  border: "none",
  cursor: "pointer",
  padding: "8px 14px",
  borderRadius: 9999,
  fontWeight: 700,
  fontSize: 14,
  color: "#ffffff",
  background: "linear-gradient(90deg,#4f46e5,#06b6d4)",
  boxShadow: "0 8px 16px rgba(0,0,0,0.12)",
};

function PlayPauseButton({ playing, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={playing} aria-label={playing ? "Pause" : "Play"}
      style={{
        ...btnStyle,
        background: playing ? "linear-gradient(90deg,#ef4444,#f59e0b)" : "linear-gradient(90deg,#10b981,#3b82f6)",
      }}>
      {playing ? "Pause" : "Play"}
    </button>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Slider({ label, min, max, step, value, onChange }) {
  const id = React.useId();
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 4, fontSize: 14 }}>
      <div>{label}</div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}
