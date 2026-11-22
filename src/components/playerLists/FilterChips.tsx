"use client";

import type { AutoTagInfo, TagInfo, VenueInfo } from "@/utils/playerLists";

// The one row of filter chips — automatic tags, the organiser's own tags, and
// venues — shared by the picker, the smart-list editor and a list's own filter,
// so the same chip means the same thing everywhere it appears.
//
// `counts` is how many of the rows currently on screen carry each key (venues as
// `v:<id>`). A chip that would leave nothing is dimmed rather than hidden, so the
// row does not jump about under the organiser's thumb as they tap.

export function FilterChips({
  autoTags = [],
  tags = [],
  venues = [],
  keys,
  venueIds,
  counts,
  onToggleKey,
  onToggleVenue,
  scroll = true,
  hideAuto = [],
  showZero = true,
}: {
  autoTags?: AutoTagInfo[];
  tags?: TagInfo[];
  venues?: VenueInfo[];
  keys: string[];
  venueIds: string[];
  counts?: Map<string, number>;
  onToggleKey: (key: string) => void;
  onToggleVenue?: (id: string) => void;
  scroll?: boolean;
  hideAuto?: string[];
  showZero?: boolean;
}) {
  const n = (k: string) => (counts ? counts.get(k) || 0 : undefined);
  const autos = autoTags.filter((a) => !hideAuto.includes(a.key) && (showZero || keys.includes(a.key) || (n(a.key) ?? 1) > 0));
  const own = tags.filter((t) => showZero || keys.includes(t.key) || (n(t.key) ?? 1) > 0);
  const places = venues.filter((v) => showZero || venueIds.includes(v.id) || (n(`v:${v.id}`) ?? 1) > 0);

  if (autos.length + own.length + places.length === 0) return null;

  return (
    <div className={`pl-chips${scroll ? " scroll" : ""}`} role="group" aria-label="Filter players">
      {autos.map((a) => {
        const on = keys.includes(a.key);
        const count = n(a.key);
        return (
          <button
            key={a.key}
            type="button"
            className={`pl-chip${on ? " on" : ""}${!on && count === 0 ? " zero" : ""}`}
            aria-pressed={on}
            title={a.hint}
            onClick={() => onToggleKey(a.key)}
          >
            {a.emoji} {a.label}{count !== undefined && <span className="n">{count}</span>}
          </button>
        );
      })}
      {own.map((t) => {
        const on = keys.includes(t.key);
        const count = n(t.key);
        return (
          <button
            key={t.key}
            type="button"
            className={`pl-chip tag${on ? " on" : ""}${!on && count === 0 ? " zero" : ""}`}
            aria-pressed={on}
            onClick={() => onToggleKey(t.key)}
          >
            #{t.label}{count !== undefined && <span className="n">{count}</span>}
          </button>
        );
      })}
      {onToggleVenue && places.map((v) => {
        const on = venueIds.includes(v.id);
        const count = n(`v:${v.id}`);
        return (
          <button
            key={v.id}
            type="button"
            className={`pl-chip venue${on ? " on" : ""}${!on && count === 0 ? " zero" : ""}`}
            aria-pressed={on}
            onClick={() => onToggleVenue(v.id)}
          >
            📍 {v.name}{count !== undefined && <span className="n">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
