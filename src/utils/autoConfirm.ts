// The two check-in switches as the organiser forms word them: "Auto-confirm at
// minimum" and "Auto-cancel at the 2nd check-in". Each owns ONE outcome.
//
// The RULES live on the server: from the 1st check-in up to and including the
// 2nd, the first moment the count reaches the minimum, the game is confirmed
// (kasakai-backend/src/utils/autoConfirm.js + gameLifecycle.service#decideSecondCheck)
// — and a confirmed game is never moved back. At the 2nd check-in a game below
// every playable minimum is cancelled and refunded if auto-cancel is on. Playing
// the alternate format is never automatic. Nothing here decides anything; it
// only words the settings and the one warning the forms show.
//
// Shared by CreateEventForm, EditEventModal, TemplateForm and RecurringSeriesForm
// so all four say the same thing.

import type { BackoutPolicy } from "./backoutPolicy";

export const AUTO_CONFIRM_LABEL = "Auto-confirm at minimum";

export const autoConfirmHelper = (on: boolean): string =>
  on
    ? "ON: from the 1st check-in up to the 2nd, the game is confirmed the moment it has its minimum players — at the 1st check-in if it already does, or when the joiner who takes it there books. Players get the usual \"game confirmed\" message. A confirmed game stays confirmed: if players leave afterwards you get an SOS prompt, never an automatic cancel."
    : "OFF: you confirm the game yourself. At the 2nd check-in, if it has its minimum, you get a pop-up + WhatsApp asking you to.";

// The `automationEnabled` field. Its name is historical — it once also
// confirmed and switched formats at the 2nd check-in; now it only cancels.
export const AUTO_CANCEL_LABEL = "Auto-cancel at the 2nd check-in if below minimum";

export const autoCancelHelper = (on: boolean): string =>
  on
    ? "ON: if the game is still below its minimum at the 2nd check-in, it is cancelled and every player refunded — no pop-up. A game with an alternate format is only cancelled below the alternate's minimum; with enough for the alternate, you decide whether to switch."
    : "OFF: a game below its minimum at the 2nd check-in is never cancelled by itself. You get a pop-up + WhatsApp and decide — cancel, switch, send an SOS, or keep waiting.";

export const AUTO_CONFIRM_NEEDS_CHECKINS = "Needs both check-in times — they are when it starts checking.";

export const AUTO_CONFIRM_LOCKED = "Can't be changed once the game is confirmed.";

const fmtIst = (ms: number): string =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

// A policy in either unit: a flat amount (the game's rupee fee, or paise per
// tier) or a share of what the seat was worth (`feeUnit: "percent"` with
// `feePercent` / `tiers[].percent`). Typed loosely so it reads both the
// percent-aware policy shape and the older flat-only one.
type AnyPolicy = BackoutPolicy & { feeUnit?: string; feePercent?: number };
type AnyTier = { withinMins: number; feeInPaise?: number; percent?: number };

/**
 * How many minutes before kick-off a cancellation fee starts to bite, or 0 for
 * no fee at all. Tiers supersede the simple pair, as on the server.
 */
export function feeWindowMins(policy: BackoutPolicy, feeInRs: string | number): number {
  const p = policy as AnyPolicy;
  const percent = p.feeUnit === "percent";
  const charges = (t: AnyTier) =>
    t.withinMins > 0 && (percent ? (Number(t.percent) || 0) > 0 : (Number(t.feeInPaise) || 0) > 0);
  const tiers = ((p.tiers || []) as AnyTier[]).filter(charges);
  if (tiers.length) return Math.max(...tiers.map((t) => t.withinMins));
  const amount = percent ? Number(p.feePercent) || 0 : Number(feeInRs) || 0;
  return amount > 0 && p.windowMins > 0 ? p.windowMins : 0;
}

/**
 * The form's warning (not a block) when a confirmed game would still be free to
 * leave: once auto-confirm can confirm at the 1st check-in, a backout should
 * cost something from then on, or the confirmation is a promise only the
 * organiser keeps. Null when there is nothing to warn about.
 */
export function freeExitWarning({
  on,
  kickoffIso,
  firstCheckIso,
  policy,
  feeInRs,
}: {
  on: boolean;
  kickoffIso: string | null;
  firstCheckIso: string | null;
  policy: BackoutPolicy;
  feeInRs: string | number;
}): string | null {
  if (!on || !kickoffIso || !firstCheckIso) return null;
  const kickoff = new Date(kickoffIso).getTime();
  const first = new Date(firstCheckIso).getTime();
  if (isNaN(kickoff) || isNaN(first)) return null;
  const windowMins = feeWindowMins(policy, feeInRs);
  if (windowMins === 0) {
    return "Players can leave your confirmed game for free right up to kick-off — there is no cancellation fee. Add one so a confirmation holds.";
  }
  const opensAt = kickoff - windowMins * 60000;
  if (opensAt <= first) return null;
  return `Players can leave your confirmed game for free until ${fmtIst(opensAt)}. Widen the cancellation-fee window to start at the 1st check-in or earlier.`;
}
