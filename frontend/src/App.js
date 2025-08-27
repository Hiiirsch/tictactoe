import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";
import Confetti from "react-confetti";
import "./styles.css";

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
  // ---------- UI & Overlays ----------
  const [showManual, setShowManual] = useState(false);
  const [showVolumeMenu, setShowVolumeMenu] = useState(false);

  // Volumes (persisted)
  const [musicVolume, setMusicVolume] = useState(() => {
    const v = localStorage.getItem("musicVolume");
    return v !== null ? Number(v) : 0.25;
  });
  const [effectVolume, setEffectVolume] = useState(() => {
    const v = localStorage.getItem("effectVolume");
    return v !== null ? Number(v) : 0.7;
  });

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // ---------- Game state ----------
  const [phase, setPhase] = useState("landing"); // landing | waiting | playing | over
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [spectating, setSpectating] = useState(false);

  const [board, setBoard] = useState(emptyBoard);
  const [next, setNext] = useState("X");
  const [mySymbol, setMySymbol] = useState(null); // "X" | "O" | null (spectator)

  const [winner, setWinner] = useState(null);
  const [draw, setDraw] = useState(false);

  // Audience + players
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [players, setPlayers] = useState({ X: null, O: null }); // symbol -> name

  // Rematch UI state
  const [rematchRequested, setRematchRequested] = useState(false); // opponent asked
  const [rematchPending, setRematchPending] = useState(false); // I asked
  const [rematchDeclined, setRematchDeclined] = useState(false); // opponent declined

  // Socket & errors
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState("");

  // Cheer / cooldown (spectators)
  const [cooldown, setCooldown] = useState(0);
  const lastCheerRef = useRef(0);
  const cooldownMs = 10_000;

  // Turn helper
  const myTurn = useMemo(
    () => !spectating && phase === "playing" && mySymbol && mySymbol === next,
    [spectating, phase, mySymbol, next]
  );

  // Socket single instance (same-origin; Nginx routes /socket.io/ to backend)
  const socket = useMemo(
    () => io("/", { path: "/socket.io/", transports: ["websocket"] }),
    []
  );

  // URL ?code=XXXX -> auto-join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeFromURL = params.get("code");
    if (codeFromURL) {
      const upperCode = codeFromURL.toUpperCase();
      setCode(upperCode);
      joinGame(upperCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key.toLowerCase() === "m" && e.ctrlKey) {
        setShowVolumeMenu((v) => !v);
      }
      if (e.key === "Escape") {
        if (showManual) setShowManual(false);
        if (rematchPending && phase !== "playing") {
          setRematchPending(false);
          setError("");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showManual, rematchPending, phase]);

  // Cheer cooldown ticker
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const remain = Math.max(0, cooldownMs - (now - lastCheerRef.current));
      setCooldown(Math.ceil(remain / 1000));
    }, 250);
    return () => clearInterval(t);
  }, []);

  // Audio refs
  const victoryRef = useRef(null);
  const gameoverRef = useRef(null);
  const bgMusicRef = useRef(null);

  // Music & SFX on phase change (players only; spectators stay silent to avoid autoplay blocks)
  useEffect(() => {
    const bg = bgMusicRef.current;

    const playBg = () => {
      if (!bg) return;
      bg.volume = musicVolume;
      bg.loop = true;
      bg.play().catch(() => {
        // Autoplay may be blocked until user interacts.
      });
    };

    const stopBg = () => {
      if (!bg) return;
      bg.pause();
      bg.currentTime = 0;
    };

    // Spectators: no auto playback
    if (spectating) {
      stopBg();
      return;
    }

    if (phase === "playing") {
      playBg();
      return;
    }

    if (phase === "over") {
      stopBg();
      if (winner) {
        const sfx = winner === mySymbol ? victoryRef.current : gameoverRef.current;
        if (sfx) {
          try {
            sfx.currentTime = 0;
            sfx.volume = effectVolume;
            sfx.play().catch(() => {});
          } catch {}
        }
      }
      return;
    }

    // landing / waiting
    stopBg();
  }, [phase, winner, mySymbol, musicVolume, effectVolume, spectating]);

  // Socket wiring
  useEffect(() => {
    // Connection state
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));

    // Server assigns a symbol
    socket.on("assign", ({ symbol }) => {
      setMySymbol(symbol);
      setSpectating(false);
      setError("");
    });

    // Waiting for opponent
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
      setRematchRequested(false);
      setRematchPending(false);
      setRematchDeclined(false);
      setError("");
      if (p) setPlayers(p);
      harvestSpectatorCount(rest);
    });

    // State updates
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
      setError("Your opponent has left the game.");
      setRematchRequested(false);
      setRematchPending(false);
      setRematchDeclined(false);
    });

    // Backend errors
    socket.on("error", ({ message }) => {
      if (message === "cheer_rate_limited") return; // don't surface in UI
      if (message === "invalid_code") {
        setError("This game code does not exist! Please check the code and try again.");
      } else {
        setError(message || "Unknown error");
      }
    });

    // Spectator snapshot
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

    // Audience & players
    socket.on("audience", ({ spectatorCount }) => {
      if (Number.isFinite(spectatorCount)) setSpectatorCount(spectatorCount);
    });
    socket.on("players", ({ players }) => {
      setPlayers(players || { X: null, O: null });
    });

    // Cheer broadcast
    socket.on("cheer", ({ target }) => {
      fireConfetti(target);
    });

    // Rematch signals
    socket.on("rematch_declined", () => {
      setRematchPending(false);
      setRematchDeclined(true);
      setError("Opponent declined the rematch.");
    });
    socket.on("rematch_request", () => {
      setRematchRequested(true);
      setRematchDeclined(false);
      setError("");
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  function harvestSpectatorCount(obj = {}) {
    if (Number.isFinite(obj.spectatorCount)) return setSpectatorCount(obj.spectatorCount);
    if (Number.isFinite(obj.spectatorsCount)) return setSpectatorCount(obj.spectatorsCount);
    if (Number.isFinite(obj.audience)) return setSpectatorCount(obj.audience);
    if (Array.isArray(obj.spectators)) return setSpectatorCount(obj.spectators.length);
    if (typeof obj.spectators?.size === "number") return setSpectatorCount(obj.spectators.size);
  }

  // ---------- Actions ----------
  async function createGame() {
    try {
      setError("");
      let res = await fetch("/games", { method: "POST" });
      if (!res.ok) res = await fetch("/api/games", { method: "POST" });
      if (!res.ok) throw new Error("Could not create a game.");
      const data = await res.json();
      setCode(data.code);
      socket.emit("join", { code: data.code, name: name || "Guest" });
      setPhase("waiting");
    } catch (e) {
      setError(e.message);
    }
  }

  // Join game (optional explicit code for deep links)
  function joinGame(customCode) {
    const gameCode = (customCode || code || "").toUpperCase();
    if (!gameCode || gameCode.length < 4) {
      setError("Invalid game code! Please enter a code with at least 4 characters.");
      return;
    }
    setError("");
    socket.emit("join", { code: gameCode, name: name || "Guest" });
  }

  function watchGame() {
    const gameCode = (code || "").toUpperCase();
    if (!gameCode || gameCode.length < 4) return setError("Please enter a valid code.");
    setError("");
    socket.emit("join", { code: gameCode, name: name || "Guest", spectator: true });
  }

  function makeMove(cell) {
    if (phase !== "playing") return;
    if (spectating) return;
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
    setRematchPending(true); // optimistic UI
    setRematchDeclined(false);
  }

  function acceptRematch() {
    if (!code) return;
    socket.emit("rematch", { code });
    setRematchRequested(false);
    setRematchPending(true);
    setRematchDeclined(false);
  }

  function resetToLanding(emitNewMatch = false) {
    if (emitNewMatch && code) socket.emit("new_match", { code });
    setPhase("landing");
    setBoard(emptyBoard);
    setWinner(null);
    setDraw(false);
    setMySymbol(null);
    setNext("X");
    setSpectating(false);
    setPlayers({ X: null, O: null });
    setRematchRequested(false);
    setRematchPending(false);
    setRematchDeclined(false);
    setError("");
  }

  // ---------- Cheer ----------
  function canCheer() {
    return spectating && cooldown === 0;
  }

  function cheer(target) {
    if (!canCheer()) return;
    lastCheerRef.current = Date.now();
    setCooldown(Math.ceil(cooldownMs / 1000));
    socket.emit("cheer", { code, target });
    fireConfetti(target);
  }

  function fireConfetti(targetOrOpts) {
    let side, hueBase;
    if (typeof targetOrOpts === "string") {
      const t = String(targetOrOpts).toUpperCase();
      side = t === "X" ? "left" : "right";
      hueBase = t === "X" ? 210 : 8; // blue / red
    } else {
      side = targetOrOpts?.side === "right" ? "right" : "left";
      hueBase = targetOrOpts?.color === "red" ? 8 : 210;
    }

    const host =
      document.querySelector(".board") ||
      document.querySelector(".game") ||
      document.body;

    const lane = document.createElement("div");
    lane.className = `confetti-lane confetti-lane--${side}`;
    host.appendChild(lane);

    const count = 42;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece";

      const r = Math.random();
      if (r < 0.25) piece.classList.add("is-dot");
      else if (r > 0.75) piece.classList.add("is-wide");

      const hue = hueBase + Math.floor(Math.random() * 24) - 12;
      const sat = 80 + Math.floor(Math.random() * 12);
      const light = 52 + Math.floor(Math.random() * 10);
      piece.style.setProperty("--confetti-color", `hsl(${hue} ${sat}% ${light}%)`);

      piece.style.setProperty("--y", `${Math.floor(Math.random() * 100)}%`);
      piece.style.setProperty("--tx", (Math.random() * 1.0 + 0.1).toFixed(2));
      piece.style.setProperty("--vy", (Math.random() * 80 - 40).toFixed(0));
      piece.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0) + "deg");
      piece.style.setProperty("--scale", (0.7 + Math.random() * 0.6).toFixed(2));
      piece.style.setProperty("--dur", (750 + Math.random() * 450).toFixed(0) + "ms");
      piece.style.setProperty("--delay", (Math.random() * 100).toFixed(0) + "ms");

      lane.appendChild(piece);
    }

    setTimeout(() => lane.remove(), 1400);
  }

  // ---------- UI ----------
  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* Manual toggle (hidden when rematch overlays block) */}
      {(phase === "landing" || phase === "waiting" || phase === "playing" || phase === "over") &&
        !((rematchRequested && phase !== "playing") || (phase === "over" && draw) || (rematchPending && phase !== "playing")) && (
          <div style={{position: "fixed", top: 18, right: 18, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "flex-end"}}>
            <button
              className="primary manual-btn"
              style={{ fontSize: 14, padding: "8px 16px", marginBottom: 8 }}
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Back to Game" : "Manual"}
            </button>
            <button
              className="primary volume-btn"
              style={{ fontSize: 14, padding: "8px 16px" }}
              onClick={() => setShowVolumeMenu((v) => !v)}
            >
              {showVolumeMenu ? "Close Volume" : "Volume"}
            </button>
          </div>
      )}

      {/* Volume Menu */}
      {showVolumeMenu && (
        <div className="volume-menu">
          <h3>Volume</h3>

          <div className="volume-row">
            <label>Music</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={musicVolume}
              onChange={e => {
                setMusicVolume(Number(e.target.value));
                localStorage.setItem("musicVolume", e.target.value);
              }}
            />
            <span>{Math.round(musicVolume * 100)}%</span>
          </div>
          <div className="volume-row">
            <label>Effekte</label>
            <input
              type="range" min={0} max={1} step={0.01}
              value={effectVolume}
              onChange={e => {
                setEffectVolume(Number(e.target.value));
                localStorage.setItem("effectVolume", e.target.value);
              }}
            />
            <span>{Math.round(effectVolume * 100)}%</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 8, opacity: .7 }}>Open/Close menu with <b>Ctrl+M</b></div>
        </div>
      )}

      {/* Audio elements */}
      <audio ref={victoryRef} src="/victory.wav" preload="auto" />
      <audio ref={gameoverRef} src="/gameover.wav" preload="auto" />
      <audio ref={bgMusicRef} src="/bgmusic.wav" preload="auto" />

      {/* Background animations */}
      <div className="background-animations">
        {/* Players only */}
        {!spectating && phase === "over" && winner === mySymbol && (
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            numberOfPieces={600}
            gravity={0.5}
            initialVelocityY={20}
            recycle={true}
          />
        )}
        {!spectating && phase === "over" && winner && winner !== mySymbol && (
          <div className="shake-bg" />
        )}
      </div>

      {/* Manual overlay */}
      {showManual && (phase === "landing" || phase === "waiting" || phase === "playing" || phase === "over") && (
        <div className="manual-overlay">
          <div className="manual-card">
            <h2>- How to Play -</h2>
            <ul style={{ textAlign: "left", maxWidth: 420, margin: "0 auto", fontSize: "1.05rem", lineHeight: "1.7" }}>
              <li>This is classic Tic-Tac-Toe for 2 players.</li>
              <li>One player is <b>X</b>, the other is <b>O</b>.</li>
              <li>Players take turns marking a cell on the 3x3 board.</li>
              <li>The first to get 3 in a row, column, or diagonal wins.</li>
              <li>If all cells fill with no 3-in-a-row, it’s a draw.</li>
              <li>Use the "Rematch" button to request a new round.</li>
              <li>Use "New Match" to generate a new game code.</li>
              <li>Adjust volume with <b>M</b> (menu at top right).</li>
              <li>Arcade sounds and animations create a retro vibe!</li>
            </ul>
            <div style={{ marginTop: 18, fontSize: 12, opacity: .7 }}>
              Press <b>ESC</b> or click "Back to Game" to close this manual.
            </div>
          </div>
        </div>
      )}

      {/* Opponent-left overlay */}
      {error === "Your opponent has left the game." && (
        <div className="opponent-left-overlay" style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.7)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#222", color: "#fff", padding: "32px 40px", borderRadius: 16, boxShadow: "0 2px 16px #000", textAlign: "center" }}>
            <h2 style={{ marginBottom: 16 }}>Opponent left the game</h2>
            <p style={{ marginBottom: 24 }}>Your opponent has left. Start a new match to play again.</p>
            <button
              className="primary"
              style={{ fontSize: 18, padding: "10px 24px" }}
              onClick={() => resetToLanding(true)}
            >
              New Match
            </button>
          </div>
        </div>
      )}

      <div className="container" style={showManual ? { filter: "blur(2px)", pointerEvents: "none", userSelect: "none" } : {}}>
        <img
          src="/Logo.png"
          alt="Tic-Tac-Toe Logo"
          className="logo"
          style={{ cursor: "pointer" }}
          onClick={() => resetToLanding(true)}
        />

        <div className={`conn ${socketConnected ? "ok" : "bad"}`}>
          Socket: {socketConnected ? "connected" : "disconnected"}
        </div>

        {phase === "landing" && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', width: '100%' }}>
            <div className="card" style={{ width: '100%' }}>
              <h2>New Game</h2>
              <div className="join join--stack" style={{ marginBottom: 8 }}>
                <button className="primary" onClick={createGame}>Create Game</button>
              </div>

              <div className="divider">or</div>

              <h2>Join Game</h2>
              <div className="join">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CODE (e.g. A1B2C3)"
                  maxLength={8}
                  aria-label="Game code"
                />
                <button onClick={() => joinGame()}>Join</button>
                <button className="btn-secondary" onClick={watchGame}>Watch only</button>
              </div>
              {!!error && !error.startsWith("Invalid game code!") && !error.startsWith("This game code does not exist!") && (
                <div className="error">{error}</div>
              )}
              <div className="join" style={{ marginTop: 24, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                <label htmlFor="name-input" style={{ fontWeight: "bold", marginRight: 8, fontFamily: 'Press Start 2P, VT323, monospace', textAlign: 'center' }}>Name:</label>
                <input
                  id="name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  maxLength={24}
                  aria-label="Your name"
                />
              </div>
            </div>
          </div>
        )}

        {/* Waiting */}
        {phase === "waiting" && (
          <div className="card">
            <h2>Waiting for opponent …</h2>
            <div className="copy-row">
              <strong>Code:</strong> <code className="code">{code}</code>
              <button
                className="copy-btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >Copy</button>
              {copied && <span className="copy-feedback">Copy!</span>}
            </div>
            <p>Share this code with your opponent.</p>
            <div className="qr-code">
              {code && (
                <>
                  <QRCodeSVG
                    value={`${window.location.origin}?code=${code}`}
                    size={128}
                  />
                  <p>Scan this QR code to join the game!</p>
                </>
              )}
            </div>

            {mySymbol && <p>You are: <strong>{mySymbol}</strong></p>}
            <div className="playersbar" style={{ marginTop: 8 }}>
              <span className="pair"><span className="pill pill--X">X</span>&nbsp;{players.X || "?"}</span>
              <span className="sep">·</span>
              <span className="pair"><span className="pill pill--O">O</span>&nbsp;{players.O || "?"}</span>
            </div>
            <div className="audience">Spectators: <strong>{spectatorCount}</strong></div>
          </div>
        )}

        {/* Playing / Over */}
        {(phase === "playing" || phase === "over") && (
          <div className="game">
            <div className="top">
              <div>Code: <code className="code">{code}</code></div>

              {/* Role display */}
              <div className="role">
                {spectating ? (
                  <span className="badge badge--spectator" title="Spectator mode">Spectator</span>
                ) : (
                  <>
                    You are: {mySymbol && <> &nbsp;(<span className={`pill pill--${mySymbol}`}>{mySymbol}</span>)</>}
                  </>
                )}
              </div>
            </div>

            {/* Players visible to everyone */}
            <div className="playersbar">
              <span className="pair"><span className="pill pill--X">X</span>&nbsp;{players.X || "?"}</span>
              <span className="sep">·</span>
              <span className="pair"><span className="pill pill--O">O</span>&nbsp;{players.O || "?"}</span>
            </div>

            {/* Spectator count */}
            <div className="audience">Spectators: <strong>{spectatorCount}</strong></div>

            <Board
              board={board}
              onMove={makeMove}
              disabled={phase !== "playing" || spectating || !myTurn}
            />

            <div className="status">
              {phase === "playing" && (
                <p>
                  {spectating ? "You are watching." : myTurn ? "Your turn." : "Opponent's turn."}
                  {" "} (Next: <strong>{next}</strong>)
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

            {/* Cheer section for spectators */}
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
                <button onClick={rematch} disabled={rematchDeclined}>Rematch</button>
              )}
              <button
                onClick={() => resetToLanding(true)}
                className="btn-ghost"
              >
                New Match
              </button>
            </div>
          </div>
        )}

        {/* Rematch menu overlay: appears if opponent requests OR if draw */}
        {(rematchRequested && phase !== "playing") || (phase === "over" && draw) ? (
          <div className="rematch-menu-overlay">
            <div className="rematch-menu">
              <h3>Rematch?</h3>
              <p>{rematchRequested ? "Your opponent wants a rematch!" : "It's a draw! Want to play again?"}</p>
              <div className="actions">
                <button className="primary" onClick={acceptRematch}>Accept</button>
                <button onClick={() => {
                  if (code) socket.emit("decline_rematch", { code });
                  setRematchRequested(false);
                  setRematchPending(false);
                  setDraw(false);
                  resetToLanding(false);
                }}>Decline</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Rematch pending overlay */}
        {rematchPending && phase !== "playing" && (
          <div className="rematch-menu-overlay">
            <button className="rematch-cancel-btn" title="Cancel" onClick={() => { setRematchPending(false); setError(""); }}>&#10005;</button>
            <div className="rematch-menu">
              <h3>Rematch Requested</h3>
              <p>Waiting for opponent to accept…</p>
            </div>
          </div>
        )}

        {/* Error overlays */}
        {error && error.startsWith("This game code does not exist!") && (
          <div className="error-overlay" style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.7)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#222", color: "#fff", padding: "32px 40px", borderRadius: 16, boxShadow: "0 2px 16px #000", textAlign: "center" }}>
              <h2 style={{ marginBottom: 16 }}>Game Code Not Found</h2>
              <p style={{ marginBottom: 24 }}>This code does not exist.<br />Please check the code and try again.<br />Codes are usually a mix of letters and numbers (e.g. <b>A1B2C3</b>).</p>
              <button className="primary" style={{ fontSize: 18, padding: "10px 24px" }} onClick={() => setError("")}>OK</button>
            </div>
          </div>
        )}
        {error && error.startsWith("Invalid game code!") && (
          <div className="error-overlay" style={{ position:"fixed", top:0, left:0, width:"100vw", height:"100vh", background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:"#222", color:"#fff", padding:"32px 40px", borderRadius:16, boxShadow:"0 2px 16px #000", textAlign:"center" }}>
              <h2 style={{ marginBottom:16 }}>Invalid Game Code</h2>
              <p style={{ marginBottom:24 }}>Please enter a valid code with at least 4 characters.<br/>Codes are usually a mix of letters and numbers (e.g. <b>A1B2C3</b>).</p>
              <button className="primary" style={{ fontSize:18, padding:"10px 24px" }} onClick={() => setError("")}>OK</button>
            </div>
          </div>
        )}

        {/* Generic error inline */}
        {error &&
          !error.startsWith("Invalid game code!") &&
          !error.startsWith("This game code does not exist!") &&
          error !== "Your opponent has left the game." &&
          error !== "cheer_rate_limited" && (
            <div className="error">{error}</div>
          )}
      </div>
    </div>
  );
}
