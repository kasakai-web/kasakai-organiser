// Shared client helpers for organiser game templates: types, the REST calls, the
// interval-scheduling math (today / tomorrow / day-after → a real kickoff), and
// the mapping that lets a template prefill the existing CreateEventForm.

import { buildApiUrl, getSession } from "@/utils/api";
import { shiftDate } from "@/utils/checkins";

export type Format = "5v5" | "6v6" | "7v7" | "8v8" | "9v9" | "10v10";

export interface TemplateAltFormat {
  format?: Format;
  turf?: { _id: string } | string | null;
  minPlayers?: number;
  maxPlayers?: number;
  feeInPaise?: number;
}

export interface TemplateRecurrence {
  enabled: boolean;
  weekdays: number[]; // 0=Sun … 6=Sat (IST)
  leadDays: number;
  paused: boolean;
  lastRunAt?: string | null;
}

export interface Template {
  _id: string;
  name: string;
  title?: string | null;
  visibility?: "public" | "private";
  requiresApproval?: boolean;
  turf?: { _id: string; name?: string; location?: { city?: string } } | string | null;
  format?: Format;
  defaultTimeOfDay?: string; // "HH:mm"
  durationMins?: number;
  reportingMinsBeforeGame?: number;
  cutoffHoursBeforeGame?: number;
  feeInPaise?: number;
  backoutFeeInPaise?: number;
  minPlayers?: number;
  totalSlots?: number;
  allowSizeChange?: boolean;
  organiserIsPlaying?: boolean;
  alternateFormats?: TemplateAltFormat[];
  automationEnabled?: boolean;
  firstCheckTime?: string | null;
  secondCheckTime?: string | null;
  recurrence?: TemplateRecurrence;
  usage?: { useCount?: number; lastUsedAt?: string | null };
  createdAt?: string;
}

// ── Interval scheduling ──────────────────────────────────────────────────────
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Today's IST calendar date as YYYY-MM-DD.
export const todayIST = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// YYYY-MM-DD for an offset in days from today (0 = today, 1 = tomorrow, …), IST-safe.
export const dayOffsetToDate = (offset: number): string => shiftDate(todayIST(), offset);

// A date (YYYY-MM-DD) + time-of-day (HH:mm) → the UTC ISO instant it means (IST).
export const scheduledAtISO = (dateYMD: string, timeHHmm: string): string | null => {
  if (!dateYMD || !timeHHmm) return null;
  const d = new Date(`${dateYMD}T${timeHHmm}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Human label for a chosen day offset.
export const dayOffsetLabel = (offset: number): string =>
  offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === 2 ? "Day after" : "";

// Pretty "Fri, 1 Aug" for a YYYY-MM-DD.
export const prettyDay = (dateYMD: string): string => {
  if (!dateYMD) return "";
  const d = new Date(`${dateYMD}T12:00:00+05:30`);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
};

// "6:00 PM" for an "HH:mm" time-of-day.
export const prettyTime = (hhmm?: string): string => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return "";
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${period}`;
};

// ── REST calls ───────────────────────────────────────────────────────────────
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
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return data;
};

export const listTemplates = async (): Promise<Template[]> => {
  const data = await authFetch("/api/v1/organisers/me/templates");
  return data.data || [];
};

export const saveTemplate = async (payload: Record<string, unknown>): Promise<Template> => {
  const data = await authFetch("/api/v1/organisers/me/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.data;
};

export const updateTemplate = async (id: string, payload: Record<string, unknown>): Promise<Template> => {
  const data = await authFetch(`/api/v1/organisers/me/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.data;
};

export const deleteTemplate = async (id: string): Promise<void> => {
  await authFetch(`/api/v1/organisers/me/templates/${id}`, { method: "DELETE" });
};

// Instant-create a real game from a template at a computed kickoff instant.
export const createGameFromTemplate = async (templateId: string, scheduledAt: string) => {
  const data = await authFetch("/api/v1/games/organisers/from-template", {
    method: "POST",
    body: JSON.stringify({ templateId, scheduledAt }),
  });
  return data.data;
};

// ── Prefill bridge ───────────────────────────────────────────────────────────
// Shape a template (+ chosen day) into the object CreateEventForm already reads
// from its `lastEvent` prop, so the "Customize" path reuses the whole form. The
// synthetic `scheduledAt` seeds the form's time picker; `presetDate` (returned
// separately) seeds the date field.
export const templateToLastEventShape = (t: Template, dateYMD: string) => {
  const scheduledAt = scheduledAtISO(dateYMD, t.defaultTimeOfDay || "18:00") || new Date().toISOString();
  return {
    title: t.title || t.name,
    visibility: t.visibility || "public",
    requiresApproval: !!t.requiresApproval,
    turf: t.turf ?? "",
    scheduledAt,
    format: t.format || "6v6",
    durationMins: t.durationMins ?? 60,
    feeInPaise: t.feeInPaise ?? 0,
    backoutFeeInPaise: t.backoutFeeInPaise ?? 0,
    cutoffHoursBeforeGame: t.cutoffHoursBeforeGame ?? 2,
    reportingMinsBeforeGame: t.reportingMinsBeforeGame ?? 30,
    minPlayers: t.minPlayers || 0,
    totalSlots: t.totalSlots || 0,
    allowSizeChange: !!t.allowSizeChange,
    organiserIsPlaying: !!t.organiserIsPlaying,
    alternateFormats: t.allowSizeChange ? (t.alternateFormats || []) : [],
    lifecycle: { automationEnabled: !!t.automationEnabled },
    organiserGuests: [],
  };
};
