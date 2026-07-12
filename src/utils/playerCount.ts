// Single source of truth for "how many bodies are on the field" — used by the
// dashboard table, the players modal, sorting, and the lifecycle pop-up so they
// can never disagree.
//
// A "body" is one registration row that is NOT refunded/forfeited and NOT opted
// out. This counts BOTH primary players AND their +1 guests (a guest is just a
// registration with plusOneName) — and the organiser's own slot when they are
// playing (the organiser occupies a slot that is not in the registrations array).
// Opted-out players are excluded; their paid guests, who keep their own row,
// still count (intentional — that slot is paid for).

export interface CountableReg {
  paymentStatus?: string | null;
  optedOut?: boolean;
}
export interface CountableGame {
  registrations?: CountableReg[];
  organiserIsPlaying?: boolean;
}

// Active registration rows (players + guests), excluding refunded/forfeited/opted-out.
export const activeRegCount = (game: CountableGame): number =>
  (game.registrations || []).filter(
    (r) => !["refunded", "forfeited"].includes(r.paymentStatus || "") && !r.optedOut,
  ).length;

// Total bodies on the field = active registrations + the organiser's own slot.
export const filledCount = (game: CountableGame): number =>
  activeRegCount(game) + (game.organiserIsPlaying ? 1 : 0);

// Spots left against a hard cap (never negative).
export const spotsLeft = (game: CountableGame, totalSlots: number): number =>
  Math.max(0, (Number(totalSlots) || 0) - filledCount(game));
