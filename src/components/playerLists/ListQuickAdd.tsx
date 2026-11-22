"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createList, fetchLists, listForGame } from "@/utils/playerListsApi";
import { plural, suggestEmoji, type ForGame, type ForGamePerson, type ListSummary } from "@/utils/playerLists";
import "./playerLists.css";

// "From your lists" inside the SOS and invite modals: one tap adds everyone on a
// list who can actually be reached for THIS game — the server works out who is
// already playing, already invited, or (for an SOS) has no KasaKai account — and
// a second tap takes back exactly the people that list added.
//
// The modal stays the owner of its recipients. This component only fetches and
// reports: `onAdd(listId, people)` / `onRemove(listId)`, with `activeIds` telling
// it which lists are currently contributing someone and `pickedKeys` who is
// already picked (`p:<playerId>`, `c:<last ten digits>`), so it can say how many
// the tap actually added.

const VISIBLE = 6;

export const pickedKey = (p: { playerId?: string | null; phone?: string | null }) =>
  p.playerId ? `p:${p.playerId}` : `c:${String(p.phone || "").replace(/\D/g, "").slice(-10)}`;

export function ListQuickAdd({
  gameId, purpose, activeIds, pickedKeys, organiserId, onAdd, onRemove,
}: {
  gameId: string;
  purpose: "sos" | "invite";
  activeIds: string[];
  pickedKeys: Set<string>;
  organiserId?: string;
  onAdd: (listId: string, people: ForGamePerson[]) => void;
  onRemove: (listId: string) => void;
}) {
  // The picks as of NOW, not as of the tap — the list loads over the network and
  // the organiser may have added or removed someone meanwhile.
  const pickedRef = useRef(pickedKeys);
  useEffect(() => { pickedRef.current = pickedKeys; }, [pickedKeys]);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    fetchLists()
      .then((idx) => { if (live) setLists(idx.lists); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return null;
  if (!lists) return <div className="pl-quickadd pl-hint">Loading your lists…</div>;

  const manageHref = organiserId ? `/dashboard/organizer/${organiserId}/player-lists` : null;

  if (lists.length === 0) {
    return (
      <div className="pl-quickadd pl-hint">
        💡 Save groups of players as <b style={{ color: "#ccc" }}>Player Lists</b> to add them here in one tap.
        {manageHref && <> <Link href={manageHref} className="pl-link">Make a list</Link></>}
      </div>
    );
  }

  const tap = async (l: ListSummary) => {
    if (busy) return;
    if (activeIds.includes(l._id)) {
      onRemove(l._id);
      setNote({ tone: "ok", text: `Took back everyone ${l.emoji} ${l.name} added` });
      return;
    }
    setBusy(l._id);
    setNote(null);
    try {
      const res: ForGame = await listForGame(l._id, gameId, purpose);
      const added = res.people.filter((p) => !pickedRef.current.has(pickedKey(p))).length;
      onAdd(l._id, res.people);
      setNote(describe(res, added, purpose));
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : "Couldn't load that list" });
    } finally {
      setBusy(null);
    }
  };

  const shown = expanded ? lists : lists.slice(0, VISIBLE);
  return (
    <div className="pl-quickadd">
      <div className="pl-label" style={{ marginBottom: 6 }}>
        <span>From your lists</span>
        {manageHref && <Link href={manageHref} className="pl-link" style={{ fontSize: 11.5 }}>Manage</Link>}
      </div>
      <div className="pl-chips">
        {shown.map((l) => {
          const on = activeIds.includes(l._id);
          return (
            <button key={l._id} type="button" className={`pl-chip${on ? " on" : ""}`} aria-pressed={on} disabled={busy === l._id} onClick={() => tap(l)}>
              {on ? "✓" : l.emoji} {l.name}<span className="n">{busy === l._id ? "…" : l.count}</span>
            </button>
          );
        })}
        {lists.length > VISIBLE && (
          <button type="button" className="pl-chip add" onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Fewer" : `+${lists.length - VISIBLE} more`}
          </button>
        )}
      </div>
      {note && <div className={`pl-note ${note.tone}`} style={{ marginTop: 8 }}>{note.text}</div>}
    </div>
  );
}

function describe(res: ForGame, added: number, purpose: "sos" | "invite"): { tone: "ok" | "warn"; text: string } {
  const s = res.skipped;
  const left = [
    s.seated && `${s.seated} already playing`,
    s.invited && `${s.invited} already invited`,
    s.noAccount && `${s.noAccount} not on KasaKai (an SOS needs an account — invite them instead)`,
    s.overLimit && `${s.overLimit} over the ${res.limit}-person limit`,
  ].filter(Boolean);
  const already = res.people.length - added;
  const head = added > 0
    ? `Added ${plural(added, purpose === "sos" ? "player" : "person", purpose === "sos" ? "players" : "people")} from ${res.list.emoji} ${res.list.name}`
    : `Nobody new from ${res.list.emoji} ${res.list.name}`;
  const parts = [head, already > 0 && `${already} were already picked`, ...left].filter(Boolean);
  return { tone: added > 0 ? "ok" : "warn", text: parts.join(" · ") };
}

// ── Save these as a list ─────────────────────────────────────────────────────
//
// The other half of "without much thinking": the group an organiser just put
// together for one SOS is usually the group they want next week. One tap saves it.

export function SaveAsList({
  defaultName, playerIds, contacts = [], via,
}: {
  defaultName: string;
  playerIds: string[];
  contacts?: { name: string; phone: string }[];
  via: "sos" | "invite";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const count = playerIds.length + contacts.length;
  if (count === 0) return null;

  if (state === "saved") {
    return <div className="pl-note ok" style={{ marginTop: 10 }}>✓ Saved as “{name.trim()}” — it&apos;ll be under From your lists next time.</div>;
  }

  if (!open) {
    return (
      <button type="button" className="pl-link" style={{ marginTop: 10, fontSize: 12.5 }} onClick={() => setOpen(true)}>
        💾 Save these {count} as a list
      </button>
    );
  }

  const save = async () => {
    if (!name.trim()) return;
    setState("saving"); setError(null);
    try {
      await createList({ name: name.trim(), emoji: suggestEmoji(name), members: { playerIds, contacts }, via });
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the list");
      setState("idle");
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="pl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="List name"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        <button type="button" className="pl-btn lime" disabled={!name.trim() || state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="pl-icon-btn" onClick={() => setOpen(false)} aria-label="Cancel">✕</button>
      </div>
      {error && <div className="pl-note err" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
