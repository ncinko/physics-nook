// Game state reducer. All rule enforcement lives here + logic.js.

import { buildDeck, shuffle, CARDS_BY_ID } from "./cards.js";
import { createBoard } from "./hex.js";
import {
  FACILITY_COST,
  FACILITY_OUTPUT,
  FUNDRAISER_AMOUNT,
  LAND_COST,
  LAND_SURCHARGE_STEP,
  MAX_LAND_PER_TURN,
  MULTI_BUY_SEASON,
  UPGRADE_COST,
  calculateEndgameBonuses,
  calculateSeasonIncome,
  canUpgrade,
  determineWinners,
  isValidAttractionPlacement,
  isValidFacilityPlacement,
  isValidLandPurchase
} from "./logic.js";

export const PLAYER_COLORS = ["#e05252", "#4a7fd4", "#4caf50", "#d4a017"];
export const PLAYER_NAMES = ["Red", "Blue", "Green", "Gold"];

const MARKET_SIZE = 3;
const ACTIONS_PER_TURN = 2;
const DRAFT_DEAL = 5;
const DRAFT_KEEP = 2;

export function createInitialState(numPlayers) {
  let deck = buildDeck();
  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    players.push({
      id: i,
      name: `${PLAYER_NAMES[i]} (P${i + 1})`,
      color: PLAYER_COLORS[i],
      money: 12,
      wood: 2,
      steel: 2,
      reputation: 0,
      hand: [],
      attractions: []
    });
  }
  const market = deck.slice(0, MARKET_SIZE);
  deck = deck.slice(MARKET_SIZE);
  // Opening draft: each player picks DRAFT_KEEP of DRAFT_DEAL dealt cards.
  const draftCards = deck.slice(0, DRAFT_DEAL);
  deck = deck.slice(DRAFT_DEAL);
  return {
    phase: "draft", // draft | playing | drawChoice | gameOver
    season: 1,
    turnNumber: 1,
    turnsTakenThisSeason: 0,
    turnsPerPlayerPerSeason: 4,
    maxSeasons: 5,
    currentPlayerId: 0,
    players,
    hexes: createBoard(),
    attractions: [],
    deck,
    discard: [],
    market, // shared face-up cards everyone can see
    nextAttractionNum: 1,
    selectedAction: null, // null | buyLand | buildAttraction | upgrade | buildFacility | fundraiser | draw
    selectedCardId: null,
    selectedHexIds: [],
    actionsUsedThisTurn: [], // each turn is ACTIONS_PER_TURN unique actions
    landBoughtThisTurn: 0, // multi-buy counter (seasons 4+)
    drawnCards: null, // cardIds during drawChoice
    draftPlayerId: 0,
    draftCards,
    draftSelected: [],
    message: `Opening draft: ${players[0].name}, choose ${DRAFT_KEEP} of ${DRAFT_DEAL} cards to keep.`,
    log: [],
    lastIncomeReport: null,
    endgameReport: null,
    winners: null
  };
}

function hexesById(state) {
  return Object.fromEntries(state.hexes.map((h) => [h.id, h]));
}

function currentPlayer(state) {
  return state.players.find((p) => p.id === state.currentPlayerId);
}

function updatePlayer(state, playerId, updates) {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, ...updates } : p))
  };
}

function clearSelection(state) {
  return {
    ...state,
    selectedAction: null,
    selectedCardId: null,
    selectedHexIds: [],
    landBoughtThisTurn: 0,
    drawnCards: null
  };
}

function addLog(state, entry) {
  return { ...state, log: [...state.log.slice(-49), entry] };
}

// Draw n cards, reshuffling discard into deck if needed.
function drawFromDeck(state, n) {
  let deck = [...state.deck];
  let discard = [...state.discard];
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      deck = shuffle(discard);
      discard = [];
    }
    drawn.push(deck.shift());
  }
  return { drawn, deck, discard };
}

// Record a completed action; pass the turn once ACTIONS_PER_TURN are done.
function completeAction(state, actionKey) {
  const used = [...state.actionsUsedThisTurn, actionKey];
  if (used.length >= ACTIONS_PER_TURN) {
    return advanceTurn({ ...state, actionsUsedThisTurn: used });
  }
  const player = currentPlayer(state);
  return {
    ...clearSelection(state),
    actionsUsedThisTurn: used,
    message: `${player.name}: choose a different second action, or End Turn.`
  };
}

// Advance to next player; run seasonal income when the season is complete.
function advanceTurn(state) {
  let s = { ...clearSelection(state), actionsUsedThisTurn: [] };
  const numPlayers = s.players.length;
  const turnsTaken = s.turnsTakenThisSeason + 1;
  const seasonComplete = turnsTaken >= numPlayers * s.turnsPerPlayerPerSeason;

  if (!seasonComplete) {
    const nextPlayerId = (s.currentPlayerId + 1) % numPlayers;
    const turnNumber = Math.floor(turnsTaken / numPlayers) + 1;
    const next = s.players.find((p) => p.id === nextPlayerId);
    return {
      ...s,
      turnsTakenThisSeason: turnsTaken,
      turnNumber,
      currentPlayerId: nextPlayerId,
      message: `${next.name}'s turn — 2 different actions.`
    };
  }

  // Season income: adjacency-scored production plus facility output.
  const report = calculateSeasonIncome(s.players, s.attractions, s.hexes);
  const players = s.players.map((p) => {
    const r = report.find((x) => x.playerId === p.id);
    return {
      ...p,
      money: p.money + r.income,
      wood: p.wood + r.wood,
      steel: p.steel + r.steel,
      reputation: p.reputation + r.reputation
    };
  });

  s = addLog(
    { ...s, players, lastIncomeReport: { season: s.season, report } },
    `Season ${s.season} income: ` +
      report
        .map((r) => {
          const p = s.players.find((x) => x.id === r.playerId);
          let line = `${p.name} +$${r.income}, +${r.reputation}⭐`;
          if (r.wood > 0) line += `, +${r.wood}🪵`;
          if (r.steel > 0) line += `, +${r.steel}⚙`;
          return line;
        })
        .join(" · ")
  );

  if (s.season >= s.maxSeasons) {
    // Endgame majority bonuses (most land/shops/rides/coasters), then winners.
    const endgameReport = calculateEndgameBonuses(s.players, s.hexes, s.attractions);
    const bonusByPlayer = {};
    for (const cat of endgameReport) {
      for (const e of cat.entries) {
        bonusByPlayer[e.playerId] = (bonusByPlayer[e.playerId] || 0) + e.points;
      }
    }
    const finalPlayers = s.players.map((p) => ({
      ...p,
      reputation: p.reputation + (bonusByPlayer[p.id] || 0)
    }));
    s = addLog(
      { ...s, players: finalPlayers, endgameReport },
      "Endgame bonuses: " +
        finalPlayers.map((p) => `${p.name} +${bonusByPlayer[p.id] || 0}⭐`).join(", ")
    );
    const winners = determineWinners(s.players);
    return {
      ...s,
      phase: "gameOver",
      turnsTakenThisSeason: turnsTaken,
      winners: winners.map((w) => w.id),
      message:
        winners.length === 1
          ? `Game over! ${winners[0].name} wins with ${winners[0].reputation} reputation!`
          : `Game over! Shared victory: ${winners.map((w) => w.name).join(" & ")}.`
    };
  }

  // Refresh the communal draw pile: shuffle market + discard back into the
  // deck and deal a fresh market for the new season.
  const pool = shuffle([...s.deck, ...s.discard, ...s.market.filter(Boolean)]);
  const market = pool.slice(0, MARKET_SIZE);
  const deck = pool.slice(MARKET_SIZE);

  const season = s.season + 1;
  return {
    ...s,
    season,
    deck,
    discard: [],
    market,
    turnNumber: 1,
    turnsTakenThisSeason: 0,
    currentPlayerId: 0,
    message: `Season ${s.season} income collected. Season ${season} begins. ${s.players[0].name}'s turn — 2 different actions.`
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case "NEW_GAME":
      return createInitialState(action.numPlayers);

    case "SELECT_ACTION": {
      if (state.phase !== "playing") return state;
      if (state.selectedAction === "buyLand" && state.landBoughtThisTurn > 0) {
        return { ...state, message: "Finish your land purchases first (press Done)." };
      }
      if (state.actionsUsedThisTurn.includes(action.action)) {
        return { ...state, message: "Already used this turn — pick a different action." };
      }
      if (state.selectedAction === action.action) return clearSelection({ ...state, message: "" });
      const message =
        action.action === "buyLand" && state.season >= MULTI_BUY_SEASON
          ? `Buy Land: click hexes — up to ${MAX_LAND_PER_TURN} this turn, each extra tile costs +$${LAND_SURCHARGE_STEP} more.`
          : actionPrompt(action.action);
      return {
        ...clearSelection(state),
        selectedAction: action.action,
        message
      };
    }

    case "CANCEL": {
      // Mid multi-buy, purchases are final: cancelling completes the action.
      if (state.selectedAction === "buyLand" && state.landBoughtThisTurn > 0) {
        return completeAction({ ...state, message: "" }, "buyLand");
      }
      return { ...clearSelection(state), message: "Action cancelled." };
    }

    case "END_TURN": {
      if (state.phase !== "playing") return state;
      return advanceTurn({ ...state, message: "" });
    }

    case "FINISH_BUY_LAND": {
      if (state.phase !== "playing" || state.selectedAction !== "buyLand") return state;
      if (state.landBoughtThisTurn === 0) {
        return { ...clearSelection(state), message: "Action cancelled." };
      }
      return completeAction({ ...state, message: "" }, "buyLand");
    }

    case "CLICK_HEX": {
      if (state.phase !== "playing") return state;
      const player = currentPlayer(state);
      const byId = hexesById(state);

      // --- Buy Land ---
      if (state.selectedAction === "buyLand") {
        const surcharge = LAND_SURCHARGE_STEP * state.landBoughtThisTurn;
        const check = isValidLandPurchase(action.hexId, player, byId, surcharge);
        if (!check.ok) return { ...state, message: check.reason };
        const hex = byId[action.hexId];
        const cost = LAND_COST[hex.terrain] + surcharge;
        let s = updatePlayer(state, player.id, { money: player.money - cost });
        s = {
          ...s,
          hexes: s.hexes.map((h) => (h.id === action.hexId ? { ...h, owner: player.id } : h))
        };
        s = addLog(s, `${player.name} bought ${hex.terrain} at (${hex.id}) for $${cost}.`);

        // Seasons 4+: keep buying (escalating price) until Done or the cap.
        if (state.season >= MULTI_BUY_SEASON) {
          const bought = state.landBoughtThisTurn + 1;
          if (bought < MAX_LAND_PER_TURN) {
            return {
              ...s,
              landBoughtThisTurn: bought,
              message: `Bought for $${cost}. Buy another (next tile +$${LAND_SURCHARGE_STEP * bought} surcharge) or press Done.`
            };
          }
        }
        return completeAction({ ...s, message: "" }, "buyLand");
      }

      // --- Build Lumber Camp / Mine ---
      if (state.selectedAction === "buildFacility") {
        const check = isValidFacilityPlacement(action.hexId, player, byId);
        if (!check.ok) return { ...state, message: check.reason };
        const { type, resource, name } = check.facility;
        let s = updatePlayer(state, player.id, {
          money: player.money - FACILITY_COST,
          [resource]: player[resource] + FACILITY_OUTPUT
        });
        s = {
          ...s,
          hexes: s.hexes.map((h) => (h.id === action.hexId ? { ...h, facility: type } : h))
        };
        s = addLog(
          s,
          `${player.name} built a ${name} for $${FACILITY_COST} (+${FACILITY_OUTPUT} ${resource} now).`
        );
        return completeAction({ ...s, message: "" }, "buildFacility");
      }

      // --- Build Attraction: hex selection ---
      if (state.selectedAction === "buildAttraction" && state.selectedCardId) {
        const card = CARDS_BY_ID[state.selectedCardId];
        const hex = byId[action.hexId];
        if (!hex || hex.owner !== player.id) return { ...state, message: "You do not own this land." };
        if (hex.attractionId) return { ...state, message: "This hex is already occupied." };
        if (hex.terrain === "water" && !card.water) {
          return { ...state, message: "Only water rides can be built on water." };
        }
        let selected = state.selectedHexIds;
        if (selected.includes(action.hexId)) {
          selected = selected.filter((id) => id !== action.hexId);
        } else if (selected.length < card.footprint) {
          selected = [...selected, action.hexId];
        } else {
          return { ...state, message: `Select exactly ${card.footprint} hexes, then confirm.` };
        }
        return {
          ...state,
          selectedHexIds: selected,
          message: `${selected.length}/${card.footprint} hexes selected.`
        };
      }

      // --- Upgrade ---
      if (state.selectedAction === "upgrade") {
        const hex = byId[action.hexId];
        if (!hex?.attractionId) return { ...state, message: "Click one of your attractions." };
        const attr = state.attractions.find((a) => a.id === hex.attractionId);
        const check = canUpgrade(attr, player);
        if (!check.ok) return { ...state, message: check.reason };
        const card = CARDS_BY_ID[attr.cardId];
        let s = updatePlayer(state, player.id, {
          money: player.money - UPGRADE_COST.money,
          wood: player.wood - UPGRADE_COST.wood,
          steel: player.steel - UPGRADE_COST.steel
        });
        s = {
          ...s,
          attractions: s.attractions.map((a) =>
            a.id === attr.id ? { ...a, level: a.level + 1 } : a
          )
        };
        s = addLog(s, `${player.name} upgraded ${card.name} to level ${attr.level + 1}.`);
        return completeAction({ ...s, message: "" }, "upgrade");
      }

      return state;
    }

    // --- Build Attraction: card + confirm ---
    case "SELECT_CARD": {
      if (state.phase !== "playing" || state.selectedAction !== "buildAttraction") return state;
      const card = CARDS_BY_ID[action.cardId];
      return {
        ...state,
        selectedCardId: action.cardId,
        selectedHexIds: [],
        message: `Placing ${card.name}: select ${card.footprint} owned connected hex${card.footprint > 1 ? "es" : ""}.`
      };
    }

    case "CONFIRM_ATTRACTION": {
      if (state.phase !== "playing" || state.selectedAction !== "buildAttraction") return state;
      const player = currentPlayer(state);
      const card = CARDS_BY_ID[state.selectedCardId];
      if (!card) return { ...state, message: "Select a card first." };
      const byId = hexesById(state);
      const check = isValidAttractionPlacement(card, state.selectedHexIds, player, byId);
      if (!check.ok) return { ...state, message: check.reason };

      const cost = check.cost;
      const attrId = `attr-${String(state.nextAttractionNum).padStart(3, "0")}`;
      const attraction = {
        id: attrId,
        cardId: card.id,
        owner: player.id,
        hexes: [...state.selectedHexIds],
        level: 0
      };

      const hand = [...player.hand];
      hand.splice(hand.indexOf(card.id), 1);

      let s = updatePlayer(state, player.id, {
        money: player.money - cost.money,
        wood: player.wood - cost.wood,
        steel: player.steel - cost.steel,
        hand,
        attractions: [...player.attractions, attrId]
      });
      s = {
        ...s,
        attractions: [...s.attractions, attraction],
        nextAttractionNum: s.nextAttractionNum + 1,
        hexes: s.hexes.map((h) =>
          state.selectedHexIds.includes(h.id) ? { ...h, attractionId: attrId } : h
        )
      };
      s = addLog(
        s,
        `${player.name} built ${card.name}` +
          (cost.substituted > 0 ? ` (bought ${cost.substituted} missing material${cost.substituted > 1 ? "s" : ""})` : "") +
          "."
      );
      return completeAction({ ...s, message: "" }, "buildAttraction");
    }

    // --- Fundraiser ---
    case "FUNDRAISER": {
      if (state.phase !== "playing" || state.selectedAction !== "fundraiser") return state;
      const player = currentPlayer(state);
      let s = updatePlayer(state, player.id, { money: player.money + FUNDRAISER_AMOUNT });
      s = addLog(s, `${player.name} held a fundraiser (+$${FUNDRAISER_AMOUNT}).`);
      return completeAction({ ...s, message: "" }, "fundraiser");
    }

    // --- Draw Cards: take a face-up market card ---
    case "TAKE_MARKET": {
      if (state.phase !== "playing" || state.selectedAction !== "draw") return state;
      const player = currentPlayer(state);
      const cardId = state.market[action.index];
      if (!cardId) return { ...state, message: "That market slot is empty." };
      // Refill the taken slot from the top of the deck.
      const { drawn, deck, discard } = drawFromDeck(state, 1);
      const market = state.market.map((c, i) => (i === action.index ? drawn[0] ?? null : c));
      let s = updatePlayer({ ...state, deck, discard, market }, player.id, {
        hand: [...player.hand, cardId]
      });
      s = addLog(s, `${player.name} took ${CARDS_BY_ID[cardId].name} from the market.`);
      return completeAction({ ...s, message: "" }, "draw");
    }

    // --- Draw Cards: draw 3 from the deck, keep 1 ---
    case "START_DRAW": {
      if (state.phase !== "playing" || state.selectedAction !== "draw") return state;
      const { drawn, deck, discard } = drawFromDeck(state, 3);
      if (drawn.length === 0) return { ...state, message: "The deck is empty." };
      if (drawn.length === 1) {
        // Only one card available: keep it automatically.
        const player = currentPlayer(state);
        let s = updatePlayer({ ...state, deck, discard }, player.id, {
          hand: [...player.hand, drawn[0]]
        });
        s = addLog(s, `${player.name} drew ${CARDS_BY_ID[drawn[0]].name} (last card).`);
        return completeAction({ ...s, message: "" }, "draw");
      }
      return { ...state, phase: "drawChoice", deck, discard, drawnCards: drawn };
    }

    case "KEEP_CARD": {
      if (state.phase !== "drawChoice" || !state.drawnCards) return state;
      const player = currentPlayer(state);
      const kept = state.drawnCards[action.index];
      const others = state.drawnCards.filter((_, i) => i !== action.index);
      let s = updatePlayer(state, player.id, { hand: [...player.hand, kept] });
      s = { ...s, phase: "playing", discard: [...s.discard, ...others], drawnCards: null };
      s = addLog(s, `${player.name} kept ${CARDS_BY_ID[kept].name}.`);
      return completeAction({ ...s, message: "" }, "draw");
    }

    // --- Opening draft: keep 2 of 5 dealt cards ---
    case "TOGGLE_DRAFT_CARD": {
      if (state.phase !== "draft") return state;
      const i = action.index;
      let selected = state.draftSelected;
      if (selected.includes(i)) selected = selected.filter((x) => x !== i);
      else if (selected.length < DRAFT_KEEP) selected = [...selected, i];
      else return { ...state, message: `Keep exactly ${DRAFT_KEEP} — deselect one first.` };
      return { ...state, draftSelected: selected };
    }

    case "CONFIRM_DRAFT": {
      if (state.phase !== "draft" || state.draftSelected.length !== DRAFT_KEEP) return state;
      const player = state.players.find((p) => p.id === state.draftPlayerId);
      const kept = state.draftSelected.map((i) => state.draftCards[i]);
      const rejected = state.draftCards.filter((_, i) => !state.draftSelected.includes(i));
      let s = updatePlayer(state, player.id, { hand: kept });
      s = { ...s, discard: [...s.discard, ...rejected] };
      s = addLog(s, `${player.name} drafted ${kept.map((c) => CARDS_BY_ID[c].name).join(" & ")}.`);

      const nextId = state.draftPlayerId + 1;
      if (nextId < s.players.length) {
        const { drawn, deck, discard } = drawFromDeck(s, DRAFT_DEAL);
        return {
          ...s,
          deck,
          discard,
          draftPlayerId: nextId,
          draftCards: drawn,
          draftSelected: [],
          message: `Opening draft: ${s.players[nextId].name}, choose ${DRAFT_KEEP} of ${DRAFT_DEAL} cards to keep.`
        };
      }
      return {
        ...s,
        phase: "playing",
        draftPlayerId: null,
        draftCards: null,
        draftSelected: [],
        message: `Season 1 begins. ${s.players[0].name}'s turn — 2 different actions.`
      };
    }

    default:
      return state;
  }
}

function actionPrompt(action) {
  switch (action) {
    case "buyLand":
      return "Buy Land: click a highlighted hex. First purchase may be anywhere.";
    case "buildAttraction":
      return "Build Attraction: select a card from your hand.";
    case "upgrade":
      return `Upgrade: click one of your attractions (flat $${UPGRADE_COST.money}).`;
    case "buildFacility":
      return `Build Camp/Mine ($${FACILITY_COST}): click an owned empty forest (Lumber Camp) or hill (Mine).`;
    case "fundraiser":
      return `Fundraiser: confirm to gain $${FUNDRAISER_AMOUNT}.`;
    case "draw":
      return "Draw Cards: take a face-up market card, or draw 3 from the deck and keep 1.";
    default:
      return "";
  }
}
