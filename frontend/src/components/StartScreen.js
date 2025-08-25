import React, { useState } from 'react';

// the start screen component
function StartScreen({ onJoinGame, onCreateGame }) {
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');

  return (
    <div className="start-screen">
      <h1>Tic Tac Toe</h1>
      <input
        type="text"
        placeholder="Dein Name"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
      />
      
      <div className="button-group">
        <button onClick={() => onCreateGame(playerName)}>
          Neues Spiel erstellen
        </button>
      </div>

      <div className="join-group">
        <input
          type="text"
          placeholder="Spielcode"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
        />
        <button onClick={() => onJoinGame(playerName, roomCode)}>
          Beitreten
        </button>
      </div>
    </div>
  );
}

export default StartScreen;