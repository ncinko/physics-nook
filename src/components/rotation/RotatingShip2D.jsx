// src/components/RotatingShip2D.js
import React, { useRef, useEffect, useState } from "react";

/**
 * RotatingShip2D — rotating reference frame visualizer
 * Frames:
 *  - Star (inertial): ship rotates, stars fixed; object moves with constant v (elastic wall).
 *  - Ship (rotating): ship fixed; stars rotate; draw fictitious a_cor, a_cen.
 *
 * Key formulas (ship frame):
 *   v_rel = R(-θ) v_I - (Ω × r_ship)
 *   a_cor = -2 Ω × v_rel
 *   a_cen = - Ω × (Ω × r_ship)
 * (Ω = (0,0,ω), θ = ω t)
 */

export default function RotatingShip2D() {
  // ---------- sizing ----------
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dpiScale, setDpiScale] = useState(window.devicePixelRatio || 1);
  const [size, setSize] = useState({ w: 900, h: 620 });

  // ---------- sim flags ----------
  const [running, setRunning] = useState(true);
  const [frame, setFrame] = useState("ship"); // "ship" | "star"
  const [showCoriolis, setShowCoriolis] = useState(true);
  const [showCentrifugal, setShowCentrifugal] = useState(true);
  const [showVelocity, setShowVelocity] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [largeShip, setLargeShip] = useState(false);

  // angular speed ω (rad/s)
  const [omega, setOmega] = useState(0.5);

  // time
  const tRef = useRef(0);

  // ship geometry + stars
  const ship = useRef({ R: 200, stars: [] });

  // object state (inertial frame)
  const state = useRef({ x: 0, y: 0, vx: 0, vy: 0, placed: false });

  // view ref
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });

  // drag to set velocity
  const drag = useRef({
    dragging: false,
    startWorld: null,
    currentWorld: null,
    hasVelocity: false,
  });

  // pan state
  const panning = useRef({ dragging: false, start: { x: 0, y: 0 } });

  // trail
  const trailRef = useRef([]);

  // raf bookkeeping
  const rafRef = useRef(null);
  const lastStampRef = useRef(null);

  const blueDotPosition = largeShip ? 0.9 : 0.55;

  // ---------- helpers ----------
  const cross2 = (wz, vx, vy) => [-wz * vy, wz * vx]; // Ω×v
  const dot2 = (ax, ay, bx, by) => ax * bx + ay * by;
  const mag = (x, y) => Math.hypot(x, y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rot = (x, y, th) => {
    const c = Math.cos(th),
      s = Math.sin(th);
    return [c * x - s * y, s * x + c * y];
  };

  function toScreen(ctx, x, y) {
    const { zoom, pan } = view.current;
    const cx = ctx.canvas.width / 2,
      cy = ctx.canvas.height / 2;
    return [cx + pan.x + x * zoom, cy + pan.y - y * zoom];
  }
  function toWorld(ctx, sx, sy) {
    const { zoom, pan } = view.current;
    const cx = ctx.canvas.width / 2,
      cy = ctx.canvas.height / 2;
    return [(sx - cx - pan.x) / zoom, -(sy - cy - pan.y) / zoom];
  }
  function dropFromShipFrame() {
    const theta = omega * tRef.current;
    // Blue window point is fixed in the ship frame at +x: (0.55 R, 0)
    const rx0 = 0;
    const ry0 = -ship.current.R * blueDotPosition;
    // If there is no object yet, spawn it at the blue point's *current inertial* position
    if (!state.current.placed || state.current.placed) {
      const [x0, y0] = rot(rx0, ry0, +theta); // rotate ship→inertial
      state.current.x = x0;
      state.current.y = y0;
      state.current.placed = true;
      // clear any old trail
      trailRef.current = [];
    }
    // Compute current r in ship axes (if object already existed, use its current spot)
    const [rx, ry] = rot(state.current.x, state.current.y, -theta);
    // Release with zero relative velocity: v_I(ship-axes) = Ω × r = (-ω ry, +ω rx)
    const vIx_rot = -omega * ry;
    const vIy_rot = omega * rx;
    // Convert that to inertial axes
    const [vIx, vIy] = rot(vIx_rot, vIy_rot, +theta);
    state.current.vx = vIx;
    state.current.vy = vIy;
    drag.current.dragging = false;
  }

  // ---------- stars ----------
  function initStars(n = 220) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const r = (Math.random() ** 0.6) * 1.2 * ship.current.R * 2;
      const th = Math.random() * 2 * Math.PI;
      arr.push({
        x: r * Math.cos(th),
        y: r * Math.sin(th),
        b: 0.5 + 0.5 * Math.random(),
        s: Math.random() < 0.12 ? 2 : 1,
      });
    }
    ship.current.stars = arr;
  }

  // ---------- resize ----------
  useEffect(() => {
    function handleResize() {
      const maxW = Math.max(640, Math.min(window.innerWidth * 0.95, 1200));
      const maxH = Math.max(460, Math.min(window.innerHeight * 0.8, 760));
      const w = Math.floor(maxW);
      const h = Math.floor(maxH);
      setSize({ w, h });
      setDpiScale(window.devicePixelRatio || 1);
      ship.current.R = (largeShip ? 0.8 : 0.4) * Math.min(w, h);
      initStars();
    }
    handleResize();
    const ro = new ResizeObserver(handleResize);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [largeShip]);

  // ---------- input ----------
  function handleCanvasDown(e) {
    if (e.button === 2) {
      panning.current.dragging = true;
      panning.current.start = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * dpiScale;
    const sy = (e.clientY - rect.top) * dpiScale;
    const ctx = canvas.getContext("2d");
    const [rx, ry] = toWorld(ctx, sx, sy);
    if (mag(rx, ry) > ship.current.R) return;

    const theta = omega * tRef.current;
    const [x0, y0] = frame === "ship" ? rot(rx, ry, theta) : [rx, ry];

    state.current.x = x0;
    state.current.y = y0;
    state.current.vx = 0;
    state.current.vy = 0;
    state.current.placed = true;

    drag.current.dragging = true;
    drag.current.startWorld = { x: x0, y: y0 };
    drag.current.currentWorld = { x: x0, y: y0 };
    drag.current.hasVelocity = false;
  }
  function handleCanvasMove(e) {
    if (panning.current.dragging) {
      const dx = e.clientX - panning.current.start.x;
      const dy = e.clientY - panning.current.start.y;
      view.current.pan.x += dx;
      view.current.pan.y += dy;
      panning.current.start = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drag.current.dragging) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * dpiScale;
    const sy = (e.clientY - rect.top) * dpiScale;
    const ctx = canvas.getContext("2d");
    const [rx, ry] = toWorld(ctx, sx, sy);
    const theta = omega * tRef.current;
    const [wx, wy] = frame === "ship" ? rot(rx, ry, theta) : [rx, ry];
    drag.current.currentWorld = { x: wx, y: wy };

    const k = 1.0; // pixels→world/s scale for drag velocity
    const vx = (wx - drag.current.startWorld.x) * k;
    const vy = (wy - drag.current.startWorld.y) * k;
    state.current.vx = vx;
    state.current.vy = vy;
    drag.current.hasVelocity = mag(vx, vy) > 1e-3;
  }
  function handleCanvasUp(e) {
    if (panning.current.dragging && e.button === 2) {
      panning.current.dragging = false;
      return;
    }
    drag.current.dragging = false;
  }
  function handleWheel(e) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * dpiScale;
    const sy = (e.clientY - rect.top) * dpiScale;

    const zoomFactor = 1.1;
    const oldZoom = view.current.zoom;
    let newZoom = oldZoom;
    if (e.deltaY < 0) {
      // zoom in
      newZoom *= zoomFactor;
    } else {
      // zoom out
      newZoom /= zoomFactor;
    }
    newZoom = clamp(newZoom, 0.2, 5);

    const zoomRatio = newZoom / oldZoom;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const panX = view.current.pan.x;
    const panY = view.current.pan.y;

    const mx = sx - cx;
    const my = sy - cy;

    view.current.pan.x = mx - (mx - panX) * zoomRatio;
    view.current.pan.y = my - (my - panY) * zoomRatio;

    view.current.zoom = newZoom;
  }

  useEffect(() => {
    const c = canvasRef.current;
    c.addEventListener("pointerdown", handleCanvasDown);
    window.addEventListener("pointermove", handleCanvasMove);
    window.addEventListener("pointerup", handleCanvasUp);
    c.addEventListener("wheel", handleWheel);
    const handleContextMenu = (e) => e.preventDefault();
    c.addEventListener("contextmenu", handleContextMenu);
    return () => {
      c.removeEventListener("pointerdown", handleCanvasDown);
      window.removeEventListener("pointermove", handleCanvasMove);
      window.removeEventListener("pointerup", handleCanvasUp);
      c.removeEventListener("wheel", handleWheel);
      c.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [frame, omega, dpiScale]);

  // ---------- clear trail when switching reference frame ----------
  useEffect(() => {
    // reset trail on Star↔Ship toggle
    trailRef.current = [];

    // seed with the current displayed point so the new trail starts anchored
    if (state.current.placed) {
      const theta = omega * tRef.current;
      const [wx, wy] =
        frame === "ship"
          ? rot(state.current.x, state.current.y, -theta)
          : [state.current.x, state.current.y];
      trailRef.current.push({ x: wx, y: wy });
    }
  }, [frame]);

  // ---------- physics (inertial) ----------
  function stepInertial(dt) {
    const s = state.current;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // elastic bounce off inner hull
    const R = ship.current.R;
    const r = mag(s.x, s.y);
    if (r >= R) {
      const nx = s.x / r,
        ny = s.y / r;
      s.x = nx * (R - 0.5);
      s.y = ny * (R - 0.5);
      const vdotn = dot2(s.vx, s.vy, nx, ny);
      s.vx = s.vx - 2 * vdotn * nx;
      s.vy = s.vy - 2 * vdotn * ny;
    }
  }

  // ---------- drawing helpers ----------
  function drawArrow(
    ctx,
    x0,
    y0,
    x1,
    y1,
    color = "#08c",
    width = 2,
    head = 10
  ) {
    const [sx0, sy0] = toScreen(ctx, x0, y0);
    const [sx1, sy1] = toScreen(ctx, x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    ctx.lineTo(sx1, sy1);
    ctx.stroke();
    const ang = Math.atan2(sy1 - sy0, sx1 - sx0);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(
      sx1 - head * Math.cos(ang - Math.PI / 7),
      sy1 - head * Math.sin(ang - Math.PI / 7)
    );
    ctx.lineTo(
      sx1 - head * Math.cos(ang + Math.PI / 7),
      sy1 - head * Math.sin(ang + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawStars(ctx, theta) {
    const rotAngle = frame === "star" ? 0 : -theta;
    for (const st of ship.current.stars) {
      const [x, y] = rot(st.x, st.y, rotAngle);
      const [sx, sy] = toScreen(ctx, x, y);
      ctx.globalAlpha = 0.55 + 0.45 * st.b;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, st.s * view.current.zoom, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShip(ctx, theta) {
    ctx.save();
    const { zoom } = view.current;
    const [cx, cy] = toScreen(ctx, 0, 0);
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.rotate(-theta); // ship rotates in star frame; θ=0 in ship frame draw

    // floor opacity: higher in ship frame
    const floorAlpha = frame === "ship" ? 0.14 : 0.06;

    // floor + rim
    ctx.lineWidth = 3 / zoom;
    ctx.strokeStyle = "#aaa";
    if (showFloor) {
      ctx.fillStyle = `rgba(200,200,200,${floorAlpha})`;
      ctx.beginPath();
      ctx.arc(0, 0, ship.current.R, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, ship.current.R, 0, 2 * Math.PI);
    ctx.stroke();

    // deck grid (fixed to ship)
    if (showFloor && showGrid) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1 / zoom;
      // spokes every 15°
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
          ship.current.R * Math.cos(a),
          ship.current.R * Math.sin(a)
        );
        ctx.stroke();
      }
      // rings each R/6
      for (let k = 1; k <= 5; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, k * ship.current.R / 6, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.restore();
    }

    // tick marks + “window” for orientation
    ctx.strokeStyle = "rgba(170,170,170,0.8)";
    ctx.lineWidth = 1.25 / zoom;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(
        (ship.current.R - 14) * Math.cos(a),
        (ship.current.R - 14) * Math.sin(a)
      );
      ctx.lineTo(
        (ship.current.R - 2) * Math.cos(a),
        (ship.current.R - 2) * Math.sin(a)
      );
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(120,180,255,0.9)";
    ctx.beginPath();
    ctx.arc(0, +ship.current.R * blueDotPosition, 12 / zoom, 0, 2 * Math.PI);
    ctx.fill();

    ctx.restore();
  }

  function drawTrail(ctx) {
    if (!showTrail || trailRef.current.length < 2) return;
    const col = frame === "ship" ? [126, 87, 194] : [34, 197, 94]; // purple / green
    const N = trailRef.current.length;
    const width = 2 * dpiScale;
    for (let i = 1; i < N; i++) {
      const p0 = trailRef.current[i - 1];
      const p1 = trailRef.current[i];
      const [sx0, sy0] = toScreen(ctx, p0.x, p0.y);
      const [sx1, sy1] = toScreen(ctx, p1.x, p1.y);
      // Fade tail: older segments get smaller alpha
      const t = i / N; // 0..1 (older..newer)
      const alpha = Math.pow(t, 2.2); // ease-in for nicer decay
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
  }

  function drawHUD(ctx) {
    const pad = 12 * dpiScale;
    ctx.save();
    ctx.translate(pad, pad);
    ctx.fillStyle = "rgba(17,17,17,0.6)";
    ctx.fillRect(0, 0, 270 * dpiScale, 104 * dpiScale);

    ctx.fillStyle = "#fff";
    ctx.font = `${14 *
      dpiScale}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`;
    ctx.fillText(
      `Frame: ${
        frame === "star" ? "Star (inertial)" : "Ship (rotating)"
      }`,
      10 * dpiScale,
      22 * dpiScale
    );
    const rpm = (omega / (2 * Math.PI)) * 60;
    ctx.fillText(
      `ω = ${omega.toFixed(2)} rad/s  (${rpm.toFixed(2)} rpm)`,
      10 * dpiScale,
      42 * dpiScale
    );

    if (state.current.placed) {
      const theta = omega * tRef.current;
      // speed in displayed frame
      const [vIxr, vIyr] = rot(state.current.vx, state.current.vy, -theta);
      const [rx, ry] = rot(state.current.x, state.current.y, -theta);
      const ship_vx = -omega * ry,
        ship_vy = omega * rx;
      const v_rel_x = vIxr - ship_vx,
        v_rel_y = vIyr - ship_vy;
      const vdisp =
        frame === "ship"
          ? mag(v_rel_x, v_rel_y)
          : mag(state.current.vx, state.current.vy);
      ctx.fillText(
        `|v| = ${vdisp.toFixed(2)} (units/s)`,
        10 * dpiScale,
        62 * dpiScale
      );
    }
    ctx.restore();
  }

  // ---------- main draw ----------
  function draw(dt) {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width: W, height: H } = canvas;

    if (running) tRef.current += dt;

    ctx.clearRect(0, 0, W, H);

    const theta = omega * tRef.current;

    // background stars
    drawStars(ctx, theta);

    // ship (rotates in star frame, fixed in ship frame)
    if (frame === "star") drawShip(ctx, theta);
    else drawShip(ctx, 0);

    // physics step (inertial)
    if (running) stepInertial(dt);

    const s = state.current;
    const [rx, ry] = rot(s.x, s.y, -theta); // position in ship axes
    const [vIxr, vIyr] = rot(s.vx, s.vy, -theta); // inertial velocity expressed in ship axes
    const ship_vx = -omega * ry,
      ship_vy = omega * rx; // Ω×r in ship axes
    const v_rel_x = vIxr - ship_vx; // relative velocity in rotating frame
    const v_rel_y = vIyr - ship_vy;

    const [wx, wy] = frame === "ship" ? [rx, ry] : [s.x, s.y];

    // trail
    if (running && s.placed) {
      const L = 3600;
      trailRef.current.push({ x: wx, y: wy });
      if (trailRef.current.length > L) trailRef.current.shift();
    }

    // object + vectors
    if (s.placed) {
      // velocity arrow (displayed as v_rel in ship frame, inertial v in star frame)
      if (showVelocity) {
        const [dvx, dvy] =
          frame === "ship" ? [v_rel_x, v_rel_y] : [s.vx, s.vy];
        drawArrow(
          ctx,
          wx,
          wy,
          wx + dvx * 0.25,
          wy + dvy * 0.25,
          "#10b981",
          3,
          12
        );
      }

      // fictitious accels in ship frame
      if (frame === "ship") {
        const wz = omega;
        const cor = [2 * wz * v_rel_y, -2 * wz * v_rel_x];
        // -2 Ω×v_rel
        const cen = (() => {
          const Omxr = cross2(wz, rx, ry);
          const Omx_Omxr = cross2(wz, Omxr[0], Omxr[1]);
          return [-Omx_Omxr[0], -Omx_Omxr[1]];
        })();
        const scale = 0.25;
        if (showCoriolis)
          drawArrow(
            ctx,
            rx,
            ry,
            rx + cor[0] * scale,
            ry + cor[1] * scale,
            "#ef4444",
            3,
            12
          );
        if (showCentrifugal)
          drawArrow(
            ctx,
            rx,
            ry,
            rx + cen[0] * scale,
            ry + cen[1] * scale,
            "#3b82f6",
            3,
            12
          );
      }

      // trail under point
      drawTrail(ctx);

      // object dot
      const [sx, sy] = toScreen(ctx, wx, wy);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx, sy, 5 * dpiScale, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // launch helper arrow during drag
    if (drag.current.dragging && state.current.placed) {
      const start = drag.current.startWorld;
      const cur = drag.current.currentWorld;
      const [sx0, sy0] =
        frame === "ship"
          ? rot(start.x, start.y, -theta)
          : [start.x, start.y];
      const [sx1, sy1] =
        frame === "ship" ? rot(cur.x, cur.y, -theta) : [cur.x, cur.y];
      drawArrow(ctx, sx0, sy0, sx1, sy1, "#f59e0b", 3, 12);
    }

    drawHUD(ctx);
  }

  // ---------- loop ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function loop(ts) {
      if (lastStampRef.current == null) lastStampRef.current = ts;
      const raw = (ts - lastStampRef.current) / 1000;
      lastStampRef.current = ts;
      const dt = clamp(raw, 0, 0.033);
      draw(dt);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    omega,
    frame,
    running,
    dpiScale,
    size.w,
    size.h,
    showCoriolis,
    showCentrifugal,
    showVelocity,
    showTrail,
    showFloor,
    showGrid,
  ]);

  // ---------- reset ----------
  function reset() {
    state.current = { x: 0, y: 0, vx: 0, vy: 0, placed: false };
    drag.current = {
      dragging: false,
      startWorld: null,
      currentWorld: null,
      hasVelocity: false,
    };
    trailRef.current = [];
    tRef.current = 0;
    view.current = { zoom: 1, pan: { x: 0, y: 0 } };
    panning.current.dragging = false;
  }

  // ---------- canvas DPR ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = Math.floor(size.w * dpiScale);
    canvas.height = Math.floor(size.h * dpiScale);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }, [size, dpiScale]);

  // ---------- UI ----------
  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr",
        placeItems: "center",
        gap: 12,
        padding: 12,
      }}
    >
      <div
        style={{
          width: "min(95vw,1200px)",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 10,
        }}
      >
        {/* Controls */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
            gap: 10,
            alignItems: "stretch",
          }}
        >
          <Card title="Reference Frame">
            <Row>
              <Btn active={frame === "star"} onClick={() => setFrame("star")}>
                Star (inertial)
              </Btn>
              <Btn active={frame === "ship"} onClick={() => setFrame("ship")}>
                Ship (rotating)
              </Btn>
            </Row>
            <Row>
              <Btn onClick={dropFromShipFrame}>Drop ball (ship frame)</Btn>
            </Row>
          </Card>

          <Card title="Angular Speed ω (rad/s)">
            <input
              type="range"
              min={-2 * Math.PI}
              max={2 * Math.PI}
              step={0.01}
              value={omega}
              onChange={(e) => setOmega(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
              }}
            >
              <span>{(-2 * Math.PI).toFixed(2)}</span>
              <span>{(2 * Math.PI).toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
              Current: <b>{omega.toFixed(2)}</b> rad/s &nbsp;|&nbsp; RPM:{" "}
              <b>{((omega / (2 * Math.PI)) * 60).toFixed(2)}</b>
            </div>
          </Card>

          <Card title="Overlays">
            <Check
              label="Velocity vector"
              checked={showVelocity}
              onChange={setShowVelocity}
            />
            <Check
              label="Coriolis acceleration (ship frame)"
              checked={showCoriolis}
              onChange={setShowCoriolis}
              disabled={frame !== "ship"}
              dim={frame !== "ship"}
            />
            <Check
              label="Centrifugal acceleration (ship frame)"
              checked={showCentrifugal}
              onChange={setShowCentrifugal}
              disabled={frame !== "ship"}
              dim={frame !== "ship"}
            />
            <Check
              label="Trail"
              checked={showTrail}
              onChange={setShowTrail}
            />
            <Check
              label="Deck grid"
              checked={showGrid}
              onChange={setShowGrid}
              disabled={!showFloor}
              dim={!showFloor}
            />
          </Card>

          <Card title="Simulation">
            <Row>
              <Btn
                active={running}
                onClick={() => setRunning((r) => !r)}
                aria-pressed={running}
              >
                {running ? "Pause" : "Play"}
              </Btn>
              <Btn onClick={reset}>Reset</Btn>
            </Row>
            <Check
              label="Large Ship"
              checked={largeShip}
              onChange={setLargeShip}
            />
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 8 }}>
              Click inside the ship to place the object, then drag to set its
              initial velocity.
            </div>
          </Card>


        </div>

        {/* Canvas area */}
        <div
          style={{
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(1000px 600px at 50% 50%, #0a1020, #050811 70%, #02050b 100%)",
            borderRadius: 16,
            padding: 8,
            boxShadow: "0 12px 26px rgba(0,0,0,0.35)",
          }}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}

// ---------- tiny UI helpers ----------
function Card({ title, children }) {
  return (
    <div
      style={{
        background: "#0b1220",
        color: "#e5e7eb",
        padding: 12,
        borderRadius: 12,
        boxShadow: "0 6px 14px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ children }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}
function Btn({ active, onClick, children, ...props }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: "none",
        border: "none",
        cursor: "pointer",
        padding: "10px 14px",
        borderRadius: 9999,
        fontWeight: 700,
        fontSize: 14,
        color: "#ffffff",
        background: active
          ? "linear-gradient(90deg,#ef4444,#f59e0b)"
          : "linear-gradient(90deg,#4f46e5,#06b6d4)",
        boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
      }}
      {...props}
    >
      {children}
    </button>
  );
}
function Check({ label, checked, onChange, disabled, dim }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        margin: "2px 0",
        fontSize: 14,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span style={{ marginLeft: 6, color: dim ? "#9ca3af" : "#fff" }}>
        {label}
      </span>
    </label>
  );
}
