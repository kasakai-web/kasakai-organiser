import test from "node:test";
import assert from "node:assert/strict";
import { mergePlanned } from "./mergePlanned.ts";

const day = (d: number, hour = 20) => new Date(Date.UTC(2026, 2, d, hour - 5, 30)).toISOString();
const live = (id: string, d: number, extra: { feeInPaise?: number; filledSeats?: number } = {}) =>
  ({ id, scheduledAt: day(d), feeInPaise: 20000, filledSeats: 5, ...extra });
const plan = (id: string, d: number, fee = 20000) => ({ id, scheduledAt: day(d), feeInPaise: fee });

const ids = (items: ReturnType<typeof mergePlanned>) =>
  items.map((i) => (i.kind === "live" ? `L:${(i.game as { id: string }).id}` : `P:${(i.planned as { id: string }).id}`));

test("date-asc: planned games slot in between live ones by date", () => {
  const out = mergePlanned([live("mon", 2), live("wed", 4), live("fri", 6)], [plan("tue", 3), plan("sat", 7)], { sort: "date-asc", hasMore: false });
  assert.deepEqual(ids(out), ["L:mon", "P:tue", "L:wed", "L:fri", "P:sat"]);
});

test("date-desc: newest first, planned included", () => {
  const out = mergePlanned([live("fri", 6), live("wed", 4)], [plan("tue", 3), plan("sat", 7)], { sort: "date-desc", hasMore: false });
  assert.deepEqual(ids(out), ["P:sat", "L:fri", "L:wed", "P:tue"]);
});

test("while more pages exist, planned games past the last loaded live game wait", () => {
  const out = mergePlanned([live("mon", 2), live("wed", 4)], [plan("tue", 3), plan("sat", 7)], { sort: "date-asc", hasMore: true });
  assert.deepEqual(ids(out), ["L:mon", "P:tue", "L:wed"]);
});

test("nothing loaded yet but more to come: no planned game is placed", () => {
  assert.deepEqual(mergePlanned([], [plan("tue", 3)], { sort: "date-asc", hasMore: true }), []);
});

test("no live games at all: the planned games are the list", () => {
  const out = mergePlanned([], [plan("sat", 7), plan("tue", 3)], { sort: "date-asc", hasMore: false });
  assert.deepEqual(ids(out), ["P:tue", "P:sat"]);
});

test("a tie puts the live game first", () => {
  const out = mergePlanned([live("a", 3)], [plan("b", 3)], { sort: "date-asc", hasMore: false });
  assert.deepEqual(ids(out), ["L:a", "P:b"]);
});

test("fee-asc interleaves by fee, latest date first on a tie (the server's tie-break)", () => {
  const out = mergePlanned(
    [live("cheap", 2, { feeInPaise: 10000 }), live("dear", 4, { feeInPaise: 30000 })],
    [plan("mid", 3, 20000), plan("cheapLater", 9, 10000)],
    { sort: "fee-asc", hasMore: false },
  );
  assert.deepEqual(ids(out), ["P:cheapLater", "L:cheap", "P:mid", "L:dear"]);
});

test("players-desc: planned games have nobody yet, so they come after games with players", () => {
  const out = mergePlanned(
    [live("full", 2, { filledSeats: 12 }), live("some", 4, { filledSeats: 3 })],
    [plan("p", 3)],
    { sort: "players-desc", hasMore: false },
  );
  assert.deepEqual(ids(out), ["L:full", "L:some", "P:p"]);
});

test("an unknown sort falls back to date order", () => {
  const out = mergePlanned([live("wed", 4)], [plan("tue", 3)], { sort: "weird", hasMore: false });
  assert.deepEqual(ids(out), ["P:tue", "L:wed"]);
});
