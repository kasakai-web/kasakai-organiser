// The link an organiser shares so a player lands on a game.
//
// Pure (no DOM) so it can be unit-tested, and the ONE place the link is built:
// the game card's Copy link, the Players modal header and the Copy List
// message all call it, so the three can never hand out different links.
//
// The player app's /join/[gameId] route takes the LAST 24-hex run in the
// segment as the game id, so the readable slug in front is decoration — old
// bare-id links keep working and a renamed game's old link still resolves.

export const PLAYER_APP_ORIGIN = (
  process.env.NEXT_PUBLIC_PLAYER_APP_URL || "https://www.kasakai.in"
).replace(/\/+$/, "");

export interface ShareableGame {
  _id: string;
  title?: string;
  scheduledAt?: string;
  status?: string;
  visibility?: string;
  inviteLinkToken?: string | null;
  inviteLinkEnabled?: boolean;
  inviteLinkMaxJoins?: number | null;
  invitations?: { via?: string; status?: string }[];
}

/** "Thursday Morning Game" on 12 Jun 2026 → "thursday-morning-game-12-jun-2026". */
export function gameJoinSlug(title?: string, scheduledAt?: string): string {
  const dateLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
      })
    : "";
  return `${title || "game"} ${dateLabel}`
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The public game page — what a player copies from the game in the player app. */
export function gameJoinUrl(game: Pick<ShareableGame, "_id" | "title" | "scheduledAt">): string {
  const slug = gameJoinSlug(game.title, game.scheduledAt);
  return `${PLAYER_APP_ORIGIN}/join/${slug ? `${slug}-` : ""}${game._id}`;
}

/** The game's shared invite link (`inv_…` token). */
export function inviteLinkUrl(token: string): string {
  return `${PLAYER_APP_ORIGIN}/join/${token}`;
}

export type ShareLink =
  | { url: string; kind: "public" | "invite" }
  | { url: null; reason: string; fixable: boolean };

// Mirrors the board's "link joins used" count — a capped link that is used up
// refuses everyone, so handing it out would be handing out a dead end.
function inviteLinkUsedUp(game: ShareableGame): boolean {
  if (game.inviteLinkMaxJoins == null) return false;
  const used = (game.invitations || []).filter(
    (i) => i.via === "invite_link" && ["pending", "accepted", "approved_unpaid"].includes(i.status || ""),
  ).length;
  return used >= game.inviteLinkMaxJoins;
}

/**
 * What to share for this game, or why there is nothing to share.
 *
 * A PRIVATE game's public page refuses every booking ("private, invite-only"),
 * so sharing it would send people to a dead end. Its invite link is the only
 * way in, so that is what a private game shares — and when that link is off
 * or used up, the answer is "nothing yet" with a reason the organiser can fix.
 */
export function shareLinkFor(game: ShareableGame): ShareLink {
  if (game.status === "cancelled" || game.status === "completed") {
    return { url: null, reason: "This game is closed — there is nothing left to join.", fixable: false };
  }
  if (game.visibility !== "private") {
    return { url: gameJoinUrl(game), kind: "public" };
  }
  if (!game.inviteLinkToken) {
    return { url: null, reason: "Private game — create its invite link to share it.", fixable: true };
  }
  if (game.inviteLinkEnabled === false) {
    return { url: null, reason: "Private game — its invite link is turned off.", fixable: true };
  }
  if (inviteLinkUsedUp(game)) {
    return { url: null, reason: "Private game — its invite link has reached its join limit.", fixable: true };
  }
  return { url: inviteLinkUrl(game.inviteLinkToken), kind: "invite" };
}
