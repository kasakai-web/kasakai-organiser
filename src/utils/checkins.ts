// Pure helpers for the two confirmation check-ins (section 3.1).
//
// Rule: the check-ins happen on a date derived from the game's kickoff —
//   • evening game (kickoff 12pm or later) → SAME day as the game
//   • morning game (kickoff before 12pm)    → the DAY BEFORE the game
// The organiser edits only the *times*; the date is always rule-driven, so the
// two check-ins can never end up on mismatched/out-of-order dates.

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

// Default time-of-day for each check-in, based on morning/evening.
export const defaultCheckTimes = (gameTime: string): { first: string; second: string } =>
  isMorningKickoff(gameTime)
    ? { first: "20:00", second: "22:00" }  // morning game → 8pm & 10pm the day before
    : { first: "14:00", second: "16:00" }; // evening game → 2pm & 4pm same day

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

// IST calendar date (YYYY-MM-DD) from a stored ISO instant — to restore a saved
// check-in date back into the date picker.
export const istYMD = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

// IST time-of-day ("HH:mm", quarter-hour rounded) from a stored ISO instant —
// to restore a saved check-in time back into the time picker when editing.
export const istHHmm = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hm = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const [hh, mm] = hm.split(":");
  return `${hh}:${String((Math.round(Number(mm) / 15) * 15) % 60).padStart(2, "0")}`;
};
