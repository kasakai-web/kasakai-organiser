"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { Avatar } from "./Avatar";
import { FilterChips } from "./FilterChips";
import { usePlayerBook } from "@/hooks/usePlayerBook";
import { usePlayerSearch } from "@/hooks/usePlayerSearch";
import {
  chipCounts, filterBook, lastPlayedLabel, plural,
  type AddedVia, type BookRow, type Contact,
} from "@/utils/playerLists";

// Pick people for a list, two ways, one selection:
//
//   Players     — everyone who has played with you, filtered by chips (🔥 Regular,
//                 #GK, 📍 a venue…) and search; "Select all" takes the whole
//                 filtered view in one tap. Typing also searches the rest of
//                 KasaKai, and a full number nobody owns can be added as a contact.
//   From a game — tap a game, get its whole roster.
//
// Mounted fresh on every open (PlayerPicker returns null when closed), so a new
// pick never starts with the last one's leftovers.

export interface PickerResult { playerIds: string[]; contacts: Contact[]; via: AddedVia }

type Tab = "players" | "games";
type Picked = { kind: "player"; id: string; name: string } | { kind: "contact"; name: string; phone: string };

const PAGE = 80;

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Keys already on the list (`p:<playerId>`, `c:<phone>`) — shown, not pickable. */
  already?: Set<string>;
  verb?: string;
  initialTab?: Tab;
  onClose: () => void;
  onConfirm: (result: PickerResult) => Promise<void> | void;
}

export function PlayerPicker(props: Props) {
  if (!props.open) return null;
  return <PickerInner {...props} />;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" });
const mon = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const lastFour = (s?: string) => { const d = (s || "").replace(/\D/g, ""); return d.length >= 4 ? `•••• ${d.slice(-4)}` : ""; };

function PickerInner({ title, subtitle, already = new Set(), verb = "Add", initialTab = "players", onClose, onConfirm }: Props) {
  const { book, loading, error, reload } = usePlayerBook(true);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [vias, setVias] = useState<Set<AddedVia>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Players tab
  const [q, setQ] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [contactName, setContactName] = useState("");
  const find = usePlayerSearch(tab === "players");
  const search = (value: string) => { setQ(value); find.setQuery(value); };
  // How many rows are drawn, remembered per filter — a new search or chip starts
  // again from the top instead of keeping the last filter's "show more".
  const filterKey = `${q}|${keys.join(",")}|${venueIds.join(",")}`;
  const [page, setPage] = useState({ key: filterKey, n: PAGE });
  const shown = page.key === filterKey ? page.n : PAGE;
  const showMore = () => setPage({ key: filterKey, n: shown + PAGE });

  const rows = useMemo(() => book?.rows || [], [book]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const filtered = useMemo(() => filterBook(rows, { q, keys, venues: venueIds }), [rows, q, keys, venueIds]);
  const counts = useMemo(() => chipCounts(rows, { q, keys, venues: venueIds }), [rows, q, keys, venueIds]);

  const isIn = (k: string) => already.has(k);
  const pickedCount = picked.size;

  const note = (via: AddedVia) => setVias((s) => (s.has(via) ? s : new Set(s).add(via)));

  const togglePlayer = (id: string, name: string, via: AddedVia) => {
    const k = `p:${id}`;
    if (isIn(k)) return;
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(k)) next.delete(k); else next.set(k, { kind: "player", id, name });
      return next;
    });
    note(via);
  };

  const setMany = (people: { id: string; name: string }[], on: boolean, via: AddedVia) => {
    setPicked((m) => {
      const next = new Map(m);
      for (const p of people) {
        const k = `p:${p.id}`;
        if (isIn(k)) continue;
        if (on) next.set(k, { kind: "player", id: p.id, name: p.name }); else next.delete(k);
      }
      return next;
    });
    if (on) note(via);
  };

  const toggleContact = (c: Contact, via: AddedVia, force?: boolean) => {
    const k = `c:${c.phone}`;
    if (isIn(k)) return;
    setPicked((m) => {
      const next = new Map(m);
      const on = force ?? !next.has(k);
      if (on) next.set(k, { kind: "contact", name: c.name, phone: c.phone }); else next.delete(k);
      return next;
    });
    note(via);
  };

  // ── Players tab ──────────────────────────────────────────────────────────
  const selectable = filtered.filter((r) => !isIn(`p:${r.id}`));
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(`p:${r.id}`));
  const narrowing = q.trim().length > 0 || keys.length > 0 || venueIds.length > 0;

  const inBook = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const remote = find.results.filter((p) => !inBook.has(p._id));
  const digits = q.replace(/\D/g, "");
  const looksLikeNumber = digits.length >= 10 && /^[+\d\s()-]+$/.test(q.trim());
  const contactPhone = looksLikeNumber ? `91${digits.slice(-10)}` : "";

  const addTypedContact = () => {
    if (!contactPhone) return;
    toggleContact({ name: contactName.trim() || "Player", phone: contactPhone }, "manual", true);
    search(""); setContactName("");
  };

  // ── Confirm ──────────────────────────────────────────────────────────────
  const confirm = async () => {
    if (pickedCount === 0 || saving) return;
    const playerIds: string[] = [];
    const contacts: Contact[] = [];
    for (const p of picked.values()) {
      if (p.kind === "player") playerIds.push(p.id); else contacts.push({ name: p.name, phone: p.phone });
    }
    const via: AddedVia = vias.size === 1 ? [...vias][0] : "manual";
    setSaving(true); setSaveError(null);
    try {
      await onConfirm({ playerIds, contacts, via });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save — try again");
      setSaving(false);
    }
  };

  const footer = (
    <>
      <div className="grow" style={{ minWidth: 0 }}>
        {pickedCount > 0
          ? <button type="button" className="pl-link" onClick={() => setPicked(new Map())}>Clear {pickedCount}</button>
          : <span className="pl-hint">Nobody picked yet</span>}
      </div>
      <button type="button" className="pl-btn primary" disabled={pickedCount === 0 || saving} onClick={confirm} style={{ minWidth: 150 }}>
        {saving ? "Saving…" : pickedCount === 0 ? verb : `${verb} ${plural(pickedCount, "player")}`}
      </button>
    </>
  );

  // A render helper, not a component: a component declared in here would be a new
  // type every render and remount all eighty rows on each tap.
  const playerLine = (r: BookRow, via: AddedVia) => {
    const k = `p:${r.id}`;
    const inList = isIn(k);
    const on = picked.has(k);
    const sub = [r.games ? `${plural(r.games, "game")} with you` : "New to you", lastPlayedLabel(r.lastAt), r.phone].filter(Boolean).join(" · ");
    return (
      <button key={r.id} type="button" className={`pl-row${on ? " picked" : ""}${inList ? " disabled" : ""}`} onClick={() => togglePlayer(r.id, r.name, via)} aria-pressed={on} disabled={inList}>
        <span className={`pl-check${on || inList ? " on" : ""}`}>{on || inList ? "✓" : ""}</span>
        <Avatar name={r.name} img={r.img} />
        <span className="pl-row-main">
          <span className="pl-row-name"><span>{r.name}</span>{r.auto.includes("gk") && <span title="Goalkeeper">🧤</span>}{r.auto.includes("regular") && <span title="Regular">🔥</span>}</span>
          <span className="pl-row-sub">{sub}</span>
          {r.tags.length > 0 && (
            <span className="pl-mini-tags">{r.tags.slice(0, 3).map((t) => <span key={t} className="pl-mini-tag">#{t}</span>)}</span>
          )}
        </span>
        {inList && <span className="pl-row-side">In list</span>}
      </button>
    );
  };

  return (
    <Sheet open onClose={onClose} title={title} subtitle={subtitle} size="lg" footer={footer}>
      <div className="pl-stack">
        <div className="pl-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "players"} className={`pl-tab${tab === "players" ? " on" : ""}`} onClick={() => setTab("players")}>Players</button>
          <button type="button" role="tab" aria-selected={tab === "games"} className={`pl-tab${tab === "games" ? " on" : ""}`} onClick={() => setTab("games")}>From a game</button>
        </div>

        {error && (
          <div className="pl-note err">{error} <button type="button" className="pl-link" onClick={() => reload(true)}>Retry</button></div>
        )}
        {saveError && <div className="pl-note err">{saveError}</div>}

        {tab === "players" && (
          <>
            <div className="pl-search">
              <input className="pl-input" value={q} onChange={(e) => search(e.target.value)} placeholder="Search name or number…" inputMode="search" enterKeyHint="search" aria-label="Search players" />
              {q && <button type="button" className="pl-icon-btn pl-search-clear" onClick={() => search("")} aria-label="Clear search">✕</button>}
            </div>

            {book && (
              <FilterChips
                autoTags={book.autoTags}
                tags={book.tags}
                venues={book.venues}
                keys={keys}
                venueIds={venueIds}
                counts={counts}
                hideAuto={["a:played"]}
                onToggleKey={(k) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
                onToggleVenue={(id) => setVenueIds((vs) => (vs.includes(id) ? vs.filter((x) => x !== id) : [...vs, id]))}
              />
            )}

            {loading && !book ? (
              <div className="pl-empty">Loading your players…</div>
            ) : (
              <>
                <div className="pl-label">
                  <span>{narrowing ? `${plural(filtered.length, "match", "matches")}` : `Your players (${rows.length})`}</span>
                  {selectable.length > 1 && (
                    <button type="button" className="pl-link" onClick={() => setMany(selectable, !allPicked, "book")}>
                      {allPicked ? `Unselect ${selectable.length}` : `Select all ${selectable.length}`}
                    </button>
                  )}
                </div>

                {filtered.length === 0 ? (
                  <div className="pl-empty">
                    {rows.length === 0
                      ? <>Nobody has played your games yet.<br />Search KasaKai above by name or number.</>
                      : <>No one matches. {keys.length + venueIds.length > 0 && <button type="button" className="pl-link" onClick={() => { setKeys([]); setVenueIds([]); }}>Clear filters</button>}</>}
                  </div>
                ) : (
                  <div className="pl-rows">
                    {filtered.slice(0, shown).map((r) => playerLine(r, "book"))}
                    {filtered.length > shown && (
                      <button type="button" className="pl-more-btn" onClick={showMore}>
                        Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown}
                      </button>
                    )}
                  </div>
                )}

                {find.isSearching && (remote.length > 0 || find.loading) && (
                  <div>
                    <div className="pl-label"><span>More on KasaKai</span>{find.loading && <span className="pl-hint">Searching…</span>}</div>
                    {remote.length > 0 && (
                      <div className="pl-rows">
                        {remote.map((p) => {
                          const k = `p:${p._id}`;
                          const on = picked.has(k);
                          const inList = isIn(k);
                          return (
                            <button key={p._id} type="button" className={`pl-row${on ? " picked" : ""}${inList ? " disabled" : ""}`} disabled={inList} onClick={() => togglePlayer(p._id, p.name, "search")} aria-pressed={on}>
                              <span className={`pl-check${on || inList ? " on" : ""}`}>{on || inList ? "✓" : ""}</span>
                              <Avatar name={p.name} img={p.profileImage} />
                              <span className="pl-row-main">
                                <span className="pl-row-name"><span>{p.name}</span></span>
                                <span className="pl-row-sub">{["Hasn't played with you", lastFour(p.phone)].filter(Boolean).join(" · ")}</span>
                              </span>
                              {inList && <span className="pl-row-side">In list</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {looksLikeNumber && !find.loading && filtered.length === 0 && remote.length === 0 && (
                  <div className="pl-note">
                    <div style={{ marginBottom: 8 }}><b style={{ color: "#eee" }}>+91 {digits.slice(-10, -5)} {digits.slice(-5)}</b> isn’t on KasaKai. Add them as a contact — invites still reach them on WhatsApp.</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="pl-input" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Their name" onKeyDown={(e) => { if (e.key === "Enter") addTypedContact(); }} />
                      <button type="button" className="pl-btn lime" onClick={addTypedContact}>Add</button>
                    </div>
                  </div>
                )}

                {[...picked.values()].some((p) => p.kind === "contact") && (
                  <div className="pl-hint">
                    Contacts picked: {[...picked.values()].filter((p) => p.kind === "contact").map((p) => p.name).join(", ")}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === "games" && (
          <>
            <div className="pl-hint">Tap a game to pick everyone who played (or is booked). Tap again to undo.</div>
            {loading && !book ? (
              <div className="pl-empty">Loading your games…</div>
            ) : !book || book.games.length === 0 ? (
              <div className="pl-empty">No games with players yet.</div>
            ) : (
              <div className="pl-rows">
                {book.games.map((g) => {
                  const people = g.playerIds.filter((id) => !isIn(`p:${id}`)).map((id) => ({ id, name: byId.get(id)?.name || "Player" }));
                  const pickedHere = people.filter((p) => picked.has(`p:${p.id}`)).length;
                  const all = people.length > 0 && pickedHere === people.length;
                  return (
                    <button key={g.id} type="button" className={`pl-game${all ? " on" : ""}`} disabled={people.length === 0} onClick={() => setMany(people, !all, "game")} aria-pressed={all}>
                      <span className="when"><b>{day(g.scheduledAt)}</b><small>{mon(g.scheduledAt)}</small></span>
                      <span className="pl-row-main">
                        <span className="pl-row-name"><span>{g.title}</span>{g.upcoming && <span className="pl-badge muted">Upcoming</span>}</span>
                        <span className="pl-row-sub">{[when(g.scheduledAt), g.venue].filter(Boolean).join(" · ")}</span>
                        <span className="pl-row-sub" style={{ color: all ? "#c8ff3e" : pickedHere ? "#d9f99d" : "#8a8a8a" }}>
                          {people.length === 0
                            ? `All ${g.playerIds.length} already in this list`
                            : all ? `✓ All ${people.length} picked` : pickedHere ? `${pickedHere} of ${people.length} picked` : `${plural(people.length, "player")}`}
                        </span>
                      </span>
                      <span className={`pl-check square${all ? " on" : ""}`}>{all ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </Sheet>
  );
}
