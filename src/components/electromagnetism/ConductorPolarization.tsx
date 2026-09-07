import { useEffect, useState } from 'react';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { slabPolarization } from '../../lib/electromagnetism/surfaceCharge';

// A conducting block dropped into a uniform field, watched while it screens the
// field out of its own interior. Time is the state, so the scene is a pure
// function of the slider: scrubbing and playing show the same frames.

const BLOCK = { left: 210, right: 450, top: 68, bottom: 232 };
const FIELD_ROWS = [96, 150, 204];
const MAX_TIME = 5; // in units of tau
const ARROW_STARTS = [232, 304, 376];
const ARROW_MAX = 62;
const ink = 'var(--text-primary)';
const muted = 'var(--text-muted)';
const negative = 'var(--accent-blue)';
const positive = 'var(--accent-red)';

// One deterministic scatter of conduction electrons, laid in bands that leave
// the middle row of field arrows clear.
const ELECTRONS = (() => {
  let seed = 20260906;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const dots: { x: number; y: number }[] = [];
  for (const y of [88, 118, 182, 212]) {
    for (let i = 0; i < 6; i++) {
      dots.push({ x: 236 + (i + next() * 0.8) * 34, y: y + (next() - 0.5) * 12 });
    }
  }
  return dots;
})();

const FACE_MARKS = Array.from({ length: 6 }, (_, i) =>
  BLOCK.top + ((i + 0.5) * (BLOCK.bottom - BLOCK.top)) / 6);

/**
 * A horizontal arrow drawn as its own geometry rather than with a stroke marker.
 * The interior arrows shrink to nothing as the block screens the field, and a
 * fixed marker head would still be sitting there at full size when they do.
 */
function Arrow({ x1, y, x2, color, width = 2 }: {
  x1: number; y: number; x2: number; color: string; width?: number;
}) {
  const span = x2 - x1;
  const head = Math.min(10, Math.max(2.5, Math.abs(span) * 0.42));
  const direction = span < 0 ? -1 : 1;
  const base = x2 - direction * head;
  return (
    <g>
      <line x1={x1} y1={y} x2={base} y2={y} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${x2},${y} ${base},${y - head * 0.5} ${base},${y + head * 0.5}`} fill={color} />
    </g>
  );
}

/** A surface charge marker: an accent disc with an ink glyph, both growing with `weight`. */
function ChargeMark({ x, y, sign, weight }: { x: number; y: number; sign: 1 | -1; weight: number }) {
  const r = 3.5 + 5 * weight;
  const arm = r * 0.55;
  return (
    <g opacity={0.25 + 0.75 * weight}>
      <circle cx={x} cy={y} r={r} fill={sign > 0 ? positive : negative} fillOpacity={0.75} stroke={ink} strokeWidth={1} />
      <line x1={x - arm} y1={y} x2={x + arm} y2={y} stroke={ink} strokeWidth={1.4} />
      {sign > 0 ? <line x1={x} y1={y - arm} x2={x} y2={y + arm} stroke={ink} strokeWidth={1.4} /> : null}
    </g>
  );
}

export default function ConductorPolarization() {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Playback only advances the same `time` the slider writes, so nothing in the
  // drawing depends on whether frames are running.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      setTime((t) => {
        const next = t + dt * 1.1;
        if (next >= MAX_TIME) {
          setPlaying(false);
          return MAX_TIME;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // tau = 1 puts the slider directly in units of the relaxation time.
  const state = slabPolarization(1, time, 1);
  const f = state.fraction;
  const interior = ARROW_MAX * state.internalField;
  // The arrows shrink with the field, but stop being readable as arrows long
  // before they reach zero, so they fade out over their last ten pixels and the
  // "E = 0" label fades in behind them.
  const arrowOpacity = Math.min(1, Math.max(0, (interior - 12) / 10));
  const settled = Math.min(1, Math.max(0, (0.19 - state.internalField) / 0.11));

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (time >= MAX_TIME) setTime(0);
    setPlaying(true);
  };

  return (
    <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
      <ControlBar>
        <Button variant="secondary" onClick={toggle}>
          {playing ? 'Pause' : time >= MAX_TIME ? 'Replay' : time > 0 ? 'Resume' : 'Play'}
        </Button>
        <Slider
          label="Time"
          unit="t / τ"
          min={0}
          max={MAX_TIME}
          step={0.05}
          value={Number(time.toFixed(2))}
          onChange={(value) => { setPlaying(false); setTime(value); }}
          format={(value) => value.toFixed(2)}
        />
      </ControlBar>

      <svg
        viewBox="0 0 660 300"
        className="mx-auto mt-3 block w-full"
        role="img"
        aria-label={`A conducting block in a uniform external field, ${Math.round(f * 100)} percent of the way through screening it out. The field inside the block is ${Math.round(state.internalField * 100)} percent of the external field, and each face carries ${state.surfaceChargeDensity > 0 ? 'induced' : 'no'} surface charge.`}
      >
        {/* The applied field, unchanged throughout: the block screens it, it does not weaken it. */}
        <g opacity={0.5}>
          <Arrow x1={30} y={30} x2={630} color={negative} />
          <Arrow x1={30} y={270} x2={630} color={negative} />
          {FIELD_ROWS.map((y) => (
            <g key={y}>
              <Arrow x1={30} y={y} x2={196} color={negative} />
              <Arrow x1={466} y={y} x2={630} color={negative} />
            </g>
          ))}
        </g>
        <text x={30} y={18} fill={negative} fontSize={17}>applied field E₀</text>

        <rect
          x={BLOCK.left} y={BLOCK.top}
          width={BLOCK.right - BLOCK.left} height={BLOCK.bottom - BLOCK.top}
          rx={6} fill="var(--grid-line)" fillOpacity={0.35} stroke={ink} strokeWidth={2}
        />

        {/* The conduction sea, drifting a little way against the field. */}
        {ELECTRONS.map((dot, i) => (
          <circle key={i} cx={dot.x - 14 * f} cy={dot.y} r={2.6} fill={negative} opacity={0.55} />
        ))}

        {/* Field surviving inside the block. */}
        {arrowOpacity > 0 ? (
          <g opacity={arrowOpacity}>
            {ARROW_STARTS.map((x) => (
              <Arrow key={x} x1={x} y={150} x2={x + interior} color={ink} width={2.5} />
            ))}
          </g>
        ) : null}
        {settled > 0 ? (
          <text x={330} y={156} fill={ink} fontSize={19} textAnchor="middle" opacity={settled}>
            E = 0 inside
          </text>
        ) : null}

        {FACE_MARKS.map((y) => (
          <g key={y}>
            <ChargeMark x={BLOCK.left} y={y} sign={-1} weight={f} />
            <ChargeMark x={BLOCK.right} y={y} sign={1} weight={f} />
          </g>
        ))}

        <text x={BLOCK.left - 14} y={BLOCK.bottom + 26} fill={muted} fontSize={17} textAnchor="middle">−σ</text>
        <text x={BLOCK.right + 14} y={BLOCK.bottom + 26} fill={muted} fontSize={17} textAnchor="middle">+σ</text>
      </svg>

      <RelaxationPlot time={time} />

      <Readout variant="inline" className="mt-3 justify-center">
        <Readout.Value label="E inside / E₀" value={state.internalField.toFixed(3)} />
        <Readout.Value label="face charge" value={f.toFixed(3)} unit="ε₀E₀" />
      </Readout>

      <figcaption className="mt-3 text-center text-sm text-[var(--text-muted)]">
        Electrons drift against E₀ until the two charged faces produce exactly the field needed to
        cancel it, after which nothing moves.
      </figcaption>
    </figure>
  );
}

/** Interior field and face charge against time, with a marker at the current frame. */
function RelaxationPlot({ time }: { time: number }) {
  const left = 52;
  const right = 636;
  const top = 14;
  const base = 92;
  const toX = (t: number) => left + ((right - left) * t) / MAX_TIME;
  const toY = (v: number) => base - (base - top) * v;
  const path = (value: (t: number) => number) =>
    Array.from({ length: 121 }, (_, i) => {
      const t = (MAX_TIME * i) / 120;
      return `${i === 0 ? 'M' : 'L'}${toX(t).toFixed(1)},${toY(value(t)).toFixed(1)}`;
    }).join(' ');
  const decay = (t: number) => Math.exp(-t);
  const build = (t: number) => 1 - Math.exp(-t);

  return (
    <svg viewBox="0 0 660 132" className="mx-auto mt-2 block w-full" role="presentation" aria-hidden="true">
      <line x1={left} y1={base} x2={right} y2={base} stroke="var(--grid-line)" strokeWidth={1} />
      <line x1={left} y1={top} x2={left} y2={base} stroke="var(--grid-line)" strokeWidth={1} />
      {Array.from({ length: MAX_TIME + 1 }, (_, t) => (
        <g key={t}>
          <line x1={toX(t)} y1={base} x2={toX(t)} y2={base + 4} stroke="var(--grid-line)" strokeWidth={1} />
          <text x={toX(t)} y={base + 18} fill={muted} fontSize={13} textAnchor="middle">{t}</text>
        </g>
      ))}
      <text x={(left + right) / 2} y={base + 36} fill={muted} fontSize={14} textAnchor="middle">t / τ</text>
      <path d={path(decay)} fill="none" stroke={ink} strokeWidth={2} />
      <path d={path(build)} fill="none" stroke={positive} strokeWidth={2} />
      <line x1={toX(time)} y1={top} x2={toX(time)} y2={base} stroke={muted} strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={toX(time)} cy={toY(decay(time))} r={4} fill={ink} />
      <circle cx={toX(time)} cy={toY(build(time))} r={4} fill={positive} />
      <text x={toX(2.9)} y={toY(0.78)} fill={positive} fontSize={14}>σ / ε₀E₀</text>
      <text x={toX(2.9)} y={toY(0.3)} fill={ink} fontSize={14}>E inside / E₀</text>
    </svg>
  );
}
