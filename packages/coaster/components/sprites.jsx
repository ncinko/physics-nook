import React from "react";

// ---------------------------------------------------------------------------
// Attraction sprites — small pseudo-3D illustrations in the Kenney flat style.
// Each is drawn in a local coordinate space anchored at (0,0) = ground center,
// extending upward (negative y). Shops reuse Kenney object PNGs (CC0).
// ---------------------------------------------------------------------------

const OUTLINE = "#3d3527";

function FerrisWheel() {
  const spokes = [];
  const pods = [];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k;
    const x = 16 * Math.cos(a);
    const y = -30 + 16 * Math.sin(a);
    spokes.push(<line key={`s${k}`} x1={0} y1={-30} x2={x} y2={y} stroke="#c94f4f" strokeWidth={1.6} />);
    pods.push(<circle key={`p${k}`} cx={x} cy={y} r={3.2} fill={["#f2b134", "#4a90d9", "#6fbf5a", "#e2739e"][k % 4]} stroke={OUTLINE} strokeWidth={0.8} />);
  }
  return (
    <g>
      <path d="M -10 0 L 0 -30 L 10 0" fill="none" stroke="#8a6d3b" strokeWidth={3.4} strokeLinecap="round" />
      <circle cx={0} cy={-30} r={16} fill="none" stroke="#c94f4f" strokeWidth={2.4} />
      {spokes}
      <circle cx={0} cy={-30} r={3.4} fill="#fff" stroke={OUTLINE} strokeWidth={1} />
      {pods}
      <ellipse cx={0} cy={1} rx={13} ry={3.4} fill="#00000022" />
    </g>
  );
}

function Carousel() {
  return (
    <g>
      <ellipse cx={0} cy={0} rx={15} ry={4.6} fill="#d9c9a3" stroke={OUTLINE} strokeWidth={1} />
      <rect x={-13.5} y={-14} width={27} height={13.4} rx={1.5} fill="#f3e6c8" stroke={OUTLINE} strokeWidth={1} />
      <line x1={-7} y1={-14} x2={-7} y2={-1.4} stroke="#c9b489" strokeWidth={1.4} />
      <line x1={7} y1={-14} x2={7} y2={-1.4} stroke="#c9b489" strokeWidth={1.4} />
      <path d="M -17 -14 Q 0 -34 17 -14 Z" fill="#e05252" stroke={OUTLINE} strokeWidth={1} />
      <path d="M -10.5 -19.5 Q 0 -32.5 10.5 -19.5 Q 0 -24 -10.5 -19.5 Z" fill="#f3e6c8" opacity={0.85} />
      <circle cx={0} cy={-31} r={2.2} fill="#f2b134" stroke={OUTLINE} strokeWidth={0.8} />
      <ellipse cx={0} cy={1.5} rx={15} ry={3.6} fill="#00000022" />
    </g>
  );
}

function Scrambler() {
  return (
    <g>
      <ellipse cx={0} cy={0} rx={14} ry={4.2} fill="#b9c4cc" stroke={OUTLINE} strokeWidth={1} />
      <line x1={0} y1={-2} x2={0} y2={-16} stroke="#5b6770" strokeWidth={3} strokeLinecap="round" />
      <line x1={0} y1={-14} x2={-12} y2={-7} stroke="#c94f4f" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={0} y1={-14} x2={12} y2={-7} stroke="#c94f4f" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={0} y1={-14} x2={0} y2={-24} stroke="#c94f4f" strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={-12} cy={-6} r={4} fill="#4a90d9" stroke={OUTLINE} strokeWidth={1} />
      <circle cx={12} cy={-6} r={4} fill="#6fbf5a" stroke={OUTLINE} strokeWidth={1} />
      <circle cx={0} cy={-25} r={4} fill="#f2b134" stroke={OUTLINE} strokeWidth={1} />
      <ellipse cx={0} cy={1.5} rx={14} ry={3.4} fill="#00000022" />
    </g>
  );
}

function WoodCoaster() {
  return (
    <g>
      {/* lattice supports */}
      <path d="M -22 0 L -14 -22 M -14 0 L -22 -18 M -18 0 L -18 -20" stroke="#8a6d3b" strokeWidth={1.6} />
      <path d="M 22 0 L 14 -22 M 14 0 L 22 -18 M 18 0 L 18 -20" stroke="#8a6d3b" strokeWidth={1.6} />
      <path d="M -2 0 L 4 -12 M 4 0 L -2 -12" stroke="#8a6d3b" strokeWidth={1.4} />
      {/* track */}
      <path d="M -24 -18 Q -12 -34 0 -12 Q 12 -34 24 -18" fill="none" stroke="#6b4f2a" strokeWidth={3.6} strokeLinecap="round" />
      <path d="M -24 -15 Q -12 -31 0 -9 Q 12 -31 24 -15" fill="none" stroke="#a07c48" strokeWidth={1.8} strokeLinecap="round" />
      {/* car */}
      <rect x={-8} y={-17} width={9} height={5.4} rx={2} fill="#e05252" stroke={OUTLINE} strokeWidth={1} transform="rotate(-28 -4 -14)" />
      <ellipse cx={0} cy={1.5} rx={22} ry={3.8} fill="#00000022" />
    </g>
  );
}

function SteelCoaster() {
  return (
    <g>
      <path d="M -20 0 L -20 -14 M 20 0 L 20 -14 M 0 0 L 0 -8" stroke="#5b6770" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M -24 -12 Q -10 -18 -4 -14" fill="none" stroke="#4a90d9" strokeWidth={3.2} strokeLinecap="round" />
      <circle cx={4} cy={-22} r={9.5} fill="none" stroke="#4a90d9" strokeWidth={3.2} />
      <path d="M 12 -14 Q 18 -12 24 -13" fill="none" stroke="#4a90d9" strokeWidth={3.2} strokeLinecap="round" />
      <rect x={-13} y={-17.4} width={9} height={5} rx={2} fill="#f2b134" stroke={OUTLINE} strokeWidth={1} />
      <ellipse cx={0} cy={1.5} rx={21} ry={3.8} fill="#00000022" />
    </g>
  );
}

function SplashBoats() {
  return (
    <g>
      <ellipse cx={0} cy={-3} rx={16} ry={5.4} fill="#5db3e8" stroke="#3d7dab" strokeWidth={1} />
      <path d="M -10 -6 Q -6 -9 -2 -6 M 2 -5 Q 6 -8 10 -5" fill="none" stroke="#cfeaf8" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M -9 -8 Q 0 -16 9 -8 L 6 -6 L -6 -6 Z" fill="#e05252" stroke={OUTLINE} strokeWidth={1} />
      <rect x={-3.6} y={-15.4} width={7.2} height={5} rx={1.6} fill="#f3e6c8" stroke={OUTLINE} strokeWidth={0.9} />
      <path d="M -14 -9 L -11 -13 M 14 -9 L 11 -13" stroke="#cfeaf8" strokeWidth={1.6} strokeLinecap="round" />
      <ellipse cx={0} cy={1.5} rx={16} ry={3.4} fill="#00000022" />
    </g>
  );
}

function ShopPng({ href }) {
  // Kenney object PNG anchored to sit on the tile.
  return <image href={href} x={-19} y={-36} width={38} height={38} preserveAspectRatio="xMidYMax meet" />;
}

const SPRITES = {
  "ferris-wheel": FerrisWheel,
  carousel: Carousel,
  scrambler: Scrambler,
  "american-eagle": WoodCoaster,
  "wooden-mouse": WoodCoaster,
  "top-thrill-dragster": SteelCoaster,
  "splash-boats": SplashBoats
};

export function AttractionSprite({ card, scale = 1 }) {
  const Sprite = SPRITES[card.id];
  return (
    <g transform={scale === 1 ? undefined : `scale(${scale})`}>
      {Sprite ? (
        <Sprite />
      ) : card.id === "food-stall" ? (
        <ShopPng href="/assets/objects/store.png" />
      ) : (
        <ShopPng href="/assets/objects/shop.png" />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Production facilities — developed land that yields resources each season.
// ---------------------------------------------------------------------------

function LumberCamp() {
  return (
    <g>
      {/* saw hut */}
      <rect x={-14} y={-13} width={15} height={12} rx={1.2} fill="#c9a36a" stroke={OUTLINE} strokeWidth={1} />
      <path d="M -16 -13 L -6.5 -21 L 3 -13 Z" fill="#8a4f3d" stroke={OUTLINE} strokeWidth={1} />
      <rect x={-9.5} y={-8} width={5} height={7} fill="#6b4f2a" stroke={OUTLINE} strokeWidth={0.8} />
      {/* log pile */}
      <circle cx={8} cy={-3.2} r={3.2} fill="#a07c48" stroke={OUTLINE} strokeWidth={0.9} />
      <circle cx={14} cy={-3.2} r={3.2} fill="#a07c48" stroke={OUTLINE} strokeWidth={0.9} />
      <circle cx={11} cy={-8.2} r={3.2} fill="#c9a36a" stroke={OUTLINE} strokeWidth={0.9} />
      <circle cx={8} cy={-3.2} r={1.4} fill="#d9c9a3" />
      <circle cx={14} cy={-3.2} r={1.4} fill="#d9c9a3" />
      <circle cx={11} cy={-8.2} r={1.4} fill="#e8dcc0" />
      {/* axe against the hut */}
      <line x1={1} y1={-1} x2={6} y2={-12} stroke="#8a6d3b" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M 4.5 -13.5 Q 9 -13 8.5 -9 Q 6.5 -11 4.5 -10.5 Z" fill="#b9c4cc" stroke={OUTLINE} strokeWidth={0.8} />
      <ellipse cx={0} cy={1.5} rx={17} ry={3.6} fill="#00000022" />
    </g>
  );
}

function Mine() {
  return (
    <g>
      {/* rocky mound */}
      <path d="M -16 0 Q -12 -16 0 -18 Q 12 -16 16 0 Z" fill="#8f9ba3" stroke={OUTLINE} strokeWidth={1} />
      <path d="M -9 -12 L -5 -15 M 6 -14 L 10 -10" stroke="#dbe3e8" strokeWidth={1.4} strokeLinecap="round" />
      {/* timber-framed entrance */}
      <path d="M -7 0 L -7 -9 L 0 -12 L 7 -9 L 7 0 Z" fill="#6b4f2a" stroke={OUTLINE} strokeWidth={1} />
      <path d="M -4.5 0 L -4.5 -7 Q 0 -9.5 4.5 -7 L 4.5 0 Z" fill="#2e2a22" />
      {/* rails + cart */}
      <line x1={-1.5} y1={0} x2={-3} y2={5} stroke="#5b6770" strokeWidth={1.2} />
      <line x1={1.5} y1={0} x2={3} y2={5} stroke="#5b6770" strokeWidth={1.2} />
      <rect x={8} y={-5.5} width={8} height={5} rx={1} fill="#5b6770" stroke={OUTLINE} strokeWidth={0.9} />
      <circle cx={10} cy={-0.2} r={1.4} fill="#3d3527" />
      <circle cx={14} cy={-0.2} r={1.4} fill="#3d3527" />
      <circle cx={10.5} cy={-6} r={1.6} fill="#b9c4cc" stroke={OUTLINE} strokeWidth={0.7} />
      <circle cx={13.5} cy={-6.4} r={1.6} fill="#dbe3e8" stroke={OUTLINE} strokeWidth={0.7} />
      <ellipse cx={0} cy={1.5} rx={17} ry={3.6} fill="#00000022" />
    </g>
  );
}

const FACILITY_SPRITES = { lumberCamp: LumberCamp, mine: Mine };

export function FacilitySprite({ type, scale = 1 }) {
  const Sprite = FACILITY_SPRITES[type];
  if (!Sprite) return null;
  return (
    <g transform={scale === 1 ? undefined : `scale(${scale})`}>
      <Sprite />
    </g>
  );
}

// Flat water tile drawn in the Kenney palette (the pack has no water hex).
export function WaterTile({ points }) {
  return (
    <g>
      <polygon points={points} fill="#4fa4d8" stroke="#3d84b0" strokeWidth={2} />
      <polygon points={points} fill="#63b4e4" opacity={0.5} transform="scale(0.94)" style={{ transformOrigin: "0 0", transformBox: "fill-box" }} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Resource token icons (used in mats, cards, buttons). Sized via `size` px.
// ---------------------------------------------------------------------------

export function CoinToken({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="token-icon">
      <circle cx={10} cy={10} r={9} fill="#f2b134" stroke="#b07d1a" strokeWidth={1.6} />
      <circle cx={10} cy={10} r={6} fill="none" stroke="#d99a24" strokeWidth={1.2} />
      <text x={10} y={14} textAnchor="middle" fontSize={10} fontWeight={800} fill="#7a5510">$</text>
    </svg>
  );
}

export function WoodToken({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="token-icon">
      <circle cx={10} cy={10} r={9} fill="#a07c48" stroke="#6b4f2a" strokeWidth={1.6} />
      <circle cx={10} cy={10} r={5.5} fill="#c9a36a" />
      <circle cx={10} cy={10} r={3} fill="none" stroke="#8a6d3b" strokeWidth={1} />
      <circle cx={10} cy={10} r={1.1} fill="#8a6d3b" />
    </svg>
  );
}

export function SteelToken({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="token-icon">
      <circle cx={10} cy={10} r={9} fill="#b9c4cc" stroke="#5b6770" strokeWidth={1.6} />
      <path d="M 5 12.5 L 7 7.5 L 13 7.5 L 15 12.5 Z" fill="#8f9ba3" stroke="#5b6770" strokeWidth={1} />
      <path d="M 7 7.5 L 13 7.5 L 12 9 L 8 9 Z" fill="#dbe3e8" />
    </svg>
  );
}

export function StarToken({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="token-icon">
      <path
        d="M10 1.5 L12.6 7.1 L18.7 7.8 L14.2 12 L15.4 18 L10 15 L4.6 18 L5.8 12 L1.3 7.8 L7.4 7.1 Z"
        fill="#f2b134"
        stroke="#b07d1a"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
