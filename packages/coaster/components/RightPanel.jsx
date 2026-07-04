import React from "react";
import { CARDS_BY_ID } from "../game/cards.js";
import {
  FACILITY_COST,
  FACILITY_INCOME,
  FACILITY_OUTPUT,
  FUNDRAISER_AMOUNT,
  MULTI_BUY_SEASON,
  MAX_LAND_PER_TURN,
  LAND_SURCHARGE_STEP,
  isValidAttractionPlacement
} from "../game/logic.js";
import Card from "./Card.jsx";
import { CoinToken } from "./sprites.jsx";

export default function RightPanel({ state, dispatch }) {
  const act = state.selectedAction;
  const player = state.players.find((p) => p.id === state.currentPlayerId);

  if (state.phase === "gameOver") {
    return (
      <div className="panel right-panel">
        <h2>Game Over</h2>
        <div className="message game-over">{state.message}</div>
        <h2>Final Standings</h2>
        {[...state.players]
          .sort((a, b) => b.reputation - a.reputation || b.money - a.money)
          .map((p, i) => (
            <div key={p.id} className="standing">
              <strong style={{ color: p.color }}>
                {i + 1}. {p.name}
              </strong>{" "}
              ⭐{p.reputation} · 💰{p.money} · 🎪{p.attractions.length}
            </div>
          ))}
        {state.endgameReport && (
          <>
            <h2>Endgame Bonuses</h2>
            {state.endgameReport.map((cat) => {
              const scorers = cat.entries.filter((e) => e.points > 0);
              return (
                <div key={cat.key} className="standing bonus-row">
                  <strong>{cat.label}:</strong>{" "}
                  {scorers.length === 0
                    ? "—"
                    : scorers.map((e, i) => {
                        const p = state.players.find((x) => x.id === e.playerId);
                        return (
                          <span key={e.playerId}>
                            {i > 0 && ", "}
                            <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span>{" "}
                            +{e.points}⭐ ({e.count})
                          </span>
                        );
                      })}
                </div>
              );
            })}
          </>
        )}
        <button
          className="btn primary"
          onClick={() => dispatch({ type: "NEW_GAME", numPlayers: state.players.length })}
        >
          Play Again
        </button>
      </div>
    );
  }

  return (
    <div className="panel right-panel">
      <h2>Actions</h2>
      {state.phase === "playing" && (
        <div className="turn-status">
          Action {Math.min(state.actionsUsedThisTurn.length + 1, 2)} of 2
          <button className="btn small" onClick={() => dispatch({ type: "END_TURN" })}>
            End Turn
          </button>
        </div>
      )}
      {state.message && <div className="message">{state.message}</div>}

      <div className="actions">
        {[
          ["buyLand", "Buy Land"],
          ["buildAttraction", "Build Attraction"],
          ["upgrade", "Upgrade Attraction"],
          ["buildFacility", "Build Camp/Mine"],
          ["fundraiser", "Fundraiser"],
          ["draw", "Draw Cards"]
        ].map(([key, label]) => (
          <button
            key={key}
            className={"btn action-btn" + (act === key ? " active" : "")}
            disabled={state.phase !== "playing" || state.actionsUsedThisTurn.includes(key)}
            onClick={() => dispatch({ type: "SELECT_ACTION", action: key })}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Multi-buy Done button (seasons 4+) */}
      {act === "buyLand" && state.season >= MULTI_BUY_SEASON && (
        <div className="sub-panel">
          <div>
            Tiles bought this turn: {state.landBoughtThisTurn}/{MAX_LAND_PER_TURN}
            {state.landBoughtThisTurn > 0 &&
              state.landBoughtThisTurn < MAX_LAND_PER_TURN &&
              ` — next tile +$${LAND_SURCHARGE_STEP * state.landBoughtThisTurn}`}
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => dispatch({ type: "FINISH_BUY_LAND" })}>
              {state.landBoughtThisTurn > 0 ? "Done" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {/* Upgrade hint */}
      {act === "upgrade" && (
        <div className="sub-panel">
          <div>Flat $5. Each level: +$2 income and +1⭐ per season. Max 2 levels.</div>
          <div className="btn-row">
            <button className="btn" onClick={() => dispatch({ type: "CANCEL" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Build Camp/Mine hint */}
      {act === "buildFacility" && (
        <div className="sub-panel">
          <div>
            ${FACILITY_COST} — click an owned empty forest (Lumber Camp 🌲) or hill (Mine ⛰).
            Gain {FACILITY_OUTPUT} of its resource now, then {FACILITY_OUTPUT} + ${FACILITY_INCOME} each
            season. Counts as developed land: adjacent rides lose that hex's scenery ⭐.
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => dispatch({ type: "CANCEL" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fundraiser confirm */}
      {act === "fundraiser" && (
        <div className="sub-panel">
          <div className="btn-row">
            <button className="btn token-btn primary" onClick={() => dispatch({ type: "FUNDRAISER" })}>
              <CoinToken /> Hold a fundraiser: gain ${FUNDRAISER_AMOUNT}
            </button>
            <button className="btn" onClick={() => dispatch({ type: "CANCEL" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Draw */}
      {act === "draw" && state.phase === "playing" && (
        <div className="sub-panel">
          <div>
            <strong>Take a market card below</strong>, or draw blind from the deck.
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => dispatch({ type: "START_DRAW" })}>
              Draw 3, keep 1
            </button>
            <button className="btn" onClick={() => dispatch({ type: "CANCEL" })}>
              Cancel
            </button>
          </div>
          <div className="deck-count">{state.deck.length} cards left in deck</div>
        </div>
      )}

      {/* Attraction placement confirm */}
      {act === "buildAttraction" && state.selectedCardId && (
        <div className="sub-panel">
          <div>
            {state.selectedHexIds.length}/{CARDS_BY_ID[state.selectedCardId].footprint} hexes selected
          </div>
          {(() => {
            const card = CARDS_BY_ID[state.selectedCardId];
            if (state.selectedHexIds.length !== card.footprint) return null;
            const byId = Object.fromEntries(state.hexes.map((h) => [h.id, h]));
            const check = isValidAttractionPlacement(card, state.selectedHexIds, player, byId);
            if (check.ok && check.cost.substituted > 0) {
              return (
                <div className="substitute-note">
                  Buying {check.cost.substituted} missing material
                  {check.cost.substituted > 1 ? "s" : ""} for $
                  {check.cost.substituted * 3} — total ${check.cost.money}
                </div>
              );
            }
            return null;
          })()}
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={state.selectedHexIds.length !== CARDS_BY_ID[state.selectedCardId].footprint}
              onClick={() => dispatch({ type: "CONFIRM_ATTRACTION" })}
            >
              Confirm Build
            </button>
            <button className="btn" onClick={() => dispatch({ type: "CANCEL" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2>Card Market</h2>
      <div className="market">
        {state.market.filter(Boolean).length === 0 && (
          <div className="hand-empty">Market empty — deck exhausted.</div>
        )}
        {state.market.map((cardId, i) =>
          cardId ? (
            <Card
              key={`mkt-${i}`}
              card={CARDS_BY_ID[cardId]}
              size="mini"
              onClick={
                act === "draw" && state.phase === "playing"
                  ? () => dispatch({ type: "TAKE_MARKET", index: i })
                  : undefined
              }
            />
          ) : null
        )}
      </div>

      <details className="rules-details">
        <summary>⭐ Reputation</summary>
        <div className="rules-box">
          <div>Each attraction earns its card's ⭐/season (+1 per upgrade level).</div>
          <div>Rides &amp; coasters: +1⭐/season per adjacent unbuilt scenery (🌲⛰💧).</div>
          <div>Rides &amp; coasters: +1⭐/season per adjacent ride/coaster of a <em>different subtype</em> (wood, steel, family, thrill, water). Shops don't count.</div>
          <div>
            Endgame: Most Land / Shops / Rides / Coasters —{" "}
            {state.players.length === 2 && "3⭐ to the leader."}
            {state.players.length === 3 && "4⭐ / 2⭐ for 1st / 2nd."}
            {state.players.length === 4 && "5⭐ / 3⭐ / 1⭐ for 1st / 2nd / 3rd."}{" "}
            Ties split the combined award.
          </div>
        </div>
      </details>
      <details className="rules-details">
        <summary>Other Rules</summary>
        <div className="rules-box">
          <div>Each turn: 2 <em>different</em> actions (or End Turn early).</div>
          <div>Shops: +$1/season per adjacent ride or coaster (anyone's).</div>
          <div>Water tiles (💧): only Splash Boats can be built there.</div>
          <div>
            Camps (forest 🌲) &amp; mines (hill ⛰): ${FACILITY_COST} — +{FACILITY_OUTPUT} resource
            now, +{FACILITY_OUTPUT} &amp; ${FACILITY_INCOME}/season. Developed land: no scenery ⭐
            for neighbors, can't host attractions.
          </div>
          <div>Missing wood/steel can be bought for $3 each when building.</div>
          <div>Seasons 4–5: buy up to 3 tiles per turn (+$2 per extra tile).</div>
          <div>The market and draw pile reshuffle each new season.</div>
        </div>
      </details>

      {/* Draw choice modal */}
      {state.phase === "drawChoice" && state.drawnCards && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Choose one to keep</h2>
            <div className="modal-cards">
              {state.drawnCards.map((cardId, i) => (
                <Card
                  key={i}
                  card={CARDS_BY_ID[cardId]}
                  onClick={() => dispatch({ type: "KEEP_CARD", index: i })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Opening draft modal (shows the first still-drafting player's cards) */}
      {state.phase === "draft" &&
        state.draftPlayerId !== null &&
        state.draftCards[state.draftPlayerId] && (
          <div className="modal-overlay">
            <div className="modal">
              <h2 style={{ color: state.players[state.draftPlayerId].color }}>
                {state.players[state.draftPlayerId].name}: keep 2 of 5
              </h2>
              <div className="modal-cards">
                {state.draftCards[state.draftPlayerId].map((cardId, i) => (
                  <div
                    key={i}
                    className={
                      "draft-card" +
                      (state.draftSelected[state.draftPlayerId].includes(i) ? " picked" : "")
                    }
                  >
                    <Card
                      card={CARDS_BY_ID[cardId]}
                      onClick={() => dispatch({ type: "TOGGLE_DRAFT_CARD", index: i })}
                    />
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{ justifyContent: "center" }}>
                <button
                  className="btn primary"
                  disabled={state.draftSelected[state.draftPlayerId].length !== 2}
                  onClick={() => dispatch({ type: "CONFIRM_DRAFT" })}
                >
                  Keep these {state.draftSelected[state.draftPlayerId].length}/2
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
