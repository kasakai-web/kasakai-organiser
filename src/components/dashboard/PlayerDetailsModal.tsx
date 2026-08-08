"use client";

import React, { useRef, useState } from "react";

import { buildApiUrl, getAuthHeaders } from "@/utils/api";
import { TeamDistributionPanel } from "@/components/dashboard/TeamDistributionPanel";
import { formatIstTime, formatIstLongDate, upperMeridiem, KASAKAI_SIGNOFF } from "@/utils/formatTime";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { buildPlayerListMessage } from "@/utils/playerListMessage";

const IMG_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1").replace(/\/api\/v1\/?$/, "");

interface Registration {
  _id?: string;
  player?: { _id?: string; name?: string; phone?: string; email?: string; profileImage?: string };
  plusOneName?: string | null;
  preferredPosition?: string;
  teamPreference?: string;
  signedUpAt?: string;
  paymentStatus?: string;
  amountPaidPaise?: number;
  optedOut?: boolean;
  optedOutAt?: string;
  optedOutReason?: "self" | "format_change" | null;
  // Tombstones. The backend keeps these rows as history instead of deleting them,
  // so the UI has to filter them out itself. backedOutAt = the player left;
  // removedAt = the organiser took the slot away.
  backedOutAt?: string | null;
  removedAt?: string | null;
}

interface WaitlistEntry {
  _id?: string;
  player?: { _id?: string; name?: string; phone?: string; email?: string; profileImage?: string };
  joinedAt?: string;
  notifiedAt?: string;
  status?: string;
  preferredPosition?: string;
  teamPreference?: string;
  source?: string;
}

interface GuestWaitlistEntry {
  _id?: string;
  player?: { _id?: string; name?: string };
  plusOneName?: string;
  requestedAt?: string;
  notifiedAt?: string;
  status?: string;
}

interface PlayerDetailsModalProps {
  gameId: string;
  gameName: string;
  gameStatus?: string;
  players: Registration[];
  waitlist?: WaitlistEntry[];
  guestWaitlist?: GuestWaitlistEntry[];
  totalSlots: number;
  spotsRemaining?: number;
  onClose: () => void;
  organiserIsPlaying?: boolean;
  onToggleOrganiserPlaying?: () => void;
  onRemoveRegistration?: (regId: string) => Promise<void>;
  onRefresh?: () => void;
  onGameUpdate?: (game: any) => void;
  isRefreshing?: boolean;
  scheduledAt?: string;
  venue?: string;
  location?: string;
  feeInPaise?: number;
  format?: string;
  reportingMinsBeforeGame?: number;
}

const POS_LABEL: Record<string, string> = {
  goalkeeper: "GK",
  defender: "DEF",
  midfielder: "MID",
  forward: "FWD",
  any: "ANY",
};

function posLabel(raw?: string) {
  if (!raw || raw === "any") return null;
  return POS_LABEL[raw.toLowerCase()] ?? raw.toUpperCase();
}

function teamInfo(raw?: string): { label: string; cls: string } | null {
  if (!raw || raw === "none") return null;
  if (raw === "red") return { label: "Red Team", cls: "pdm-team-red" };
  if (raw === "blue") return { label: "Blue Team", cls: "pdm-team-blue" };
  return null;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}


export function PlayerDetailsModal({
  gameId,
  gameName,
  gameStatus,
  players,
  waitlist = [],
  guestWaitlist = [],
  totalSlots,
  spotsRemaining: spotsRemainingProp,
  onClose,
  organiserIsPlaying = false,
  onToggleOrganiserPlaying,
  onRemoveRegistration,
  onRefresh,
  onGameUpdate,
  isRefreshing = false,
  scheduledAt,
  venue,
  location,
  feeInPaise,
  format,
  reportingMinsBeforeGame,
}: PlayerDetailsModalProps) {
  const isLocked = gameStatus === 'completed' || gameStatus === 'cancelled';

  const [teams, setTeams] = useState<any>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const showStatus = (type: "success" | "error", text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const approveWaitlistEntry = async (waitlistId: string) => {
    setApprovingId(waitlistId);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/waitlist/${waitlistId}/approve`), {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Failed to approve player.");
        return;
      }
      showStatus("success", "Player approved — they'll be notified when a slot opens.");
      if (data.data) onGameUpdate?.(data.data); else onRefresh?.();
    } catch {
      showStatus("error", "Failed to approve. Please try again.");
    } finally {
      setApprovingId(null);
    }
  };

  const searchPlayers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/organisers/search-players?q=${encodeURIComponent(query)}`), {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const registeredPlayerIds = new Set(
          players.filter(p => p.player?._id).map(p => p.player!._id)
        );
        const filtered = (data.data || []).filter((p: any) => !registeredPlayerIds.has(p._id));
        setSearchResults(filtered);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addPlayer = async (playerId: string, preferredPosition?: string) => {
    setAddingPlayerId(playerId);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/add-player`), {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ playerId, preferredPosition: preferredPosition || "any" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Failed to add player");
        return;
      }
      setShowAddPlayer(false);
      setSearchQuery("");
      setSearchResults([]);
      showStatus("success", "Player added successfully");
      if (data.data) onGameUpdate?.(data.data); else onRefresh?.();
    } catch (error) {
      console.error("Add player failed:", error);
      showStatus("error", "Failed to add player");
    } finally {
      setAddingPlayerId(null);
    }
  };

  const [addingGuest, setAddingGuest]                 = useState(false);
  const [guestModalOpen, setGuestModalOpen]           = useState(false);
  const [pendingGuestName, setPendingGuestName]       = useState("");
  const [pendingGuestPosition, setPendingGuestPosition] = useState("Any");
  const [pendingGuestTeam, setPendingGuestTeam]       = useState("No Preference");

  const addOrganiserGuest = async (guestName?: string, position?: string, teamPreference?: string) => {
    setAddingGuest(true);
    try {
      const body: Record<string, string> = {};
      if (guestName && guestName.trim()) body.guestName = guestName.trim();
      if (position && position !== "Any") body.position = position;
      if (teamPreference && teamPreference !== "No Preference") body.teamPreference = teamPreference;
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/add-guest`), {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Failed to add guest");
        return;
      }
      showStatus("success", "Guest slot added");
      if (data.data) onGameUpdate?.(data.data); else onRefresh?.();
    } catch {
      showStatus("error", "Failed to add guest");
    } finally {
      setAddingGuest(false);
    }
  };

  const [copied, setCopied] = useState(false);
  const [copiedTeams, setCopiedTeams] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const confirmActionRef = useRef<null | (() => Promise<void>)>(null);
 const handleDistribute = async (reshuffleNonce = 0) => {
  try {
    const res = await fetch(
      buildApiUrl(`/api/v1/games/organisers/${gameId}/distribute`),
      {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reshuffleNonce }),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.success) {
      showStatus("error", data.message || "Team generation failed");
      return;
    }

    setTeams(data.data);
    showStatus("success", reshuffleNonce > 0 ? "Teams reshuffled ⚽" : "Teams distributed successfully ⚽");
    onRefresh?.();
    // Only the first run downloads the sheet — reshuffling repeatedly would
    // otherwise bury the organiser in near-identical spreadsheets.
    if (reshuffleNonce === 0) downloadTeamExcel(data.data);

  } catch (err) {
    console.error("Error distributing teams:", err);
    showStatus("error", "Something went wrong");
  }
};

function downloadTeamExcel(result: {
  teamA: string[];
  teamB: string[];
  statsA?: { totalSkill?: number; totalGKQuotient?: number; playerCount?: number; positions?: Record<string, number> };
  statsB?: { totalSkill?: number; totalGKQuotient?: number; playerCount?: number; positions?: Record<string, number> };
  isBalanced?: boolean;
  skillDifference?: number;
  playerDetails?: Record<string, string>;
}) {
  const dateStr = scheduledAt
    ? upperMeridiem(new Date(scheduledAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }))
    : "N/A";
  const venueName = [venue, location].filter(Boolean).join(", ") || "N/A";
  const rows = Math.max(result.teamA.length, result.teamB.length);
  const sA   = result.statsA || {};
  const sB   = result.statsB || {};
  const pd   = result.playerDetails || {};

  const fmt = (name: string) => {
    const detail = pd[name];
    return detail ? `${name} (${detail})` : name;
  };

  const playerRows = Array.from({ length: rows }, (_, i) => `
    <tr>
      <td style="background:#fee2e2;color:#7f1d1d;padding:8px 12px;border:1px solid #fca5a5;">${result.teamA[i] ? fmt(result.teamA[i]) : ""}</td>
      <td style="background:#dbeafe;color:#1e3a8a;padding:8px 12px;border:1px solid #93c5fd;">${result.teamB[i] ? fmt(result.teamB[i]) : ""}</td>
    </tr>`).join("");

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"></head>
<body>
<table border="1" cellspacing="0" cellpadding="0" style="font-family:Arial,sans-serif;font-size:13px;border-collapse:collapse;">
  <tr>
    <td colspan="2" style="background:#111827;color:#fff;font-size:18px;font-weight:bold;text-align:center;padding:14px;">
      ⚽ ${gameName} — Team Distribution
    </td>
  </tr>
  <tr>
    <td style="background:#f3f4f6;font-weight:bold;padding:8px 12px;border:1px solid #d1d5db;">Date</td>
    <td style="padding:8px 12px;border:1px solid #d1d5db;">${dateStr}</td>
  </tr>
  <tr>
    <td style="background:#f3f4f6;font-weight:bold;padding:8px 12px;border:1px solid #d1d5db;">Venue</td>
    <td style="padding:8px 12px;border:1px solid #d1d5db;">${venueName}</td>
  </tr>
  ${format ? `<tr>
    <td style="background:#f3f4f6;font-weight:bold;padding:8px 12px;border:1px solid #d1d5db;">Format</td>
    <td style="padding:8px 12px;border:1px solid #d1d5db;">${format}</td>
  </tr>` : ""}
  <tr>
    <td style="background:#ef4444;color:#fff;font-weight:bold;font-size:15px;text-align:center;padding:10px;border:1px solid #dc2626;">
      🔴 Red Team (${result.teamA.length} players)
    </td>
    <td style="background:#3b82f6;color:#fff;font-weight:bold;font-size:15px;text-align:center;padding:10px;border:1px solid #2563eb;">
      🔵 Blue Team (${result.teamB.length} players)
    </td>
  </tr>
  ${playerRows}
  <tr>
    <td style="background:#fca5a5;font-weight:bold;padding:8px 12px;border:1px solid #f87171;">
      Skill: ${sA.totalSkill ?? "-"} &nbsp;|&nbsp; GK: ${sA.totalGKQuotient ?? "-"} &nbsp;|&nbsp; Players: ${sA.playerCount ?? result.teamA.length}
    </td>
    <td style="background:#93c5fd;font-weight:bold;padding:8px 12px;border:1px solid #60a5fa;">
      Skill: ${sB.totalSkill ?? "-"} &nbsp;|&nbsp; GK: ${sB.totalGKQuotient ?? "-"} &nbsp;|&nbsp; Players: ${sB.playerCount ?? result.teamB.length}
    </td>
  </tr>
  <tr>
    <td colspan="2" style="background:#f9fafb;text-align:center;padding:8px;border:1px solid #d1d5db;font-size:12px;color:#6b7280;">
      Balanced: ${result.isBalanced ? "✅ Yes" : "⚠️ No"} &nbsp;|&nbsp; Skill Difference: ${result.skillDifference ?? "-"} &nbsp;|&nbsp; Generated by Kasa Kai
    </td>
  </tr>
</table>
</body>
</html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${gameName.replace(/[^a-zA-Z0-9]/g, "_")}_teams.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
  const handleCopyTeams = () => {
    if (!teams) return;
    const pd = teams.playerDetails || {};
    const lines: string[] = [];

    // v2 decides which side wears which colour AFTER balancing, so team A is not
    // always red. Hardcoding it here would make the WhatsApp message contradict
    // the portal — and send half the squad in the wrong shirt.
    const colours = teams.colours || { A: "red", B: "blue" };
    const heading = (side: "A" | "B") =>
      colours[side] === "red" ? "🔴 *Red Team*" : "🔵 *Blue Team*";

    lines.push(`⚽ *${gameName}*`);
    if (scheduledAt) {
      const d = new Date(scheduledAt);
      lines.push(`📅 ${formatIstLongDate(d)} at ${formatIstTime(d)}`);
    }
    const venueParts = [venue, location].filter(Boolean);
    if (venueParts.length) lines.push(`📍 ${venueParts.join(", ")}`);
    if (format) lines.push(`🎮 Format: ${format}`);

    lines.push("");
    lines.push("─".repeat(28));
    lines.push(`${heading("A")} (${(teams.teamA || []).length} players)`);
    (teams.teamA || []).forEach((name: string, i: number) => {
      const detail = pd[name];
      lines.push(`${i + 1}. ${name}${detail ? ` (${detail})` : ""}`);
    });

    lines.push("");
    lines.push(`${heading("B")} (${(teams.teamB || []).length} players)`);
    (teams.teamB || []).forEach((name: string, i: number) => {
      const detail = pd[name];
      lines.push(`${i + 1}. ${name}${detail ? ` (${detail})` : ""}`);
    });

    lines.push("─".repeat(28));
    // Skill totals stay in the portal, not in the group chat — players comparing
    // their side's number against the other's is an argument nobody needs.
    lines.push("");
    lines.push(KASAKAI_SIGNOFF);

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopiedTeams(true);
      setTimeout(() => setCopiedTeams(false), 2500);
    });
  };

  const [processingId, setProcessingId] = useState<string | null>(null);
  // totalSlots is the hard cap (includes organiser slot when organiserIsPlaying)
  const organiserCount = organiserIsPlaying ? 1 : 0;

  const handleCopyList = () => {
    const organiserName = (typeof window !== "undefined" ? localStorage.getItem("userName") : null) || "Organiser";
    const text = buildPlayerListMessage({
      gameName,
      venue,
      scheduledAt,
      format,
      gameId,
      organiserIsPlaying,
      organiserName,
      activeRegs,
    });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // A player (or guest) removed because they said "No" to a format change is
  // treated like a cancellation — they should NOT appear in the organiser's roster
  // at all (not even as "Not Attending"). Neither should anyone who backed out:
  // their row survives in the API payload purely as history. Self opt-outs stay
  // visible. So all the display/count derivations below run off `roster`, not the
  // raw `players`.
  const roster = players.filter(
    (r) => !r.backedOutAt && !r.removedAt && !(r.optedOut && r.optedOutReason === "format_change")
  );

  const mainRegs  = roster.filter((r) => !r.plusOneName);
  const guestRegs = roster.filter((r) => !!r.plusOneName);

  // An organiser's filler guest has no host player: `addedByOrganiser` says so
  // outright. Rows written before that carry the organiser's own id in `player` — a
  // Player ref that never populates — so the id compare below still reads them.
  const loggedInOrgId = typeof window !== "undefined" ? (localStorage.getItem("userId") || "") : "";
  const isOrganiserGuest = (r: Registration) => {
    if (!r.plusOneName) return false;
    if ((r as any).addedByOrganiser) return true;
    if (!r.player) return true;
    return String((r.player as any)?._id ?? (r.player as any) ?? "") === loggedInOrgId;
  };
  const organiserGuests = roster.filter(isOrganiserGuest);
  // Player guests grouped by their owner's player ID (exclude organiser guests)
  const guestsByPlayer = new Map<string, Registration[]>();
  roster.filter((r) => {
    if (!r.plusOneName || !r.player) return false;
    return !isOrganiserGuest(r);
  }).forEach((r) => {
    const k = (r.player as any)?._id?.toString() ?? (r.player as any)?.toString() ?? "";
    if (k) {
      if (!guestsByPlayer.has(k)) guestsByPlayer.set(k, []);
      guestsByPlayer.get(k)!.push(r);
    }
  });
  // Only regs that actually occupy a slot (not backed out, not opted-out, not
  // refunded/forfeited)
  const activeRegs = players.filter(
    (r) => !r.backedOutAt && !r.removedAt && !r.optedOut && !['refunded', 'forfeited'].includes(r.paymentStatus || '')
  );
  // Derive from the registrations we're displaying (single source of truth) so the
  // count always matches the player/guest list shown below — rather than a
  // separately-broadcast spotsRemaining that can momentarily disagree.
  const spotsLeft = Math.max(0, totalSlots - activeRegs.length - organiserCount);
  const totalCollectedPaise = players.reduce(
    (sum, r) => sum + (r.paymentStatus === "paid" || r.paymentStatus === "wallet_locked" ? (r.amountPaidPaise || 0) : 0),
    0
  );

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content pdm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-section">
            <h2>Registered Players</h2>
            <p className="modal-subtitle">{gameName}</p>
          </div>
          <div className="pdm-header-actions">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="pdm-hdr-btn"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid #333",
                  color: isRefreshing ? "#555" : "#ccc",
                }}
                title="Refresh player list"
              >
                <span className="pdm-btn-icon">{isRefreshing ? "↻" : "↻"}</span>
                <span className="pdm-btn-label">{isRefreshing ? " Refreshing…" : " Refresh"}</span>
              </button>
            )}
            <button
              onClick={handleCopyList}
              className="pdm-hdr-btn"
              style={{
                background: copied ? "rgba(200,255,62,0.15)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${copied ? "rgba(200,255,62,0.4)" : "#333"}`,
                color: copied ? "#c8ff3e" : "#ccc",
              }}
              title="Copy player list to clipboard"
            >
              <span className="pdm-btn-icon">{copied ? "✓" : "📋"}</span>
              <span className="pdm-btn-label">{copied ? " Copied!" : " Copy List"}</span>
            </button>
            <button
              onClick={() => handleDistribute(0)}
              className="pdm-hdr-btn"
              style={{
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.3)",
                color: "#3b82f6",
              }}
              title="Auto distribute teams"
            >
              <span className="pdm-btn-icon">⚽</span>
              <span className="pdm-btn-label"> Distribute</span>
            </button>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="pdm-stats-strip">
          <div className="pdm-stat">
            <span className="pdm-stat-val">{activeRegs.length + organiserCount}</span>
            <span className="pdm-stat-lbl">Attending</span>
          </div>
          <div className="pdm-stat-div" />
          <div className="pdm-stat">
            <span className="pdm-stat-val">{mainRegs.filter(r => !r.optedOut).length + organiserCount}</span>
            <span className="pdm-stat-lbl">Players</span>
          </div>
          <div className="pdm-stat-div" />
          <div className="pdm-stat">
            <span className="pdm-stat-val">{guestRegs.length}</span>
            <span className="pdm-stat-lbl">Guests</span>
          </div>
          {mainRegs.some(r => r.optedOut) && (
            <>
              <div className="pdm-stat-div" />
              <div className="pdm-stat">
                <span className="pdm-stat-val" style={{ color: "#f59e0b" }}>
                  {mainRegs.filter(r => r.optedOut).length}
                </span>
                <span className="pdm-stat-lbl">Opted Out</span>
              </div>
            </>
          )}
          <div className="pdm-stat-div" />
          <div className="pdm-stat">
            <span className="pdm-stat-val">{totalSlots}</span>
            <span className="pdm-stat-lbl">Total Slots</span>
          </div>
          <div className="pdm-stat-div" />
          <div className="pdm-stat">
            <span
              className="pdm-stat-val"
              style={{ color: spotsLeft === 0 ? "var(--coral)" : "#4ade80" }}
            >
              {spotsLeft}
            </span>
            <span className="pdm-stat-lbl">Available</span>
          </div>
          {waitlist.length > 0 && (
            <>
              <div className="pdm-stat-div" />
              <div className="pdm-stat">
                <span className="pdm-stat-val" style={{ color: "#f59e0b" }}>{waitlist.length}</span>
                <span className="pdm-stat-lbl">Waitlist</span>
              </div>
            </>
          )}
          {totalCollectedPaise > 0 && (
            <>
              <div className="pdm-stat-div" />
              <div className="pdm-stat">
                <span className="pdm-stat-val" style={{ color: "#4ade80", fontSize: 13 }}>
                  ₹{totalCollectedPaise / 100}
                </span>
                <span className="pdm-stat-lbl">Collected</span>
              </div>
            </>
          )}
        </div>

        {/* Centered floating status message — replaces alert() dialogs */}
        {statusMsg && (
          <div style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 10000,
            padding: "16px 28px",
            borderRadius: 12,
            background: statusMsg.type === "success" ? "rgba(20,32,24,0.97)" : "rgba(34,18,18,0.97)",
            border: `1px solid ${statusMsg.type === "success" ? "rgba(74,222,128,0.4)" : "rgba(239,68,68,0.4)"}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            color: statusMsg.type === "success" ? "#4ade80" : "#f87171",
            fontSize: 15,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "90vw",
            textAlign: "center",
          }}>
            <span style={{ fontSize: 18 }}>{statusMsg.type === "success" ? "✓" : "✕"}</span>
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Add Player Search */}
        {showAddPlayer && (
          <div style={{ margin: "16px 0", padding: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid #333", borderRadius: "8px" }}>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#ccc" }}>
                Search Players
              </label>
              <input
                type="text"
                placeholder="Search by name, phone, or email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchPlayers(e.target.value);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid #444",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 14,
                }}
              />
            </div>

            {searching && (
              <div style={{ textAlign: "center", padding: "20px", color: "#888" }}>
                Searching...
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                {searchResults.map((player) => (
                  <div
                    key={player._id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      marginBottom: "4px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 6,
                      border: "1px solid #333",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: "rgba(200,255,62,0.1)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#c8ff3e",
                        }}
                      >
                        {initials(player.name)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
                          {player.name}
                        </div>
                        <div style={{ fontSize: 12, color: "#888" }}>
                          {player.phone} • Rating: {player.rating || 5}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => addPlayer(player._id)}
                      disabled={addingPlayerId === player._id}
                      style={{
                        background: addingPlayerId === player._id ? "rgba(200,255,62,0.2)" : "rgba(200,255,62,0.1)",
                        border: "1px solid rgba(200,255,62,0.3)",
                        color: "#c8ff3e",
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: addingPlayerId === player._id ? "not-allowed" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {addingPlayerId === player._id ? "Adding..." : "Add"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!searching && searchQuery && searchResults.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px", color: "#888" }}>
                No players found
              </div>
            )}
          </div>
        )}

        {/* ── Registered Players ── */}
        <div className="pdm-cards-scroll">
          {players.length === 0 && !organiserIsPlaying ? (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <p>No players registered yet</p>
            </div>
          ) : (
            <div className="pdm-cards-list">

              {/* Organiser group: card (if playing) + organiser's guests */}
              {(organiserIsPlaying || organiserGuests.length > 0 || (!isLocked && spotsLeft > 0)) && (
                <div className="pdm-group">
                  {organiserIsPlaying && (
                    <div className="pdm-card pdm-card-organiser">
                      <div className="pdm-slot-num">#1</div>
                      <div className="pdm-avatar pdm-avatar-o">YOU</div>
                      <div className="pdm-card-body">
                        <div className="pdm-card-top">
                          <div className="pdm-card-name">You (Organiser)</div>
                          <span className="pdm-type-chip pdm-chip-organiser">Organiser</span>
                        </div>
                        <div className="pdm-card-tags">
                          <span className="pdm-pos-tag" style={{ background: "rgba(200,255,62,0.12)", color: "#c8ff3e", border: "1px solid rgba(200,255,62,0.3)" }}>
                            ⚽ Playing
                          </span>
                        </div>
                      </div>
                      {onToggleOrganiserPlaying && !isLocked && (
                        <button
                          onClick={onToggleOrganiserPlaying}
                          title="Withdraw from game"
                          style={{
                            flexShrink: 0,
                            alignSelf: "center",
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            background: "rgba(220,38,38,0.1)",
                            border: "1px solid rgba(220,38,38,0.3)",
                            color: "#f87171",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                  {organiserGuests.length > 0 && (
                    <div className="pdm-guest-group">
                      {organiserGuests.map((reg, i) => {
                        const regId = reg._id || "";
                        const slotNum = organiserCount + i + 1;
                        return (
                          <PlayerCard
                            key={regId || `og-${i}`}
                            reg={reg}
                            slotNum={slotNum}
                            type="guest"
                            gameFeeInPaise={feeInPaise}
                            isProcessing={processingId === regId}
                            onRemove={
                              onRemoveRegistration && regId && !isLocked
                                ? async () => {
                                    const doRemove = async () => {
                                      setProcessingId(regId);
                                      try {
                                        await onRemoveRegistration(regId);
                                      } catch {
                                        showStatus("error", "Failed to remove player. Please try again.");
                                      } finally {
                                        setProcessingId(null);
                                      }
                                    };
                                    setConfirmMessage(`Remove ${reg.plusOneName} from your guest list?`);
                                    confirmActionRef.current = doRemove;
                                    setConfirmVisible(true);
                                  }
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                  {!isLocked && spotsLeft > 0 && (
                    <button
                      onClick={() => { setPendingGuestName(""); setPendingGuestPosition("Any"); setPendingGuestTeam("No Preference"); setGuestModalOpen(true); }}
                      style={{
                        width: "100%", marginTop: 6, padding: "8px 0",
                        background: "rgba(200,255,62,0.06)", border: "1px dashed rgba(200,255,62,0.3)",
                        borderRadius: 8, color: "#c8ff3e", fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      + Add Guest
                    </button>
                  )}
                </div>
              )}

              {/* Main players + their guests — grouped */}
              {(() => {
                let slot = organiserCount + organiserGuests.length;
                return mainRegs.map((reg) => {
                  slot++;
                  const regId   = reg._id || "";
                  const playerId = (reg.player as any)?._id?.toString()
                    ?? (reg.player as any)?.toString()
                    ?? "";
                  const myGuests = guestsByPlayer.get(playerId) ?? [];

                  return (
                    <div className="pdm-group" key={regId || `mp-${slot}`}>
                      <PlayerCard
                        reg={reg}
                        slotNum={slot}
                        type="player"
                        gameFeeInPaise={feeInPaise}
                        isProcessing={processingId === regId}
                        onRemove={undefined}
                      />
                      {myGuests.length > 0 && (
                        <div className="pdm-guest-group">
                          {myGuests.map((gReg) => {
                            slot++;
                            const gId = gReg._id || "";
                            return (
                              <PlayerCard
                                key={gId || `pg-${slot}`}
                                reg={gReg}
                                slotNum={slot}
                                type="guest"
                                gameFeeInPaise={feeInPaise}
                                isProcessing={processingId === gId}
                                onRemove={undefined}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

            </div>
          )}

          {/* Waitlist Section — inside scroll area so it doesn't overflow */}
          {waitlist.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 0 10px 0", borderTop: "1px solid #222",
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#f59e0b" }}>
                  📋 Waitlist ({waitlist.length})
                </span>
                <span style={{ fontSize: 11, color: "#666", fontStyle: "italic" }}>
                  — notified by email &amp; app when a slot opens
                </span>
              </div>
              <div className="pdm-cards-list">
                {waitlist.map((entry, idx) => {
                  const playerId = entry.player?._id;
                  const gc = playerId
                    ? (guestWaitlist || []).filter(
                        (g) => g.player?._id === playerId && ["waiting", "notified"].includes(g.status || "waiting")
                      ).length
                    : 0;
                  const registeredGc = playerId
                    ? (players || []).filter(
                        (p) => p.player?._id === playerId && p.plusOneName
                      ).length
                    : 0;
                  return (
                    <WaitlistCard
                      key={entry._id || idx}
                      entry={entry}
                      position={idx + 1}
                      onApprove={entry.status === "waiting" && entry._id && !isLocked ? () => approveWaitlistEntry(entry._id!) : undefined}
                      isApproving={approvingId === entry._id}
                      guestCount={gc}
                      registeredGuestCount={registeredGc}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Guest Waitlist Section */}
          {guestWaitlist.filter(g => ["waiting", "notified"].includes(g.status || "waiting")).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 0 10px 0", borderTop: "1px solid #222",
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#a78bfa" }}>
                  👥 Guest Waitlist ({guestWaitlist.filter(g => ["waiting", "notified"].includes(g.status || "waiting")).length})
                </span>
                <span style={{ fontSize: 11, color: "#666", fontStyle: "italic" }}>
                  — players waiting to confirm their guests
                </span>
              </div>
              <div className="pdm-cards-list">
                {guestWaitlist
                  .filter(g => ["waiting", "notified"].includes(g.status || "waiting"))
                  .map((entry, idx) => (
                    <GuestWaitlistCard key={entry._id || idx} entry={entry} position={idx + 1} />
                  ))}
              </div>
            </div>
          )}

          {/* Teams — inside scroll area */}
          {teams && (
            <TeamDistributionPanel
              gameId={gameId}
              teams={teams}
              onDistribute={handleDistribute}
              // Merged, not replaced: a move returns the teams, not the extras
              // the distribute response carried (playerDetails, for one, which
              // the WhatsApp copy reads).
              onTeamsChanged={(result) => setTeams((prev: any) => ({ ...prev, ...result }))}
              onRefresh={onRefresh}
              showStatus={showStatus}
              copySlot={
                <button
                  onClick={handleCopyTeams}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 12px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    border: `1px solid ${copiedTeams ? "rgba(200,255,62,0.4)" : "rgba(74,222,128,0.3)"}`,
                    background: copiedTeams ? "rgba(200,255,62,0.15)" : "rgba(74,222,128,0.08)",
                    color: copiedTeams ? "#c8ff3e" : "#4ade80",
                    transition: "all 0.2s",
                  }}
                  title="Copy teams for WhatsApp"
                >
                  <span>{copiedTeams ? "✓" : "📋"}</span>
                  <span>{copiedTeams ? "Copied!" : "Copy Teams"}</span>
                </button>
              }
            />
          )}

        </div>

        <div className="modal-footer">
          <button className="btn-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
    {/* ── Add Guest Mini-Modal ── */}
    {guestModalOpen && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setGuestModalOpen(false)}>
        <div style={{ background: "#0f0f1e", border: "1px solid #333", borderRadius: 12, padding: "24px 20px", width: "100%", maxWidth: 360 }}
          onClick={(e) => e.stopPropagation()}>
          <h3 style={{ color: "#c8ff3e", margin: "0 0 4px", fontSize: 17 }}>Add Guest</h3>
          <p style={{ color: "#666", fontSize: 12, margin: "0 0 20px" }}>Set guest name, position and team preference.</p>

          {/* Guest Name */}
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 6 }}>Guest Name (optional)</label>
          <input
            type="text"
            value={pendingGuestName}
            onChange={(e) => setPendingGuestName(e.target.value)}
            placeholder="e.g. Rahul"
            maxLength={40}
            autoFocus
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #444", borderRadius: 7, padding: "9px 12px", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" as const, marginBottom: 18 }}
            onFocus={(e) => (e.target.style.borderColor = "#c8ff3e")}
            onBlur={(e) => (e.target.style.borderColor = "#444")}
          />

          {/* Position */}
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 8 }}>Position</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {(["Any", "GK", "DEF", "MID", "FWD"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setPendingGuestPosition(pos)}
                style={{
                  flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: pendingGuestPosition === pos ? "rgba(200,255,62,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${pendingGuestPosition === pos ? "rgba(200,255,62,0.5)" : "#333"}`,
                  color: pendingGuestPosition === pos ? "#c8ff3e" : "#888",
                }}
              >
                {pos}
              </button>
            ))}
          </div>

          {/* Team Preference */}
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 8 }}>Team</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
            {(["No Pref", "Red Team", "Blue Team"] as const).map((t) => {
              const active = pendingGuestTeam === t || (t === "No Pref" && pendingGuestTeam === "No Preference");
              const activeColor = t === "Red Team" ? "#f87171" : t === "Blue Team" ? "#60a5fa" : "#888";
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPendingGuestTeam(t === "No Pref" ? "No Preference" : t)}
                  style={{
                    flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    background: active ? `${activeColor}22` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? `${activeColor}88` : "#333"}`,
                    color: active ? activeColor : "#888",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setGuestModalOpen(false)}
              style={{ flex: 1, padding: 10, borderRadius: 7, background: "transparent", border: "1px solid #444", color: "#888", fontSize: 14, cursor: "pointer" }}>
              Cancel
            </button>
            <button type="button" disabled={addingGuest}
              onClick={() => { setGuestModalOpen(false); addOrganiserGuest(pendingGuestName, pendingGuestPosition, pendingGuestTeam); }}
              style={{ flex: 2, padding: 10, borderRadius: 7, background: "#c8ff3e", color: "#000", fontSize: 14, fontWeight: 700, border: "none", cursor: addingGuest ? "not-allowed" : "pointer", opacity: addingGuest ? 0.7 : 1 }}>
              {addingGuest ? "Adding…" : "Add Guest"}
            </button>
          </div>
        </div>
      </div>
    )}
    <ConfirmationModal
      open={confirmVisible}
      title="Remove player"
      message={confirmMessage || "Are you sure you want to continue?"}
      confirmLabel="Remove"
      cancelLabel="Keep player"
      loading={processingId !== null}
      onCancel={() => {
        setConfirmVisible(false);
        confirmActionRef.current = null;
        setConfirmMessage(null);
      }}
      onConfirm={async () => {
        setConfirmVisible(false);
        const act = confirmActionRef.current;
        confirmActionRef.current = null;
        setConfirmMessage(null);
        if (act) {
          await act();
        }
      }}
    />
    </>
  );
}

const WAITLIST_STATUS_CFG: Record<string, { label: string; bg: string; color: string; border: string; leftBorder: string }> = {
  waiting:  { label: "Waiting",    bg: "rgba(245,158,11,0.08)",  color: "#f59e0b", border: "rgba(245,158,11,0.18)", leftBorder: "#f59e0b" },
  notified: { label: "Slot Open",  bg: "rgba(34,197,94,0.08)",   color: "#4ade80", border: "rgba(74,222,128,0.25)", leftBorder: "#4ade80" },
  expired:  { label: "Expired",    bg: "rgba(239,68,68,0.06)",   color: "#f87171", border: "rgba(239,68,68,0.2)",  leftBorder: "#f87171" },
  registered:{ label: "Registered",bg: "rgba(96,165,250,0.08)", color: "#60a5fa", border: "rgba(96,165,250,0.2)", leftBorder: "#60a5fa" },
};

function WaitlistCard({ entry, position, onApprove, isApproving, guestCount, registeredGuestCount }: {
  entry: WaitlistEntry;
  position: number;
  onApprove?: () => void;
  isApproving?: boolean;
  guestCount?: number;
  registeredGuestCount?: number;
}) {
  const status  = entry.status || "waiting";
  const isRejoin = entry.source === "opted_out_rejoin";
  const cfg     = isRejoin
    ? { bg: "rgba(167,139,250,0.06)", color: "#a78bfa", border: "rgba(167,139,250,0.25)", leftBorder: "#a78bfa", label: "Opted Out — Rejoining" }
    : (WAITLIST_STATUS_CFG[status] ?? WAITLIST_STATUS_CFG.waiting);
  const name    = entry.player?.name || "Unknown";
  const pos     = posLabel(entry.preferredPosition);
  const isNotified = status === "notified";
  const isApproved = status === "approved";
  const imgSrc  = entry.player?.profileImage
    ? (entry.player.profileImage.startsWith("http") ? entry.player.profileImage : `${IMG_BASE}${entry.player.profileImage}`)
    : null;
  const [imgFailed, setImgFailed] = React.useState(false);

  return (
    <div
      className="pdm-card pdm-card-player"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderLeft: `3px solid ${cfg.leftBorder}` }}
    >
      <div className="pdm-slot-num" style={{ color: cfg.color }}>#{position}</div>
      <div
        className="pdm-avatar pdm-avatar-p"
        style={{ background: `${cfg.leftBorder}22`, color: cfg.color, border: `1px solid ${cfg.border}`, padding: 0, overflow: "hidden" }}
      >
        {imgSrc && !imgFailed
          ? <img src={imgSrc} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }} onError={() => setImgFailed(true)} />
          : initials(name)
        }
      </div>
      <div className="pdm-card-body">
        <div className="pdm-card-top">
          <div className="pdm-card-name">{name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              className="pdm-type-chip"
              style={{ background: `${cfg.leftBorder}22`, color: cfg.color, border: `1px solid ${cfg.border}` }}
            >
              {cfg.label}
            </span>
          </div>
        </div>

        {isRejoin && (
          <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>↩</span>
            <span>Opted out — waiting to rejoin when a slot opens</span>
          </div>
        )}
        {isRejoin && (registeredGuestCount ?? 0) > 0 && (
          <div style={{ fontSize: 11, color: "#c8ff3e", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>⚽</span>
            <span>{registeredGuestCount} guest{(registeredGuestCount ?? 0) > 1 ? "s" : ""} already registered in game</span>
          </div>
        )}
        {isNotified && (
          <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>🔔</span>
            <span>Slot available — awaiting player confirmation</span>
          </div>
        )}
        {isApproved && (
          <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>✅</span>
            <span>Approved — will be notified when a slot opens</span>
          </div>
        )}
        {guestCount != null && guestCount > 0 && (
          <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>👥</span>
            <span>{guestCount} guest{guestCount > 1 ? "s" : ""} also on waitlist</span>
          </div>
        )}

        {(entry.player?.phone || entry.player?.email) && (
          <div className="pdm-card-contact">
            {entry.player?.phone && (
              <span className="pdm-contact-item"><span className="pdm-contact-icon">📞</span>{entry.player.phone}</span>
            )}
            {entry.player?.email && (
              <span className="pdm-contact-item pdm-email-item"><span className="pdm-contact-icon">✉</span>{entry.player.email}</span>
            )}
          </div>
        )}

        <div className="pdm-card-tags">
          {pos && <span className="pdm-pos-tag">{pos}</span>}
          {entry.joinedAt && <span className="pdm-date-tag">Joined {fmtDate(entry.joinedAt)}</span>}
        </div>
      </div>
    </div>
  );
}

const GUEST_WAITLIST_STATUS_CFG: Record<string, { label: string; bg: string; color: string; border: string; leftBorder: string }> = {
  waiting:   { label: "Waiting",   bg: "rgba(167,139,250,0.08)", color: "#a78bfa", border: "rgba(167,139,250,0.2)",  leftBorder: "#a78bfa" },
  notified:  { label: "Notified",  bg: "rgba(34,197,94,0.08)",   color: "#4ade80", border: "rgba(74,222,128,0.25)", leftBorder: "#4ade80" },
  confirmed: { label: "Confirmed", bg: "rgba(96,165,250,0.08)",  color: "#60a5fa", border: "rgba(96,165,250,0.2)",  leftBorder: "#60a5fa" },
  expired:   { label: "Expired",   bg: "rgba(239,68,68,0.06)",   color: "#f87171", border: "rgba(239,68,68,0.2)",   leftBorder: "#f87171" },
};

function GuestWaitlistCard({ entry, position }: { entry: GuestWaitlistEntry; position: number }) {
  const status    = entry.status || "waiting";
  const cfg       = GUEST_WAITLIST_STATUS_CFG[status] ?? GUEST_WAITLIST_STATUS_CFG.waiting;
  const guestName = entry.plusOneName || "Unknown guest";
  const ownerName = entry.player?.name || "Unknown player";

  return (
    <div
      className="pdm-card pdm-card-player"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderLeft: `3px solid ${cfg.leftBorder}` }}
    >
      <div className="pdm-slot-num" style={{ color: cfg.color }}>#{position}</div>
      <div
        className="pdm-avatar pdm-avatar-p"
        style={{ background: `${cfg.leftBorder}22`, color: cfg.color, border: `1px solid ${cfg.border}` }}
      >
        {initials(guestName)}
      </div>
      <div className="pdm-card-body">
        <div className="pdm-card-top">
          <div>
            <div className="pdm-card-name">{guestName}</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>via {ownerName}</div>
          </div>
          <span
            className="pdm-type-chip"
            style={{ background: `${cfg.leftBorder}22`, color: cfg.color, border: `1px solid ${cfg.border}` }}
          >
            {cfg.label}
          </span>
        </div>
        {status === "notified" && (
          <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 600, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span>🔔</span>
            <span>Slot available — awaiting player confirmation</span>
          </div>
        )}
        {entry.requestedAt && (
          <div className="pdm-card-tags">
            <span className="pdm-date-tag">Requested {fmtDate(entry.requestedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const PAYMENT_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  paid:          { label: "Paid",     bg: "rgba(74,222,128,0.12)",  color: "#4ade80" },
  wallet_locked: { label: "Locked",   bg: "rgba(167,139,250,0.12)", color: "#a78bfa" },
  pending:       { label: "Pending",  bg: "rgba(245,158,11,0.12)",  color: "#f59e0b" },
  refunded:      { label: "Refunded", bg: "rgba(96,165,250,0.12)",  color: "#60a5fa" },
  forfeited:     { label: "Forfeited",bg: "rgba(248,113,113,0.12)", color: "#f87171" },
};

function PaymentBadge({ status, amountPaise, gameFeeInPaise }: { status?: string; amountPaise?: number; gameFeeInPaise?: number }) {
  if (!status) return null;
  // Pass-covered: paid status but ₹0 on a game that has a fee
  const isPassCovered = status === "paid" && amountPaise === 0 && (gameFeeInPaise || 0) > 0;
  if (isPassCovered) {
    return (
      <span style={{
        background: "rgba(200,255,62,0.1)", color: "#c8ff3e",
        border: "1px solid rgba(200,255,62,0.3)",
        borderRadius: 4, padding: "2px 7px",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        🎟 Pass
      </span>
    );
  }
  const cfg = PAYMENT_BADGE[status];
  if (!cfg) return null;
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}44`,
      borderRadius: 4, padding: "2px 7px",
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {cfg.label}
      {amountPaise != null && amountPaise > 0 && (
        <span style={{ opacity: 0.8 }}>₹{amountPaise / 100}</span>
      )}
    </span>
  );
}

function PlayerCard({
  reg,
  slotNum,
  type,
  isProcessing,
  onRemove,
  gameFeeInPaise,
}: {
  reg: Registration;
  slotNum?: number;
  type: "player" | "guest";
  isProcessing?: boolean;
  onRemove?: () => void;
  gameFeeInPaise?: number;
}) {
  const isGuest = type === "guest";
  const name    = isGuest ? (reg.plusOneName ?? "Guest") : (reg.player?.name ?? "Unknown");
  const pos     = posLabel(reg.preferredPosition);
  const team    = teamInfo(reg.teamPreference);
  const date    = fmtDate(reg.signedUpAt);
  const imgSrc  = !isGuest && reg.player?.profileImage
    ? (reg.player.profileImage.startsWith("http") ? reg.player.profileImage : `${IMG_BASE}${reg.player.profileImage}`)
    : null;
  const [imgFailed, setImgFailed] = React.useState(false);

  const optedOut = !isGuest && reg.optedOut === true;

  return (
    <div className={`pdm-card ${isGuest ? "pdm-card-guest" : "pdm-card-player"}`} style={optedOut ? { opacity: 0.6 } : undefined}>
      {slotNum !== undefined && <div className="pdm-slot-num">#{slotNum}</div>}

      <div className={`pdm-avatar ${isGuest ? "pdm-avatar-g" : "pdm-avatar-p"}`} style={{ padding: 0, overflow: "hidden" }}>
        {imgSrc && !imgFailed
          ? <img src={imgSrc} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }} onError={() => setImgFailed(true)} />
          : initials(name)
        }
      </div>

      <div className="pdm-card-body">
        <div className="pdm-card-top">
          <div className="pdm-card-name">{name}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {optedOut ? (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", padding: "3px 8px", borderRadius: 20,
                background: "rgba(245,158,11,0.12)", color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.3)",
              }}>Not Attending</span>
            ) : (
              <PaymentBadge status={reg.paymentStatus} amountPaise={reg.amountPaidPaise} gameFeeInPaise={gameFeeInPaise} />
            )}
            <span className={`pdm-type-chip ${isGuest ? "pdm-chip-guest" : "pdm-chip-player"}`}>
              {isGuest ? "Guest" : "Player"}
            </span>
          </div>
        </div>

        {/* Preferences row — shown for ALL registrations with pos or team set */}
        {(pos || team) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {pos && (
              <span className="pdm-pos-tag">{pos}</span>
            )}
            {team && (
              <span className={`pdm-team-tag ${team.cls}`}>{team.label}</span>
            )}
          </div>
        )}
        {isGuest && !pos && !team && (
          <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>No preferences set</div>
        )}

        {!isGuest && (reg.player?.phone || reg.player?.email) && (
          <div className="pdm-card-contact">
            {reg.player?.phone && (
              <span className="pdm-contact-item">
                <span className="pdm-contact-icon">📞</span>
                {reg.player.phone}
              </span>
            )}
            {reg.player?.email && (
              <span className="pdm-contact-item pdm-email-item">
                <span className="pdm-contact-icon">✉</span>
                {reg.player.email}
              </span>
            )}
          </div>
        )}

        <div className="pdm-card-tags">
          {date && <span className="pdm-date-tag">{date}</span>}
        </div>
      </div>

      {/* Remove button — visible for every slot */}
      {onRemove && (
        <button
          disabled={isProcessing}
          onClick={onRemove}
          title={`Remove ${name}`}
          style={{
            flexShrink: 0,
            alignSelf: "center",
            width: 28,
            height: 28,
            borderRadius: 6,
            background: isProcessing ? "rgba(220,38,38,0.05)" : "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.3)",
            color: "#f87171",
            fontSize: 14,
            lineHeight: 1,
            cursor: isProcessing ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isProcessing ? "…" : "✕"}
        </button>
      )}
    </div>
  );
}
