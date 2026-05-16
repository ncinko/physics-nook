import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const STAGE = {
  width: 900,
  height: 460,
  left: 58,
  right: 842,
  baseline: 228,
  amplitudeScale: 72,
};

const SAMPLE_COUNT = 220;
const LOOP_DURATION = 7.2;
const PULSE_WIDTH = 0.072;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getProgress(time) {
  return (time % LOOP_DURATION) / LOOP_DURATION;
}

function stageX(u) {
  return STAGE.left + u * (STAGE.right - STAGE.left);
}

function pulseShape(u, center, amplitude) {
  const normalized = (u - center) / PULSE_WIDTH;
  return amplitude * Math.exp(-normalized * normalized);
}

function getCenters(time) {
  const progress = getProgress(time);

  return {
    left: -0.12 + progress * 1.24,
    right: 1.12 - progress * 1.24,
  };
}

function samplePulses({ leftAmplitude, rightAmplitude, time }) {
  const centers = getCenters(time);

  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / SAMPLE_COUNT;
    const leftValue = pulseShape(u, centers.left, leftAmplitude);
    const rightValue = pulseShape(u, centers.right, rightAmplitude);

    return {
      u,
      x: stageX(u),
      leftValue,
      rightValue,
      totalValue: leftValue + rightValue,
    };
  });
}

function buildPath(samples, key) {
  return samples
    .map((sample, index) => {
      const y = STAGE.baseline - sample[key] * STAGE.amplitudeScale;
      return `${index === 0 ? 'M' : 'L'} ${sample.x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function getOverlapLabel({ leftAmplitude, rightAmplitude, time }) {
  const { left, right } = getCenters(time);
  const separation = Math.abs(left - right);

  if (separation > 0.18) {
    return 'Separate pulses: the total wave mostly matches each individual pulse.';
  }

  if (leftAmplitude * rightAmplitude > 0) {
    return 'Constructive overlap: same-sign pulses add into a taller crest or deeper trough.';
  }

  if (leftAmplitude * rightAmplitude < 0) {
    return 'Destructive overlap: opposite-sign pulses partially cancel while they pass through.';
  }

  return 'One side is flat, so the total wave follows the pulse from the other side.';
}

function VerticalAmplitudeSlider({ label, value, color, onChange }) {
  return (
    <label className="flex h-full min-h-80 flex-col items-center justify-center gap-3 py-2">
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
        Crest
      </span>
      <input
        type="range"
        min="-1.4"
        max="1.4"
        step="0.05"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        aria-label={label}
        className="h-64 w-8 cursor-pointer sm:h-72"
        style={{ accentColor: color, writingMode: 'vertical-lr', direction: 'rtl' }}
      />
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
        Trough
      </span>
    </label>
  );
}

export default function PulseSuperpositionInline() {
  const [leftAmplitude, setLeftAmplitude] = useState(1);
  const [rightAmplitude, setRightAmplitude] = useState(0.85);
  const [isPlaying, setIsPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const frameRef = useRef(null);
  const lastTimestampRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
      return undefined;
    }

    const tick = (timestamp) => {
      const previous = lastTimestampRef.current ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.04);
      lastTimestampRef.current = timestamp;
      setTime((current) => current + dt);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
    };
  }, [isPlaying]);

  const samples = samplePulses({ leftAmplitude, rightAmplitude, time });
  const leftPath = buildPath(samples, 'leftValue');
  const rightPath = buildPath(samples, 'rightValue');
  const totalPath = buildPath(samples, 'totalValue');
  const overlapLabel = getOverlapLabel({ leftAmplitude, rightAmplitude, time });

  return (
    <section className="not-prose my-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>

        </div>

      </div>

      <div className="grid items-stretch gap-3 [grid-template-columns:3.5rem_minmax(0,1fr)_3.5rem] sm:gap-4 sm:[grid-template-columns:4.4rem_minmax(0,1fr)_4.4rem]">
        <VerticalAmplitudeSlider
          label="Left-end pulse"
          value={leftAmplitude}
          color="rgb(37,99,235)"
          onChange={setLeftAmplitude}
        />

        <div className="min-w-0">
          <svg
            viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
            className="h-auto w-full"
            role="img"
            aria-label="Two wave pulses passing through each other while their total displacement is shown"
          >
            <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="28" fill="color-mix(in srgb, var(--sim-bg) 76%, white)" />
            <line
              x1={STAGE.left}
              x2={STAGE.right}
              y1={STAGE.baseline}
              y2={STAGE.baseline}
              stroke="rgba(100,116,139,0.36)"
              strokeWidth="1.6"
              strokeDasharray="8 8"
            />
            <line
              x1={STAGE.left}
              x2={STAGE.right}
              y1={STAGE.baseline - STAGE.amplitudeScale}
              y2={STAGE.baseline - STAGE.amplitudeScale}
              stroke="rgba(37,99,235,0.12)"
              strokeWidth="1.2"
            />
            <line
              x1={STAGE.left}
              x2={STAGE.right}
              y1={STAGE.baseline + STAGE.amplitudeScale}
              y2={STAGE.baseline + STAGE.amplitudeScale}
              stroke="rgba(249,115,22,0.12)"
              strokeWidth="1.2"
            />

            <path d={leftPath} fill="none" stroke="rgba(37,99,235,0.45)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d={rightPath} fill="none" stroke="rgba(15,118,110,0.48)" strokeWidth="4" strokeDasharray="9 8" strokeLinecap="round" strokeLinejoin="round" />
            <path d={totalPath} fill="none" stroke="rgba(15,23,42,0.94)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />

            <g transform="translate(58 426)">
              <circle cx="0" cy="0" r="5" fill="rgba(37,99,235,0.52)" />
              <text x="12" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
                left component
              </text>
              <line x1="132" x2="164" y1="0" y2="0" stroke="rgba(15,118,110,0.66)" strokeWidth="4" strokeDasharray="8 7" />
              <text x="176" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
                right component
              </text>
              <line x1="322" x2="356" y1="0" y2="0" stroke="rgba(15,23,42,0.94)" strokeWidth="6" strokeLinecap="round" />
              <text x="368" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
                total
              </text>
            </g>
          </svg>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <p className="m-0 min-h-14 max-w-xl text-sm leading-7 text-[color:var(--text-muted)]">
              {overlapLabel}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          </div>
        </div>

        <VerticalAmplitudeSlider
          label="Right-end pulse"
          value={rightAmplitude}
          color="rgb(15,118,110)"
          onChange={setRightAmplitude}
        />
      </div>


    </section>
  );
}
