import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamsMessage, shortenNames } from "./teamsMessage.ts";

const sample = {
  gameName: "Saturday Morning Game",
  scheduledAt: "2026-06-20T06:15:00+05:30",
  reportingMinsBeforeGame: 30,
  venue: "CG-Emerald hills",
  location: "Pune",
  format: "8v8",
  teamA: ["Anubhab Das", "Sarthak Rane", "Akash Kumar"],
  teamB: ["Bilal Khan", "Rohit Sharma", "Rohit Verma"],
  colours: { A: "red" as const, B: "blue" as const },
};

test("buildTeamsMessage: two-tone shirt labels", () => {
  const msg = buildTeamsMessage(sample);
  assert.ok(msg.includes("🔴 *Red/White*"));
  assert.ok(msg.includes("🔵 *Blue/Black*"));
  assert.ok(!msg.includes("Red Team"));
  assert.ok(!msg.includes("Blue Team"));
});

test("buildTeamsMessage: no player count in the heading", () => {
  assert.ok(!/players\)/.test(buildTeamsMessage(sample)));
});

test("buildTeamsMessage: names carry no position or GK detail", () => {
  const msg = buildTeamsMessage(sample);
  assert.ok(!msg.includes("GK:"));
  assert.ok(!msg.includes("MID"));
  assert.ok(!msg.includes("("));
});

test("buildTeamsMessage: unique first names are shortened, clashes keep full names", () => {
  const msg = buildTeamsMessage(sample);
  assert.ok(msg.includes("1. Anubhab"));
  assert.ok(msg.includes("2. Sarthak"));
  assert.ok(!msg.includes("Sarthak Rane"));
  // Two Rohits in the game — both stay full, on both sides of the list.
  assert.ok(msg.includes("2. Rohit Sharma"));
  assert.ok(msg.includes("3. Rohit Verma"));
});

test("buildTeamsMessage: a first-name clash across the two teams still keeps full names", () => {
  const msg = buildTeamsMessage({
    ...sample,
    teamA: ["Rohit Sharma"],
    teamB: ["Rohit Verma"],
  });
  assert.ok(msg.includes("1. Rohit Sharma"));
  assert.ok(msg.includes("1. Rohit Verma"));
});

test("buildTeamsMessage: short date plus reporting and kick-off on one line", () => {
  const msg = buildTeamsMessage(sample);
  assert.ok(msg.includes("📅 Saturday, 20 Jun"));
  assert.ok(msg.includes("⏰ Report 5:45 AM • Kick-off 6:15 AM"));
  assert.ok(!msg.includes("2026"));
});

test("buildTeamsMessage: no reporting window mentions kick-off only", () => {
  const msg = buildTeamsMessage({ ...sample, reportingMinsBeforeGame: 0 });
  assert.ok(msg.includes("⏰ Kick-off 6:15 AM"));
  assert.ok(!msg.includes("Report"));
});

test("buildTeamsMessage: red is listed first even when v2 makes team A blue", () => {
  const msg = buildTeamsMessage({ ...sample, colours: { A: "blue", B: "red" } });
  assert.ok(msg.indexOf("🔴 *Red/White*") < msg.indexOf("🔵 *Blue/Black*"));
  // Team B wears red, so its players must appear under the red heading.
  assert.ok(msg.indexOf("Bilal") < msg.indexOf("🔵 *Blue/Black*"));
  assert.ok(msg.indexOf("Anubhab") > msg.indexOf("🔵 *Blue/Black*"));
});

test("buildTeamsMessage: venue, format and sign-off survive", () => {
  const msg = buildTeamsMessage(sample);
  assert.ok(msg.includes("📍 CG-Emerald hills, Pune"));
  assert.ok(msg.includes("🎮 Format: 8v8"));
  assert.ok(msg.trimEnd().endsWith("- Team KasaKai"));
});

test("shortenNames: single-word names pass through unchanged", () => {
  const shorten = shortenNames(["Bilal", "Anubhab Das"]);
  assert.equal(shorten("Bilal"), "Bilal");
  assert.equal(shorten("Anubhab Das"), "Anubhab");
});
