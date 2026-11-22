"use client";

import { useEffect, useRef } from "react";

// While `open`, the phone's Back button closes this sheet instead of leaving the
// page. On Android the system Back gesture is how people dismiss anything that
// looks like a screen, and a full-screen picker that answers Back by throwing
// away the whole page — and the twelve players just ticked — is the one thing
// this UI must not do.
//
// How: opening pushes one history entry tagged with this sheet's token; Back pops
// it and we close. Closing from the UI (✕, Done, a save) pops the entry we pushed,
// so history is left as it was. Next.js integrates native pushState (see the
// "Native History API" guide in node_modules/next/dist/docs), and the entry
// carries Next's own state forward, so popping it is a no-op for the router.
//
// Sheets stack (picker → tag editor). On Back, every open sheet ABOVE the entry
// we landed on closes. Tokens rather than depth numbers, because an entry left
// behind by an earlier navigation still carries a marker — a number would make a
// later sheet think it was already below the line and refuse to close.
//
// The push is deferred a tick so React's dev-mode double mount (mount → cleanup →
// mount) cancels the first push instead of leaving a stray entry behind.

const open: string[] = []; // tokens of the open sheets, bottom → top
let leaving = false;
let seq = 0;

/**
 * Call right before router.push() from inside (or just after closing) a sheet:
 * the closing sheet must NOT pop its entry then, or that back() lands after the
 * navigation and takes the organiser straight back to where they came from.
 */
export function leaveSheets() {
  leaving = true;
}

type SheetState = { kkSheet?: string } & Record<string, unknown>;
const currentToken = () => (window.history.state as SheetState | null)?.kkSheet;

export function useBackToClose(isOpen: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    if (open.length === 0) leaving = false;
    const token = `s${Date.now().toString(36)}-${++seq}`;
    open.push(token);
    let pushed = false;
    let poppedByBack = false;

    const timer = window.setTimeout(() => {
      const state = (window.history.state || {}) as SheetState;
      window.history.pushState({ ...state, kkSheet: token }, "");
      pushed = true;
    }, 0);

    const onPop = () => {
      const landedAt = open.indexOf(currentToken() || "");
      if (open.indexOf(token) > landedAt) {
        poppedByBack = true;
        closeRef.current();
      }
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      const at = open.indexOf(token);
      if (at >= 0) open.splice(at, 1);
      // Closed from the UI: take back the entry we added — but only if it is
      // still the one on top. After a navigation it is not, and is left alone.
      if (pushed && !poppedByBack && !leaving && currentToken() === token) window.history.back();
      if (open.length === 0) leaving = false;
    };
  }, [isOpen]);
}
