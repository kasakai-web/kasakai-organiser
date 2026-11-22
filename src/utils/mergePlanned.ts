// Mixing planned recurring games into the Upcoming list.
//
// Live games arrive from the server a page at a time, already in the chosen
// order. Planned games (not created yet) arrive all at once. They are slotted
// into the live order by the SAME key the server sorted on, so a planned
// Tuesday sits between the live Monday and the live Wednesday.
//
// The catch is paging: while more live pages exist, a planned game that sorts
// AFTER the last loaded live game might belong after games not loaded yet.
// Showing it now would place it ahead of them, and it would then jump down the
// list as pages arrive. So until the last page is in, only planned games that
// sort at or before the last loaded live game are shown; the rest appear as the
// pages that precede them load.

export type MergeSort = "date-asc" | "date-desc" | "fee-asc" | "fee-desc" | "players-desc";

export interface MergeLive {
  scheduledAt: string;
  feeInPaise?: number;
  filledSeats?: number;
}

export interface MergePlanned {
  scheduledAt: string;
  feeInPaise: number;
}

export type BoardItem<L, P> = { kind: "live"; game: L } | { kind: "planned"; planned: P };

type Key = { time: number; fee: number; filled: number };

const keyOf = (x: { scheduledAt: string; feeInPaise?: number; filledSeats?: number }): Key => ({
  time: new Date(x.scheduledAt).getTime() || 0,
  fee: Number(x.feeInPaise) || 0,
  // A planned game has nobody in it yet.
  filled: Number(x.filledSeats) || 0,
});

// Mirrors ORGANISER_GAMES_SORTS on the backend, tie-breaks included
// (fee and players fall back to the LATEST date first).
const comparators: Record<MergeSort, (a: Key, b: Key) => number> = {
  "date-asc":     (a, b) => a.time - b.time,
  "date-desc":    (a, b) => b.time - a.time,
  "fee-asc":      (a, b) => a.fee - b.fee || b.time - a.time,
  "fee-desc":     (a, b) => b.fee - a.fee || b.time - a.time,
  "players-desc": (a, b) => b.filled - a.filled || b.time - a.time,
};

export function mergePlanned<L extends MergeLive, P extends MergePlanned>(
  live: L[],
  planned: P[],
  { sort, hasMore }: { sort: string; hasMore: boolean },
): BoardItem<L, P>[] {
  const cmp = comparators[sort as MergeSort] ?? comparators["date-asc"];

  let pending = [...planned].sort((a, b) => cmp(keyOf(a), keyOf(b)));
  if (hasMore) {
    const last = live[live.length - 1];
    // No live game loaded yet but more to come: nothing can be placed safely.
    pending = last ? pending.filter((p) => cmp(keyOf(p), keyOf(last)) <= 0) : [];
  }

  const out: BoardItem<L, P>[] = [];
  let j = 0;
  for (const game of live) {
    // A planned game goes BEFORE a live one only when it sorts strictly
    // earlier; on a tie the live game, which players can act on, comes first.
    while (j < pending.length && cmp(keyOf(pending[j]), keyOf(game)) < 0) {
      out.push({ kind: "planned", planned: pending[j++] });
    }
    out.push({ kind: "live", game });
  }
  while (j < pending.length) out.push({ kind: "planned", planned: pending[j++] });
  return out;
}
