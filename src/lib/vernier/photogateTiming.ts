/**
 * From raw photogate edges to a ball's speed between two gates.
 *
 * A photogate reports nothing but moments: the beam was cut, the beam came
 * back. Everything the lab needs is arithmetic on those moments, so it lives
 * here, DOM-free, where `tests/vernier` can drive it with synthetic edges.
 *
 * Two wirings reach the same four moments differently:
 *
 *   two-port   Gate A on DIG 1, Gate B on DIG 2. The channel names the gate.
 *   one-port   Gate B daisy-chained into Gate A on DIG 1. The interface sees
 *              one line that is blocked whenever either beam is, so the gates
 *              are told apart by order: first blocking is A, second is B.
 *
 * Deliberately absent: anything about where the ball lands. The page asks the
 * student to work that out, and shipping the answer in the bundle would put it
 * one view-source away.
 */

import { NGIO_CHANNEL_ID, NGIO_EDGE_TICK_SECONDS, type NgioEdgeEvent } from './ngioPackets.ts';
import type { PhotogateWiring } from './ngioSession.ts';

export type Gate = 'A' | 'B';

/** One beam changing state. `line` is the shared one-port line. */
export interface GateTransition {
  gate: Gate | 'line';
  blocked: boolean;
  /** Seconds on the device clock since the first edge this session. */
  t: number;
}

/**
 * The capture clock is a 32-bit counter at 5 MHz, so it wraps about every
 * 859 s — well inside a class period. Differences taken modulo 2^32 are right
 * across the wrap as long as edges are less than one wrap apart, which a
 * roll always is.
 */
export const createTickClock = () => {
  let lastTicks: number | null = null;
  let seconds = 0;

  return (ticks: number): number => {
    if (lastTicks !== null) {
      seconds += ((ticks - lastTicks) >>> 0) * NGIO_EDGE_TICK_SECONDS;
    }
    lastTicks = ticks >>> 0;
    return seconds;
  };
};

/**
 * Works out, per channel, whether an edge means the beam was cut or restored.
 *
 * Measured on a LabQuest: when measurements start, the interface reports each
 * gate's current state as an edge, before anything has passed through. With
 * the gates clear at connect — which the page asks for — that first edge is
 * the "clear" level, and any other value means "blocked" from then on.
 * (Reading the first edge as a blocking instead is what showed every gate as
 * blocked at rest and clear when cut.)
 *
 * The trap in that rule is a gate that is *not* clear at connect — the ball
 * resting in it, a hand, a misaligned beam. Its polarity is then learned
 * backwards, and it reads blocked at rest until the next connect. So a
 * polarity confirmed by a real pass (`isPlausiblePass`) can be passed in as
 * `clearValue`, and then the start-of-stream report is read, not trusted.
 *
 * Once a channel's byte has been seen to change, or a `clearValue` is known,
 * the byte is a level: a repeated value is a repeat, not a change. Only a byte
 * that has never changed falls back to toggling.
 */
export const createBeamTracker = ({ clearValue }: { clearValue?: number } = {}) => {
  const channels = new Map<
    number,
    { blocked: boolean; clearValue: number; last: number; isLevel: boolean }
  >();

  const track = (event: Pick<NgioEdgeEvent, 'channel' | 'edge'>): boolean => {
    const known = channels.get(event.channel);

    if (!known) {
      const clear = clearValue ?? event.edge;
      const blocked = event.edge !== clear;
      channels.set(event.channel, {
        blocked,
        clearValue: clear,
        last: event.edge,
        isLevel: clearValue !== undefined,
      });
      return blocked;
    }

    const isLevel = known.isLevel || event.edge !== known.last;
    const blocked = isLevel ? event.edge !== known.clearValue : !known.blocked;
    channels.set(event.channel, { ...known, blocked, last: event.edge, isLevel });
    return blocked;
  };

  /** The level each channel reads as clear, for confirming and for diagnostics. */
  const clearValues = (): Map<number, number> =>
    new Map([...channels].map(([channel, state]) => [channel, state.clearValue]));

  return Object.assign(track, { clearValues });
};

export interface GateInterpreterOptions {
  /** A polarity confirmed on earlier passes; see `createBeamTracker`. */
  clearValue?: number;
}

/** Edges in, gate transitions out. One per session: it carries the clock. */
export const createGateInterpreter = (
  wiring: PhotogateWiring,
  { clearValue }: GateInterpreterOptions = {},
) => {
  const clock = createTickClock();
  const beam = createBeamTracker({ clearValue });

  const interpret = (event: NgioEdgeEvent): GateTransition => {
    const t = clock(event.ticks);
    const blocked = beam(event);
    const gate: GateTransition['gate'] =
      wiring === 'one-port' ? 'line' : event.channel === NGIO_CHANNEL_ID.DIGITAL2 ? 'B' : 'A';
    return { gate, blocked, t };
  };

  return Object.assign(interpret, { clearValues: beam.clearValues });
};

/** The four moments of one pass through both gates, in device seconds. */
export interface Transit {
  aBlock: number;
  aClear: number;
  bBlock: number;
  bClear: number;
}

export type TransitProblem =
  /** Gate B cut before Gate A: the ball rolled the wrong way. */
  | { kind: 'reversed' }
  /**
   * A pass that never finished. `seen` is how many transitions arrived, which
   * on a one-port line is the useful clue: 2 means only one blocking was ever
   * seen — Gate B is not chained in, or the gates are closer together than the
   * ball is wide, so the line never cleared between them.
   */
  | { kind: 'incomplete'; seen: number };

export type TransitEvent =
  | { kind: 'transit'; transit: Transit }
  | { kind: 'problem'; problem: TransitProblem };

export interface TransitAssemblerOptions {
  /** A pass slower than this is abandoned, not waited on. */
  maxTransitSeconds?: number;
}

/**
 * Collects transitions into complete passes.
 *
 * `push` may return more than one event: a new blocking long after an
 * unfinished pass reports the old one as incomplete before starting afresh.
 * `flush` is for the host's own timer, so a pass that simply stopped (the ball
 * was caught between the gates) is reported without waiting for the next roll.
 */
export const createTransitAssembler = (
  wiring: PhotogateWiring,
  { maxTransitSeconds = 3 }: TransitAssemblerOptions = {},
) => {
  let aBlock: number | null = null;
  let aClear: number | null = null;
  let bBlock: number | null = null;
  let bClear: number | null = null;
  let seen = 0;
  let quietUntil = -Infinity;

  const reset = () => {
    aBlock = aClear = bBlock = bClear = null;
    seen = 0;
  };

  const abandon = (): TransitEvent => {
    const event: TransitEvent = { kind: 'problem', problem: { kind: 'incomplete', seen } };
    reset();
    return event;
  };

  const complete = (): TransitEvent | null => {
    if (aBlock === null || aClear === null || bBlock === null || bClear === null) return null;
    const transit = { aBlock, aClear, bBlock, bClear };
    reset();
    return { kind: 'transit', transit };
  };

  const pushTwoPort = (transition: GateTransition, out: TransitEvent[]) => {
    const { gate, blocked, t } = transition;

    if (gate === 'A' && blocked) {
      if (aBlock !== null) out.push(abandon());
      aBlock = t;
    } else if (gate === 'A' && !blocked) {
      if (aBlock !== null && aClear === null) aClear = t;
    } else if (gate === 'B' && blocked) {
      if (aBlock === null) {
        // Rolling backwards. Stay quiet long enough for the ball to clear A
        // too, rather than starting a pass from it.
        quietUntil = t + maxTransitSeconds;
        out.push({ kind: 'problem', problem: { kind: 'reversed' } });
        return;
      }
      if (bBlock === null) bBlock = t;
    } else if (gate === 'B' && !blocked) {
      if (bBlock !== null && bClear === null) bClear = t;
    }
    seen += 1;
  };

  const pushOnePort = ({ blocked, t }: GateTransition) => {
    // Order is the only thing telling the gates apart: cut, clear, cut, clear.
    if (blocked) {
      if (aBlock === null) aBlock = t;
      else if (aClear !== null && bBlock === null) bBlock = t;
    } else {
      if (aBlock !== null && aClear === null) aClear = t;
      else if (bBlock !== null && bClear === null) bClear = t;
    }
    seen += 1;
  };

  return {
    push: (transition: GateTransition): TransitEvent[] => {
      const out: TransitEvent[] = [];
      if (transition.t < quietUntil) return out;

      if (aBlock !== null && transition.t - aBlock > maxTransitSeconds) out.push(abandon());

      // A pass only starts on a blocking. A stray restore — the tail of a
      // reversed roll — has nothing to belong to.
      if (aBlock === null && bBlock === null && !transition.blocked) return out;

      if (wiring === 'one-port') pushOnePort(transition);
      else pushTwoPort(transition, out);

      const done = complete();
      if (done) out.push(done);
      return out;
    },
    flush: (): TransitEvent | null => (seen > 0 ? abandon() : null),
    pending: () => seen,
    reset: () => {
      reset();
      quietUntil = -Infinity;
    },
  };
};

/** Time from cutting Gate A to cutting Gate B: the pulse-timing interval. */
export const gateToGateSeconds = (transit: Transit): number => transit.bBlock - transit.aBlock;

/** Average speed between the gates, from their leading edges. */
export const gateToGateSpeed = (transit: Transit, spacingMeters: number): number =>
  spacingMeters / gateToGateSeconds(transit);

/**
 * Speed at each gate from how long the ball held its beam. A cross-check, not
 * the measurement: the beam is cut by a chord of the ball that is only its
 * full diameter if the beam passes through the centre.
 */
export const speedsAtGates = (
  transit: Transit,
  diameterMeters: number,
): { a: number; b: number } => ({
  a: diameterMeters / (transit.aClear - transit.aBlock),
  b: diameterMeters / (transit.bClear - transit.bBlock),
});

/** Longest a rolling ball plausibly holds one beam: a 2.5 cm ball at 5 cm/s. */
export const MAX_PLAUSIBLE_BLOCK_SECONDS = 0.5;

/**
 * True for a pass that looks like a ball rolling through: each beam cut
 * briefly. A backwards-learned gate reads its long rest as "blocked", so it
 * cannot produce one of these — which makes a plausible pass proof that the
 * polarity in use is right, and worth remembering.
 */
export const isPlausiblePass = (transit: Transit): boolean => {
  const aHeld = transit.aClear - transit.aBlock;
  const bHeld = transit.bClear - transit.bBlock;
  return (
    aHeld > 0 &&
    bHeld > 0 &&
    aHeld < MAX_PLAUSIBLE_BLOCK_SECONDS &&
    bHeld < MAX_PLAUSIBLE_BLOCK_SECONDS &&
    gateToGateSeconds(transit) > 0
  );
};

export interface TrialStats {
  count: number;
  mean: number;
  /** Sample standard deviation; NaN with fewer than two trials. */
  sd: number;
}

export const trialStats = (values: readonly number[]): TrialStats => {
  const count = values.length;
  if (count === 0) return { count, mean: Number.NaN, sd: Number.NaN };
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  if (count < 2) return { count, mean, sd: Number.NaN };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  return { count, mean, sd: Math.sqrt(variance) };
};
