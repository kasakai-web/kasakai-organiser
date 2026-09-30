"use client";

// Facilitators — ask one of your approved hosts to RUN a game without playing in
// it. They get the host tools (roster, attendance, teams, wrap-up) on the player
// portal once they accept, and take no spot. Only hosts KasaKai approved for the
// game's owner can be asked; the list below is exactly those, minus anyone
// already asked or already playing.

import { useCallback, useEffect, useState } from "react";
import { resolveImageUrl } from "@/utils/api";
import {
  getFacilitators,
  inviteFacilitator,
  removeFacilitator,
  type FacilitatorPanel,
  type FacilitatorEntry,
} from "@/utils/hosts";

interface Props {
  gameId: string;
  gameTitle?: string;
  onClose: () => void;
  onChanged?: () => void;
}

const ACCENT = "#c8ff3e";

const STATUS: Record<FacilitatorEntry["status"], { label: string; color: string }> = {
  invited:  { label: "Asked — waiting for them", color: "#e9b338" },
  accepted: { label: "Facilitating",             color: ACCENT },
  declined: { label: "Declined",                 color: "#888" },
  removed:  { label: "Removed",                  color: "#666" },
};

function Avatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: "#242424", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: ACCENT, overflow: "hidden" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(src)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        (name?.[0] || "?").toUpperCase()
      )}
    </span>
  );
}

export default function FacilitatorsModal({ gameId, gameTitle, onClose, onChanged }: Props) {
  const [panel, setPanel] = useState<FacilitatorPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setPanel(await getFacilitators(gameId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load facilitators.");
    }
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  const ask = async (playerId: string) => {
    setError(null);
    setBusy(playerId);
    try {
      setPanel(await inviteFacilitator(gameId, playerId, note.trim() || undefined));
      setNote("");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't ask them.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: FacilitatorEntry) => {
    setError(null);
    setBusy(entry._id);
    try {
      setPanel(await removeFacilitator(gameId, entry._id));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove them.");
    } finally {
      setBusy(null);
    }
  };

  const live = (panel?.facilitators || []).filter((f) => f.status === "invited" || f.status === "accepted");
  const past = (panel?.facilitators || []).filter((f) => f.status === "declined" || f.status === "removed");
  const atCap = !!panel && live.length >= panel.maxLive;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, background: "#111214", border: "1px solid #2a2a2a", borderRadius: 16, padding: 22, color: "#fff", maxHeight: "88vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🎖 Facilitators</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 14px", lineHeight: 1.5 }}>
          Ask one of your hosts to run <b style={{ color: "#ddd" }}>{gameTitle || "this game"}</b> without playing.
          Once they accept they can see the roster, mark attendance, handle teams and wrap the game up from
          their player app. They don&apos;t take a spot.
        </p>

        {error && (
          <div style={{ fontSize: 12.5, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 9, padding: "8px 11px", marginBottom: 12 }}>
            {error}
          </div>
        )}

        {!panel && !error && <div style={{ fontSize: 12.5, color: "#888" }}>Loading…</div>}

        {panel && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#9aa", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              Running this game ({live.length})
            </div>
            {live.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#777", padding: "10px 0 14px" }}>Nobody asked yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {live.map((f) => (
                  <div key={f._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#161616", border: "1px solid #232323", borderRadius: 11, opacity: busy === f._id ? 0.55 : 1 }}>
                    <Avatar name={f.player.name} src={f.player.profileImage} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{f.player.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: STATUS[f.status].color }}>{STATUS[f.status].label}</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => remove(f)}
                      title={f.status === "invited" ? "Withdraw the ask" : "Take them off this game"}
                      style={{ flexShrink: 0, background: "none", border: "none", color: "#f87171", fontSize: 12, cursor: "pointer", padding: 4 }}
                    >
                      {f.status === "invited" ? "Withdraw" : "Remove"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              Ask a host
            </div>
            {panel.candidates.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#777", padding: "4px 0 10px", lineHeight: 1.5 }}>
                No approved hosts are free to ask — recommend hosts from the Hosts page, or they may already be
                playing in or asked to this game.
              </div>
            ) : (
              <>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="Optional note for them — e.g. 'Please bring the bibs'"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13, boxSizing: "border-box", marginBottom: 10 }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {panel.candidates.map((p) => (
                    <div key={p._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#161616", border: "1px solid #232323", borderRadius: 11 }}>
                      <Avatar name={p.name} src={p.profileImage} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: "#777" }}>{p.phone || ""}</span>
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null || atCap}
                        onClick={() => ask(p._id)}
                        title={atCap ? `At most ${panel.maxLive} facilitators per game` : "Ask them to facilitate"}
                        style={{ flexShrink: 0, fontSize: 12, color: atCap ? "#666" : ACCENT, fontWeight: 700, background: "none", border: "none", cursor: busy || atCap ? "default" : "pointer" }}
                      >
                        {busy === p._id ? "Asking…" : "Ask"}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {past.length > 0 && (
              <div style={{ marginTop: 16, fontSize: 11.5, color: "#666", lineHeight: 1.6 }}>
                Earlier: {past.map((f) => `${f.player.name} (${STATUS[f.status].label.toLowerCase()})`).join(", ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
