import { useMemo, useState } from 'react';
import { Button, ControlBar, Select, Toggle } from '../shared/InlineControls';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import NewtSprite, { NEWT_FEET_OFFSET } from './NewtSprite';
import {
  evaluateFreeBodySelection,
  freeBodyScenarios,
  type ForceKind,
  type FreeBodyCandidate,
  type FreeBodyScenario,
} from '../../lib/forces';

// Pick the forces that act on Newt, see the diagram you just described, then
// check it. The wrong answers are drawn too -- seeing your own bogus arrow next
// to the real ones is the point of the exercise.

const VIEW = { width: 620, height: 340 };
const NEWT = { x: 300, y: 176 };
// Every surface in these scenes is drawn at Newt's soles, so he is standing on
// the table, the floor, and the elevator rather than hovering above them.
const GROUND = NEWT.y + NEWT_FEET_OFFSET;

const COLOR_BY_KIND: Record<ForceKind, string> = {
  gravity: FORCE_COLORS.gravity,
  normal: FORCE_COLORS.normal,
  tension: FORCE_COLORS.tension,
  friction: FORCE_COLORS.friction,
  applied: FORCE_COLORS.applied,
  bogus: '#64748b',
};

/**
 * Fan out arrows that share a direction so a doubled-up pair stays readable
 * instead of drawing one exactly on top of the other.
 */
const spreadOrigins = (candidates: FreeBodyCandidate[]) => {
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    const key = `${Math.round(candidate.direction.x)},${Math.round(candidate.direction.y)}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    // Offset perpendicular to the arrow, alternating sides around the centre.
    // Wide enough that the two tip labels do not run into each other.
    const step = index === 0 ? 0 : Math.ceil(index / 2) * 30 * (index % 2 === 0 ? -1 : 1);
    const perpendicular = { x: -candidate.direction.y, y: candidate.direction.x };
    return {
      candidate,
      origin: { x: NEWT.x + perpendicular.x * step, y: NEWT.y + perpendicular.y * step },
    };
  });
};

const Backdrop = ({ scene }: { scene: FreeBodyScenario['scene'] }) => {
  const surface = 'var(--grid-line)';

  if (scene === 'hanging') {
    return (
      <g>
        <line x1="120" y1="34" x2="500" y2="34" stroke={surface} strokeWidth="6" strokeLinecap="round" />
        <line x1={NEWT.x} y1="34" x2={NEWT.x} y2={NEWT.y - 22} stroke={FORCE_COLORS.tension} strokeWidth="4" strokeLinecap="round" />
      </g>
    );
  }

  if (scene === 'elevator') {
    return (
      <g>
        <rect x="196" y={GROUND - 168} width="208" height="196" rx="10" fill="none" stroke={surface} strokeWidth="3" />
        <line x1="212" y1={GROUND} x2="388" y2={GROUND} stroke={surface} strokeWidth="5" strokeLinecap="round" />
        <line x1="428" y1={GROUND - 66} x2="428" y2={GROUND - 122} stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" />
        <polygon
          points={`428,${GROUND - 134} 422,${GROUND - 118} 434,${GROUND - 118}`}
          fill="var(--text-muted)"
        />
        <text x="444" y={GROUND - 96} fill="var(--text-muted)" fontSize="14" fontWeight="600">
          accelerating up
        </text>
      </g>
    );
  }

  return (
    <g>
      <line x1="120" y1={GROUND} x2="500" y2={GROUND} stroke={surface} strokeWidth="5" strokeLinecap="round" />
      {scene === 'table' ? (
        <>
          <line x1="168" y1={GROUND} x2="168" y2={GROUND + 52} stroke={surface} strokeWidth="4" strokeLinecap="round" />
          <line x1="452" y1={GROUND} x2="452" y2={GROUND + 52} stroke={surface} strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <>
          {Array.from({ length: 13 }, (_, index) => (
            <line
              key={index}
              x1={132 + index * 30}
              y1={GROUND}
              x2={143 + index * 30}
              y2={GROUND + 14}
              stroke={surface}
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
          <text x="404" y={NEWT.y - 54} fill="var(--text-muted)" fontSize="14" fontWeight="600">
            v
          </text>
          <line x1="356" y1={NEWT.y - 48} x2="400" y2={NEWT.y - 48} stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" />
          <polygon points={`412,${NEWT.y - 48} 396,${NEWT.y - 54} 396,${NEWT.y - 42}`} fill="var(--text-muted)" />
        </>
      )}
    </g>
  );
};

export default function FreeBodyDiagramBuilder() {
  const [scenarioId, setScenarioId] = useState(freeBodyScenarios[0].id);
  const [selected, setSelected] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);

  const scenario = useMemo(
    () => freeBodyScenarios.find((entry) => entry.id === scenarioId) ?? freeBodyScenarios[0],
    [scenarioId],
  );

  const drawn = useMemo(
    () => spreadOrigins(scenario.candidates.filter((candidate) => selected.includes(candidate.id))),
    [scenario, selected],
  );

  const evaluation = evaluateFreeBodySelection(scenario, selected);

  const chooseScenario = (id: string) => {
    setScenarioId(id);
    setSelected([]);
    setChecked(false);
  };

  const toggleForce = (id: string, on: boolean) => {
    setSelected((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
    setChecked(false);
  };

  // After checking, explain the forces that decided the answer: what was left
  // out, what should not have been there, and -- when correct -- why each one
  // belongs.
  const notes = checked
    ? evaluation.correct
      ? scenario.candidates.filter((candidate) => candidate.belongs)
      : scenario.candidates.filter(
          (candidate) => evaluation.missing.includes(candidate.id) || evaluation.extra.includes(candidate.id),
        )
    : [];

  return (
    <div className="not-prose my-8 grid gap-4">
      <ControlBar align="start">
        <Select
          label="Situation"
          value={scenario.id}
          onChange={chooseScenario}
          options={freeBodyScenarios.map((entry) => ({ value: entry.id, label: entry.title }))}
        />
      </ControlBar>

      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">
        {scenario.prompt} Which forces act on <strong className="text-[color:var(--text-primary)]">{scenario.system}</strong>?
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          role="img"
          aria-label={`Free-body diagram for ${scenario.title}, showing the ${drawn.length} forces currently selected`}
          className="block h-auto w-full select-none"
        >
          <Backdrop scene={scenario.scene} />
          <NewtSprite x={NEWT.x} y={NEWT.y} />
          {drawn.map(({ candidate, origin }) => (
            <ForceArrow
              key={candidate.id}
              origin={origin}
              vector={candidate.direction}
              scale={candidate.length}
              maxLength={candidate.length}
              color={COLOR_BY_KIND[candidate.kind]}
              label={candidate.arrowLabel || '?'}
              labelBounds={VIEW}
              opacity={checked && evaluation.extra.includes(candidate.id) ? 0.55 : 1}
            />
          ))}
        </svg>

        <div className="grid content-start gap-2">
          {scenario.candidates.map((candidate) => (
            <Toggle
              key={candidate.id}
              checked={selected.includes(candidate.id)}
              onChange={(on) => toggleForce(candidate.id, on)}
              label={<span className="leading-5">{candidate.label}</span>}
            />
          ))}
          <div className="mt-1">
            <Button onClick={() => setChecked(true)} disabled={selected.length === 0}>
              Check diagram
            </Button>
          </div>
        </div>
      </div>

      {checked && (
        <div className="grid gap-2 rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-4 py-3">
          <p className="m-0 font-semibold text-[color:var(--text-primary)]">
            {evaluation.correct
              ? 'That is the complete diagram.'
              : `Not yet — ${evaluation.missing.length} missing, ${evaluation.extra.length} that do not belong.`}
          </p>
          {notes.map((candidate) => (
            <p key={candidate.id} className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">
              <strong className="text-[color:var(--text-primary)]">{candidate.label}:</strong> {candidate.explanation}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
