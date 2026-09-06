import React, { useState, useEffect, useRef, useMemo } from "react";
import { choosePotentialLevels, traceContours, nearestContour } from "../../lib/electromagnetism/contours";
import { computeFieldLines } from "../../lib/electromagnetism/fieldLines";
import { coulombFieldAt } from "../../lib/electromagnetism";
import { themeColors, onThemeChange, cssColorToRgb, ensureContrast } from "../shared/themeColors";
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
  // A budget, not a truncation: over it, every charge's share shrinks together
  // so the drawn density still reads as flux.
  const [maxFieldLines, setMaxFieldLines] = useState(200);

  // Bumped whenever the active theme changes. The animation loop re-reads the
  // palette every frame on its own, but the colormap is a cached bitmap baked
  // from the old theme's colors, so it has to be told to rebuild.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);

  // Potential colormap & equipotentials
  const [showColormap, setShowColormap] = useState(true);
  const [showEquipotentials, setShowEquipotentials] = useState(true);
  const [logColors, setLogColors] = useState(true); // log mapping for dynamic range
  const [quality, setQuality] = useState(0.6); // 0.4..1 recommended

  // Cached colormap + contours so we don't recompute in every frame
  const colorCacheRef = useRef({ imageBitmap: null, w: 0, h: 0 });
  const contourCacheRef = useRef({ paths: [], w: 0, h: 0 });
  const fieldLinePathRef = useRef(null);
  const hoveredContourRef = useRef(null);

  const initialTestChargeFromSize = (W, H) => ({ x: 0.5 * W, y: 0.33 * H, vx: 0, vy: 0, q: 1e-8, m: 1e-6 });
  const testChargeRef = useRef(initialTestChargeFromSize(size.width, size.height));

  const accelerationScale = 10000;

  // Helpers
  // Rect-relative CSS pixels. The backing store is devicePixelRatio-scaled but
  // the 2D context carries a matching `setTransform`, so scene coordinates are
  // CSS pixels — don't rescale by canvas.width/rect.width here.
  const getPointerPos = (canvas, evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (evt.clientX - rect.left) * size.width / rect.width,
      y: (evt.clientY - rect.top) * size.height / rect.height };
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

  // --- Field lines (traced in the lib, cached as one Path2D) ---
  // Tracing is far too expensive to redo on every animation frame, and the
  // result only depends on the scene, so it is cached like the colormap is.
  const regenerateFieldLines = useMemo(() => {
    return () => {
      if (!showFieldLines) { fieldLinePathRef.current = null; return; }
      const lines = computeFieldLines(charges, {
        width: size.width,
        height: size.height,
        linesPerReferenceCharge: linesPerMicroC,
        maxLines: maxFieldLines,
        softenSquared: 25, // match computeField, or lines drift off the arrows
      });
      // One path for every line: the whole overlay strokes in a single call.
      const path = new Path2D();
      for (const line of lines) {
        for (const points of line.segments) {
          path.moveTo(points[0], points[1]);
          for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        }
      }
      fieldLinePathRef.current = path;
    };
  }, [charges, size.width, size.height, showFieldLines, linesPerMicroC, maxFieldLines]);

  // The colormap is opaque and covers the whole canvas, so its neutral end is
  // what the reader sees as the background. Anchoring that to --sim-bg (rather
  // than to white) is what keeps a dark theme dark: zero potential reads as
  // empty space in every theme instead of washing the canvas out.
  const divergingRamp = (palette) => {
    const bg = cssColorToRgb(palette.bg, [249, 250, 251]);
    // The ends follow the same accents as the charge markers, darkened or
    // lightened only as far as this background needs: a hardcoded pair cannot
    // serve both themes, since the light theme's deep blue reads at 2.3:1 on
    // the dark background and the pastel accents are paler still.
    return {
      bg,
      positive: ensureContrast(cssColorToRgb(palette.positive, [239, 68, 68]), bg),
      negative: ensureContrast(cssColorToRgb(palette.negative, [59, 130, 246]), bg),
    };
  };

  const divergingColor = (t, ramp) => {
    // t in [-1,1]: negative end, background at 0, positive end.
    t = clamp(t, -1, 1);
    const a = Math.abs(t);
    const end = t < 0 ? ramp.negative : ramp.positive;
    return [
      Math.round(ramp.bg[0] + (end[0] - ramp.bg[0]) * a),
      Math.round(ramp.bg[1] + (end[1] - ramp.bg[1]) * a),
      Math.round(ramp.bg[2] + (end[2] - ramp.bg[2]) * a),
    ];
  }

  // --- Potential colormap generation (cached) ---
  const regenerateColormapAndContours = useMemo(() => {
    return () => {
      hoveredContourRef.current = null;
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
      const ramp = divergingRamp(themeColors());

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
          const [r, g, b] = divergingColor(t, ramp);
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
          // Zero is the only persistent label; keep it inside the visible plot.
          const candidates = level === 0 ? segments.flat().filter(([x, y]) =>
            x >= 0 && x <= size.width && y >= 0 && y <= size.height) : [];
          const label = candidates[Math.floor(candidates.length * 0.65)];
          return { path, level, label, segments };
        });
        contourCacheRef.current = { paths, w: cols, h: rows };
      } else {
        contourCacheRef.current = { paths: [], w: W, h: H };
      }

    }
  }, [size.width, size.height, charges, quality, logColors, showColormap, showEquipotentials, themeTick]);

  // Regenerate when dependencies change
  useEffect(() => {
    // Throttle regeneration a bit while dragging to reduce flicker
    const isDragging = draggingTestCharge || draggingChargeIndex !== null;
    const delay = isDragging ? 80 : 0; // ms
    let frame;
    const id = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        regenerateColormapAndContours();
        regenerateFieldLines();
      });
    }, delay);
    return () => { clearTimeout(id); cancelAnimationFrame(frame); };
  }, [regenerateColormapAndContours, regenerateFieldLines, draggingTestCharge, draggingChargeIndex]);

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
    hoveredContourRef.current = null;
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
    hoveredContourRef.current = !draggingTestCharge && draggingChargeIndex === null && e.buttons === 0
      && e.pointerType !== "touch" && showEquipotentials
      ? nearestContour(contourCacheRef.current.paths, x, y) : null;
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
  const clearContourHover = () => { hoveredContourRef.current = null; };

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
    canvas.addEventListener("pointerleave", clearContourHover);
    canvas.addEventListener("pointercancel", clearContourHover);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("pointerleave", clearContourHover);
      canvas.removeEventListener("pointercancel", clearContourHover);
    };
  }, [draggingTestCharge, draggingChargeIndex, charges, tapAction, showEquipotentials, size]);

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
      if (showFieldLines && fieldLinePathRef.current) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = palette.muted;
        ctx.stroke(fieldLinePathRef.current);
        ctx.restore();
      }

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

      // Draw labels last, so arrows and charges never paint over the tooltip.
      if (showEquipotentials) {
        const drawLabel = (level, point, hover = false) => {
          ctx.save();
          ctx.font = "12px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const text = `${level.toLocaleString()} V`;
          const w = ctx.measureText(text).width + 12;
          const lx = clamp(point[0], w / 2 + 3, width - w / 2 - 3);
          const ly = clamp(point[1] - (hover ? 20 : 0), 12, height - 12);
          ctx.fillStyle = palette.bg;
          ctx.fillRect(lx - w / 2, ly - 10, w, 20);
          ctx.fillStyle = palette.text;
          ctx.fillText(text, lx, ly);
          ctx.restore();
        };
        const zero = contourCacheRef.current.paths.find(c => c.level === 0);
        if (zero?.label) drawLabel(0, zero.label);
        const hovered = hoveredContourRef.current;
        if (hovered && hovered.level !== 0) drawLabel(hovered.level, hovered.point, true);
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => { mounted = false; cancelAnimationFrame(animationFrameId); };
  }, [charges, animateTestCharge, draggingTestCharge, showFieldLines, size, showColormap, showArrows, showEquipotentials]);

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
