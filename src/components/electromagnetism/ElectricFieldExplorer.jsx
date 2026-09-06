import React, { useState, useEffect, useMemo, useRef } from "react";
import { coulombFieldAt } from "../../lib/electromagnetism";
import { computeFieldLines } from "../../lib/electromagnetism/fieldLines";
import { themeColors } from "../shared/themeColors";
import { ControlBar, Slider, Toggle, Button, Select } from "../shared/InlineControls";

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
  const chargedRowsConfig = (W, H) => {
    const rows = 5;
    const ys = Array.from(
      { length: rows },
      (_, i) => ((i + 1) / (rows + 1)) * H
    );
    const leftX = 0.2 * W,
      rightX = 0.8 * W;
    const leftRow = ys.map((y) => ({ x: leftX, y, q: 1e-6 }));
    const rightRow = ys.map((y) => ({ x: rightX, y, q: -1e-6 }));
    return [...leftRow, ...rightRow];
  };

  // -------- State --------
  const [configuration, setConfiguration] = useState("dipole");
  const [charges, setCharges] = useState(() =>
    dipoleConfig(size.width, size.height)
  );
  const [draggingChargeIndex, setDraggingChargeIndex] = useState(null);
  const [draggingTestCharge, setDraggingTestCharge] = useState(false);
  const [animateTestCharge, setAnimateTestCharge] = useState(false);
  // What an empty-space tap does. Gives touch users the actions that are
  // Shift-click / Ctrl-click on a keyboard.
  const [tapAction, setTapAction] = useState("positive");

  // Field lines UI
  const [showFieldLines, setShowFieldLines] = useState(false);
  const [linesPerMicroC, setLinesPerMicroC] = useState(12);
  // The traced overlay, kept as one Path2D between scene changes.
  const fieldLinePathRef = useRef(null);

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

  // --- Field lines (traced in the lib, cached as one Path2D) ---
  //
  // This used to be an inline tracer re-run from scratch on every animation
  // frame, seeding an even ring around every charge. The ring is what the lib
  // replaced: seeds now carry equal flux rather than equal angle, so a charge
  // in a row aims its lines into the gap instead of splitting them evenly
  // between the gap and the weak field out the back, so spacing reads as
  // strength the way the diagram asks you to. Two older bugs go with it — the lib
  // traces from sources only, so a dipole's lines are drawn once instead of
  // once from each end, and a line ends only on a charge that is a sink for its
  // direction, rather than on whichever charge it passed within 10 px of.
  const regenerateFieldLines = useMemo(() => {
    return () => {
      if (!showFieldLines) {
        fieldLinePathRef.current = null;
        return;
      }
      const lines = computeFieldLines(charges, {
        width: size.width,
        height: size.height,
        linesPerReferenceCharge: linesPerMicroC,
        softenSquared: 25, // match computeField, or lines drift off the arrows
      });
      // One path for every line: the whole overlay strokes in a single call.
      const path = new Path2D();
      for (const line of lines) {
        for (const points of line.segments) {
          path.moveTo(points[0], points[1]);
          for (let i = 2; i < points.length; i += 2) {
            path.lineTo(points[i], points[i + 1]);
          }
        }
      }
      fieldLinePathRef.current = path;
    };
  }, [charges, size.width, size.height, showFieldLines, linesPerMicroC]);

  // Dragging a charge rewrites `charges` on every pointer move, so tracing is
  // held back a beat there and runs on the next frame everywhere else.
  useEffect(() => {
    const delay = draggingChargeIndex !== null ? 80 : 0;
    let frame;
    const id = setTimeout(() => {
      frame = requestAnimationFrame(regenerateFieldLines);
    }, delay);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(frame);
    };
  }, [regenerateFieldLines, draggingChargeIndex]);

  // Config change
  const handleConfigurationChange = (newConfig) => {
    setConfiguration(newConfig);
    const { width: W, height: H } = size;
    if (newConfig === "dipole") {
      setCharges(dipoleConfig(W, H));
    } else if (newConfig === "chargedRows") {
      setCharges(chargedRowsConfig(W, H));
    } else if (newConfig === "monopole") {
      setCharges(monopoleConfig(W, H));
    }
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
    if (Math.hypot(dxT, dyT) < 8) {
      setDraggingTestCharge(true);
      return;
    }

    // Touch targets need more slop than a mouse cursor does.
    const hitRadius = e.pointerType === "mouse" ? 10 : 18;
    const idx = charges.findIndex(c => Math.hypot(x - c.x, y - c.y) < hitRadius);

    // Ctrl-click (or Cmd on Mac) deletes a source charge
    if (idx !== -1 && (e.ctrlKey || e.metaKey || tapAction === "remove")) {
      setCharges(prev => prev.filter((_, i) => i !== idx));
      return;
    }

    if (idx !== -1) {
      setDraggingChargeIndex(idx);
    } else if (tapAction !== "remove") {
      const negative = e.shiftKey || tapAction === "negative";
      const newCharge = { x, y, q: negative ? -1e-6 : 1e-6 };
      setCharges(prev => [...prev, newCharge]);
    }
  };

  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    const { x, y } = getPointerPos(canvas, e);
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

  const handlePointerUp = () => {
    setDraggingTestCharge(false);
    setDraggingChargeIndex(null);
  };

  const resetSimulation = () => {
    const { width: W, height: H } = size;
    if (configuration === "dipole") {
      setCharges(dipoleConfig(W, H));
    } else if (configuration === "chargedRows") {
      setCharges(chargedRowsConfig(W, H));
    } else if (configuration === "monopole") {
      setCharges(monopoleConfig(W, H));
    }
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
  }, [charges, animateTestCharge, draggingTestCharge, showFieldLines, size]);

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
            { value: "chargedRows", label: "Charged Rows" },
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
        <Toggle label="Show field lines" checked={showFieldLines} onChange={setShowFieldLines} />
        <Slider
          label="Density"
          min={4}
          max={24}
          value={linesPerMicroC}
          onChange={setLinesPerMicroC}
          disabled={!showFieldLines}
        />
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
        }}
      />

      <ControlBar className="mt-2">
        <Button variant="secondary" onClick={resetSimulation}>Reset Simulation</Button>
        <Button
          onClick={() => setAnimateTestCharge(true)}
          disabled={animateTestCharge}
        >
          {animateTestCharge
            ? "Test Charge Animating"
            : "Start Test Charge Animation"}
        </Button>
      </ControlBar>

      <p style={{ marginTop: "0.5rem" }}>
        Tap empty space to place a charge, using <strong>Tap action</strong> to pick
        whether it is positive, negative, or a removal. Drag a charge to move it, and
        drag the green test charge to reposition it. With a keyboard you can skip the
        picker: <strong>Shift-click</strong> places a negative charge and{" "}
        <strong>Ctrl-click</strong> (or ⌘-click on Mac) removes one.
      </p>
    </div>
  );
};

export default ElectricFieldExplorer;