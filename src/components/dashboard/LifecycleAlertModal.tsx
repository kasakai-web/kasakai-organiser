"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Dashboard pop-up for the confirmation algorithm (spec 3.1/3.2):
//  - shows when a game has a pending decision the organiser must resolve
//  - shows the 30-minute "check-in coming up" reminder
// Dismiss hides THIS alert for the session (it won't come back on the next poll),
// but a genuinely NEW decision — e.g. the second check after the first was
// dismissed — still surfaces because the dismiss key includes the decision.

interface Props {
  games: any[];
  onConfirm: (gameId: string) => void;
  onSwitch: (game: any) => void;
  onSos: (game: any) => void;
  onCancel: (game: any) => void;
}

// Dismissed alert keys are persisted to sessionStorage so a dismissal reliably
// survives the dashboard's 20s poll, a component remount, Next.js Fast Refresh,
// AND a page reload. (Module-level or useState memory can be wiped by any of
// those, which made the alert wrongly re-appear.) Cleared when the tab closes.
const DISMISS_STORE = "kk_lifecycle_dismissed";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(window.sessionStorage.getItem(DISMISS_STORE) || "[]")); }
  catch { return new Set(); }
}
function saveDismissed(keys: Set<string>) {
  try { window.sessionStorage.setItem(DISMISS_STORE, JSON.stringify([...keys])); } catch { /* ignore */ }
}

const activeCount = (g: any) =>
  (g.registrations || []).filter(
    (r: any) => !r.backedOutAt && !["refunded", "forfeited"].includes(r.paymentStatus) && !r.optedOut
  ).length + (g.organiserIsPlaying ? 1 : 0);

// Identity of the current alert. Dismissing hides exactly this one; if the game
// later raises a different decision (new stage/options) the key changes and it
// shows again. Options are sorted so a reordered array can't change the key.
function alertKey(g: any, kind: "decision" | "reminder") {
  const lc = g.lifecycle || {};
  return kind === "decision"
    ? `${g._id}|d:${lc.pendingDecision?.stage}:${(lc.pendingDecision?.options || []).slice().sort().join(",")}`
    : `${g._id}|r:${lc.reminderSentAt}`;
}

function pickAlert(games: any[], dismissed: Set<string>) {
  const now = Date.now();
  for (const g of games || []) {
    if (!g?._id) continue;
    // Only show for a live game that hasn't started yet — once the game has
    // happened, its check-in pop-up must never appear again, even if it's still
    // stuck 'open' (never confirmed/cancelled/completed).
    if (g.scheduledAt && new Date(g.scheduledAt).getTime() <= now) continue;
    const lc = g.lifecycle || {};
    // Decisions normally only exist pre-confirmation (open/tentative). The ONE
    // decision that fires on a CONFIRMED game is the post-switch shortfall prompt
    // (stage 'format_review': Cancel / SOS) — surface that too; any other stale
    // decision on a confirmed game stays hidden. Completed/cancelled: never.
    const isOpenTentative = ["open", "tentative"].includes(g.status);
    const isConfirmedReview =
      g.status === "confirmed" && lc.pendingDecision?.stage === "format_review";
    if (!isOpenTentative && !isConfirmedReview) continue;
    // A shortfall prompt whose game has since RECOVERED (players joined
    // organically after the prompt was raised) must not keep nagging with a
    // stale low count — the organiser could cancel a now-healthy game. After a
    // switch, g.minPlayers already holds the alternate's minimum.
    if (isConfirmedReview) {
      const min = typeof g.minPlayers === "number" ? g.minPlayers : null;
      if (min != null && activeCount(g) >= min) continue;
    }
    if (lc.pendingDecision?.options?.length) {
      const key = alertKey(g, "decision");
      if (!dismissed.has(key)) return { game: g, kind: "decision" as const, key };
      continue;
    }
    if (!isOpenTentative) continue; // reminders are pre-confirmation only
    if (lc.reminderSentAt && !lc.secondCheckDoneAt) {
      const age = Date.now() - new Date(lc.reminderSentAt).getTime();
      if (age >= 0 && age < 45 * 60 * 1000) {
        const key = alertKey(g, "reminder");
        if (!dismissed.has(key)) return { game: g, kind: "reminder" as const, key };
      }
    }
  }
  return null;
}

const RECO_MSG: Record<string, string> = {
  confirm_main: "Enough players — confirm the main format, or wait.",
  confirm_alternate: "Below your main format — switch formats, or cancel.",
  choose: "Below your main format — switch, send an SOS, or cancel.",
  cancel: "Below the minimum — cancel, or keep waiting.",
};

const fmtTime = (d: any) => {
  try { return new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }); }
  catch { return ""; }
};

// tiny stroke-icon helper (no icon dependency)
const Svg = ({ d, size = 16, extra }: { d: string | string[]; size?: number; extra?: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
    {extra}
  </svg>
);
const IconCheck = () => <Svg d="M20 6 9 17l-5-5" />;
const IconSwap = () => <Svg d="m16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16" />;
const IconMega = () => <Svg d={["m3 11 18-5v12L3 14v-3z", "M11.6 16.8a3 3 0 1 1-5.8-1.6"]} />;
const IconX = () => <Svg d="M18 6 6 18M6 6l12 12" />;
const IconHourglass = () => <Svg d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />;
const IconClock = ({ size = 13 }: { size?: number }) => <Svg size={size} d="M12 7v5l3 2" extra={<circle cx="12" cy="12" r="9" />} />;
const IconWarn = ({ size = 20 }: { size?: number }) => (
  <Svg size={size} d={["m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z", "M12 9v4", "M12 17h.01"]} />
);

const VARIANT: Record<string, { bg: string; hover: string; color: string; border?: string }> = {
  confirm:  { bg: "#3f5222", hover: "#4a6029", color: "#d9f99d" },
  switch:   { bg: "#1e3a2a", hover: "#265036", color: "#34d399" },
  sos:      { bg: "#42311a", hover: "#523d22", color: "#e9b338" },
  cancel:   { bg: "#3a1d1d", hover: "#4a2525", color: "#f87171" },
  wait:     { bg: "#1a1c1f", hover: "#22252a", color: "#cbd5e1", border: "1px solid #2a2a2a" },
  reminder: { bg: "#123040", hover: "#173c50", color: "#7dd3fc" },
};

const ACCENT = "#e9b338";
const SKY = "#38bdf8";

export function LifecycleAlertModal({ games, onConfirm, onSwitch, onSos, onCancel }: Props) {
  const [mounted, setMounted] = useState(false);
  const [, forceRender] = useState(0);
  useEffect(() => setMounted(true), []);
  // Self-tick: re-evaluate periodically so a pop-up whose game has since started
  // (or been completed/cancelled elsewhere) disappears on its own, without waiting
  // for the dashboard's next data poll. pickAlert re-runs with the live clock.
  useEffect(() => {
    const id = setInterval(() => forceRender((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;

  const alert = pickAlert(games, loadDismissed());
  if (!alert) return null;

  const { game, kind, key } = alert;
  const isReminder = kind === "reminder";
  const lc = game.lifecycle || {};
  const decision = lc.pendingDecision;
  // Shortfall (format_review) prompts show the LIVE count — players may have
  // joined since the prompt was raised, and a stale low number could push the
  // organiser into cancelling a recovering game. Check-time decisions keep the
  // count captured at the check, as before.
  const n = decision?.stage === "format_review"
    ? activeCount(game)
    : (decision?.playerCount ?? activeCount(game));
  const club = game.turf?.name || "";
  const mainMin: number | null = typeof game.minPlayers === "number" ? game.minPlayers : null;
  const alt = (game.alternateFormats || [])[0] || null;
  const altMin: number | null = alt && typeof alt.minPlayers === "number" ? alt.minPlayers : null;
  const altLabel: string = alt?.format || "alt";
  const checkAt = lc.secondCheckAt && new Date(lc.secondCheckAt).getTime() > Date.now() ? lc.secondCheckAt : null;

  const mainPct = mainMin ? Math.min(100, (n / mainMin) * 100) : 0;
  const altPct = altMin ? Math.min(100, (n / altMin) * 100) : 0;

  // Dismiss persists this alert's key so it won't return on the next poll,
  // remount, Fast Refresh, or reload (until the tab is closed).
  const close = () => { const s = loadDismissed(); s.add(key); saveDismissed(s); forceRender((x) => x + 1); };
  // Guard every pop-up action against a stale game. A game that has been completed
  // (or otherwise finalised) is always past its start time, so the LIVE-clock check
  // catches it even if this component still holds a stale 'open'/'tentative' status:
  // we close the alert and do NOTHING rather than fire a confirm/switch/cancel that
  // the server would (rightly) reject. Once a game is over, nothing here can change it.
  // A CONFIRMED game is still actionable for the post-switch shortfall prompt
  // (stage 'format_review': Cancel / SOS — both allowed on confirmed games).
  const stillLive =
    (["open", "tentative"].includes(game.status) ||
      (game.status === "confirmed" && decision?.stage === "format_review")) &&
    !(game.scheduledAt && new Date(game.scheduledAt).getTime() <= Date.now());
  const act = (fn: () => void) => () => { if (stillLive) fn(); close(); };

  type A = { key: string; label: string; variant: string; icon: React.ReactNode; onClick: () => void; recommended?: boolean };
  const actions: A[] = [];
  if (isReminder) {
    actions.push({ key: "got", label: "Got it, I'm ready", variant: "reminder", icon: <IconCheck />, onClick: act(() => {}) });
  } else {
    const opts: string[] = decision?.options || [];
    const reco = decision?.recommendation;
    if (opts.includes("confirm")) actions.push({ key: "confirm", label: "Confirm main", variant: "confirm", icon: <IconCheck />, onClick: act(() => onConfirm(game._id)), recommended: reco === "confirm_main" });
    if (opts.includes("switch_alternate")) actions.push({ key: "switch", label: `Switch to ${altLabel}`, variant: "switch", icon: <IconSwap />, onClick: act(() => onSwitch(game)), recommended: reco === "confirm_alternate" || reco === "choose" });
    if (opts.includes("sos")) actions.push({ key: "sos", label: "Send SOS", variant: "sos", icon: <IconMega />, onClick: act(() => onSos(game)) });
    if (opts.includes("cancel")) actions.push({ key: "cancel", label: "Cancel game", variant: "cancel", icon: <IconX />, onClick: act(() => onCancel(game)), recommended: reco === "cancel" });
    if (opts.includes("keep_waiting") || opts.includes("wait")) actions.push({ key: "wait", label: "Keep waiting", variant: "wait", icon: <IconHourglass />, onClick: act(() => {}) });
  }

  const barRow = (label: React.ReactNode, count: string, pct: number, fill: string) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ color: "#cbd5e1", fontFamily: "ui-monospace, monospace" }}>{count}</span>
      </div>
      <div style={{ width: "100%", height: 5, background: "#262626", borderRadius: 999, overflow: "hidden" }}>
        <div className="kkla-fill" style={{ width: `${pct}%`, background: fill }} />
      </div>
    </div>
  );

  return createPortal(
    <>
      <style>{`
        @keyframes kkla-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
        .kkla-ov { position: fixed; inset: 0; background: rgba(0,0,0,.66); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 16px; }
        .kkla-card { width: 100%; max-width: 344px; background: #111214; border: 1px solid rgba(120,120,120,.16); border-radius: 18px; padding: 16px; color: #f1f5f9; box-shadow: 0 20px 50px rgba(0,0,0,.5); animation: kkla-in .2s cubic-bezier(.2,.8,.2,1); }
        .kkla-fill { height: 100%; border-radius: 999px; transition: width .5s cubic-bezier(.2,.8,.2,1); }
        .kkla-btn { display: flex; align-items: center; gap: 8px; padding: 10px 11px; border-radius: 11px; cursor: pointer; text-align: left; border: none; transition: background .14s, transform .1s; }
        .kkla-btn:active { transform: scale(.96); }
        .kkla-dismiss { margin-top: 10px; width: 100%; background: none; border: none; color: #6b7280; font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 8px; border-radius: 10px; transition: color .14s, background .14s; }
        .kkla-dismiss:hover { color: #cbd5e1; background: rgba(255,255,255,.03); }
      `}</style>
      <div className="kkla-ov" onClick={close}>
        <div className="kkla-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 999,
              background: isReminder ? "rgba(56,189,248,.1)" : "rgba(233,179,56,.1)",
              border: `1px solid ${isReminder ? "rgba(56,189,248,.22)" : "rgba(233,179,56,.22)"}`,
              display: "flex", alignItems: "center", justifyContent: "center", color: isReminder ? SKY : ACCENT }}>
              {isReminder ? <IconClock size={18} /> : <IconWarn size={19} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                {isReminder ? "Check-in coming up" : "Game needs your attention"}
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#94a3b8", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[game.title, club, game.format].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {/* Compact stat block */}
          <div style={{ background: "#181a1d", borderRadius: 12, padding: 12, border: "1px solid rgba(120,120,120,.12)", marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: ACCENT, lineHeight: 1, letterSpacing: "-0.02em" }}>{n}</span>
              <span style={{ fontSize: 12.5, color: "#94a3b8", fontWeight: 500 }}>{n === 1 ? "player signed up" : "players signed up"}</span>
              {checkAt && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                  <span style={{ color: isReminder ? SKY : ACCENT, display: "flex" }}><IconClock /></span>
                  {fmtTime(checkAt)}
                </span>
              )}
            </div>
            {mainMin != null && barRow(<>Main format · min <b style={{ color: ACCENT }}>{mainMin}</b></>, `${n}/${mainMin}`, mainPct, ACCENT)}
            {altMin != null && barRow(<>{altLabel} · min <b style={{ color: "#34d399" }}>{altMin}</b></>, `${n}/${altMin}`, altPct, "#3d7a44")}
          </div>

          {/* One-line guidance */}
          <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45, margin: "11px 2px 0" }}>
            {isReminder
              ? "Second check is ~30 min away — be ready to confirm, switch, or cancel."
              : decision?.stage === "format_review"
              ? "Below the minimum after the format change — cancel the game, or send an SOS to regulars to fill the spots."
              : (RECO_MSG[decision?.recommendation] || "This game needs your attention.")}
          </p>

          {/* Actions */}
          <div style={{ display: "grid", gridTemplateColumns: actions.length === 1 ? "1fr" : "1fr 1fr", gap: 8, marginTop: 12 }}>
            {actions.map((a) => {
              const v = VARIANT[a.variant];
              return (
                <button
                  key={a.key}
                  className="kkla-btn"
                  onClick={a.onClick}
                  onMouseEnter={(e) => (e.currentTarget.style.background = v.hover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = v.bg)}
                  style={{ background: v.bg, color: v.color, border: v.border, boxShadow: a.recommended ? `inset 0 0 0 1.5px ${v.color}66` : undefined }}
                >
                  <span style={{ display: "flex", flexShrink: 0 }}>{a.icon}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.15 }}>{a.label}</span>
                  {a.recommended && <span title="Suggested" style={{ marginLeft: "auto", fontSize: 11, opacity: 0.9 }}>★</span>}
                </button>
              );
            })}
          </div>

          <button className="kkla-dismiss" onClick={close}>Dismiss</button>
        </div>
      </div>
    </>,
    document.body
  );
}
