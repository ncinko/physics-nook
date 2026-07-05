import React, { useMemo, useState } from "react";
import { CARDS_BY_ID } from "../game/cards.js";
import { calculateSeasonIncome } from "../game/logic.js";
import { CoinToken, StarToken, SteelToken, WoodToken } from "./sprites.jsx";

const RESOURCES = [
  { key: "money", label: "Money", Token: CoinToken },
  { key: "wood", label: "Wood", Token: WoodToken },
  { key: "steel", label: "Steel", Token: SteelToken }
];

const emptyTrade = () => ({ money: 0, wood: 0, steel: 0 });
const tradeTotal = (t) => t.money + t.wood + t.steel;
const canCover = (p, cost) => p.money >= cost.money && p.wood >= cost.wood && p.steel >= cost.steel;

function TradeSummary({ trade }) {
  const items = [];
  if (trade.money) items.push(<span key="m" className="token-chip"><CoinToken />{trade.money}</span>);
  if (trade.wood) items.push(<span key="w" className="token-chip"><WoodToken />{trade.wood}</span>);
  if (trade.steel) items.push(<span key="s" className="token-chip"><SteelToken />{trade.steel}</span>);
  return items.length ? <span className="trade-summary">{items}</span> : <em>nothing</em>;
}

function TradeStepper({ Token, label, value, max, onChange }) {
  return (
    <div className="trade-stepper">
      <span className="trade-res"><Token /> {label}</span>
      <button className="step-btn" disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <span className="step-val">{value}</span>
      <button className="step-btn" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

// viewerId is the id of the player looking at this screen. Hotseat leaves it
// undefined (the acting player is whoever's turn it is); online passes the seat.
export default function LeftPanel({ state, dispatch, viewerId }) {
  const [logOpen, setLogOpen] = useState(false);
  const [tradeTarget, setTradeTarget] = useState(null);
  const [offer, setOffer] = useState(emptyTrade);
  const [request, setRequest] = useState(emptyTrade);

  // Projected end-of-season production (assuming nothing else changes).
  const projection = useMemo(
    () => calculateSeasonIncome(state.players, state.attractions, state.hexes),
    [state.players, state.attractions, state.hexes]
  );

  const pending = state.pendingTrade;
  const hotseat = viewerId == null;
  const viewer = hotseat ? state.currentPlayerId : viewerId;
  const canProposeTrades =
    !!dispatch && !pending && state.phase === "playing" && viewer === state.currentPlayerId;

  const openTrade = (playerId) => {
    setTradeTarget(playerId);
    setOffer(emptyTrade());
    setRequest(emptyTrade());
  };
  const closeTrade = () => setTradeTarget(null);

  const me = state.players.find((p) => p.id === state.currentPlayerId);
  const them = tradeTarget != null ? state.players.find((p) => p.id === tradeTarget) : null;

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
              <span>
                {p.name}
                {state.winners?.includes(p.id) && " 🏆"}
              </span>
              {canProposeTrades && !isCurrent && (
                <button
                  className="trade-btn"
                  title={`Offer ${p.name} a trade`}
                  aria-label={`Offer ${p.name} a trade`}
                  onClick={() => openTrade(p.id)}
                >
                  ⇄
                </button>
              )}
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

      {/* Trade builder — the current player sets an offer for another player */}
      {tradeTarget != null && them && me && !pending && (
        <div className="modal-overlay" onClick={closeTrade}>
          <div className="modal trade-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Offer {them.name} a trade</h2>
            <div className="trade-sides">
              <div className="trade-side">
                <div className="trade-side-label" style={{ color: me.color }}>You give</div>
                {RESOURCES.map(({ key, label, Token }) => (
                  <TradeStepper
                    key={key}
                    Token={Token}
                    label={label}
                    value={offer[key]}
                    max={me[key]}
                    onChange={(v) => setOffer({ ...offer, [key]: v })}
                  />
                ))}
              </div>
              <div className="trade-side">
                <div className="trade-side-label" style={{ color: them.color }}>You get</div>
                {RESOURCES.map(({ key, label, Token }) => (
                  <TradeStepper
                    key={key}
                    Token={Token}
                    label={label}
                    value={request[key]}
                    max={them[key]}
                    onChange={(v) => setRequest({ ...request, [key]: v })}
                  />
                ))}
              </div>
            </div>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <button
                className="btn primary"
                disabled={tradeTotal(offer) + tradeTotal(request) === 0}
                onClick={() => {
                  dispatch({ type: "PROPOSE_TRADE", to: tradeTarget, offer, request });
                  closeTrade();
                }}
              >
                Propose
              </button>
              <button className="btn" onClick={closeTrade}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Pending trade — target accepts/declines; online proposer sees a wait */}
      {pending && dispatch && (() => {
        const from = state.players.find((p) => p.id === pending.from);
        const to = state.players.find((p) => p.id === pending.to);
        const iAmResponder = hotseat || viewer === pending.to;
        const iAmProposer = !hotseat && viewer === pending.from;
        if (!iAmResponder && !iAmProposer) return null;
        const cannotAfford = !canCover(to, pending.request);
        return (
          <div className="modal-overlay">
            <div className="modal trade-modal">
              {iAmResponder ? (
                <>
                  <h2 style={{ color: from.color }}>{from.name} offers you a trade</h2>
                  <div className="trade-review">
                    <div>
                      <span style={{ color: from.color, fontWeight: 700 }}>{from.name} gives</span>{" "}
                      <TradeSummary trade={pending.offer} />
                    </div>
                    <div>
                      <span style={{ color: to.color, fontWeight: 700 }}>You give</span>{" "}
                      <TradeSummary trade={pending.request} />
                    </div>
                  </div>
                  {cannotAfford && (
                    <div className="substitute-note">You can't cover this trade right now.</div>
                  )}
                  <div className="btn-row" style={{ justifyContent: "center" }}>
                    <button
                      className="btn primary"
                      disabled={cannotAfford}
                      onClick={() => dispatch({ type: "ACCEPT_TRADE" })}
                    >
                      Accept
                    </button>
                    <button className="btn" onClick={() => dispatch({ type: "DECLINE_TRADE" })}>
                      Decline
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Waiting for {to.name}…</h2>
                  <div className="trade-review">
                    <div>You give <TradeSummary trade={pending.offer} /></div>
                    <div>You get <TradeSummary trade={pending.request} /></div>
                  </div>
                  <div className="btn-row" style={{ justifyContent: "center" }}>
                    <button className="btn" onClick={() => dispatch({ type: "CANCEL_TRADE" })}>
                      Withdraw
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
