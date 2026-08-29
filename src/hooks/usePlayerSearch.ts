"use client";
import { useEffect, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";

export interface PlayerSearchResult {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  profileImage?: string;
  totalGamesPlayed?: number;
}

/** Below this many characters the backend rejects the query anyway — don't ask. */
const MIN_QUERY = 2;

/**
 * Debounced typeahead over `/organisers/search-players`, shared by every place
 * the organiser picks a player out of the member list (the invite modal and the
 * SOS modal).
 *
 * The one piece of state is the ANSWER together with the query that produced it,
 * so `results` and `loading` are derived rather than cleared: a slow response for
 * an older query can never be shown against a newer one, and nothing has to be
 * reset when the box is emptied. The in-flight request is aborted on each
 * keystroke too, so it doesn't outlive the query that asked for it.
 *
 * `active` is the modal's "am I open" flag: while it is false no request is made
 * and no results are shown, so reopening never flashes the previous search.
 */
export function usePlayerSearch(active: boolean) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ q: string; items: PlayerSearchResult[] }>({ q: "", items: [] });

  const q = query.trim();
  /** True once the query is long enough that a dropdown should be shown. */
  const isSearching = active && q.length >= MIN_QUERY;
  const results = isSearching && answer.q === q ? answer.items : [];
  const loading = isSearching && answer.q !== q;

  useEffect(() => {
    if (!isSearching) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      let items: PlayerSearchResult[] = [];
      try {
        const { token } = getSession();
        const res = await fetch(buildApiUrl(`/api/v1/organisers/search-players?q=${encodeURIComponent(q)}`), {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (res.ok && data?.success) items = data.data || [];
      } catch (e) {
        // An abort means a newer query already owns the state — leave it alone.
        if ((e as { name?: string })?.name === "AbortError") return;
      }
      setAnswer({ q, items });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, isSearching]);

  const reset = () => { setQuery(""); setAnswer({ q: "", items: [] }); };

  return { query, setQuery, results, loading, isSearching, reset };
}
