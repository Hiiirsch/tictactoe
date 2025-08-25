# TicTacToe React/Flask Project Documentation

## Project Structure
- **frontend/**: React app (UI)
- **backend/**: Flask app (API & WebSocket)
- **nginx/**: Proxy configuration

## How to Extend the Game Logic
### Frontend (React)
- The main UI logic is in `src/App.js`.
- The board is rendered via `src/components/Board.js` and `src/components/Square.js`.
- Game state is managed with React hooks (`useState`).
- To add game logic (e.g., win detection, player turns), extend the state and handlers in `App.js` and pass necessary props to `Board`.
- For multiplayer, use a custom hook (e.g., `useGame`) to manage room codes and game state.

### WebSocket Integration
- The backend uses Flask-SocketIO (`backend/app.py`).
- To connect the frontend, use a Socket.IO client (e.g., `socket.io-client` npm package).
- Example (in React):
  ```js
  import { useEffect } from 'react';
  import io from 'socket.io-client';
  const socket = io('http://localhost:5000');
  useEffect(() => {
    socket.on('connect', () => { /* handle connect */ });
    socket.on('game_update', (data) => { /* update board */ });
    return () => socket.disconnect();
  }, []);
  ```
- Use `socket.emit('move', { ... })` to send moves to the backend.

### Backend (Flask)
- Extend `backend/app.py` to handle game rooms, moves, and broadcast updates via SocketIO events.
- Example:
  ```python
  @socketio.on('move')
  def handle_move(data):
      # Update game state, emit to room
      emit('game_update', {...}, room=data['room'])
  ```

## How to Document Your Code
- Use English comments for all functions and important logic.
- Example:
  ```js
  // Handles a player move
  function handleMove(index) {
    // ...
  }
  ```
  ```python
  # Handles a player move event
  @socketio.on('move')
  def handle_move(data):
      # ...
  ```

## Getting Started
- Run `docker compose up --build` to start all services.
- Frontend: http://localhost (or configured port)
- Backend: http://localhost:5000
- Proxy: http://localhost (Nginx)

## Useful Links
- [React Docs](https://react.dev/)
- [Flask-SocketIO Docs](https://flask-socketio.readthedocs.io/en/latest/)
- [Socket.IO Client](https://socket.io/docs/v4/client-api/)

