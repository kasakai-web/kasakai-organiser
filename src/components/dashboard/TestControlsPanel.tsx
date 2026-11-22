"use client";

// Test controls on a game's player list — TEST server only (Test_Speedups_Plan.md).
// Renders nothing unless the backend's test-tools status answered, which the
// production backend never does.
//
//   Jump      move the game's whole timeline so a step is due now, then run one
//             lifecycle pass (backend: services/testToolsService.js#jump)
//   Add       seat "D" test accounts through the real join endpoint
//   Leave     one D account gives its seat up through the real leave endpoint

import { useCallback, useEffect, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import { useTestTools } from "@/hooks/useTestTools";
import { clock, type GameControls, type JumpStep } from "@/utils/testTools";

type FillResult = { playerId: string; name: string; outcome: string; message: string | null };

const card: React.CSSProperties = {
  margin: "10px 16px 0", padding: "12px", borderRadius: 8,
  background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.3)",
};
const btn = (enabled: boolean, accent = "#60a5fa"): React.CSSProperties => ({
  padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, textAlign: "left",
  cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : 0.45,
  border: `1px solid ${enabled ? accent : "rgba(255,255,255,0.15)"}`,
  background: enabled ? "rgba(96,165,250,0.1)" : "rgba(255,255,255,0.03)", color: enabled ? "#dbeafe" : "#999",
});
const field: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#fff",
  padding: "6px 8px", fontSize: 12, fontWeight: 700,
};

async function call(path: string, method = "GET", body?: unknown) {
  const { token } = getSession();
  const res = await fetch(buildApiUrl(`/api/v1/test-tools${path}`), {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
  return json;
}

export function TestControlsPanel({ gameId, onChanged }: { gameId: string; onChanged?: () => void }) {
  const { enabled } = useTestTools();
  const [open, setOpen] = useState(true);
  const [controls, setControls] = useState<GameControls | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [count, setCount] = useState(4);
  const [guestsEach, setGuestsEach] = useState(0);
  const [playTogether, setPlayTogether] = useState(true);
  const [leaver, setLeaver] = useState("");
  const [fillResults, setFillResults] = useState<FillResult[]>([]);

  const load = useCallback(async () => {
    try {
      const json = await call(`/games/${gameId}`);
      setControls(json.data);
    } catch (err) {
      setMessage({ ok: false, lines: [(err as Error).message] });
    }
  }, [gameId]);

  useEffect(() => { if (enabled && open) load(); }, [enabled, open, load]);

  if (!enabled) return null;

  const after = async () => { await load(); onChanged?.(); };

  const jump = async (step: JumpStep) => {
    setBusy(step); setMessage(null);
    try {
      const json = await call(`/games/${gameId}/jump`, "POST", { step });
      setMessage({ ok: true, lines: [json.message, ...(json.data?.result || [])] });
      await after();
    } catch (err) {
      setMessage({ ok: false, lines: [(err as Error).message] });
    } finally { setBusy(null); }
  };

  const fill = async () => {
    setBusy("fill"); setMessage(null); setFillResults([]);
    try {
      const json = await call(`/games/${gameId}/fill`, "POST", { count, guestsEach, playTogether });
      setMessage({ ok: true, lines: [json.message] });
      setFillResults(json.data?.results || []);
      await after();
    } catch (err) {
      setMessage({ ok: false, lines: [(err as Error).message] });
    } finally { setBusy(null); }
  };

  const leave = async () => {
    if (!leaver) return;
    setBusy("leave"); setMessage(null);
    try {
      const json = await call(`/games/${gameId}/leave`, "POST", { playerId: leaver });
      setMessage({ ok: true, lines: [json.message] });
      setLeaver("");
      await after();
    } catch (err) {
      setMessage({ ok: false, lines: [(err as Error).message] });
    } finally { setBusy(null); }
  };

  const offFlags = (controls?.flags || []).filter((f) => !f.on);
  const timings = controls?.timings;

  return (
    <div style={card}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", color: "#93c5fd", fontWeight: 800, fontSize: 13, cursor: "pointer", padding: 0 }}
      >
        🧪 Test controls (test server only) {open ? "▾" : "▸"}
      </button>

      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>
          {timings && (
            <p style={{ margin: "0 0 8px", color: "#94a3b8" }}>
              {controls?.hasTestTimings ? "This game runs on test timings" : "This game runs on production timings"}:
              {" "}last call {timings.lastCallMins} min before reporting · reminder {timings.reminderMins} min ·
              {" "}auto-complete {timings.autoCompleteMins} min · video {timings.videoWaitMins} min.
            </p>
          )}
          {offFlags.length > 0 && (
            <p style={{ margin: "0 0 8px", color: "#f87171" }}>
              Off on this server: {offFlags.map((f) => f.name).join(", ")} — those steps only log DRY-RUN lines.
            </p>
          )}

          <div style={{ fontWeight: 800, color: "#e2e8f0", margin: "6px 0" }}>Jump to</div>
          <p style={{ margin: "0 0 6px", color: "#94a3b8" }}>
            Moves the whole game earlier (kick-off, end, cutoff and both check-ins together) so the step is due now,
            then runs the job once. Earlier steps that haven&apos;t run yet run first. Nobody is told about the move.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
            {(controls?.jumps || []).map((j) => (
              <button
                key={j.step}
                type="button"
                disabled={!j.available || busy !== null}
                onClick={() => jump(j.step)}
                title={j.reason || `Make ${j.label.toLowerCase()} happen now`}
                style={btn(j.available && busy === null)}
              >
                {busy === j.step ? "Running…" : `${j.label} now`}
                <span style={{ display: "block", fontWeight: 500, fontSize: 11, color: j.available ? "#93c5fd" : "#888" }}>
                  {j.available ? `due ${clock(j.at)}` : j.reason}
                </span>
              </button>
            ))}
          </div>

          <div style={{ fontWeight: 800, color: "#e2e8f0", margin: "12px 0 6px" }}>Test players (names ending in &quot;D&quot;)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label>
              Add{" "}
              <input type="number" min={1} max={40} value={count} onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} style={{ ...field, width: 56 }} />
            </label>
            <label>
              +1 guests each{" "}
              <select value={guestsEach} onChange={(e) => setGuestsEach(Number(e.target.value))} style={field}>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {guestsEach > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={playTogether} onChange={(e) => setPlayTogether(e.target.checked)} />
                play together
              </label>
            )}
            <button type="button" onClick={fill} disabled={busy !== null} style={btn(busy === null, "#c8ff3e")}>
              {busy === "fill" ? "Adding…" : "Add test players"}
            </button>
          </div>
          <p style={{ margin: "4px 0 0", color: "#94a3b8" }}>
            Each one books through the real join (wallet, discounts, waitlist when full, auto-confirm).
            {controls && ` ${controls.testAccounts} test account${controls.testAccounts === 1 ? "" : "s"} exist.`}
            {controls && controls.testAccounts === 0 && " Create them in the admin portal → Games → Test tools."}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <select value={leaver} onChange={(e) => setLeaver(e.target.value)} style={{ ...field, minWidth: 180 }}>
              <option value="">Pick a test player…</option>
              {(controls?.testPlayers || []).map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name}{p.guests ? ` (+${p.guests})` : ""}{p.optedOut ? " — opted out" : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={leave} disabled={!leaver || busy !== null} style={btn(Boolean(leaver) && busy === null, "#f87171")}>
              {busy === "leave" ? "Leaving…" : "Make them leave"}
            </button>
          </div>

          {message && (
            <div style={{ marginTop: 10, color: message.ok ? "#bbf7d0" : "#fca5a5" }}>
              {message.lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {fillResults.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "#cbd5e1" }}>
              {fillResults.map((r) => (
                <li key={r.playerId}>
                  <strong>{r.name}</strong> — {r.outcome}{r.outcome === "refused" && r.message ? `: ${r.message}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
