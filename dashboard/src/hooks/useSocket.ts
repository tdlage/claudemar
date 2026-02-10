import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";

export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const wrappedHandler = (data: T) => handlerRef.current(data);
    socket.on(event, wrappedHandler);
    return () => {
      socket.off(event, wrappedHandler);
    };
  }, [event]);
}

export function useSocketRoom(room: string): void {
  useEffect(() => {
    const socket = getSocket();
    socket.emit(`subscribe:${room.split(":")[0]}`, room.split(":").slice(1).join(":"));
    return () => {
      socket.emit(`unsubscribe:${room.split(":")[0]}`, room.split(":").slice(1).join(":"));
    };
  }, [room]);
}
