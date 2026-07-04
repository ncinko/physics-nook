// Tile-rendering constants and helpers for the Kenney hexagon tiles.
// The game grid stays in hex.js axial coordinates; this module only maps
// hexes onto the 120x140 pointy-top tile artwork.

import { HEX_SIZE } from "./hex.js";

// A Kenney tile PNG is 120x140 and its hex face fills the image exactly,
// so it maps 1:1 onto our hex bounding box (sqrt(3)*S wide, ~2*S tall).
export const TILE_W = Math.sqrt(3) * HEX_SIZE;
export const TILE_H = TILE_W * (140 / 120);

export const TERRAIN_TILES = {
  plain: "/assets/tiles/plain.png",
  forest: "/assets/tiles/forest.png",
  hill: "/assets/tiles/hill.png"
  // water is drawn as SVG (no CC0 water tile exists in the pack)
};

// Painter's algorithm: draw back rows first so tall art overlaps correctly.
export function sortForDepth(hexes) {
  return [...hexes].sort((a, b) => a.r - b.r || a.q - b.q);
}
