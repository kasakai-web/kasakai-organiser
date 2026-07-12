import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerListMessage } from "./playerListMessage.ts";

const sample = {
  gameName: "Saturday Morning Game",
  venue: "CG-Emerald hills",
  scheduledAt: "2026-06-20T06:15:00+05:30",
  format: "8v8",
  gameId: "6a345f4fcf9f2ad4d6a5c1be",
  organiserIsPlaying: false,
  organiserName: "Bilal",
  activeRegs: [
    { player: { name: "Anubhab" } },
    { plusOneName: "Anubhab +1" },
    { player: { name: "Sarthak" } },
    { plusOneName: "Akash (Titas +1)" },
  ],
};

test("buildPlayerListMessage: title is bold", () => {
  assert.ok(buildPlayerListMessage(sample).startsWith("*Saturday Morning Game*"));
});

test("buildPlayerListMessage: has emoji header lines", () => {
  const msg = buildPlayerListMessage(sample);
  assert.match(msg, /📍 Venue: CG-Emerald hills/);
  assert.match(msg, /⏱️ Time: /);
  assert.match(msg, /⚽ Format: 8v8/);
});

test("buildPlayerListMessage: has divider lines", () => {
  const msg = buildPlayerListMessage(sample);
  assert.ok(msg.includes("━━━━━━━━━━━━━"));
});

test("buildPlayerListMessage: confirmed players numbered, guests show +1 name", () => {
  const msg = buildPlayerListMessage(sample);
  assert.match(msg, /\*Confirmed Players\*/);
  assert.match(msg, /1\. Anubhab\n/);
  assert.match(msg, /2\. Anubhab \+1/);
  assert.match(msg, /3\. Sarthak/);
  assert.match(msg, /4\. Akash \(Titas \+1\)/);
});

test("buildPlayerListMessage: organiser included first when playing", () => {
  const msg = buildPlayerListMessage({ ...sample, organiserIsPlaying: true });
  assert.match(msg, /1\. Bilal\n/);
  assert.match(msg, /2\. Anubhab\n/);
});

test("buildPlayerListMessage: register link at the BOTTOM with www domain", () => {
  const msg = buildPlayerListMessage(sample);
  const lines = msg.split("\n");
  const last = lines[lines.length - 1];
  assert.match(last, /^🚨 \*To get your name added on the list, register on https:\/\/www\.kasakai\.in\/join\//);
  // bottom line contains the game id
  assert.ok(last.includes("6a345f4fcf9f2ad4d6a5c1be"));
});

test("buildPlayerListMessage: readable slug includes game name + date", () => {
  const msg = buildPlayerListMessage(sample);
  assert.match(msg, /join\/saturday-morning-game-20-jun-2026-6a345f4fcf9f2ad4d6a5c1be/);
});

test("buildPlayerListMessage: missing player name falls back to Unknown", () => {
  const msg = buildPlayerListMessage({ ...sample, activeRegs: [{}] });
  assert.match(msg, /1\. Unknown/);
});
