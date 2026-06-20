import React, { useState, useRef, useEffect } from "react";
import { diskMomentOfInertia, angularAccel } from "../../lib/rotation";

const RotatingDisk = () => {
  // Simulation parameters
  const [mass, setMass] = useState(1); // kg
  const [radius, setRadius] = useState(1); // m
  const [torque, setTorque] = useState(1); // N·m

  // Display states for the simulation
  const [angle, setAngle] = useState(0); // in radians
  const [angularVelocity, setAngularVelocity] = useState(0); // in rad/s

  // Use a ref to hold the current simulation state (to avoid stale closures)
  const simState = useRef({
    angle: 0,
    angularVelocity: 0,
  });

  const requestRef = useRef();
  const previousTimeRef = useRef();

  useEffect(() => {
    const animate = (time) => {
      if (previousTimeRef.current !== undefined) {
        // Calculate time difference in seconds
        const deltaTime = (time - previousTimeRef.current) / 1000;

        // Moment of inertia for a solid disk: I = 0.5 * mass * radius^2
        const I = diskMomentOfInertia(mass, radius);
        const alpha = angularAccel(torque, I);

        // Update the simulation state using basic rotational kinematics:
        // angularVelocity is updated by alpha * deltaTime
        simState.current.angularVelocity += alpha * deltaTime;
        // angle is updated by the angular velocity over deltaTime
        simState.current.angle += simState.current.angularVelocity * deltaTime;

        // Update state for re-rendering
        setAngularVelocity(simState.current.angularVelocity);
        setAngle(simState.current.angle);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [mass, radius, torque]);

  // Handlers to update simulation parameters. Reset simulation state when parameters change.
  const handleMassChange = (e) => {
    setMass(parseFloat(e.target.value));
    simState.current = { angle: 0, angularVelocity: 0 };
  };

  const handleRadiusChange = (e) => {
    setRadius(parseFloat(e.target.value));
    simState.current = { angle: 0, angularVelocity: 0 };
  };

  const handleTorqueChange = (e) => {
    setTorque(parseFloat(e.target.value));
    simState.current = { angle: 0, angularVelocity: 0 };
  };

  // Style for the animated disk; a scaling factor is applied for visualization purposes.
  const diskStyle = {
    width: `${radius * 50}px`,
    height: `${radius * 50}px`,
    borderRadius: "50%",
    background:
      "conic-gradient(#3b82f6 0deg 90deg, #1d4ed8 90deg 180deg, #3b82f6 180deg 270deg, #1d4ed8 270deg 360deg)",
    border: "2px solid var(--grid-line)",
    margin: "0 auto",
    transform: `rotate(${angle * (180 / Math.PI)}deg)`,
    transition: "transform 0.05s linear",
  };

  return (
    <div style={{ color: "var(--text-primary)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={diskStyle}></div>
        <p>Angle: {angle.toFixed(2)} rad</p>
        <p>Angular Velocity: {angularVelocity.toFixed(2)} rad/s</p>
        <p>Moment of Inertia: {(diskMomentOfInertia(mass, radius)).toFixed(2)} kg·m²</p>
        <p>
          Angular Acceleration:{" "}
          {angularAccel(torque, diskMomentOfInertia(mass, radius)).toFixed(2)}{" "}
          rad/s²
        </p>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <label>
          Mass (kg): {mass}
          <input
            type="range"
            min="0.1"
            max="10"
            step="0.1"
            value={mass}
            onChange={handleMassChange}
          />
        </label>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <label>
          Radius (m): {radius}
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={radius}
            onChange={handleRadiusChange}
          />
        </label>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <label>
          Applied Torque (N·m): {torque}
          <input
            type="range"
            min="-20"
            max="20"
            step="0.1"
            value={torque}
            onChange={handleTorqueChange}
          />
        </label>
      </div>
    </div>
  );
};

export default RotatingDisk;
