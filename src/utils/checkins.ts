// Pure helpers for the two confirmation check-ins (section 3.1).
//
// Rule: the check-ins happen on a date derived from the game's kickoff —
//   • evening game (kickoff 12pm or later) → SAME day as the game
//   • morning game (kickoff before 12pm)    → the DAY BEFORE the game
// The organiser edits only the *times*; the date is always rule-driven, so the
// two check-ins can never end up on mismatched/out-of-order dates.
//
// The default times are RELATIVE to kickoff for anything on the game day, so a
// 6pm and a 10pm game don't get the same afternoon check-ins. Night games get a
// longer run-up because their players are still at work when an evening game's
// first check would land. See defaultCheckTimes.

// Shift a YYYY-MM-DD string by `days`, IST-safe (noon anchor avoids DST/midnight edges).
export const shiftDate = (dateStr: string, days: number): string => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
};

// A game kicking off before 12:00 is a "morning" game.
export const isMorningKickoff = (time: string): boolean => {
  if (!time) return false;
  return Number(time.split(":")[0]) < 12;
};

// The calendar date the check-ins fall on (day-before for morning, same for evening).
export const checkInDate = (gameDate: string, gameTime: string): string => {
  if (!gameDate) return "";
  return isMorningKickoff(gameTime) ? shiftDate(gameDate, -1) : gameDate;
};

// A game kicking off at 8pm or later is a "night" game.
export const NIGHT_KICKOFF_HOUR = 20;

export const isNightKickoff = (time: string): boolean => {
  const h = Number((time || "").split(":")[0]);
  return !isNaN(h) && h >= NIGHT_KICKOFF_HOUR;
};

// Hours before kickoff each check-in defaults to, per slot of the day. A night
// game's players are still at work when an evening game's first check would go
// out, so it asks earlier and leaves a wider gap to chase replacements in.
const CHECK_LEAD_HOURS = {
  night:   { first: 4, second: 2 },
  evening: { first: 2, second: 1 },
};

// "HH:mm" → minutes since midnight; null if it isn't a time.
const minutesOf = (time: string): number | null => {
  const [h, m] = (time || "").split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (isNaN(hh) || isNaN(mm)) return null;
  return hh * 60 + mm;
};

// Minutes since midnight → "HH:mm", wrapping rather than going negative.
const hhmm = (mins: number): string => {
  const w = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, "0")}:${String(w % 60).padStart(2, "0")}`;
};

// Default time-of-day for each check-in.
//   • morning game (< 12pm) → fixed 8pm & 10pm the DAY BEFORE (counting back
//     from a 7am kickoff would land the checks in the middle of the night)
//   • night game (>= 8pm)   → 4h & 2h before kickoff, same day
//   • evening game          → 2h & 1h before kickoff, same day
// Kickoffs come off a quarter-hour grid and the offsets are whole hours, so the
// results always land on an option the time pickers actually offer.
export const defaultCheckTimes = (gameTime: string): { first: string; second: string } => {
  if (isMorningKickoff(gameTime)) return { first: "20:00", second: "22:00" };
  const mins = minutesOf(gameTime);
  if (mins === null) return { first: "14:00", second: "16:00" };
  const lead = isNightKickoff(gameTime) ? CHECK_LEAD_HOURS.night : CHECK_LEAD_HOURS.evening;
  return { first: hhmm(mins - lead.first * 60), second: hhmm(mins - lead.second * 60) };
};

// Combine a check-in date + time-of-day into the stored UTC instant (times are IST).
export const checkInIso = (gameDate: string, gameTime: string, checkTime: string): string | null => {
  const cd = checkInDate(gameDate, gameTime);
  if (!cd || !checkTime) return null;
  const d = new Date(`${cd}T${checkTime}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Combine an EXPLICIT check-in date (YYYY-MM-DD) + time-of-day (HH:mm) into the
// stored UTC instant. Used when the organiser picks the check-in date directly
// instead of relying on the morning/evening derivation.
export const checkInIsoFromParts = (checkDate: string, checkTime: string): string | null => {
  if (!checkDate || !checkTime) return null;
  const d = new Date(`${checkDate}T${checkTime}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Do a picked value and a stored value mean the same instant, to the minute?
//
// The date/time pickers only ever express whole minutes, while a stored instant
// can carry seconds and milliseconds (anything created through the API or a seed
// script does). Comparing them exactly would report a change every time such a
// game was opened and saved untouched — which, for the kickoff, means telling
// every registered player their game moved when it did not. Both empty counts as
// unchanged: a game with no check-ins configured stays that way.
export const sameMinute = (picked?: string | null, stored?: string | null): boolean => {
  if (!picked && !stored) return true;
  if (!picked || !stored) return false;
  const a = new Date(picked).getTime();
  const b = new Date(stored).getTime();
  if (isNaN(a) || isNaN(b)) return false;
  return Math.floor(a / 60000) === Math.floor(b / 60000);
};

// IST calendar date (YYYY-MM-DD) from a stored ISO instant — to restore a saved
// check-in date back into the date picker.
export const istYMD = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

// IST time-of-day ("HH:mm") from a stored ISO instant — to restore a saved
// check-in or kickoff time back into the time picker when editing.
//
// Returns the EXACT stored minute. This used to snap to the nearest quarter hour
// to match the picker's options, which silently rewrote any off-grid value the
// moment the form was saved — and it wrapped wrong at the top of the hour, so
// 18:53 came back as 18:00 and dragged the time 53 minutes BACKWARDS. Anything
// off-grid is offered as its own option in the picker instead (see timeOptions).
export const istHHmm = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  });
};
