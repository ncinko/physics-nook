import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import { fixed } from '../../utils/format';
import DeviceConnectPanel from '../hardware/DeviceConnectPanel';
import { useVernierPhotogates, type Beams } from '../hardware/useVernierPhotogates';
import type { PhotogateWiring } from '../../lib/vernier/ngioSession';
import {
  createTransitAssembler,
  gateToGateSeconds,
  speedsAtGates,
  trialStats,
  type Transit,
  type TransitEvent,
  type TransitProblem,
} from '../../lib/vernier/photogateTiming';

// Predict where a ball rolling off the table will land.
//
// The page measures and records; it never works the projectile problem. The
// student carries the timed speed and the table height into their own
// calculation and tests it on the floor. There is no theoretical range
// anywhere in this bundle to peek at.

/** A pass slower than this is abandoned. A roll that slow will not leave the table anyway. */
const MAX_TRANSIT_SECONDS = 3;
const STORAGE_KEY = 'physics-nook:photogate-launch:v2';

interface Roll {
  id: number;
  transit: Transit;
}

interface LabState {
  spacingCm: string;
  heightCm: string;
  diameterCm: string;
  rolls: Roll[];
}

const INITIAL_STATE: LabState = {
  spacingCm: '',
  heightCm: '',
  diameterCm: '',
  rolls: [],
};

const loadState = (): LabState => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return INITIAL_STATE;
    const parsed = JSON.parse(stored) as Partial<LabState>;
    return {
      spacingCm: parsed.spacingCm ?? '',
      heightCm: parsed.heightCm ?? '',
      diameterCm: parsed.diameterCm ?? '',
      rolls: Array.isArray(parsed.rolls) ? parsed.rolls : [],
    };
  } catch {
    return INITIAL_STATE;
  }
};

const saveState = (state: LabState) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows and blocked storage just lose the convenience.
  }
};

/** A positive length in cm, or null. */
const parseCm = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
};

const simulatedWiring = (): PhotogateWiring | null => {
  if (typeof window === 'undefined') return null;
  const flag = new URLSearchParams(window.location.search).get('sim');
  if (flag === null) return null;
  return flag === 'chain' ? 'one-port' : 'two-port';
};

const describeProblem = (problem: TransitProblem, wiring: PhotogateWiring | null): string => {
  if (problem.kind === 'reversed') {
    return 'Gate B was blocked before Gate A. Roll the ball through Gate A first.';
  }
  if (wiring === 'one-port' && problem.seen <= 2) {
    return (
      'Only one gate saw the ball. Check that Gate B is plugged into the daisy-chain port on ' +
      'Gate A. If it is, the gates may be closer together than the ball is wide: spread them out.'
    );
  }
  return 'The ball did not make it through both gates. Roll it again from the same mark.';
};

const numberField =
  'w-24 rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--bg-primary)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]';

function Step({
  index,
  title,
  locked = false,
  children,
}: {
  index: number;
  title: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`border-t border-[var(--grid-line)] pt-4 first:border-t-0 first:pt-0 ${locked ? 'opacity-50' : ''}`}
      aria-disabled={locked}
    >
      <h3 className="type-label m-0 text-[var(--accent-blue)]">
        {index}. {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function LengthField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-[9rem] font-semibold">{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={numberField}
      />
      <span className="text-[var(--text-muted)]">cm</span>
      {hint && <span className="type-supporting">{hint}</span>}
    </label>
  );
}

function BeamIndicators({ beams, wiring }: { beams: Beams; wiring: PhotogateWiring | null }) {
  const gates: { key: keyof Beams; label: string }[] =
    wiring === 'one-port'
      ? [{ key: 'line', label: 'Gates (chained)' }]
      : [
          { key: 'A', label: 'Gate A' },
          { key: 'B', label: 'Gate B' },
        ];

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm" aria-live="polite">
      {gates.map(({ key, label }) => (
        <span key={key} className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-3 w-3 rounded-full border border-[var(--text-muted)] ${
              beams[key] ? 'bg-[var(--accent-red)]' : 'bg-transparent'
            }`}
          />
          <span>
            {label}: <span className="font-semibold">{beams[key] ? 'blocked' : 'clear'}</span>
          </span>
        </span>
      ))}
      <span className="type-supporting">Pass a finger through each beam to check it.</span>
    </div>
  );
}

export default function PhotogateLaunchLab() {
  const [simWiring] = useState(simulatedWiring);
  const device = useVernierPhotogates(simWiring ?? 'two-port');
  const { wiring, streamId, subscribe, simulated } = device;
  const connected = device.status.kind === 'streaming';

  const [lab, setLab] = useState<LabState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const stored = loadState();
    nextId.current = Math.max(0, ...stored.rolls.map((entry) => entry.id)) + 1;
    setLab(stored);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveState(lab);
  }, [hydrated, lab]);

  const spacing = parseCm(lab.spacingCm);
  const diameter = parseCm(lab.diameterCm);

  const speedOf = useCallback(
    (transit: Transit) => (spacing === null ? Number.NaN : spacing / 100 / gateToGateSeconds(transit)),
    [spacing],
  );

  const stats = useMemo(() => trialStats(lab.rolls.map((roll) => speedOf(roll.transit))), [lab.rolls, speedOf]);
  const enoughRolls = stats.count >= 3;

  useEffect(() => {
    if (!wiring) return undefined;
    const assembler = createTransitAssembler(wiring, { maxTransitSeconds: MAX_TRANSIT_SECONDS });
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = (events: TransitEvent[]) => {
      events.forEach((event) => {
        if (event.kind === 'problem') {
          setNotice(describeProblem(event.problem, wiring));
          return;
        }
        setNotice(null);
        const roll = { id: nextId.current++, transit: event.transit };
        setLab((current) => ({ ...current, rolls: [...current.rolls, roll] }));
      });
    };

    const unsubscribe = subscribe((transition) => {
      handle(assembler.push(transition));
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer =
        assembler.pending() > 0
          ? setTimeout(() => {
              const flushed = assembler.flush();
              if (flushed) handle([flushed]);
            }, (MAX_TRANSIT_SECONDS + 0.25) * 1000)
          : null;
    });

    return () => {
      unsubscribe();
      if (flushTimer !== null) clearTimeout(flushTimer);
    };
  }, [wiring, streamId, subscribe]);

  const update = (patch: Partial<LabState>) => setLab((current) => ({ ...current, ...patch }));

  const roll = () => {
    simulated?.roll({
      speed: 0.9 * (1 + (Math.random() - 0.5) * 0.06),
      spacingMeters: (spacing ?? 10) / 100,
      diameterMeters: (diameter ?? 2.5) / 100,
      jitterSeconds: 0.00005,
    });
  };

  return (
    <div className="not-prose flex flex-col gap-5 px-5 py-5 text-[var(--text-primary)]">
      <Step index={1} title="Connect the gates">
        <DeviceConnectPanel
          device={device}
          allowSimulated={simWiring !== null}
          simulatedLabel="Simulated gates"
        >
          <BeamIndicators beams={device.beams} wiring={wiring} />
          {simulated && (
            <div className="mt-3">
              <Button variant="secondary" onClick={roll}>
                Roll a simulated ball
              </Button>
            </div>
          )}
        </DeviceConnectPanel>
        <p className="type-supporting mt-2">
          Keep both beams clear while connecting. Gate A goes in DIG 1. Gate B goes in DIG 2, or
          into the daisy-chain port on Gate A.
        </p>
      </Step>

      <Step index={2} title="Measure the setup">
        <div className="flex flex-col gap-2">
          <LengthField
            label="Gate spacing"
            value={lab.spacingCm}
            onChange={(value) => update({ spacingCm: value })}
            hint="beam to beam"
          />
          <LengthField
            label="Table height"
            value={lab.heightCm}
            onChange={(value) => update({ heightCm: value })}
            hint="floor to tabletop"
          />
          <LengthField
            label="Ball diameter"
            value={lab.diameterCm}
            onChange={(value) => update({ diameterCm: value })}
            hint="optional"
          />
        </div>
      </Step>

      <Step index={3} title="Time the ball" locked={!connected || spacing === null}>
        <p className="m-0 text-sm">
          Release the ball from the same mark each time and catch it after Gate B, before it
          leaves the table. Three rolls or more.
        </p>

        {notice && (
          <p className="mt-2 text-sm text-[var(--accent-red)]" role="alert">
            {notice}
          </p>
        )}

        {lab.rolls.length > 0 && (
          <>
            <p className="mt-3 text-base">
              Mean speed{' '}
              <span className="font-mono text-xl font-semibold tabular-nums">
                {fixed(stats.mean, 3)}
              </span>{' '}
              m/s
              {Number.isFinite(stats.sd) && (
                <span className="text-[var(--text-muted)]">
                  {' '}
                  ± <span className="font-mono tabular-nums">{fixed(stats.sd, 3)}</span> (SD,{' '}
                  {stats.count} rolls)
                </span>
              )}
            </p>

            <table className="mt-2 w-full max-w-lg border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--grid-line)] text-left text-[var(--text-muted)]">
                  <th className="py-1 font-semibold">Roll</th>
                  <th className="py-1 text-right font-semibold">A → B time (ms)</th>
                  <th className="py-1 text-right font-semibold">Speed (m/s)</th>
                  {diameter !== null && (
                    <th className="py-1 text-right font-semibold">At A / at B</th>
                  )}
                  <th className="py-1" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {lab.rolls.map((entry, index) => {
                  const atGates =
                    diameter !== null ? speedsAtGates(entry.transit, diameter / 100) : null;
                  return (
                    <tr key={entry.id} className="border-b border-[var(--grid-line)]">
                      <td className="py-1">{index + 1}</td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        {fixed(gateToGateSeconds(entry.transit) * 1000, 1)}
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        {fixed(speedOf(entry.transit), 3)}
                      </td>
                      {atGates && (
                        <td className="py-1 text-right font-mono tabular-nums text-[var(--text-muted)]">
                          {fixed(atGates.a, 2)} / {fixed(atGates.b, 2)}
                        </td>
                      )}
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                          aria-label={`Remove roll ${index + 1}`}
                                        onClick={() =>
                            update({ rolls: lab.rolls.filter((other) => other.id !== entry.id) })
                          }
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {diameter !== null && (
              <p className="type-supporting mt-1">
                “At A / at B” is the ball’s diameter divided by how long it blocked each beam. It
                is only a rough check, and it reads low if the beam crosses the ball below its
                centre.
              </p>
            )}
            <div className="mt-3">
              <Button
                variant="secondary"
                    onClick={() => {
                  update({ rolls: [] });
                  setNotice(null);
                }}
              >
                <RotateCcw aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                Clear rolls
              </Button>
            </div>
          </>
        )}
      </Step>

      <Step index={4} title="Predict the landing" locked={!enoughRolls}>
        <p className="m-0 text-sm">
          Use your mean speed and the table height to work out how far from the table the ball
          will land. Measure from the point on the floor directly below the table edge (use a
          plumb bob to find it). Then place a target there and launch the ball.
        </p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-semibold text-[var(--accent-blue)]">
            Stuck? Questions to guide you
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Just after the ball leaves the edge, which direction is it moving? What is its
              vertical velocity at that instant?
            </li>
            <li>
              Once the ball is in the air, which component of its velocity does gravity change,
              and which does it leave alone?
            </li>
            <li>Only one of your measurements sets how long the fall takes. Which one?</li>
            <li>How far does the ball travel horizontally in that time?</li>
          </ul>
          <p className="mt-2">
            The <a href="/kinematics/two-dimensional">2D kinematics</a> page covers projectile
            motion one component at a time.
          </p>
        </details>
      </Step>
    </div>
  );
}
