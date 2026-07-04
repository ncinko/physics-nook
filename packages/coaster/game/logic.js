// Pure game-logic helpers, kept separate from React components.

import { CARDS_BY_ID } from "./cards.js";
import { neighborIds } from "./hex.js";

export const LAND_COST = {
  plain: 2,
  forest: 3,
  hill: 3,
  water: 2
};

// --- Engine tuning dials ---
export const UPGRADE_COST = { money: 5, wood: 0, steel: 0 }; // flat money cost
export const MATERIAL_SUBSTITUTE_COST = 3; // $ per missing wood/steel when building
export const MULTI_BUY_SEASON = 4; // from this season, multiple land buys per turn
export const MAX_LAND_PER_TURN = 3;
export const LAND_SURCHARGE_STEP = 2; // each extra tile this turn costs +$2 more
export const UPGRADE_INCOME_BONUS = 2; // $ per level per season
export const UPGRADE_REP_BONUS = 1; // rep per level per season
export const MAX_UPGRADES = 2;
export const SHOP_ADJACENCY_INCOME = 1; // $ per adjacent ride/coaster
export const SCENERY_ADJACENCY_REP = 1; // rep per adjacent unbuilt scenery hex
export const VARIETY_ADJACENCY_REP = 1; // rep per adjacent different-type attraction
export const FACILITY_COST = 5; // $ to place a lumber camp or mine
export const FACILITY_OUTPUT = 2; // resources per season (and on placement)
export const FACILITY_INCOME = 1; // $ per facility per season
export const FUNDRAISER_AMOUNT = 3; // $ gained from the Fundraiser action

// Production facilities: developed land that yields resources instead of rep.
export const FACILITY_DEFS = {
  lumberCamp: { terrain: "forest", resource: "wood", name: "Lumber Camp" },
  mine: { terrain: "hill", resource: "steel", name: "Mine" }
};
export const FACILITY_BY_TERRAIN = Object.fromEntries(
  Object.entries(FACILITY_DEFS).map(([type, def]) => [def.terrain, { type, ...def }])
);

export const SCENERY_TERRAINS = new Set(["forest", "hill", "water"]);

// --- Validation ---

export function isValidLandPurchase(hexId, player, hexesById, surcharge = 0) {
  const hex = hexesById[hexId];
  if (!hex) return { ok: false, reason: "Invalid hex." };
  if (hex.owner !== null) return { ok: false, reason: "This land is already owned." };
  if (player.money < LAND_COST[hex.terrain] + surcharge) return { ok: false, reason: "Not enough money." };

  const ownsAny = Object.values(hexesById).some((h) => h.owner === player.id);
  if (ownsAny) {
    const adjacent = neighborIds(hexId).some(
      (n) => hexesById[n] && hexesById[n].owner === player.id
    );
    if (!adjacent) return { ok: false, reason: "Must be adjacent to land you own." };
  }
  // First purchase may be anywhere.
  return { ok: true };
}

export function validLandPurchaseIds(player, hexesById, surcharge = 0) {
  return Object.keys(hexesById).filter(
    (id) => isValidLandPurchase(id, player, hexesById, surcharge).ok
  );
}

// A facility goes on an owned, empty forest (lumber camp) or hill (mine) hex.
export function isValidFacilityPlacement(hexId, player, hexesById) {
  const hex = hexesById[hexId];
  if (!hex) return { ok: false, reason: "Invalid hex." };
  const facility = FACILITY_BY_TERRAIN[hex.terrain];
  if (!facility) return { ok: false, reason: "Camps go on forest, mines on hills." };
  if (hex.owner !== player.id) return { ok: false, reason: "You do not own this land." };
  if (hex.attractionId) return { ok: false, reason: "This hex is already occupied." };
  if (hex.facility) return { ok: false, reason: "This hex already has a facility." };
  if (player.money < FACILITY_COST) return { ok: false, reason: "Not enough money." };
  return { ok: true, facility };
}

export function validFacilityHexIds(player, hexesById) {
  return Object.keys(hexesById).filter(
    (id) => isValidFacilityPlacement(id, player, hexesById).ok
  );
}

export function areHexesConnected(hexIds) {
  if (hexIds.length <= 1) return hexIds.length === 1;
  const set = new Set(hexIds);
  const visited = new Set([hexIds[0]]);
  const queue = [hexIds[0]];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighborIds(cur)) {
      if (set.has(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited.size === set.size;
}

// Effective cost after terrain discounts (forest reduces wood cost for wooden coasters).
export function effectiveCost(card, hexIds, hexesById) {
  const cost = { ...card.cost };
  if (card.type === "coaster" && card.subtype === "wood" && cost.wood > 0) {
    if (hexIds.some((id) => hexesById[id]?.terrain === "forest")) {
      cost.wood = Math.max(0, cost.wood - 1);
    }
  }
  return cost;
}

export function isValidAttractionPlacement(card, hexIds, player, hexesById) {
  if (hexIds.length !== card.footprint) {
    return { ok: false, reason: `Select exactly ${card.footprint} hex${card.footprint > 1 ? "es" : ""}.` };
  }
  for (const id of hexIds) {
    const hex = hexesById[id];
    if (!hex) return { ok: false, reason: "Invalid hex." };
    if (hex.owner !== player.id) return { ok: false, reason: "You do not own this land." };
    if (hex.attractionId || hex.facility) return { ok: false, reason: "This hex is already occupied." };
    if (hex.terrain === "water" && !card.water) {
      return { ok: false, reason: "Only water rides can be built on water." };
    }
  }
  if (!areHexesConnected(hexIds)) {
    return { ok: false, reason: "Selected hexes must be connected." };
  }
  // Missing materials may be substituted with money ($3 per unit).
  const cost = effectiveCost(card, hexIds, hexesById);
  const woodShort = Math.max(0, cost.wood - player.wood);
  const steelShort = Math.max(0, cost.steel - player.steel);
  const substituted = woodShort + steelShort;
  const moneyTotal = cost.money + substituted * MATERIAL_SUBSTITUTE_COST;
  if (player.money < moneyTotal) {
    return {
      ok: false,
      reason:
        substituted > 0
          ? `Not enough money (missing materials cost $${MATERIAL_SUBSTITUTE_COST} each).`
          : "Not enough money."
    };
  }
  return {
    ok: true,
    cost: {
      money: moneyTotal,
      wood: cost.wood - woodShort,
      steel: cost.steel - steelShort,
      substituted
    }
  };
}

// Hexes a player could include in an attraction placement (owned, empty, buildable).
// Water tiles are only buildable when placing a water ride.
export function buildableHexIds(player, hexesById, card) {
  return Object.values(hexesById)
    .filter(
      (h) =>
        h.owner === player.id &&
        !h.attractionId &&
        !h.facility &&
        (h.terrain !== "water" || card?.water)
    )
    .map((h) => h.id);
}

export function canUpgrade(attraction, player) {
  if (attraction.owner !== player.id) return { ok: false, reason: "Not your attraction." };
  if (attraction.level >= MAX_UPGRADES) return { ok: false, reason: "Already fully upgraded." };
  if (player.money < UPGRADE_COST.money) return { ok: false, reason: "Not enough money." };
  if (player.wood < UPGRADE_COST.wood) return { ok: false, reason: "Not enough wood." };
  if (player.steel < UPGRADE_COST.steel) return { ok: false, reason: "Not enough steel." };
  return { ok: true };
}

// --- Adjacency scoring (the engine) ---

// All hexes adjacent to an attraction's footprint, excluding its own hexes.
function attractionNeighborHexIds(attr, hexesById) {
  const own = new Set(attr.hexes);
  const out = new Set();
  for (const h of attr.hexes) {
    for (const n of neighborIds(h)) {
      if (hexesById[n] && !own.has(n)) out.add(n);
    }
  }
  return out;
}

// Seasonal production for one attraction, including level and adjacency bonuses.
export function scoreAttraction(attr, hexesById, attractionsById) {
  const card = CARDS_BY_ID[attr.cardId];
  let income = card.income + attr.level * UPGRADE_INCOME_BONUS;
  let reputation = card.reputation + attr.level * UPGRADE_REP_BONUS;
  const bonuses = [];

  const adjacentAttractionIds = new Set();
  let sceneryCount = 0;
  for (const n of attractionNeighborHexIds(attr, hexesById)) {
    const hex = hexesById[n];
    if (hex.attractionId) adjacentAttractionIds.add(hex.attractionId);
    else if (hex.facility) continue; // developed land — no scenery bonus
    else if (SCENERY_TERRAINS.has(hex.terrain)) sceneryCount++;
  }

  if (card.type === "shop") {
    // Shops feed off foot traffic: +$ per adjacent ride/coaster (any owner).
    let rides = 0;
    for (const aid of adjacentAttractionIds) {
      const otherCard = CARDS_BY_ID[attractionsById[aid].cardId];
      if (otherCard.type === "ride" || otherCard.type === "coaster") rides++;
    }
    if (rides > 0) {
      income += rides * SHOP_ADJACENCY_INCOME;
      bonuses.push(`+$${rides * SHOP_ADJACENCY_INCOME} foot traffic`);
    }
  } else {
    // Rides/coasters: rep from unbuilt scenery and from attraction variety.
    if (sceneryCount > 0) {
      reputation += sceneryCount * SCENERY_ADJACENCY_REP;
      bonuses.push(`+${sceneryCount * SCENERY_ADJACENCY_REP}⭐ scenery`);
    }
    // Variety: adjacent rides/coasters of a different SUBTYPE (wood, steel,
    // family, thrill, water). Shops never grant reputation to neighbors.
    let variety = 0;
    for (const aid of adjacentAttractionIds) {
      const otherCard = CARDS_BY_ID[attractionsById[aid].cardId];
      if (otherCard.type !== "shop" && otherCard.subtype !== card.subtype) variety++;
    }
    if (variety > 0) {
      reputation += variety * VARIETY_ADJACENCY_REP;
      bonuses.push(`+${variety * VARIETY_ADJACENCY_REP}⭐ variety`);
    }
  }

  return { income, reputation, bonuses };
}

// --- Seasonal income ---

// For each player: every built attraction produces its adjacency-scored income
// and reputation, and every facility produces resources + $. (No upkeep —
// attractions always earn.)
export function calculateSeasonIncome(players, attractions, hexes) {
  const hexesById = Object.fromEntries(hexes.map((h) => [h.id, h]));
  const attractionsById = Object.fromEntries(attractions.map((a) => [a.id, a]));

  return players.map((player) => {
    const mine = attractions.filter((a) => a.owner === player.id);
    let income = 0;
    let reputation = 0;
    let wood = 0;
    let steel = 0;
    const details = [];

    for (const attr of mine) {
      const s = scoreAttraction(attr, hexesById, attractionsById);
      income += s.income;
      reputation += s.reputation;
      details.push({ attractionId: attr.id, ...s });
    }

    for (const hex of hexes) {
      if (hex.owner !== player.id || !hex.facility) continue;
      income += FACILITY_INCOME;
      if (FACILITY_DEFS[hex.facility].resource === "wood") wood += FACILITY_OUTPUT;
      else steel += FACILITY_OUTPUT;
    }

    return { playerId: player.id, income, reputation, wood, steel, details };
  });
}

// --- Endgame majority bonuses ---
// Most land / shops / rides / coasters. Award values depend on player count;
// 3p also rewards 2nd place, 4p rewards 2nd and 3rd. Tied players share the
// combined award of the places they span, rounded down. A count of 0 never scores.
export const ENDGAME_AWARDS = { 2: [3], 3: [4, 2], 4: [5, 3, 1] };
export const ENDGAME_CATEGORIES = [
  { key: "land", label: "Most Land" },
  { key: "shop", label: "Most Shops" },
  { key: "ride", label: "Most Rides" },
  { key: "coaster", label: "Most Coasters" }
];

export function calculateEndgameBonuses(players, hexes, attractions) {
  const awards = ENDGAME_AWARDS[players.length] || ENDGAME_AWARDS[4];
  const countFor = (p, key) =>
    key === "land"
      ? hexes.filter((h) => h.owner === p.id).length
      : attractions.filter((a) => a.owner === p.id && CARDS_BY_ID[a.cardId].type === key).length;

  return ENDGAME_CATEGORIES.map(({ key, label }) => {
    const entries = players
      .map((p) => ({ playerId: p.id, count: countFor(p, key), points: 0 }))
      .sort((a, b) => b.count - a.count);
    let place = 0;
    let i = 0;
    while (i < entries.length && place < awards.length) {
      const tied = entries.filter((e) => e.count === entries[i].count);
      if (entries[i].count > 0) {
        const pool = awards
          .slice(place, place + tied.length)
          .reduce((sum, v) => sum + v, 0);
        const each = Math.floor(pool / tied.length);
        for (const e of tied) e.points = each;
      }
      i += tied.length;
      place += tied.length;
    }
    return { key, label, entries };
  });
}

export function determineWinners(players) {
  let pool = [...players];
  const best = (arr, key) => Math.max(...arr.map(key));
  const filt = (arr, key) => arr.filter((p) => key(p) === best(arr, key));
  pool = filt(pool, (p) => p.reputation);
  if (pool.length > 1) pool = filt(pool, (p) => p.money);
  if (pool.length > 1) pool = filt(pool, (p) => p.attractions.length);
  return pool;
}
