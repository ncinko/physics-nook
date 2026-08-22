import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

import {
  SAMPLE_T_MAX,
  SAMPLE_T_MIN,
  accelerationOfT,
  pathLengthOfT,
  positionOfT,
  speedTrend,
  velocityOfT,
} from '../../lib/kinematics/sampleMotion';
import { fixed } from '../../utils/format';
import { hedgehogGait } from '../../lib/kinematics/hedgehogGait';
import { HedgehogSprite } from './HedgehogSprite';
import { HEDGEHOG_CELL_H } from './hedgehogSheet';
import StopwatchDial from './StopwatchDial';

// The sample motion enters at x = 0 and leaves at x = 10, turning twice along
// the way, so the ruler is exactly the ten metres it covers.
const X_MIN = 0;
const X_MAX = 10;

const VIEW_H = 170;
const TRACK_INSET = 34;
const GROUND_Y = 120;
// Whole-number scale only: the sprite sheet is pixel art, and a fractional
// factor would smear it across half pixels.
const SPRITE_SCALE = 1;
const MIN_WIDTH = 300;

// The sentence is quantised to tenths of a second and every number in it is
// given to one decimal. A readout that re-renders sixty times a second is a blur
// of digits nobody can read; a tenth is slow enough to follow and still fine
// enough to watch the velocity turn over.
const READOUT_STEP = 0.1;

// Said of the speed, not the velocity: the hedgehog can be speeding up while
// travelling left, and it holds a steady speed whenever the acceleration is zero.
const TREND_PHRASE = {
  'speeding-up': 'and speeding up',
  'slowing-down': 'and slowing down',
  constant: 'at constant speed',
} as const;

export default function MotionOpener() {
  const [t, setT] = useState(SAMPLE_T_MIN);
  const [playing, setPlaying] = useState(true);
  // The viewBox tracks the rendered CSS width so one SVG unit is one CSS pixel,
  // which keeps the sprite on exact pixel boundaries.
  const [width, setWidth] = useState(920);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const facingRef = useRef<1 | -1>(1);

  const trackL = TRACK_INSET;
  const trackR = Math.max(trackL + 40, width - TRACK_INSET);
  const xPix = (x: number) => trackL + ((x - X_MIN) / (X_MAX - X_MIN)) * (trackR - trackL);
  // Ten whole-metre labels crowd a narrow track, so drop to every second metre.
  const labelStep = trackR - trackL < 420 ? 2 : 1;

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => setWidth(Math.max(MIN_WIDTH, Math.floor(element.clientWidth)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // Honour a reduced-motion preference by opening paused rather than running.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const dt = (timestamp - lastFrameRef.current) / 1000;
        setT((current) => {
          const next = current + dt;
          return next > SAMPLE_T_MAX ? SAMPLE_T_MIN : next;
        });
      }
      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [playing]);

  // The hedgehog itself tracks the exact time so it moves smoothly; only the
  // sentence snaps to tenths, and it reads every quantity at that same snapped
  // instant so the whole sentence describes one moment.
  const readoutT = Math.round(t / READOUT_STEP) * READOUT_STEP;
  const readoutPosition = positionOfT(readoutT);
  const readoutVelocity = velocityOfT(readoutT);
  const readoutTrend = TREND_PHRASE[speedTrend(readoutVelocity, accelerationOfT(readoutT))];

  const position = positionOfT(t);
  const velocity = velocityOfT(t);
  const acceleration = accelerationOfT(t);

  const pose = useMemo(
    () =>
      hedgehogGait({
        distance: pathLengthOfT(t),
        velocity,
        acceleration,
        previousFacing: facingRef.current,
      }),
    [t, velocity, acceleration],
  );
  facingRef.current = pose.facing;

  const hedgehogX = xPix(position);

  return (
    <div className="not-prose my-8 overflow-hidden rounded-[1.35rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-4 shadow-sm sm:px-5">
      <p className="m-0 text-sm text-[var(--text-muted)]">
        At <Value>{fixed(readoutT, 1)} s</Value> the hedgehog is at{' '}
        <Value>x = {fixed(readoutPosition, 1)} m</Value>, moving at{' '}
        <Value>{fixed(readoutVelocity, 1)} m/s</Value> {readoutTrend}.
      </p>

      <div ref={wrapperRef} className="mt-3 w-full">
        <svg
          viewBox={`0 0 ${width} ${VIEW_H}`}
          width={width}
          height={VIEW_H}
          className="block max-w-full"
          role="img"
          aria-label={`A pixel-art hedgehog on a ten metre track, at ${fixed(readoutPosition, 1)} metres and moving at ${fixed(readoutVelocity, 1)} metres per second ${readoutTrend}`}
          style={{ shapeRendering: 'crispEdges' }}
        >
          {/* Metre ticks. Whole metres are labelled; half metres are just marks. */}
          {Array.from({ length: (X_MAX - X_MIN) * 2 + 1 }, (_, i) => {
            const value = X_MIN + i / 2;
            const whole = Number.isInteger(value);
            return (
              <line
                key={`tick-${value}`}
                x1={xPix(value)}
                x2={xPix(value)}
                y1={GROUND_Y}
                y2={GROUND_Y + (whole ? 10 : 5)}
                stroke="var(--grid-line)"
                strokeWidth={whole ? 2 : 1}
              />
            );
          })}

          {Array.from({ length: Math.floor((X_MAX - X_MIN) / labelStep) + 1 }, (_, i) => {
            const value = X_MIN + i * labelStep;
            return (
              <text
                key={`label-${value}`}
                x={xPix(value)}
                y={GROUND_Y + 26}
                textAnchor="middle"
                fontSize={13}
                fill="var(--text-muted)"
                style={{ shapeRendering: 'auto' }}
              >
                {value}
              </text>
            );
          })}

          <line
            x1={trackL}
            x2={trackR}
            y1={GROUND_Y}
            y2={GROUND_Y}
            stroke="var(--text-primary)"
            strokeWidth={2}
          />

          <text
            x={(trackL + trackR) / 2}
            y={VIEW_H - 8}
            textAnchor="middle"
            fontSize={13}
            fill="var(--text-primary)"
            style={{ shapeRendering: 'auto' }}
          >
            position (m)
          </text>

          {/* Drop line tying the character to the number it is standing on. */}
          <line
            x1={hedgehogX}
            x2={hedgehogX}
            y1={GROUND_Y - HEDGEHOG_CELL_H * SPRITE_SCALE}
            y2={GROUND_Y}
            stroke="var(--accent-blue)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />

          <g transform={`translate(${hedgehogX}, ${GROUND_Y}) scale(${pose.facing}, 1)`}>
            <HedgehogSprite frame={pose.frame} scale={SPRITE_SCALE} />
          </g>
          </svg>
      </div>

      <div className="mt-2 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause the motion' : 'Play the motion'}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
        >
          {playing ? (
            <Pause aria-hidden="true" size={17} strokeWidth={2.5} />
          ) : (
            <Play aria-hidden="true" size={17} strokeWidth={2.5} />
          )}
        </button>

        <StopwatchDial
          value={t}
          max={SAMPLE_T_MAX}
          onChange={setT}
          onScrubStart={() => setPlaying(false)}
        />
      </div>
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-[var(--text-primary)]">{children}</span>;
}
