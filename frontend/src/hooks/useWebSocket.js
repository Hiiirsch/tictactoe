import { useEffect, useRef } from "react";

export function useWebSocket(onMessage) {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:5010"); // Adresse deines WS-Servers
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket verbunden");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    socket.onclose = () => {
      console.log("WebSocket getrennt");
    };

    return () => socket.close();
  }, [onMessage]);

  function sendMessage(message) {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  return { sendMessage };
}
