// Pure, DOM-free progress tracking for the Circuit Builder's guided tutorial.
// The component (src/components/electromagnetism/CircuitKit.tsx) owns the drag
// interaction and the rendering; this module owns the question "given the circuit
// the learner has built so far, which step are they on?" so it can be unit tested.
//
// Progress is recomputed from the circuit on every render rather than latched.
// That means the tutorial self-corrects: delete the battery and the battery step
// becomes current again, which is the honest thing to show.

/** The element kinds CircuitKit's palette can place. Mirrors PALETTE there. */
export type CircuitElementKind =
  | 'wire' | 'resistor' | 'battery' | 'capacitor' | 'inductor' | 'switch';

/** The subset of a CircuitKit element this module needs. */
export interface TutorialElement {
  id: string;
  type: string;
  n1: string;
  n2: string;
  params?: { closed?: boolean };
}

export interface TutorialContext {
  elements: TutorialElement[];
  isRunning: boolean;
}

/** What the learner is asked to end up with: a battery driving current through a
 *  resistor, with a switch to break the loop and wire to close it. */
export const REQUIRED_KINDS: CircuitElementKind[] = ['battery', 'resistor', 'switch', 'wire'];

export interface LoopAnalysis {
  /** A battery exists to build the loop around. */
  hasBattery: boolean;
  /** The battery's own two terminals are joined by some other path: a closed loop. */
  isLoopClosed: boolean;
  /** Kinds that sit on the battery's connected component (both endpoints inside). */
  kindsInLoop: CircuitElementKind[];
  /** Every switch on that component is closed, and there is at least one. */
  switchesClosed: boolean;
}

/** Union-find over node ids. Small enough that path compression alone is plenty. */
function makeUnionFind() {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = parent.get(a) ?? a;
    if (root === a) { parent.set(a, a); return a; }
    root = find(root);
    parent.set(a, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union };
}

/**
 * Inspect the circuit around its first battery.
 *
 * "Closed" is a topological question, deliberately separate from whether a switch
 * is open: an open switch is still an edge in the graph, so the loop stays closed
 * and the tutorial can ask for the switch to be closed as its own step.
 */
export function analyzeLoop(elements: TutorialElement[]): LoopAnalysis {
  const battery = elements.find((e) => e.type === 'battery');
  if (!battery) {
    return { hasBattery: false, isLoopClosed: false, kindsInLoop: [], switchesClosed: false };
  }

  // Connectivity of everything except the battery itself. If its two terminals
  // still meet, current has a path back and the loop is closed.
  const uf = makeUnionFind();
  for (const e of elements) {
    if (e.id === battery.id) continue;
    uf.union(e.n1, e.n2);
  }
  const isLoopClosed = uf.find(battery.n1) === uf.find(battery.n2);

  // Now include the battery, so "on the battery's component" is well defined even
  // before the loop is closed.
  const whole = makeUnionFind();
  for (const e of elements) whole.union(e.n1, e.n2);
  const root = whole.find(battery.n1);
  const onLoop = elements.filter(
    (e) => whole.find(e.n1) === root && whole.find(e.n2) === root,
  );

  const kindsInLoop = [...new Set(onLoop.map((e) => e.type))] as CircuitElementKind[];
  const switches = onLoop.filter((e) => e.type === 'switch');
  const switchesClosed = switches.length > 0 && switches.every((e) => e.params?.closed === true);

  return { hasBattery: true, isLoopClosed, kindsInLoop, switchesClosed };
}

export interface TutorialStep {
  id: string;
  title: string;
  instruction: string;
  isDone: (ctx: TutorialContext) => boolean;
}

const countOf = (elements: TutorialElement[], kind: CircuitElementKind) =>
  elements.filter((e) => e.type === kind).length;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'battery',
    title: 'Place a battery',
    instruction:
      'Drag a battery out of the palette and drop it on the grid.  Many circuits need a "voltage source" to function.',
    isDone: ({ elements }) => countOf(elements, 'battery') >= 1,
  },
  {
    id: 'resistor',
    title: 'Add a resistor',
    instruction:
      'Place a resistor on the grid. This will act as the load, converting electrical energy into heat.',
    isDone: ({ elements }) => countOf(elements, 'resistor') >= 1,
  },
  {
    id: 'switch',
    title: 'Add a switch',
    instruction:
      'Place a switch on the grid.  This will allow us to break the circuit without removing any wires.',
    isDone: ({ elements }) => countOf(elements, 'switch') >= 1,
  },
  {
    id: 'wire',
    title: 'Add a wire',
    instruction:
      'Place a wire on the grid. Wires are used to connect other circuit components when they are to far apart to connect directly.',
    isDone: ({ elements }) => countOf(elements, 'wire') >= 1,
  },
  {
    id: 'loop',
    title: 'Join them into a loop',
    instruction:
      'Drag the blue ring at the end of each component onto the ring of its neighbor; they should snap together. Keep going until the four parts form one unbroken ring: battery -> switch -> resistor -> wire -> battery.',
    isDone: ({ elements }) => {
      const a = analyzeLoop(elements);
      return a.isLoopClosed && REQUIRED_KINDS.every((k) => a.kindsInLoop.includes(k));
    },
  },
  {
    id: 'close-switch',
    title: 'Close the switch',
    instruction:
      'Click the switch, then tick "Closed" in the inspector.',
    isDone: ({ elements }) => analyzeLoop(elements).switchesClosed,
  },
  {
    id: 'run',
    title: 'Run it',
    instruction:
      'Press Play. Animated dots indicate the flow of current.',
    isDone: ({ isRunning }) => isRunning,
  },
];

export interface TutorialProgress {
  /** Per-step completion, aligned with TUTORIAL_STEPS. */
  done: boolean[];
  /** Index of the first incomplete step, or TUTORIAL_STEPS.length when finished. */
  activeIndex: number;
  /** Every step satisfied. */
  complete: boolean;
  completedCount: number;
}

export function tutorialProgress(ctx: TutorialContext): TutorialProgress {
  const done = TUTORIAL_STEPS.map((s) => s.isDone(ctx));
  const firstOpen = done.indexOf(false);
  const complete = firstOpen === -1;
  return {
    done,
    activeIndex: complete ? TUTORIAL_STEPS.length : firstOpen,
    complete,
    completedCount: done.filter(Boolean).length,
  };
}
