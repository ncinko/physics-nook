import { useMemo, useState } from 'react';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import { generateAsperities, maxInterfaceFriction, solveContacts } from '../../lib/forces';

// A magnified side view of the interface between a block and the floor. Only the
// tips of the floor's asperities touch the block; each flattens until it can carry
// its share of the load, so the touching length grows in step with N.

const VIEW = { width: 760, height: 400 };
const FLOOR_LEFT = 60;
const FLOOR_SPAN = 640;
const BASE_Y = 330;
const COUNT = 80;
const SPACING = FLOOR_SPAN / COUNT;
const LAMBDA = 12;
const TIP_SLOPE = 0.3;
const BLOCK_CENTER = FLOOR_LEFT + FLOOR_SPAN / 2;
const BLOCK_HEIGHT = 80;
const PLOT = { x: 520, y: 34, width: 190, height: 100 };
const LOAD_RANGE = { min: 10, max: 80 };
const PLOT_LOADS = [10, 20, 30, 40, 50, 60, 70, 80];

const format = (value: number, digits = 1) => value.toFixed(digits);

export default function ContactAsperities() {
  const [load, setLoad] = useState(40);
  const [hardness, setHardness] = useState(1);
  const [shear, setShear] = useState(0.5);
  const [widthPercent, setWidthPercent] = useState(100);

  const floor = useMemo(() => generateAsperities(11, COUNT, FLOOR_SPAN, LAMBDA), []);

  const half = (FLOOR_SPAN / 2) * (widthPercent / 100);
  const blockLeft = BLOCK_CENTER - half;
  const blockRight = BLOCK_CENTER + half;
  const under = useMemo(
    () => floor.map((asperity, index) => ({ asperity, index })).filter(({ asperity }) => {
      const x = FLOOR_LEFT + asperity.x;
      return x >= blockLeft && x <= blockRight;
    }),
    [floor, blockLeft, blockRight],
  );
  const tips = useMemo(() => under.map(({ asperity }) => asperity), [under]);

  const solution = solveContacts(tips, load, hardness, TIP_SLOPE);
  const contactByIndex = new Map(solution.contacts.map((contact) => [under[contact.index].index, contact]));
  const blockLength = blockRight - blockLeft;
  const fMax = maxInterfaceFriction(solution, shear);
  const mu = shear / hardness;
  const levelY = BASE_Y - solution.level;
  const blockTop = levelY - BLOCK_HEIGHT;

  // The friction limit against load, measured on this very surface and block.
  const plotPoints = PLOT_LOADS.map((n) => ({ load: n, friction: maxInterfaceFriction(solveContacts(tips, n, hardness, TIP_SLOPE), shear) }));
  const plotMax = Math.max(40, mu * LOAD_RANGE.max * 1.05);
  const plotX = (n: number) => PLOT.x + (n / LOAD_RANGE.max) * PLOT.width;
  const plotY = (f: number) => PLOT.y + PLOT.height - (Math.min(f, plotMax) / plotMax) * PLOT.height;

  // The floor outline: valleys on the baseline, tips as points, touching tips
  // flattened at the block's height.
  const segments = floor.map((asperity) => {
    const x = FLOOR_LEFT + asperity.x;
    const contact = contactByIndex.get(floor.indexOf(asperity));
    const tipWidth = contact ? Math.min(contact.width, SPACING * 0.9) : 0;
    const tipY = contact ? levelY : BASE_Y - asperity.height;
    return `L ${x - SPACING / 2} ${BASE_Y} L ${x - tipWidth / 2} ${tipY} L ${x + tipWidth / 2} ${tipY} L ${x + SPACING / 2} ${BASE_Y}`;
  });
  const outline = `M ${FLOOR_LEFT} ${BASE_Y + 36} L ${FLOOR_LEFT} ${BASE_Y} ${segments.join(' ')} L ${FLOOR_LEFT + FLOOR_SPAN} ${BASE_Y} L ${FLOOR_LEFT + FLOOR_SPAN} ${BASE_Y + 36} Z`;

  return (
    <div className="not-prose my-8 grid gap-4">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={`A block pressed onto a rough floor with a load of ${format(load, 0)}: ${solution.contacts.length} asperity tips touch, over ${format((solution.area / blockLength) * 100)} percent of the block's length`}
        className="block h-auto w-full select-none"
      >
        <path d={outline} fill="color-mix(in srgb, var(--grid-line) 30%, transparent)" stroke="var(--grid-line)" strokeWidth="2" strokeLinejoin="round" />

        <rect
          x={blockLeft}
          y={blockTop}
          width={blockLength}
          height={BLOCK_HEIGHT}
          fill="color-mix(in srgb, var(--grid-line) 22%, transparent)"
          stroke="var(--grid-line)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {solution.contacts.map((contact) => {
          const asperity = under[contact.index].asperity;
          const width = Math.min(contact.width, SPACING * 0.9);
          return (
            <rect
              key={under[contact.index].index}
              x={FLOOR_LEFT + asperity.x - width / 2}
              y={levelY - 2}
              width={width}
              height={4}
              rx={1.5}
              fill={FORCE_COLORS.normal}
            />
          );
        })}

        <ForceArrow
          origin={{ x: BLOCK_CENTER, y: blockTop - load * 1.1 }}
          vector={{ x: 0, y: 1 }}
          scale={load * 1.1}
          maxLength={load * 1.1}
          color={FORCE_COLORS.applied}
          label="N"
          labelBounds={VIEW}
        />

        <text x={FLOOR_LEFT} y={BASE_Y + 56} fill="var(--text-muted)" fontSize="13" fontWeight="600">
          Magnified view of the interface. Blue marks are the places the surfaces actually touch.
        </text>

        {/* Friction limit against load. */}
        <g>
          <line x1={PLOT.x} y1={PLOT.y + PLOT.height} x2={PLOT.x + PLOT.width} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
          <line x1={PLOT.x} y1={PLOT.y} x2={PLOT.x} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
          <text x={PLOT.x + PLOT.width} y={PLOT.y + PLOT.height + 16} textAnchor="end" fill="var(--text-muted)" fontSize="12" fontWeight="600">
            load N
          </text>
          <text x={PLOT.x + 6} y={PLOT.y + 10} fill="var(--text-muted)" fontSize="12" fontWeight="600">
            friction limit
          </text>
          <line x1={plotX(0)} y1={plotY(0)} x2={plotX(LOAD_RANGE.max)} y2={plotY(mu * LOAD_RANGE.max)} stroke="var(--grid-line)" strokeWidth="1.5" strokeDasharray="4 4" />
          {plotPoints.map((point) => (
            <circle key={point.load} cx={plotX(point.load)} cy={plotY(point.friction)} r="3" fill="var(--text-muted)" />
          ))}
          <circle cx={plotX(load)} cy={plotY(fMax)} r="5.5" fill={FORCE_COLORS.friction} />
        </g>
      </svg>

      <ControlBar>
        <Slider label="load N" min={LOAD_RANGE.min} max={LOAD_RANGE.max} step={1} value={load} onChange={setLoad} />
        <Slider label="hardness" min={0.6} max={2.5} step={0.1} value={hardness} onChange={setHardness} format={(v) => v.toFixed(1)} />
        <Slider label="shear strength" min={0.1} max={1.5} step={0.05} value={shear} onChange={setShear} format={(v) => v.toFixed(2)} />
        <Slider label="block width" unit="%" min={40} max={100} step={5} value={widthPercent} onChange={setWidthPercent} />
      </ControlBar>

      <Readout variant="inline" className="justify-center">
        <Readout.Value label="tips touching" value={String(solution.contacts.length)} />
        <Readout.Value label="touching length" value={format((solution.area / blockLength) * 100)} unit="%" />
        <Readout.Value label="friction limit" value={format(fMax)} />
        <Readout.Value label="μ" value={format(mu, 2)} />
      </Readout>
    </div>
  );
}
