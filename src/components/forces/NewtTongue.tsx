import { add, magnitude, normalize, scale, subtract, type Vector2 } from '../../lib/forces';
import { NEWT_MOUTH_OFFSET } from './NewtSprite';

// Newt's tongue, shared by the tension demo and the force-pair scenes. The
// strand runs behind the sprite from its anchor to just past the mouth; the
// stub is drawn inside NewtSprite, on top of the artwork, so the tongue
// visibly leaves his mouth.

export const tonguePath = (start: Vector2, end: Vector2, slack = false) => {
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length < 1) {
    return `M ${start.x} ${start.y}`;
  }

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };
  const sag = slack ? Math.min(54, length * 0.22) : Math.min(12, length * 0.04);
  const bend = slack ? 18 : 6;
  const c1 = add(add(start, scale(delta, 0.32)), scale(normal, bend));
  const c2 = add(add(start, scale(delta, 0.68)), scale(normal, -bend));
  const c2Sag = add(c2, { x: 0, y: sag });

  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2Sag.x} ${c2Sag.y} ${end.x} ${end.y}`;
};

export const TongueBandMarks = ({ start, end, count = 13 }: { start: Vector2; end: Vector2; count?: number }) => {
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length < 1) {
    return null;
  }

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };

  return (
    <g opacity="0.42">
      {Array.from({ length: count }, (_, index) => {
        const t = (index + 1) / (count + 1);
        const center = add(start, scale(delta, t));
        const half = 3.2;
        const p1 = add(center, scale(normal, half));
        const p2 = subtract(center, scale(normal, half));
        return (
          <line
            key={index}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#be185d"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        );
      })}
    </g>
  );
};

/**
 * The tongue from its anchor to 20 units past the mouth, plus the sticky tip at
 * the anchor. Draw it before NewtSprite so the sprite covers the far end.
 */
export function TongueStrand({ anchor, mouth, taut = true }: { anchor: Vector2; mouth: Vector2; taut?: boolean }) {
  const direction = normalize(subtract(anchor, mouth), { x: -1, y: 0 });
  const join = add(mouth, scale(direction, 20));
  const d = tonguePath(anchor, join, !taut);

  return (
    <>
      <path d={d} fill="none" stroke="#f9a8d4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={taut ? 10 : 8} />
      <path
        d={d}
        fill="none"
        stroke="#ec4899"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={taut ? 5 : 4}
        opacity={taut ? 0.9 : 0.72}
      />
      {taut && <TongueBandMarks start={anchor} end={join} />}
      <circle cx={anchor.x} cy={anchor.y} r="6.5" fill="#f9a8d4" stroke="#be185d" strokeWidth="1.5" />
    </>
  );
}

/**
 * The root of the tongue, drawn over Newt's mouth line. Pass it as a child of
 * NewtSprite; `angle` is the tongue direction in degrees relative to the sprite.
 */
export function TongueMouthStub({ angle }: { angle: number }) {
  return (
    <g transform={`translate(${NEWT_MOUTH_OFFSET.x} ${NEWT_MOUTH_OFFSET.y}) rotate(${angle})`}>
      <path d="M 0 0 C 6 -1.5 14 -1.5 21 0" fill="none" stroke="#ec4899" strokeLinecap="round" strokeWidth="5.5" opacity="0.86" />
      <ellipse cx="1.5" cy="0" rx="4" ry="2.5" fill="#be185d" opacity="0.55" />
    </g>
  );
}
