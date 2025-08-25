import React from 'react';
import Square from './Square';
import './Board.css'; 

// the game board component
function Board({ board, onMove }) {
  const renderSquare = (index) => {
    return (
      <Square
        key={index}
        value={board[index]}
        onClick={() => onMove(index)}
      />
    );
  };

  return (
    <div className="board">
      {Array(9).fill(null).map((_, index) => renderSquare(index))}
    </div>
  );
}

export default Board;