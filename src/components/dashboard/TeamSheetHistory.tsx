"use client";

import React, { useCallback, useEffect, useState } from "react";
import { buildApiUrl, getAuthHeaders } from "@/utils/api";

/**
 * Every time these teams were announced, newest first.
 *
 * Worth its own panel because the live teams no longer tell you this: a
 * reshuffle overwrites the split and supersedes the run, but a published sheet
 * is frozen. This is the only place that answers "what did I tell them on
 * Saturday?" — and it shows, per player, whether the message actually arrived.
 */

type SheetMember = {
  name: string;
  team: "A" | "B";
  colour: "red" | "blue";
  isGuest?: boolean;
  isOrganiser?: boolean;
  hostName?: string | null;
  isGoalkeeper?: boolean;
  whatsapp?: "sent" | "failed" | "skipped" | "not_sent";
  whatsappError?: string | null;
};

type Sheet = {
  _id: string;
  revision: number;
  publishedAt: string;
  quality?: string | null;
  hadManualMoves?: boolean;
  gameTitle?: string | null;
  venue?: string | null;
  teams?: { A?: { name?: string; colour?: string }; B?: { name?: string; colour?: string } };
  members?: SheetMember[];
  delivery?: {
    inApp?: number;
    whatsappSent?: number;
    whatsappFailed?: number;
    whatsappSkipped?: number;
  };
};

const COLOUR = (colour?: string) =>
  colour === "red"
    ? { fg: "#f87171", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.2)", label: "Red / White" }
    : { fg: "#60a5fa", bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.2)", label: "Blue / Black" };

// Only the outcomes worth a mark next to a name. A successful send is the
// expected case and would just be twenty green ticks of noise.
const WA_MARK: Record<string, { icon: string; fg: string; title: string }> = {
  failed:  { icon: "!", fg: "#f87171", title: "WhatsApp failed" },
  skipped: { icon: "–", fg: "#6b7280", title: "No WhatsApp — no number, or switched off" },
};

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  });
};

export function TeamSheetHistory({
  gameId,
  refreshKey = 0,
}: {
  gameId: string;
  /** Bump to re-fetch — publishing adds a revision. */
  refreshKey?: number;
}) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/teams/sheets`), {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return;
      setSheets(data.data?.history || []);
    } catch {
      // A history panel that cannot load is not worth an error banner over the
      // teams the organiser is actually working on.
    }
  }, [gameId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Nothing published yet — there is no history to speak of.
  if (!sheets || sheets.length === 0) return null;

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", color: "#8b8b8b",
          fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0,
        }}
      >
        {open ? "▾" : "▸"} Published history ({sheets.length})
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {sheets.map((sheet, i) => {
            const isOpen = expanded === sheet._id;
            const d = sheet.delivery || {};
            const isLive = i === 0;

            return (
              <div
                key={sheet._id}
                style={{
                  border: `1px solid ${isLive ? "rgba(200,255,62,0.25)" : "rgba(255,255,255,0.07)"}`,
                  background: isLive ? "rgba(200,255,62,0.04)" : "rgba(255,255,255,0.02)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : sheet._id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 12px", background: "none", border: "none",
                    cursor: "pointer", textAlign: "left", flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: isLive ? "#c8ff3e" : "#bdbdbd" }}>
                    v{sheet.revision}
                  </span>
                  {isLive && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: "#c8ff3e", opacity: 0.75 }}>
                      CURRENT
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "#8b8b8b" }}>{when(sheet.publishedAt)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10.5, color: "#777", whiteSpace: "nowrap" }}>
                    {d.inApp ?? 0} notified
                    {d.whatsappSent ? ` · ${d.whatsappSent} on WhatsApp` : ""}
                  </span>
                  {Boolean(d.whatsappFailed) && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#f87171", whiteSpace: "nowrap" }}>
                      {d.whatsappFailed} failed
                    </span>
                  )}
                  {sheet.hadManualMoves && (
                    <span
                      title="An organiser had moved somebody by hand before this was published"
                      style={{ fontSize: 10.5, color: "#a78bfa", whiteSpace: "nowrap" }}
                    >
                      ⇄ edited
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: "#6b7280" }}>{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div style={{ display: "flex", gap: 10, padding: "0 12px 12px", flexWrap: "wrap" }}>
                    {(["A", "B"] as const).map((sideKey) => {
                      const style = COLOUR(sheet.teams?.[sideKey]?.colour);
                      const rows = (sheet.members || []).filter((m) => m.team === sideKey);
                      return (
                        <div
                          key={sideKey}
                          style={{
                            flex: 1, minWidth: 180,
                            background: style.bg,
                            border: `1px solid ${style.border}`,
                            borderRadius: 7, padding: "9px 11px",
                          }}
                        >
                          <div style={{
                            fontSize: 10, fontWeight: 700, color: style.fg,
                            textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 7,
                          }}>
                            {style.label} · {rows.length}
                          </div>
                          {rows.map((m, idx) => {
                            const mark = m.whatsapp ? WA_MARK[m.whatsapp] : null;
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: "flex", alignItems: "center", gap: 6,
                                  fontSize: 12, color: "#dcdcdc", padding: "3px 0",
                                }}
                              >
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {m.isGoalkeeper && <span title="Goalkeeper">🧤 </span>}
                                  {m.name}
                                  {m.isGuest && (
                                    <span style={{ fontSize: 10, color: "#6b7280" }}>
                                      {m.hostName ? ` · guest of ${m.hostName}` : " · guest"}
                                    </span>
                                  )}
                                  {m.isOrganiser && (
                                    <span style={{ fontSize: 10, color: "#6b7280" }}> · organiser</span>
                                  )}
                                </span>
                                {mark && (
                                  <span
                                    title={m.whatsappError || mark.title}
                                    style={{ fontSize: 10, fontWeight: 800, color: mark.fg }}
                                  >
                                    {mark.icon}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
