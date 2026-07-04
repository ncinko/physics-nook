import React, { useState, useSyncExternalStore } from "react";

import Board from "../../../../packages/coaster/components/Board.jsx";
import HandTray from "../../../../packages/coaster/components/HandTray.jsx";
import LeftPanel from "../../../../packages/coaster/components/LeftPanel.jsx";
import RightPanel from "../../../../packages/coaster/components/RightPanel.jsx";
import TopBar from "../../../../packages/coaster/components/TopBar.jsx";
import { PLAYER_COLORS } from "../../../../packages/coaster/game/reducer.js";
import { getStoredName } from "./net.ts";

export default function OnlineApp({ net }) {
  const netState = useSyncExternalStore(net.subscribe, net.getState);
  const [localError, setLocalError] = useState(null);

  const { status, seat, room, gameState, error } = netState;
  const toast = error ?? localError;

  const showToast = (message) => {
    setLocalError(message);
    setTimeout(() => setLocalError(null), 4000);
  };

  if (!room) {
    return <MenuScreen net={net} status={status} toast={toast} />;
  }

  if (!gameState) {
    return <WaitingRoom net={net} room={room} seat={seat} status={status} toast={toast} />;
  }

  return (
    <GameScreen
      net={net}
      room={room}
      seat={seat}
      state={gameState}
      status={status}
      toast={toast}
      showToast={showToast}
    />
  );
}

function MenuScreen({ net, status, toast }) {
  const [name, setName] = useState(getStoredName());
  const [code, setCode] = useState("");
  const ready = status === "open";
  const playerName = name.trim();

  return (
    <div className="setup-screen lobby-screen">
      <h1>🎢 Mega Park</h1>
      <p>Rival developers compete over one shared mega-park — now online.</p>

      <div className="lobby-form">
        <label className="lobby-label">
          Your name
          <input
            className="lobby-input"
            type="text"
            maxLength={16}
            placeholder="e.g. Nick"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button
          className="btn primary big"
          disabled={!ready || playerName.length === 0}
          onClick={() => net.createRoom(playerName)}
        >
          Create Game
        </button>

        <div className="lobby-divider">or join a friend</div>

        <div className="lobby-join-row">
          <input
            className="lobby-input lobby-code-input"
            type="text"
            maxLength={4}
            placeholder="CODE"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready && playerName && code.length === 4) {
                net.joinRoom(code, playerName);
              }
            }}
          />
          <button
            className="btn primary"
            disabled={!ready || playerName.length === 0 || code.length !== 4}
            onClick={() => net.joinRoom(code, playerName)}
          >
            Join
          </button>
        </div>
      </div>

      {!ready && <div className="lobby-status">Connecting to game server…</div>}
      {toast && <div className="lobby-toast">{toast}</div>}
    </div>
  );
}

function WaitingRoom({ net, room, seat, status, toast }) {
  const mySeat = room.seats.find((s) => s.seat === seat);
  const isHost = mySeat?.isHost ?? false;

  return (
    <div className="setup-screen lobby-screen">
      <h1>🎢 Mega Park</h1>
      <p>Tell your friends the room code:</p>
      <div className="room-code">{room.roomCode}</div>

      <div className="seat-list">
        {room.seats.map((s) => (
          <div key={s.seat} className="seat-row" style={{ "--pc": PLAYER_COLORS[s.seat] }}>
            <span className={"seat-dot" + (s.connected ? " on" : "")} />
            <span className="seat-name">
              {s.name}
              {s.seat === seat && " (you)"}
              {s.isHost && " 👑"}
            </span>
          </div>
        ))}
        {room.seats.length < room.maxSeats && (
          <div className="seat-row empty">Waiting for players… ({room.seats.length}/{room.maxSeats})</div>
        )}
      </div>

      {isHost ? (
        <button className="btn primary big" disabled={!room.canStart} onClick={() => net.startGame()}>
          {room.canStart ? `Start Game (${room.seats.length} players)` : "Need at least 2 players"}
        </button>
      ) : (
        <div className="lobby-status">Waiting for the host to start…</div>
      )}

      <button className="btn lobby-leave" onClick={() => net.leaveRoom()}>
        Leave
      </button>

      {status !== "open" && <div className="lobby-status">Reconnecting…</div>}
      {toast && <div className="lobby-toast">{toast}</div>}
    </div>
  );
}

function GameScreen({ net, room, seat, state, status, toast, showToast }) {
  const isHost = room.seats.find((s) => s.seat === seat)?.isHost ?? false;
  const isMyTurn =
    state.phase === "draft" ? state.draftPlayerId === seat : state.currentPlayerId === seat;

  const activePlayer =
    state.phase === "draft"
      ? state.players[state.draftPlayerId]
      : state.players.find((p) => p.id === state.currentPlayerId);

  const dispatch = (action) => {
    // The synced game-over screen offers "Play Again" via NEW_GAME; online,
    // restarting is a host-only lobby operation.
    if (action.type === "NEW_GAME") {
      if (isHost) net.restartGame();
      else showToast("Only the host can start a new game.");
      return;
    }
    if (!isMyTurn && state.phase !== "gameOver") {
      showToast(`It's ${activePlayer.name}'s turn.`);
      return;
    }
    net.dispatchAction(action);
  };

  // The synced HandTray shows the hand of `currentPlayerId` (hotseat behavior);
  // online, every player sees their own hand, and staging UI only on their turn.
  const handState = {
    ...state,
    currentPlayerId: seat,
    selectedAction: isMyTurn ? state.selectedAction : null,
    selectedCardId: isMyTurn ? state.selectedCardId : null,
    selectedHexIds: isMyTurn ? state.selectedHexIds : [],
  };

  return (
    <div className="table">
      <TopBar state={state} />
      <div className="layout">
        <LeftPanel state={state} />
        <div className="board-wrap">
          <Board state={state} dispatch={dispatch} />
        </div>
        <RightPanel state={state} dispatch={dispatch} />
      </div>
      <HandTray state={handState} dispatch={dispatch} />

      {!isMyTurn && state.phase !== "gameOver" && (
        <div className="turn-banner" style={{ "--pc": activePlayer.color }}>
          Waiting for {activePlayer.name}…
        </div>
      )}

      {state.phase === "gameOver" && !isHost && (
        <div className="turn-banner">The host can start a new game from this room.</div>
      )}

      {status !== "open" && (
        <div className="net-overlay">
          <div className="net-overlay-card">Reconnecting to the game…</div>
        </div>
      )}

      {toast && <div className="lobby-toast game-toast">{toast}</div>}
    </div>
  );
}
