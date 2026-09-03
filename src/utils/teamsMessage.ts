import { formatIstShortDate, formatIstTime, KASAKAI_SIGNOFF } from "./formatTime.ts";

// Builds the WhatsApp-style "Copy Teams" message an organiser pastes into the
// group chat after distribution. Pure function (no DOM) so it can be unit-tested.

export interface TeamsMessageInput {
  gameName: string;
  scheduledAt?: string;
  /** Minutes before kick-off players must be at the turf. 0/undefined = don't mention it. */
  reportingMinsBeforeGame?: number;
  venue?: string;
  location?: string;
  format?: string;
  teamA?: string[];
  teamB?: string[];
  /** v2 names the sides AFTER balancing, so team A is not always red. */
  colours?: { A: "red" | "blue"; B: "red" | "blue" };
}

const DIV = "─".repeat(28);

/** The shirts are two-tone, and players are told the pair, not just the base colour. */
const TEAM_LABEL = { red: "🔴 *Red/White*", blue: "🔵 *Blue/Black*" } as const;

const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] || name.trim();

/**
 * A group chat reads better with first names, but only while they stay unambiguous.
 * So a first name shared by two people in this game keeps its full name — for BOTH
 * of them, since shortening only one is what makes a list confusing.
 */
export function shortenNames(allNames: string[]): (name: string) => string {
  const counts = new Map<string, number>();
  allNames.forEach((n) => {
    const key = firstNameOf(n).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return (name: string) => {
    const first = firstNameOf(name);
    return (counts.get(first.toLowerCase()) || 0) > 1 ? name.trim() : first;
  };
}

export function buildTeamsMessage(input: TeamsMessageInput): string {
  const {
    gameName, scheduledAt, reportingMinsBeforeGame,
    venue, location, format,
  } = input;

  const teamA = input.teamA || [];
  const teamB = input.teamB || [];
  const colours = input.colours || { A: "red" as const, B: "blue" as const };

  const lines: string[] = [];

  lines.push(`⚽ *${gameName}*`);
  if (scheduledAt) {
    const kickoff = new Date(scheduledAt);
    lines.push(`📅 ${formatIstShortDate(kickoff)}`);
    // Reporting and kick-off share a line: they are the same fact to a player
    // ("when do I leave the house"), and two 12-hour clock times side by side
    // are easier to compare than one buried a line apart from the other.
    const kickoffStr = formatIstTime(kickoff, { hour: "numeric" });
    const mins = reportingMinsBeforeGame || 0;
    if (mins > 0) {
      const report = formatIstTime(new Date(kickoff.getTime() - mins * 60_000), { hour: "numeric" });
      lines.push(`⏰ Report ${report} • Kick-off ${kickoffStr}`);
    } else {
      lines.push(`⏰ Kick-off ${kickoffStr}`);
    }
  }
  const venueParts = [venue, location].filter(Boolean);
  if (venueParts.length) lines.push(`📍 ${venueParts.join(", ")}`);
  if (format) lines.push(`🎮 Format: ${format}`);

  lines.push("");
  lines.push(DIV);

  const shorten = shortenNames([...teamA, ...teamB]);

  // Red first, then blue — the same order the portal and the downloaded sheet
  // put them in, so an organiser reading the two side by side isn't checking
  // a message whose halves are the other way round.
  const sideOrder: ("A" | "B")[] = colours.A === "red" ? ["A", "B"] : ["B", "A"];
  sideOrder.forEach((side, index) => {
    const names = side === "A" ? teamA : teamB;
    if (index > 0) lines.push("");
    lines.push(TEAM_LABEL[colours[side]]);
    // Just the name. Position and GK rating are the organiser's working notes —
    // in the group chat they only invite an argument about who should be in goal.
    names.forEach((name, i) => lines.push(`${i + 1}. ${shorten(name)}`));
  });

  lines.push(DIV);
  // Skill totals stay in the portal, not in the group chat — players comparing
  // their side's number against the other's is an argument nobody needs.
  lines.push("");
  lines.push(KASAKAI_SIGNOFF);

  return lines.join("\n");
}
