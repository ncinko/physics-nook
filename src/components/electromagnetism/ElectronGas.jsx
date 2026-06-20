import React, { useRef, useEffect, useMemo, useState } from "react";

// ElectronGas.jsx — bigger, hazier electrons; simplified controls

const TAU_DEFAULT = 0.45;
const ELECTRON_RADIUS = 3.2; // larger radius
const Q_OVER_M = 0.35;
const TRAIL_FADE = 0.10; // faster trail fade

// Physics constants (scaled)
const MAX_SPEED = 120;
const E_FROM_DRAG = 7.0;
const MAX_E = 1000;

const isiPadSafari = (() => {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/(Macintosh).*Version\/.*Safari/.test(ua) && "ontouchend" in document);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/CriOS\//.test(ua);
  return isIOS && isSafari;
})();

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clampMag = (vx, vy, max) => {
  const s = Math.hypot(vx, vy);
  if (s <= max || s === 0) return [vx, vy];
  const k = max / s; return [vx * k, vy * k];
};

export default function ElectronGas({
  width = 900,
  height = 540,
  density = 0.00055,
  initialE = { x: 250, y: 0 },
  background = "#081018",
}) {
  const canvasRef = useRef(null);
  const trailRef = useRef(null);

  const [running, setRunning] = useState(true);
  const [E, setE] = useState(initialE);
  const [tauL, setTauL] = useState(TAU_DEFAULT);

  const dragRef = useRef(null);

  const safariScale = isiPadSafari ? 0.72 : 1.0;
  const N = useMemo(() => Math.max(30, Math.floor(width * height * density * safariScale)), [width, height, density, safariScale]);

  const electronsRef = useRef([]);
  const lastTimeRef = useRef(null);

  const reseed = () => {
    const arr = [];
    for (let i = 0; i < N; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const theta = Math.random() * Math.PI * 2;
      const speed = 28 + Math.random() * 20;
      arr.push({
        x, y,
        vx: speed * Math.cos(theta),
        vy: speed * Math.sin(theta),
        tSinceL: Math.random() * tauL,
        hue: 200 + (Math.random() * 60),
      });
    }
    electronsRef.current = arr;
  };

  useEffect(() => {
    reseed();
    const t = trailRef.current;
    if (t) t.getContext("2d").clearRect(0, 0, width, height);
    lastTimeRef.current = null;
  }, [width, height, N]);

  const drawElectronsMain = (ctx, arr) => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of arr) {
      const r = ELECTRON_RADIUS;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 10);
g.addColorStop(0.0, `hsla(${p.hue}, 90%, 75%, 0.5)`);
g.addColorStop(0.3, `hsla(${p.hue}, 90%, 65%, 0.15)`);
g.addColorStop(1.0, `hsla(${p.hue}, 90%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 10, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = `hsla(${p.hue}, 75%, 75%, 0.85)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  const drawElectronsTrail = (tctx, arr) => {
    tctx.save();
    tctx.globalCompositeOperation = "source-over";
    for (const p of arr) {
      tctx.globalAlpha = 0.25; // hazier trails
      tctx.fillStyle = `hsla(${p.hue}, 95%, 70%, 1)`;
      tctx.beginPath(); tctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); tctx.fill(); // larger trail dots
    }
    tctx.globalAlpha = 1;
    tctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const trail = trailRef.current;
    if (!canvas || !trail) return;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const tctx = trail.getContext("2d", { alpha: true, desynchronized: true });

    let rafId;

    const step = (t) => {
      if (!running) {
        rafId = requestAnimationFrame(step);
        lastTimeRef.current = t;
        return;
      }
      const last = lastTimeRef.current == null ? t : lastTimeRef.current;
      let dt = (t - last) / 1000;
      dt = clamp(dt, 0, 0.05);
      lastTimeRef.current = t;

      const arr = electronsRef.current;

      tctx.save();
      tctx.globalCompositeOperation = "destination-out";
      tctx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
      tctx.fillRect(0, 0, width, height);
      tctx.restore();

      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.vx += Q_OVER_M * E.x * dt;
        p.vy += Q_OVER_M * E.y * dt;

        p.tSinceL += dt;
        if (p.tSinceL >= -Math.log(1.0 - Math.random()) * tauL) {
          const th = Math.random() * Math.PI * 2;
          const speed = (22 + Math.random() * 16);
          p.vx = speed * Math.cos(th);
          p.vy = speed * Math.sin(th);
          p.tSinceL = 0;
        }

        [p.vx, p.vy] = clampMag(p.vx, p.vy, MAX_SPEED);

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0) p.x += width; else if (p.x >= width) p.x -= width;
        if (p.y < 0) p.y += height; else if (p.y >= height) p.y -= height;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      ctx.drawImage(trail, 0, 0);
      drawElectronsMain(ctx, arr);
      drawElectronsTrail(tctx, arr);

      const d = dragRef.current;
      if (d) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(d.x1, d.y1); ctx.stroke();
        const ang = Math.atan2(d.y1 - d.y0, d.x1 - d.x0);
        const ah = 8;
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x1 - ah * Math.cos(ang - 0.35), d.y1 - ah * Math.sin(ang - 0.35));
        ctx.lineTo(d.x1 - ah * Math.cos(ang + 0.35), d.y1 - ah * Math.sin(ang + 0.35));
        ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
        ctx.restore();
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [running, E, tauL, width, height, background]);

  const setEFromDrag = (dx, dy) => {
    let ex = dx * E_FROM_DRAG;
    let ey = dy * E_FROM_DRAG;
    const m = Math.hypot(ex, ey);
    if (m > MAX_E) { const k = MAX_E / m; ex *= k; ey *= k; }
    setE({ x: -ex, y: -ey });
  };

  const onDown = (evt) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = clamp(evt.clientX - rect.left, 0, rect.width);
    const y = clamp(evt.clientY - rect.top, 0, rect.height);
    dragRef.current = { x0: x, y0: y, x1: x, y1: y };
  };
  const onMove = (evt) => {
    if (!dragRef.current) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = clamp(evt.clientX - rect.left, 0, rect.width);
    const y = clamp(evt.clientY - rect.top, 0, rect.height);
    dragRef.current.x1 = x; dragRef.current.y1 = y;
    setEFromDrag(x - dragRef.current.x0, y - dragRef.current.y0);
  };
  const onUp = () => { dragRef.current = null; };
  const onLeave = () => { dragRef.current = null; };

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: width, margin: "0 auto", color: "var(--text-primary)" }}>
      <div
        style={{ position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 22px rgba(0,0,0,0.35)" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onTouchStart={(e) => { const t = e.touches[0]; if(!t) return; const rect = e.currentTarget.getBoundingClientRect(); const x=t.clientX-rect.left, y=t.clientY-rect.top; dragRef.current={x0:x,y0:y,x1:x,y1:y}; }}
        onTouchMove={(e) => { const t = e.touches[0]; if(!t||!dragRef.current) return; const rect = e.currentTarget.getBoundingClientRect(); const x=t.clientX-rect.left, y=t.clientY-rect.top; dragRef.current.x1=x; dragRef.current.y1=y; setEFromDrag(x-dragRef.current.x0, y-dragRef.current.y0); }}
        onTouchEnd={onUp}
      >
        <canvas ref={canvasRef} width={width} height={height} style={{ display: "block", width: "100%", height: "100%" }} />
        <canvas ref={trailRef} width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

        {/* Controls */}
        <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 10, alignItems: "center", background: "rgba(12,20,28,0.35)", padding: "8px 10px", borderRadius: 10, backdropFilter: "blur(6px)" }}>
          <button onClick={() => setRunning(r => !r)} style={{ background: running ? "#0b7" : "#444", color: "white", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 600 }}>{running ? "Pause" : "Play"}</button>
          <button onClick={reseed} style={{ background: "#0ea5e9", color: "white", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 600 }}>Reseed</button>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ opacity: 0.85 }}>τ<sub>L</sub></span>
            <input type="range" min={0.08} max={0.8} step={0.01} value={tauL} onChange={(e) => setTauL(parseFloat(e.target.value))} />
          </label>
        </div>
      </div>
      <p style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
        Tip: click and drag anywhere to set the electric field (arrow = direction, length = strength).
      </p>
    </div>
  );
}
