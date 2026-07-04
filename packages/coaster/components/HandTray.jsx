import React from "react";
import { CARDS_BY_ID } from "../game/cards.js";
import { effectiveCost } from "../game/logic.js";
import Card from "./Card.jsx";

// Fanned hand of the current (hotseat) player, floating at the bottom center.
export default function HandTray({ state, dispatch }) {
  if (state.phase === "gameOver") return null;
  const player = state.players.find((p) => p.id === state.currentPlayerId);
  const hand = player.hand;
  const n = hand.length;
  const canSelect = state.phase === "playing" && state.selectedAction === "buildAttraction";
  const hexesByIdMap = Object.fromEntries(state.hexes.map((h) => [h.id, h]));

  return (
    <div className={"hand-tray" + (canSelect ? " selecting" : "")}>
      {hand.map((cardId, i) => {
        const card = CARDS_BY_ID[cardId];
        const mid = (n - 1) / 2;
        const rot = n > 1 ? (i - mid) * Math.min(6, 26 / n) : 0;
        const lift = Math.abs(i - mid) * Math.min(6, 30 / n);
        const isSel = canSelect && state.selectedCardId === cardId;
        const cost =
          isSel && state.selectedHexIds.length > 0
            ? effectiveCost(card, state.selectedHexIds, hexesByIdMap)
            : null;
        return (
          <div
            key={`${cardId}-${i}`}
            className="fan-slot"
            style={{ "--rot": `${rot}deg`, "--lift": `${lift}px`, zIndex: i }}
          >
            <Card
              card={card}
              cost={cost}
              selected={isSel}
              onClick={canSelect ? () => dispatch({ type: "SELECT_CARD", cardId }) : undefined}
            />
          </div>
        );
      })}
      {n === 0 && <div className="hand-empty">No cards in hand — try Draw Cards</div>}
    </div>
  );
}
