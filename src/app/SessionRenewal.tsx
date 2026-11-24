"use client";

import { useEffect } from "react";
import { renewSessionIfStale } from "@/utils/sessionRenewal";

/** How often an open tab re-checks its token's age. The check itself is local. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Keeps the login alive while the app is used (utils/sessionRenewal.ts). Mounted
 * once in the root layout. Checks on open, when the tab comes back into view,
 * when the connection returns, and hourly for a tab left open for days.
 */
export default function SessionRenewal() {
  useEffect(() => {
    const check = () => { void renewSessionIfStale(); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    window.addEventListener("kk-auth-changed", check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
      window.removeEventListener("kk-auth-changed", check);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
