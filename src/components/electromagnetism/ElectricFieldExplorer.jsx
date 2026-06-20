import React, { useState, useEffect, useRef } from "react";
import { coulombFieldAt } from "../../lib/electromagnetism";
import { themeColors } from "../shared/themeColors";

const ElectricFieldExplorer = () => {
  const canvasRef = useRef(null);

  // -------- Responsive sizing --------
  const ASPECT = 0.6; // height = aspect * width
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
  const prevSizeRef = useRef(size);

  const scaleSceneToNewSize = (oldSize, newSize) => {
    const sx = newSize.width / oldSize.width;
    const sy = newSize.height / oldSize.height;
    setCharges((prev) =>
      prev.map((c) => ({ ...c, x: c.x * sx, y: c.y * sy }))
    );
    const t = testChargeRef.current;
    testChargeRef.current = { ...t, x: t.x * sx, y: t.y * sy };
  };

  useEffect(() => {
    const update = () => {
      const newSize = computeSize();
      const old = prevSizeRef.current;
      if (newSize.width !== old.width || newSize.height !== old.height) {
        setSize(newSize);
        scaleSceneToNewSize(old, newSize);
        prevSizeRef.current = newSize;
      }
    };
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

  // -------- Presets relative to size --------
  const monopoleConfig = (W, H) => [{ x: 0.5 * W, y: 0.5 * H, q: 1e-6 }];
  const dipoleConfig = (W, H) => [
    { x: 0.3 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.7 * W, y: 0.5 * H, q: -1e-6 },
  ];
  const capacitorConfig = (W, H) => {
    const rows = 5;
    const ys = Array.from(
      { length: rows },
      (_, i) => ((i + 1) / (rows + 1)) * H
    );
    const leftX = 0.2 * W,
      rightX = 0.8 * W;
    const leftPlate = ys.map((y) => ({ x: leftX, y, q: 1e-6 }));
    const rightPlate = ys.map((y) => ({ x: rightX, y, q: -1e-6 }));
    return [...leftPlate, ...rightPlate];
  };

  // -------- State --------
  const [configuration, setConfiguration] = useState("dipole");
  const [charges, setCharges] = useState(() =>
    dipoleConfig(size.width, size.height)
  );
  const [draggingChargeIndex, setDraggingChargeIndex] = useState(null);
  const [draggingTestCharge, setDraggingTestCharge] = useState(false);
  const [animateTestCharge, setAnimateTestCharge] = useState(false);

  // Field lines UI
  const [showFieldLines, setShowFieldLines] = useState(false);
  const [linesPerMicroC, setLinesPerMicroC] = useState(12);

  const initialTestChargeFromSize = (W, H) => ({
    x: 0.5 * W,
    y: 0.33 * H,
    vx: 0,
    vy: 0,
    q: 1e-8,
    m: 1e-6,
  });
  const testChargeRef = useRef(
    initialTestChargeFromSize(size.width, size.height)
  );

  const accelerationScale = 10000;


  // Helpers
  const getMousePos = (canvas, evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const computeField = (x, y, localCharges = charges) => {
    // Softened (5 px core) superposition field; physics lives in the lib.
    const f = coulombFieldAt(localCharges, x, y, 25);
    return { Ex: f.x, Ey: f.y };
  };

  const drawArrow = (ctx, fromX, fromY, toX, toY, opacity, color = "#000") => {
    const headLength = 8;
    const dx = toX - fromX, dy = toY - fromY;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6),
               toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6),
               toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // --- Field lines helpers ---
  const norm2 = (x, y) => {
    const m = Math.hypot(x, y) || 1e-12;
    return [x / m, y / m];
  };
  const distToAnyCharge = (x, y, localCharges = charges) =>
    localCharges.reduce((d, c) => Math.min(d, Math.hypot(x - c.x, y - c.y)), Infinity);
  

  // --- RK4 streamline integrator with adaptive step on curvature ---
const traceFieldLine = (ctx, x0, y0, dir, baseStepPx, maxSteps) => {
  let x = x0, y = y0;
  ctx.beginPath();
  ctx.moveTo(x, y);

  const fieldUnit = (X, Y) => {
    const { Ex, Ey } = computeField(X, Y);
    let [ux, uy] = norm2(Ex, Ey);
    return [ux * dir, uy * dir];
  };

  const turnAngle = (ax, ay, bx, by) => {
    const dot = Math.max(-1, Math.min(1, ax * bx + ay * by));
    return Math.acos(dot);
  };

  // initialize previous direction from local field
  let [uxPrev, uyPrev] = fieldUnit(x, y);

  for (let i = 0; i < maxSteps; i++) {
    // distance-based step shrink near charges
    const dNear = distToAnyCharge(x, y);
    const nearFactor = Math.max(0.25, Math.min(1, (dNear - 8) / 40)); // 0.25..1
    let h = baseStepPx * nearFactor;

    // RK4 in the unit direction field
    const [k1x, k1y] = fieldUnit(x, y);
    const [k2x, k2y] = fieldUnit(x + 0.5 * h * k1x, y + 0.5 * h * k1y);
    const [k3x, k3y] = fieldUnit(x + 0.5 * h * k2x, y + 0.5 * h * k2y);
    const [k4x, k4y] = fieldUnit(x + h * k3x, y + h * k3y);

    let dx = (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    let dy = (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);

    // anti-backtracking: if we flipped  > 90°, reduce step and retry once
    let [uxCurr, uyCurr] = norm2(dx, dy);
    if (uxCurr * uxPrev + uyCurr * uyPrev < 0) {
      h *= 0.5;
      const [k1x2, k1y2] = fieldUnit(x, y);
      const [k2x2, k2y2] = fieldUnit(x + 0.5 * h * k1x2, y + 0.5 * h * k1y2);
      const [k3x2, k3y2] = fieldUnit(x + 0.5 * h * k2x2, y + 0.5 * h * k2y2);
      const [k4x2, k4y2] = fieldUnit(x + h * k3x2, y + h * k3y2);
      dx = (h / 6) * (k1x2 + 2 * k2x2 + 2 * k3x2 + k4x2);
      dy = (h / 6) * (k1y2 + 2 * k2y2 + 2 * k3y2 + k4y2);
      [uxCurr, uyCurr] = norm2(dx, dy);
    }

    // curvature limiter: if turn > 30°, take a half-step
    const dTheta = turnAngle(uxPrev, uyPrev, uxCurr, uyCurr);
    if (dTheta > Math.PI / 6) { dx *= 0.5; dy *= 0.5; }

    x += dx; y += dy;
    ctx.lineTo(x, y);
    [uxPrev, uyPrev] = [uxCurr, uyCurr];

    // termination
    if (x < 0 || x > size.width || y < 0 || y > size.height) break;
    if (distToAnyCharge(x, y) < 10) break;
  }
  ctx.stroke();
};


  const drawFieldLines = (ctx) => {
    if (!showFieldLines) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = themeColors().muted;

    const baseStepPx = Math.max(0.75, Math.min(size.width, size.height) / 500);
    const maxSteps = 2000;

    // ↑ modestly larger to get outside the highest-curvature core
    const r0 = 10; // was 12

    for (const c of charges) {
      const muC = Math.abs(c.q) / 1e-6;
      const N = Math.max(4, Math.min(24, Math.round(linesPerMicroC * muC)));
      for (let k = 0; k < N; k++) {
        const theta = (2 * Math.PI * k) / N;
        const sx = c.x + r0 * Math.cos(theta);
        const sy = c.y + r0 * Math.sin(theta);
        const dir = c.q >= 0 ? +1 : -1; // from +q outward, into –q
        traceFieldLine(ctx, sx, sy, dir, baseStepPx, maxSteps);
      }
    }
  };


  // Config change
  const handleConfigurationChange = (e) => {
    const newConfig = e.target.value;
    setConfiguration(newConfig);
    const { width: W, height: H } = size;
    if (newConfig === "dipole") {
      setCharges(dipoleConfig(W, H));
    } else if (newConfig === "capacitor") {
      setCharges(capacitorConfig(W, H));
    } else if (newConfig === "monopole") {
      setCharges(monopoleConfig(W, H));
    }
    testChargeRef.current = initialTestChargeFromSize(W, H);
    setAnimateTestCharge(false);
  };

  // Mouse handlers (with Ctrl-click delete)
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const { x, y } = getMousePos(canvas, e);

    // Never delete the test charge; prioritize dragging it
    const dxT = x - testChargeRef.current.x;
    const dyT = y - testChargeRef.current.y;
    if (Math.hypot(dxT, dyT) < 8) {
      setDraggingTestCharge(true);
      return;
    }

    const idx = charges.findIndex(c => Math.hypot(x - c.x, y - c.y) < 10);

    // Ctrl-click (or Cmd on Mac) deletes a source charge
    if (idx !== -1 && (e.ctrlKey || e.metaKey)) {
      setCharges(prev => prev.filter((_, i) => i !== idx));
      return;
    }

    if (idx !== -1) {
      setDraggingChargeIndex(idx);
    } else {
      const newCharge = { x, y, q: e.shiftKey ? -1e-6 : 1e-6 };
      setCharges(prev => [...prev, newCharge]);
    }
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const { x, y } = getMousePos(canvas, e);
    if (draggingTestCharge) {
      testChargeRef.current = { ...testChargeRef.current, x, y, vx: 0, vy: 0 };
    } else if (draggingChargeIndex !== null) {
      setCharges(prev => {
        const next = [...prev];
        next[draggingChargeIndex] = { ...next[draggingChargeIndex], x, y };
        return next;
      });
    }
  };

  const handleMouseUp = () => {
    setDraggingTestCharge(false);
    setDraggingChargeIndex(null);
  };

  const resetSimulation = () => {
    const { width: W, height: H } = size;
    if (configuration === "dipole") {
      setCharges(dipoleConfig(W, H));
    } else if (configuration === "capacitor") {
      setCharges(capacitorConfig(W, H));
    } else if (configuration === "monopole") {
      setCharges(monopoleConfig(W, H));
    }
    testChargeRef.current = initialTestChargeFromSize(W, H);
    setAnimateTestCharge(false);
  };

  // Bind events to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [draggingTestCharge, draggingChargeIndex, charges]);

  // Animation
  useEffect(() => {
    let animationFrameId;
    let lastTime = performance.now();
    let mounted = true;

    const animate = (time) => {
      if (!mounted) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      // dt with cap
      const rawDt = (time - lastTime) / 1000;
      const dt = Math.min(rawDt, 0.033);
      lastTime = time;

      const { width, height } = size;

      // HiDPI/crisp
      if (canvas.width !== width || canvas.height !== height) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const palette = themeColors();
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);

      // Field arrows
      const spacing = Math.max(20, Math.round(Math.min(width, height) / 20));
      const arrowLength = 15;
      const opacityScale = 0.01;
      for (let x = spacing; x < width; x += spacing) {
        for (let y = spacing; y < height; y += spacing) {
          const { Ex, Ey } = computeField(x, y);
          const E_mag = Math.hypot(Ex, Ey);
          const angle = Math.atan2(Ey, Ex);
          const toX = x + arrowLength * Math.cos(angle);
          const toY = y + arrowLength * Math.sin(angle);
          drawArrow(ctx, x, y, toX, toY, Math.min(1, E_mag * opacityScale), palette.text);
        }
      }

      // Optional field lines overlay
      drawFieldLines(ctx);

      // Charges
      charges.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = c.q > 0 ? palette.positive : palette.negative;
        ctx.fill();
        ctx.strokeStyle = palette.text;
        ctx.stroke();
      });

      // Test charge
      let { x, y, vx, vy, q, m } = testChargeRef.current;
      if (animateTestCharge && !draggingTestCharge) {
        const { Ex, Ey } = computeField(x, y);
        const ax = (q / m) * Ex * accelerationScale;
        const ay = (q / m) * Ey * accelerationScale;
        vx += ax * dt;
        vy += ay * dt;
        x += vx * dt;
        y += vy * dt;

        if (x < 0 || x > size.width || y < 0 || y > size.height) {
          setAnimateTestCharge(false);
        } else {
          testChargeRef.current = { x, y, vx, vy, q, m };
        }
      }
      ctx.beginPath();
      ctx.arc(testChargeRef.current.x, testChargeRef.current.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = palette.probe;
      ctx.fill();
      ctx.strokeStyle = palette.text;
      ctx.stroke();

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => {
      mounted = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [charges, animateTestCharge, draggingTestCharge, showFieldLines, linesPerMicroC, size]);

  return (
    <div style={{ textAlign: "center", color: "var(--text-primary)" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        <label htmlFor="configuration">Select Configuration: </label>
        <select
          id="configuration"
          value={configuration}
          onChange={handleConfigurationChange}
        >
          <option value="monopole">Monopole</option>
          <option value="dipole">Dipole</option>
          <option value="capacitor">Capacitor Plates</option>
        </select>

        <label style={{ marginLeft: 12 }}>
          <input
            type="checkbox"
            checked={showFieldLines}
            onChange={(e) => setShowFieldLines(e.target.checked)}
          />{" "}
          Show field lines
        </label>

        <label
          style={{ marginLeft: 8, opacity: showFieldLines ? 1 : 0.5 }}
        >
          Density:
          <input
            type="range"
            min="4"
            max="24"
            value={linesPerMicroC}
            onChange={(e) => setLinesPerMicroC(+e.target.value)}
            disabled={!showFieldLines}
          />
        </label>
      </div>

      {/* Responsive, centered canvas */}
      <canvas
        ref={canvasRef}
        style={{
          border: "1px solid var(--grid-line)",
          borderRadius: 12,
          cursor: "pointer",
          maxWidth: "100%",
          height: "auto",
          display: "block",
          marginInline: "auto",
          touchAction: "none",
        }}
      />

      <div style={{ marginTop: "0.5rem" }}>
        <button onClick={resetSimulation}>Reset Simulation</button>
        <button
          onClick={() => setAnimateTestCharge(true)}
          disabled={animateTestCharge}
          style={{ marginLeft: 8 }}
        >
          {animateTestCharge
            ? "Test Charge Animating"
            : "Start Test Charge Animation"}
        </button>
      </div>

      <p style={{ marginTop: "0.5rem" }}>
        Click to add a charge (Shift = negative). Drag to move.{" "}
        <strong>Ctrl-click</strong> (or ⌘-click on Mac) a charge to remove
        it. Drag the green test charge to reposition it.
      </p>
    </div>
  );
};

export default ElectricFieldExplorer;