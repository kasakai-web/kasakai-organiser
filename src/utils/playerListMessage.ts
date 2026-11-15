import { formatIstTime } from "./formatTime.ts";
import { gameJoinUrl } from "./gameLink.ts";
// Builds the WhatsApp-style "Copy List" message for an organiser to share.
// Pure function (no DOM) so it can be unit-tested.

export interface PlayerListReg {
  plusOneName?: string | null;
  player?: { name?: string } | null;
}

export interface PlayerListInput {
  gameName: string;
  venue?: string;
  scheduledAt?: string;
  format?: string;
  gameId: string;
  organiserIsPlaying?: boolean;
  organiserName: string;
  activeRegs: PlayerListReg[];
}

const DIV = "━━━━━━━━━━━━━";

export function buildPlayerListMessage(input: PlayerListInput): string {
  const {
    gameName, venue, scheduledAt, format, gameId,
    organiserIsPlaying, organiserName, activeRegs,
  } = input;

  const lines: string[] = [];

  // Header
  lines.push(`*${gameName}*`);
  lines.push("");
  if (venue) lines.push(`📍 Venue: ${venue}`);
  if (scheduledAt) {
    const t = formatIstTime(scheduledAt);
    lines.push(`⏱️ Time: ${t}`);
  }
  if (format) lines.push(`⚽ Format: ${format}`);
  lines.push(DIV);
  lines.push("");

  // Confirmed players
  lines.push(`*Confirmed Players*`);
  lines.push("");
  let num = 1;
  if (organiserIsPlaying) lines.push(`${num++}. ${organiserName}`);
  activeRegs.forEach((r) => {
    lines.push(`${num++}. ${r.plusOneName || r.player?.name || "Unknown"}`);
  });

  lines.push("");
  lines.push(DIV);
  lines.push("");

  // Register CTA with the join link at the bottom
  const joinUrl = gameJoinUrl({ _id: gameId, title: gameName, scheduledAt });
  lines.push(`🚨 *To get your name added on the list, register on ${joinUrl}*`);

  return lines.join("\n");
}
