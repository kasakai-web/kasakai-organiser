// Test tools — the organiser portal's pure helpers (Test_Speedups_Plan.md).
//
// Everything here exists for the TEST server only. The portal shows a test
// control only after the backend's GET /test-tools/status answers, and the
// production backend never answers it (the route is not mounted there), so
// nothing in this file is reachable on production.
//
// The backend's utils/testTimings.js is the source of the rules; the timeline
// and warnings below mirror it for the create form's LIVE preview only. The game
// itself is checked by the backend when it is created.

export type TestTimings = {
  lastCallMins: number;
  reminderMins: number;
  autoCompleteMins: number;
  videoWaitMins: number;
};

export type TestSettings = TestTimings & {
  kickoffInMins: number;
  firstCheckInMins: number;
  secondCheckInMins: number;
  reportingMins: number;
  durationMins: number;
  tickSeconds: number;
};

export type TestFlag = { name: string; on: boolean };

export type TestStatus = {
  enabled: boolean;
  database?: string | null;
  flags: TestFlag[];
  settings: TestSettings;
  tickChoices: number[];
  testAccounts: number;
  testAccountTarget: number;
  testCode: string;
};

export type JumpStep = "check1" | "check2" | "last_call" | "kickoff" | "end" | "video";

export type JumpState = {
  step: JumpStep;
  label: string;
  at: string | null;
  available: boolean;
  reason: string | null;
};

export type TestPlayer = { playerId: string; name: string | null; guests: number; optedOut: boolean };

export type GameControls = {
  gameId: string;
  status: string;
  hasTestTimings: boolean;
  timings: TestTimings;
  timeline: Record<string, string | null>;
  jumps: JumpState[];
  testPlayers: TestPlayer[];
  testAccounts: number;
  flags: TestFlag[];
};

// The defaults the backend falls back to — used only if the status call has no
// settings (it always does when test tools are on).
export const FALLBACK_SETTINGS: TestSettings = {
  kickoffInMins: 20,
  firstCheckInMins: 2,
  secondCheckInMins: 5,
  reportingMins: 0,
  durationMins: 5,
  lastCallMins: 2,
  reminderMins: 1,
  autoCompleteMins: 1,
  videoWaitMins: 2,
  tickSeconds: 15,
};

// Same as the backend: two check-ins closer than this can run in one job pass.
export const MIN_CHECK_GAP_MINS = 2;

const MIN = 60 * 1000;

// IST calendar date (YYYY-MM-DD) and time (HH:mm) of an instant.
export const istDate = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const istTime = (d: Date): string =>
  d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

// "2:05 PM" in IST.
export const clock = (d: Date | string | null | undefined): string => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
};

/**
 * The form fields a plan fills, counted from `now`. Minutes count from the NEXT
 * whole minute, so "check-in 1 in 2 min" is never less than two minutes away
 * once the seconds are dropped.
 */
export function planFromNow(plan: Pick<TestSettings, "kickoffInMins" | "firstCheckInMins" | "secondCheckInMins">, now: Date) {
  const base = Math.ceil(now.getTime() / MIN) * MIN;
  const kickoff = new Date(base + plan.kickoffInMins * MIN);
  const first = new Date(base + plan.firstCheckInMins * MIN);
  const second = new Date(base + plan.secondCheckInMins * MIN);
  return {
    date: istDate(kickoff),
    time: istTime(kickoff),
    firstCheckDate: istDate(first),
    firstCheckTime: istTime(first),
    secondCheckDate: istDate(second),
    secondCheckTime: istTime(second),
    kickoff,
    first,
    second,
  };
}

export type TimelineRow = { key: string; label: string; at: Date };

// The moments a game is built from: kick-off, both check-ins, reporting, length.
export type GameTimes = {
  kickoff: Date | null;
  first: Date | null;
  second: Date | null;
  reportingMins: number;
  durationMins: number;
};

/** Every moment the automation will act on, in order, for these times and waits. */
export function timelineFrom(t: GameTimes, waits: TestTimings): TimelineRow[] {
  const rows: TimelineRow[] = [];
  if (t.first) rows.push({ key: "check1", label: "Check-in 1", at: t.first });
  if (t.second) {
    rows.push({ key: "reminder", label: "Reminder", at: new Date(t.second.getTime() - waits.reminderMins * MIN) });
    rows.push({ key: "check2", label: "Check-in 2", at: t.second });
  }
  if (t.kickoff) {
    const kickoff = t.kickoff.getTime();
    const reporting = kickoff - t.reportingMins * MIN;
    const ends = kickoff + t.durationMins * MIN;
    const completes = ends + waits.autoCompleteMins * MIN;
    rows.push(
      { key: "lastCall", label: "Last call", at: new Date(reporting - waits.lastCallMins * MIN) },
      { key: "report", label: "Players report", at: new Date(reporting) },
      { key: "kickoff", label: "Kick-off", at: t.kickoff },
      { key: "ends", label: "Ends", at: new Date(ends) },
      { key: "completes", label: "Completes", at: new Date(completes) },
      { key: "video", label: "Video WhatsApp", at: new Date(completes + waits.videoWaitMins * MIN) },
    );
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The timeline a plan gives when counted from `now`. */
export function timelinePreview(plan: TestSettings, now: Date): TimelineRow[] {
  const p = planFromNow(plan, now);
  return timelineFrom(
    { kickoff: p.kickoff, first: p.first, second: p.second, reportingMins: plan.reportingMins, durationMins: plan.durationMins },
    timingsOf(plan),
  );
}

/** The mistakes that waste a test — the backend's timelineWarnings plus the hard errors. */
export function timesProblems(t: GameTimes, waits: TestTimings, now: Date): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!t.kickoff || !t.first || !t.second) {
    errors.push("Kick-off and both check-ins are needed.");
    return { errors, warnings };
  }
  if (t.first.getTime() <= now.getTime()) errors.push("Check-in 1 is already in the past.");
  if (t.first.getTime() >= t.second.getTime()) errors.push("Check-in 2 must come after check-in 1.");
  if (t.second.getTime() >= t.kickoff.getTime()) errors.push("Both check-ins must come before kick-off.");
  if (t.durationMins < 1) errors.push("The game must last at least 1 minute.");
  if (errors.length) return { errors, warnings };
  if (t.second.getTime() - t.first.getTime() < MIN_CHECK_GAP_MINS * MIN) {
    warnings.push(`The check-ins are less than ${MIN_CHECK_GAP_MINS} minutes apart, so both can run in the same job pass and auto-confirm gets no window.`);
  }
  const lastCall = t.kickoff.getTime() - (t.reportingMins + waits.lastCallMins) * MIN;
  if (lastCall < t.second.getTime()) {
    warnings.push("The last call comes before check-in 2, so it runs on a game that is not confirmed yet.");
  }
  return { errors, warnings };
}

/** timesProblems for a plan counted from `now`. */
export function planProblems(plan: TestSettings, now: Date = new Date()): { errors: string[]; warnings: string[] } {
  const p = planFromNow(plan, now);
  return timesProblems(
    { kickoff: p.kickoff, first: p.first, second: p.second, reportingMins: plan.reportingMins, durationMins: plan.durationMins },
    timingsOf(plan),
    now,
  );
}

export const timingsOf = (plan: TestSettings): TestTimings => ({
  lastCallMins: plan.lastCallMins,
  reminderMins: plan.reminderMins,
  autoCompleteMins: plan.autoCompleteMins,
  videoWaitMins: plan.videoWaitMins,
});

// The fields the "Test timings" tab edits, in display order.
export const PLAN_FIELDS: { key: keyof TestSettings; label: string; hint: string; min: number; max: number }[] = [
  { key: "kickoffInMins", label: "Kick-off in", hint: "minutes from now", min: 2, max: 10080 },
  { key: "firstCheckInMins", label: "Check-in 1 in", hint: "minutes from now", min: 1, max: 10080 },
  { key: "secondCheckInMins", label: "Check-in 2 in", hint: "minutes from now", min: 1, max: 10080 },
  { key: "reportingMins", label: "Players report", hint: "minutes before kick-off", min: 0, max: 120 },
  { key: "durationMins", label: "Game duration", hint: "minutes", min: 1, max: 300 },
  { key: "lastCallMins", label: "Last call", hint: "minutes before reporting time (normally 60)", min: 0, max: 240 },
  { key: "reminderMins", label: "Reminder", hint: "minutes before check-in 2 (normally 30)", min: 0, max: 120 },
  { key: "autoCompleteMins", label: "Auto-complete", hint: "minutes after the game ends (normally 30)", min: 0, max: 120 },
  { key: "videoWaitMins", label: "Video WhatsApp wait", hint: "minutes (normally 120)", min: 0, max: 240 },
];
