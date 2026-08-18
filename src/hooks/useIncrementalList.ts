"use client";
import { useCallback, useEffect, useState } from "react";

interface Options {
  /** How many items to reveal per page. Default 20. */
  pageSize?: number;
  /**
   * Changing this starts the list over from the first page — pass whatever
   * identifies "a different list" (a tab name, a filter signature).
   */
  resetKey?: unknown;
  /** Set false to hand back the whole list untouched (no windowing at all). */
  enabled?: boolean;
}

/**
 * Reveals a long list one page at a time as the reader reaches the end of it.
 *
 * Attach `sentinelRef` to a node placed *after* the rendered items: when that
 * node comes near the viewport the next page appears. `loadMore` does the same
 * thing on demand, so a button can carry keyboard users and any browser where
 * IntersectionObserver is missing.
 *
 * This windows data that is ALREADY in memory — no network round-trip, so the
 * revealed items can never disagree with counts computed from the same array.
 */
export function useIncrementalList<T>(items: T[], options: Options = {}) {
  const { pageSize = 20, resetKey, enabled = true } = options;

  const [visibleCount, setVisibleCount] = useState(pageSize);

  // Switching lists starts at the top again. A background refresh must NOT:
  // it hands us a fresh array every 20 s, and resetting on that would snatch
  // back everything the reader had already scrolled past. Adjusting during
  // render rather than in an effect means the new list never paints long first.
  const [renderedKey, setRenderedKey] = useState(resetKey);
  if (renderedKey !== resetKey) {
    setRenderedKey(resetKey);
    setVisibleCount(pageSize);
  }

  const hasMore = enabled && visibleCount < items.length;

  // Deliberately unclamped: `items` is rebuilt on every render, so reading its
  // length here would make this callback — and the observer effect below —
  // churn every render. Overshooting is harmless, `slice` clamps for us.
  const loadMore = useCallback(() => {
    setVisibleCount((c) => c + pageSize);
  }, [pageSize]);

  // A callback ref rather than useRef: it re-runs the observer effect when the
  // sentinel node actually mounts, which a ref object's silent mutation cannot.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!sentinel || !hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      // Start the next page slightly before the sentinel is on screen so the
      // cards are already there by the time the reader gets to them.
      { rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, loadMore]);

  return {
    /** The slice to render. */
    visible: enabled ? items.slice(0, visibleCount) : items,
    /** True while items remain unrevealed — render the sentinel only then. */
    hasMore,
    /** Attach to the node that sits after the rendered items. */
    sentinelRef: setSentinel,
    /** Reveal the next page now (button fallback). */
    loadMore,
    /** How many are on screen, for a "20 of 137" style hint. */
    shown: enabled ? Math.min(visibleCount, items.length) : items.length,
  };
}
