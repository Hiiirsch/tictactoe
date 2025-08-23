import React, { useState, useCallback, useEffect } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { getInitialState, makeMove } from "../logic/gameLogic";
import { useWebSocket } from "../hooks/useWebSocket";

export default function Game() {
  const { roomCode } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const isHost = searchParams.get("host") === "true";

  const [gameState, setGameState] = useState(getInitialState());
  const [isMyTurn, setIsMyTurn] = useState(isHost);
  const [statusMessage, setStatusMessage] = useState("");

  const handleMessage = useCallback(
    (data) => {
      if (data.type === "move" && data.room === roomCode) {
        setGameState((prev) => makeMove(prev, data.index));
        setIsMyTurn(true);
        setStatusMessage(`Am Zug: ${gameState.currentPlayer}`);
      }
    },
    [roomCode, gameState.currentPlayer]
  );

  const { sendMessage } = useWebSocket(handleMessage);

  function handleClick(index) {
    if (!isMyTurn) return;
    if (gameState.winner || gameState.board[index] !== null) return;

    setIsMyTurn(false);
    const newState = makeMove(gameState, index);
    setGameState(newState);

    sendMessage({ type: "move", room: roomCode, index });
    setStatusMessage("Warten auf Gegner...");
  }

  function renderCell(index) {
    return (
      <button
        onClick={() => handleClick(index)}
        style={{
          width: "60px",
          height: "60px",
          fontSize: "24px",
          margin: "4px",
          cursor: isMyTurn ? "pointer" : "not-allowed",
          backgroundColor: gameState.board[index] ? "#eee" : "#fff",
        }}
      >
        {gameState.board[index]}
      </button>
    );
  }

  useEffect(() => {
    if (gameState.winner === "draw") setStatusMessage("Unentschieden!");
    else if (gameState.winner)
      setStatusMessage(`Spieler ${gameState.winner} hat gewonnen!`);
    else if (isMyTurn) setStatusMessage(`Am Zug: ${gameState.currentPlayer}`);
  }, [gameState, isMyTurn]);

  return (
    <div style={{ textAlign: "center", marginTop: "40px" }}>
      <h2>Tic Tac Toe (Raum: {roomCode})</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)" }}>
        {gameState.board.map((_, i) => renderCell(i))}
      </div>
      <p>{statusMessage}</p>
      <button
        onClick={() => {
          setGameState(getInitialState());
          setIsMyTurn(isHost);
        }}
        style={{ marginTop: "12px", padding: "8px 16px", fontSize: "16px", cursor: "pointer" }}
      >
        Neues Spiel
      </button>
      <br />
      <button
        onClick={() => navigate("/")}
        style={{ marginTop: "12px", padding: "8px 16px", fontSize: "16px", cursor: "pointer" }}
      >
        Zurück zur Landing Page
      </button>
    </div>
  );
}
