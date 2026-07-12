"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getSession } from "@/utils/api";

const SERVER_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1"
).replace(/\/api\/v1\/?$/, "");

export interface IncomingNotification {
  _id: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string | null;
  createdAt: string;
  isRead: boolean;
}

/**
 * Opens a Socket.io connection authenticated with the user's JWT and calls
 * `onNotification` whenever a `new-notification` event arrives.
 *
 * The socket is created once per mount and cleaned up on unmount.
 */
export function useNotificationSocket(
  onNotification: (n: IncomingNotification) => void
) {
  const socketRef = useRef<Socket | null>(null);
  // Keep a stable ref to the callback so we never need to reconnect when it changes.
  const cbRef = useRef(onNotification);
  useEffect(() => { cbRef.current = onNotification; }, [onNotification]);

  const connect = useCallback(() => {
    const { token } = getSession();
    if (!token || socketRef.current) return;

    const socket = io(SERVER_BASE, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    socket.on("connect", () => {
      console.log("[SOCKET] Connected:", socket.id);
    });

    socket.on("connect_error", (err) => {
      console.warn("[SOCKET] Connection error:", err.message);
    });

    socket.on("new-notification", (n: IncomingNotification) => {
      cbRef.current(n);
    });
    socketRef.current = socket;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);
}
