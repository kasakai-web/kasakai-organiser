// The link an organiser shares so a player lands on a game.
//
// Pure (no DOM) so it can be unit-tested, and the ONE place the link is built:
// the game card's Copy link, the Players modal header and the Copy List
// message all call it, so the three can never hand out different links.
//
// It is the bare-id link the player app copies (/join/<gameId>), so a game has
// ONE link whoever shares it. The player app's /join/[gameId] route takes the
// LAST 24-hex run in the segment as the game id, so the older slugged links
// (/join/saturday-evening-game-28-nov-2026-<id>) already sent out still resolve.

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

/** The public game page — what a player copies from the game in the player app. */
export function gameJoinUrl(game: Pick<ShareableGame, "_id">): string {
  return `${PLAYER_APP_ORIGIN}/join/${game._id}`;
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
