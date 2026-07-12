"use client";
import { useEffect, useRef } from "react";

interface Options {
  /** How often to poll in milliseconds. Default 20 000 (20 s). 0 = disabled. */
  interval?: number;
  /** Refetch when the browser window regains focus. Default true. */
  onFocus?: boolean;
  /** Refetch when the browser tab becomes visible again. Default true. */
  onVisible?: boolean;
  /** Set false to pause all auto-refresh (e.g. not yet authenticated). */
  enabled?: boolean;
}

/**
 * Silently re-runs `callback` on a poll interval, on window focus, and when
 * the page becomes visible after being hidden (tab-switch, minimise, etc.).
 *
 * Uses a ref internally so the interval/event handlers always call the *latest*
 * version of the callback — no need to manage deps manually at the call site.
 */
export function useAutoRefresh(
  callback: (() => void | Promise<void>) | null,
  options: Options = {},
) {
  const {
    interval  = 20_000,
    onFocus   = true,
    onVisible = true,
    enabled   = true,
  } = options;

  // Always keep a ref to the latest callback so closures don't go stale
  const cbRef = useRef(callback);
  cbRef.current = callback;

  // Guard: only one in-flight call at a time
  const running = useRef(false);

  const run = () => {
    if (!cbRef.current || !enabled) return;
    if (running.current) return;
    running.current = true;
    Promise.resolve(cbRef.current()).finally(() => {
      running.current = false;
    });
  };

  // Polling interval
  useEffect(() => {
    if (!enabled || !callback || interval <= 0) return;
    const id = setInterval(run, interval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval]);

  // Window focus → immediate refetch
  useEffect(() => {
    if (!onFocus || !enabled) return;
    const handler = () => run();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFocus, enabled]);

  // Page-visibility change → refetch when tab becomes active again
  useEffect(() => {
    if (!onVisible || !enabled) return;
    const handler = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onVisible, enabled]);
}
