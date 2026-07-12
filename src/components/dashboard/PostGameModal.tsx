"use client";

import React, { useState, useEffect, useCallback } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import "./PostGameModal.css";

// ── Types ──────────────────────────────────────────────────────────────────
interface Registration {
  _id: string;
  player?: { _id: string; name: string; phone?: string; profileImage?: string };
  plusOneName?: string | null;
  attended?: "present" | "absent" | "not_marked";
}

interface Game {
  _id: string;
  title: string;
  format: string;
  scheduledAt: string;
  turf?: { name?: string };
  registrations: Registration[];
  attendanceMarked?: boolean;
}

type AttendanceStatus = "present" | "absent";

interface PlayerRatingDraft {
  playerId: string;
  name: string;
  conductRating: number;
  gameplayRating: number;
  preferredPosition: string;
  gkAffinity: number | null;
  playWith: string[];
  playAgainst: string[];
  notes: string;
  team: "A" | "B" | null;
}

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

// ── Star Rating component ──────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="pgm-star-row">
      <span className="pgm-star-label">{label}</span>
      <div className="pgm-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`pgm-star ${n <= (hovered || value) ? "filled" : ""}`}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        ))}
        <span className="pgm-star-value">{value > 0 ? `${value}/5` : "Not rated"}</span>
      </div>
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export function PostGameModal({ game, onClose, onDone }: Props) {
  const [step, setStep] = useState<"attendance" | "ratings" | "summary">("attendance");
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingRatings, setSavingRatings] = useState(false);
  const [error, setError] = useState("");
  const [ratings, setRatings] = useState<Record<string, PlayerRatingDraft>>({});

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

      // Build initial rating drafts for all attended real players
      const attended = game.registrations.filter(
        (r) => !r.plusOneName && r.player && attendance[r._id] === "present"
      );
      const drafts: Record<string, PlayerRatingDraft> = {};
      for (const reg of attended) {
        const pid = reg.player!._id;
        drafts[pid] = {
          playerId:          pid,
          name:              reg.player!.name,
          conductRating:     0,   // 0 = not rated yet (no default)
          gameplayRating:    0,   // 0 = not rated yet (no default)
          preferredPosition: "any",
          gkAffinity:        null,
          playWith:          [],
          playAgainst:       [],
          notes:             "",
          team:              null,
        };
      }

      // Merge with any previously saved ratings (saved ratings take priority)
      try {
        const rRes = await fetch(
          buildApiUrl(`/api/v1/games/organisers/${game._id}/player-ratings`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const rData = await rRes.json();
        if (rData.success) {
          for (const r of rData.data ?? []) {
            const pid = r.player._id;
            // Only restore if the player was marked present in this round
            if (drafts[pid]) {
              drafts[pid] = {
                playerId:          pid,
                name:              r.player.name,
                conductRating:     r.conductRating,
                gameplayRating:    r.gameplayRating,
                preferredPosition: r.preferredPosition || "any",
                gkAffinity:        r.gkAffinity ?? null,
                playWith:          r.playWith?.map((x: any) => x.toString()) ?? [],
                playAgainst:       r.playAgainst?.map((x: any) => x.toString()) ?? [],
                notes:             r.notes || "",
                team:              (r.team === "A" || r.team === "B") ? r.team : null,
              };
            }
          }
        }
      } catch {}

      setRatings(drafts);
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
      const payload = Object.values(ratings).map((r) => ({
        playerId:          r.playerId,
        conductRating:     r.conductRating,
        gameplayRating:    r.gameplayRating,
        preferredPosition: r.preferredPosition,
        gkAffinity:        r.gkAffinity && r.gkAffinity > 0 ? r.gkAffinity : null,
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

  const updateRating = (pid: string, field: keyof PlayerRatingDraft, value: any) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  };

  const assignTeam = (pid: string, team: "A" | "B" | null) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], team } }));
  };

  const autoSplitTeams = () => {
    const ids = ratingList.map((r) => r.playerId);
    const half = Math.ceil(ids.length / 2);
    setRatings((prev) => {
      const next = { ...prev };
      ids.forEach((pid, i) => {
        next[pid] = { ...next[pid], team: i < half ? "A" : "B" };
      });
      return next;
    });
  };

  const togglePlayerPreference = (
    pid: string,
    field: "playWith" | "playAgainst",
    targetId: string
  ) => {
    setRatings((prev) => {
      const current = prev[pid]?.[field] ?? [];
      const updated = current.includes(targetId)
        ? current.filter((x) => x !== targetId)
        : [...current, targetId];
      return { ...prev, [pid]: { ...prev[pid], [field]: updated } };
    });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const playerRegs = game.registrations.filter((r) => !r.plusOneName && r.player);
  const guestRegs  = game.registrations.filter((r) => r.plusOneName);
  const attendedIds = Object.entries(attendance)
    .filter(([, s]) => s === "present")
    .map(([regId]) => regId);

  const attendedPlayers = playerRegs.filter((r) => attendedIds.includes(r._id));
  const ratingList = Object.values(ratings);

  const presentCount = Object.values(attendance).filter((s) => s === "present").length;
  const absentCount  = Object.values(attendance).filter((s) => s === "absent").length;

  return (
    <div className="pgm-overlay" onClick={onClose}>
      <div className="pgm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pgm-header">
          <div>
            <div className="pgm-title">
              {step === "attendance" ? "Mark Attendance" : step === "ratings" ? "Rate Players" : "Game Summary"}
            </div>
            <div className="pgm-subtitle">
              {game.title} · {game.format} ·{" "}
              {new Date(game.scheduledAt).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
              })}
            </div>
          </div>
          <button className="pgm-close" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div className="pgm-steps">
          <div className={`pgm-step ${step === "attendance" ? "active" : "done"}`}>
            <span className="pgm-step-num">{step === "attendance" ? "1" : "✓"}</span>
            <span className="pgm-step-label">Attendance</span>
          </div>
          <div className="pgm-step-line" />
          <div className={`pgm-step ${step === "ratings" ? "active" : step === "summary" ? "done" : ""}`}>
            <span className="pgm-step-num">{step === "summary" ? "✓" : "2"}</span>
            <span className="pgm-step-label">Rate Players</span>
          </div>
          <div className="pgm-step-line" />
          <div className={`pgm-step ${step === "summary" ? "active" : ""}`}>
            <span className="pgm-step-num">3</span>
            <span className="pgm-step-label">Summary</span>
          </div>
        </div>

        {error && <div className="pgm-error">{error}</div>}

        {/* ── STEP 1: Attendance ── */}
        {step === "attendance" && (
          <div className="pgm-body">
            <div className="pgm-summary-row">
              <span className="pgm-summary-chip present">{presentCount} Present</span>
              <span className="pgm-summary-chip absent">{absentCount} Absent</span>
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
                  {guestRegs.length} guest slot{guestRegs.length > 1 ? "s" : ""} — guests are
                  not individually rated.
                </div>
              )}
            </div>

            <div className="pgm-footer">
              <button className="pgm-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="pgm-btn-primary"
                onClick={handleSaveAttendance}
                disabled={savingAttendance}
              >
                {savingAttendance
                  ? "Saving…"
                  : `Save Attendance & Complete Game →`}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Summary + Player Feedback ── */}
        {step === "summary" && (
          <div className="pgm-body">
            {/* Attendance recap */}
            <div className="pgm-summary-row" style={{ padding: "14px 24px 0" }}>
              <span className="pgm-summary-chip present">{presentCount} Present</span>
              <span className="pgm-summary-chip absent">{absentCount} Absent</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#555" }}>
                {Object.keys(ratings).length} player{Object.keys(ratings).length !== 1 ? "s" : ""} rated
              </span>
            </div>

            {/* Post-Game Summary */}
            <div style={{ padding: "16px 24px 0" }}>
              <div className="pgm-section-head" style={{ fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                Post-Game Summary
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", minWidth: 100, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Total Players</div>
                    <div style={{ fontSize: 24, color: "#888", fontWeight: 800 }}>{game.registrations.length}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", minWidth: 100, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Attended</div>
                    <div style={{ fontSize: 24, color: "#4ade80", fontWeight: 800 }}>{presentCount}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", minWidth: 100, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Absent</div>
                    <div style={{ fontSize: 24, color: "#ef4444", fontWeight: 800 }}>{absentCount}</div>
                  </div>
                  <div style={{ background: "#111114", border: "1px solid #1e1e22", borderRadius: 8, padding: "12px 16px", minWidth: 100, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Rated</div>
                    <div style={{ fontSize: 24, color: "#fbbf24", fontWeight: 800 }}>{Object.keys(ratings).length}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#666", textAlign: "center", padding: "8px 0" }}>
                  Game completed successfully. All data has been recorded.
                </div>
              </div>
            </div>

            {/* Team breakdown */}
            {(ratingList.some((r) => r.team === "A") || ratingList.some((r) => r.team === "B")) && (
              <div style={{ padding: "0 24px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", marginBottom: 8 }}>
                  Match Teams
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {(["A", "B"] as const).map((t) => {
                    const teamPlayers = ratingList.filter((r) => r.team === t);
                    if (teamPlayers.length === 0) return null;
                    return (
                      <div key={t} style={{
                        background: t === "A" ? "rgba(59,130,246,0.07)" : "rgba(239,68,68,0.07)",
                        border: `1px solid ${t === "A" ? "rgba(59,130,246,0.2)" : "rgba(239,68,68,0.2)"}`,
                        borderRadius: 8, padding: "10px 12px",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: t === "A" ? "#60a5fa" : "#f87171", marginBottom: 6 }}>
                          Team {t} · {teamPlayers.length} players
                        </div>
                        {teamPlayers.map((p) => (
                          <div key={p.playerId} style={{ fontSize: 12, color: "#ccc", padding: "2px 0" }}>{p.name}</div>
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

        {/* ── STEP 2: Rate Players ── */}
        {step === "ratings" && (
          <div className="pgm-body">
            {ratingList.length === 0 ? (
              <div className="pgm-empty">
                No players were marked as present. Nothing to rate.
              </div>
            ) : (
              <div className="pgm-rating-list">

                {/* ── Team Assignment ────────────────────────────────────── */}
                <div style={{
                  background: "#111114",
                  border: "1px solid #1e1e22",
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888" }}>
                        Team Assignment
                      </div>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                        Record who played on which team — used for future team balancing
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={autoSplitTeams}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "5px 12px",
                        background: "rgba(200,255,62,0.08)", color: "#c8ff3e",
                        border: "1px solid rgba(200,255,62,0.25)", borderRadius: 6,
                        cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      Auto Split
                    </button>
                  </div>

                  {/* Two-column summary */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {(["A", "B"] as const).map((t) => {
                      const teamPlayers = ratingList.filter((r) => r.team === t);
                      return (
                        <div key={t} style={{
                          background: t === "A" ? "rgba(59,130,246,0.07)" : "rgba(239,68,68,0.07)",
                          border: `1px solid ${t === "A" ? "rgba(59,130,246,0.2)" : "rgba(239,68,68,0.2)"}`,
                          borderRadius: 7, padding: "8px 10px", minHeight: 48,
                        }}>
                          <div style={{
                            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                            color: t === "A" ? "#60a5fa" : "#f87171", marginBottom: 6,
                          }}>
                            Team {t} · {teamPlayers.length}
                          </div>
                          {teamPlayers.length === 0 ? (
                            <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>No players yet</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {teamPlayers.map((p) => (
                                <div key={p.playerId} style={{ fontSize: 11, color: "#ccc" }}>{p.name}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Per-player row */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ratingList.map((r) => (
                      <div key={r.playerId} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 10px",
                        background: "rgba(255,255,255,0.02)",
                        borderRadius: 7,
                        border: r.team === "A"
                          ? "1px solid rgba(59,130,246,0.25)"
                          : r.team === "B"
                          ? "1px solid rgba(239,68,68,0.25)"
                          : "1px solid rgba(255,255,255,0.05)",
                      }}>
                        <span style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 500 }}>{r.name}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => assignTeam(r.playerId, r.team === "A" ? null : "A")}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 5,
                              background: r.team === "A" ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)",
                              color: r.team === "A" ? "#60a5fa" : "#666",
                              border: r.team === "A" ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
                              cursor: "pointer",
                            }}
                          >A</button>
                          <button
                            type="button"
                            onClick={() => assignTeam(r.playerId, r.team === "B" ? null : "B")}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 5,
                              background: r.team === "B" ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.04)",
                              color: r.team === "B" ? "#f87171" : "#666",
                              border: r.team === "B" ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.08)",
                              cursor: "pointer",
                            }}
                          >B</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* ── End Team Assignment ─────────────────────────────────── */}

                {ratingList.map((r) => {
                  const otherAttended = attendedPlayers.filter(
                    (p) => p.player!._id !== r.playerId
                  );
                  const profileImage = playerRegs.find(p => p.player?._id === r.playerId)?.player?.profileImage;
                  return (
                    <div key={r.playerId} className="pgm-rating-card">
                      <div className="pgm-rating-card-header">
                        <PlayerAvatar name={r.name} profileImage={profileImage} />
                        <span className="pgm-player-name">{r.name}</span>
                      </div>

                      <StarRating
                        label="Conduct"
                        value={r.conductRating}
                        onChange={(v) => updateRating(r.playerId, "conductRating", v)}
                      />
                      <StarRating
                        label="Gameplay"
                        value={r.gameplayRating}
                        onChange={(v) => updateRating(r.playerId, "gameplayRating", v)}
                      />

                      <div className="pgm-field-row">
                        <label className="pgm-field-label">Preferred Position</label>
                        <select
                          className="pgm-select"
                          value={r.preferredPosition}
                          onChange={(e) =>
                            updateRating(r.playerId, "preferredPosition", e.target.value)
                          }
                        >
                          {POSITIONS.map((p) => (
                            <option key={p} value={p}>
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <StarRating
                        label="GK Affinity"
                        value={r.gkAffinity ?? 0}
                        onChange={(v) => updateRating(r.playerId, "gkAffinity", v)}
                      />

                      {otherAttended.length > 0 && (
                        <>
                          <div className="pgm-pref-section">
                            <div className="pgm-pref-label">Play With</div>
                            <div className="pgm-pref-chips">
                              {otherAttended.map((p) => (
                                <button
                                  key={p.player!._id}
                                  type="button"
                                  className={`pgm-chip pgm-chip-with ${
                                    r.playWith.includes(p.player!._id) ? "selected" : ""
                                  }`}
                                  onClick={() =>
                                    togglePlayerPreference(
                                      r.playerId,
                                      "playWith",
                                      p.player!._id
                                    )
                                  }
                                >
                                  {p.player!.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="pgm-pref-section">
                            <div className="pgm-pref-label">Play Against</div>
                            <div className="pgm-pref-chips">
                              {otherAttended.map((p) => (
                                <button
                                  key={p.player!._id}
                                  type="button"
                                  className={`pgm-chip pgm-chip-against ${
                                    r.playAgainst.includes(p.player!._id) ? "selected" : ""
                                  }`}
                                  onClick={() =>
                                    togglePlayerPreference(
                                      r.playerId,
                                      "playAgainst",
                                      p.player!._id
                                    )
                                  }
                                >
                                  {p.player!.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      <div className="pgm-field-row">
                        <label className="pgm-field-label">Notes (optional)</label>
                        <textarea
                          className="pgm-textarea"
                          rows={2}
                          placeholder="Any notes about this player…"
                          value={r.notes}
                          onChange={(e) =>
                            updateRating(r.playerId, "notes", e.target.value)
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pgm-footer">
              <button
                className="pgm-btn-secondary"
                onClick={() => setStep("attendance")}
              >
                ← Back
              </button>
              <button
                className="pgm-btn-ghost"
                onClick={() => setStep("summary")}
                disabled={savingRatings}
              >
                Skip Ratings
              </button>
              <button
                className="pgm-btn-primary"
                onClick={handleSaveRatings}
                disabled={savingRatings || ratingList.length === 0}
              >
                {savingRatings ? "Saving…" : "Save Ratings ✓"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
