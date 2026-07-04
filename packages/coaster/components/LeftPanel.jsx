import React, { useMemo, useState } from "react";
import { CARDS_BY_ID } from "../game/cards.js";
import { calculateSeasonIncome } from "../game/logic.js";
import { CoinToken, StarToken, SteelToken, WoodToken } from "./sprites.jsx";

export default function LeftPanel({ state }) {
  const [logOpen, setLogOpen] = useState(false);

  // Projected end-of-season production (assuming nothing else changes).
  const projection = useMemo(
    () => calculateSeasonIncome(state.players, state.attractions, state.hexes),
    [state.players, state.attractions, state.hexes]
  );

  return (
    <div className="panel left-panel">
      <h2>Players</h2>
      {state.players.map((p) => {
        const proj = projection.find((r) => r.playerId === p.id);
        const isCurrent = p.id === state.currentPlayerId;
        return (
          <div
            key={p.id}
            className={"player-mat" + (isCurrent ? " active" : "")}
            style={{ "--pc": p.color }}
          >
            <div className="mat-ribbon">
              {p.name}
              {state.winners?.includes(p.id) && " 🏆"}
            </div>
            <div className="mat-tokens">
              <span className="token-chip"><CoinToken />{p.money}</span>
              <span className="token-chip"><WoodToken />{p.wood}</span>
              <span className="token-chip"><SteelToken />{p.steel}</span>
              <span className="token-chip rep"><StarToken />{p.reputation}</span>
            </div>
            {(p.attractions.length > 0 || proj.wood > 0 || proj.steel > 0) && (
              <div className="projection">
                Next season: +${proj.income} · +{proj.reputation}⭐
                {proj.wood > 0 && <> · +{proj.wood}🪵</>}
                {proj.steel > 0 && <> · +{proj.steel}⚙</>}
              </div>
            )}
            {p.attractions.length > 0 && (
              <>
                <div className="attr-list">
                  {p.attractions
                    .map((aid) => {
                      const attr = state.attractions.find((a) => a.id === aid);
                      const lvl = attr.level > 0 ? " " + "★".repeat(attr.level) : "";
                      return CARDS_BY_ID[attr.cardId].name + lvl;
                    })
                    .join(", ")}
                </div>
              </>
            )}
            <div className="mat-meta">🃏 {p.hand.length} cards · 🎪 {p.attractions.length} attractions</div>
          </div>
        );
      })}

      <button className="log-toggle" onClick={() => setLogOpen((o) => !o)}>
        {logOpen ? "▾ Hide log" : "▸ Show log"} ({state.log.length})
      </button>
      {logOpen && (
        <div className="log">
          {[...state.log].reverse().map((entry, i) => (
            <div key={state.log.length - i} className="log-entry">
              {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
