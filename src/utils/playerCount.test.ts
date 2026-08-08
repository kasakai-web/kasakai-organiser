import test from "node:test";
import assert from "node:assert/strict";
import { activeRegCount, filledCount, spotsLeft } from "./playerCount.ts";

const reg = (over: Partial<{ paymentStatus: string; optedOut: boolean; plusOneName: string; backedOutAt: string; removedAt: string }> = {}) => ({
  paymentStatus: "paid",
  optedOut: false,
  ...over,
});

test("counts primary players AND their +1 guests", () => {
  const game = { registrations: [reg(), reg({ plusOneName: "Guest A" }), reg()] , organiserIsPlaying: false };
  assert.equal(activeRegCount(game), 3);
  assert.equal(filledCount(game), 3);
});

test("includes the organiser's own slot when playing", () => {
  const game = { registrations: [reg(), reg()], organiserIsPlaying: true };
  assert.equal(activeRegCount(game), 2);
  assert.equal(filledCount(game), 3, "2 players + organiser");
});

test("excludes opted-out players", () => {
  const game = { registrations: [reg(), reg({ optedOut: true }), reg()], organiserIsPlaying: false };
  assert.equal(filledCount(game), 2, "opted-out player not counted");
});

test("excludes backed-out and organiser-removed rows, which the API still sends as history", () => {
  const game = {
    registrations: [
      reg(),
      reg({ backedOutAt: "2026-08-01T10:00:00.000Z", paymentStatus: "refunded" }),
      reg({ backedOutAt: "2026-08-01T10:00:00.000Z", paymentStatus: "refunded", plusOneName: "Their guest" }),
      reg({ removedAt: "2026-08-02T10:00:00.000Z", paymentStatus: "refunded" }),
    ],
    organiserIsPlaying: false,
  };
  assert.equal(filledCount(game), 1, "a cancelled or revoked booking frees its seat and its guests'");
});

test("excludes refunded / forfeited registrations", () => {
  const game = { registrations: [reg(), reg({ paymentStatus: "refunded" }), reg({ paymentStatus: "forfeited" })], organiserIsPlaying: false };
  assert.equal(filledCount(game), 1);
});

test("a guest of an opted-out player still counts (their paid slot remains)", () => {
  const game = {
    registrations: [reg({ optedOut: true }), reg({ plusOneName: "Guest of opted-out" })],
    organiserIsPlaying: false,
  };
  assert.equal(filledCount(game), 1, "guest remains; opted-out owner does not");
});

test("full mix: players + guests + organiser, opted-out/refunded excluded", () => {
  const game = {
    registrations: [
      reg(),                                 // player ✓
      reg({ plusOneName: "P guest" }),       // player's guest ✓
      reg({ plusOneName: "Org guest" }),     // organiser's guest ✓
      reg({ optedOut: true }),               // ✗
      reg({ paymentStatus: "refunded" }),    // ✗
    ],
    organiserIsPlaying: true,                // organiser ✓
  };
  assert.equal(filledCount(game), 4, "3 active regs + organiser");
  assert.equal(spotsLeft(game, 10), 6);
});

test("spotsLeft never goes negative (over capacity)", () => {
  const game = { registrations: [reg(), reg(), reg()], organiserIsPlaying: true };
  assert.equal(spotsLeft(game, 2), 0);
});

test("empty / missing registrations", () => {
  assert.equal(filledCount({ organiserIsPlaying: false }), 0);
  assert.equal(filledCount({ registrations: [], organiserIsPlaying: true }), 1);
});
