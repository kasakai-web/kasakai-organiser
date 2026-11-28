import test from "node:test";
import assert from "node:assert/strict";
import { gameJoinUrl, inviteLinkUrl, shareLinkFor } from "./gameLink.ts";

const id = "6a345f4fcf9f2ad4d6a5c1be";
const base = { _id: id, title: "Saturday Morning Game", scheduledAt: "2026-06-20T06:15:00+05:30" };

test("gameJoinUrl: the bare-id link, the same one the player app copies", () => {
  assert.equal(gameJoinUrl(base), `https://www.kasakai.in/join/${id}`);
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
