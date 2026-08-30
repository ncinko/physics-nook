import { add, clamp, clampMagnitude, magnitude, normalize, scale, subtract, type Vector2 } from '../../lib/forces';

// The labelled force arrow shared by every forces interactive. Kept here rather
// than inside one island so the free-body pages draw arrows that match the ones
// on the introductory page exactly.

export const FORCE_COLORS = {
  applied: '#2563eb',
  spring: '#db2777',
  normal: '#0891b2',
  gravity: '#dc2626',
  friction: '#d97706',
  net: '#7c3aed',
  contact: '#0f766e',
  velocity: '#64748b',
  tension: '#db2777',
};

const DEFAULT_LABEL_BOUNDS = { width: 760, height: 360 };

export interface ForceVector {
  id?: string;
  origin: Vector2;
  vector: Vector2;
  color: string;
  label: string;
  scale?: number;
  maxLength?: number;
  opacity?: number;
  labelBounds?: { width: number; height: number };
  /** Draw the shaft dashed, for weight components resolved onto axes. */
  dashed?: boolean;
}

export const ForceArrow = ({
  origin,
  vector,
  color,
  label,
  scale: arrowScale = 1,
  maxLength = 92,
  opacity = 1,
  labelBounds = DEFAULT_LABEL_BOUNDS,
  dashed = false,
}: ForceVector) => {
  const raw = scale(vector, arrowScale);
  const display = clampMagnitude(raw, maxLength);
  const length = magnitude(display);

  if (length < 2) {
    return null;
  }

  const end = add(origin, display);
  const unit = normalize(display);
  const normal = { x: -unit.y, y: unit.x };
  const head = Math.min(13, Math.max(8, length * 0.22));
  const wing = head * 0.55;
  const headBase = subtract(end, scale(unit, head));
  const shaftEnd = length > head ? headBase : origin;
  const p1 = end;
  const p2 = add(headBase, scale(normal, wing));
  const p3 = subtract(headBase, scale(normal, wing));
  const labelOffset = length > 28 ? 10 : 7;
  const labelPoint = add(end, scale(unit, labelOffset));
  const labelX = clamp(labelPoint.x, 50, labelBounds.width - 50);
  const labelY = clamp(labelPoint.y, 26, labelBounds.height - 26);
  const textAnchor = labelX <= 56 ? 'start' : labelX >= labelBounds.width - 56 ? 'end' : Math.abs(unit.x) < 0.2 ? 'middle' : unit.x > 0 ? 'start' : 'end';

  return (
    <g opacity={opacity}>
      <line
        x1={origin.x}
        y1={origin.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={color}
        strokeWidth={dashed ? 3 : 4}
        strokeLinecap="round"
        strokeDasharray={dashed ? '7 6' : undefined}
      />
      <polygon
        points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
        fill={color}
        stroke={color}
        strokeLinejoin="round"
      />
      <text
        x={labelX}
        y={labelY}
        fill={color}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize="14"
        fontWeight="700"
        paintOrder="stroke"
        stroke="var(--sim-bg)"
        strokeWidth="4"
      >
        {label}
      </text>
    </g>
  );
};

export default ForceArrow;
