import React, { useState } from 'react';
import './App.css';
import Board from './components/Board';
import { useGame } from './hooks/useGame';

// the start screen component
const StartScreen = ({ onStart }) => {
  const [roomCode, setRoomCode] = useState('');
  return (
    <div className="start-screen">
      <h1>Tic Tac Toe</h1>
      <input type="text" placeholder="Dein Name" />
      <div className="button-group">
        <button onClick={() => onStart('newGame')}>Neues Spiel erstellen</button>
      </div>
      <div className="join-group">
        <input
          type="text"
          placeholder="Spielcode"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
        />
        <button onClick={() => onStart('joinGame')}>Beitreten</button>
      </div>
    </div>
  );
};

// The main app component
const App = () => {
  const [gameState, setGameState] = useState('start');
  const [board, setBoard] = useState(Array(9).fill(null));
  const [winner, setWinner] = useState(null);
  const { gameCode } = useGame();

  const handleStateChange = (state) => {
    switch (state) {
      case 'newGame':
      case 'joinGame':
        setGameState('playing');
        break;
      case 'move':
        // Simuliert einen Zug auf dem Board
        const newBoard = [...board];
        const emptyIndex = newBoard.indexOf(null);
        if (emptyIndex !== -1) {
          newBoard[emptyIndex] = 'X';
          setBoard(newBoard);
          if (newBoard.filter(val => val !== null).length === 3) {
            setWinner('X');
            setGameState('game_over');
          }
        }
        break;
      case 'restart':
        setGameState('start');
        setBoard(Array(9).fill(null));
        setWinner(null);
        break;
      default:
        break;
    }
  };

  const renderContent = () => {
    if (gameState === 'start') {
      return <StartScreen onStart={handleStateChange} />;
    }

    return (
      <div className="game-container" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 10, right: 20, padding: '8px', fontWeight: 'bold', fontSize: '1.1em', background: 'rgba(255,255,255,0.8)', borderRadius: '8px' }}>
          Spielcode: {gameCode}
        </div>
        <h1>{winner ? `Gewinner: ${winner}` : 'Tic Tac Toe'}</h1>
        <Board board={board} onMove={(index) => {
          const newBoard = [...board];
          if (newBoard[index] === null) {
            newBoard[index] = 'X';
            setBoard(newBoard);
            if (newBoard.filter(val => val !== null).length === 3) {
              setWinner('X');
              setGameState('game_over');
            }
          }
        }} />
        <div className="status-area">
          {winner && <button onClick={() => handleStateChange('restart')}>Neues Spiel</button>}
        </div>
      </div>
    );
  };

  return <div className="app">{renderContent()}</div>;
};

export default App;