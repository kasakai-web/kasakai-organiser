"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildApiUrl, getSession } from "@/utils/api";
import "./PlayerMultiSelect.css";

export interface PlayerOption {
  id: string;
  name: string;
}

type SearchResponse = {
  success?: boolean;
  data?: Array<{ _id: string; name?: string }>;
};

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;
const MENU_HEIGHT = 300;
const MENU_MIN_WIDTH = 240;

/**
 * Pick several players.
 *
 * Selections show as removable chips rather than collapsing into "Ana (+3)":
 * the whole point of a pairing column is being able to read who is paired with
 * whom while scanning down it, and a count you have to open a menu to expand
 * defeats that.
 *
 * The menu is rendered through a portal and positioned against the viewport.
 * Both places this is used sit inside a horizontally scrolling table, and
 * `overflow-x: auto` forces the other axis to `auto` too — so an
 * absolutely-positioned menu gets clipped by the table rather than floating
 * over it. A portal is the only way out of that box.
 *
 * `suggestions` are shown the moment the menu opens, before anything is typed.
 * Almost every pairing an organiser makes is between two of their own regulars,
 * so making them type first to see anyone is friction with no payoff. Typing
 * then searches wider, through `remoteSearch`.
 */
export function PlayerMultiSelect({
  variant,
  selected,
  options = [],
  suggestions = [],
  onToggle,
  remoteSearch = false,
  excludeIds = [],
  disabled = false,
  addLabel = "Add",
  emptyLabel = "NA",
}: {
  variant: "with" | "against";
  selected: PlayerOption[];
  /** A complete candidate list the caller already holds — no searching needed. */
  options?: PlayerOption[];
  /** Shown before anything is typed, when the full list is too big to hold. */
  suggestions?: PlayerOption[];
  onToggle: (option: PlayerOption) => void;
  remoteSearch?: boolean;
  excludeIds?: string[];
  disabled?: boolean;
  addLabel?: string;
  emptyLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom;
    // Open upwards only when below genuinely will not fit AND above is roomier,
    // so a row near the bottom of a long table stays usable.
    const flip = roomBelow < MENU_HEIGHT && r.top > roomBelow;
    const width = Math.max(r.width, MENU_MIN_WIDTH);
    setPos({
      top: flip ? r.top - 6 : r.bottom + 6,
      // Keep the menu on screen when the trigger sits against the right edge.
      left: Math.min(r.left, Math.max(8, window.innerWidth - width - 8)),
      width,
      flip,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    place();
    // `capture` so scrolling the TABLE moves the menu too, not just the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  // Debounced remote lookup. The AbortController matters more than the debounce:
  // without it a slow early keystroke can land after a fast later one and
  // overwrite the results with stale names.
  useEffect(() => {
    if (!remoteSearch || !isOpen) return;

    const term = query.trim();
    if (term.length < MIN_SEARCH_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const { token } = getSession();
      if (!token) return;
      setSearching(true);
      try {
        const res = await fetch(
          buildApiUrl(`/api/v1/organisers/search-players?q=${encodeURIComponent(term)}`),
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
        );
        const data: SearchResponse = await res.json();
        if (res.ok && data.success) {
          setResults((data.data || []).map((p) => ({ id: String(p._id), name: p.name || "Unknown player" })));
        }
      } catch {
        /* aborted or offline — leave the previous results alone */
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, remoteSearch, isOpen]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const term = query.trim().toLowerCase();

  // Whatever the caller gave us, plus whatever the server found, deduped and
  // with anything already picked or ruled out taken away.
  const candidates = useMemo(() => {
    const local = (options.length > 0 ? options : suggestions)
      .filter((o) => !term || o.name.toLowerCase().includes(term));
    const merged: PlayerOption[] = [];
    const seen = new Set<string>();
    for (const opt of [...local, ...results]) {
      if (seen.has(opt.id) || selectedIds.has(opt.id) || excluded.has(opt.id)) continue;
      seen.add(opt.id);
      merged.push(opt);
    }
    return merged;
  }, [options, suggestions, results, term, selectedIds, excluded]);

  useEffect(() => { setHighlight(0); }, [term, isOpen]);

  const close = () => { setIsOpen(false); setQuery(""); };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, candidates.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && candidates[highlight]) {
      event.preventDefault();
      onToggle(candidates[highlight]);
    }
  };

  const isWith = variant === "with";
  const tone = isWith ? "pms-with" : "pms-against";

  const menu = pos && (
    <div
      ref={menuRef}
      className={`pms-menu ${tone}`}
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        transform: pos.flip ? "translateY(-100%)" : undefined,
      }}
      onKeyDown={onKeyDown}
    >
      <div className="pms-search-wrap">
        <input
          className="pms-search"
          placeholder={remoteSearch ? "Search players…" : "Filter…"}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="pms-list">
        {candidates.length > 0 ? (
          candidates.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              className={`pms-option ${i === highlight ? "highlighted" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onToggle(opt)}
            >
              <span className="pms-option-name">{opt.name}</span>
              <span className="pms-option-add">+</span>
            </button>
          ))
        ) : (
          <div className="pms-empty">
            {searching
              ? "Searching…"
              : term
                ? "No players found"
                : remoteSearch
                  ? "Start typing to find anyone else"
                  : "No other players"}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="pms-footer">
          {selected.length} selected · remove with the ✕ on a chip
        </div>
      )}
    </div>
  );

  return (
    <div className="pms-root">
      {selected.length > 0 ? (
        <div className="pms-chips">
          {selected.map((opt) => (
            <span key={opt.id} className={`pms-chip ${tone}`}>
              <span className="pms-chip-name" title={opt.name}>{opt.name}</span>
              <button
                type="button"
                className="pms-chip-remove"
                disabled={disabled}
                aria-label={`Remove ${opt.name}`}
                title={`Remove ${opt.name}`}
                onClick={() => onToggle(opt)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        // Nothing picked reads as NA at a glance, without opening anything.
        <span className="pms-na">{emptyLabel}</span>
      )}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`pms-trigger ${tone} ${selected.length > 0 ? "compact" : ""}`}
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
      >
        <span className="pms-trigger-plus">+</span>
        <span>{addLabel}</span>
      </button>

      {mounted && isOpen && menu && createPortal(menu, document.body)}
    </div>
  );
}

export default PlayerMultiSelect;
