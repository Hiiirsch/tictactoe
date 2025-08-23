// src/logic/gameLogic.js

export function makeMove(state, index) {
  if (state.winner || state.board[index] !== null) return state;

  const newBoard = [...state.board];
  newBoard[index] = state.currentPlayer;

  const winner = checkWinner(newBoard);

  return {
    board: newBoard,
    currentPlayer: state.currentPlayer === "X" ? "O" : "X",
    winner: winner,
  };
}

export function checkWinner(board) {
  const winningLines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of winningLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // "X" oder "O"
    }
  }

  if (board.every((cell) => cell !== null)) {
    return "draw";
  }

  return null;
}

export function getInitialState() {
  return {
    board: Array(9).fill(null),
    currentPlayer: "X",
    winner: null,
  };
}
