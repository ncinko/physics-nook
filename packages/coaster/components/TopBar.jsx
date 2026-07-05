import React from "react";

export default function TopBar({ state }) {
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  return (
    <div className="top-bar">
      <div className="logo">🎢 coaster slop</div>
      <div className="tracker">
        <span className="tracker-label">Season</span>
        {Array.from({ length: state.maxSeasons }, (_, i) => (
          <span key={i} className={"gem" + (i + 1 === state.season ? " on" : i + 1 < state.season ? " done" : "")} />
        ))}
        <span className="tracker-label turn-label">Turn</span>
        {Array.from({ length: state.turnsPerPlayerPerSeason }, (_, i) => (
          <span key={i} className={"dot" + (i + 1 === state.turnNumber ? " on" : i + 1 < state.turnNumber ? " done" : "")} />
        ))}
      </div>
      <div className="current-ribbon" style={{ "--pc": current.color }}>
        {current.name}
      </div>
    </div>
  );
}
