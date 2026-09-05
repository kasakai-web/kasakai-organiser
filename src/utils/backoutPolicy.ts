// The cancellation policy as the organiser forms handle it.
//
// The RULES live on the server (kasakai-backend/src/utils/backoutPolicy.js) and
// are never re-implemented here — the portal only has to collect the numbers and
// describe them back. Anything that decides what a player is actually charged is
// the server's answer, which is why there is no "what would this cost" function
// in this file.
//
// Shared by CreateEventForm, TemplateForm, RecurringSeriesForm and SeriesDetail so
// all four serialise the same shape; the markup differs per surface because those
// forms use different styling systems.

export interface BackoutFeeTier {
  withinMins: number;
  feeInPaise: number;
}

export interface BackoutPolicy {
  /** Simple mode: charge the flat fee inside this many minutes of kick-off. 0 = never. */
  windowMins: number;
  /** Free cancellation for this long after a player joins. 0 = no grace. */
  graceMins: number;
  /** Waive if the game is cancelled, or its kick-off/format changes after they joined. */
  waiveOnCancel: boolean;
  /** Advanced mode: a sliding scale. Any tier here supersedes windowMins. */
  tiers: BackoutFeeTier[];
}

export const emptyBackoutPolicy = (): BackoutPolicy => ({
  windowMins: 0,
  graceMins: 0,
  waiveOnCancel: true,
  tiers: [],
});

/** Hydrate a form from whatever the API returned, including nothing at all. */
export function fromStored(raw: Partial<BackoutPolicy> | null | undefined): BackoutPolicy {
  const d = emptyBackoutPolicy();
  if (!raw) return d;
  return {
    windowMins: Number(raw.windowMins) || 0,
    graceMins: Number(raw.graceMins) || 0,
    waiveOnCancel: raw.waiveOnCancel ?? d.waiveOnCancel,
    tiers: Array.isArray(raw.tiers)
      ? raw.tiers
          .map((t) => ({ withinMins: Number(t?.withinMins) || 0, feeInPaise: Number(t?.feeInPaise) || 0 }))
          .filter((t) => t.withinMins > 0 && t.feeInPaise > 0)
          .sort((a, b) => a.withinMins - b.withinMins)
      : [],
  };
}

/**
 * Common windows, in minutes. Offered as a picker rather than a free-text box
 * because "2" in a minutes field when the organiser meant hours is a fee that
 * fires 120 times too late, and nothing in the UI would show them that.
 */
export const WINDOW_CHOICES: { label: string; mins: number }[] = [
  { label: "No fee", mins: 0 },
  { label: "1 hour", mins: 60 },
  { label: "2 hours", mins: 120 },
  { label: "6 hours", mins: 360 },
  { label: "12 hours", mins: 720 },
  { label: "24 hours", mins: 1440 },
  { label: "48 hours", mins: 2880 },
];

export const GRACE_CHOICES: { label: string; mins: number }[] = [
  { label: "None", mins: 0 },
  { label: "5 minutes", mins: 5 },
  { label: "15 minutes", mins: 15 },
  { label: "30 minutes", mins: 30 },
  { label: "1 hour", mins: 60 },
];

/** "2 hours" / "45 minutes" / "3 days" — for hints and tier rows. */
export function formatMins(mins: number): string {
  if (!mins) return "0 minutes";
  if (mins % (24 * 60) === 0) { const d = mins / (24 * 60); return `${d} day${d === 1 ? "" : "s"}`; }
  if (mins % 60 === 0) { const h = mins / 60; return `${h} hour${h === 1 ? "" : "s"}`; }
  return `${mins} minutes`;
}

/**
 * The plain-English summary shown under the controls, so the organiser reads back
 * the policy they just built rather than inferring it from three separate inputs.
 * `feeInRs` is the simple-mode amount, which only matters when there are no tiers.
 */
export function describeForOrganiser(policy: BackoutPolicy, feeInRs: string | number): string {
  const rs = Number(feeInRs) || 0;
  const scale = policy.tiers.length
    ? policy.tiers
        .map((t) => `₹${Math.round(t.feeInPaise / 100)} within ${formatMins(t.withinMins)}`)
        .join(", then ")
    : policy.windowMins > 0 && rs > 0
      ? `₹${rs} within ${formatMins(policy.windowMins)} of kick-off`
      : "";

  if (!scale) return "No cancellation fee — players get a full refund whenever they leave.";

  const parts = [`Per slot given up: ${scale}. Free before that.`];
  if (policy.graceMins > 0) parts.push(`Free to change their mind within ${formatMins(policy.graceMins)} of joining.`);
  if (policy.waiveOnCancel) parts.push("No fee if you cancel the game, move the kick-off or switch the format.");
  return parts.join(" ");
}

/** What goes on the wire. Tiers are dropped entirely when empty, not sent as []. */
export function toPayload(policy: BackoutPolicy) {
  return {
    windowMins: policy.tiers.length ? 0 : policy.windowMins,
    graceMins: policy.graceMins,
    waiveOnCancel: policy.waiveOnCancel,
    tiers: policy.tiers,
  };
}
