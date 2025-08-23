import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const [joinCode, setJoinCode] = useState("");
  const navigate = useNavigate();

  // Vierstelligen Zahlencode generieren
  function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 1000-9999
  }

  function handleStart() {
    const roomCode = generateRoomCode();
    navigate(`/room/${roomCode}?host=true`);
  }

  function handleJoin() {
    if (joinCode.trim() === "" || joinCode.length !== 4) return;
    navigate(`/room/${joinCode}?host=false`);
  }

  return (
    <div style={{ textAlign: "center", marginTop: "100px" }}>
      <h1>Tic Tac Toe</h1>
      <button
        onClick={handleStart}
        style={{ padding: "12px 24px", fontSize: "18px", margin: "12px" }}
      >
        Neues Spiel starten
      </button>

      <div style={{ marginTop: "20px" }}>
        <input
          type="text"
          placeholder="Raum-Code eingeben"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          maxLength={4}
          style={{ padding: "8px", fontSize: "16px", width: "80px", marginRight: "8px" }}
        />
        <button
          onClick={handleJoin}
          style={{ padding: "8px 16px", fontSize: "16px" }}
        >
          Beitreten
        </button>
      </div>
    </div>
  );
}
