import React, { useState } from "react";
import { torqueFromForce } from "../../lib/rotation";

const TorqueSimulation = () => {
  // Simulation parameters (with default values)
  const [leverLength, setLeverLength] = useState(2); // in meters
  const [forceMagnitude, setForceMagnitude] = useState(10); // in Newtons
  const [forceAngle, setForceAngle] = useState(90); // in degrees (angle between force and lever)

  // Convert force angle to radians
  const forceAngleRad = forceAngle * (Math.PI / 180);
  // Compute the torque: τ = r * F * sin(θ)
  const torque = torqueFromForce(leverLength, forceMagnitude, forceAngleRad);

  // Scale factor to convert meters to pixels for drawing
  const scale = 50; // 50 pixels per meter
  // Define the pivot point of the lever
  const pivotX = 50;
  const pivotY = 150;
  // Compute the end of the lever (drawn horizontally)
  const leverEndX = pivotX + leverLength * scale;
  const leverEndY = pivotY;

  // Define the force arrow
  // For visualization, set arrow length proportional to force magnitude
  const arrowLength = forceMagnitude * 5; // 5 pixels per Newton
  // Since the lever is horizontal, the force arrow is drawn relative to it:
  // x-component and y-component are computed from the force angle.
  const forceEndX = leverEndX + arrowLength * Math.cos(forceAngleRad);
  const forceEndY = leverEndY - arrowLength * Math.sin(forceAngleRad);

  return (
    <div style={{ color: "var(--text-primary)" }}>
      <svg width="400" height="300" style={{ border: "1px solid var(--grid-line)", borderRadius: 12, background: "var(--sim-bg)", maxWidth: "100%" }}>
        <defs>
          <marker
            id="arrow"
            markerWidth="10"
            markerHeight="10"
            refX="0"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="#e74c3c" />
          </marker>
        </defs>
        {/* Draw lever arm */}
        <line
          x1={pivotX}
          y1={pivotY}
          x2={leverEndX}
          y2={leverEndY}
          stroke="#3498db"
          strokeWidth="4"
        />
        {/* Draw pivot */}
        <circle cx={pivotX} cy={pivotY} r="5" fill="var(--text-primary)" />
        {/* Draw force arrow */}
        <line
          x1={leverEndX}
          y1={leverEndY}
          x2={forceEndX}
          y2={forceEndY}
          stroke="#e74c3c"
          strokeWidth="4"
          markerEnd="url(#arrow)"
        />
      </svg>
      <div>
        <p>
          <strong>Lever Arm Length:</strong> {leverLength.toFixed(2)} m
        </p>
        <p>
          <strong>Force Magnitude:</strong> {forceMagnitude.toFixed(2)} N
        </p>
        <p>
          <strong>Force Angle (relative to lever):</strong> {forceAngle.toFixed(2)}°
        </p>
        <p>
          <strong>Computed Torque:</strong> {torque.toFixed(2)} N·m
        </p>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <label>
          Lever Arm Length (m): {leverLength.toFixed(2)}
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            value={leverLength}
            onChange={(e) => setLeverLength(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <label>
          Force Magnitude (N): {forceMagnitude.toFixed(2)}
          <input
            type="range"
            min="0"
            max="20"
            step="0.1"
            value={forceMagnitude}
            onChange={(e) => setForceMagnitude(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <label>
          Force Angle (°): {forceAngle.toFixed(2)}
          <input
            type="range"
            min="0"
            max="180"
            step="1"
            value={forceAngle}
            onChange={(e) => setForceAngle(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>
      <p style={{ marginTop: "1rem" }}>
        The torque is calculated as <strong>τ = r F sin(θ)</strong>, where r is the lever arm length, F is the force magnitude, and θ is the angle between the force and the lever.
      </p>
    </div>
  );
};

export default TorqueSimulation;
