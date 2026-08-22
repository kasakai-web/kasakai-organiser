"use client";

import React, { useState, useEffect } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import { StarRating } from "@/components/ui/StarRating";
import { PlayerMultiSelect, type PlayerOption } from "@/components/ui/PlayerMultiSelect";
import "./PostGameModal.css";

// ── Types ──────────────────────────────────────────────────────────────────
export interface Registration {
  _id: string;
  player?: { _id: string; name: string; phone?: string; profileImage?: string };
  plusOneName?: string | null;
  attended?: "present" | "absent" | "not_marked";
}

export interface Game {
  _id: string;
  title: string;
  format: string;
  scheduledAt: string;
  turf?: { name?: string };
  registrations: Registration[];
  attendanceMarked?: boolean;
}

type AttendanceStatus = "present" | "absent";

// What we already know about this player, if this organiser has rated them before.
// A rating is a standing opinion revised over time, not a per-game score, so this
// is here to say "you have said this before" rather than to be edited.
export interface StandingSummary {
  gamesObserved: number;
  revision: number;
  lastRatedAt: string | null;
  lastRatedGameTitle: string | null;
  ratedInThisGame: boolean;
}

export interface PlayerRatingDraft {
  playerId: string;
  name: string;
  // null = NA. The backend drops a row with no stars rather than writing a
  // default, so an untouched player stays unrated.
  conductRating: number | null;
  gameplayRating: number | null;
  preferredPosition: string;
  gkAffinity: number | null;
  playWith: string[];
  playAgainst: string[];
  notes: string;
  team: "A" | "B" | null;
  existing: StandingSummary | null;
}

// GET /games/organisers/:id/player-ratings — one row per player in the game,
// carrying this organiser's standing opinion of them where there is one.
type PrefillRow = {
  playerId: string;
  name: string;
  profileImage?: string | null;
  team?: string | null;
  existing?: {
    conductRating?: number;
    gameplayRating?: number;
    preferredPosition?: string;
    gkAffinity?: number | null;
    playWith?: unknown;
    playAgainst?: unknown;
    notes?: string | null;
    gamesObserved?: number;
    revision?: number;
    lastRatedAt?: string | null;
    lastRatedGame?: { _id?: string; title?: string } | null;
    ratedInThisGame?: boolean;
  } | null;
};

type PrefillResponse = {
  success?: boolean;
  message?: string;
  data?: PrefillRow[];
};

interface Props {
  game: Game;
  onClose: () => void;
  onDone: () => void;
}

const POSITIONS = ["goalkeeper", "defender", "midfielder", "forward", "any"];

const IMG_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1").replace(/\/api\/v1\/?$/, "");

function PlayerAvatar({ name, profileImage }: { name: string; profileImage?: string }) {
  const [failed, setFailed] = React.useState(false);
  const text = (name || "P").substring(0, 2).toUpperCase();
  if (profileImage && !failed) {
    const src = profileImage.startsWith("http") ? profileImage : `${IMG_BASE}${profileImage}`;
    return (
      <span className="pgm-player-avatar" style={{ padding: 0, overflow: "hidden" }}>
        <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" }} onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="pgm-player-avatar">{text}</span>;
}

// Everyone who could be picked is already in the game, so this speaks in bare
// ids and lets the shared component do the rendering. The Player Ratings page
// uses the same component in its search mode, where ids alone would not be
// enough to draw a chip.
function PlayerDropdownSelect({
  variant,
  selectedIds,
  options,
  onToggle,
}: {
  variant: "with" | "against";
  selectedIds: string[];
  options: PlayerOption[];
  onToggle: (id: string) => void;
}) {
  return (
    <PlayerMultiSelect
      variant={variant}
      selected={options.filter((o) => selectedIds.includes(o.id))}
      options={options}
      onToggle={(opt) => onToggle(opt.id)}
    />
  );
}

// ── Main Optimized Modal ───────────────────────────────────────────────────
export function PostGameModal({ game, onClose, onDone }: Props) {
  const [step, setStep] = useState<"attendance" | "ratings" | "summary">("attendance");
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingRatings, setSavingRatings] = useState(false);
  const [error, setError] = useState("");
  const [ratings, setRatings] = useState<Record<string, PlayerRatingDraft>>({});
  // Which drafts the organiser has actually touched this session. Only these are
  // sent — re-posting a pre-filled row nobody edited would be a no-op on the
  // server and noise for the player.
  const [dirty, setDirty] = useState<Record<string, true>>({});
  const [loadingPrefill, setLoadingPrefill] = useState(true);

  const markDirty = (pid: string) => setDirty((prev) => (prev[pid] ? prev : { ...prev, [pid]: true }));

  // Pre-load existing attendance marks — map legacy no_show → absent
  useEffect(() => {
    const init: Record<string, AttendanceStatus> = {};
    for (const reg of game.registrations) {
      const s = reg.attended as string | undefined;
      if (s === "present") init[reg._id] = "present";
      else if (s === "absent" || s === "no_show") init[reg._id] = "absent";
      else init[reg._id] = "present";
    }
    setAttendance(init);
  }, [game]);

  // Load this organiser's standing ratings as soon as the modal opens, rather
  // than on the way out of the attendance step. Re-opening an already-rated game
  // must not force the organiser back through completing and re-saving
  // attendance just to see what they already said.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { token } = getSession();
      if (!token) { setLoadingPrefill(false); return; }
      try {
        const res = await fetch(
          buildApiUrl(`/api/v1/games/organisers/${game._id}/player-ratings`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = (await res.json()) as PrefillResponse;
        if (cancelled) return;
        if (!res.ok || !data.success) {
          // Silence here would look identical to "nobody has been rated yet",
          // which would invite the organiser to rate everyone a second time.
          setError(data.message || "Couldn't load your existing ratings — reload before rating.");
          return;
        }

        const drafts: Record<string, PlayerRatingDraft> = {};
        for (const row of data.data ?? []) {
          const e = row.existing;
          drafts[row.playerId] = {
            playerId:          row.playerId,
            name:              row.name,
            conductRating:     typeof e?.conductRating === "number" ? e.conductRating : 0,
            gameplayRating:    typeof e?.gameplayRating === "number" ? e.gameplayRating : 0,
            preferredPosition: e?.preferredPosition || "any",
            gkAffinity:        e?.gkAffinity ?? null,
            playWith:          Array.isArray(e?.playWith) ? e.playWith.map((x: unknown) => String(x)) : [],
            playAgainst:       Array.isArray(e?.playAgainst) ? e.playAgainst.map((x: unknown) => String(x)) : [],
            notes:             e?.notes || "",
            team:              row.team === "A" || row.team === "B" ? row.team : null,
            existing: e
              ? {
                gamesObserved:      e.gamesObserved ?? 0,
                revision:           e.revision ?? 1,
                lastRatedAt:        e.lastRatedAt ?? null,
                lastRatedGameTitle: e.lastRatedGame?.title ?? null,
                ratedInThisGame:    Boolean(e.ratedInThisGame),
              }
              : null,
          };
        }
        setRatings(drafts);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Couldn't load your existing ratings");
      } finally {
        if (!cancelled) setLoadingPrefill(false);
      }
    })();

    return () => { cancelled = true; };
  }, [game._id]);


  // ── Step 1: save attendance + complete game ──────────────────────────────
  const handleSaveAttendance = async () => {
    setSavingAttendance(true);
    setError("");
    const { token } = getSession();
    if (!token) { setSavingAttendance(false); return; }

    try {
      // 1. Complete the game (no-op if already completed)
      const completeRes = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${game._id}/complete`),
        { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }
      );
      const completeData = await completeRes.json();
      // Allow "already completed" gracefully
      if (!completeRes.ok && !completeData.message?.includes("already completed")) {
        setError(completeData.message || "Failed to complete game");
        setSavingAttendance(false);
        return;
      }

      // 2. Save attendance
      const attendancePayload = game.registrations.map((reg) => ({
        regId:  reg._id,
        status: attendance[reg._id] === "absent" ? "absent" : "present",
      }));

      const attRes = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${game._id}/attendance`),
        {
          method:  "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({ attendance: attendancePayload }),
        }
      );
      const attData = await attRes.json();
      if (!attRes.ok || !attData.success) {
        setError(attData.message || "Failed to save attendance");
        setSavingAttendance(false);
        return;
      }

      // Drafts are already loaded — the modal fetched them when it opened.
      setStep("ratings");
    } catch (e) {
      setError((e as Error).message || "An error occurred");
    } finally {
      setSavingAttendance(false);
    }
  };

  // ── Step 2: save ratings ─────────────────────────────────────────────────
  const handleSaveRatings = async () => {
    setSavingRatings(true);
    setError("");
    const { token } = getSession();
    if (!token) { setSavingRatings(false); return; }
    try {
      // Only what the organiser touched, or a player they had never rated. An
      // untouched pre-filled row carries no new information, and sending it would
      // tell the player they had been "rated" again for nothing.
      const payload = ratingList
        .filter((r) => dirty[r.playerId] || !r.existing)
        .map((r) => ({
          playerId:          r.playerId,
          conductRating:     r.conductRating,
          gameplayRating:    r.gameplayRating,
          preferredPosition: r.preferredPosition,
          gkAffinity:        r.gkAffinity ?? null,
          playWith:          r.playWith,
          playAgainst:       r.playAgainst,
          notes:             r.notes || null,
          team:              r.team ?? null,
        }));

      if (payload.length > 0) {
        const res = await fetch(
          buildApiUrl(`/api/v1/games/organisers/${game._id}/player-ratings`),
          {
            method:  "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body:    JSON.stringify({ ratings: payload }),
          }
        );
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data.message || "Failed to save ratings");
          setSavingRatings(false);
          return;
        }
      }
      // Go to summary step
      setStep("summary");
    } catch (e) {
      setError((e as Error).message || "An error occurred");
    } finally {
      setSavingRatings(false);
    }
  };

  const updateRating = (pid: string, field: keyof PlayerRatingDraft, value: string | number | null) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
    markDirty(pid);
  };

  // Team is a per-game assignment, not part of the standing opinion — but it still
  // has to reach the server, so touching it counts as a change worth sending.
  const assignTeam = (pid: string, team: "A" | "B" | null) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], team } }));
    markDirty(pid);
  };

  const autoSplitTeams = () => {
    const ids = ratingList.map((r) => r.playerId);
    const half = Math.ceil(ids.length / 2);
    setRatings((prev) => {
      const next = { ...prev };
      ids.forEach((pid, index) => {
        next[pid] = { ...next[pid], team: index < half ? "A" : "B" };
      });
      return next;
    });
    setDirty((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, true as const])) }));
  };

  const markAllPresent = () => {
    setAttendance((prev) => {
      const next: Record<string, AttendanceStatus> = {};
      for (const reg of game.registrations) {
        if (!reg.plusOneName && reg.player) {
          next[reg._id] = "present";
        } else {
          next[reg._id] = prev[reg._id] ?? "present";
        }
      }
      return next;
    });
  };

  const markAllAbsent = () => {
    setAttendance((prev) => {
      const next: Record<string, AttendanceStatus> = {};
      for (const reg of game.registrations) {
        if (!reg.plusOneName && reg.player) {
          next[reg._id] = "absent";
        } else {
          next[reg._id] = prev[reg._id] ?? "absent";
        }
      }
      return next;
    });
  };

  const [viewMode, setViewMode] = useState<"express" | "detailed">("express");
  const [selectedPlayerCardId, setSelectedPlayerCardId] = useState("all");

  const togglePlayerPreference = (
    pid: string,
    field: "playWith" | "playAgainst",
    targetId: string
  ) => {
    setRatings((prev) => {
      const current = prev[pid]?.[field] ?? [];
      const isAdding = !current.includes(targetId);
      const updated = isAdding
        ? [...current, targetId]
        : current.filter((x) => x !== targetId);

      const otherField = field === "playWith" ? "playAgainst" : "playWith";
      const otherCurrent = prev[pid]?.[otherField] ?? [];
      const otherUpdated = isAdding
        ? otherCurrent.filter((x) => x !== targetId)
        : otherCurrent;

      return {
        ...prev,
        [pid]: {
          ...prev[pid],
          [field]: updated,
          [otherField]: otherUpdated,
        },
      };
    });
    markDirty(pid);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const playerRegs = game.registrations.filter((r) => !r.plusOneName && r.player);
  const guestRegs = game.registrations.filter((r) => r.plusOneName);
  const attendedIds = Object.entries(attendance)
    .filter(([, s]) => s === "present")
    .map(([regId]) => regId);

  const attendedPlayers = playerRegs.filter((r) => attendedIds.includes(r._id));

  // Drafts are held for every player in the game so an attendance change never
  // discards an edit; the list on screen is whoever actually turned up. Nobody
  // the organiser has rated before goes first — they are the work.
  const presentPlayerIds = new Set(attendedPlayers.map((r) => r.player!._id));
  const ratingList = Object.values(ratings)
    .filter((r) => presentPlayerIds.has(r.playerId))
    .sort((a, b) => Number(Boolean(a.existing)) - Number(Boolean(b.existing)));

  const freshList = ratingList.filter((r) => !r.existing);
  const ratedList = ratingList.filter((r) => r.existing);

  // Everyone already has a standing rating? Then there is nothing to hide behind a
  // toggle — show them, since revising is the only thing left to do.
  const [showRated, setShowRated] = useState(false);
  const collapseRated = freshList.length > 0 && !showRated;

  const filteredRatingList = collapseRated ? freshList : ratingList;

  const presentCount = Object.values(attendance).filter((s) => s === "present").length;
  const absentCount = Object.values(attendance).filter((s) => s === "absent").length;
  const isRated = (r: PlayerRatingDraft) => (r.conductRating ?? 0) > 0 && (r.gameplayRating ?? 0) > 0;
  const ratedCount = ratingList.filter(isRated).length;

  // What Save would actually send: edits, plus anyone rated here for the first
  // time. Zero means the pass is already recorded and Save has nothing to do.
  const pendingCount = ratingList.filter(
    (r) => dirty[r.playerId] || (!r.existing && isRated(r))
  ).length;

  // "Rated 12 Jul · 4 games" — enough to recognise the opinion as yours.
  const standingNote = (r: PlayerRatingDraft) => {
    if (!r.existing) return null;
    const when = r.existing.lastRatedAt
      ? new Date(r.existing.lastRatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : null;
    const games = r.existing.gamesObserved;
    return [when && `rated ${when}`, games > 0 && `${games} game${games === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div className="pgm-overlay" onClick={onClose}>
      <div className="pgm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pgm-header">
          <div>
            <div className="pgm-title-area">
              <span className="pgm-title">
                {step === "attendance" ? "Mark Attendance" : step === "ratings" ? "Rate Players" : "Game Summary"}
              </span>
            </div>
            <div className="pgm-subtitle">
              {game.title} · {game.format} · {new Date(game.scheduledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
          <button className="pgm-close" onClick={onClose} title="Close Modal">✕</button>
        </div>

        <div className="pgm-steps">
          <div className={`pgm-step ${step === "attendance" ? "active" : "done"}`}>
            <span className="pgm-step-num">{step === "attendance" ? "1" : "✓"}</span>
            <span className="pgm-step-label">Attendance</span>
          </div>
          <div className="pgm-step-line" />
          <div className={`pgm-step ${step === "ratings" ? "active" : step === "summary" ? "done" : ""}`}>
            <span className="pgm-step-num">{step === "summary" ? "✓" : "2"}</span>
            <span className="pgm-step-label">Express Ratings</span>
          </div>
          <div className="pgm-step-line" />
          <div className={`pgm-step ${step === "summary" ? "active" : ""}`}>
            <span className="pgm-step-num">3</span>
            <span className="pgm-step-label">Summary</span>
          </div>
        </div>

        {error && <div className="pgm-error">{error}</div>}

        {step === "attendance" && (
          <div className="pgm-body">
            <div className="pgm-summary-row">
              <div className="pgm-chip-group">
                <span className="pgm-summary-chip present">{presentCount} Present</span>
                <span className="pgm-summary-chip absent">{absentCount} Absent</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="pgm-quick-btn" onClick={markAllPresent}>⚡ All Present</button>
                <button type="button" className="pgm-quick-btn" onClick={markAllAbsent}>Clear</button>
              </div>
            </div>

            {playerRegs.length === 0 && (
              <div className="pgm-empty">No players registered for this game.</div>
            )}

            <div className="pgm-player-list">
              {playerRegs.map((reg) => (
                <div key={reg._id} className="pgm-attendance-row">
                  <div className="pgm-player-info">
                    <PlayerAvatar name={reg.player?.name || "P"} profileImage={reg.player?.profileImage} />
                    <span className="pgm-player-name">{reg.player?.name}</span>
                  </div>
                  <div className="pgm-attendance-btns">
                    <button
                      type="button"
                      className={`pgm-att-btn pgm-att-present ${attendance[reg._id] === "present" ? "active" : ""}`}
                      onClick={() => setAttendance((prev) => ({ ...prev, [reg._id]: "present" }))}
                    >
                      ✓ Present
                    </button>
                    <button
                      type="button"
                      className={`pgm-att-btn pgm-att-absent ${attendance[reg._id] === "absent" ? "active" : ""}`}
                      onClick={() => setAttendance((prev) => ({ ...prev, [reg._id]: "absent" }))}
                    >
                      ✕ Absent
                    </button>
                  </div>
                </div>
              ))}

              {guestRegs.length > 0 && (
                <div className="pgm-guests-note">
                  {guestRegs.length} guest slot{guestRegs.length > 1 ? "s" : ""} — guests are not individually rated.
                </div>
              )}
            </div>

            <div className="pgm-footer">
              <button className="pgm-btn-secondary" onClick={onClose}>Cancel</button>
              <button className="pgm-btn-primary" onClick={handleSaveAttendance} disabled={savingAttendance}>
                {savingAttendance ? "Saving…" : "Save Attendance & Complete Game →"}
              </button>
            </div>
          </div>
        )}

        {step === "ratings" && (
          <div className="pgm-body">
            <div className="pgm-quick-bar">
              <div className="pgm-quick-actions">
                <button type="button" className="pgm-quick-btn" onClick={autoSplitTeams}>👥 Auto Teams (A/B)</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="pgm-view-toggle">
                  <button type="button" className={`pgm-toggle-btn ${viewMode === "express" ? "active" : ""}`} onClick={() => setViewMode("express")}>⚡ Matrix</button>
                  <button type="button" className={`pgm-toggle-btn ${viewMode === "detailed" ? "active" : ""}`} onClick={() => setViewMode("detailed")}>🎴 Cards</button>
                </div>
              </div>
            </div>

            <div className="pgm-summary-row" style={{ padding: "10px 24px 4px" }}>
              <div className="pgm-chip-group">
                <span className="pgm-summary-chip present">{freshList.length} to rate</span>
                {ratedList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowRated((v) => !v)}
                    className={`pgm-chip ${!collapseRated ? "selected" : ""}`}
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    title="Your saved ratings for these players — open to revise one"
                  >
                    {collapseRated
                      ? `${ratedList.length} already rated · Show`
                      : `${ratedList.length} already rated · Hide`}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {viewMode === "express" && <span className="pgm-scroll-hint">👈 Swipe table 👉</span>}
              </div>
            </div>

            {loadingPrefill && (
              <div className="pgm-empty">Loading your ratings…</div>
            )}

            {!loadingPrefill && ratingList.length === 0 && (
              <div className="pgm-empty">No players were marked as present. Nothing to rate.</div>
            )}

            {!loadingPrefill && ratingList.length > 0 && freshList.length === 0 && (
              <div className="pgm-guests-note" style={{ margin: "0 24px 8px" }}>
                You have already rated everyone who played. Ratings carry over — change one only
                if a player has actually changed.
              </div>
            )}

            {ratingList.length > 0 && viewMode === "express" && (
              <div className="pgm-table-container">
                <table className="pgm-express-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Conduct</th>
                      <th>Gameplay</th>
                      <th>GK Affinity</th>
                      <th>Position</th>
                      <th>Team</th>
                      <th>Play With</th>
                      <th>Play Against</th>
                      <th>Notes (optional)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRatingList.map((r) => {
                      const profileImage = playerRegs.find((p) => p.player?._id === r.playerId)?.player?.profileImage;
                      const otherAttended = attendedPlayers.filter((p) => p.player?._id !== r.playerId);
                      return (
                        <tr key={r.playerId}>
                          <td style={{ minWidth: 130 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <PlayerAvatar name={r.name} profileImage={profileImage} />
                              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                <span style={{ fontWeight: 600, color: "#f4efe8" }}>{r.name}</span>
                                {r.existing && (
                                  <span style={{ fontSize: 9.5, color: dirty[r.playerId] ? "#c4d56c" : "#6b6b6b", whiteSpace: "nowrap" }}>
                                    {dirty[r.playerId] ? "● changed" : `✓ ${standingNote(r)}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <StarRating size="mini" value={r.conductRating} onChange={(v) => updateRating(r.playerId, "conductRating", v)} />
                          </td>
                          <td>
                            <StarRating size="mini" value={r.gameplayRating} onChange={(v) => updateRating(r.playerId, "gameplayRating", v)} />
                          </td>
                          <td>
                            <select
                              className="pgm-select"
                              style={{ padding: "4px 8px", fontSize: 11, width: 60, textAlign: "center" }}
                              value={r.gkAffinity == null ? "na" : r.gkAffinity}
                              onChange={(e) => updateRating(r.playerId, "gkAffinity", e.target.value === "na" ? null : Number(e.target.value))}
                            >
                              <option value="na">NA</option>
                              {[0, 1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select className="pgm-select" style={{ padding: "4px 8px", fontSize: 11, width: 95 }} value={r.preferredPosition} onChange={(e) => updateRating(r.playerId, "preferredPosition", e.target.value)}>
                              {POSITIONS.map((p) => (
                                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                onClick={() => assignTeam(r.playerId, r.team === "A" ? null : "A")}
                                style={{
                                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                                  background: r.team === "A" ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)",
                                  color: r.team === "A" ? "#60a5fa" : "#666",
                                  border: r.team === "A" ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
                                  cursor: "pointer",
                                }}
                              >A</button>
                              <button
                                type="button"
                                onClick={() => assignTeam(r.playerId, r.team === "B" ? null : "B")}
                                style={{
                                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                                  background: r.team === "B" ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.04)",
                                  color: r.team === "B" ? "#f87171" : "#666",
                                  border: r.team === "B" ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(239,68,68,0.08)",
                                  cursor: "pointer",
                                }}
                              >B</button>
                            </div>
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <PlayerDropdownSelect
                              variant="with"
                              selectedIds={r.playWith}
                              options={otherAttended.map((p) => ({ id: p.player!._id, name: p.player!.name }))}
                              onToggle={(targetId) => togglePlayerPreference(r.playerId, "playWith", targetId)}
                            />
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <PlayerDropdownSelect
                              variant="against"
                              selectedIds={r.playAgainst}
                              options={otherAttended.map((p) => ({ id: p.player!._id, name: p.player!.name }))}
                              onToggle={(targetId) => togglePlayerPreference(r.playerId, "playAgainst", targetId)}
                            />
                          </td>
                          <td>
                            <textarea
                              className="pgm-notes-input"
                              placeholder="Notes (optional)…"
                              value={r.notes}
                              onChange={(e) => updateRating(r.playerId, "notes", e.target.value)}
                              rows={1}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {ratingList.length > 0 && viewMode === "detailed" && (() => {
              const activeSelectedId = selectedPlayerCardId !== "all" && !filteredRatingList.some((r) => r.playerId === selectedPlayerCardId)
                ? "all"
                : selectedPlayerCardId;

              const cardsToDisplay = activeSelectedId === "all"
                ? filteredRatingList
                : filteredRatingList.filter((r) => r.playerId === activeSelectedId);

              const selectedIdx = filteredRatingList.findIndex((r) => r.playerId === activeSelectedId);

              return (
                <div className="pgm-card-view-wrapper">
                  <div className="pgm-card-player-dropdown-bar">
                    <div className="pgm-card-dropdown-wrap">
                      <span className="pgm-card-dropdown-icon">👤</span>
                      <select
                        className="pgm-player-card-select"
                        value={activeSelectedId}
                        onChange={(e) => setSelectedPlayerCardId(e.target.value)}
                      >
                        <option value="all">👥 Show All Player Cards ({filteredRatingList.length})</option>
                        {filteredRatingList.map((r, idx) => (
                          <option key={r.playerId} value={r.playerId}>
                            {idx + 1}. {r.name} {r.team ? `(Team ${r.team})` : ""}{" "}
                            {dirty[r.playerId] ? "● Changed" : r.existing ? "✓ Saved" : "• New"}
                          </option>
                        ))}
                      </select>
                    </div>

                    {activeSelectedId !== "all" && (
                      <div className="pgm-card-nav-controls">
                        <button
                          type="button"
                          className="pgm-card-nav-btn"
                          disabled={selectedIdx <= 0}
                          onClick={() => {
                            if (selectedIdx > 0) {
                              setSelectedPlayerCardId(filteredRatingList[selectedIdx - 1].playerId);
                            }
                          }}
                          title="Previous Player"
                        >
                          ‹ Prev
                        </button>
                        <span className="pgm-card-nav-count">
                          {selectedIdx + 1} / {filteredRatingList.length}
                        </span>
                        <button
                          type="button"
                          className="pgm-card-nav-btn pgm-card-nav-next"
                          disabled={selectedIdx >= filteredRatingList.length - 1}
                          onClick={() => {
                            if (selectedIdx < filteredRatingList.length - 1) {
                              setSelectedPlayerCardId(filteredRatingList[selectedIdx + 1].playerId);
                            }
                          }}
                          title="Next Player"
                        >
                          Next ›
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="pgm-rating-list">
                    {cardsToDisplay.map((r) => {
                      const otherAttended = attendedPlayers.filter((p) => p.player!._id !== r.playerId);
                      const profileImage = playerRegs.find((p) => p.player?._id === r.playerId)?.player?.profileImage;
                      const cardIdx = filteredRatingList.findIndex((item) => item.playerId === r.playerId);
                      const hasNext = cardIdx >= 0 && cardIdx < filteredRatingList.length - 1;

                      return (
                        <div key={r.playerId} className="pgm-rating-card">
                          <div className="pgm-rating-card-header">
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <PlayerAvatar name={r.name} profileImage={profileImage} />
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span className="pgm-player-name">{r.name}</span>
                                {r.existing && (
                                  <span style={{ fontSize: 10, color: dirty[r.playerId] ? "#c4d56c" : "#6b6b6b" }}>
                                    {dirty[r.playerId] ? "● changed" : `✓ ${standingNote(r)}`}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <div className="pgm-card-team-selector">
                                <span className="pgm-field-label" style={{ margin: 0, fontSize: 10 }}>Team:</span>
                                <button
                                  type="button"
                                  className={`pgm-team-btn pgm-team-a ${r.team === "A" ? "active" : ""}`}
                                  onClick={() => assignTeam(r.playerId, r.team === "A" ? null : "A")}
                                >
                                  A
                                </button>
                                <button
                                  type="button"
                                  className={`pgm-team-btn pgm-team-b ${r.team === "B" ? "active" : ""}`}
                                  onClick={() => assignTeam(r.playerId, r.team === "B" ? null : "B")}
                                >
                                  B
                                </button>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className="pgm-field-label" style={{ margin: 0, fontSize: 10 }}>Pos:</span>
                                <select
                                  className="pgm-select"
                                  style={{ padding: "3px 8px", fontSize: 11, width: "auto" }}
                                  value={r.preferredPosition}
                                  onChange={(e) => updateRating(r.playerId, "preferredPosition", e.target.value)}
                                >
                                  {POSITIONS.map((p) => (
                                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>

                          <div className="pgm-card-ratings-grid">
                            <StarRating label="Conduct" size="mini" value={r.conductRating} onChange={(v) => updateRating(r.playerId, "conductRating", v)} />
                            <StarRating label="Gameplay" size="mini" value={r.gameplayRating} onChange={(v) => updateRating(r.playerId, "gameplayRating", v)} />
                            <div className="pgm-star-row pgm-star-row-mini" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="pgm-star-label">GK Affinity</span>
                              <select
                                className="pgm-select"
                                style={{ padding: "3px 8px", fontSize: 11, width: "auto", minWidth: 54, borderRadius: 4 }}
                                value={r.gkAffinity == null ? "na" : r.gkAffinity}
                                onChange={(e) => updateRating(r.playerId, "gkAffinity", e.target.value === "na" ? null : Number(e.target.value))}
                              >
                                <option value="na">NA</option>
                                {[0, 1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {otherAttended.length > 0 && (
                            <div className="pgm-card-prefs-grid">
                              <div className="pgm-card-pref-col">
                                <span className="pgm-pref-label">Play With</span>
                                <PlayerDropdownSelect
                                  variant="with"
                                  selectedIds={r.playWith}
                                  options={otherAttended.map((p) => ({ id: p.player!._id, name: p.player!.name }))}
                                  onToggle={(targetId) => togglePlayerPreference(r.playerId, "playWith", targetId)}
                                />
                              </div>
                              <div className="pgm-card-pref-col">
                                <span className="pgm-pref-label">Play Against</span>
                                <PlayerDropdownSelect
                                  variant="against"
                                  selectedIds={r.playAgainst}
                                  options={otherAttended.map((p) => ({ id: p.player!._id, name: p.player!.name }))}
                                  onToggle={(targetId) => togglePlayerPreference(r.playerId, "playAgainst", targetId)}
                                />
                              </div>
                            </div>
                          )}

                          <div className="pgm-card-notes-row">
                            <textarea
                              className="pgm-notes-input"
                              style={{ width: "100%", maxWidth: "100%" }}
                              placeholder="Notes (optional)…"
                              value={r.notes}
                              onChange={(e) => updateRating(r.playerId, "notes", e.target.value)}
                              rows={2}
                            />
                          </div>

                          {activeSelectedId !== "all" && hasNext && (
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                              <button
                                type="button"
                                className="pgm-btn-secondary"
                                style={{ padding: "4px 12px", fontSize: 11, background: "rgba(196, 213, 108, 0.12)", color: "#c4d56c", borderColor: "rgba(196, 213, 108, 0.3)" }}
                                onClick={() => setSelectedPlayerCardId(filteredRatingList[cardIdx + 1].playerId)}
                              >
                                Next Player →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="pgm-footer">
              <button className="pgm-btn-secondary" onClick={() => setStep("attendance")}>← Back</button>
              <button className="pgm-btn-ghost" onClick={() => setStep("summary")} disabled={savingRatings}>Skip Ratings</button>
              <button className="pgm-btn-primary" onClick={handleSaveRatings} disabled={savingRatings || ratingList.length === 0}>
                {savingRatings
                  ? "Saving…"
                  : pendingCount > 0
                    ? `Save ${pendingCount} Rating${pendingCount === 1 ? "" : "s"} ✓`
                    : "Continue →"}
              </button>
            </div>
          </div>
        )}

        {step === "summary" && (
          <div className="pgm-body">
            <div className="pgm-summary-row" style={{ padding: "14px 24px 0" }}>
              <span className="pgm-summary-chip present">{presentCount} Present</span>
              <span className="pgm-summary-chip absent">{absentCount} Absent</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#555" }}>
                {ratedCount} of {ratingList.length} rated
              </span>
            </div>

            <div style={{ padding: "16px 24px 0" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                Post-Game Summary
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>Total Players</div>
                    <div style={{ fontSize: 22, color: "#888", fontWeight: 800 }}>{game.registrations.length}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>Attended</div>
                    <div style={{ fontSize: 22, color: "#4ade80", fontWeight: 800 }}>{presentCount}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>Absent</div>
                    <div style={{ fontSize: 22, color: "#ef4444", fontWeight: 800 }}>{absentCount}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>Rated</div>
                    <div style={{ fontSize: 22, color: "#fbbf24", fontWeight: 800 }}>{ratedCount}</div>
                  </div>
                </div> 
                 <div style={{ fontSize: 12, color: "#666", textAlign: "center", padding: "8px 0" }}>
                  Game completed successfully. All data has been recorded.
                </div>
              </div>
            </div>

            {(ratingList.some((r) => r.team === "A") || ratingList.some((r) => r.team === "B")) && (
              <div style={{ padding: "16px 24px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
                  Match Teams
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(["A", "B"] as const).map((t) => {
                    const teamPlayers = ratingList.filter((r) => r.team === t);
                    if (teamPlayers.length === 0) return null;
                    return (
                      <div key={t} style={{
                        background: t === "A" ? "rgba(59,130,246,0.07)" : "rgba(239,68,68,0.07)",
                        border: `1px solid ${t === "A" ? "rgba(59,130,246,0.2)" : "rgba(239,68,68,0.2)"}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t === "A" ? "#60a5fa" : "#f87171", marginBottom: 6 }}>
                          Team {t} ({teamPlayers.length})
                        </div>
                        {teamPlayers.map((p) => (
                          <div key={p.playerId} style={{ fontSize: 12, color: "#ccc", padding: "2px 0" }}>
                            {p.name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pgm-footer">
              <button className="pgm-btn-secondary" onClick={() => setStep("ratings")}>← Back</button>
              <button className="pgm-btn-primary" onClick={onDone}>Done ✓</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
