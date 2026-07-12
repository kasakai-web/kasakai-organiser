import test from "node:test";
import assert from "node:assert/strict";
import { shiftDate, isMorningKickoff, checkInDate, defaultCheckTimes, checkInIso, checkInIsoFromParts, istYMD } from "./checkins.ts";

test("isMorningKickoff: before noon is morning, noon onward is evening", () => {
  assert.equal(isMorningKickoff("06:15"), true);
  assert.equal(isMorningKickoff("11:59"), true);
  assert.equal(isMorningKickoff("12:00"), false);
  assert.equal(isMorningKickoff("18:00"), false);
  assert.equal(isMorningKickoff(""), false);
});

test("shiftDate: IST-safe day shift", () => {
  assert.equal(shiftDate("2026-06-27", -1), "2026-06-26");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDate("", -1), "");
});

test("checkInDate: EVENING game → check-ins on the SAME day", () => {
  assert.equal(checkInDate("2026-06-27", "18:00"), "2026-06-27");
  assert.equal(checkInDate("2026-06-27", "12:00"), "2026-06-27");
});

test("checkInDate: MORNING game → check-ins the DAY BEFORE", () => {
  assert.equal(checkInDate("2026-06-27", "08:00"), "2026-06-26");
  assert.equal(checkInDate("2026-06-27", "06:15"), "2026-06-26");
});

test("defaultCheckTimes: 2pm/4pm for evening, 8pm/10pm for morning", () => {
  assert.deepEqual(defaultCheckTimes("18:00"), { first: "14:00", second: "16:00" });
  assert.deepEqual(defaultCheckTimes("08:00"), { first: "20:00", second: "22:00" });
});

test("both check-ins land on the same date (never mismatched/out of order)", () => {
  // morning game
  const mFirst  = checkInIso("2026-06-27", "08:00", "20:00")!;
  const mSecond = checkInIso("2026-06-27", "08:00", "22:00")!;
  assert.equal(mFirst.slice(0, 10), mSecond.slice(0, 10), "same calendar date");
  assert.ok(new Date(mFirst) < new Date(mSecond), "first before second");

  // evening game
  const eFirst  = checkInIso("2026-06-27", "18:00", "14:00")!;
  const eSecond = checkInIso("2026-06-27", "18:00", "16:00")!;
  assert.equal(eFirst.slice(0, 10), eSecond.slice(0, 10));
  assert.ok(new Date(eFirst) < new Date(eSecond));
});

test("checkInIso: morning check-ins resolve to the day-before in IST", () => {
  const iso = checkInIso("2026-06-27", "08:00", "20:00")!; // 8pm IST on 26 Jun
  // 2026-06-26 20:00 +05:30 == 2026-06-26 14:30 UTC
  assert.equal(iso, "2026-06-26T14:30:00.000Z");
});

test("checkInIso: returns null when inputs are incomplete", () => {
  assert.equal(checkInIso("", "08:00", "20:00"), null);
  assert.equal(checkInIso("2026-06-27", "08:00", ""), null);
});

test("checkInIsoFromParts: builds the UTC instant from an EXPLICIT date + time (IST)", () => {
  // 25 Jun 2026 20:00 IST == 14:30 UTC — date is taken as-is, not derived.
  assert.equal(checkInIsoFromParts("2026-06-25", "20:00"), "2026-06-25T14:30:00.000Z");
  // Lets the organiser put a check-in days before the game (e.g. game on 1 Jul,
  // first check-in on 25 Jun) — no day-before derivation involved.
  const early = checkInIsoFromParts("2026-06-25", "10:00")!;
  assert.equal(early.slice(0, 10), "2026-06-25");
});

test("checkInIsoFromParts: null when date or time is missing", () => {
  assert.equal(checkInIsoFromParts("", "20:00"), null);
  assert.equal(checkInIsoFromParts("2026-06-25", ""), null);
});

test("istYMD: recovers the IST calendar date from a stored ISO instant", () => {
  // 14:30 UTC on 25 Jun == 20:00 IST on 25 Jun → 2026-06-25
  assert.equal(istYMD("2026-06-25T14:30:00.000Z"), "2026-06-25");
  // 22:00 UTC on 25 Jun == 03:30 IST on 26 Jun → 2026-06-26 (date rolls forward in IST)
  assert.equal(istYMD("2026-06-25T22:00:00.000Z"), "2026-06-26");
  assert.equal(istYMD(null), "");
});
