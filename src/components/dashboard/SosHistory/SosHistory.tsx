"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildApiUrl, getAuthHeaders } from "@/utils/api";
import "./SosHistory.css";

/**
 * Every SOS a game has sent — the organiser's Send button and each automatic
 * wave — newest first: who it went to, when, what WhatsApp did with it, whether
 * they tapped the link, and whether they took a spot.
 *
 * The server builds all of it (GET /games/organisers/:id/sos/history,
 * utils/sosHistory.js on the backend), including which send a join is credited
 * to, so this component only renders and filters.
 */

type Outcome =
  | "joined" | "joined_later" | "in_game" | "joined_left"
  | "waitlisted" | "opened" | "no_response" | "not_reached";

type Recipient = {
  id: string;
  playerId: string | null;
  name: string;
  phone: string;
  sentAt: string | null;
  whatsapp: string;
  // Why a WhatsApp leg failed or was stopped (AiSensy's reason, or "game full").
  whatsappError?: string | null;
  inApp: boolean;
  openedAt: string | null;
  outcome: Outcome;
  joinedAt: string | null;
  minutesToJoin: number | null;
  guests: number;
  leftHow: "backed_out" | "removed" | "opted_out" | "left" | null;
  leftAt: string | null;
};

type Send = {
  id: string;
  at: string;
  source: "manual" | "auto";
  sentByName: string | null;
  wave: number | null;
  moment?: string | null;
  momentLabel?: string | null;
  need?: number | null;
  skipped?: boolean;
  skipReason?: string | null;
  recipients: Recipient[];
  counts: {
    recipients: number; whatsapp: number; failed: number; inAppOnly: number; dryRun?: number;
    queued?: number; stopped?: number;
    notReached: number; opened: number; joined: number; joinedLeft: number; waitlisted: number;
  };
  spotsFilled: number;
};

type Summary = {
  sends: number; manualSends: number; autoSends: number;
  messages: number; people: number;
  whatsappDelivered: number; whatsappFailed: number;
  opened: number; joined: number; joinedLeft: number; waitlisted: number;
  spotsFilled: number; lastSentAt: string | null; autoSos: boolean;
};

export type SosHistoryData = { summary: Summary; sends: Send[] };

/** Does this card's game have anything to show? Read off the card, no fetch. */
export function hasSosHistory(game: any): boolean {
  return (game?.sosLog?.length ?? 0) > 0 || (game?.autoSosState?.waves?.length ?? 0) > 0;
}

// ── Formatting ─────────────────────────────────────────────────────────────

const IST = "Asia/Kolkata";

const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST,
  });
};

const clock = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
};

const ago = (iso: string | null) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

const duration = (mins: number | null) => {
  if (mins == null) return "";
  if (mins < 1) return "within a minute";
  if (mins < 60) return `${mins} min later`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m later` : `${h}h later`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} later`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What WhatsApp did. In-app goes out on every row except "alerts_off".
const WA: Record<string, { label: string; tone: string; title: string }> = {
  sent:       { label: "WhatsApp ✓",  tone: "ok",    title: "Handed to WhatsApp, plus the in-app notification. WhatsApp can still hold a message back after this (e.g. its limit on promotional messages per person)" },
  failed:     { label: "WA failed",   tone: "bad",   title: "WhatsApp rejected it — the in-app notification still went" },
  queued:     { label: "WA queued",   tone: "muted", title: "WhatsApp messages go out one by one, a few seconds apart — this one hasn't had its turn yet. The in-app notification already went" },
  stopped:    { label: "WA not sent", tone: "muted", title: "Not sent: by its turn the game had filled (or they had booked anyway). The in-app notification still went" },
  opted_out:  { label: "In-app only", tone: "muted", title: "The player has WhatsApp notifications turned off" },
  no_number:  { label: "No number",   tone: "warn",  title: "No phone/WhatsApp number on file — in-app only" },
  held_back:  { label: "In-app only", tone: "muted", title: "Automatic SOS kept WhatsApp back: they left the last few unanswered" },
  dry_run:    { label: "WA dry run",  tone: "muted", title: "Automatic SOS is in dry run: the in-app notification went, WhatsApp was skipped" },
  alerts_off: { label: "Alerts off",  tone: "muted", title: "The player turned SOS alerts off — nothing was sent" },
};

function outcomeOf(r: Recipient): { label: string; detail: string; tone: string } {
  switch (r.outcome) {
    case "joined":
      return {
        label: "Joined",
        tone: "ok",
        detail: [
          r.joinedAt ? `${clock(r.joinedAt)} · ${duration(r.minutesToJoin)}` : null,
          r.guests > 0 ? `+${plural(r.guests, "guest")}` : null,
        ].filter(Boolean).join(" · "),
      };
    case "joined_left": {
      const how = r.leftHow === "removed" ? "removed by an organiser"
        : r.leftHow === "opted_out" ? "then opted out"
        : "then backed out";
      return {
        label: "Joined, left",
        tone: "warn",
        detail: [r.joinedAt ? `joined ${duration(r.minutesToJoin)}` : null, how, r.leftAt ? ago(r.leftAt) : null]
          .filter(Boolean).join(" · "),
      };
    }
    case "joined_later":
      return { label: "Joined later", tone: "ok-soft", detail: "after a later SOS" };
    case "in_game":
      return { label: "In the game", tone: "ok-soft", detail: "" };
    case "waitlisted":
      return { label: "Waitlisted", tone: "info", detail: "joined the waitlist" };
    case "opened":
      return { label: "Tapped link", tone: "info", detail: r.openedAt ? `${clock(r.openedAt)} · didn't book` : "didn't book" };
    case "not_reached":
      return { label: "Not reached", tone: "muted", detail: "SOS alerts off" };
    default:
      return { label: "No response", tone: "muted", detail: "" };
  }
}

type Filter = "all" | "joined" | "opened" | "none" | "undelivered";
const FILTERS: { key: Filter; label: string; test: (r: Recipient) => boolean }[] = [
  { key: "all",         label: "All",            test: () => true },
  { key: "joined",      label: "Joined",         test: (r) => ["joined", "joined_later", "in_game", "joined_left"].includes(r.outcome) },
  { key: "opened",      label: "Tapped link",    test: (r) => !!r.openedAt },
  { key: "none",        label: "No response",    test: (r) => ["no_response", "opened", "waitlisted"].includes(r.outcome) },
  { key: "undelivered", label: "WA not delivered", test: (r) => r.whatsapp !== "sent" },
];

// ── Component ──────────────────────────────────────────────────────────────

// Mounted fresh each time it is shown, so it always reads the latest — including
// a send made moments ago, or an automatic wave from the last tick.
export function SosHistory({ gameId }: { gameId: string }) {
  const [data, setData] = useState<SosHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Which sends are open. The newest starts open: "who did the last wave go to?"
  // is the question this panel is usually opened to answer.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/sos/history`), {
        headers: getAuthHeaders(),
      });
      const body = await res.json();
      if (!res.ok || !body.success) { setError(body.message || "Couldn't load the SOS history"); return; }
      const d = body.data as SosHistoryData;
      setError(null);
      setData(d);
      setOpen((prev) => {
        if (prev.size) return prev;
        const first = d.sends.find((s) => !s.skipped);
        return new Set(first ? [first.id] : []);
      });
    } catch {
      setError("Couldn't load the SOS history");
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  const test = FILTERS.find((f) => f.key === filter)!.test;
  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.sends.map((s) => ({ send: s, rows: s.recipients }));
    return data.sends
      .filter((s) => !s.skipped)
      .map((s) => ({ send: s, rows: s.recipients.filter(test) }))
      .filter((x) => x.rows.length > 0);
  }, [data, filter, test]);

  if (error || !data) {
    return (
      <div className={`sosh-empty ${error ? "is-error" : ""}`}>
        {error || "Loading SOS history…"}
        {error && <button type="button" className="sosh-link" onClick={load}>Try again</button>}
      </div>
    );
  }

  const s = data.summary;
  if (data.sends.length === 0) {
    return (
      <div className="sosh-empty">
        No SOS has been sent for this game yet.
        {s.autoSos && <div className="sosh-empty-sub">Automatic SOS is on — any wave it sends will show up here.</div>}
      </div>
    );
  }

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const filtering = filter !== "all";

  return (
    <div className="sosh">
      {/* ── Totals across every send ── */}
      <div className="sosh-stats">
        <Stat value={s.sends} label="SOS sent"
          sub={[s.autoSends ? `${s.autoSends} auto` : null, s.manualSends ? `${s.manualSends} manual` : null].filter(Boolean).join(" · ")} />
        <Stat value={s.people} label="Players asked"
          sub={s.messages !== s.people ? `${s.messages} messages` : `${s.whatsappDelivered} on WhatsApp`} />
        <Stat value={s.opened} label="Tapped link" sub={s.waitlisted ? `${s.waitlisted} waitlisted` : ""} />
        <Stat value={s.joined} label="Joined" tone="ok"
          sub={[
            s.spotsFilled > s.joined ? `${s.spotsFilled} spots with guests` : null,
            s.joinedLeft ? `${s.joinedLeft} left again` : null,
          ].filter(Boolean).join(" · ")} />
      </div>

      <div className="sosh-toolbar">
        <div className="sosh-filters" role="tablist" aria-label="Filter recipients">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              className={`sosh-chip ${filter === f.key ? "is-on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="sosh-link" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {visible.length === 0 && <div className="sosh-empty">Nobody matches this filter.</div>}

      <div className="sosh-sends">
        {visible.map(({ send, rows }, i) => {
          const latest = i === 0 && !filtering && !send.skipped;
          if (send.skipped) {
            return (
              <div key={send.id} className="sosh-send is-skipped">
                <div className="sosh-send-head static">
                  <span className="sosh-src auto">Auto</span>
                  <div className="sosh-send-main">
                    <div className="sosh-send-title">Automatic wave skipped</div>
                    <div className="sosh-send-sub">
                      {[when(send.at), send.momentLabel, send.need ? `needed ${send.need} more` : null].filter(Boolean).join(" · ")}
                    </div>
                    {send.skipReason && <div className="sosh-send-sub">{send.skipReason}</div>}
                  </div>
                </div>
              </div>
            );
          }
          const isOpen = filtering || open.has(send.id);
          const c = send.counts;
          const title = send.source === "auto"
            ? `Automatic SOS${send.wave ? ` · wave ${send.wave}` : ""}`
            : `Sent by ${send.sentByName || "an organiser"}`;
          return (
            <div key={send.id} className={`sosh-send ${latest ? "is-latest" : ""}`}>
              <button type="button" className="sosh-send-head" onClick={() => toggle(send.id)} aria-expanded={isOpen}>
                <span className={`sosh-src ${send.source}`}>{send.source === "auto" ? "Auto" : "Manual"}</span>
                <div className="sosh-send-main">
                  <div className="sosh-send-title">
                    {title}
                    {latest && <span className="sosh-latest">Latest</span>}
                  </div>
                  <div className="sosh-send-sub">
                    {[when(send.at), ago(send.at)].filter(Boolean).join(" · ")}
                  </div>
                  {send.source === "auto" && (send.momentLabel || send.need) && (
                    <div className="sosh-send-sub">
                      {[send.momentLabel, send.need ? `needed ${send.need} more` : null].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="sosh-counts">
                    <span>{plural(c.recipients, "player")}</span>
                    <span>{c.whatsapp} WhatsApp</span>
                    {(c.queued ?? 0) > 0 && <span className="info">{c.queued} WhatsApp still going out</span>}
                    {c.failed > 0 && <span className="bad">{c.failed} failed</span>}
                    {(c.stopped ?? 0) > 0 && <span>{c.stopped} WhatsApp not sent</span>}
                    {c.inAppOnly > 0 && <span>{c.inAppOnly} in-app only</span>}
                    {(c.dryRun ?? 0) > 0 && <span>{c.dryRun} WhatsApp skipped (dry run)</span>}
                    {c.opened > 0 && <span className="info">{c.opened} tapped</span>}
                    <span className={c.joined ? "ok" : ""}>{c.joined} joined</span>
                    {c.joinedLeft > 0 && <span className="warn">{c.joinedLeft} left again</span>}
                  </div>
                </div>
                <span className={`sosh-caret ${isOpen ? "is-open" : ""}`} aria-hidden>▾</span>
              </button>

              {isOpen && (
                <div className="sosh-rows">
                  {filtering && rows.length !== c.recipients && (
                    <div className="sosh-rows-note">Showing {rows.length} of {c.recipients}</div>
                  )}
                  {rows.map((r) => {
                    const base = WA[r.whatsapp] || WA.sent;
                    const wa = r.whatsappError ? { ...base, title: `${base.title} — ${r.whatsappError}` } : base;
                    const o = outcomeOf(r);
                    return (
                      <div key={r.id} className="sosh-row">
                        <div className="sosh-row-main">
                          <div className="sosh-name">{r.name}</div>
                          <div className="sosh-meta">
                            {[r.phone, `sent ${clock(r.sentAt)}`].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div className="sosh-row-side">
                          <span className={`sosh-badge tone-${o.tone}`}>{o.label}</span>
                          {o.detail && <span className="sosh-detail">{o.detail}</span>}
                          <span className={`sosh-wa tone-${wa.tone}`} title={wa.title}>{wa.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="sosh-foot">
        {"\u201cJoined\u201d means they took a spot after that SOS and still hold it. A booking is credited "
          + "to the latest SOS that reached them before they booked, so nobody is counted twice. Everyone "
          + "listed got the in-app notification unless it says Alerts off."}
      </p>
    </div>
  );
}

function Stat({ value, label, sub, tone }: { value: number; label: string; sub?: string; tone?: "ok" }) {
  return (
    <div className={`sosh-stat ${tone === "ok" && value > 0 ? "is-ok" : ""}`}>
      <div className="sosh-stat-value">{value}</div>
      <div className="sosh-stat-label">{label}</div>
      {sub ? <div className="sosh-stat-sub">{sub}</div> : null}
    </div>
  );
}
