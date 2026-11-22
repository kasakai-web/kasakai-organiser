import test from "node:test";
import assert from "node:assert/strict";
import {
  activityOf, departuresOf, formatLeadTime, groupByIstDay, summariseDepartures, timeAgo, whoIs,
} from "./rosterHistory.ts";

// A fixed kick-off is safe here: these are pure functions handed every instant
// they compare, so the runner's clock never enters.
const KICKOFF = "2026-06-20T19:00:00+05:30";
const at = (hoursBefore: number) => new Date(new Date(KICKOFF).getTime() - hoursBefore * 3_600_000).toISOString();

const amit = { _id: "p_amit", name: "Amit" };
const ravi = { _id: "p_ravi", name: "Ravi" };
const sana = { _id: "p_sana", name: "Sana" };

const regs = [
  { _id: "r1", player: amit, signedUpAt: at(72), amountPaidPaise: 20000, paymentStatus: "paid" },
  { _id: "r2", player: amit, plusOneName: "Amit +1", guestOf: amit, signedUpAt: at(72), amountPaidPaise: 20000, paymentStatus: "paid" },
  {
    _id: "r3", player: ravi, signedUpAt: at(48), amountPaidPaise: 20000, paymentStatus: "refunded",
    backedOutAt: at(3), backoutType: "post_cutoff" as const, backoutFeeChargedPaise: 5000,
  },
  {
    _id: "r4", player: sana, signedUpAt: at(30), amountPaidPaise: 20000, paymentStatus: "refunded",
    removedAt: at(10), removedBy: "org_priya",
  },
  { _id: "r5", player: ravi, signedUpAt: at(1), amountPaidPaise: 20000, paymentStatus: "paid" }, // Ravi came back
  {
    _id: "r6", player: sana, plusOneName: "Sana +1", guestOf: sana, signedUpAt: at(30),
    paymentStatus: "refunded", backedOutAt: at(40), backoutWaivedReason: "grace",
  },
];

const ctx = { scheduledAt: KICKOFF, viewerId: "org_me", organiserNames: new Map([["org_priya", "Priya"]]) };

test("whoIs: player, player's guest, organiser guest", () => {
  assert.deepEqual(whoIs(regs[0]), { name: "Amit", isGuest: false, broughtBy: null });
  assert.deepEqual(whoIs(regs[1]), { name: "Amit +1", isGuest: true, broughtBy: "Amit" });
  assert.deepEqual(whoIs({ plusOneName: "Filler", addedByOrganiser: true }), { name: "Filler", isGuest: true, broughtBy: null });
});

test("departuresOf: tombstones only, newest first", () => {
  const d = departuresOf(regs, ctx);
  assert.deepEqual(d.map((x) => x.key), ["r3", "r4", "r6"]);
});

test("departuresOf: backout carries lead time, cutoff side, fee", () => {
  const ravi = departuresOf(regs, ctx).find((x) => x.key === "r3")!;
  assert.equal(ravi.kind, "backed_out");
  assert.equal(ravi.minsBeforeKickoff, 180);
  assert.equal(ravi.afterCutoff, true);
  assert.equal(ravi.feeChargedPaise, 5000);
  assert.equal(ravi.rejoined, true, "Ravi holds a live seat again (r5)");
});

test("departuresOf: removal names the co-organiser, or 'you'", () => {
  assert.equal(departuresOf(regs, ctx).find((x) => x.key === "r4")!.removedBy, "Priya");
  const mine = departuresOf([{ ...regs[3], removedBy: { _id: "org_me" } }], ctx)[0];
  assert.equal(mine.removedBy, "you");
  const unknown = departuresOf([{ ...regs[3], removedBy: "org_zzz" }], ctx)[0];
  assert.equal(unknown.removedBy, null);
});

test("departuresOf: removal wins over an older backout stamp", () => {
  const d = departuresOf([{ player: amit, backedOutAt: at(20), removedAt: at(5) }], ctx)[0];
  assert.equal(d.kind, "removed");
  assert.equal(d.minsBeforeKickoff, 300);
});

test("departuresOf: skip vs format change, and the guests a skipper leaves playing", () => {
  const rows = [
    { _id: "s", player: amit, optedOut: true, optedOutReason: "self" as const, optedOutAt: at(5), paymentStatus: "paid" },
    { _id: "g", player: amit, plusOneName: "Amit +1", guestOf: amit, paymentStatus: "paid" },
    { _id: "f", player: ravi, optedOut: true, optedOutReason: "format_change" as const, optedOutAt: at(6), paymentStatus: "refunded" },
  ];
  const d = departuresOf(rows, ctx);
  assert.equal(d.find((x) => x.key === "s")!.kind, "skipped");
  assert.equal(d.find((x) => x.key === "s")!.guestsStaying, 1);
  assert.equal(d.find((x) => x.key === "s")!.rejoined, false);
  assert.equal(d.find((x) => x.key === "f")!.kind, "format_change");
});

test("departuresOf: no kick-off → lead time unknown, not zero", () => {
  assert.equal(departuresOf([regs[2]], {})[0].minsBeforeKickoff, null);
});

test("summariseDepartures: counts, late = player's own exits inside 24h, fees kept", () => {
  const s = summariseDepartures(departuresOf(regs, ctx));
  assert.equal(s.total, 3);
  assert.equal(s.backedOut, 2);
  assert.equal(s.removed, 1);
  // Ravi left 3h out (late). Sana +1 left 40h out (not late). Sana was REMOVED
  // 10h out — the organiser's act, never counted against the player.
  assert.equal(s.late, 1);
  assert.equal(s.feesKeptPaise, 5000);
});

test("summariseDepartures: a fee handed back is not a fee kept", () => {
  const d = departuresOf([{ ...regs[2], backoutFeeRefundedAt: at(1) }], ctx);
  assert.equal(summariseDepartures(d).feesKeptPaise, 0);
});

test("formatLeadTime", () => {
  assert.equal(formatLeadTime(null), null);
  assert.equal(formatLeadTime(-5), "after kick-off");
  assert.equal(formatLeadTime(45), "45m before kick-off");
  assert.equal(formatLeadTime(120), "2h before kick-off");
  assert.equal(formatLeadTime(320), "5h 20m before kick-off");
  assert.equal(formatLeadTime(3 * 24 * 60 + 10), "3 days before kick-off");
});

test("activityOf: joins, departures and waitlist moves, newest first", () => {
  const events = activityOf({
    registrations: regs,
    waitlist: [{ _id: "w1", player: { name: "Kiran" }, joinedAt: at(2), notifiedAt: at(0.5), status: "notified" }],
    guestWaitlist: [{ _id: "gw", player: { name: "Amit" }, plusOneName: "Amit +2", requestedAt: at(4) }],
  }, ctx);
  const times = events.map((e) => new Date(e.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const kinds = events.map((e) => `${e.kind}:${e.name}`);
  assert.ok(kinds.includes("joined:Ravi"));
  assert.ok(kinds.includes("backed_out:Ravi"));
  assert.ok(kinds.includes("removed:Sana"));
  assert.ok(kinds.includes("guest_added:Amit +1"));
  assert.ok(kinds.includes("waitlist_joined:Kiran"));
  assert.ok(kinds.includes("waitlist_offered:Kiran"));
  assert.ok(kinds.includes("guest_waitlisted:Amit +2"));
  assert.equal(events.find((e) => e.kind === "removed")!.detail, "by Priya");
  assert.equal(events.find((e) => e.kind === "backed_out")!.detail, "3h before kick-off");
});

test("activityOf: rows with no timestamp are left out rather than dated 1970", () => {
  const events = activityOf({ registrations: [{ player: amit }] });
  assert.equal(events.length, 0);
});

test("groupByIstDay: labels by the IST calendar day", () => {
  const now = new Date("2026-06-20T10:00:00+05:30");
  const groups = groupByIstDay([
    { key: "a", kind: "joined", at: "2026-06-20T00:10:00+05:30", name: "A", detail: null },
    { key: "b", kind: "joined", at: "2026-06-19T23:50:00+05:30", name: "B", detail: null },
    { key: "c", kind: "joined", at: "2026-06-15T09:00:00+05:30", name: "C", detail: null },
  ], now);
  assert.deepEqual(groups.map((g) => g.label.startsWith("Mon") || g.label), ["Today", "Yesterday", true]);
});

test("timeAgo", () => {
  const now = new Date("2026-06-20T10:00:00Z");
  assert.equal(timeAgo(null, now), null);
  assert.equal(timeAgo("2026-06-20T09:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-06-20T09:15:00Z", now), "45m ago");
  assert.equal(timeAgo("2026-06-20T03:00:00Z", now), "7h ago");
  assert.equal(timeAgo("2026-06-17T10:00:00Z", now), "3d ago");
});
