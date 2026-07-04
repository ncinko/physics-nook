// Axial hex grid helpers (pointy-top) and SVG geometry.

export const BOARD_RADIUS = 3;
export const HEX_SIZE = 42;

const DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
];

export function hexId(q, r) {
  return `${q},${r}`;
}

export function parseHexId(id) {
  const [q, r] = id.split(",").map(Number);
  return { q, r };
}

export function neighborIds(id) {
  const { q, r } = parseHexId(id);
  return DIRECTIONS.map(([dq, dr]) => hexId(q + dq, r + dr));
}

// Deterministic-ish terrain layout: mostly plain with scattered forest/hill/water.
// Scenery (forest/hill/water) matters for adjacency scoring, so it is spread out.
const TERRAIN_LAYOUT = {
  "-1,-1": "forest",
  "-2,0": "forest",
  "2,-3": "forest",
  "-3,3": "forest",
  "1,1": "forest",
  "2,0": "hill",
  "-1,2": "hill",
  "0,-2": "hill",
  "-3,1": "hill",
  "3,-1": "water",
  "-2,3": "water",
  "1,-3": "water",
  "0,0": "water"
};

export function createBoard() {
  const hexes = [];
  const R = BOARD_RADIUS;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const s = -q - r;
      if (Math.abs(s) > R) continue;
      const id = hexId(q, r);
      hexes.push({
        id,
        q,
        r,
        terrain: TERRAIN_LAYOUT[id] || "plain",
        owner: null,
        attractionId: null,
        facility: null
      });
    }
  }
  return hexes;
}

// --- SVG geometry (pointy-top) ---

export function hexCenter(q, r) {
  const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
  const y = HEX_SIZE * 1.5 * r;
  return { x, y };
}

export function hexCorners(q, r) {
  const { x, y } = hexCenter(q, r);
  const corners = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    corners.push({ x: x + HEX_SIZE * Math.cos(angle), y: y + HEX_SIZE * Math.sin(angle) });
  }
  return corners;
}

export function hexPolygonPoints(q, r) {
  return hexCorners(q, r)
    .map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
}
