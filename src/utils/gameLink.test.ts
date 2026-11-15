import test from "node:test";
import assert from "node:assert/strict";
import { gameJoinSlug, gameJoinUrl, inviteLinkUrl, shareLinkFor } from "./gameLink.ts";

const id = "6a345f4fcf9f2ad4d6a5c1be";
const base = { _id: id, title: "Saturday Morning Game", scheduledAt: "2026-06-20T06:15:00+05:30" };

test("gameJoinSlug: readable title + IST date", () => {
  assert.equal(gameJoinSlug(base.title, base.scheduledAt), "saturday-morning-game-20-jun-2026");
});

test("gameJoinSlug: the date is the IST day, not the UTC one", () => {
  // 00:30 IST on the 21st is still the 20th in UTC.
  assert.equal(gameJoinSlug("Night", "2026-06-21T00:30:00+05:30"), "night-21-jun-2026");
});

test("gameJoinUrl: ends in the game id, which is all the player app reads", () => {
  const url = gameJoinUrl(base);
  assert.equal(url, `https://www.kasakai.in/join/saturday-morning-game-20-jun-2026-${id}`);
  // The player app's /join route: last 24-hex run in the segment.
  assert.equal(url.match(/[0-9a-f]{24}/gi)?.pop(), id);
});

test("gameJoinUrl: punctuation-only title still yields a working link", () => {
  assert.equal(gameJoinUrl({ _id: id, title: "!!!" }), `https://www.kasakai.in/join/${id}`);
});

test("shareLinkFor: public game shares its game page", () => {
  assert.deepEqual(shareLinkFor({ ...base, status: "open", visibility: "public" }), {
    url: gameJoinUrl(base), kind: "public",
  });
});

test("shareLinkFor: missing visibility reads as public", () => {
  const r = shareLinkFor({ ...base, status: "open" });
  assert.equal(r.url, gameJoinUrl(base));
});

test("shareLinkFor: closed games share nothing", () => {
  for (const status of ["cancelled", "completed"]) {
    const r = shareLinkFor({ ...base, status });
    assert.equal(r.url, null);
    assert.equal(r.url === null && r.fixable, false);
  }
});

test("shareLinkFor: private game shares its invite link, never the game page", () => {
  const r = shareLinkFor({ ...base, status: "open", visibility: "private", inviteLinkToken: "inv_abc" });
  assert.deepEqual(r, { url: inviteLinkUrl("inv_abc"), kind: "invite" });
});

test("shareLinkFor: private game with no / disabled / used-up link says why", () => {
  const priv = { ...base, status: "open", visibility: "private" };
  for (const g of [
    priv,
    { ...priv, inviteLinkToken: "inv_abc", inviteLinkEnabled: false },
    {
      ...priv, inviteLinkToken: "inv_abc", inviteLinkMaxJoins: 2,
      invitations: [
        { via: "invite_link", status: "accepted" },
        { via: "invite_link", status: "pending" },
      ],
    },
  ]) {
    const r = shareLinkFor(g);
    assert.equal(r.url, null);
    assert.equal(r.url === null && r.fixable, true);
  }
});

test("shareLinkFor: rejected link joins give the slot back", () => {
  const r = shareLinkFor({
    ...base, status: "open", visibility: "private", inviteLinkToken: "inv_abc", inviteLinkMaxJoins: 1,
    invitations: [{ via: "invite_link", status: "rejected" }, { via: "organiser", status: "accepted" }],
  });
  assert.equal(r.url, inviteLinkUrl("inv_abc"));
});
