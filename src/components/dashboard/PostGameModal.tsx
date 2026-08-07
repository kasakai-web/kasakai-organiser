"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { buildApiUrl, getSession } from "@/utils/api";
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

export interface PlayerRatingDraft {
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

type SavedPlayerRating = {
  player?: { _id?: string; name?: string };
  playerId?: string;
  conductRating?: number;
  gameplayRating?: number;
  preferredPosition?: string;
  gkAffinity?: number;
  playWith?: unknown;
  playAgainst?: unknown;
  notes?: string;
  team?: string;
};

type SavedRatingsResponse = {
  success?: boolean;
  data?: SavedPlayerRating[];
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

// ── Star Rating component ──────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  label,
  size = "normal",
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  size?: "normal" | "mini";
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className={`pgm-star-row ${size === "mini" ? "pgm-star-row-mini" : ""}`}>
      {label && <span className="pgm-star-label">{label}</span>}
      <div className="pgm-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`pgm-star ${size === "mini" ? "pgm-star-mini" : ""} ${n <= (hovered || value) ? "filled" : ""}`}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(value === n ? 0 : n)}
            title={`${n} Stars`}
          >
            ★
          </button>
        ))}
        {size !== "mini" && (
          <span className="pgm-star-value">{value > 0 ? `${value}/5` : "Unrated"}</span>
        )}
      </div>
    </div>
  );
}

// ── Multi-select Dropdown for Matrix Table ──────────────────────────────────
interface DropdownOption {
  id: string;
  name: string;
}

function PlayerDropdownSelect({
  variant,
  selectedIds,
  options,
  onToggle,
}: {
  variant: "with" | "against";
  selectedIds: string[];
  options: DropdownOption[];
  onToggle: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const selectedNames = options
    .filter((o) => selectedIds.includes(o.id))
    .map((o) => o.name);

  let labelText = "Select...";
  if (selectedNames.length === 1) {
    labelText = selectedNames[0];
  } else if (selectedNames.length > 1) {
    labelText = `${selectedNames[0]} (+${selectedNames.length - 1})`;
  }

  const isWith = variant === "with";

  return (
    <div className="pgm-dropdown-container" ref={dropdownRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={`pgm-dropdown-btn ${isWith ? "pgm-dropdown-with" : "pgm-dropdown-against"} ${selectedIds.length > 0 ? "has-selection" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        title={selectedNames.length > 0 ? selectedNames.join(", ") : `Select players to play ${variant}`}
      >
        <span className="pgm-dropdown-label">{labelText}</span>
        <span className="pgm-dropdown-arrow">▾</span>
      </button>

      {isOpen && (
        <div className="pgm-dropdown-menu">
          {options.length === 0 ? (
            <div className="pgm-dropdown-empty">No other players</div>
          ) : (
            options.map((opt) => {
              const checked = selectedIds.includes(opt.id);
              return (
                <div
                  key={opt.id}
                  className={`pgm-dropdown-item ${checked ? "selected" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(opt.id);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    style={{ pointerEvents: "none" }}
                  />
                  <span>{opt.name}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Optimized Modal ───────────────────────────────────────────────────
export function PostGameModal({ game, onClose, onDone }: Props) { 

  console.log(game); 

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
          conductRating:     0,
          gameplayRating:    0,
          preferredPosition: "any",
          gkAffinity:        null,
          playWith:          [],
          playAgainst:       [],
          notes:             "",
          team:              null,
        };
      }

      // Restore any previously saved/current ratings, or fall back to prior-game prefs.
      try {
        const rRes = await fetch(
          buildApiUrl(`/api/v1/games/organisers/${game._id}/player-ratings`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const rData = (await rRes.json()) as SavedRatingsResponse;

        if (rData.success) {
          for (const r of rData.data ?? []) {
            const pid = r.player?._id || r.playerId;
            if (!pid || !drafts[pid]) continue;
            drafts[pid] = {
              playerId:          pid,
              name:              r.player?.name || drafts[pid].name,
              conductRating:     typeof r.conductRating === "number" ? r.conductRating : 0,
              gameplayRating:    typeof r.gameplayRating === "number" ? r.gameplayRating : 0,
              preferredPosition: r.preferredPosition || "any",
              gkAffinity:        typeof r.gkAffinity === "number" ? r.gkAffinity : null,
              playWith:          Array.isArray(r.playWith) ? r.playWith.map((x: unknown) => String(x)) : [],
              playAgainst:       Array.isArray(r.playAgainst) ? r.playAgainst.map((x: unknown) => String(x)) : [],
              notes:             r.notes || "",
              team:              (r.team === "A" || r.team === "B") ? r.team : null,
            };
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

  const updateRating = (pid: string, field: keyof PlayerRatingDraft, value: string | number | null) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  };

  const assignTeam = (pid: string, team: "A" | "B" | null) => {
    setRatings((prev) => ({ ...prev, [pid]: { ...prev[pid], team } }));
  };

  const autoSplitTeams = () => {
    const ids = Object.keys(ratings);
    const half = Math.ceil(ids.length / 2);
    setRatings((prev) => {
      const next = { ...prev };
      ids.forEach((pid, index) => {
        next[pid] = { ...next[pid], team: index < half ? "A" : "B" };
      });
      return next;
    });
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
  const [filterUnrated, setFilterUnrated] = useState(false);
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
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const playerRegs = game.registrations.filter((r) => !r.plusOneName && r.player);
  const guestRegs = game.registrations.filter((r) => r.plusOneName);
  const attendedIds = Object.entries(attendance)
    .filter(([, s]) => s === "present")
    .map(([regId]) => regId);

  const attendedPlayers = playerRegs.filter((r) => attendedIds.includes(r._id));
  const ratingList = Object.values(ratings);

  const filteredRatingList = useMemo(() => {
    return ratingList.filter((r) => {
      const isUnrated = r.conductRating === 0 || r.gameplayRating === 0;
      return !filterUnrated || isUnrated;
    });
  }, [ratingList, filterUnrated]);

  const presentCount = Object.values(attendance).filter((s) => s === "present").length;
  const absentCount = Object.values(attendance).filter((s) => s === "absent").length;
  const ratedCount = ratingList.filter((r) => r.conductRating > 0 && r.gameplayRating > 0).length;

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
                <span className="pgm-summary-chip present">{ratedCount}/{ratingList.length} Rated</span>
                <button
                  type="button"
                  onClick={() => setFilterUnrated(!filterUnrated)}
                  className={`pgm-chip ${filterUnrated ? "selected" : ""}`}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                >
                  {filterUnrated ? "Show All" : "Unrated Only"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {viewMode === "express" && <span className="pgm-scroll-hint">👈 Swipe table 👉</span>}
              </div>
            </div>

            {ratingList.length === 0 && (
              <div className="pgm-empty">No players were marked as present. Nothing to rate.</div>
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
                              <span style={{ fontWeight: 600, color: "#f4efe8" }}>{r.name}</span>
                            </div>
                          </td>
                          <td>
                            <StarRating size="mini" value={r.conductRating} onChange={(v) => updateRating(r.playerId, "conductRating", v)} />
                          </td>
                          <td>
                            <StarRating size="mini" value={r.gameplayRating} onChange={(v) => updateRating(r.playerId, "gameplayRating", v)} />
                          </td>
                          <td>
                            <select className="pgm-select" style={{ padding: "4px 8px", fontSize: 11, width: 60, textAlign: "center" }} value={r.gkAffinity ?? 0} onChange={(e) => updateRating(r.playerId, "gkAffinity", Number(e.target.value))}>
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
                        {filteredRatingList.map((r, idx) => {
                          const isRated = r.conductRating > 0 || r.gameplayRating > 0;
                          return (
                            <option key={r.playerId} value={r.playerId}>
                              {idx + 1}. {r.name} {r.team ? `(Team ${r.team})` : ""} {isRated ? "✓ Rated" : "• Unrated"}
                            </option>
                          );
                        })}
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
                              <div>
                                <span className="pgm-player-name">{r.name}</span>
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
                                value={r.gkAffinity ?? 0}
                                onChange={(e) => updateRating(r.playerId, "gkAffinity", Number(e.target.value))}
                              >
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
                {savingRatings ? "Saving…" : "Save Ratings ✓"}
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
                {ratingList.length} players rated
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
