// Interaction diagrams: the concept map drawn before a free-body diagram.
//
// Each object is a bubble and each interaction is one link between two of
// them. A link stores only the force on its `b` end; the force on `a` is the
// negative of that, so every scene obeys Newton's third law by construction.
// Drawing a boundary around some of the bubbles sorts the links into external
// ones (they cross the boundary and become forces on the system) and internal
// ones (both ends inside, so the pair cancels and drops off the diagram).
//
// Each scene also carries the geometry for its realistic drawing beside the
// diagram (`inScene`, `applyAt`, `labelAt`), so the pair arrows land on the
// right objects and their labels stay clear of the artwork.

import { add, magnitude, scale, subtract, type Vector2 } from '../math/vectors.ts';
import type { ForceKind } from './freeBody.ts';

export type InteractionKind = Exclude<ForceKind, 'bogus'>;

export interface InteractionObject {
  id: string;
  /** Short name drawn inside the bubble, e.g. "Earth". */
  label: string;
  /** Name used in sentences, e.g. "the table". */
  name: string;
  /** Bubble centre in diagram units (SVG space, y grows downward). */
  position: Vector2;
  /**
   * Where the object sits in the scene drawing (SCENE_VIEW units): Newt, the
   * ball, and the box by their centre, the table by its top, the tree by its
   * branch joint, and Earth by the spot its label is drawn.
   */
  inScene: Vector2;
}

/** A hand-placed arrow label, for arrows whose tip would crowd the artwork. */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface Interaction {
  id: string;
  a: string;
  b: string;
  kind: InteractionKind;
  /** Type label drawn on the link, e.g. "gravity". */
  label: string;
  /** Force on object `b` in screen space (y down), in weight-like units. */
  forceOnB: Vector2;
  /** One sentence describing both halves of the pair. */
  pair: string;
  /** Tail of each force's arrow in the scene drawing (SCENE_VIEW units). */
  applyAt: { a: Vector2; b: Vector2 };
  /** Label positions that override the default spot just past the arrow tip. */
  labelAt?: { a?: LabelSpot; b?: LabelSpot };
}

export interface InteractionScene {
  id: string;
  title: string;
  objects: InteractionObject[];
  interactions: Interaction[];
  /** Objects inside the boundary when the scene first loads. */
  defaultSystem: string[];
}

/** Bubble radius and the gap the system boundary keeps around each bubble. */
export const BUBBLE_RADIUS = 34;
export const BOUNDARY_PAD = 12;

/**
 * The realistic scene drawing: its size, the height of Earth's surface, and the
 * drawn length of every pair arrow. Only one pair shows at a time and its two
 * forces are always equal, so one fixed length reads best.
 */
export const SCENE_VIEW = { width: 400, height: 340, ground: 262, arrowLength: 36 };

const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };
const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };

// Forces on Earth are drawn inside its body, below the surface.
const EARTH_DEEP = 328;
const EARTH_SURFACE = SCENE_VIEW.ground + 6;
const EARTH_LABEL = { x: 34, y: 326 };

export const interactionScenes: InteractionScene[] = [
  {
    id: 'falling-ball',
    title: 'A falling ball',
    objects: [
      { id: 'ball', label: 'Ball', name: 'the ball', position: { x: 270, y: 110 }, inScene: { x: 200, y: 110 } },
      { id: 'earth', label: 'Earth', name: 'Earth', position: { x: 270, y: 290 }, inScene: EARTH_LABEL },
    ],
    interactions: [
      {
        id: 'earth-ball-gravity',
        a: 'earth',
        b: 'ball',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: DOWN,
        pair: 'Earth pulls down on the ball, and the ball pulls up on Earth just as hard.',
        applyAt: { a: { x: 200, y: EARTH_DEEP }, b: { x: 200, y: 110 } },
      },
    ],
    defaultSystem: ['ball'],
  },
  {
    id: 'table',
    title: 'Newt on a table',
    objects: [
      { id: 'newt', label: 'Newt', name: 'Newt', position: { x: 200, y: 110 }, inScene: { x: 220, y: 162 } },
      { id: 'table', label: 'Table', name: 'the table', position: { x: 340, y: 190 }, inScene: { x: 240, y: 200 } },
      { id: 'earth', label: 'Earth', name: 'Earth', position: { x: 200, y: 290 }, inScene: EARTH_LABEL },
    ],
    interactions: [
      {
        id: 'earth-newt-gravity',
        a: 'earth',
        b: 'newt',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: DOWN,
        pair: 'Earth pulls down on Newt, and Newt pulls up on Earth.',
        applyAt: { a: { x: 220, y: EARTH_DEEP }, b: { x: 220, y: 162 } },
        labelAt: { b: { x: 172, y: 186, anchor: 'end' } },
      },
      {
        id: 'table-newt-normal',
        a: 'table',
        b: 'newt',
        kind: 'normal',
        label: 'normal',
        forceOnB: UP,
        pair: 'The table pushes up on Newt, and Newt pushes down on the table.',
        applyAt: { a: { x: 220, y: 206 }, b: { x: 220, y: 162 } },
      },
      {
        id: 'earth-table-gravity',
        a: 'earth',
        b: 'table',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: scale(DOWN, 1.4),
        pair: 'Earth pulls down on the table, and the table pulls up on Earth.',
        applyAt: { a: { x: 290, y: EARTH_DEEP }, b: { x: 290, y: 206 } },
      },
      {
        id: 'earth-table-normal',
        a: 'earth',
        b: 'table',
        kind: 'normal',
        label: 'normal',
        forceOnB: scale(UP, 2.4),
        pair: 'The floor pushes up on the table legs, and the legs push down on the floor.',
        applyAt: { a: { x: 315, y: EARTH_SURFACE }, b: { x: 315, y: SCENE_VIEW.ground } },
        labelAt: { b: { x: 305, y: 238, anchor: 'end' } },
      },
    ],
    defaultSystem: ['newt'],
  },
  {
    id: 'hanging',
    title: 'Newt hanging by his tongue',
    objects: [
      { id: 'tree', label: 'Tree', name: 'the tree', position: { x: 340, y: 110 }, inScene: { x: 330, y: 40 } },
      { id: 'newt', label: 'Newt', name: 'Newt', position: { x: 200, y: 190 }, inScene: { x: 200, y: 205 } },
      { id: 'earth', label: 'Earth', name: 'Earth', position: { x: 270, y: 300 }, inScene: EARTH_LABEL },
    ],
    interactions: [
      {
        id: 'tree-newt-tension',
        a: 'tree',
        b: 'newt',
        kind: 'tension',
        label: 'tension',
        forceOnB: UP,
        pair: 'The tongue pulls Newt up toward the branch, and pulls the branch down toward Newt.',
        // Beside the tongue rather than on top of it: at the branch, and where
        // the tongue leaves the top of Newt's head. Labels sit clear of the tongue.
        applyAt: { a: { x: 218, y: 46 }, b: { x: 218, y: 167 } },
        labelAt: { a: { x: 228, y: 64, anchor: 'start' }, b: { x: 228, y: 149, anchor: 'start' } },
      },
      {
        id: 'earth-newt-gravity',
        a: 'earth',
        b: 'newt',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: DOWN,
        pair: 'Earth pulls down on Newt, and Newt pulls up on Earth.',
        applyAt: { a: { x: 200, y: EARTH_DEEP }, b: { x: 200, y: 205 } },
        labelAt: { b: { x: 150, y: 232, anchor: 'end' } },
      },
      {
        id: 'earth-tree-gravity',
        a: 'earth',
        b: 'tree',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: scale(DOWN, 1.6),
        pair: 'Earth pulls down on the tree, and the tree pulls up on Earth.',
        applyAt: { a: { x: 330, y: EARTH_DEEP }, b: { x: 330, y: 110 } },
        labelAt: { b: { x: 318, y: 128, anchor: 'end' } },
      },
      {
        id: 'earth-tree-normal',
        a: 'earth',
        b: 'tree',
        kind: 'normal',
        label: 'normal',
        forceOnB: scale(UP, 2.6),
        pair: 'The ground pushes up on the tree, and the tree pushes down on the ground.',
        applyAt: { a: { x: 330, y: EARTH_SURFACE }, b: { x: 330, y: SCENE_VIEW.ground } },
      },
    ],
    defaultSystem: ['newt'],
  },
  {
    id: 'pushing-box',
    title: 'Newt pushing a box',
    objects: [
      { id: 'newt', label: 'Newt', name: 'Newt', position: { x: 160, y: 130 }, inScene: { x: 176, y: 224 } },
      { id: 'box', label: 'Box', name: 'the box', position: { x: 380, y: 130 }, inScene: { x: 260, y: 222 } },
      { id: 'earth', label: 'Earth', name: 'Earth', position: { x: 270, y: 290 }, inScene: EARTH_LABEL },
    ],
    interactions: [
      {
        id: 'newt-box-push',
        a: 'newt',
        b: 'box',
        kind: 'applied',
        label: 'push',
        forceOnB: scale(RIGHT, 1.2),
        pair: 'Newt pushes the box forward, and the box pushes Newt backward just as hard.',
        // Both tails sit where Newt's hands meet the box; labels go above them.
        applyAt: { a: { x: 218, y: 222 }, b: { x: 222, y: 222 } },
        labelAt: { a: { x: 212, y: 170, anchor: 'end' }, b: { x: 228, y: 170, anchor: 'start' } },
      },
      {
        id: 'earth-newt-gravity',
        a: 'earth',
        b: 'newt',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: DOWN,
        pair: 'Earth pulls down on Newt, and Newt pulls up on Earth.',
        applyAt: { a: { x: 176, y: EARTH_DEEP }, b: { x: 176, y: 224 } },
        labelAt: { b: { x: 128, y: 244, anchor: 'end' } },
      },
      {
        id: 'earth-newt-normal',
        a: 'earth',
        b: 'newt',
        kind: 'normal',
        label: 'normal',
        forceOnB: UP,
        pair: 'The floor pushes up on Newt, and Newt pushes down on the floor.',
        applyAt: { a: { x: 176, y: EARTH_SURFACE }, b: { x: 176, y: 224 } },
      },
      {
        id: 'earth-newt-friction',
        a: 'earth',
        b: 'newt',
        kind: 'friction',
        label: 'friction',
        forceOnB: scale(RIGHT, 1.5),
        pair: "Newt's feet push the floor backward, so the floor pushes Newt forward. That forward push is what moves him.",
        applyAt: { a: { x: 186, y: 274 }, b: { x: 150, y: 258 } },
        labelAt: { b: { x: 128, y: 244, anchor: 'end' } },
      },
      {
        id: 'earth-box-gravity',
        a: 'earth',
        b: 'box',
        kind: 'gravity',
        label: 'gravity',
        forceOnB: scale(DOWN, 1.3),
        pair: 'Earth pulls down on the box, and the box pulls up on Earth.',
        applyAt: { a: { x: 260, y: EARTH_DEEP }, b: { x: 260, y: 222 } },
        labelAt: { b: { x: 306, y: 240, anchor: 'start' } },
      },
      {
        id: 'earth-box-normal',
        a: 'earth',
        b: 'box',
        kind: 'normal',
        label: 'normal',
        forceOnB: scale(UP, 1.3),
        pair: 'The floor pushes up on the box, and the box pushes down on the floor.',
        applyAt: { a: { x: 260, y: EARTH_SURFACE }, b: { x: 260, y: 222 } },
      },
      {
        id: 'earth-box-friction',
        a: 'earth',
        b: 'box',
        kind: 'friction',
        label: 'friction',
        forceOnB: scale(LEFT, 0.7),
        pair: 'The floor drags backward on the sliding box, and the box drags the floor forward.',
        applyAt: { a: { x: 280, y: 274 }, b: { x: 280, y: 258 } },
        labelAt: { a: { x: 300, y: 294, anchor: 'start' }, b: { x: 306, y: 250, anchor: 'start' } },
      },
    ],
    defaultSystem: ['newt'],
  },
];

export const thirdLawPair = (interaction: Interaction) => ({
  onA: scale(interaction.forceOnB, -1),
  onB: interaction.forceOnB,
});

export interface ExternalForce {
  interaction: Interaction;
  /** The inside object the force acts on. */
  on: string;
  /** The outside object exerting it. */
  by: string;
  force: Vector2;
}

export interface SystemClassification {
  external: ExternalForce[];
  internal: Interaction[];
}

/**
 * Sort a scene's links against a chosen system. A link with exactly one end
 * inside is external; its force on that inside end goes on the free-body
 * diagram. A link with both ends inside is internal. Links entirely outside
 * the system are neither.
 */
export const classifyForSystem = (
  scene: InteractionScene,
  systemIds: readonly string[],
): SystemClassification => {
  const inside = new Set(systemIds);
  const external: ExternalForce[] = [];
  const internal: Interaction[] = [];

  for (const interaction of scene.interactions) {
    const aIn = inside.has(interaction.a);
    const bIn = inside.has(interaction.b);
    if (aIn && bIn) {
      internal.push(interaction);
    } else if (bIn) {
      external.push({ interaction, on: interaction.b, by: interaction.a, force: interaction.forceOnB });
    } else if (aIn) {
      external.push({ interaction, on: interaction.a, by: interaction.b, force: scale(interaction.forceOnB, -1) });
    }
  }

  return { external, internal };
};

const cross = (o: Vector2, p: Vector2, q: Vector2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

/**
 * Convex hull by monotone chain, dropping collinear points. The result winds
 * with positive cross products, which is clockwise on screen since SVG y
 * grows downward.
 */
export const convexHull = (points: readonly Vector2[]): Vector2[] => {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (sorted.length <= 2) {
    return sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y);
  }
  const build = (list: Vector2[]) => {
    const chain: Vector2[] = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
};

/** Distance from a point to a convex polygon (0 when inside or on it). */
export const distanceToHull = (point: Vector2, hull: readonly Vector2[]): number => {
  if (hull.length === 0) {
    return Infinity;
  }
  if (hull.length === 1) {
    return magnitude(subtract(point, hull[0]));
  }
  let inside = hull.length >= 3;
  let best = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    if (hull.length >= 3 && cross(p, q, point) < 0) {
      inside = false;
    }
    const edge = subtract(q, p);
    const lengthSq = edge.x * edge.x + edge.y * edge.y;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - p.x) * edge.x + (point.y - p.y) * edge.y) / lengthSq));
    best = Math.min(best, magnitude(subtract(point, add(p, scale(edge, t)))));
  }
  return inside ? 0 : best;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * SVG path for the dashed system boundary: the convex hull of the chosen
 * bubble centres, grown outward by `radius` with round corners. Returns an
 * empty string when nothing is selected.
 */
export const systemBoundaryPath = (
  scene: InteractionScene,
  systemIds: readonly string[],
  radius = BUBBLE_RADIUS + BOUNDARY_PAD,
): string => {
  const centres = scene.objects.filter((object) => systemIds.includes(object.id)).map((object) => object.position);
  const hull = convexHull(centres);
  const r = round(radius);

  if (hull.length === 0) {
    return '';
  }
  if (hull.length === 1) {
    const { x, y } = hull[0];
    return `M ${round(x - radius)} ${round(y)} A ${r} ${r} 0 1 1 ${round(x + radius)} ${round(y)} A ${r} ${r} 0 1 1 ${round(x - radius)} ${round(y)} Z`;
  }

  // Outward normal of each edge. With positive winding in y-down space the
  // outside of the polygon lies on the (dy, -dx) side of each edge.
  const normals = hull.map((p, i) => {
    const q = hull[(i + 1) % hull.length];
    const d = subtract(q, p);
    const length = magnitude(d);
    return { x: d.y / length, y: -d.x / length };
  });

  let path = '';
  hull.forEach((p, i) => {
    const q = hull[(i + 1) % hull.length];
    const n = normals[i];
    const next = normals[(i + 1) % hull.length];
    const start = add(p, scale(n, radius));
    const end = add(q, scale(n, radius));
    const arcEnd = add(q, scale(next, radius));
    path += `${i === 0 ? 'M' : 'L'} ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)} `;
    // The corner arc turns the same way the hull winds: positive angle, sweep 1.
    path += `A ${r} ${r} 0 0 1 ${round(arcEnd.x)} ${round(arcEnd.y)} `;
  });
  return `${path}Z`;
};
