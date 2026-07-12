"use client";

import { useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";

const SERVER_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1"
).replace(/\/api\/v1\/?$/, "");

export default function SocketClient() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const teardown = () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };

    const setup = () => {
      const token = localStorage.getItem("authToken");
      if (!token) return;
      if (socketRef.current?.connected) return;

      teardown();

      const socket = io(SERVER_BASE, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 15,
        reconnectionDelay: 1000,
      });

      // Relay new-notification so organiser dashboard can update the bell badge instantly
      socket.on("new-notification", (data: unknown) => {
        window.dispatchEvent(new CustomEvent("kk-new-notification", { detail: data }));
      });

      // Game count changed → relay so organiser dashboard can patch counts instantly
      socket.on(
        "game-update",
        (data: { gameId: string; spotsRemaining: number; totalSlots: number }) => {
          window.dispatchEvent(new CustomEvent("kk-game-update", { detail: data }));
        },
      );

      socketRef.current = socket;
    };

    setup();

    const onStorage = (e: StorageEvent) => {
      if (e.key !== "authToken") return;
      if (e.newValue) setup();
      else teardown();
    };

    const onAuthChanged = () => {
      const token = localStorage.getItem("authToken");
      if (token) setup();
      else teardown();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("kk-auth-changed", onAuthChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("kk-auth-changed", onAuthChanged);
      teardown();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
