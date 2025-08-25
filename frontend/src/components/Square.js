import React from 'react';
import './Square.css';

// the square component for the game board
function Square({ value, onClick }) {
  return (
    <button className="square" onClick={onClick}>
      {value}
    </button>
  );
}

export default Square;