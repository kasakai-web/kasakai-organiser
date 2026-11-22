// What happened on a game's roster, and when — the Players modal's "Left" and
// "Activity" tabs.
//
// Pure (no DOM, no React) so it can be unit-tested. Everything here is read off
// rows the backend already keeps: a backout or a removal TOMBSTONES the row
// (`backedOutAt` / `removedAt`) rather than deleting it, and a Skip stamps
// `optedOutAt`, precisely so the game remembers the departure. The roster used
// to filter those rows out and show nothing else, so none of it was visible.

export interface HistoryRef { _id?: string; name?: string }

export interface HistoryRegistration {
  _id?: string;
  player?: HistoryRef | string | null;
  plusOneName?: string | null;
  guestOf?: HistoryRef | string | null;
  addedByOrganiser?: boolean;
  signedUpAt?: string | null;
  paymentStatus?: string;
  amountPaidPaise?: number;
  passBenefitPaise?: number;
  seatType?: string;
  optedOut?: boolean;
  optedOutAt?: string | null;
  optedOutReason?: "self" | "format_change" | null;
  backedOutAt?: string | null;
  backoutType?: "pre_cutoff" | "post_cutoff" | null;
  backoutFeeChargedPaise?: number;
  backoutFeeRefundedAt?: string | null;
  backoutWaivedReason?: string | null;
  removedAt?: string | null;
  removedBy?: HistoryRef | string | null;
}

export interface HistoryWaitlistEntry {
  _id?: string;
  player?: HistoryRef | string | null;
  joinedAt?: string | null;
  notifiedAt?: string | null;
  respondedAt?: string | null;
  status?: string;
  source?: string;
}

export interface HistoryGuestWaitlistEntry {
  _id?: string;
  player?: HistoryRef | string | null;
  plusOneName?: string | null;
  requestedAt?: string | null;
}

export interface HistoryContext {
  /** Kick-off — departures are measured against it. */
  scheduledAt?: string | null;
  /** The signed-in organiser, so their own removals read "you". */
  viewerId?: string | null;
  /** Organiser id → name, for "Removed by Priya" when a co-organiser did it. */
  organiserNames?: Map<string, string>;
}

const refId = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  const id = (v as { _id?: unknown })._id;
  return id ? String(id) : null;
};

const refName = (v: unknown): string | null => {
  if (!v || typeof v === "string") return null;
  const n = (v as { name?: unknown }).name;
  return typeof n === "string" && n.trim() ? n : null;
};

const ms = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Display name for a row, and who brought them if it is a guest. */
export function whoIs(reg: HistoryRegistration): { name: string; isGuest: boolean; broughtBy: string | null } {
  if (reg.plusOneName) {
    const broughtBy = reg.addedByOrganiser || !reg.player
      ? null
      : refName(reg.guestOf) ?? refName(reg.player);
    return { name: reg.plusOneName, isGuest: true, broughtBy };
  }
  return { name: refName(reg.player) ?? "Unknown player", isGuest: false, broughtBy: null };
}

function organiserLabel(id: string | null, ctx: HistoryContext): string | null {
  if (!id) return null;
  if (ctx.viewerId && id === ctx.viewerId) return "you";
  return ctx.organiserNames?.get(id) ?? null;
}

// ── Departures ────────────────────────────────────────────────────────────────

export type DepartureKind = "backed_out" | "removed" | "skipped" | "format_change";

export interface Departure {
  key: string;
  kind: DepartureKind;
  name: string;
  isGuest: boolean;
  broughtBy: string | null;
  playerId: string | null;
  at: string | null;
  /** Minutes between leaving and kick-off; negative = after kick-off. */
  minsBeforeKickoff: number | null;
  afterCutoff: boolean;
  paidPaise: number;
  passPaise: number;
  feeChargedPaise: number;
  feeReturned: boolean;
  waivedReason: string | null;
  /** "you", a co-organiser's name, or null if it cannot be resolved. */
  removedBy: string | null;
  /** The same player holds a live seat in this game again. */
  rejoined: boolean;
  /** Their guests are still playing (only meaningful for a Skip). */
  guestsStaying: number;
}

const isLiveRow = (r: HistoryRegistration) =>
  !r.backedOutAt && !r.removedAt && !r.optedOut
  && !["refunded", "forfeited"].includes(r.paymentStatus || "");

export function departuresOf(regs: HistoryRegistration[], ctx: HistoryContext = {}): Departure[] {
  const kickoff = ms(ctx.scheduledAt);
  const livePlayerIds = new Set(
    regs.filter((r) => !r.plusOneName && isLiveRow(r)).map((r) => refId(r.player)).filter(Boolean) as string[],
  );

  const out: Departure[] = [];
  regs.forEach((reg, i) => {
    let kind: DepartureKind | null = null;
    let at: string | null = null;
    // A row the organiser took is a removal even if it also carries an older
    // backout stamp — removedAt is the later, deliberate act.
    if (reg.removedAt) { kind = "removed"; at = reg.removedAt; }
    else if (reg.backedOutAt) { kind = "backed_out"; at = reg.backedOutAt; }
    else if (reg.optedOut && reg.optedOutReason === "format_change") { kind = "format_change"; at = reg.optedOutAt ?? null; }
    else if (reg.optedOut) { kind = "skipped"; at = reg.optedOutAt ?? null; }
    if (!kind) return;

    const who = whoIs(reg);
    const playerId = refId(reg.player);
    const atMs = ms(at);
    const guestsStaying = kind === "skipped" && playerId
      ? regs.filter((g) => g.plusOneName && isLiveRow(g) && (refId(g.guestOf) ?? refId(g.player)) === playerId).length
      : 0;

    out.push({
      key: reg._id || `dep-${i}`,
      kind,
      name: who.name,
      isGuest: who.isGuest,
      broughtBy: who.broughtBy,
      playerId,
      at,
      minsBeforeKickoff: kickoff != null && atMs != null ? Math.round((kickoff - atMs) / 60000) : null,
      afterCutoff: reg.backoutType === "post_cutoff",
      paidPaise: reg.amountPaidPaise || 0,
      passPaise: reg.passBenefitPaise || 0,
      feeChargedPaise: reg.backoutFeeChargedPaise || 0,
      feeReturned: Boolean(reg.backoutFeeRefundedAt),
      waivedReason: reg.backoutWaivedReason || null,
      removedBy: kind === "removed" ? organiserLabel(refId(reg.removedBy), ctx) : null,
      rejoined: !who.isGuest && kind !== "skipped" && kind !== "format_change" && !!playerId && livePlayerIds.has(playerId),
      guestsStaying,
    });
  });

  // Most recent first; rows from before timestamps existed sink to the bottom.
  return out.sort((a, b) => (ms(b.at) ?? -Infinity) - (ms(a.at) ?? -Infinity));
}

export interface DepartureSummary {
  total: number;
  backedOut: number;
  removed: number;
  skipped: number;
  formatChange: number;
  /** Left inside the last 24 hours before kick-off. */
  late: number;
  /** Fees kept — charged and not handed back. */
  feesKeptPaise: number;
}

export const LATE_DEPARTURE_MINS = 24 * 60;

export function summariseDepartures(deps: Departure[]): DepartureSummary {
  const s: DepartureSummary = { total: deps.length, backedOut: 0, removed: 0, skipped: 0, formatChange: 0, late: 0, feesKeptPaise: 0 };
  for (const d of deps) {
    if (d.kind === "backed_out") s.backedOut++;
    else if (d.kind === "removed") s.removed++;
    else if (d.kind === "skipped") s.skipped++;
    else s.formatChange++;
    // Only the player's own choices count as late — an organiser's removal or a
    // format change the organiser made is not the player dropping out.
    if ((d.kind === "backed_out" || d.kind === "skipped")
      && d.minsBeforeKickoff != null && d.minsBeforeKickoff < LATE_DEPARTURE_MINS) s.late++;
    if (!d.feeReturned) s.feesKeptPaise += d.feeChargedPaise;
  }
  return s;
}

/** "45m", "5h 20m", "3 days" — how long before kick-off; null if unknown. */
export function formatLeadTime(mins: number | null): string | null {
  if (mins == null) return null;
  if (mins < 0) return "after kick-off";
  if (mins < 60) return `${mins}m before kick-off`;
  if (mins < 48 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m ? ` ${m}m` : ""} before kick-off`;
  }
  return `${Math.floor(mins / (24 * 60))} days before kick-off`;
}

export const WAIVER_LABEL: Record<string, string> = {
  grace: "within the grace period after joining",
  cancelled: "the game was cancelled",
  rescheduled: "the game was rescheduled or changed format",
};

// ── Activity timeline ─────────────────────────────────────────────────────────

export type ActivityKind =
  | "joined" | "guest_added"
  | "backed_out" | "removed" | "skipped" | "format_change"
  | "waitlist_joined" | "waitlist_offered" | "waitlist_declined" | "waitlist_expired"
  | "guest_waitlisted";

export interface ActivityEvent {
  key: string;
  kind: ActivityKind;
  at: string;
  name: string;
  detail: string | null;
}

export function activityOf(
  input: {
    registrations: HistoryRegistration[];
    waitlist?: HistoryWaitlistEntry[];
    guestWaitlist?: HistoryGuestWaitlistEntry[];
  },
  ctx: HistoryContext = {},
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const push = (e: Omit<ActivityEvent, "at"> & { at?: string | null }) => {
    if (e.at && ms(e.at) != null) events.push(e as ActivityEvent);
  };

  input.registrations.forEach((reg, i) => {
    const who = whoIs(reg);
    const k = reg._id || `r${i}`;
    // A tombstoned row still joined once — its arrival is part of the story.
    push({
      key: `${k}:in`,
      kind: who.isGuest ? "guest_added" : "joined",
      at: reg.signedUpAt,
      name: who.name,
      detail: who.isGuest
        ? (who.broughtBy ? `guest of ${who.broughtBy}` : "your guest")
        : reg.seatType === "host" ? "host spot" : null,
    });
  });

  for (const d of departuresOf(input.registrations, ctx)) {
    const lead = formatLeadTime(d.minsBeforeKickoff);
    const detail = d.kind === "removed"
      ? [d.removedBy ? `by ${d.removedBy}` : null, d.isGuest && d.broughtBy ? `guest of ${d.broughtBy}` : null].filter(Boolean).join(" · ") || null
      : [d.isGuest && d.broughtBy ? `guest of ${d.broughtBy}` : null, lead].filter(Boolean).join(" · ") || null;
    push({ key: `${d.key}:out`, kind: d.kind, at: d.at, name: d.name, detail });
  }

  (input.waitlist || []).forEach((w, i) => {
    const k = w._id || `w${i}`;
    const name = refName(w.player) ?? "Unknown player";
    push({
      key: `${k}:wl`, kind: "waitlist_joined", at: w.joinedAt, name,
      detail: w.source === "opted_out_rejoin" ? "asking to get back in" : null,
    });
    push({ key: `${k}:offer`, kind: "waitlist_offered", at: w.notifiedAt, name, detail: null });
    if (w.status === "declined") push({ key: `${k}:no`, kind: "waitlist_declined", at: w.respondedAt, name, detail: null });
    if (w.status === "expired") push({ key: `${k}:exp`, kind: "waitlist_expired", at: w.respondedAt ?? w.notifiedAt, name, detail: null });
  });

  (input.guestWaitlist || []).forEach((g, i) => {
    push({
      key: `${g._id || `g${i}`}:gwl`, kind: "guest_waitlisted", at: g.requestedAt,
      name: g.plusOneName || "Guest",
      detail: refName(g.player) ? `guest of ${refName(g.player)}` : null,
    });
  });

  return events.sort((a, b) => (ms(b.at) as number) - (ms(a.at) as number));
}

const IST_DAY = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

/** Events bucketed by IST calendar day, newest day first, labelled Today/Yesterday/date. */
export function groupByIstDay(
  events: ActivityEvent[],
  now: Date = new Date(),
): { day: string; label: string; events: ActivityEvent[] }[] {
  const today = IST_DAY(now.toISOString());
  const yesterday = IST_DAY(new Date(now.getTime() - 86_400_000).toISOString());
  const groups: { day: string; label: string; events: ActivityEvent[] }[] = [];
  for (const e of events) {
    const day = IST_DAY(e.at);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      const label = day === today ? "Today" : day === yesterday ? "Yesterday"
        : new Date(e.at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
      g = { day, label, events: [] };
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups;
}

/** "2m ago", "3h ago", "4d ago" — for the joined-at line on a card. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  const t = ms(iso);
  if (t == null) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
