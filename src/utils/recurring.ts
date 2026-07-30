// Client helpers for recurring game schedules: types mirroring the backend
// models, the REST calls, and the small formatting helpers the calendar preview
// needs.
//
// Deliberately NOT here: expanding a rule into dates. The backend owns that, and
// the preview endpoint runs the exact same engine the generation job runs — so
// what the organiser sees before saving is what they get, rather than two
// implementations that drift.

import { buildApiUrl, getSession } from "@/utils/api";
import type { Format } from "@/utils/templates";

export type Freq = "daily" | "weekly" | "monthly";
export type EndMode = "never" | "onDate" | "afterCount";
export type SeriesStatus = "active" | "paused" | "ended" | "archived";
export type OccurrenceStatus = "planned" | "created" | "skipped" | "cancelled" | "detached";
export type EditScope = "occurrence" | "future" | "series";

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  weekdays: number[];              // weekly — 0=Sun … 6=Sat (IST)
  monthlyMode?: "dayOfMonth" | "nthWeekday";
  dayOfMonth?: number | null;
  nth?: number | null;             // 1..4, or -1 for "last"
  nthWeekday?: number | null;
  timeOfDay: string;               // "HH:mm" IST
}

export interface SeriesGameDefaults {
  title?: string | null;
  /** Token pattern for the game name — "{weekday} {daypart} Game | {venueShort}". Wins over `title`. */
  titlePattern?: string | null;
  visibility?: "public" | "private";
  requiresApproval?: boolean;
  turf?: { _id: string; name?: string; location?: { city?: string } } | string | null;
  format?: Format;
  durationMins?: number;
  reportingMinsBeforeGame?: number;
  cutoffHoursBeforeGame?: number;
  feeInPaise?: number;
  backoutFeeInPaise?: number;
  minPlayers?: number;
  totalSlots?: number;
  allowSizeChange?: boolean;
  organiserIsPlaying?: boolean;
  automationEnabled?: boolean;
  firstCheckTime?: string | null;
  secondCheckTime?: string | null;
}

export interface BlackoutRange {
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD
  label?: string | null;
}

export interface ConflictPolicy {
  mode: "warn" | "block";
  checkVenue: boolean;
  checkOrganiser: boolean;
  checkOverlap: boolean;
}

export interface OccurrenceConflict {
  type: "venue" | "organiser" | "overlap";
  message: string;
  game?: string | null;
}

// "Edit this game only". Every field is nullable: null means the occurrence has
// no opinion and the series' gameDefaults apply. Clearing an override is
// therefore setting it back to null, not to zero.
export interface OccurrenceOverrides {
  title?: string | null;
  turf?: { _id: string; name?: string } | string | null;
  format?: Format | null;
  durationMins?: number | null;
  reportingMinsBeforeGame?: number | null;
  cutoffHoursBeforeGame?: number | null;
  feeInPaise?: number | null;
  backoutFeeInPaise?: number | null;
  minPlayers?: number | null;
  totalSlots?: number | null;
  visibility?: "public" | "private" | null;
  organiserIsPlaying?: boolean | null;
}

export interface SeriesOccurrence {
  _id: string;
  series: string;
  occurrenceKey: string;
  occurrenceDate: string;
  seq: number;
  scheduledAt: string;
  originalScheduledAt: string;
  status: OccurrenceStatus;
  game?: { _id: string; title?: string; status?: string; scheduledAt?: string; totalSlots?: number; registrations?: unknown[] } | string | null;
  overrides?: OccurrenceOverrides;
  isCustomised?: boolean;
  isRescheduled?: boolean;
  isExtra?: boolean;
  conflicts?: OccurrenceConflict[];
  blockedByConflict?: boolean;
  skipReason?: string | null;
  cancelReason?: string | null;
}

export interface RecurringSeries {
  _id: string;
  name: string;
  description?: string | null;
  status: SeriesStatus;
  rule: RecurrenceRule;
  startDate: string;
  endMode: EndMode;
  endDate?: string | null;
  maxOccurrences?: number | null;
  blackoutRanges?: BlackoutRange[];
  conflictPolicy?: ConflictPolicy;
  generation?: { horizonDays?: number; leadDays?: number; lastRunAt?: string | null; lastError?: string | null };
  gameDefaults: SeriesGameDefaults;
  notifyOrganiser?: { onCreate: boolean; onChange: boolean; onCancel: boolean };
  stats?: { gamesCreated?: number; occurrencesSkipped?: number; occurrencesCancelled?: number };
  // Server-computed extras
  description_text?: string;
  upcomingCount?: number;
  nextOccurrence?: { scheduledAt: string; status: OccurrenceStatus } | null;
  occurrences?: SeriesOccurrence[];
  createdAt?: string;
}

export interface PreviewOccurrence {
  date: string;
  seq: number;
  weekday: number;
  scheduledAt: string;
  conflicts: OccurrenceConflict[];
  /** The name this game will actually be created with — a resolved pattern, or the literal title. */
  resolvedTitle?: string | null;
}

export interface SchedulePreview {
  description: string;
  complete: boolean;
  truncated: boolean;
  blackedOut: { date: string; label: string | null }[];
  occurrences: PreviewOccurrence[];
}

// ── Formatting ───────────────────────────────────────────────────────────────
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const todayIST = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const rupees = (paise?: number | null) => `₹${((paise || 0) / 100).toLocaleString("en-IN")}`;

// "Wed, 5 Aug" for an ISO instant or a YYYY-MM-DD.
export const prettyDate = (value?: string | null): string => {
  if (!value) return "";
  const d = value.length === 10 ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
};

export const prettyDateFull = (value?: string | null): string => {
  if (!value) return "";
  const d = value.length === 10 ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

// "7:00 PM" for an ISO instant.
export const prettyClock = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
};

// "7:00 PM" for an "HH:mm" time-of-day.
export const prettyTimeOfDay = (hhmm?: string): string => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return "";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// The datetime-local value ("YYYY-MM-DDTHH:mm") for an instant, in IST — what
// the reschedule input needs so the organiser edits the time they actually see.
export const toISTInputValue = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}T${time}`;
};

// A datetime-local value is wall-clock with no zone; the organiser means IST.
export const fromISTInputValue = (value: string): string | null => {
  if (!value) return null;
  const d = new Date(`${value}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const ORDINAL: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "-1": "last" };

// A local echo of the rule, for list rows where a round-trip would be silly.
// The authoritative wording is `description_text` off the API.
export const describeRule = (s: Pick<RecurringSeries, "rule" | "endMode" | "endDate" | "maxOccurrences">): string => {
  const { rule } = s;
  if (!rule) return "";
  const n = rule.interval || 1;
  let core: string;

  if (rule.freq === "daily") {
    core = n === 1 ? "Every day" : `Every ${n} days`;
  } else if (rule.freq === "weekly") {
    const days = [...(rule.weekdays || [])].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(", ");
    const every = n === 1 ? "Every week" : `Every ${n} weeks`;
    core = days ? `${every} on ${days}` : every;
  } else {
    const every = n === 1 ? "Every month" : `Every ${n} months`;
    core = rule.monthlyMode === "nthWeekday"
      ? `${every} on the ${ORDINAL[String(rule.nth)] || "first"} ${WEEKDAYS[Number(rule.nthWeekday)] || "Sun"}`
      : `${every} on day ${rule.dayOfMonth}`;
  }

  const at = rule.timeOfDay ? ` at ${prettyTimeOfDay(rule.timeOfDay)}` : "";
  const ends = s.endMode === "onDate" && s.endDate
    ? `, until ${prettyDateFull(s.endDate)}`
    : s.endMode === "afterCount" && s.maxOccurrences
      ? `, for ${s.maxOccurrences} game${s.maxOccurrences === 1 ? "" : "s"}`
      : "";
  return `${core}${at}${ends}`;
};

// ── Game-name patterns ───────────────────────────────────────────────────────
// The tokens the name picker offers. Resolution and validation live on the
// backend (utils/titlePattern) — for the same reason rule expansion does: the
// preview endpoint runs the exact code the generation job runs, so what the
// organiser sees is what the game gets. This list is only the palette to insert
// from, and the API rejects anything it doesn't know.
export interface TitleToken {
  token: string;
  label: string;
  example: string;
}

export const TITLE_TOKENS: TitleToken[] = [
  { token: "{weekday}", label: "Weekday", example: "Monday" },
  { token: "{weekdayShort}", label: "Weekday, short", example: "Mon" },
  { token: "{daypart}", label: "Part of day", example: "Morning" },
  { token: "{time}", label: "Kick-off time", example: "7:00 PM" },
  { token: "{date}", label: "Date", example: "5 Aug 2026" },
  { token: "{day}", label: "Day of month", example: "5" },
  { token: "{month}", label: "Month", example: "August" },
  { token: "{monthShort}", label: "Month, short", example: "Aug" },
  { token: "{year}", label: "Year", example: "2026" },
  { token: "{nth}", label: "Nth of month", example: "2nd" },
  { token: "{venue}", label: "Venue", example: "Lakeside Turf" },
  { token: "{venueShort}", label: "Venue, short", example: "Lakeside" },
  { token: "{area}", label: "Venue area", example: "Whitefield" },
  { token: "{city}", label: "Venue city", example: "Bengaluru" },
  { token: "{format}", label: "Format", example: "6v6" },
  { token: "{seq}", label: "Game number", example: "7" },
  { token: "{total}", label: "Games in total", example: "12" },
  { token: "{scheduleName}", label: "Schedule name", example: "Sunday League" },
];

// Ready-made patterns, so the common cases are one click rather than an
// exercise in typing braces.
export const TITLE_PATTERN_PRESETS: { label: string; pattern: string }[] = [
  { label: "Monday Morning Game | Lakeside", pattern: "{weekday} {daypart} Game | {venueShort}" },
  { label: "Mon 7:00 PM · 6v6 · Lakeside", pattern: "{weekdayShort} {time} · {format} · {venueShort}" },
  { label: "Sunday League #7", pattern: "{scheduleName} #{seq}" },
  { label: "Weekend Kickabout — 5 Aug 2026", pattern: "{scheduleName} — {date}" },
  { label: "Monday Football at Lakeside, Whitefield", pattern: "{weekday} Football at {venueShort}, {area}" },
];

export const turfIdOf = (t: SeriesGameDefaults["turf"]): string =>
  !t ? "" : typeof t === "string" ? t : t._id;

export const turfNameOf = (t: SeriesGameDefaults["turf"]): string =>
  t && typeof t === "object" ? t.name || "" : "";

// ── REST ─────────────────────────────────────────────────────────────────────
const BASE = "/api/v1/recurring-series";

const authFetch = async (path: string, init: RequestInit = {}) => {
  const { token } = getSession();
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    // The API answers a blocked action with a code the caller may want to act on
    // (HAS_PLAYERS in particular), so carry it on the error rather than flatten
    // everything into a string.
    const err = new Error(data?.message || `HTTP ${res.status}`) as Error & { code?: string; data?: unknown };
    err.code = data?.code;
    err.data = data?.data;
    throw err;
  }
  return data;
};

export const listSeries = async (status?: SeriesStatus): Promise<RecurringSeries[]> =>
  (await authFetch(`${BASE}${status ? `?status=${status}` : ""}`)).data || [];

export const getSeries = async (id: string): Promise<RecurringSeries> =>
  (await authFetch(`${BASE}/${id}`)).data;

export const previewSchedule = async (payload: Record<string, unknown>, count = 10): Promise<SchedulePreview> =>
  (await authFetch(`${BASE}/preview?count=${count}`, { method: "POST", body: JSON.stringify(payload) })).data;

export const createSeries = async (payload: Record<string, unknown>): Promise<RecurringSeries> =>
  (await authFetch(BASE, { method: "POST", body: JSON.stringify(payload) })).data;

// `scope` decides how far the edit reaches — 'series' rewrites the schedule in
// place, 'future' splits it at `fromOccurrenceId`.
export const updateSeries = async (
  id: string,
  payload: Record<string, unknown>,
  scope: Exclude<EditScope, "occurrence">,
  fromOccurrenceId?: string
) =>
  (await authFetch(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...payload, scope, ...(fromOccurrenceId ? { fromOccurrenceId } : {}) }),
  })).data;

export const pauseSeries = async (id: string): Promise<RecurringSeries> =>
  (await authFetch(`${BASE}/${id}/pause`, { method: "POST" })).data;

export const resumeSeries = async (id: string): Promise<RecurringSeries> =>
  (await authFetch(`${BASE}/${id}/resume`, { method: "POST" })).data;

export const duplicateSeries = async (id: string): Promise<RecurringSeries> =>
  (await authFetch(`${BASE}/${id}/duplicate`, { method: "POST" })).data;

export const endSeries = async (id: string, cancelUpcoming = false) =>
  (await authFetch(`${BASE}/${id}`, { method: "DELETE", body: JSON.stringify({ cancelUpcoming }) })).data;

export const generateNow = async (id: string) =>
  (await authFetch(`${BASE}/${id}/generate`, { method: "POST" })).data;

export const listOccurrences = async (id: string, upcomingOnly = false): Promise<SeriesOccurrence[]> =>
  (await authFetch(`${BASE}/${id}/occurrences${upcomingOnly ? "?upcoming=true" : ""}`)).data || [];

export const skipOccurrence = async (occurrenceId: string, reason?: string) =>
  (await authFetch(`${BASE}/occurrences/${occurrenceId}/skip`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  })).data;

export const restoreOccurrence = async (occurrenceId: string) =>
  (await authFetch(`${BASE}/occurrences/${occurrenceId}/restore`, { method: "POST" })).data;

export const updateOccurrence = async (occurrenceId: string, payload: Record<string, unknown>) =>
  (await authFetch(`${BASE}/occurrences/${occurrenceId}`, { method: "PATCH", body: JSON.stringify(payload) })).data;

export const createGameForOccurrence = async (occurrenceId: string, force = false) =>
  (await authFetch(`${BASE}/occurrences/${occurrenceId}/create-game`, {
    method: "POST",
    body: JSON.stringify({ force }),
  })).data;

export const addExtraOccurrence = async (seriesId: string, scheduledAt: string) =>
  (await authFetch(`${BASE}/${seriesId}/occurrences`, { method: "POST", body: JSON.stringify({ scheduledAt }) })).data;
