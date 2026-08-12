"use client";

import React, { useState } from "react";
import { buildApiUrl, getAuthHeaders } from "@/utils/api";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

/**
 * Distributed teams, why they came out that way, and what to do next.
 *
 * Degrades on purpose: the v1 algorithm returns names and a skill difference and
 * nothing else, so the colour labels, reasoning, warnings, pinning, publishing
 * and reshuffling only appear when the response came from v2. That lets the
 * portal keep working while TEAM_DISTRIBUTION_V2 is still off.
 */

export type Assignment = {
  id: string;
  name: string;
  team: "A" | "B";
  colour: "red" | "blue";
  colourOutcome?: "granted" | "denied" | "rationed" | "superseded" | "none";
  colourReason?: string | null;
};

export type DistributionResult = {
  version?: number;
  runId?: string;
  teamA: string[];
  teamB: string[];
  statsA?: Record<string, any>;
  statsB?: Record<string, any>;
  isBalanced?: boolean;
  skillDifference?: number;
  quality?: "excellent" | "good" | "fair" | "poor";
  colours?: { A: "red" | "blue"; B: "red" | "blue" };
  colourSummary?: Record<string, number>;
  assignments?: Assignment[];
  warnings?: string[];
  reasoningLog?: string[];
};

type ShowStatus = (type: "success" | "error", message: string) => void;

const QUALITY_TONE: Record<string, { fg: string; bg: string; label: string }> = {
  excellent: { fg: "#4ade80", bg: "rgba(74,222,128,0.12)",  label: "Excellent balance" },
  good:      { fg: "#c8ff3e", bg: "rgba(200,255,62,0.12)",  label: "Good balance" },
  fair:      { fg: "#f59e0b", bg: "rgba(245,158,11,0.12)",  label: "Fair balance" },
  poor:      { fg: "#f87171", bg: "rgba(248,113,113,0.12)", label: "Poor balance" },
};

const OUTCOME_TONE: Record<string, { fg: string; label: string }> = {
  granted:    { fg: "#4ade80", label: "got their colour" },
  denied:     { fg: "#f59e0b", label: "colour not possible" },
  rationed:   { fg: "#f59e0b", label: "colour was full" },
  superseded: { fg: "#9ca3af", label: "kept with their group" },
};

const COLOUR_STYLE = (colour: "red" | "blue") =>
  colour === "red"
    ? { fg: "#f87171", bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.2)",  label: "Red / White" }
    : { fg: "#60a5fa", bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.2)", label: "Blue / Black" };

export function TeamDistributionPanel({
  gameId,
  gameStatus,
  teams,
  onDistribute,
  onTeamsChanged,
  onRefresh,
  showStatus,
  copySlot,
}: {
  gameId: string;
  /** Drives the publish warning — publishing an unconfirmed game confirms it. */
  gameStatus?: string;
  teams: DistributionResult;
  onDistribute: (reshuffleNonce: number) => Promise<void>;
  /** Hand back a fresh distribution result — a manual move rewrites the teams. */
  onTeamsChanged?: (result: DistributionResult) => void;
  onRefresh?: () => void;
  showStatus: ShowStatus;
  copySlot?: React.ReactNode;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [published, setPublished] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [pinned, setPinned] = useState<Record<string, "A" | "B" | null>>({});
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  // The backend confirms an open/tentative game as part of publishing, so the
  // organiser has to be told that before they press it — a status change is not
  // something to discover afterwards.
  const publishConfirmsGame = gameStatus === "open" || gameStatus === "tentative";

  const isV2 = teams.version === 2;
  const colours = teams.colours || { A: "red" as const, B: "blue" as const };
  const byTeam = (side: "A" | "B") => (teams.assignments || []).filter((a) => a.team === side);

  // Colour is a label v2 puts on a partition after balancing, so team A is not
  // always red — left/right would otherwise flip between runs of the same game.
  // Pin the columns to the colours instead: Red/White left, Blue/Black right,
  // the way the organiser reads them out to two sets of shirts.
  const sideOrder: ("A" | "B")[] = colours.A === "red" ? ["A", "B"] : ["B", "A"];

  const publish = async () => {
    setBusy("publish");
    try {
      setConfirmingPublish(false);
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/teams/publish`), {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Couldn't publish teams");
        return;
      }
      setPublished(true);
      // Say what actually went out. "Published" alone hides a WhatsApp campaign
      // that is rejecting every send.
      const wa = data.data?.whatsapp;
      const waNote = wa
        ? ` · WhatsApp ${wa.sent} sent${wa.failed ? `, ${wa.failed} failed` : ""}`
        : "";
      const confirmedNote = data.data?.gameConfirmed ? " and the game confirmed" : "";
      showStatus(
        "success",
        `Teams published${confirmedNote} — ${data.data?.published ?? 0} player(s) notified${waNote}`
      );
      onRefresh?.();
    } catch {
      showStatus("error", "Couldn't publish teams");
    } finally {
      setBusy(null);
    }
  };

  const reshuffle = async () => {
    const next = nonce + 1;
    setBusy("reshuffle");
    try {
      setNonce(next);
      await onDistribute(next);
      // A reshuffle replaces the previous run, so anything published no longer
      // describes the teams on screen.
      setPublished(false);
    } finally {
      setBusy(null);
    }
  };

  // Send one player across to the other side, now. The opposite of pinning:
  // this changes the teams on screen, a pin only constrains the next shuffle.
  const move = async (assignment: Assignment) => {
    setBusy(`move:${assignment.id}`);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/teams/move`), {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: assignment.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Couldn't move that player");
        return;
      }
      onTeamsChanged?.(data.data);
      // The teams are no longer the ones anyone was told about.
      setPublished(false);
      showStatus("success", data.message || `${assignment.name} moved`);
      onRefresh?.();
    } catch {
      showStatus("error", "Couldn't move that player");
    } finally {
      setBusy(null);
    }
  };

  // Pin a player to the side they are currently on (or release them). Takes
  // effect on the NEXT distribution — saying so avoids the impression that
  // nothing happened.
  const togglePin = async (assignment: Assignment) => {
    const current = pinned[assignment.id];
    const nextValue = current ? null : assignment.team;
    setBusy(`pin:${assignment.id}`);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${gameId}/registrations/${assignment.id}/distribution`),
        {
          method: "PATCH",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ lockedTeam: nextValue }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus("error", data.message || "Couldn't update the pin");
        return;
      }
      setPinned((p) => ({ ...p, [assignment.id]: nextValue }));
      showStatus(
        "success",
        nextValue
          ? `${assignment.name} pinned — re-distribute to apply`
          : `${assignment.name} unpinned`
      );
    } catch {
      showStatus("error", "Couldn't update the pin");
    } finally {
      setBusy(null);
    }
  };

  const quality = teams.quality ? QUALITY_TONE[teams.quality] : null;

  const renderSide = (side: "A" | "B") => {
    const style = COLOUR_STYLE(colours[side]);
    const otherStyle = COLOUR_STYLE(colours[side === "A" ? "B" : "A"]);
    const rows = byTeam(side);
    const names = side === "A" ? teams.teamA : teams.teamB;
    const stats = side === "A" ? teams.statsA : teams.statsB;

    return (
      <div key={side} style={{ flex: 1, background: style.bg, border: `1px solid ${style.border}`, borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: style.fg, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {style.label}
          </div>
          {stats?.playerCount != null && (
            <div style={{ fontSize: 10.5, color: "#777" }}>
              {stats.playerCount} players
              {typeof stats.averageSkill === "number" ? ` · avg ${stats.averageSkill}` : ""}
            </div>
          )}
        </div>

        {isV2 && rows.length > 0
          ? rows.map((a) => {
            const tone = a.colourOutcome ? OUTCOME_TONE[a.colourOutcome] : null;
            const isPinned = pinned[a.id] != null;
            return (
              <div
                key={a.id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, color: "#e5e5e5", padding: "5px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {/* Which side someone is on is the organiser's decision to make
                    public; who keeps goal is not. The distributor still splits
                    the keepers — it just isn't announced on the team list. */}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </span>
                {tone && a.colourOutcome !== "none" && (
                  <span title={a.colourReason || undefined} style={{ fontSize: 10, color: tone.fg, whiteSpace: "nowrap" }}>
                    {tone.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => move(a)}
                  disabled={busy != null}
                  title={`Move ${a.name} to ${otherStyle.label}`}
                  aria-label={`Move ${a.name} to ${otherStyle.label}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "2px 7px", borderRadius: 5,
                    fontSize: 10, fontWeight: 700, lineHeight: 1.6,
                    whiteSpace: "nowrap",
                    cursor: busy != null ? "wait" : "pointer",
                    border: `1px solid ${otherStyle.fg}55`,
                    background: `${otherStyle.fg}14`,
                    color: otherStyle.fg,
                  }}
                >
                  {busy === `move:${a.id}` ? "…" : `⇄ ${colours[side] === "red" ? "Blue" : "Red"}`}
                </button>
                <button
                  type="button"
                  onClick={() => togglePin(a)}
                  disabled={busy != null}
                  title={isPinned ? "Unpin from this team" : "Pin to this team for the next distribution"}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    fontSize: 12, opacity: isPinned ? 1 : 0.35, lineHeight: 1,
                  }}
                >
                  📌
                </button>
              </div>
            );
          })
          : (names || []).map((n: any, i: number) => (
            <div key={i} style={{ fontSize: 13, color: "#e5e5e5", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {n?.name || n}
            </div>
          ))}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 20, paddingBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#ccc", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            ⚽ Teams
          </div>
          {quality && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: quality.fg, background: quality.bg, border: `1px solid ${quality.fg}44`, borderRadius: 20, padding: "3px 9px" }}>
              {quality.label}
              {typeof teams.skillDifference === "number" ? ` · skill gap ${teams.skillDifference}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {copySlot}
          {isV2 && (
            <>
              <button
                onClick={reshuffle}
                disabled={busy != null}
                style={btn("#a78bfa", busy === "reshuffle")}
                title="Produce a different valid split"
              >
                🔀 {busy === "reshuffle" ? "Shuffling…" : "Reshuffle"}
              </button>
              <button
                onClick={() => setConfirmingPublish(true)}
                disabled={busy != null || published}
                style={btn(published ? "#4ade80" : "#c8ff3e", busy === "publish")}
                title={
                  publishConfirmsGame
                    ? "Show these teams to the players, notify them, and confirm the game"
                    : "Show these teams to the players and notify them"
                }
              >
                {published ? "✓ Published" : busy === "publish" ? "Publishing…" : "📣 Publish"}
              </button>
            </>
          )}
        </div>
      </div>

      {isV2 && teams.warnings && teams.warnings.length > 0 && (
        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)" }}>
          {teams.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "#f0b429", lineHeight: 1.6 }}>⚠️ {w}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {sideOrder.map((side) => renderSide(side))}
      </div>

      {isV2 && teams.reasoningLog && teams.reasoningLog.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowReasoning((v) => !v)}
            style={{ background: "none", border: "none", color: "#8b8b8b", fontSize: 11.5, cursor: "pointer", padding: 0, fontWeight: 600 }}
          >
            {showReasoning ? "▾" : "▸"} Why these teams?
          </button>
          {showReasoning && (
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, color: "#9a9a9a", fontSize: 11.5, lineHeight: 1.75 }}>
              {teams.reasoningLog.map((line, i) => <li key={i}>{line}</li>)}
            </ol>
          )}
        </div>
      )}

      {isV2 && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: "#666", lineHeight: 1.6 }}>
          Players only see their side once you press Publish
          {publishConfirmsGame ? ", which also confirms the game" : ""}. ⇄ swaps a player over
          straight away; 📌 pins them for the next distribution. Past announcements live under the
          game card&apos;s Actions ▸ Team history.
        </div>
      )}

      <ConfirmationModal
        open={confirmingPublish}
        loading={busy === "publish"}
        title={publishConfirmsGame ? "Publish teams and confirm the game?" : "Publish these teams?"}
        message={
          publishConfirmsGame
            ? "Every player gets their shirt colour on WhatsApp and in the app — and this confirms the game, so they will be told it is going ahead.\n\nThe game's status changes to Confirmed. You can still reshuffle or move players afterwards, but they will have already been told."
            : "Every player gets their shirt colour on WhatsApp and in the app.\n\nYou can still reshuffle or move players afterwards, but they will have already been told."
        }
        confirmLabel={publishConfirmsGame ? "Publish & confirm" : "Publish"}
        onConfirm={publish}
        onCancel={() => setConfirmingPublish(false)}
      />
    </div>
  );
}

const btn = (accent: string, loading: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "5px 12px", borderRadius: 6,
  fontSize: 12, fontWeight: 700,
  cursor: loading ? "wait" : "pointer",
  border: `1px solid ${accent}55`,
  background: `${accent}14`,
  color: accent,
  transition: "all 0.2s",
});
