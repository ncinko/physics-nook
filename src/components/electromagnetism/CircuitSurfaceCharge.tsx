import { useEffect, useMemo, useState } from 'react';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  frontMeetingReach,
  sampleLoop,
  solveLoop,
  transitionSnapshot,
  type LoopElement,
  type LoopElementKind,
  type LoopSample,
  type LoopTransitionSample,
} from '../../lib/electromagnetism/surfaceCharge';

// A battery, a resistor, and a switch you can throw as often as you like. Arc
// length runs clockwise from the bottom-left corner, so the geometry below and
// the element lengths handed to the model are the same numbers.
//
// The switch sits exactly half a loop from the battery, which keeps the two
// branches the same length: with the switch open they then carry equal and
// opposite charge, and the profile reads as a clean step across the gap.

const X0 = 140;
const X1 = 560;
const Y0 = 70;
const Y1 = 290;
const SIDE = Y1 - Y0; // 220
const SPAN = X1 - X0; // 420
const PERIMETER = 2 * (SIDE + SPAN); // 1280

const BATTERY_LENGTH = 56;
const RESISTOR_LENGTH = 70;
const SWITCH_LENGTH = 40;
const BATTERY_START = (SIDE - BATTERY_LENGTH) / 2; // 82, up the left edge
const BATTERY_END = BATTERY_START + BATTERY_LENGTH; // 138
const RESISTOR_START = SIDE + (SPAN - RESISTOR_LENGTH) / 2; // 395, along the top
const SWITCH_START = SIDE + SPAN + (SIDE - SWITCH_LENGTH) / 2; // 730, down the right edge

// The same spans in screen coordinates.
const BATTERY_HIGH_Y = Y1 - BATTERY_END; // 152, the positive terminal end
const BATTERY_LOW_Y = Y1 - BATTERY_START; // 208
const PLATE_LONG_Y = 176;
const PLATE_SHORT_Y = 190;
const RESISTOR_LEFT_X = X0 + RESISTOR_START - SIDE; // 315
const RESISTOR_RIGHT_X = RESISTOR_LEFT_X + RESISTOR_LENGTH; // 385
const SWITCH_TOP_Y = Y0 + SWITCH_START - SIDE - SPAN; // 160
const SWITCH_BOTTOM_Y = SWITCH_TOP_Y + SWITCH_LENGTH; // 200

const WIRE_RESISTANCE = 1.0; // ohms, shared out over every plain stretch of wire
const WIRE_LENGTH = PERIMETER - BATTERY_LENGTH - RESISTOR_LENGTH - SWITCH_LENGTH;
const EMF = 6;
const INTERNAL_RESISTANCE = 0.2;
const CLOSED_SWITCH_RESISTANCE = 0.01;
// Large enough that the leakage current rounds to zero and the drop across the
// gap rounds to the full emf, small enough to stay far from floating-point trouble.
const OPEN_SWITCH_RESISTANCE = 1e9;

const SAMPLES = 152;
const RELAXATION_LENGTH = PERIMETER / 12;
const MARK_OFFSET = 21;
// Fronts sweep the loop in about two and a half seconds, slow enough to watch.
const FRONT_SPEED = PERIMETER * 0.45;
const SETTLED_REACH = PERIMETER / 2 + 6 * RELAXATION_LENGTH;
// Below this there is no current worth drawing a field arrow for.
const CURRENT_FLOOR = 1e-4;

const ink = 'var(--text-primary)';
const muted = 'var(--text-muted)';
const positive = 'var(--accent-red)';
const negative = 'var(--accent-blue)';

const wire = (id: string, length: number): LoopElement => ({
  id,
  kind: 'wire',
  length,
  resistance: (WIRE_RESISTANCE * length) / WIRE_LENGTH,
});

function buildLoop(resistance: number, closed: boolean): LoopElement[] {
  const topArm = (SPAN - RESISTOR_LENGTH) / 2;
  const rightArm = (SIDE - SWITCH_LENGTH) / 2;
  return [
    wire('left-lower', BATTERY_START),
    { id: 'battery', kind: 'battery', length: BATTERY_LENGTH, resistance: INTERNAL_RESISTANCE, emf: EMF },
    wire('left-upper', BATTERY_START),
    wire('top-left', topArm),
    { id: 'resistor', kind: 'resistor', length: RESISTOR_LENGTH, resistance },
    wire('top-right', topArm),
    wire('right-upper', rightArm),
    {
      id: 'switch',
      kind: 'switch',
      length: SWITCH_LENGTH,
      resistance: closed ? CLOSED_SWITCH_RESISTANCE : OPEN_SWITCH_RESISTANCE,
    },
    wire('right-lower', rightArm),
    wire('bottom', SPAN),
  ];
}

interface LoopPoint {
  x: number;
  y: number;
  /** Unit tangent in the direction of increasing s (the current direction). */
  tx: number;
  ty: number;
  /** Unit normal pointing out of the loop, where surface charge is drawn. */
  nx: number;
  ny: number;
}

function pointAt(s: number): LoopPoint {
  const t = ((s % PERIMETER) + PERIMETER) % PERIMETER;
  if (t < SIDE) return { x: X0, y: Y1 - t, tx: 0, ty: -1, nx: -1, ny: 0 };
  if (t < SIDE + SPAN) return { x: X0 + (t - SIDE), y: Y0, tx: 1, ty: 0, nx: 0, ny: -1 };
  if (t < 2 * SIDE + SPAN) return { x: X1, y: Y0 + (t - SIDE - SPAN), tx: 0, ty: 1, nx: 1, ny: 0 };
  return { x: X1 - (t - 2 * SIDE - SPAN), y: Y1, tx: -1, ty: 0, nx: 0, ny: 1 };
}

/**
 * A field arrow drawn as its own geometry rather than with a stroke marker: at
 * these lengths a fixed marker head swamps the shaft, and what the reader has
 * to compare here is precisely how long each arrow is.
 */
function FieldArrow({ point, length, opacity }: { point: LoopPoint; length: number; opacity: number }) {
  const half = length / 2;
  const head = Math.min(7.5, Math.max(3, length * 0.42));
  const tipX = point.x + point.tx * half;
  const tipY = point.y + point.ty * half;
  const baseX = tipX - point.tx * head;
  const baseY = tipY - point.ty * head;
  const wing = head * 0.5;
  return (
    <g opacity={opacity}>
      <line
        x1={point.x - point.tx * half} y1={point.y - point.ty * half}
        x2={baseX} y2={baseY}
        stroke={ink} strokeWidth={2} strokeLinecap="round"
      />
      <polygon
        points={`${tipX},${tipY} ${baseX - point.ty * wing},${baseY + point.tx * wing} ${baseX + point.ty * wing},${baseY - point.tx * wing}`}
        fill={ink}
      />
    </g>
  );
}

/** A charge marker on the outside of the wire, sized by how much charge sits there. */
function ChargeMark({ point, weight }: { point: LoopPoint; weight: number }) {
  const size = Math.min(1, Math.abs(weight));
  if (size < 0.02) return null;
  const x = point.x + point.nx * MARK_OFFSET;
  const y = point.y + point.ny * MARK_OFFSET;
  const r = 2 + 5 * size;
  const arm = r * 0.62;
  return (
    <g opacity={0.25 + 0.75 * size}>
      <circle cx={x} cy={y} r={r} fill={weight > 0 ? positive : negative} fillOpacity={0.8} stroke={ink} strokeWidth={0.8} />
      <line x1={x - arm} y1={y} x2={x + arm} y2={y} stroke={ink} strokeWidth={1.2} />
      {weight > 0 ? <line x1={x} y1={y - arm} x2={x} y2={y + arm} stroke={ink} strokeWidth={1.2} /> : null}
    </g>
  );
}

const strip = (sample: LoopSample): LoopSample => ({
  s: sample.s,
  elementId: sample.elementId,
  kind: sample.kind,
  potential: sample.potential,
  field: sample.field,
  current: sample.current,
});

export default function CircuitSurfaceCharge() {
  const [resistance, setResistance] = useState(6);
  const [closed, setClosed] = useState(false);
  // Arc length the fronts have covered since the switch was last thrown, and
  // the profile the loop was holding at that moment.
  const [reach, setReach] = useState(Infinity);
  const [running, setRunning] = useState(false);
  const [previous, setPrevious] = useState<LoopSample[]>(() =>
    sampleLoop(buildLoop(6, false), SAMPLES));

  const elements = useMemo(() => buildLoop(resistance, closed), [resistance, closed]);
  const target = useMemo(() => sampleLoop(elements, SAMPLES), [elements]);
  const samples: LoopTransitionSample[] = useMemo(
    () => transitionSnapshot(elements, previous, target, {
      originId: 'switch',
      frontReach: reach,
      relaxationLength: RELAXATION_LENGTH,
    }),
    [elements, previous, target, reach],
  );

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setReach((value) => {
        const next = value + dt * FRONT_SPEED;
        if (next >= SETTLED_REACH) {
          setRunning(false);
          return Infinity;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  // Throwing the switch mid-transient is fine: whatever the loop is holding
  // right now becomes the state the next rearrangement starts from.
  const throwSwitch = () => {
    setPrevious(samples.map(strip));
    setClosed((value) => !value);
    setReach(0);
    setRunning(true);
  };

  // Arrow lengths are normalised against the settled current-carrying state, so
  // they mean the same thing whatever the switch is doing.
  const runningSolution = solveLoop(buildLoop(resistance, true));
  const peakField = buildLoop(resistance, true).reduce(
    (max, element) => Math.max(max, Math.abs(runningSolution.current) * (element.resistance / element.length)),
    0,
  );
  const meeting = frontMeetingReach(elements, 'switch');

  // Potential is the physical quantity; dividing by half the emf gives a
  // display scale for surface charge density that stays fixed as the switch is
  // thrown, so the bars can be compared between one state and the next.
  const chargeAt = (sample: LoopSample) => sample.potential / (EMF / 2);

  const atResistor = samples.find((sample) => sample.kind === 'resistor');
  const current = atResistor ? atResistor.current : 0;

  /** Potential dropped across a component, read just outside each of its ends. */
  const dropAcross = (kind: LoopElementKind) => {
    const first = samples.findIndex((sample) => sample.kind === kind);
    if (first < 0) return 0;
    let last = first;
    while (last + 1 < samples.length && samples[last + 1].kind === kind) last += 1;
    const count = samples.length;
    return samples[(first - 1 + count) % count].potential - samples[(last + 1) % count].potential;
  };

  // One arrow every eighth sample along the wire and a single long one through
  // the resistor, which is too short to hold a row of them. The battery and the
  // switch get none: what drives charge across those is not an electrostatic
  // field in a conductor.
  const inResistor = samples.filter((sample) => sample.kind === 'resistor');
  const arrows = [
    ...samples.filter((sample, index) => sample.kind === 'wire' && index % 8 === 0),
    ...inResistor.slice(Math.floor(inResistor.length / 2), Math.floor(inResistor.length / 2) + 1),
  ];

  const fronts = reach < meeting ? [SWITCH_START + SWITCH_LENGTH + reach, SWITCH_START - reach] : [];
  const status = running
    ? closed
      ? 'Closing: the new arrangement spreads from the gap; nothing ahead of the fronts has moved yet.'
      : 'Opening: the current dies behind the fronts as the whole drop moves back to the gap.'
    : closed
      ? 'Steady current: nearly the whole drop, and the whole charge gradient, sits across the resistor.'
      : 'Switch open: each branch sits at its own terminal’s potential, so all 6 V is dropped across the gap.';

  // The blade pivots on the lower contact and swings out of the loop.
  const bladeAngle = closed ? 0 : 40;
  const bladeTip = {
    x: X1 + SWITCH_LENGTH * Math.sin((bladeAngle * Math.PI) / 180),
    y: SWITCH_BOTTOM_Y - SWITCH_LENGTH * Math.cos((bladeAngle * Math.PI) / 180),
  };

  return (
    <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
      <ControlBar>
        <Button variant="secondary" onClick={throwSwitch}>
          {closed ? 'Open the switch' : 'Close the switch'}
        </Button>
        <Slider
          label="Resistor R"
          unit="Ω"
          min={0.5}
          max={20}
          step={0.5}
          value={resistance}
          onChange={setResistance}
          format={(value) => value.toFixed(1)}
        />
      </ControlBar>

      <svg
        viewBox="0 0 700 350"
        className="mx-auto mt-3 block w-full"
        role="img"
        aria-label={`A ${EMF} volt battery, a ${resistance.toFixed(1)} ohm resistor, and a switch that is currently ${closed ? 'closed' : 'open'}, wired in a rectangular loop. ${status}`}
      >
        {/* Wire, broken where the battery plates, the resistor, and the switch sit. */}
        <g fill="none" stroke="var(--grid-line)" strokeWidth={9} strokeLinecap="round">
          <path d={`M ${X0} ${Y1} L ${X0} ${PLATE_SHORT_Y}`} />
          <path d={`M ${X0} ${PLATE_LONG_Y} L ${X0} ${Y0} L ${RESISTOR_LEFT_X} ${Y0}`} />
          <path d={`M ${RESISTOR_RIGHT_X} ${Y0} L ${X1} ${Y0} L ${X1} ${SWITCH_TOP_Y}`} />
          <path d={`M ${X1} ${SWITCH_BOTTOM_Y} L ${X1} ${Y1} L ${X0} ${Y1}`} />
        </g>

        {/* Battery: long plate at the positive terminal, which faces the top wire. */}
        <g stroke={ink} strokeWidth={3} strokeLinecap="round">
          <line x1={X0 - 18} y1={PLATE_LONG_Y} x2={X0 + 18} y2={PLATE_LONG_Y} />
          <line x1={X0 - 9} y1={PLATE_SHORT_Y} x2={X0 + 9} y2={PLATE_SHORT_Y} />
        </g>
        <text x={X0 + 26} y={BATTERY_HIGH_Y + 12} fill={muted} fontSize={18}>+</text>
        <text x={X0 + 26} y={BATTERY_LOW_Y - 2} fill={muted} fontSize={18}>−</text>
        <text x={X0 - 30} y={PLATE_LONG_Y + 12} fill={ink} fontSize={17} textAnchor="end">{EMF} V</text>

        {/* Resistor, in the middle of the top wire. */}
        <rect
          x={RESISTOR_LEFT_X} y={Y0 - 12}
          width={RESISTOR_LENGTH} height={24}
          rx={3} fill="var(--surface-elevated)" stroke={ink} strokeWidth={2}
        />
        <text x={(RESISTOR_LEFT_X + RESISTOR_RIGHT_X) / 2} y={Y0 + 34} fill={ink} fontSize={17} textAnchor="middle">
          R = {resistance.toFixed(1)} Ω
        </text>

        {/* Switch, in the middle of the right edge and clickable. */}
        <g onClick={throwSwitch} style={{ cursor: 'pointer' }}>
          <rect x={X1 - 34} y={SWITCH_TOP_Y - 16} width={104} height={SWITCH_LENGTH + 32} fill="transparent" />
          <circle cx={X1} cy={SWITCH_TOP_Y} r={4} fill={ink} />
          <circle cx={X1} cy={SWITCH_BOTTOM_Y} r={4} fill={ink} />
          <line
            x1={X1} y1={SWITCH_BOTTOM_Y} x2={bladeTip.x} y2={bladeTip.y}
            stroke={ink} strokeWidth={3.5} strokeLinecap="round"
          />
        </g>
        <text x={X1 - 26} y={(SWITCH_TOP_Y + SWITCH_BOTTOM_Y) / 2 + 6} fill={muted} fontSize={15} textAnchor="end">
          switch
        </text>

        {/* Surface charge on the outside of the conductor. */}
        {samples.map((sample, index) =>
          sample.kind === 'battery' || sample.kind === 'switch' || index % 3 !== 0 ? null : (
            <ChargeMark key={sample.s} point={pointAt(sample.s)} weight={chargeAt(sample)} />
          ))}

        {/* The field those charges leave inside the metal, which is what drives the current. */}
        {arrows.map((sample) => {
          if (Math.abs(sample.current) < CURRENT_FLOOR) return null;
          const strength = peakField > 0 ? Math.abs(sample.field) / peakField : 0;
          const opacity = Math.min(1, sample.established * 2);
          if (opacity < 0.05) return null;
          return (
            <FieldArrow
              key={sample.s}
              point={pointAt(sample.s)}
              length={9 + 27 * strength ** 0.35}
              opacity={opacity}
            />
          );
        })}

        {/* Where the rearrangement has reached, while it is still on its way round. */}
        {fronts.map((s, index) => {
          const p = pointAt(s);
          return (
            <circle key={index} cx={p.x} cy={p.y} r={8} fill="none" stroke="var(--accent-green)" strokeWidth={3} opacity={0.9} />
          );
        })}

        <text x={X0 + SPAN / 2} y={Y1 + 46} fill={muted} fontSize={15} textAnchor="middle">{status}</text>
      </svg>

      <ChargeProfile samples={samples} charge={chargeAt} fronts={fronts} />

      <Readout variant="inline" className="mt-3 justify-center">
        <Readout.Value label="I through R" value={current.toFixed(2)} unit="A" />
        <Readout.Value label="ΔV across R" value={dropAcross('resistor').toFixed(2)} unit="V" />
        <Readout.Value label="ΔV across switch" value={dropAcross('switch').toFixed(2)} unit="V" />
      </Readout>

      <figcaption className="mt-3 text-center text-sm text-[var(--text-muted)]">
        Charges indicate the relative surface charge density along the circuit elements and the arrows are the resulting electric field.  Note the field in a resistor is typically a hundred times the
        field in the wire. Real corners carry extra charge to steer the field around them.
      </figcaption>
    </figure>
  );
}

/** The same charge, unrolled: arc length across, surface charge density up. */
function ChargeProfile({ samples, charge, fronts }: {
  samples: LoopTransitionSample[];
  charge: (sample: LoopSample) => number;
  fronts: number[];
}) {
  const left = 56;
  const right = 664;
  const mid = 66;
  const amp = 40;
  const toX = (s: number) => left + ((right - left) * (((s % PERIMETER) + PERIMETER) % PERIMETER)) / PERIMETER;
  const barWidth = (right - left) / (samples.length || 1);

  const bands = [
    { start: BATTERY_START, length: BATTERY_LENGTH, label: 'battery', color: 'var(--accent-green)' },
    { start: RESISTOR_START, length: RESISTOR_LENGTH, label: 'resistor', color: 'var(--accent-purple)' },
    { start: SWITCH_START, length: SWITCH_LENGTH, label: 'switch', color: 'var(--accent-blue)' },
  ];

  return (
    <svg viewBox="0 0 700 152" className="mx-auto mt-1 block w-full" role="presentation" aria-hidden="true">
      <line x1={left} y1={mid} x2={right} y2={mid} stroke="var(--grid-line)" strokeWidth={1} />
      {samples.map((sample) => {
        const value = charge(sample);
        const height = amp * Math.min(1, Math.abs(value));
        if (height < 0.4) return null;
        return (
          <rect
            key={sample.s}
            x={toX(sample.s) - barWidth / 2}
            y={value >= 0 ? mid - height : mid}
            width={barWidth * 0.9}
            height={height}
            fill={value >= 0 ? positive : negative}
            fillOpacity={0.75}
          />
        );
      })}
      {fronts.map((s, index) => (
        <line key={index} x1={toX(s)} y1={mid - amp - 6} x2={toX(s)} y2={mid + amp + 6}
          stroke="var(--accent-green)" strokeWidth={1.5} strokeDasharray="4 3" />
      ))}
      {bands.map((band) => (
        <g key={band.label}>
          <rect x={toX(band.start)} y={mid + amp + 8} width={Math.max(4, toX(band.start + band.length) - toX(band.start))} height={8}
            fill={band.color} fillOpacity={0.75} />
          <text x={toX(band.start + band.length / 2)} y={mid + amp + 32} fill={muted} fontSize={13} textAnchor="middle">
            {band.label}
          </text>
        </g>
      ))}
      <text x={left} y={mid - amp - 10} fill={muted} fontSize={13}>surface charge density</text>
      <text x={right} y={mid + amp + 32} fill={muted} fontSize={13} textAnchor="end">once around the loop →</text>
    </svg>
  );
}
