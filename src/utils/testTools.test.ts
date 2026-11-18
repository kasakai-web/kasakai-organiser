import { test } from "node:test";
import assert from "node:assert/strict";
import { planFromNow, timelinePreview, planProblems, timesProblems, FALLBACK_SETTINGS, istTime } from "./testTools.ts";

// 14:03:40 IST
const NOW = new Date("2026-11-13T08:33:40Z");

test("planFromNow counts from the next whole minute, in IST", () => {
  const p = planFromNow({ kickoffInMins: 20, firstCheckInMins: 2, secondCheckInMins: 5 }, NOW);
  assert.equal(p.date, "2026-11-13");
  assert.equal(p.time, "14:24");
  assert.equal(p.firstCheckTime, "14:06");
  assert.equal(p.secondCheckTime, "14:09");
  assert.ok(p.first.getTime() - NOW.getTime() >= 2 * 60000);
});

test("planFromNow rolls the date over midnight", () => {
  const late = new Date("2026-11-13T18:25:00Z"); // 23:55 IST
  const p = planFromNow({ kickoffInMins: 20, firstCheckInMins: 2, secondCheckInMins: 5 }, late);
  assert.equal(p.date, "2026-11-14");
  assert.equal(p.firstCheckDate, "2026-11-13");
  assert.equal(istTime(p.kickoff), "00:15");
});

test("timelinePreview orders every step and uses the plan's waits", () => {
  const rows = timelinePreview(FALLBACK_SETTINGS, NOW);
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ["check1", "reminder", "check2", "lastCall", "report", "kickoff", "ends", "completes", "video"].filter((k) => keys.includes(k)));
  const at = Object.fromEntries(rows.map((r) => [r.key, istTime(r.at)]));
  assert.equal(at.kickoff, "14:24");
  assert.equal(at.lastCall, "14:22");
  assert.equal(at.ends, "14:29");
  assert.equal(at.completes, "14:30");
  assert.equal(at.video, "14:32");
});

test("planProblems: order errors, the same-pass warning, a last call before check-in 2", () => {
  assert.match(planProblems({ ...FALLBACK_SETTINGS, secondCheckInMins: 2 }, NOW).errors[0], /after check-in 1/);
  assert.match(planProblems({ ...FALLBACK_SETTINGS, secondCheckInMins: 25 }, NOW).errors[0], /before kick-off/);
  assert.match(planProblems({ ...FALLBACK_SETTINGS, firstCheckInMins: 4 }, NOW).warnings.join(" "), /same job pass/);
  assert.match(planProblems({ ...FALLBACK_SETTINGS, lastCallMins: 17 }, NOW).warnings.join(" "), /before check-in 2/);
  assert.deepEqual(planProblems(FALLBACK_SETTINGS, NOW), { errors: [], warnings: [] });
});

test("timesProblems: a check-in already in the past is an error", () => {
  const t = { kickoff: new Date(NOW.getTime() + 20 * 60000), first: new Date(NOW.getTime() - 60000), second: new Date(NOW.getTime() + 5 * 60000), reportingMins: 0, durationMins: 5 };
  assert.match(timesProblems(t, FALLBACK_SETTINGS, NOW).errors[0], /already in the past/);
});
