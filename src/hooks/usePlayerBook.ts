"use client";

import { useCallback, useEffect, useState } from "react";
import { getSession } from "@/utils/api";
import { fetchBook, LISTS_CHANGED_EVENT } from "@/utils/playerListsApi";
import type { BookRow, PlayerBook } from "@/utils/playerLists";

// The organiser's player book (everyone they can put on a list), shared by every
// picker on the page and kept for a minute — opening "Add players" a second time,
// or the SOS modal right after the lists page, should be instant. Keyed by the
// signed-in organiser so a different login in the same tab never sees it.
//
// Any Player Lists write (utils/playerListsApi.ts) drops it; a tag edit patches
// it in place instead (`patchRows`), because a refetch per tap is exactly the lag
// the instant tag chips exist to avoid.

const TTL_MS = 60 * 1000;

let cache: { owner: string; at: number; book: PlayerBook } | null = null;
let inflight: { owner: string; promise: Promise<PlayerBook> } | null = null;
const listeners = new Set<(book: PlayerBook | null) => void>();

const owner = () => getSession().userId || "";

function publish(book: PlayerBook | null) {
  for (const l of listeners) l(book);
}

export function invalidatePlayerBook() {
  cache = null;
}

async function load(force: boolean): Promise<PlayerBook> {
  const me = owner();
  if (!force && cache && cache.owner === me && Date.now() - cache.at < TTL_MS) return cache.book;
  if (inflight && inflight.owner === me) return inflight.promise;
  const promise = fetchBook()
    .then((book) => {
      cache = { owner: me, at: Date.now(), book };
      publish(book);
      return book;
    })
    .finally(() => { inflight = null; });
  inflight = { owner: me, promise };
  return promise;
}

export function usePlayerBook(active = true) {
  const fresh = cache && cache.owner === owner() ? cache.book : null;
  const [book, setBook] = useState<PlayerBook | null>(fresh);
  const [loading, setLoading] = useState(!fresh);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    try {
      setBook(await load(force));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your players");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onPublish = (b: PlayerBook | null) => { if (b) setBook(b); };
    listeners.add(onPublish);
    return () => { listeners.delete(onPublish); };
  }, []);

  useEffect(() => {
    if (active) reload(false);
  }, [active, reload]);

  useEffect(() => {
    const onChange = () => invalidatePlayerBook();
    window.addEventListener(LISTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(LISTS_CHANGED_EVENT, onChange);
  }, []);

  // Apply a local edit (tags) to every mounted copy and the cache, without a refetch.
  const patchRows = useCallback((fn: (row: BookRow) => BookRow) => {
    if (cache) cache = { ...cache, book: { ...cache.book, rows: cache.book.rows.map(fn) } };
    setBook((b) => (b ? { ...b, rows: b.rows.map(fn) } : b));
    if (cache) publish(cache.book);
  }, []);

  return { book, loading, error, reload, patchRows };
}
