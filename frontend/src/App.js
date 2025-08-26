import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const socket = io(); // proxied via setupProxy

const emptyBoard = Array(9).fill(null);

function Board({ board, onMove, disabled }) {
  return (
    <div className="board" aria-label="Game board">
      {board.map((v, i) => (
        <button
          key={i}
          className="cell"
          disabled={disabled || v !== null}
          onClick={() => onMove(i)}
          aria-label={`cell ${i + 1}${v ? ` ${v}` : ""}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [socketConnected, setSocketConnected] = useState(false);

  // Lobby / game phase
  const [phase, setPhase] = useState("landing"); // landing | waiting | playing | over
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [spectating, setSpectating] = useState(false);

  // Board & turn info
  const [board, setBoard] = useState(emptyBoard);
  const [next, setNext] = useState("X");
  const [mySymbol, setMySymbol] = useState(null); // "X" | "O" | null (spectator)

  // Result
  const [winner, setWinner] = useState(null);
  const [draw, setDraw] = useState(false);

  // Spectators
  const [spectatorCount, setSpectatorCount] = useState(0);

  // Player names (symbol -> name)
  const [players, setPlayers] = useState({ X: null, O: null });

  // Error display
  const [error, setError] = useState("");

  // Cheer / cooldown
  const [cooldown, setCooldown] = useState(0); // seconds until the next cheer
  const lastCheerRef = useRef(0);
  const cooldownMs = 10_000;

  const myTurn = useMemo(() => {
    return !spectating && phase === "playing" && mySymbol && mySymbol === next;
  }, [spectating, phase, mySymbol, next]);

  useEffect(() => {
    // Interval to update cheer cooldown
    const t = setInterval(() => {
      const now = Date.now();
      const remain = Math.max(0, cooldownMs - (now - lastCheerRef.current));
      setCooldown(Math.ceil(remain / 1000));
    }, 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Socket lifecycle
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));

    // Server assigns a symbol (player)
    socket.on("assign", ({ symbol }) => {
      setMySymbol(symbol);
      setSpectating(false);
      setError("");
    });

    // Waiting for the second player
    socket.on("waiting", (payload = {}) => {
      setPhase("waiting");
      if (payload.players) setPlayers(payload.players);
      harvestSpectatorCount(payload);
    });

    // Game start
    socket.on("start", ({ next, board, players: p, ...rest }) => {
      setBoard(board || emptyBoard);
      setNext(next || "X");
      setWinner(null);
      setDraw(false);
      setPhase("playing");
      setError("");
      if (p) setPlayers(p);
      harvestSpectatorCount(rest);
    });

    // Ongoing state updates
    socket.on("state", (payload = {}) => {
      if (payload.board) setBoard(payload.board);
      if (payload.next) setNext(payload.next);
      if (payload.status === "over") setPhase("over");
      if (typeof payload.winner !== "undefined") setWinner(payload.winner);
      if (typeof payload.draw !== "undefined") setDraw(payload.draw);
      if (payload.players) setPlayers(payload.players);
      harvestSpectatorCount(payload);
    });

    // Game over
    socket.on("game_over", ({ winner, draw, ...rest }) => {
      setWinner(winner ?? null);
      setDraw(!!draw);
      setPhase("over");
      harvestSpectatorCount(rest);
    });

    // Opponent left
    socket.on("opponent_left", () => {
      setError("Your opponent left the game.");
      resetToLanding();
    });

    // Server-side error
    socket.on("error", ({ message }) => setError(message || "Unknown error"));

    // Spectator joined → receive immediate state
    socket.on("spectator", (payload = {}) => {
      setSpectating(true);
      if (payload.board) setBoard(payload.board);
      if (payload.next) setNext(payload.next);
      if (payload.status) {
        setPhase(
          payload.status === "waiting"
            ? "waiting"
            : payload.status === "playing"
            ? "playing"
            : "over"
        );
      }
      if (typeof payload.winner !== "undefined") setWinner(payload.winner);
      if (typeof payload.draw !== "undefined") setDraw(payload.draw);
      if (payload.players) setPlayers(payload.players);
      setMySymbol(null);
      setError("");
      harvestSpectatorCount(payload);
    });

    // Dedicated spectator count channel (if backend emits it)
    socket.on("audience", ({ spectatorCount }) => {
      if (Number.isFinite(spectatorCount)) setSpectatorCount(spectatorCount);
    });

    // Player info can update independently from state
    socket.on("players", ({ players }) => {
      setPlayers(players || { X: null, O: null });
    });

    // Global cheer: confetti for everyone
    socket.on("cheer", ({ target }) => {
      fireConfetti(target);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  function harvestSpectatorCount(obj = {}) {
    // Accept various fields, depending on backend:
    // spectatorCount, spectatorsCount, audience, spectators (array/set length)
    if (Number.isFinite(obj.spectatorCount)) return setSpectatorCount(obj.spectatorCount);
    if (Number.isFinite(obj.spectatorsCount)) return setSpectatorCount(obj.spectatorsCount);
    if (Number.isFinite(obj.audience)) return setSpectatorCount(obj.audience);
    if (Array.isArray(obj.spectators)) return setSpectatorCount(obj.spectators.length);
    if (typeof obj.spectators?.size === "number") return setSpectatorCount(obj.spectators.size);
  }

  async function createGame() {
    try {
      setError("");
      const res = await fetch("/api/games", { method: "POST" });
      if (!res.ok) throw new Error("Could not create a game.");
      const data = await res.json();
      setCode(data.code);
      socket.emit("join", { code: data.code, name: name || "Guest" });
      setPhase("waiting");
    } catch (e) {
      setError(e.message);
    }
  }

  function joinGame() {
    if (!code || code.length < 4) return setError("Please enter a valid code.");
    if (!name.trim()) return setError("Please enter a username.");
    setError("");
    socket.emit("join", { code, name });
  }

  function watchGame() {
    if (!code || code.length < 4) return setError("Please enter a valid code.");
    if (!name.trim()) return setError("Please enter a username.");
    setError("");
    socket.emit("join", { code, name, spectator: true });
  }

  function makeMove(cell) {
    if (phase !== "playing") return;
    if (spectating) return; // spectators do not play
    if (board[cell] !== null) return;
    if (!myTurn) return;
    socket.emit("move", { code, cell });
  }

  function resign() {
    if (spectating || phase !== "playing") return;
    socket.emit("resign", { code });
  }

  function rematch() {
    if (spectating || phase !== "over") return;
    socket.emit("rematch", { code });
  }

  function resetToLanding() {
    setPhase("landing");
    setBoard(emptyBoard);
    setWinner(null);
    setDraw(false);
    setMySymbol(null);
    setNext("X");
    setSpectating(false);
    setPlayers({ X: null, O: null });
  }

  // === Cheer ===
  function canCheer() {
    return spectating && cooldown === 0;
  }

  function cheer(target) {
    if (!canCheer()) return;
    lastCheerRef.current = Date.now();
    setCooldown(Math.ceil(cooldownMs / 1000));

    // Send to the server → backend broadcasts to all
    socket.emit("cheer", { code, target });

    // Optionally also trigger locally for snappier feedback
    fireConfetti(target);
  }

  function fireConfetti(target) {
    // Simple, dependency-free confetti burst
    const container = document.body;
    const count = 120;
    const burst = document.createElement("div");
    burst.className = "confetti-burst";
    container.appendChild(burst);

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("i");
      piece.className = "confetti";
      // slight hue weighting by target
      const hueBase = target === "X" ? 210 : 10; // blue/red-ish
      const hue = hueBase + Math.floor(Math.random() * 30) - 15;
      const sat = 70 + Math.floor(Math.random() * 30);
      const light = 50 + Math.floor(Math.random() * 10);
      piece.style.setProperty("--confetti-color", `hsl(${hue} ${sat}% ${light}%)`);
      piece.style.setProperty("--tx", (Math.random() * 2 - 1).toFixed(2)); // -1..1
      piece.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0));
      piece.style.left = Math.random() * 100 + "%";
      piece.style.setProperty("--scale", (0.6 + Math.random() * 0.8).toFixed(2));
      piece.style.animationDelay = (Math.random() * 0.1).toFixed(2) + "s";
      piece.style.animationDuration = (1.5 + Math.random() * 0.9).toFixed(2) + "s";
      burst.appendChild(piece);
    }

    // Auto-cleanup
    setTimeout(() => {
      burst.remove();
    }, 2600);
  }

  return (
    <div className="container">
      <h1>Tic-Tac-Toe</h1>
      <div className={`conn ${socketConnected ? "ok" : "bad"}`}>
        Socket: {socketConnected ? "connected" : "disconnected"}
      </div>

      {phase === "landing" && (
        <div className="card">
          <h2>New game</h2>
          <div className="join join--stack">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              aria-label="Your name"
            />
            <button className="primary" onClick={createGame}>Create game</button>
          </div>

          <div className="divider">or</div>

          <h2>Join a game</h2>
          <div className="join join--wrap">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE (e.g., A1B2C3)"
              maxLength={8}
              aria-label="Game code"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              aria-label="Your name"
            />
            <button onClick={joinGame}>Join</button>
            <button className="btn-secondary" onClick={watchGame}>Watch only</button>
          </div>

          {!!error && <div className="error">{error}</div>}
        </div>
      )}

      {(phase === "waiting" || phase === "playing" || phase === "over") && (
        <div className="game">
          <div className="top">
            <div>
              Code: <code className="code">{code}</code>
            </div>

            {/* Role display (player or spectator) */}
            <div className="role">
              {spectating ? (
                <span className="badge badge--spectator" title="Spectator mode">Spectator</span>
              ) : (
                <>
                  You are: <strong>{name || "Guest"}</strong>
                  {mySymbol && (
                    <> &nbsp;(<span className={`pill pill--${mySymbol}`}>{mySymbol}</span>)</>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Players visible to everyone */}
          <div className="playersbar">
            <span className="pair">
              <span className="pill pill--X">X</span>&nbsp;{players.X || "?"}
            </span>
            <span className="sep">·</span>
            <span className="pair">
              <span className="pill pill--O">O</span>&nbsp;{players.O || "?"}
            </span>
          </div>

          {/* Spectator count */}
          <div className="audience">
            Spectators:&nbsp;<strong>{spectatorCount}</strong>
          </div>

          <Board
            board={board}
            onMove={makeMove}
            disabled={phase !== "playing" || spectating || !myTurn}
          />

          <div className="status">
            {phase === "waiting" && <p>Waiting for an opponent…</p>}

            {phase === "playing" && (
              <p>
                {spectating
                  ? "You are watching."
                  : myTurn
                  ? "Your turn."
                  : "Opponent's turn."}{" "}
                (Next: <strong>{next}</strong>)
              </p>
            )}

            {phase === "over" && (
              <p>
                {draw
                  ? "Draw!"
                  : spectating
                  ? `${winner} won!`
                  : winner === mySymbol
                  ? "You won!"
                  : "You lost."}
              </p>
            )}
          </div>


          {/* Cheer section for spectators only */}
          {spectating && (phase === "playing" || phase === "waiting") && (
            <div className="cheer">
              <div className="cheer__title">Cheer:</div>
              <div className="cheer__buttons">
                <button onClick={() => cheer("X")} disabled={!canCheer()}>
                  Cheer for X {cooldown > 0 ? `(${cooldown}s)` : ""}
                </button>
                <button onClick={() => cheer("O")} disabled={!canCheer()}>
                  Cheer for O {cooldown > 0 ? `(${cooldown}s)` : ""}
                </button>
              </div>
              <div className="cheer__hint">You can cheer every 10 seconds.</div>
            </div>
          )}

          <div className="actions">
            {!spectating && phase === "playing" && (
              <button className="danger" onClick={resign}>Resign</button>
            )}
            {!spectating && phase === "over" && (
              <button onClick={rematch}>Rematch</button>
            )}
            <button className="btn-ghost" onClick={resetToLanding}>New match</button>
          </div>

          {!!error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}
