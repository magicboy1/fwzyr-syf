import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      transports: ["websocket", "polling"],
      path: "/socket.io",
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function emitWithAck<T = any>(event: string, data: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    s.emit(event, data, (response: T) => {
      resolve(response);
    });
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
}
