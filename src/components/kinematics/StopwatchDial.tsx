import { useCallback, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { pointerToTime, timeToAngle, wrapTime } from '../../lib/kinematics/stopwatch';
import { fixed } from '../../utils/format';

/**
 * An analog stopwatch whose hand sweeps once across the full run. Grab the hand
 * - or anywhere on the face - and drag to scrub. Because the sample motion is a
 * closed cycle, the dial is genuinely circular: dragging past the top wraps from
 * the end of the run straight back to the start, exactly as the animation does.
 */

const SIZE = 132;
const CENTRE = SIZE / 2;
const RIM_R = 60;
const TICK_OUTER_R = 54;
const MAJOR_TICK_INNER_R = 44;
const MINOR_TICK_INNER_R = 49;
const NUMERAL_R = 38;
const HAND_LENGTH = 40;
const HAND_TAIL = 11;
const ARROW_LENGTH = 10;
const ARROW_HALF_WIDTH = 5;

/** Seconds between minor ticks, and between keyboard steps. */
const MINOR_STEP = 0.2;
const KEY_STEP = 0.1;
const KEY_STEP_LARGE = 1;

/**
 * Coordinates are rounded before they reach the DOM. `Math.sin` is not required
 * to be correctly rounded, so Node and the browser can disagree in the last bit
 * - enough for React to report a hydration mismatch on every tick mark. Three
 * decimals is far finer than a 132-pixel dial can show and is identical on both
 * sides.
 */
const round = (n: number) => Math.round(n * 1000) / 1000;

const pointOnDial = (angle: number, radius: number) => ({
  x: round(CENTRE + radius * Math.sin(angle)),
  y: round(CENTRE - radius * Math.cos(angle)),
});

/**
 * The three corners of the arrowhead: a point at the far end of the hand and a
 * base struck perpendicular to it. For an angle measured clockwise from twelve
 * o'clock the hand runs along (sin, -cos), so (cos, sin) is across it.
 */
const arrowPoints = (angle: number) => {
  const tip = pointOnDial(angle, HAND_LENGTH);
  const base = pointOnDial(angle, HAND_LENGTH - ARROW_LENGTH);
  const acrossX = round(Math.cos(angle) * ARROW_HALF_WIDTH);
  const acrossY = round(Math.sin(angle) * ARROW_HALF_WIDTH);
  return [
    `${tip.x},${tip.y}`,
    `${round(base.x + acrossX)},${round(base.y + acrossY)}`,
    `${round(base.x - acrossX)},${round(base.y - acrossY)}`,
  ].join(' ');
};

export default function StopwatchDial({
  value,
  max,
  onChange,
  onScrubStart,
  label = 'Stopwatch: drag the hand to set the time',
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  /** Called once when a drag begins, so the caller can pause playback. */
  onScrubStart?: () => void;
  label?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const timeFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) {
        return value;
      }
      const rect = svg.getBoundingClientRect();
      return pointerToTime(
        clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2),
        max,
      );
    },
    [max, value],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    // preventDefault stops the drag selecting surrounding text, but it also
    // stops the browser moving focus here, so take focus explicitly - otherwise
    // the arrow keys go nowhere once someone has grabbed the hand. The class
    // list turns the user-agent :focus ring off (it paints an amber circle over
    // the dial on every click) and draws our own only for :focus-visible, so
    // keyboard users still get an indicator and mouse users do not.
    event.preventDefault();
    event.currentTarget.focus();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart?.();
    onChange(timeFromPointer(event.clientX, event.clientY));
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) {
      return;
    }
    onChange(timeFromPointer(event.clientX, event.clientY));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const wrap = (next: number) => wrapTime(next, max);
    let handled = true;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        onChange(wrap(value + KEY_STEP));
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        onChange(wrap(value - KEY_STEP));
        break;
      case 'PageUp':
        onChange(wrap(value + KEY_STEP_LARGE));
        break;
      case 'PageDown':
        onChange(wrap(value - KEY_STEP_LARGE));
        break;
      case 'Home':
        onChange(0);
        break;
      case 'End':
        onChange(max);
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      onScrubStart?.();
    }
  };

  const handAngle = timeToAngle(value, max);
  // The shaft stops just inside the arrowhead so the two meet without a seam.
  const shaftEnd = pointOnDial(handAngle, HAND_LENGTH - ARROW_LENGTH + 2);
  const handBack = pointOnDial(handAngle + Math.PI, HAND_TAIL);

  const minorTicks = Math.round(max / MINOR_STEP);

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(fixed(value, 1))}
      aria-valuetext={`${fixed(value, 1)} seconds`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="shrink-0 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
    >
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={RIM_R}
        fill="var(--bg-primary)"
        stroke="var(--grid-line)"
        strokeWidth={2}
      />

      {Array.from({ length: minorTicks }, (_, i) => {
        const seconds = i * MINOR_STEP;
        const major = Math.abs(seconds - Math.round(seconds)) < 1e-9;
        const angle = timeToAngle(seconds, max);
        const outer = pointOnDial(angle, TICK_OUTER_R);
        const inner = pointOnDial(angle, major ? MAJOR_TICK_INNER_R : MINOR_TICK_INNER_R);
        return (
          <line
            key={seconds}
            x1={outer.x}
            y1={outer.y}
            x2={inner.x}
            y2={inner.y}
            stroke={major ? 'var(--text-primary)' : 'var(--grid-line)'}
            strokeWidth={major ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}

      {[0, 2, 4, 6, 8].map((seconds) => {
        const { x, y } = pointOnDial(timeToAngle(seconds, max), NUMERAL_R);
        return (
          <text
            key={seconds}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            fill="var(--text-muted)"
          >
            {seconds}
          </text>
        );
      })}

      <line
        x1={handBack.x}
        y1={handBack.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke="var(--accent-red)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <polygon points={arrowPoints(handAngle)} fill="var(--accent-red)" />
      <circle cx={CENTRE} cy={CENTRE} r={4.5} fill="var(--accent-red)" />
    </svg>
  );
}
