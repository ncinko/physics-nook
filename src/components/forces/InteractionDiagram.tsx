import { useMemo, useState, type KeyboardEvent } from 'react';
import { Select, ControlBar } from '../shared/InlineControls';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import {
  add,
  BUBBLE_RADIUS,
  classifyForSystem,
  dot,
  interactionScenes,
  normalize,
  scale,
  subtract,
  systemBoundaryPath,
  type Interaction,
  type InteractionKind,
  type InteractionScene,
  type Vector2,
} from '../../lib/forces';

// Interaction diagram: objects as bubbles, one labelled link per interaction.
// The "map" stage is just the labelled links. In the "system" stage, tapping
// bubbles moves them in or out of a dashed boundary, and the links that cross
// it become a particle free-body diagram. Scene data and the boundary geometry
// live in lib/forces/interactions.

const VIEW = { width: 540, height: 400 };
const FBD_VIEW = { width: 240, height: 240 };
const FBD_SCALE = 40;
const FBD_MAX = 92;
const LINK_SPREAD = 34;

const COLOR: Record<InteractionKind, string> = {
  gravity: FORCE_COLORS.gravity,
  normal: FORCE_COLORS.normal,
  tension: FORCE_COLORS.tension,
  friction: FORCE_COLORS.friction,
  applied: FORCE_COLORS.applied,
};

const SYMBOL: Record<InteractionKind, string> = {
  gravity: 'Fg',
  normal: 'N',
  tension: 'T',
  friction: 'f',
  applied: 'push',
};

const round = (n: number) => Math.round(n * 100) / 100;

interface LinkGeometry {
  interaction: Interaction;
  path: string;
  labelPoint: Vector2;
}

/**
 * Curve each link so several interactions between the same two objects
 * (gravity, normal, friction) fan out instead of stacking on one line.
 */
const layoutLinks = (scene: InteractionScene): LinkGeometry[] => {
  const byPair = new Map<string, Interaction[]>();
  for (const interaction of scene.interactions) {
    const key = [interaction.a, interaction.b].sort().join('|');
    byPair.set(key, [...(byPair.get(key) ?? []), interaction]);
  }

  const position = (id: string) => scene.objects.find((object) => object.id === id)!.position;

  return [...byPair.entries()].flatMap(([key, links]) => {
    // Orient by sorted ids so the fan direction does not depend on a/b order.
    const [first, second] = key.split('|');
    const p0 = position(first);
    const p1 = position(second);
    const direction = normalize(subtract(p1, p0));
    const perpendicular = { x: -direction.y, y: direction.x };
    const mid = scale(add(p0, p1), 0.5);

    return links.map((interaction, index) => {
      const offset = (index - (links.length - 1) / 2) * LINK_SPREAD;
      // A quadratic curve's midpoint sits halfway to its control point.
      const control = add(mid, scale(perpendicular, offset * 2));
      return {
        interaction,
        path: `M ${round(p0.x)} ${round(p0.y)} Q ${round(control.x)} ${round(control.y)} ${round(p1.x)} ${round(p1.y)}`,
        labelPoint: add(mid, scale(perpendicular, offset)),
      };
    });
  });
};

const activateOnKey = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

/** Fan out arrows sharing a direction so none hides another. */
const fanOrigins = (forces: Vector2[], centre: Vector2) => {
  const seen = new Map<string, number>();
  return forces.map((force) => {
    const unit = normalize(force);
    const key = `${Math.round(unit.x * 4)},${Math.round(unit.y * 4)}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const step = index === 0 ? 0 : Math.ceil(index / 2) * 26 * (index % 2 === 0 ? -1 : 1);
    return add(centre, scale({ x: -unit.y, y: unit.x }, step));
  });
};

const listJoin = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;

interface InteractionDiagramProps {
  stage?: 'map' | 'system';
  initialScene?: string;
}

export default function InteractionDiagram({ stage = 'map', initialScene }: InteractionDiagramProps) {
  const [sceneId, setSceneId] = useState(initialScene ?? interactionScenes[0].id);
  const scene = interactionScenes.find((entry) => entry.id === sceneId) ?? interactionScenes[0];
  const [system, setSystem] = useState<string[]>(scene.defaultSystem);

  const links = useMemo(() => layoutLinks(scene), [scene]);
  const objectById = (id: string) => scene.objects.find((object) => object.id === id)!;
  const isSystem = stage === 'system';

  const chooseScene = (id: string) => {
    const next = interactionScenes.find((entry) => entry.id === id) ?? interactionScenes[0];
    setSceneId(next.id);
    setSystem(next.defaultSystem);
  };

  const toggleObject = (id: string) =>
    setSystem((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const classification = classifyForSystem(scene, system);
  const internalIds = new Set(classification.internal.map((interaction) => interaction.id));
  const externalIds = new Set(classification.external.map((force) => force.interaction.id));
  const boundary = isSystem ? systemBoundaryPath(scene, system) : '';

  const linkOpacity = (interaction: Interaction) => {
    if (!isSystem) return 1;
    if (internalIds.has(interaction.id)) return 0.3;
    return externalIds.has(interaction.id) || system.length === 0 ? 1 : 0.55;
  };

  const systemNames = scene.objects.filter((object) => system.includes(object.id)).map((object) => object.name);

  // The system is one dot, so same-kind forces from the same agent pointing the
  // same way (Earth's gravity on Newt and on the box) add into a single arrow.
  const merged = classification.external.reduce<
    { id: string; kind: InteractionKind; label: string; by: string; on: string[]; force: Vector2 }[]
  >((groups, entry) => {
    const match = groups.find(
      (group) =>
        group.kind === entry.interaction.kind &&
        group.by === entry.by &&
        dot(normalize(group.force), normalize(entry.force)) > 0.999,
    );
    if (match) {
      match.force = add(match.force, entry.force);
      match.on.push(entry.on);
    } else {
      groups.push({
        id: entry.interaction.id,
        kind: entry.interaction.kind,
        label: entry.interaction.label,
        by: entry.by,
        on: [entry.on],
        force: entry.force,
      });
    }
    return groups;
  }, []);

  const fbdOrigins = fanOrigins(
    merged.map((group) => group.force),
    { x: FBD_VIEW.width / 2, y: FBD_VIEW.height / 2 },
  );

  const systemCaption = (() => {
    if (system.length === 0) {
      return 'Tap an object to put it inside the system.';
    }
    if (classification.external.length === 0) {
      return 'Everything is inside the boundary, so every interaction is internal and nothing is left to draw.';
    }
    const forces = merged.map(
      (group) =>
        `${group.label} from ${objectById(group.by).name}${
          system.length > 1 ? ` on ${listJoin(group.on.map((id) => objectById(id).name))}` : ''
        }`,
    );
    const internal = classification.internal.length
      ? ` Internal, so left off: ${listJoin(
          classification.internal.map(
            (interaction) => `${interaction.label} between ${objectById(interaction.a).name} and ${objectById(interaction.b).name}`,
          ),
        )}.`
      : '';
    return `Forces on the system: ${listJoin(forces)}.${internal}`;
  })();

  const diagram = (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      role={isSystem ? 'group' : 'img'}
      aria-label={`Interaction diagram for ${scene.title}: ${listJoin(
        scene.interactions.map(
          (interaction) => `${interaction.label} between ${objectById(interaction.a).name} and ${objectById(interaction.b).name}`,
        ),
      )}`}
      className="mx-auto block h-auto w-full max-w-[540px] select-none"
    >
      {boundary && (
        <path
          d={boundary}
          fill="var(--accent-blue)"
          fillOpacity={0.05}
          stroke="var(--accent-blue)"
          strokeWidth={2}
          strokeDasharray="9 7"
        />
      )}

      {links.map(({ interaction, path, labelPoint }) => {
        const color = COLOR[interaction.kind];
        return (
          <g key={interaction.id} opacity={linkOpacity(interaction)}>
            <path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
            <text
              x={round(labelPoint.x)}
              y={round(labelPoint.y)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={700}
              fill={color}
              paintOrder="stroke"
              stroke="var(--bg-primary)"
              strokeWidth={5}
            >
              {interaction.label}
            </text>
          </g>
        );
      })}

      {scene.objects.map((object) => {
        const inside = system.includes(object.id);
        const toggle = () => toggleObject(object.id);
        return (
          <g
            key={object.id}
            {...(isSystem
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-pressed': inside,
                  'aria-label': `${object.label}, ${inside ? 'inside' : 'outside'} the system`,
                  onClick: toggle,
                  onKeyDown: activateOnKey(toggle),
                  style: { cursor: 'pointer' },
                  className: 'outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]',
                }
              : {})}
          >
            <circle
              cx={object.position.x}
              cy={object.position.y}
              r={BUBBLE_RADIUS}
              fill="var(--surface-plot)"
              stroke={isSystem && inside ? 'var(--accent-blue)' : 'var(--text-primary)'}
              strokeWidth={isSystem && inside ? 3 : 2}
            />
            <text
              x={object.position.x}
              y={object.position.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={15}
              fontWeight={600}
              fill="var(--text-primary)"
            >
              {object.label}
            </text>
          </g>
        );
      })}
    </svg>
  );

  return (
    <div className="not-prose mx-auto my-8 grid w-full max-w-[820px] gap-3 text-[var(--text-primary)]">
      <ControlBar>
        <Select
          label="Scene"
          value={scene.id}
          onChange={chooseScene}
          options={interactionScenes.map((entry) => ({ value: entry.id, label: entry.title }))}
        />
      </ControlBar>

      {!isSystem ? (
        diagram
      ) : (
        <>
          <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            {diagram}
            <figure className="m-0">
              <svg
                viewBox={`0 0 ${FBD_VIEW.width} ${FBD_VIEW.height}`}
                role="img"
                aria-label={
                  system.length
                    ? `Free-body diagram for ${listJoin(systemNames)}, with ${merged.length} forces`
                    : 'Free-body diagram with no system chosen'
                }
                className="mx-auto block h-auto w-full max-w-[14rem]"
              >
                {merged.map((group, index) => (
                  <ForceArrow
                    key={group.id}
                    origin={fbdOrigins[index]}
                    vector={group.force}
                    scale={FBD_SCALE}
                    maxLength={FBD_MAX}
                    color={COLOR[group.kind]}
                    label={SYMBOL[group.kind]}
                    labelBounds={FBD_VIEW}
                  />
                ))}
                {system.length > 0 && (
                  <circle cx={FBD_VIEW.width / 2} cy={FBD_VIEW.height / 2} r={6} fill="var(--text-primary)" />
                )}
              </svg>
              <figcaption className="type-label mt-1 text-center">
                {system.length
                  ? `Free-body diagram: ${listJoin(scene.objects.filter((o) => system.includes(o.id)).map((o) => o.label))}`
                  : 'No system chosen'}
              </figcaption>
            </figure>
          </div>
          <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]" aria-live="polite">
            {systemCaption}
          </p>
        </>
      )}
    </div>
  );
}
