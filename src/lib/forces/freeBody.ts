// Scenario catalog for the free-body diagram builder, plus the pure check that
// scores a reader's selection.
//
// Every scenario mixes forces that genuinely act on the chosen system with the
// distractors that intro students actually reach for: a "force of motion" that
// keeps a sliding object going, a third-law partner that acts on the *other*
// object, and `ma` written down as if it were a force of its own.

import type { Vector2 } from '../math/vectors.ts';

/** Which force this is, so the renderer can color it consistently. */
export type ForceKind = 'gravity' | 'normal' | 'tension' | 'friction' | 'applied' | 'bogus';

export interface FreeBodyCandidate {
  id: string;
  /** Checkbox label, e.g. "Weight". */
  label: string;
  /** Short label drawn at the arrow tip, e.g. "mg". */
  arrowLabel: string;
  kind: ForceKind;
  /** Screen-space direction for the arrow (y grows downward, as in SVG). */
  direction: Vector2;
  /** Arrow length in scene units, so a balanced pair reads as balanced. */
  length: number;
  belongs: boolean;
  /** Shown after checking, for both right and wrong answers. */
  explanation: string;
}

export interface FreeBodyScenario {
  id: string;
  title: string;
  /** The situation, in one or two sentences. */
  prompt: string;
  /** The object the diagram is drawn for. */
  system: string;
  /** Backdrop the renderer should draw behind Newt. */
  scene: 'table' | 'sliding' | 'hanging' | 'elevator';
  candidates: FreeBodyCandidate[];
}

const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };
const LEFT = { x: -1, y: 0 };
const RIGHT = { x: 1, y: 0 };

export const freeBodyScenarios: FreeBodyScenario[] = [
  {
    id: 'resting',
    title: 'Resting on a table',
    prompt: 'Newt sits still on a level table.',
    system: 'Newt',
    scene: 'table',
    candidates: [
      {
        id: 'weight',
        label: 'Weight of Newt',
        arrowLabel: 'mg',
        kind: 'gravity',
        direction: DOWN,
        length: 72,
        belongs: true,
        explanation: 'Earth pulls down on Newt. Gravity acts whether or not anything is touching him.',
      },
      {
        id: 'normal',
        label: 'Normal force from the table',
        arrowLabel: 'N',
        kind: 'normal',
        direction: UP,
        length: 72,
        belongs: true,
        explanation: 'The table is compressed slightly and pushes back up, perpendicular to its surface.',
      },
      {
        id: 'newt-on-table',
        label: "Newt's push on the table",
        arrowLabel: '',
        kind: 'bogus',
        direction: DOWN,
        length: 72,
        belongs: false,
        explanation:
          'This force is real, but it acts on the table, not on Newt. It is the third-law partner of the normal force, and partners never appear on the same diagram.',
      },
      {
        id: 'holding',
        label: 'A force holding Newt up because he is not falling',
        arrowLabel: '',
        kind: 'bogus',
        direction: UP,
        length: 52,
        belongs: false,
        explanation:
          'Nothing extra is needed. The normal force already balances the weight, which is exactly why Newt does not fall.',
      },
    ],
  },
  {
    id: 'sliding',
    title: 'Sliding across a floor',
    prompt: 'Newt is given one shove and then slides to the right across a rough floor. Draw his diagram after your hand has let go.',
    system: 'Newt',
    scene: 'sliding',
    candidates: [
      {
        id: 'weight',
        label: 'Weight of Newt',
        arrowLabel: 'mg',
        kind: 'gravity',
        direction: DOWN,
        length: 72,
        belongs: true,
        explanation: 'Gravity still pulls down, unchanged by the fact that Newt is moving.',
      },
      {
        id: 'normal',
        label: 'Normal force from the floor',
        arrowLabel: 'N',
        kind: 'normal',
        direction: UP,
        length: 72,
        belongs: true,
        explanation: 'Newt is still in contact with the floor, so the floor still pushes up.',
      },
      {
        id: 'friction',
        label: 'Kinetic friction from the floor',
        arrowLabel: 'f',
        kind: 'friction',
        direction: LEFT,
        length: 58,
        belongs: true,
        explanation: 'Friction opposes the sliding, so it points left while Newt slides right. This is the only unbalanced force, so Newt slows down.',
      },
      {
        id: 'motion',
        label: 'A forward force keeping Newt moving',
        arrowLabel: '',
        kind: 'bogus',
        direction: RIGHT,
        length: 58,
        belongs: false,
        explanation:
          'Motion does not need a force to continue. The first law says Newt keeps moving on his own; the shove is over, and nothing is pushing him now.',
      },
      {
        id: 'shove',
        label: 'The shove that started him moving',
        arrowLabel: '',
        kind: 'bogus',
        direction: RIGHT,
        length: 64,
        belongs: false,
        explanation:
          'The shove is finished. A free-body diagram shows the forces acting at one instant, not the history of how the object got moving.',
      },
    ],
  },
  {
    id: 'hanging',
    title: 'Hanging from his tongue',
    prompt: 'Newt hangs at rest from his tongue, stuck to a branch above him.',
    system: 'Newt',
    scene: 'hanging',
    candidates: [
      {
        id: 'weight',
        label: 'Weight of Newt',
        arrowLabel: 'mg',
        kind: 'gravity',
        direction: DOWN,
        length: 72,
        belongs: true,
        explanation: 'Gravity does not care what Newt is attached to.',
      },
      {
        id: 'tension',
        label: 'Tension in the tongue',
        arrowLabel: 'T',
        kind: 'tension',
        direction: UP,
        length: 72,
        belongs: true,
        explanation: 'A taut tongue pulls along its own length, up toward the branch.',
      },
      {
        id: 'normal',
        label: 'Normal force',
        arrowLabel: '',
        kind: 'bogus',
        direction: UP,
        length: 52,
        belongs: false,
        explanation: 'There is no surface in contact with Newt, so there is no normal force. Tension is doing that job here.',
      },
    ],
  },
  {
    id: 'elevator',
    title: 'Accelerating upward',
    prompt: 'Newt stands on a scale in an elevator that is speeding up as it rises.',
    system: 'Newt',
    scene: 'elevator',
    candidates: [
      {
        id: 'weight',
        label: 'Weight of Newt',
        arrowLabel: 'mg',
        kind: 'gravity',
        direction: DOWN,
        length: 62,
        belongs: true,
        explanation: 'The weight is still mg. Gravity does not change because the elevator accelerates.',
      },
      {
        id: 'normal',
        label: 'Normal force from the scale',
        arrowLabel: 'N',
        kind: 'normal',
        direction: UP,
        length: 88,
        belongs: true,
        explanation:
          'The scale pushes up harder than the weight. That imbalance is what accelerates Newt upward, and the larger N is what the scale reads.',
      },
      {
        id: 'ma',
        label: 'An upward force equal to ma',
        arrowLabel: '',
        kind: 'bogus',
        direction: UP,
        length: 40,
        belongs: false,
        explanation:
          'The quantity ma is the *result* of the forces, not another force. It belongs on the right-hand side of the second law, never on the diagram.',
      },
    ],
  },
];

export interface FreeBodyEvaluation {
  /** True when every force that belongs is selected and nothing else is. */
  correct: boolean;
  /** Ids that belong but were left out. */
  missing: string[];
  /** Ids that were selected but do not act on the system. */
  extra: string[];
}

export const evaluateFreeBodySelection = (
  scenario: FreeBodyScenario,
  selectedIds: readonly string[],
): FreeBodyEvaluation => {
  const selected = new Set(selectedIds);
  const missing = scenario.candidates
    .filter((candidate) => candidate.belongs && !selected.has(candidate.id))
    .map((candidate) => candidate.id);
  const extra = scenario.candidates
    .filter((candidate) => !candidate.belongs && selected.has(candidate.id))
    .map((candidate) => candidate.id);

  return { correct: missing.length === 0 && extra.length === 0, missing, extra };
};
