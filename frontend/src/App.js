import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import Confetti from "react-confetti";
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
  // Manual page
  const [showManual, setShowManual] = useState(false);
  // Initialisiere States VOR useEffect, damit sie nicht undefined sind
  const [phase, setPhase] = useState("landing"); // landing | waiting | playing | over
  const [winner, setWinner] = useState(null);
  const [mySymbol, setMySymbol] = useState(null); // "X" | "O"
  // Lautstärke-States
  const [showVolumeMenu, setShowVolumeMenu] = useState(false);
  // Load volume from localStorage if available
  const [musicVolume, setMusicVolume] = useState(() => {
    const v = localStorage.getItem("musicVolume");
    return v !== null ? Number(v) : 0.25;
  });
  const [effectVolume, setEffectVolume] = useState(() => {
    const v = localStorage.getItem("effectVolume");
    return v !== null ? Number(v) : 0.7;
  });
  // Rematch UI state (must be before useEffect)
  const [rematchRequested, setRematchRequested] = useState(false); // opponent requested a rematch
  const [rematchPending, setRematchPending] = useState(false);     // I have requested a rematch
  const [rematchDeclined, setRematchDeclined] = useState(false);   // opponent declined rematch
  // Keyboard shortcuts for menus
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key.toLowerCase() === 'm') {
        setShowVolumeMenu((v) => !v);
      }
      if (e.key === 'Escape') {
        if (showManual) setShowManual(false);
        if (rematchPending && phase !== 'playing') {
          setRematchPending(false);
          setError("");
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showManual, rematchPending, phase]);
  // Audio-Refs
  const victoryRef = React.useRef(null);
  const gameoverRef = React.useRef(null);
  const bgMusicRef = React.useRef(null);
  // Soundeffekte bei Spielende
  useEffect(() => {
    if (phase === "over" && winner) {
      if (winner === mySymbol && victoryRef.current) {
        victoryRef.current.currentTime = 0;
        victoryRef.current.volume = effectVolume;
        victoryRef.current.play();
      } else if (winner !== mySymbol && gameoverRef.current) {
        gameoverRef.current.currentTime = 0;
        gameoverRef.current.volume = effectVolume;
        gameoverRef.current.play();
      }
      // stop Music
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current.currentTime = 0;
      }
    }
    // start Music
    if (phase === "playing" && bgMusicRef.current) {
      bgMusicRef.current.volume = musicVolume;
      bgMusicRef.current.loop = true;
      bgMusicRef.current.play();
    }
    // stop Music 
    if ((phase === "landing" || phase === "waiting") && bgMusicRef.current) {
      bgMusicRef.current.pause();
      bgMusicRef.current.currentTime = 0;
    }
  }, [phase, winner, mySymbol, musicVolume, effectVolume]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [copied, setCopied] = useState(false); // Feedback für Copy-Button
  const socket = useMemo(() => {
    // same origin; Nginx routes /socket.io/ to the backend
    return io("/", { path: "/socket.io/", transports: ["websocket"] });
  }, []);

  const [code, setCode] = useState("");
  const [board, setBoard] = useState(emptyBoard);
  const [next, setNext] = useState("X");
  const [draw, setDraw] = useState(false);
  const [error, setError] = useState("");


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
      setRematchDeclined(false);
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
      setRematchDeclined(false);
    });

    socket.on("error", ({ message }) => {
      if (message === "invalid_code") {
        setError("This game code does not exist! Please check the code and try again.");
      } else {
        setError(message || "Unknown error");
      }
    });

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

    // NEW: opponent declined rematch
    socket.on("rematch_declined", () => {
      setRematchPending(false);
      setRematchDeclined(true);
      setError("Opponent declined the rematch.");
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
      setError("❌ Invalid game code! Please enter a code with at least 4 characters.");
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
    setRematchDeclined(false);
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
    setRematchDeclined(false);
  }

  const myTurn = phase === "playing" && mySymbol === next;

  return (
    <div style={{position: "relative", width: "100%"}}>
      {/* Manual button, only visible if no overlay menu is shown */}
      {(phase === "landing" || phase === "waiting" || phase === "playing" || phase === "over") &&
        !((rematchRequested && phase !== "playing") || (phase === "over" && draw) || (rematchPending && phase !== "playing")) && (
        <button
          className="primary manual-btn"
          style={{position: "fixed", top: 18, right: 18, zIndex: 200, fontSize: 14, padding: "8px 16px"}}
          onClick={() => setShowManual((v) => !v)}
        >{showManual ? "Back to Game" : "Manual"}</button>
      )}
      {/* Lautstärke-Menü */}
      {showVolumeMenu && (
        <div className="volume-menu">
          <h3>🔊 Lautstärke</h3>
          <div className="volume-row">
            <label>Musik</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
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
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effectVolume}
              onChange={e => {
                setEffectVolume(Number(e.target.value));
                localStorage.setItem("effectVolume", e.target.value);
              }}
            />
            <span>{Math.round(effectVolume * 100)}%</span>
          </div>
          <div style={{fontSize:12, marginTop:8, opacity:.7}}>Menü mit Taste <b>M</b> öffnen/schließen</div>
        </div>
      )}
      {/* Audio-Elemente für Sounds und Musik */}
      <audio ref={victoryRef} src="/victory.wav" preload="auto" />
      <audio ref={gameoverRef} src="/gameover.wav" preload="auto" />
      <audio ref={bgMusicRef} src="/bgmusic.wav" preload="auto" />
      {/* Hintergrund-Animationen als festen Container mit niedrigem zIndex */}
      <div className="background-animations">
        {(phase === "over" && winner === mySymbol) && (
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            numberOfPieces={600}
            gravity={0.5}
            initialVelocityY={20}
            recycle={true}
          />
        )}
        {(phase === "over" && winner && winner !== mySymbol) && (
          <div className="shake-bg" />
        )}
      </div>

      {/* Manual page as overlay, only in main/game phases */}
      {showManual && (phase === "landing" || phase === "waiting" || phase === "playing" || phase === "over") && (
        <div className="manual-overlay">
          <div className="manual-card">
            <h2>- How to Play- </h2>
            <ul style={{textAlign: "left", maxWidth: 420, margin: "0 auto", fontSize: "1.05rem", lineHeight: "1.7"}}>
              <li>This is classic Tic-Tac-Toe for 2 players.</li>
              <li>One player is <b>X</b>, the other is <b>O</b>.</li>
              <li>Players take turns marking a cell on the 3x3 board.</li>
              <li>The first to get 3 in a row, column, or diagonal wins.</li>
              <li>If all cells are filled and nobody has 3 in a row, the game ends in a draw.</li>
              <li>Use the "Rematch" button to request a new round.</li>
              <li>Use "New Match" to generate a new game code.</li>
              <li>Adjust volume with <b>M</b> (menu at top right).</li>
              <li>Arcade sounds and animations create a true retro feeling!</li>
            </ul>
            <div style={{marginTop: 18, fontSize: 12, opacity: .7}}>Press <b>ESC</b> or click "Back to Game" to close this manual.</div>
          </div>
        </div>
      )}
      {/* Opponent left overlay: blocks interaction until new match */}
      {error === "Your opponent has left the game." && (
        <div className="opponent-left-overlay" style={{position: "fixed", top:0, left:0, width:"100vw", height:"100vh", background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center"}}>
          <div style={{background:"#222", color:"#fff", padding:"32px 40px", borderRadius:16, boxShadow:"0 2px 16px #000", textAlign:"center"}}>
            <h2 style={{marginBottom:16}}>Opponent left the game</h2>
            <p style={{marginBottom:24}}>Your opponent has left. Start a new match to play again.</p>
            <button className="primary" style={{fontSize:18, padding:"10px 24px"}} onClick={() => {
              setPhase("landing");
              setBoard(emptyBoard);
              setWinner(null);
              setDraw(false);
              setMySymbol(null);
              setNext("X");
              setRematchRequested(false);
              setRematchPending(false);
              setError("");
            }}>New Match</button>
          </div>
        </div>
      )}
      <div className="container" style={showManual ? {filter: "blur(2px)", pointerEvents: "none", userSelect: "none"} : {}}>
        <img
          src="/Logo.png"
          alt="Tic-Tac-Toe Logo"
          className="logo"
          style={{cursor: "pointer"}}
          onClick={() => {
            if (code) socket.emit("new_match", { code });
            setPhase("landing");
            setBoard(emptyBoard);
            setWinner(null);
            setDraw(false);
            setMySymbol(null);
            setNext("X");
            setRematchRequested(false);
            setRematchPending(false);
            setError("");
          }}
        />
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
              {copied && (
                <span className="copy-feedback">Copy!</span>
              )}
            </div>
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
              {phase === "over" && <button onClick={rematch} disabled={rematchDeclined}>Rematch</button>}
              <button onClick={() => {
                if (code) socket.emit("new_match", { code });
                setPhase("landing");
                setBoard(emptyBoard);
                setWinner(null);
                setDraw(false);
                setMySymbol(null);
                setNext("X");
                setRematchRequested(false); 
                setRematchPending(false);   
                setRematchDeclined(false);
                setError("");
              }}>New Match</button>
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
                  setDraw(false);
                  setError("");
                  setPhase("landing");
                  setBoard(emptyBoard);
                  setWinner(null);
                  setMySymbol(null);
                  setNext("X");
                  setRematchPending(false);
                }}>Decline</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Rematch pending menu as overlay, can be cancelled with ESC or X */}
        {rematchPending && phase !== "playing" && (
          <div className="rematch-menu-overlay">
            <button className="rematch-cancel-btn" title="Cancel" onClick={() => { setRematchPending(false); setError(""); }}>&#10005;</button>
            <div className="rematch-menu">
              <h3>Rematch Requested</h3>
              <p>Waiting for opponent to accept…</p>
            </div>
          </div>
        )}

        {/* Error overlay for invalid code from backend */}
        {error && error.startsWith("This game code does not exist!") && (
          <div className="error-overlay" style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.7)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:"#222",color:"#fff",padding:"32px 40px",borderRadius:16,boxShadow:"0 2px 16px #000",textAlign:"center"}}>
              <h2 style={{marginBottom:16}}>Game Code Not Found</h2>
              <p style={{marginBottom:24}}>This code does not exist.<br/>Please check the code and try again.<br/>Codes are usually a mix of letters and numbers (e.g. <b>A1B2C3</b>).</p>
              <button className="primary" style={{fontSize:18,padding:"10px 24px"}} onClick={()=>setError("")}>OK</button>
            </div>
          </div>
        )}
        {/* Error overlay for invalid code (client-side) */}
        {error && error.startsWith("Invalid game code!") && (
          <div className="error-overlay" style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.7)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:"#222",color:"#fff",padding:"32px 40px",borderRadius:16,boxShadow:"0 2px 16px #000",textAlign:"center"}}>
              <h2 style={{marginBottom:16}}>Invalid Game Code</h2>
              <p style={{marginBottom:24}}>Please enter a valid code with at least 4 characters.<br/>Codes are usually a mix of letters and numbers (e.g. <b>A1B2C3</b>).</p>
              <button className="primary" style={{fontSize:18,padding:"10px 24px"}} onClick={()=>setError("")}>OK</button>
            </div>
          </div>
        )}
        {/* Other errors */}
        {error && !error.startsWith("Invalid game code!") && !error.startsWith("This game code does not exist!") && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
