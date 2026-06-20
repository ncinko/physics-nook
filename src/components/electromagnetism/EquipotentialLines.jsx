import React, { useEffect, useRef } from 'react';
import { potentialAt } from '../../lib/electromagnetism';
import { themeColors, onThemeChange } from '../shared/themeColors';

// A +q / -q dipole. Dots are drawn wherever the potential lands near one of a
// set of evenly spaced levels, so equipotential contours emerge from the field.
const charges = [
  { x: 150, y: 150, q: 1e-6 },
  { x: 350, y: 150, q: -1e-6 },
];

const EquipotentialLines = () => {
  const canvasRef = useRef(null);
  const width = 500;
  const height = 300;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      const c = themeColors();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, width, height);

      const levels = [];
      for (let V = -20000; V <= 20000; V += 2000) levels.push(V);
      const tolerance = 100;
      const spacing = 5;

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = c.text;
      for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
          const V = potentialAt(charges, x, y);
          for (const level of levels) {
            if (Math.abs(V - level) < tolerance) {
              ctx.fillRect(x, y, 1, 1);
              break;
            }
          }
        }
      }
      ctx.restore();

      for (const charge of charges) {
        ctx.beginPath();
        ctx.arc(charge.x, charge.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = charge.q > 0 ? c.positive : c.negative;
        ctx.fill();
        ctx.strokeStyle = c.text;
        ctx.stroke();
      }
    };

    draw();
    return onThemeChange(draw);
  }, []);

  return (
    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px solid var(--grid-line)',
          borderRadius: 12,
          maxWidth: '100%',
          height: 'auto',
        }}
      />
    </div>
  );
};

export default EquipotentialLines;
