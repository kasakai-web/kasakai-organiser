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

export type FeeUnit = "flat" | "percent";

/**
 * Both amounts are carried so flipping the unit back and forth never loses what
 * the organiser typed; `toPayload` sends only the one the unit says.
 */
export interface BackoutFeeTier {
  withinMins: number;
  feeInPaise: number;
  /** Share of what the seat was worth, 1–100. Used when feeUnit is "percent". */
  percent: number;
}

export interface BackoutPolicy {
  /** Simple mode: charge the flat fee inside this many minutes of kick-off. 0 = never. */
  windowMins: number;
  /** Free cancellation for this long after a player joins. 0 = no grace. */
  graceMins: number;
  /** Waive if the game is cancelled, or its kick-off/format changes after they joined. */
  waiveOnCancel: boolean;
  /** "flat" = rupees per seat; "percent" = a share of what each seat was worth. */
  feeUnit: FeeUnit;
  /** Simple mode in percent units — the twin of the game's flat backout fee. */
  feePercent: number;
  /** Advanced mode: a sliding scale. Any tier here supersedes windowMins. */
  tiers: BackoutFeeTier[];
}

export const emptyBackoutPolicy = (): BackoutPolicy => ({
  windowMins: 0,
  graceMins: 0,
  waiveOnCancel: true,
  feeUnit: "flat",
  feePercent: 0,
  tiers: [],
});

/** What a freshly added tier, or one switched into a unit it has no amount in, starts at. */
const DEFAULT_TIER_FEE_PAISE = 5000;
const DEFAULT_TIER_PERCENT = 50;

/** Hydrate a form from whatever the API returned, including nothing at all. */
export function fromStored(raw: Partial<BackoutPolicy> | null | undefined): BackoutPolicy {
  const d = emptyBackoutPolicy();
  if (!raw) return d;
  const feeUnit: FeeUnit = raw.feeUnit === "percent" ? "percent" : "flat";
  return {
    windowMins: Number(raw.windowMins) || 0,
    graceMins: Number(raw.graceMins) || 0,
    waiveOnCancel: raw.waiveOnCancel ?? d.waiveOnCancel,
    feeUnit,
    feePercent: Number(raw.feePercent) || 0,
    tiers: Array.isArray(raw.tiers)
      ? raw.tiers
          .map((t) => ({
            withinMins: Number(t?.withinMins) || 0,
            feeInPaise: Number(t?.feeInPaise) || 0,
            percent: Number(t?.percent) || 0,
          }))
          .filter((t) => t.withinMins > 0 && (feeUnit === "percent" ? t.percent > 0 : t.feeInPaise > 0))
          .sort((a, b) => a.withinMins - b.withinMins)
      : [],
  };
}

/** A new tier for the scale, in whichever unit the policy is using. */
export const newTier = (withinMins = 120): BackoutFeeTier => ({
  withinMins,
  feeInPaise: DEFAULT_TIER_FEE_PAISE,
  percent: DEFAULT_TIER_PERCENT,
});

/**
 * Flip between rupees and percent. Tiers keep their windows; any amount that was
 * never set in the new unit gets a default rather than a zero, because the server
 * drops a zero-fee tier and the row would silently vanish on save.
 */
export function switchUnit(policy: BackoutPolicy, feeUnit: FeeUnit): BackoutPolicy {
  return {
    ...policy,
    feeUnit,
    tiers: policy.tiers.map((t) => ({
      ...t,
      feeInPaise: t.feeInPaise || DEFAULT_TIER_FEE_PAISE,
      percent: t.percent || DEFAULT_TIER_PERCENT,
    })),
  };
}

/** Keep a typed percentage a whole number between 0 and 100. */
export const clampPercent = (raw: string | number): number =>
  Math.min(100, Math.max(0, Math.round(Number(raw) || 0)));

/**
 * Common windows, in minutes. Offered as a picker rather than a free-text box
 * because "2" in a minutes field when the organiser meant hours is a fee that
 * fires 120 times too late, and nothing in the UI would show them that.
 */
// Runs to the server's ceiling (LIMITS.maxWindowMins, 7 days).
export const WINDOW_CHOICES: { label: string; mins: number }[] = [
  { label: "No fee", mins: 0 },
  { label: "30 minutes", mins: 30 },
  { label: "1 hour", mins: 60 },
  { label: "2 hours", mins: 120 },
  { label: "3 hours", mins: 180 },
  { label: "4 hours", mins: 240 },
  { label: "6 hours", mins: 360 },
  { label: "8 hours", mins: 480 },
  { label: "12 hours", mins: 720 },
  { label: "18 hours", mins: 1080 },
  { label: "24 hours", mins: 1440 },
  { label: "36 hours", mins: 2160 },
  { label: "48 hours", mins: 2880 },
  { label: "3 days", mins: 3 * 1440 },
  { label: "4 days", mins: 4 * 1440 },
  { label: "5 days", mins: 5 * 1440 },
  { label: "7 days", mins: 7 * 1440 },
];

// Runs to the server's ceiling (LIMITS.maxGraceMins, 24 hours).
export const GRACE_CHOICES: { label: string; mins: number }[] = [
  { label: "None", mins: 0 },
  { label: "5 minutes", mins: 5 },
  { label: "15 minutes", mins: 15 },
  { label: "30 minutes", mins: 30 },
  { label: "1 hour", mins: 60 },
  { label: "2 hours", mins: 120 },
  { label: "3 hours", mins: 180 },
  { label: "6 hours", mins: 360 },
  { label: "12 hours", mins: 720 },
  { label: "24 hours", mins: 1440 },
];

/**
 * The choices plus `current` when it is not one of them — a value saved through
 * the API or by an older build must still show as selected, not snap to the first
 * option and get overwritten on the next save.
 */
export function choicesWith(
  choices: { label: string; mins: number }[],
  current: number,
): { label: string; mins: number }[] {
  if (current < 0 || choices.some((c) => c.mins === current)) return choices;
  return [...choices, { label: formatMins(current), mins: current }].sort((a, b) => a.mins - b.mins);
}

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
export function describeForOrganiser(
  policy: BackoutPolicy,
  feeInRs: string | number,
  /** The game's own price, to turn a percentage into an example amount. Optional. */
  gameFeeInRs?: string | number,
): string {
  const rs = Number(feeInRs) || 0;
  const pct = policy.feeUnit === "percent";
  const price = Number(gameFeeInRs) || 0;
  const amount = (t: BackoutFeeTier) => {
    if (!pct) return `₹${Math.round(t.feeInPaise / 100)}`;
    return price > 0 ? `${t.percent}% (₹${Math.round((price * t.percent) / 100)})` : `${t.percent}%`;
  };
  const simple: BackoutFeeTier = { withinMins: policy.windowMins, feeInPaise: rs * 100, percent: policy.feePercent };
  const simpleSet = policy.windowMins > 0 && (pct ? policy.feePercent > 0 : rs > 0);
  const scale = policy.tiers.length
    ? policy.tiers.map((t) => `${amount(t)} within ${formatMins(t.withinMins)}`).join(", then ")
    : simpleSet
      ? `${amount(simple)} within ${formatMins(policy.windowMins)} of kick-off`
      : "";

  if (!scale) return "No cancellation fee — players get a full refund whenever they leave.";

  const parts = [`Per slot given up: ${scale}${pct ? " of what that slot cost" : ""}. Free before that.`];
  if (policy.graceMins > 0) parts.push(`Free to change their mind within ${formatMins(policy.graceMins)} of joining.`);
  if (policy.waiveOnCancel) parts.push("No fee if you cancel the game, move the kick-off or switch the format.");
  return parts.join(" ");
}

/** What goes on the wire. Tiers are dropped entirely when empty, not sent as []. */
export function toPayload(policy: BackoutPolicy) {
  const pct = policy.feeUnit === "percent";
  return {
    windowMins: policy.tiers.length ? 0 : policy.windowMins,
    graceMins: policy.graceMins,
    waiveOnCancel: policy.waiveOnCancel,
    feeUnit: policy.feeUnit,
    feePercent: pct ? policy.feePercent : 0,
    tiers: policy.tiers.map((t) =>
      pct ? { withinMins: t.withinMins, percent: t.percent } : { withinMins: t.withinMins, feeInPaise: t.feeInPaise }),
  };
}
