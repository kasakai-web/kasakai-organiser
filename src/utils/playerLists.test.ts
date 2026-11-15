import test from "node:test";
import assert from "node:assert/strict";
import {
  addFromList, chipCounts, describeRule, filterBook, keyCounts, lastPlayedLabel, listsUsed, matchesFilter,
  removeList, searchMatches, suggestEmoji, usageLabel, type BookRow,
} from "./playerLists.ts";

const row = (over: Partial<BookRow> = {}): BookRow => ({
  id: "p1", name: "Rahul Sharma", img: null, phone: "•••• 1234", games: 5, lastAt: null, firstAt: null,
  upcoming: 0, venues: ["v1"], auto: ["played", "regular"], tags: ["GK"], rating: null, ...over,
});

test("filter: tag keys are ALL-of, the same as a smart list's rule", () => {
  assert.ok(matchesFilter(row(), { keys: ["a:regular", "t:gk"] }));
  assert.ok(!matchesFilter(row(), { keys: ["a:regular", "a:top"] }));
});

test("filter: venues are ANY-of", () => {
  assert.ok(matchesFilter(row(), { venues: ["v9", "v1"] }));
  assert.ok(!matchesFilter(row(), { venues: ["v9"] }));
});

test("filter: nothing selected shows everyone (unlike a saved rule)", () => {
  assert.ok(matchesFilter(row(), {}));
});

test("search: every typed word must appear in the name; digits match the number's end", () => {
  assert.ok(searchMatches(row(), "rah sha"));
  assert.ok(!searchMatches(row(), "rahul verma"));
  assert.ok(searchMatches(row(), "1234"));
  assert.ok(!searchMatches(row(), "9999"));
  assert.ok(searchMatches({ name: "José" }, "jose"), "accents fold away");
});

test("chip counts are counted over the rows on screen", () => {
  const rows = [row(), row({ id: "p2", auto: ["played"], tags: [], venues: ["v2"] })];
  const c = keyCounts(filterBook(rows, {}));
  assert.equal(c.get("a:played"), 2);
  assert.equal(c.get("a:regular"), 1);
  assert.equal(c.get("t:gk"), 1);
  assert.equal(c.get("v:v2"), 1);
});

test("chip counts: a venue chip counts what tapping it would ADD (venues are OR), tags narrow", () => {
  const rows = [
    row({ id: "a", auto: ["played", "regular"], tags: [], venues: ["v1"] }),
    row({ id: "b", auto: ["played", "regular"], tags: [], venues: ["v2"] }),
    row({ id: "c", auto: ["played"], tags: [], venues: ["v2"] }),
  ];
  const c = chipCounts(rows, { keys: ["a:regular"], venues: ["v1"] });
  assert.equal(c.get("v:v2"), 1, "nobody on screen played at v2, but tapping it brings in b");
  assert.equal(c.get("v:v1"), 1);
  assert.equal(c.get("a:regular"), 1, "tags still count the rows on screen");
  assert.equal(chipCounts(rows, {}).get("v:v2"), 2);
});

type R = { id: string; lists?: string[]; manual?: boolean };
const same = (a: R, b: R) => a.id === b.id;

test("lists in the SOS modal: un-ticking takes back only what that list added", () => {
  let picked: R[] = [{ id: "a", manual: true }];
  picked = addFromList(picked, "L1", [{ id: "a" }, { id: "b" }, { id: "c" }], same).next;
  picked = addFromList(picked, "L2", [{ id: "c" }, { id: "d" }], same).next;
  assert.deepEqual(listsUsed(picked).sort(), ["L1", "L2"]);

  picked = removeList(picked, "L1");
  assert.deepEqual(picked.map((r) => r.id), ["a", "c", "d"], "a was picked by hand, c is still on L2");
  picked = removeList(picked, "L2");
  assert.deepEqual(picked.map((r) => r.id), ["a"]);
});

test("lists in the SOS modal: the added count ignores people already picked", () => {
  const r = addFromList<R>([{ id: "a", manual: true }], "L1", [{ id: "a" }, { id: "b" }], same);
  assert.equal(r.added, 1);
});

test("a new list's emoji follows its name", () => {
  assert.equal(suggestEmoji("Keepers"), "🧤");
  assert.equal(suggestEmoji("Office team"), "💼");
  assert.equal(suggestEmoji("Sunday morning"), "🌅");
  assert.equal(suggestEmoji("Random"), "👥");
});

test("a rule reads as a sentence", () => {
  const text = describeRule({ tags: ["a:regular", "t:gk"], venues: ["v1"] }, {
    autoTags: [{ key: "a:regular", label: "Regular", emoji: "🔥", hint: "", count: 0 }],
    tags: [{ key: "t:gk", label: "GK", count: 3 }],
    venues: [{ id: "v1", name: "Kickoff Arena", count: 9 }],
  });
  assert.equal(text, "🔥 Regular + #GK · played at Kickoff Arena");
});

test("last played and usage labels", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assert.equal(lastPlayedLabel("2026-11-11T08:00:00Z", now), "played today");
  assert.equal(lastPlayedLabel("2026-11-01T08:00:00Z", now), "played 10d ago");
  assert.equal(lastPlayedLabel(null, now), "");
  assert.equal(usageLabel({ sosCount: 0, inviteCount: 0, lastUsedAt: null, lastUsedFor: null }, now), "Not used yet");
  assert.equal(usageLabel({ sosCount: 2, inviteCount: 1, lastUsedAt: "2026-11-10T12:00:00Z", lastUsedFor: "sos" }, now), "Used 3× · last SOS yesterday");
});
