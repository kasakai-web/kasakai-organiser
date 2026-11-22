"use client";

// A faded card in Upcoming Events for a recurring game that is planned but not
// created yet — mixed into the live games by date. There are no players, no
// roster and nothing to confirm until the game goes live, so the card carries
// what an organiser needs to decide whether to leave the date alone: when it
// goes live, whether anything will stop it, what it will be priced and sized
// at, and how this series' last few games actually went.
//
// Its Actions menu holds the per-date actions the Recurring page offers —
// Move, Edit this game, Create now, Cancel this date (a skip) — each reaching
// THIS occurrence only. Anything wider stays on the schedule itself, linked from
// the same menu.

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Calendar, CalendarClock, CalendarPlus, CalendarX, ChevronDown, Clock, ExternalLink, Lock, MapPin, Pause, Pencil,
  Repeat, TriangleAlert, Users, Ban, MoveRight,
} from "lucide-react";
import "./GameCard/GameCard.css";
import "./PlannedGameCard.css";
import type { PlannedGamePreview } from "@/utils/recurring";

const IST = "Asia/Kolkata";

const dateLine = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" }).toUpperCase();

const KNOWN_FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"];
const formatClass = (f: string) => (KNOWN_FORMATS.includes(f) ? `format-${f}` : "format-default");

const rupees = (paise: number) => `₹${((paise || 0) / 100).toLocaleString("en-IN")}`;

// "in 3 days" / "in 5 hours" — how far off going live is, which is what the
// organiser is reading the card for.
const fromNow = (iso: string, now: number) => {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "within the hour";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "within the hour";
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
};

const STATE_BOX: Record<PlannedGamePreview["goLiveState"], { label: string; icon: React.ReactNode }> = {
  scheduled: { label: "PLANNED", icon: <CalendarClock size={38} /> },
  due:       { label: "GOING LIVE", icon: <CalendarClock size={38} /> },
  paused:    { label: "PAUSED", icon: <Pause size={38} /> },
  blocked:   { label: "BLOCKED", icon: <Ban size={38} /> },
};

function goLiveLine(p: PlannedGamePreview, now: number): { text: string; tone: "info" | "warn" } {
  switch (p.goLiveState) {
    case "paused":
      return { text: "Schedule paused — this game will not be created until you resume it", tone: "warn" };
    case "blocked":
      return { text: "Held back by a clash — it will not be created until the conflict clears", tone: "warn" };
    case "due":
      return { text: "Goes live within the hour — opens for booking automatically", tone: "info" };
    default:
      return {
        text: `Goes live ${dateLine(p.goesLiveAt)}, ${clock(p.goesLiveAt)} (${fromNow(p.goesLiveAt, now)}) — opens for booking then`,
        tone: "info",
      };
  }
}

// One line on how the series has been doing — the number that says whether
// this date needs a bigger squad, a different price, or calling off.
function trackLine(t: PlannedGamePreview["track"]): string {
  if (!t || t.games === 0) return "No games played yet";
  const parts: string[] = [];
  if (t.avgFilled != null && t.avgSlots != null) parts.push(`avg ${t.avgFilled}/${t.avgSlots} filled`);
  if (t.fullCount) parts.push(`${t.fullCount} full`);
  if (t.cancelled) parts.push(`${t.cancelled} cancelled`);
  return parts.join(" · ");
}

interface Props {
  p: PlannedGamePreview;
  /** Where "Open schedule" goes — the Recurring page. Omitted, the link is left out. */
  scheduleHref?: string;
  isMenuOpen?: boolean;
  onToggleMenu?: () => void;
  /** While a change to this date is in flight. */
  busy?: boolean;
  onMove?: () => void;
  onEdit?: () => void;
  /** Create the real game now instead of waiting for it to go live on schedule. */
  onCreateNow?: () => void;
  onCancelDate?: () => void;
}

export function PlannedGameCard({
  p, scheduleHref, isMenuOpen = false, onToggleMenu, busy = false, onMove, onEdit, onCreateNow, onCancelDate,
}: Props) {
  // Read once per mount: "goes live in 3 days" does not need to tick, and the
  // clock must not be read during render.
  const [now] = useState(() => Date.now());
  const hasActions = !!(onToggleMenu && (onMove || onEdit || onCreateNow || onCancelDate || scheduleHref));

  // Same flip-up rule as GameCard: a menu that would run off the bottom of the
  // screen opens above the button instead.
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [openUpward, setOpenUpward] = useState(false);
  useLayoutEffect(() => {
    if (!isMenuOpen) { setOpenUpward(false); return; }
    const el = dropdownRef.current;
    if (el) setOpenUpward(el.getBoundingClientRect().bottom > window.innerHeight);
  }, [isMenuOpen]);
  const box = STATE_BOX[p.goLiveState] ?? STATE_BOX.scheduled;
  const live = goLiveLine(p, now);
  const venue = p.turf ? [p.turf.name, p.turf.area].filter(Boolean).join(", ") : "Venue not set";
  const seqLabel = p.series.total ? `Game ${p.seq} of ${p.series.total}` : `Game #${p.seq}`;

  const notes: { label: string; title: string; warn?: boolean }[] = [];
  if (p.isRescheduled) notes.push({ label: `Moved from ${dateLine(p.originalScheduledAt)} ${clock(p.originalScheduledAt)}`, title: "This date was moved off the schedule's usual time" });
  if (p.isCustomised) notes.push({ label: "Custom for this date", title: "Some settings on this date differ from the schedule's defaults" });
  if (p.isExtra) notes.push({ label: "Extra date", title: "Added by hand, outside the repeat rule" });
  if (p.requiresApproval) notes.push({ label: "Needs approval", title: "Players will need your approval to join" });
  if (!p.acceptsPasses) notes.push({ label: "No passes", title: "Pass holders will pay the full fee" });
  if (p.hostSpots > 0) notes.push({ label: `${p.hostSpots} host spot${p.hostSpots === 1 ? "" : "s"}`, title: "Held for your approved hosts" });
  if (p.organiserIsPlaying) notes.push({ label: "You're playing", title: "You take one of the spots" });

  return (
    <div
      className={`game-card planned-card ${p.goLiveState} ${isMenuOpen ? "menu-open" : ""} ${busy ? "busy" : ""}`}
      aria-busy={busy || undefined}
      aria-label={`Planned recurring game: ${p.title}, not live yet`}
    >
      <div className="status-bar planned" />

      <div className="game-left">
        <div className="status-box planned">
          {box.icon}
          <div className="status-pill">{box.label}</div>
        </div>

        <div className="game-details">
          <div className="title-row">
            <h3>{p.title}</h3>
            {p.visibility === "private" && <Lock size={17} />}
            <span className="planned-badge" title={p.series.description}>
              <Repeat size={11} /> {p.series.name} · {seqLabel}
            </span>
          </div>

          <div className="detail-row">
            <MapPin size={15} />
            <span>{venue}</span>
          </div>

          <div className="detail-row">
            <Calendar size={15} />
            <span>
              {dateLine(p.scheduledAt)} · {clock(p.scheduledAt)} – {clock(p.endsAt)}
            </span>
          </div>

          <div className={`detail-row planned-golive ${live.tone}`}>
            {live.tone === "warn" ? <TriangleAlert size={15} /> : <Clock size={15} />}
            <span>{live.text}</span>
          </div>

          {p.cutoffAt && (
            <div className="detail-row" title="Joins stop at this time only if the game is full by then">
              <Lock size={15} />
              <span>Roster locks {clock(p.cutoffAt)} if full</span>
            </div>
          )}

          {p.conflicts.map((c, i) => (
            <div key={i} className="detail-row planned-golive warn">
              <TriangleAlert size={15} />
              <span>{c.message}</span>
            </div>
          ))}

          {notes.length > 0 && (
            <div className="planned-notes">
              {notes.map((n) => (
                <span key={n.label} className="planned-note" title={n.title}>{n.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="game-stats">
        <div className="stat">
          <span>FORMAT</span>
          <div className={`badge ${formatClass(p.format)}`}>{p.format}</div>
          <small>{p.durationMins} min</small>
        </div>

        <div className="stat">
          <span>FEE</span>
          <strong>{p.feeInPaise > 0 ? rupees(p.feeInPaise) : "Free"}</strong>
        </div>

        <div className="stat">
          <span>SPOTS</span>
          <strong className="players">
            <Users size={16} />
            {p.totalSlots}
          </strong>
          {p.minPlayers > 0 && <small>min {p.minPlayers}</small>}
        </div>

        <div className="stat planned-track" title={`This schedule's last ${p.track?.games || 0} game(s) that have kicked off`}>
          <span>RECENT</span>
          <small>{trackLine(p.track)}</small>
        </div>
      </div>

      {hasActions && (
        <div className="game-actions">
          <button
            type="button"
            className={`action-btn ${isMenuOpen ? "active" : ""}`}
            onClick={onToggleMenu}
            disabled={busy}
            aria-expanded={isMenuOpen}
          >
            {busy ? "Saving…" : "Actions"}
            <ChevronDown size={16} className={isMenuOpen ? "rotate-icon" : ""} />
          </button>

          {isMenuOpen && (
            <div ref={dropdownRef} className={`actions-dropdown ${openUpward ? "dropdown-up" : ""}`}>
              {onMove && (
                <button onClick={onMove} className="planned-move-item" title="Move this date only — the rest of the schedule stays put">
                  <MoveRight size={16} />
                  Move
                </button>
              )}
              {onEdit && (
                <button onClick={onEdit} className="edit-item" title="Change settings for this date only">
                  <Pencil size={16} />
                  Edit this game
                </button>
              )}
              {onCreateNow && (
                <button onClick={onCreateNow} className="confirm-item" title="Create this game now and open it for booking, instead of waiting for it to go live">
                  <CalendarPlus size={16} />
                  Create now
                </button>
              )}
              {scheduleHref && (
                <Link href={scheduleHref} className="planned-menu-link" title="Open the recurring schedule this game belongs to">
                  <ExternalLink size={16} />
                  Open schedule
                </Link>
              )}
              {onCancelDate && (
                <button onClick={onCancelDate} className="danger-item" title="No game will be created on this date — you can restore it from the schedule">
                  <CalendarX size={16} />
                  Cancel this date
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PlannedGameCard;
