import test from "node:test";
import assert from "node:assert/strict";
import { RENEW_AFTER_MS, needsRenewal, tokenIssuedAt } from "./sessionToken.ts";

// A JWT-shaped string with the given payload; the signature is never read here.
const tokenWith = (payload: object) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const iatAgo = (ms: number) => Math.floor((NOW - ms) / 1000);

test("tokenIssuedAt reads iat in milliseconds", () => {
  assert.equal(tokenIssuedAt(tokenWith({ id: "p1", iat: 1_700_000_000 })), 1_700_000_000_000);
});

test("tokenIssuedAt handles base64url characters and missing padding", () => {
  // A name that encodes to '-' / '_' in base64url and needs padding.
  const t = tokenWith({ id: "p1", name: "ÿÿ>>??", iat: 1_700_000_001 });
  assert.equal(tokenIssuedAt(t), 1_700_000_001_000);
});

test("tokenIssuedAt is null for garbage, a missing payload or no iat", () => {
  assert.equal(tokenIssuedAt("not-a-jwt"), null);
  assert.equal(tokenIssuedAt("a.%%%.c"), null);
  assert.equal(tokenIssuedAt(tokenWith({ id: "p1" })), null);
});

test("a token under a day old is left alone; a day or older is renewed", () => {
  assert.equal(needsRenewal(tokenWith({ iat: iatAgo(RENEW_AFTER_MS - 60_000) }), NOW), false);
  assert.equal(needsRenewal(tokenWith({ iat: iatAgo(RENEW_AFTER_MS) }), NOW), true);
  assert.equal(needsRenewal(tokenWith({ iat: iatAgo(29 * RENEW_AFTER_MS) }), NOW), true);
});

test("an unreadable token is never sent for renewal", () => {
  assert.equal(needsRenewal("garbage", NOW), false);
});
