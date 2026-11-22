"use client";

import { useMemo, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { bulkTag, deleteTag, renameTag, setPlayerTags } from "@/utils/playerListsApi";
import { plural, tagKeyOf, type AutoKey, type AutoTagInfo, type TagInfo } from "@/utils/playerLists";

// Tags are the organiser's own labels on a player — "GK", "Friday crew",
// "Brings guests" — private to them, and the filter chips everywhere else.
// There is no "create tag" step: typing one makes it.

const MAX_LEN = 24;
const clean = (s: string) => s.replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

// Typed text → the chip it would become, reusing an existing tag's spelling.
const canonical = (label: string, palette: TagInfo[]) => palette.find((p) => p.key === tagKeyOf(label))?.label || label;

function TagInput({ palette, exclude, onAdd, autoFocus }: { palette: TagInfo[]; exclude: string[]; onAdd: (label: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const typed = clean(text);
  const excluded = new Set(exclude.map(tagKeyOf));
  const suggestions = palette
    .filter((p) => !excluded.has(p.key) && (!typed || p.label.toLowerCase().includes(typed.toLowerCase())))
    .slice(0, 12);
  const isNew = typed && !palette.some((p) => p.key === tagKeyOf(typed)) && !excluded.has(tagKeyOf(typed));
  const add = (label: string) => { onAdd(label); setText(""); };
  return (
    <div className="pl-stack" style={{ marginTop: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="pl-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed) { e.preventDefault(); add(canonical(typed, palette)); } }}
          placeholder="Type a tag — GK, Friday crew…"
          maxLength={MAX_LEN + 2}
          autoFocus={autoFocus}
          enterKeyHint="done"
          aria-label="New tag"
        />
        <button type="button" className="pl-btn lime" disabled={!typed} onClick={() => add(canonical(typed, palette))}>Add</button>
      </div>
      {(suggestions.length > 0 || isNew) && (
        <div className="pl-chips">
          {isNew && <button type="button" className="pl-chip add" onClick={() => add(typed)}>+ New “{typed}”</button>}
          {suggestions.map((s) => (
            <button key={s.key} type="button" className="pl-chip tag" onClick={() => add(s.label)}>
              #{s.label}<span className="n">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── One player ───────────────────────────────────────────────────────────────

export function PlayerTagsSection({
  playerId, tags, auto, palette, autoTags, onSaved,
}: {
  playerId: string;
  tags: string[];
  auto: AutoKey[];
  palette: TagInfo[];
  autoTags: AutoTagInfo[];
  onSaved: (tags: string[], palette: TagInfo[]) => void;
}) {
  const [current, setCurrent] = useState(tags);
  const [error, setError] = useState<string | null>(null);
  // Every tap saves at once. Saves are queued so two quick taps land in order and
  // the last one is what the server keeps.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const save = (next: string[]) => {
    const before = current;
    setCurrent(next);
    setError(null);
    queue.current = queue.current
      .then(() => setPlayerTags(playerId, next))
      .then((res) => onSaved(res.tags, res.palette))
      .catch((e) => { setCurrent(before); setError(e instanceof Error ? e.message : "Couldn't save the tag"); });
  };

  const autos = autoTags.filter((a) => a.key !== "a:played" && auto.includes(a.key.slice(2) as AutoKey));

  return (
    <div className="pl-stack">
      <div>
        <div className="pl-label lime">Your tags</div>
        {current.length === 0 ? (
          <div className="pl-hint">No tags yet. Tags are private to you — use them to filter and build lists.</div>
        ) : (
          <div className="pl-chips">
            {current.map((t) => (
              <button key={t} type="button" className="pl-chip tag on" onClick={() => save(current.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
                #{t}<span className="x">✕</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <TagInput palette={palette} exclude={current} onAdd={(label) => save([...current, label])} />
      {error && <div className="pl-note err">{error}</div>}
      {autos.length > 0 && (
        <div>
          <div className="pl-label">Automatic</div>
          <div className="pl-chips">
            {autos.map((a) => <span key={a.key} className="pl-chip small" title={a.hint} style={{ cursor: "default" }}>{a.emoji} {a.label}</span>)}
          </div>
          <div className="pl-hint" style={{ marginTop: 6 }}>Worked out from your games and ratings — they update by themselves.</div>
        </div>
      )}
    </div>
  );
}

// ── Several players ──────────────────────────────────────────────────────────

export function BulkTagSheet({
  open, players, palette, onClose, onDone,
}: {
  open: boolean;
  players: { id: string; name: string; tags: string[] }[];
  palette: TagInfo[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  if (!open) return null;
  return <BulkInner players={players} palette={palette} onClose={onClose} onDone={onDone} />;
}

function BulkInner({ players, palette, onClose, onDone }: {
  players: { id: string; name: string; tags: string[] }[];
  palette: TagInfo[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const present = useMemo(() => {
    const counts = new Map<string, { label: string; n: number }>();
    for (const p of players) for (const t of p.tags) {
      const k = tagKeyOf(t);
      counts.set(k, { label: t, n: (counts.get(k)?.n || 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n);
  }, [players]);

  const toggle = (list: string[], set: (v: string[]) => void, label: string) =>
    set(list.some((x) => tagKeyOf(x) === tagKeyOf(label)) ? list.filter((x) => tagKeyOf(x) !== tagKeyOf(label)) : [...list, label]);

  const apply = async () => {
    setSaving(true); setError(null);
    try {
      const res = await bulkTag({ playerIds: players.map((p) => p.id), add, remove });
      onDone(res.note ? `Tagged ${plural(res.updated, "player")} — ${res.note}` : `Tagged ${plural(res.updated, "player")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't tag them");
      setSaving(false);
    }
  };

  const nothing = add.length === 0 && remove.length === 0;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Tag ${plural(players.length, "player")}`}
      subtitle={players.slice(0, 4).map((p) => p.name).join(", ") + (players.length > 4 ? ` and ${players.length - 4} more` : "")}
      footer={<>
        <div className="grow" />
        <button type="button" className="pl-btn primary" disabled={nothing || saving} onClick={apply}>{saving ? "Saving…" : "Apply"}</button>
      </>}
    >
      <div className="pl-stack">
        <div>
          <div className="pl-label lime">Add</div>
          {add.length > 0 && (
            <div className="pl-chips" style={{ marginBottom: 10 }}>
              {add.map((t) => <button key={t} type="button" className="pl-chip tag on" onClick={() => toggle(add, setAdd, t)}>#{t}<span className="x">✕</span></button>)}
            </div>
          )}
          <TagInput palette={palette} exclude={add} onAdd={(label) => { setAdd((a) => [...a, label]); setRemove((r) => r.filter((x) => tagKeyOf(x) !== tagKeyOf(label))); }} autoFocus={false} />
        </div>
        {present.length > 0 && (
          <div>
            <div className="pl-label">Remove from them</div>
            <div className="pl-chips">
              {present.map((t) => {
                const on = remove.some((x) => tagKeyOf(x) === tagKeyOf(t.label));
                return (
                  <button key={t.label} type="button" className={`pl-chip${on ? " on" : ""}`} style={on ? { borderColor: "rgba(248,113,113,.5)", background: "rgba(248,113,113,.1)", color: "#fecaca" } : undefined}
                    onClick={() => { toggle(remove, setRemove, t.label); setAdd((a) => a.filter((x) => tagKeyOf(x) !== tagKeyOf(t.label))); }}>
                    {on ? "✕ " : ""}#{t.label}<span className="n">{t.n}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {error && <div className="pl-note err">{error}</div>}
      </div>
    </Sheet>
  );
}

// ── Rename / delete ──────────────────────────────────────────────────────────

export function ManageTagsSheet({ open, palette, onClose, onChanged }: {
  open: boolean;
  palette: TagInfo[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doRename = async (label: string) => {
    const to = clean(name);
    if (!to || to === label) { setEditing(null); return; }
    setBusy(true); setError(null);
    try {
      const res = await renameTag(label, to);
      setEditing(null);
      onChanged(res.merged ? `Merged #${label} into #${res.label}` : `Renamed to #${res.label}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't rename"); }
    finally { setBusy(false); }
  };

  const doDelete = async (label: string) => {
    setBusy(true); setError(null);
    try {
      const res = await deleteTag(label);
      setConfirming(null);
      onChanged(res.frozenLists > 0
        ? `Deleted #${label} — ${plural(res.frozenLists, "smart list")} that used it now keep their current players`
        : `Deleted #${label}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete"); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your tags" subtitle="Private labels you put on players. Rename one and every player and smart list follows.">
      {palette.length === 0 ? (
        <div className="pl-empty">
          <div className="big">🏷</div>
          <h3>No tags yet</h3>
          Open any player in a list and type a tag — <b>GK</b>, <b>Friday crew</b>, <b>Brings guests</b>. Then filter and build lists with it.
        </div>
      ) : (
        <div className="pl-stack">
          {error && <div className="pl-note err">{error}</div>}
          <div className="pl-rows">
            {palette.map((t) => (
              <div key={t.key} className="pl-paste-row" style={{ alignItems: "center" }}>
                {editing === t.label ? (
                  <>
                    <input className="pl-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doRename(t.label); if (e.key === "Escape") setEditing(null); }} aria-label="New name" />
                    <button type="button" className="pl-btn lime small" disabled={busy} onClick={() => doRename(t.label)}>Save</button>
                  </>
                ) : confirming === t.label ? (
                  <>
                    <div className="pl-row-main"><div className="pl-row-name"><span>Delete #{t.label}?</span></div><div className="pl-row-sub">Comes off {plural(t.count, "player")}. Lists keep their players.</div></div>
                    <button type="button" className="pl-btn small" onClick={() => setConfirming(null)}>Keep</button>
                    <button type="button" className="pl-btn danger small" disabled={busy} onClick={() => doDelete(t.label)}>Delete</button>
                  </>
                ) : (
                  <>
                    <div className="pl-row-main"><div className="pl-row-name"><span>#{t.label}</span></div><div className="pl-row-sub">{plural(t.count, "player")}</div></div>
                    <button type="button" className="pl-btn small" onClick={() => { setEditing(t.label); setName(t.label); setConfirming(null); }}>Rename</button>
                    <button type="button" className="pl-icon-btn" onClick={() => { setConfirming(t.label); setEditing(null); }} aria-label={`Delete ${t.label}`}>🗑</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

