import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const emptyBoard = Array(9).fill(null);

function Cell({ value, onClick, disabled }) {
  return (
    <button className="cell" onClick={onClick} disabled={disabled || value !== null}>
      {value ?? ""}
    </button>
  );
}

function Board({ board, onMove, disabled }) {
  return (
    <div className="board">
      {board.map((v, i) => (
        <Cell key={i} value={v} onClick={() => onMove(i)} disabled={disabled} />
      ))}
    </div>
  );
}

export default function App() {
  const [socketConnected, setSocketConnected] = useState(false);
  const socket = useMemo(() => {
    // same origin; Nginx routes /socket.io/ to the backend
    return io("/", { path: "/socket.io/", transports: ["websocket"] });
  }, []);

  const [phase, setPhase] = useState("landing"); // landing | waiting | playing | over
  const [code, setCode] = useState("");
  const [mySymbol, setMySymbol] = useState(null); // "X" | "O"
  const [board, setBoard] = useState(emptyBoard);
  const [next, setNext] = useState("X");
  const [winner, setWinner] = useState(null);
  const [draw, setDraw] = useState(false);
  const [error, setError] = useState("");

  // NEW: rematch UI state
  const [rematchRequested, setRematchRequested] = useState(false); // opponent requested a rematch
  const [rematchPending, setRematchPending] = useState(false);     // I have requested a rematch

  useEffect(() => {
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));

    socket.on("assign", ({ symbol }) => {
      setMySymbol(symbol);
      setError("");
    });

    socket.on("waiting", () => setPhase("waiting"));

    socket.on("start", ({ next, board }) => {
      setBoard(board || emptyBoard);
      setNext(next || "X");
      setWinner(null);
      setDraw(false);
      setPhase("playing");
      setRematchRequested(false);
      setRematchPending(false);
      setError("");
    });

    socket.on("state", (payload) => {
      if (payload.board) setBoard(payload.board);
      if (payload.next) setNext(payload.next);
      if (payload.status === "over") setPhase("over");
      if (typeof payload.winner !== "undefined") setWinner(payload.winner);
      if (typeof payload.draw !== "undefined") setDraw(payload.draw);
    });

    socket.on("game_over", ({ winner, draw }) => {
      setWinner(winner ?? null);
      setDraw(!!draw);
      setPhase("over");
    });

    socket.on("opponent_left", () => {
      setError("Your opponent has left the game.");
      setPhase("landing");
      setMySymbol(null);
      setBoard(emptyBoard);
      setWinner(null);
      setDraw(false);
      // reset flags
      setRematchRequested(false);
      setRematchPending(false);
    });

    socket.on("error", ({ message }) => setError(message || "Unknown error"));

    // NEW: opponent requested a rematch -> show info + button
    socket.on("rematch_request", ({ from }) => {
      setRematchRequested(true);
      setError(`Opponent wants a rematch${from ? ` (${from})` : ""}.`);
    });

    // NEW: my own request was sent -> show pending feedback
    socket.on("rematch_pending", ({ waiting_for }) => {
      setRematchPending(true);
      setError(`Rematch requested. Waiting for approval (${waiting_for}) …`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  async function createGame() {
    try {
      setError("");
      const res = await fetch("/api/games", { method: "POST" });
      if (!res.ok) throw new Error("Error creating game");
      const data = await res.json();
      setCode(data.code);
      socket.emit("join", { code: data.code });
      setPhase("waiting");
    } catch (e) {
      setError(e.message);
    }
  }

  function joinGame() {
    if (!code || code.length < 4) {
      setError("Please enter a valid code.");
      return;
    }
    setError("");
    socket.emit("join", { code });
  }

  function makeMove(cell) {
    if (phase !== "playing") return;
    if (board[cell] !== null) return;
    if (mySymbol !== next) return;
    socket.emit("move", { code, cell });
    // once a move is made, old rematch states are no longer valid
    setRematchRequested(false);
    setRematchPending(false);
  }

  function resign() {
    socket.emit("resign", { code });
  }

  function rematch() {
    setError("");
    setWinner(null);
    setDraw(false);
    setBoard(emptyBoard);
    socket.emit("rematch", { code });
    // directly set pending (server also confirms with rematch_pending)
    setRematchPending(true);
  }

  // NEW: accept opponent's rematch request
  function acceptRematch() {
    if (!code) return;
    socket.emit("rematch", { code }); 
    setRematchRequested(false);
    setRematchPending(true);
  }

  const myTurn = phase === "playing" && mySymbol === next;

  return (
    <div className="container">
      <h1>Tic-Tac-Toe</h1>
      <div className={`conn ${socketConnected ? "ok" : "bad"}`}>
        Socket: {socketConnected ? "connected" : "disconnected"}
      </div>

      {phase === "landing" && (
        <div className="card">
          <h2>New Game</h2>
          <button className="primary" onClick={createGame}>Create Game</button>

          <div className="divider">or</div>

          <h2>Join Game</h2>
          <div className="join">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE (e.g. A1B2C3)"
              maxLength={8}
            />
            <button onClick={joinGame}>Join</button>
          </div>
        </div>
      )}

      {phase === "waiting" && (
        <div className="card">
          <h2>Waiting for opponent …</h2>
          <p><strong>Code:</strong> <code className="code">{code}</code></p>
          <p>Share this code with your opponent.</p>
          {mySymbol && <p>You are: <strong>{mySymbol}</strong></p>}
        </div>
      )}

      {(phase === "playing" || phase === "over") && (
        <div className="game">
          <div className="top">
            <div>Code: <code className="code">{code}</code></div>
            <div>You are: <strong>{mySymbol}</strong></div>
          </div>

          <Board board={board} onMove={makeMove} disabled={phase !== "playing" || !myTurn} />

          <div className="status">
            {phase === "playing" && (
              <p>{myTurn ? "Your turn." : "Opponent's turn."} (Next: <strong>{next}</strong>)</p>
            )}
            {phase === "over" && (
              <p>{draw ? "Draw!" : winner === mySymbol ? "You won!" : "You lost."}</p>
            )}
          </div>

          <div className="actions">
            {phase === "playing" && <button className="danger" onClick={resign}>Resign</button>}
            {phase === "over" && <button onClick={rematch}>Rematch</button>}
            <button onClick={() => {
              setPhase("landing");
              setBoard(emptyBoard);
              setWinner(null);
              setDraw(false);
              setMySymbol(null);
              setNext("X");
              setRematchRequested(false); 
              setRematchPending(false);   
            }}>New Match</button>
          </div>
        </div>
      )}

      {/* NEW: Rematch banner when opponent requests it */}
      {rematchRequested && phase !== "playing" && (
        <div className="card" style={{ marginTop: 12 }}>
          <p>Opponent wants a rematch.</p>
          <div className="actions">
            <button className="primary" onClick={acceptRematch}>Accept</button>
            <button onClick={() => { setRematchRequested(false); setError(""); }}>Decline</button>
          </div>
        </div>
      )}

      {/* Optional: small pending badge */}
      {rematchPending && phase !== "playing" && (
        <div className="card" style={{ marginTop: 12 }}>
          <p>Rematch requested – waiting for opponent …</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
