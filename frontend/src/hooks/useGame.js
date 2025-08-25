import { useState } from 'react';

export function useGame() {
  const [gameCode] = useState(() => Math.random().toString(36).substr(2, 6).toUpperCase());
  return { gameCode };
}
