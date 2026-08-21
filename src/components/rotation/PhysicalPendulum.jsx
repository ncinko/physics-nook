import React, { useState, useEffect, useRef } from "react";
import { physicalPendulumOmega } from "../../lib/rotation";

const PhysicalPendulum = () => {
  const g = 9.8; // gravitational acceleration (m/s²)
  const scale = 100; // pixels per meter for drawing
  const pivotX = 200; // pivot x-coordinate in SVG
  const pivotY = 0;  // pivot y-coordinate in SVG

  // Simulation parameters
  const [rodMass, setRodMass] = useState(1);       // in kg
  const [diskMass, setDiskMass] = useState(1);       // in kg
  const [rodLength, setRodLength] = useState(2);     // in m
  const [diskRadius, setDiskRadius] = useState(0.5);   // in m
  const [mode, setMode] = useState("fixed");         // "fixed" or "free"
  const [amplitude, setAmplitude] = useState(0.2);     // initial amplitude (radians)

  // For click-and-drag functionality
  const [isDragging, setIsDragging] = useState(false);
  const [draggedAngle, setDraggedAngle] = useState(amplitude);

  // Simulation time (when not dragging)
  const [simTime, setSimTime] = useState(0);
  const requestRef = useRef();
  const previousTimeRef = useRef(null);

  // Calculate the center of mass and moments of inertia.
  const totalMass = rodMass + diskMass;
  const centerOfMass = (rodMass * (rodLength / 2) + diskMass * rodLength) / totalMass;
  const I_rod = (1 / 3) * rodMass * Math.pow(rodLength, 2);
  let I_disk =
    mode === "fixed"
      ? 0.5 * diskMass * Math.pow(diskRadius, 2) + diskMass * Math.pow(rodLength, 2)
      : diskMass * Math.pow(rodLength, 2);
  const I_total = I_rod + I_disk;

  // Angular frequency (ω) and period & frequency
  const omega = physicalPendulumOmega(totalMass, g, centerOfMass, I_total);
  const period = (2 * Math.PI) / omega;
  const frequency = omega / (2 * Math.PI);

  // Determine the current pendulum angle.
  // If dragging, use the dragged angle; otherwise, use the oscillatory motion.
  const theta = isDragging ? draggedAngle : amplitude * Math.cos(omega * simTime);

  // Animation loop: only update simulation time when not dragging.
  useEffect(() => {
    if (!isDragging) {
      const animate = (time) => {
        if (previousTimeRef.current === null) {
          // Reset reference time to avoid a large delta after dragging.
          previousTimeRef.current = time;
        }
        const deltaTime = (time - previousTimeRef.current) / 1000; // in seconds
        setSimTime((prevTime) => prevTime + deltaTime);
        previousTimeRef.current = time;
        requestRef.current = requestAnimationFrame(animate);
      };
      requestRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(requestRef.current);
    }
  }, [isDragging, omega]);

  // Pointer event handlers for dragging the pendulum bob. Pointer events cover
  // mouse, touch, and pen with one code path; capturing the pointer keeps the
  // drag alive when it wanders outside the SVG.
  const handlePointerDown = (e) => {
    // Capture keeps the drag alive past the SVG edge, but it throws if the
    // pointer is already gone — that must not abort the rest of the handler.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released */
    }
    setIsDragging(true);
    updateDraggedAngle(e);
  };

  const handlePointerMove = (e) => {
    if (isDragging) {
      updateDraggedAngle(e);
    }
  };

  // On pointer up, stop dragging, update amplitude, reset simTime and clear the previous time reference.
  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setAmplitude(draggedAngle);
      setSimTime(0);
      previousTimeRef.current = null;
    }
  };

  // Helper function: updates the dragged angle based on pointer position.
  // Maps through the SVG's own matrix rather than the bounding rect, so the
  // drag still tracks the pointer once the viewBox scales the drawing down on
  // narrow screens.
  const updateDraggedAngle = (e) => {
    const svg = e.currentTarget;
    let pointerX;
    let pointerY;
    const ctm = svg.getScreenCTM?.();
    if (ctm) {
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const local = point.matrixTransform(ctm.inverse());
      pointerX = local.x;
      pointerY = local.y;
    } else {
      const svgRect = svg.getBoundingClientRect();
      pointerX = e.clientX - svgRect.left;
      pointerY = e.clientY - svgRect.top;
    }
    const dx = pointerX - pivotX;
    const dy = pointerY - pivotY;
    // Calculate angle relative to the vertical (downward) direction.
    const angle = Math.atan2(dx, dy);
    setDraggedAngle(angle);
  };

  // Calculate positions for drawing the pendulum.
  const rodPixelLength = rodLength * scale;
  const diskX = pivotX + rodPixelLength * Math.sin(theta);
  const diskY = pivotY + rodPixelLength * Math.cos(theta);
  // Increase rod thickness with rod mass (e.g., 2 pixels per kg, minimum 2).
  const rodThickness = Math.max(2, rodMass * 2);

  // Disk orientation indicator: 
  // For locked mode, the disk rotates with the rod (orientation = theta).
  // For free mode, the disk remains horizontally aligned (orientation = 0).
  const diskOrientation = mode === "fixed" ? theta : 0;
  const diskPixelRadius = diskRadius * scale;

  return (
    <div className="container flex flex-col items-center" style={{ color: "var(--text-primary)" }}>
      <div className="canvas-container">
        <svg
          width="400"
          height="600"
          // The viewBox lets the whole pendulum scale down instead of being
          // clipped when the 400px drawing has to fit a phone-width column.
          viewBox="0 0 400 600"
          style={{
            border: "1px solid var(--grid-line)",
            borderRadius: 12,
            maxWidth: "100%",
            height: "auto",
            touchAction: "none",
            backgroundColor: "var(--sim-bg)",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Draw the rod */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={diskX}
            y2={diskY}
            stroke="var(--text-primary)"
            strokeWidth={rodThickness}
          />
          {/* Draw the disk (pendulum bob) with smoothing */}
          <circle
            cx={diskX}
            cy={diskY}
            r={diskPixelRadius}
            fill={mode === "fixed" ? "#3498db" : "#3498db"}
            style={{ shapeRendering: "geometricPrecision", filter: "blur(0.5px)" }}
          />
          {/* Orientation indicator inside the disk */}
          <line
            x1={diskX}
            y1={diskY}
            x2={diskX + diskPixelRadius}
            y2={diskY}
            stroke="white"
            strokeWidth="2"
            transform={`rotate(${(-diskOrientation * 180) / Math.PI} ${diskX} ${diskY})`}
          />
          {/* Draw the pivot */}
          <circle cx={pivotX} cy={pivotY} r="5" fill="var(--text-primary)" />
        </svg>
      </div>


      <div className="container flex flex-col items-center">
      {/* Control Panel */}
      <div className="control-panel w-full max-w-lg">
        <div className="slider-group">
          <div className="slider-item">
            <label>Rod</label>
            <input type="range" min="0.1" max="5" step="0.1" value={rodMass} onChange={(e) => {setRodMass(parseFloat(e.target.value)); setSimTime(0);}}/>
            <span >{rodMass} (kg)</span>
          </div>
          <div className="slider-item">
            <label>Disk</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={diskMass}
              onChange={(e) => {
                setDiskMass(parseFloat(e.target.value));
                setSimTime(0);
              }}
              className="w-full mx-2"
            />
            <span className="">{diskMass} (kg)</span>
          </div>
          <div className="slider-item flex items-center justify-between">
            <label className=" font-medium">Rod</label>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={rodLength}
              onChange={(e) => {
                setRodLength(parseFloat(e.target.value));
                setSimTime(0);
              }}
              className="w-full mx-2"
            />
            <span className=" whitespace-nowrap">{rodLength} (m)</span>
          </div>
          
          <div className="slider-item flex items-center justify-between">
            <label className=" font-medium">Mounting Mode</label>
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setSimTime(0);
              }}
              className="w-full mx-2"
            >
              <option value="fixed">Disk Fixed to the Rod</option>
              <option value="free">Disk Free to Spin</option>
            </select>
          </div>
        </div>
      </div>
      <p className="mt-4 ">
      </p>
      <div className="mt-4 ">
        <p>
          <strong>Period (T):</strong> {period.toFixed(2)} s
        </p>
        <p>
          <strong>Angular Frequency (ω):</strong> {omega.toFixed(2)} rad/s
        </p>
        <p>
          <strong>Frequency (f):</strong> {frequency.toFixed(2)} Hz
        </p>
      </div>
    </div>
    </div>
  );
};

export default PhysicalPendulum;