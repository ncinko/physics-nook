import React, { useState, useEffect, useRef, useMemo } from "react";
import { choosePotentialLevels, traceContours } from "../../lib/electromagnetism/contours";
import { coulombFieldAt } from "../../lib/electromagnetism";
import { themeColors } from "../shared/themeColors";
import { ControlBar, Toggle, Button, Select } from "../shared/InlineControls";

// Cached potential map and contours at one linear voltage interval.
const ElectricPotentialExplorer = () => {
  const canvasRef = useRef(null);
  const k = 9e9; // Coulomb's constant

  // -------- Responsive sizing --------
  const ASPECT = 0.6; // height = aspect * width
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const computeSize = () => {
    const parent = canvasRef.current?.parentElement;
    const parentWidth = parent
      ? parent.getBoundingClientRect().width
      : window.innerWidth - 48;
    const w = clamp(parentWidth, 180, 900);
    return { width: Math.round(w), height: Math.round(w * ASPECT) };
  };

  const [size, setSize] = useState(computeSize());
  const prevSizeRef = useRef(size);

  const scaleSceneToNewSize = (oldSize, newSize) => {
    const sx = newSize.width / oldSize.width;
    const sy = newSize.height / oldSize.height;
    setCharges((prev) => prev.map((c) => ({ ...c, x: c.x * sx, y: c.y * sy })));
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
    { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.65 * W, y: 0.5 * H, q: -1e-6 },
  ];
  const capacitorConfig = (W, H) => {
    const rows = 7;
    const ys = Array.from({ length: rows }, (_, i) => ((i + 1) / (rows + 1)) * H);
    const leftX = 0.4 * W, rightX = 0.6 * W;
    const leftPlate = ys.map((y) => ({ x: leftX, y, q: 1e-6 }));
    const rightPlate = ys.map((y) => ({ x: rightX, y, q: -1e-6 }));
    return [...leftPlate, ...rightPlate];
  };

  // -------- State --------
  const [configuration, setConfiguration] = useState("dipole");
  const [charges, setCharges] = useState(() => dipoleConfig(size.width, size.height));
  const [draggingChargeIndex, setDraggingChargeIndex] = useState(null);
  const [draggingTestCharge, setDraggingTestCharge] = useState(false);
  const [animateTestCharge, setAnimateTestCharge] = useState(false);
  // What an empty-space tap does. Gives touch users the actions that are
  // Shift-click / Ctrl-click on a keyboard.
  const [tapAction, setTapAction] = useState("positive");

  // Field arrows & lines toggles
  const [showArrows, setShowArrows] = useState(true);
  const [showFieldLines, setShowFieldLines] = useState(false);
  const [linesPerMicroC, setLinesPerMicroC] = useState(12);
  const [maxStreamlines, setMaxStreamlines] = useState(100);

  // Potential colormap & equipotentials
  const [showColormap, setShowColormap] = useState(true);
  const [showEquipotentials, setShowEquipotentials] = useState(true);
  const [logColors, setLogColors] = useState(true); // log mapping for dynamic range
  const [quality, setQuality] = useState(0.6); // 0.4..1 recommended

  // Cached colormap + contours so we don't recompute in every frame
  const colorCacheRef = useRef({ imageBitmap: null, w: 0, h: 0 });
  const contourCacheRef = useRef({ paths: [], w: 0, h: 0 });
  const [contourInfo, setContourInfo] = useState({ step: 1, levels: [] });

  const initialTestChargeFromSize = (W, H) => ({ x: 0.5 * W, y: 0.33 * H, vx: 0, vy: 0, q: 1e-8, m: 1e-6 });
  const testChargeRef = useRef(initialTestChargeFromSize(size.width, size.height));

  const accelerationScale = 10000;

  // Helpers
  // Rect-relative CSS pixels. The backing store is devicePixelRatio-scaled but
  // the 2D context carries a matching `setTransform`, so scene coordinates are
  // CSS pixels — don't rescale by canvas.width/rect.width here.
  const getPointerPos = (canvas, evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const computeField = (x, y, localCharges = charges) => {
    // Softened (5 px core) superposition field; physics lives in the lib.
    const f = coulombFieldAt(localCharges, x, y, 25);
    return { Ex: f.x, Ey: f.y };
  };

  const computePotential = (x, y, localCharges = charges) => {
    // V = k Σ q / r  (softened with 5 px core to avoid infinities)
    let V = 0;
    for (const c of localCharges) {
      const dx = x - c.x, dy = y - c.y;
      const r = Math.hypot(dx, dy);
      const rSoft = Math.sqrt(r * r + 25); // soften with same 5 px core
      V += (k * c.q) / rSoft;
    }
    return V;
  };

  const distToAnyCharge = (x, y, localCharges = charges) => localCharges.reduce((d, c) => Math.min(d, Math.hypot(x - c.x, y - c.y)), Infinity);

  // --- Field lines helpers ---
  const norm2 = (x, y) => { const m = Math.hypot(x, y) || 1e-12; return [x / m, y / m]; };

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

    let [uxPrev, uyPrev] = fieldUnit(x, y);

    for (let i = 0; i < maxSteps; i++) {
      const dNear = distToAnyCharge(x, y);
      const nearFactor = Math.max(0.25, Math.min(1, (dNear - 8) / 40));
      let h = baseStepPx * nearFactor;

      const [k1x, k1y] = fieldUnit(x, y);
      const [k2x, k2y] = fieldUnit(x + 0.5 * h * k1x, y + 0.5 * h * k1y);
      const [k3x, k3y] = fieldUnit(x + 0.5 * h * k2x, y + 0.5 * h * k2y);
      const [k4x, k4y] = fieldUnit(x + h * k3x, y + h * k3y);

      let dx = (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      let dy = (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);

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

      x += dx; y += dy;
      ctx.lineTo(x, y);
      [uxPrev, uyPrev] = [uxCurr, uyCurr];

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
    const r0 = 10;
    let streamlineCount = 0;

    for (const c of charges) {
      if (streamlineCount >= maxStreamlines) break;
      const muC = Math.abs(c.q) / 1e-6;
      const N = Math.max(4, Math.min(24, Math.round(linesPerMicroC * muC)));
      for (let k = 0; k < N; k++) {
        if (streamlineCount >= maxStreamlines) break;
        const theta = (2 * Math.PI * k) / N;
        const sx = c.x + r0 * Math.cos(theta);
        const sy = c.y + r0 * Math.sin(theta);
        const dir = c.q >= 0 ? +1 : -1; // from +q outward, into –q
        traceFieldLine(ctx, sx, sy, dir, baseStepPx, maxSteps);
        streamlineCount++;
      }
    }
  };

  const divergingColor = (t) => {
    // t in [-1,1]; -1 deep blue, 0 white, +1 deep red
    t = Math.max(-1, Math.min(1, t));
    const w = 1 - Math.abs(t); // whiteness toward center
    const to255 = (x) => Math.max(0, Math.min(255, Math.round(x)));

    // endpoints
    const neg = [30, 90, 200];  // blue
    const pos = [230, 60, 50];  // red

    const base = t < 0 ? neg : pos;
    const r = base[0] * Math.abs(t) + 255 * w;
    const g = base[1] * Math.abs(t) + 255 * w;
    const b = base[2] * Math.abs(t) + 255 * w;
    return [to255(r), to255(g), to255(b)];
  }

  // --- Potential colormap generation (cached) ---
  const regenerateColormapAndContours = useMemo(() => {
    return () => {
      if (!showColormap && !showEquipotentials) return; // nothing to do
      const W = Math.max(64, Math.round(size.width * quality));
      const H = Math.max(64, Math.round(size.height * quality));

      // Sample potential on a coarse grid for speed
      const V = new Float32Array(W * H);
      let vMin = Infinity, vMax = -Infinity;
      for (let j = 0; j < H; j++) {
        const y = (j / (H - 1)) * size.height;
        for (let i = 0; i < W; i++) {
          const x = (i / (W - 1)) * size.width;
          const v = computePotential(x, y);
          V[j * W + i] = v;
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
      }

      // Symmetric range about 0 for diverging colors; robust clip (winsorize)
      const absVals = [];
      for (let s = 0; s < V.length; s += Math.max(1, Math.floor((W * H) / 5000))) absVals.push(Math.abs(V[s]));
      absVals.sort((a, b) => a - b);
      const qIdx = Math.max(0, Math.min(absVals.length - 1, Math.floor(absVals.length * 0.98)));
      const Vabs = absVals[qIdx] || Math.max(Math.abs(vMin), Math.abs(vMax)) || 1;
      const Vscale = Vabs; // map [-Vscale, Vscale] to [-1, 1]

      // Build ImageData (offscreen)
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const ictx = off.getContext("2d");
      const img = ictx.createImageData(W, H);
      const data = img.data;

      const logAlpha = 1 / (Vscale * 0.2 + 1e-9); // mapping strength
      const logDen = Math.log(1 + logAlpha * Vscale);

      let p = 0;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          let v = V[j * W + i];
          // Normalize and optionally log-map, preserving sign
          let t = clamp(v / Vscale, -1, 1);
          if (logColors) {
            const sgn = Math.sign(t);
            const a = Math.log(1 + logAlpha * Math.abs(t) * Vscale) / logDen; // 0..1
            t = sgn * a; // -1..1
          }
          const [r, g, b] = divergingColor(t);
          data[p++] = r; data[p++] = g; data[p++] = b; data[p++] = 255;
        }
      }
      ictx.putImageData(img, 0, 0);

      // A synchronous canvas cache cannot be overwritten by an older bitmap
      // promise after a fast drag or preset change.
      colorCacheRef.current = { imageBitmap: off, w: W, h: H };

      if (showEquipotentials) {
        // Use a fixed screen resolution independent of the color transfer
        // function, and exclude a small disk around each charge marker.
        const cols = Math.ceil(size.width / 4) + 1;
        const rows = Math.ceil(size.height / 4) + 1;
        const grid = new Float64Array(cols * rows);
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const x = i / (cols - 1) * size.width;
            const y = j / (rows - 1) * size.height;
            grid[j * cols + i] = distToAnyCharge(x, y) < 16
              ? NaN : computePotential(x, y);
          }
        }
        const info = choosePotentialLevels(grid, size.width < 500 ? 4 : 7);
        const contours = traceContours(grid, cols, rows, size.width, size.height, info.levels);
        const paths = contours.filter(c => c.segments.length).map(({ level, segments }) => {
          const path = new Path2D();
          for (const [a, b] of segments) {
            path.moveTo(...a);
            path.lineTo(...b);
          }
          // A label away from the frame and charge cores, once per level.
          const candidates = segments.map(s => s[0]).filter(([x, y]) =>
            x > 40 && x < size.width - 40 && y > 18 && y < size.height - 18);
          const label = candidates[Math.floor(candidates.length * 0.65)];
          return { path, level, label };
        });
        contourCacheRef.current = { paths, w: cols, h: rows };
        setContourInfo({ ...info, levels: paths.map(p => p.level) });
      } else {
        contourCacheRef.current = { paths: [], w: W, h: H };
      }

    }
  }, [size.width, size.height, charges, quality, logColors, showColormap, showEquipotentials]);

  // Regenerate when dependencies change
  useEffect(() => {
    // Throttle regeneration a bit while dragging to reduce flicker
    const isDragging = draggingTestCharge || draggingChargeIndex !== null;
    const delay = isDragging ? 80 : 0; // ms
    let frame;
    const id = setTimeout(() => {
      frame = requestAnimationFrame(regenerateColormapAndContours);
    }, delay);
    return () => { clearTimeout(id); cancelAnimationFrame(frame); };
  }, [regenerateColormapAndContours, draggingTestCharge, draggingChargeIndex]);

  // Config change
  const handleConfigurationChange = (newConfig) => {
    setConfiguration(newConfig);
    const { width: W, height: H } = size;
    if (newConfig === "dipole") setCharges(dipoleConfig(W, H));
    else if (newConfig === "capacitor") setCharges(capacitorConfig(W, H));
    else if (newConfig === "monopole") setCharges(monopoleConfig(W, H));
    testChargeRef.current = initialTestChargeFromSize(W, H);
    setAnimateTestCharge(false);
  };

  // Pointer handlers. Touch has no modifier keys, so the `tapAction` picker is
  // the primary way to choose add-negative/remove; Shift and Ctrl/Cmd stay on as
  // desktop shortcuts that override whatever the picker is set to.
  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    // Capture keeps a drag alive past the canvas edge, but it throws if the
    // pointer is already gone — that must not abort the rest of the handler.
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released */
    }
    const { x, y } = getPointerPos(canvas, e);

    // Never delete the test charge; prioritize dragging it
    const dxT = x - testChargeRef.current.x;
    const dyT = y - testChargeRef.current.y;
    if (Math.hypot(dxT, dyT) < 8) { setDraggingTestCharge(true); return; }

    // Touch targets need more slop than a mouse cursor does.
    const hitRadius = e.pointerType === "mouse" ? 10 : 18;
    const idx = charges.findIndex((c) => Math.hypot(x - c.x, y - c.y) < hitRadius);

    // Ctrl-click (or Cmd on Mac) deletes a source charge
    if (idx !== -1 && (e.ctrlKey || e.metaKey || tapAction === "remove")) {
      setCharges((prev) => prev.filter((_, i) => i !== idx));
      return;
    }

    if (idx !== -1) {
      setDraggingChargeIndex(idx);
    } else if (tapAction !== "remove") {
      const negative = e.shiftKey || tapAction === "negative";
      const newCharge = { x, y, q: negative ? -1e-6 : 1e-6 };
      setCharges((prev) => [...prev, newCharge]);
    }
  };

  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    const { x, y } = getPointerPos(canvas, e);
    if (draggingTestCharge) {
      testChargeRef.current = { ...testChargeRef.current, x, y, vx: 0, vy: 0 };
    } else if (draggingChargeIndex !== null) {
      setCharges((prev) => {
        const next = [...prev];
        next[draggingChargeIndex] = { ...next[draggingChargeIndex], x, y };
        return next;
      });
    }
  };

  const handlePointerUp = () => { setDraggingTestCharge(false); setDraggingChargeIndex(null); };

  const resetSimulation = () => {
    const { width: W, height: H } = size;
    if (configuration === "dipole") setCharges(dipoleConfig(W, H));
    else if (configuration === "capacitor") setCharges(capacitorConfig(W, H));
    else if (configuration === "monopole") setCharges(monopoleConfig(W, H));
    testChargeRef.current = initialTestChargeFromSize(W, H);
    setAnimateTestCharge(false);
  };

  // Bind events to canvas. Pointer capture keeps a drag alive past the canvas
  // edge, so there's no `pointerleave` teardown to pair with `mouseleave`.
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingTestCharge, draggingChargeIndex, charges, tapAction]);

  // Animation
  useEffect(() => {
    let animationFrameId;
    let lastTime = performance.now();
    let mounted = true;

    const animate = (time) => {
      if (!mounted) return;
      const canvas = canvasRef.current;
      if (!canvas) { animationFrameId = requestAnimationFrame(animate); return; }

      const rawDt = (time - lastTime) / 1000; const dt = Math.min(rawDt, 0.033); lastTime = time;
      const { width, height } = size;

      // HiDPI/crisp
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      const palette = themeColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);

      // Draw potential colormap (cached image)
      if (showColormap && colorCacheRef.current.imageBitmap) {
        ctx.drawImage(colorCacheRef.current.imageBitmap, 0, 0, width, height);
      }

      // Equipotential paths (draw over the colormap)
      if (showEquipotentials && contourCacheRef.current.paths.length) {
        ctx.save();
        ctx.lineWidth = 1.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.75;
        for (const { path, level } of contourCacheRef.current.paths) {
          // A halo keeps themed lines legible on both ends of the colormap.
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = level === 0 ? 4 : 3;
          ctx.stroke(path);
          ctx.strokeStyle = palette.text;
          ctx.lineWidth = level === 0 ? 2.2 : 1.4;
          ctx.stroke(path);
        }
        ctx.globalAlpha = 1;
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labels = [];
        for (const { level, label } of contourCacheRef.current.paths) {
          if (!label) continue;
          const [x, y] = label;
          if (labels.some(([lx, ly]) => Math.abs(lx - x) < 64 && Math.abs(ly - y) < 22)) continue;
          const text = `${level.toLocaleString()} V`;
          const w = ctx.measureText(text).width + 8;
          ctx.fillStyle = palette.surface;
          ctx.fillRect(x - w / 2, y - 8, w, 16);
          ctx.fillStyle = palette.text;
          ctx.fillText(text, x, y);
          labels.push(label);
        }
        ctx.restore();
      }

      // Field arrows
      if (showArrows) {
        const spacing = Math.max(20, Math.round(Math.min(width, height) / 20));
        const arrowLength = 15;
        const arrowHeadSize = 5; // Size of the arrow head
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = palette.text;
        for (let x = spacing; x < width; x += spacing) {
          for (let y = spacing; y < height; y += spacing) {
            const { Ex, Ey } = computeField(x, y);
            const E_mag = Math.hypot(Ex, Ey);
            const angle = Math.atan2(Ey, Ex);
            const toX = x + arrowLength * Math.cos(angle);
            const toY = y + arrowLength * Math.sin(angle);
            ctx.globalAlpha = Math.min(1, E_mag * 0.03);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(toX, toY);

            // Draw arrowhead
            ctx.moveTo(toX, toY);
            ctx.lineTo(toX - arrowHeadSize * Math.cos(angle - Math.PI / 6), toY - arrowHeadSize * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(toX, toY);
            ctx.lineTo(toX - arrowHeadSize * Math.cos(angle + Math.PI / 6), toY - arrowHeadSize * Math.sin(angle + Math.PI / 6));

            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Optional field lines overlay
      drawFieldLines(ctx);

      // Charges
      charges.forEach((c) => {
        ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = c.q > 0 ? palette.positive : palette.negative; ctx.fill();
        ctx.strokeStyle = palette.text; ctx.stroke();
      });

      // Test charge (integrate if animating)
      let { x, y, vx, vy, q, m } = testChargeRef.current;
      if (animateTestCharge && !draggingTestCharge) {
        const { Ex, Ey } = computeField(x, y);
        const ax = (q / m) * Ex * accelerationScale;
        const ay = (q / m) * Ey * accelerationScale;
        vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
        if (x < 0 || x > size.width || y < 0 || y > size.height) {
          setAnimateTestCharge(false);
        } else {
          testChargeRef.current = { x, y, vx, vy, q, m };
        }
      }
      ctx.beginPath(); ctx.arc(testChargeRef.current.x, testChargeRef.current.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = palette.probe; ctx.fill(); ctx.strokeStyle = palette.text; ctx.stroke();

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => { mounted = false; cancelAnimationFrame(animationFrameId); };
  }, [charges, animateTestCharge, draggingTestCharge, showFieldLines, linesPerMicroC, maxStreamlines, size, showColormap, showArrows, showEquipotentials]);

  // UI
  return (
    <div style={{ textAlign: "center", color: "var(--text-primary)" }}>
      <ControlBar className="mb-2">
        <Select
          label="Configuration"
          value={configuration}
          onChange={handleConfigurationChange}
          options={[
            { value: "monopole", label: "Monopole" },
            { value: "dipole", label: "Dipole" },
            { value: "capacitor", label: "Capacitor Plates" },
          ]}
        />
        <Select
          label="Tap action"
          value={tapAction}
          onChange={setTapAction}
          options={[
            { value: "positive", label: "Add positive (+)" },
            { value: "negative", label: "Add negative (−)" },
            { value: "remove", label: "Remove charge" },
          ]}
        />
        <Toggle label="Potential colormap" checked={showColormap} onChange={setShowColormap} />
        <Toggle label="Equipotential lines" checked={showEquipotentials} onChange={setShowEquipotentials} />
        <Toggle label="Field arrows" checked={showArrows} onChange={setShowArrows} />
        <Toggle label="Field lines" checked={showFieldLines} onChange={setShowFieldLines} />
      </ControlBar>

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
          background: "var(--sim-bg)",
        }}
      />

      {showEquipotentials && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {contourInfo.levels.length ? <>
            Contour interval: <strong>{contourInfo.step.toLocaleString()} V</strong>.
            {" "}Shown: {Math.min(...contourInfo.levels).toLocaleString()} to {Math.max(...contourInfo.levels).toLocaleString()} V.
            {" "}The interval adapts to the charge configuration; extreme values and charge cores are omitted to limit clutter.
          </> : "No contours in this view: the potential is constant or the contour range is too small."}
          {" "}Equal voltage steps do not mean equal distances between lines.
        </p>
      )}
      <ControlBar className="mt-2">
        <Button variant="secondary" onClick={resetSimulation}>Reset Simulation</Button>
        <Button onClick={() => setAnimateTestCharge(true)} disabled={animateTestCharge}>
          {animateTestCharge ? "Test Charge Animating" : "Start Test Charge Animation"}
        </Button>
      </ControlBar>

      <p style={{ marginTop: "0.5rem" }}>
        Tap empty space to place a charge, using <strong>Tap action</strong> to pick whether it is positive, negative, or a removal. Drag a charge to move it, and drag the green test charge to reposition it. With a keyboard you can skip the picker: <strong>Shift-click</strong> places a negative charge and <strong>Ctrl-click</strong> (or ⌘-click) removes one.
      </p>
    </div>
  );
};

export default ElectricPotentialExplorer;
