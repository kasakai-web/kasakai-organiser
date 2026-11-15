"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

import { shareLinkFor, type ShareableGame } from "@/utils/gameLink";
import { copyText } from "@/utils/clipboard";

/**
 * Copy the link a player opens to join this game — the same link the player
 * app's own "Copy Link" gives, so the organiser no longer has to go there to
 * fetch it. A private game shares its invite link instead (see shareLinkFor).
 *
 * When there is nothing to share yet (a private game whose invite link is off),
 * the button says so and, given `onFixLink`, opens the Invite panel where the
 * link is turned on — rather than copying something that would not let anyone in.
 */
export function CopyGameLinkButton({
  game,
  variant = "card",
  onFixLink,
}: {
  game: ShareableGame;
  variant?: "card" | "header";
  onFixLink?: () => void;
}) {
  const link = shareLinkFor(game);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Closed games have nothing to join — no button at all.
  if (link.url === null && !link.fixable) return null;
  // Private and not shareable, and this viewer cannot turn the link on.
  if (link.url === null && !onFixLink) return null;

  const flash = (s: "copied" | "failed") => {
    setState(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), s === "copied" ? 2200 : 4000);
  };

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (link.url === null) { onFixLink?.(); return; }
    flash((await copyText(link.url)) ? "copied" : "failed");
  };

  const title = link.url === null
    ? `${link.reason} Click to open Invite and turn it on.`
    : link.kind === "invite"
      ? `Copy this private game's invite link:\n${link.url}`
      : `Copy the game link to share with players:\n${link.url}`;

  const label = link.url === null
    ? "Get link"
    : state === "copied" ? "Copied!" : state === "failed" ? "Copy failed" : link.kind === "invite" ? "Copy invite link" : "Copy link";

  const Icon = state === "copied" ? Check : link.url === null ? Share2 : Link2;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={label}
        className={variant === "header"
          ? `pdm-hdr-btn pdm-hdr-link${state === "copied" ? " is-copied" : ""}`
          : `copy-link-btn${state === "copied" ? " is-copied" : ""}${link.url === null ? " is-fix" : ""}`}
      >
        <Icon size={variant === "header" ? 13 : 15} aria-hidden="true" className={variant === "header" ? "pdm-btn-icon" : undefined} />
        <span className={variant === "header" ? "pdm-btn-label" : undefined}>{variant === "header" ? ` ${label}` : label}</span>
      </button>
      {/* If the copy itself failed (locked-down browser), show the link so it can
          still be long-pressed and copied by hand. */}
      {state === "failed" && link.url && (
        <input
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          className="copy-link-fallback"
          aria-label="Game link"
          autoFocus
        />
      )}
    </>
  );
}
