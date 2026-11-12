"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { Avatar } from "./Avatar";
import { FilterChips } from "./FilterChips";
import { usePlayerBook } from "@/hooks/usePlayerBook";
import { createList } from "@/utils/playerListsApi";
import {
  EMOJI_CHOICES, filterBook, keyCounts, plural, suggestEmoji,
  type ListDetail, type ListRule,
} from "@/utils/playerLists";

// ── Smart-list rule ──────────────────────────────────────────────────────────
//
// A smart list is a saved filter: everyone matching it is on the list, and it
// keeps itself current as people play. The preview count is the filter applied
// to the same rows the server evaluates the rule over, so what is promised here
// is what the list holds.

export function RuleEditor(props: {
  open: boolean;
  initial?: ListRule | null;
  title?: string;
  saveLabel?: string;
  onClose: () => void;
  onSave: (rule: ListRule) => Promise<void> | void;
}) {
  if (!props.open) return null;
  return <RuleInner {...props} />;
}

function RuleInner({ initial, title = "Auto-fill this list", saveLabel = "Save", onClose, onSave }: {
  initial?: ListRule | null;
  title?: string;
  saveLabel?: string;
  onClose: () => void;
  onSave: (rule: ListRule) => Promise<void> | void;
}) {
  const { book, loading } = usePlayerBook(true);
  const [keys, setKeys] = useState<string[]>(initial?.tags || []);
  const [venueIds, setVenueIds] = useState<string[]>(initial?.venues || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = keys.length === 0 && venueIds.length === 0;
  const rows = useMemo(() => book?.rows || [], [book]);
  const matches = useMemo(() => (empty ? [] : filterBook(rows, { keys, venues: venueIds })), [rows, keys, venueIds, empty]);
  const counts = useMemo(() => keyCounts(empty ? rows : matches), [rows, matches, empty]);
  const toggleKey = (k: string) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const toggleVenue = (id: string) => setVenueIds((vs) => (vs.includes(id) ? vs.filter((x) => x !== id) : [...vs, id]));

  const save = async () => {
    if (empty || saving) return;
    setSaving(true); setError(null);
    try { await onSave({ tags: keys, venues: venueIds }); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save"); setSaving(false); }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`⚡ ${title}`}
      subtitle="Everyone who matches is on the list — it updates itself as people play."
      size="lg"
      footer={<>
        <div className="grow pl-hint">{empty ? "Pick at least one" : `Matches ${plural(matches.length, "player")} today`}</div>
        <button type="button" className="pl-btn primary" disabled={empty || saving} onClick={save}>{saving ? "Saving…" : saveLabel}</button>
      </>}
    >
      {loading && !book ? <div className="pl-empty">Loading your players…</div> : book && (
        <div className="pl-stack">
          <div>
            <div className="pl-label">Who</div>
            <FilterChips autoTags={book.autoTags} keys={keys} venueIds={[]} counts={counts} onToggleKey={toggleKey} scroll={false} />
          </div>
          <div>
            <div className="pl-label">Your tags</div>
            {book.tags.length === 0
              ? <div className="pl-hint">Tag players (open anyone in a list) to fill lists by your own labels — #GK, #Friday crew.</div>
              : <FilterChips tags={book.tags} keys={keys} venueIds={[]} counts={counts} onToggleKey={toggleKey} scroll={false} />}
          </div>
          {book.venues.length > 0 && (
            <div>
              <div className="pl-label">Played at <span className="pl-hint" style={{ textTransform: "none", letterSpacing: 0 }}>any of these</span></div>
              <FilterChips venues={book.venues} keys={[]} venueIds={venueIds} counts={counts} onToggleKey={() => {}} onToggleVenue={toggleVenue} scroll={false} />
            </div>
          )}
          {keys.length > 1 && <div className="pl-hint">Players need <b>every</b> tag you pick — two tags narrow the list.</div>}
          {!empty && (
            <div>
              <div className="pl-label lime">Matches today ({matches.length})</div>
              {matches.length === 0 ? (
                <div className="pl-note warn">Nobody matches right now. The list will fill as players start to.</div>
              ) : (
                <div className="pl-note">
                  <div className="pl-faces" style={{ marginTop: 0, marginBottom: 8 }}>
                    {matches.slice(0, 10).map((r) => <Avatar key={r.id} name={r.name} img={r.img} />)}
                    {matches.length > 10 && <span className="more">+{matches.length - 10}</span>}
                  </div>
                  {matches.slice(0, 8).map((r) => r.name.split(" ")[0]).join(", ")}{matches.length > 8 ? ` and ${matches.length - 8} more` : ""}
                </div>
              )}
            </div>
          )}
          {error && <div className="pl-note err">{error}</div>}
        </div>
      )}
    </Sheet>
  );
}

// ── Name + emoji ─────────────────────────────────────────────────────────────

function NameFields({ name, setName, emoji, setEmoji, autoFocus }: {
  name: string; setName: (v: string) => void; emoji: string; setEmoji: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <>
      <div className="pl-emojis" role="radiogroup" aria-label="List icon">
        {EMOJI_CHOICES.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={emoji === e} className={`pl-emoji${emoji === e ? " on" : ""}`} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <input className="pl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
        placeholder="e.g. Tuesday crew, Office team, Keepers" autoFocus={autoFocus} enterKeyHint="next" aria-label="List name" />
    </>
  );
}

// Desktop gets the cursor in the name box; a phone keeps its keyboard down
// until the organiser taps, so the choices below are not hidden behind it.
const finePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

// ── New list ─────────────────────────────────────────────────────────────────

export function NewListSheet(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: ListDetail, opts: { openPicker: boolean }) => void;
}) {
  if (!props.open) return null;
  return <NewListInner {...props} />;
}

function NewListInner({ onClose, onCreated }: { onClose: () => void; onCreated: (detail: ListDetail, opts: { openPicker: boolean }) => void }) {
  const [name, setNameRaw] = useState("");
  const [emoji, setEmojiRaw] = useState("👥");
  const [emojiTouched, setEmojiTouched] = useState(false);
  const [mode, setMode] = useState<"pick" | "auto">("pick");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The icon follows the name ("Keepers" → 🧤) until the organiser picks one.
  const setName = (v: string) => { setNameRaw(v); if (!emojiTouched) setEmojiRaw(suggestEmoji(v)); };
  const setEmoji = (v: string) => { setEmojiRaw(v); setEmojiTouched(true); };

  const create = async (rule?: ListRule) => {
    setSaving(true); setError(null);
    try {
      const detail = await createList({ name: name.trim(), emoji, ...(rule ? { rule } : {}) });
      onCreated(detail, { openPicker: !rule });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the list");
      setSaving(false);
      throw e;
    }
  };

  const ready = name.trim().length > 0;
  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="New list"
        size="sm"
        footer={<>
          <div className="grow" />
          <button type="button" className="pl-btn primary" disabled={!ready || saving}
            onClick={() => (mode === "auto" ? setRulesOpen(true) : create().catch(() => {}))}>
            {saving ? "Creating…" : mode === "auto" ? "Choose who →" : "Create & add players →"}
          </button>
        </>}
      >
        <div className="pl-stack">
          <NameFields name={name} setName={setName} emoji={emoji} setEmoji={setEmoji} autoFocus={finePointer()} />
          <div>
            <div className="pl-label">How should it fill?</div>
            <div className="pl-stack" style={{ marginTop: 0 }}>
              <button type="button" className={`pl-choice${mode === "pick" ? " on" : ""}`} onClick={() => setMode("pick")}>
                <span className={`pl-check${mode === "pick" ? " on" : ""}`}>{mode === "pick" ? "✓" : ""}</span>
                <span><b>I&apos;ll pick the players</b><small>From your players, a past game, or a list pasted from WhatsApp.</small></span>
              </button>
              <button type="button" className={`pl-choice${mode === "auto" ? " on" : ""}`} onClick={() => setMode("auto")}>
                <span className={`pl-check${mode === "auto" ? " on" : ""}`}>{mode === "auto" ? "✓" : ""}</span>
                <span><b>⚡ Fill it automatically</b><small>Regulars, keepers, a venue, your tags — and it stays up to date.</small></span>
              </button>
            </div>
          </div>
          {error && <div className="pl-note err">{error}</div>}
        </div>
      </Sheet>
      <RuleEditor
        open={rulesOpen}
        title={`Who goes in “${name.trim() || "this list"}”?`}
        saveLabel="Create list"
        onClose={() => setRulesOpen(false)}
        onSave={(rule) => create(rule)}
      />
    </>
  );
}

// ── Rename ───────────────────────────────────────────────────────────────────

export function ListDetailsSheet(props: {
  open: boolean;
  name: string;
  emoji: string;
  onClose: () => void;
  onSave: (v: { name: string; emoji: string }) => Promise<void>;
}) {
  if (!props.open) return null;
  return <DetailsInner {...props} />;
}

function DetailsInner({ name: n0, emoji: e0, onClose, onSave }: { name: string; emoji: string; onClose: () => void; onSave: (v: { name: string; emoji: string }) => Promise<void> }) {
  const [name, setName] = useState(n0);
  const [emoji, setEmoji] = useState(e0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await onSave({ name: name.trim(), emoji }); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save"); setSaving(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Rename list" size="sm"
      footer={<><div className="grow" /><button type="button" className="pl-btn primary" disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></>}>
      <div className="pl-stack">
        <NameFields name={name} setName={setName} emoji={emoji} setEmoji={setEmoji} autoFocus={finePointer()} />
        {error && <div className="pl-note err">{error}</div>}
      </div>
    </Sheet>
  );
}

// ── ⋯ menu ───────────────────────────────────────────────────────────────────

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; hint?: string }

export function ActionMenu({ open, title, items, onClose }: { open: boolean; title: string; items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm">
      <div className="pl-menu">
        {items.map((it) => (
          <button key={it.label} type="button" className={`pl-btn${it.danger ? " danger" : ""}`} onClick={() => { onClose(); it.onClick(); }}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              {it.label}
              {it.hint && <span className="pl-hint" style={{ fontWeight: 500 }}>{it.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
