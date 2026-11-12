"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { usePlayerBook } from "@/hooks/usePlayerBook";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/playerLists/Avatar";
import { Sheet } from "@/components/playerLists/Sheet";
import { FilterChips } from "@/components/playerLists/FilterChips";
import { PlayerPicker } from "@/components/playerLists/PlayerPicker";
import { ActionMenu, ListDetailsSheet, RuleEditor, type MenuItem } from "@/components/playerLists/ListSheets";
import { BulkTagSheet, PlayerTagsSection } from "@/components/playerLists/TagEditors";
import { addMembers, deleteList, duplicateList, fetchList, removeMembers, updateList } from "@/utils/playerListsApi";
import {
  describeRule, lastPlayedLabel, plural, rowKeys, searchMatches, usageLabel,
  type Contact, type ListDetail, type ListRule, type MemberRow, type TagInfo,
} from "@/utils/playerLists";
import "../../../../organizer-dashboard.css";
import "@/components/playerLists/playerLists.css";

const PAGE = 100;

const memberMatches = (m: MemberRow, q: string, keys: string[]) => {
  if (keys.length) {
    const have = rowKeys(m);
    if (!keys.every((k) => have.has(k))) return false;
  }
  return searchMatches(m, q);
};

export default function PlayerListPage() {
  const router = useRouter();
  const params = useParams<{ id?: string | string[]; listId?: string | string[] }>();
  const organiserId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const listId = (Array.isArray(params?.listId) ? params.listId[0] : params?.listId) || "";
  useAuthGuard({ requiredRole: "organiser", routeUserId: organiserId, redirectTo: "/login?role=organiser" });
  const base = `/dashboard/organizer/${organiserId}/player-lists`;

  const { toast, showToast, hideToast } = useToast();
  const { book, patchRows } = usePlayerBook(true);
  const [palette, setPalette] = useState<TagInfo[] | null>(null);
  const tags = palette || book?.tags || [];

  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [shownFor, setShownFor] = useState({ key: "", n: PAGE });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Arriving from "Create & add players" lands with the picker already open.
  // Read through the router, not window.location: on a client-side navigation
  // the address bar still shows the PREVIOUS page while this one first renders.
  const searchParams = useSearchParams();
  const [pickerOpen, setPickerOpen] = useState(() => searchParams?.get("add") === "1");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [member, setMember] = useState<MemberRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<{ text: string; playerIds: string[]; contacts: Contact[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drop ?add=1 once read, so a refresh does not reopen the picker.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("add")) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setDetail(await fetchList(listId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load the list"); }
    finally { setLoading(false); }
  }, [listId]);

  useEffect(() => { if (listId) load(); }, [listId, load]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const list = detail?.list;
  const members = useMemo(() => detail?.members || [], [detail]);
  const filtered = useMemo(() => members.filter((m) => memberMatches(m, q, keys)), [members, q, keys]);

  const countsAll = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of members) for (const k of rowKeys(m)) c.set(k, (c.get(k) || 0) + 1);
    return c;
  }, [members]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of filtered) for (const k of rowKeys(m)) c.set(k, (c.get(k) || 0) + 1);
    return c;
  }, [filtered]);

  const filterKey = `${q}|${keys.join(",")}`;
  const shown = shownFor.key === filterKey ? shownFor.n : PAGE;
  const already = useMemo(() => new Set(members.map((m) => m.key)), [members]);

  const ruleText = list?.rule && book ? describeRule(list.rule, { tags, autoTags: book.autoTags, venues: book.venues }) : "";
  const ruleUsesTags = !!list?.rule?.tags.some((k) => k.startsWith("t:"));

  // ── Actions ────────────────────────────────────────────────────────────
  const fail = (title: string) => (e: unknown) => showToast("error", title, e instanceof Error ? e.message : undefined);

  const patch = async (body: Parameters<typeof updateList>[1], ok?: string) => {
    try {
      const d = await updateList(listId, body);
      setDetail(d);
      if (ok) showToast("success", ok);
    } catch (e) { fail("Couldn't update the list")(e); throw e; }
  };

  const remove = async (rows: MemberRow[]) => {
    if (rows.length === 0) return;
    const playerIds = rows.filter((m) => m.playerId).map((m) => m.playerId as string);
    const contacts = rows.filter((m) => m.contact && m.contactPhone).map((m) => ({ name: m.name, phone: m.contactPhone as string }));
    try {
      const d = await removeMembers(listId, { playerIds, phones: contacts.map((c) => c.phone) });
      setDetail(d);
      setSelected(new Set());
      setSelecting(false);
      setMember(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ text: rows.length === 1 ? `Removed ${rows[0].name}` : `Removed ${plural(rows.length, "player")}`, playerIds, contacts });
      undoTimer.current = setTimeout(() => setUndo(null), 7000);
    } catch (e) { fail("Couldn't remove")(e); }
  };

  const doUndo = async () => {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    try { setDetail(await addMembers(listId, { playerIds: u.playerIds, contacts: u.contacts, via: "manual" })); }
    catch (e) { fail("Couldn't undo")(e); }
  };

  const onTagsSaved = (playerId: string, next: string[], nextPalette: TagInfo[]) => {
    setPalette(nextPalette);
    patchRows((r) => (r.id === playerId ? { ...r, tags: next } : r));
    setDetail((d) => (d ? { ...d, members: d.members.map((m) => (m.playerId === playerId ? { ...m, tags: next } : m)) } : d));
    setMember((m) => (m && m.playerId === playerId ? { ...m, tags: next } : m));
  };

  const toggleSel = (key: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.key));
  const selectedRows = members.filter((m) => selected.has(m.key));
  const selectedPlayers = selectedRows.filter((m) => m.playerId);

  const menuItems: MenuItem[] = list ? [
    { label: "✎ Rename", onClick: () => setRenameOpen(true) },
    {
      label: list.pinned ? "Unpin" : "📌 Pin to top",
      hint: list.pinned ? undefined : "Pinned lists come first in SOS and invites",
      onClick: () => { patch({ pinned: !list.pinned }, list.pinned ? "Unpinned" : "Pinned").catch(() => {}); },
    },
    list.smart
      ? { label: "Stop auto-filling", hint: `Keeps today's ${plural(list.count, "player")} as a fixed list`, onClick: () => { patch({ freeze: true }, "Now a fixed list").catch(() => {}); } }
      : { label: "⚡ Auto-fill from tags", hint: "Add everyone matching tags or a venue, and keep it current", onClick: () => setRuleOpen(true) },
    {
      label: "Duplicate",
      onClick: async () => {
        try { const d = await duplicateList(listId); router.push(`${base}/${d.list._id}`); }
        catch (e) { fail("Couldn't duplicate")(e); }
      },
    },
    { label: "Delete list", danger: true, onClick: () => setConfirmDelete(true) },
  ] : [];

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) return <div className="organizer-dashboard-container pl-page"><div className="pl-empty">Loading list…</div></div>;
  if (error || !detail || !list) {
    return (
      <div className="organizer-dashboard-container pl-page">
        <button type="button" className="pl-back" onClick={() => router.push(base)}>← All lists</button>
        <div className="pl-note err">{error || "List not found"} <button type="button" className="pl-link" onClick={load}>Retry</button></div>
      </div>
    );
  }

  return (
    <div className="organizer-dashboard-container pl-page">
      <button type="button" className="pl-back" onClick={() => router.push(base)}>← All lists</button>

      <div className="pl-head inline" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <button type="button" className="pl-card-emoji" style={{ cursor: "pointer" }} onClick={() => setRenameOpen(true)} aria-label="Change icon or name">{list.emoji}</button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setRenameOpen(true)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{list.name}</span>
              {list.pinned && <span title="Pinned" style={{ fontSize: 16 }}>📌</span>}
            </h1>
            <p>
              <b style={{ color: "#ddd" }}>{plural(list.count, "player")}</b>
              {list.contacts > 0 && <> · {plural(list.contacts, "contact")}</>}
              {" · "}{usageLabel(list.usage)}
            </p>
          </div>
        </div>
        <div className="pl-head-actions" style={{ width: "auto" }}>
          <button type="button" className="pl-icon-btn" style={{ border: "1px solid #2c2c2c" }} onClick={() => setMenuOpen(true)} aria-label="List options">⋯</button>
        </div>
      </div>

      {list.smart && (
        <div className="pl-note ok" style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: "#ecfccb" }}>Fills itself:</b> {ruleText || "…"}
            <div className="pl-hint" style={{ color: "#a3b18a", marginTop: 2 }}>
              {plural(list.fromRule, "player")} from the rule{list.count - list.fromRule > 0 ? `, ${list.count - list.fromRule} added by hand` : ""}. People join and leave as they play.
            </div>
            {detail.excluded.length > 0 && (
              <div className="pl-hint" style={{ marginTop: 4 }}>
                {plural(detail.excluded.length, "person", "people")} you removed stay off ({detail.excluded.slice(0, 3).map((x) => x.name.split(" ")[0]).join(", ")}{detail.excluded.length > 3 ? "…" : ""}) ·{" "}
                <button type="button" className="pl-link" onClick={() => patch({ restore: true }, "Restored").catch(() => {})}>Restore</button>
              </div>
            )}
          </div>
          <button type="button" className="pl-btn small lime" onClick={() => setRuleOpen(true)}>Edit</button>
        </div>
      )}

      {members.length > 0 && (
        <div className="pl-stack" style={{ marginBottom: 12 }}>
          {members.length > 8 && (
            <div className="pl-search">
              <input className="pl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${plural(members.length, "player")}…`} aria-label="Search this list" />
              {q && <button type="button" className="pl-icon-btn pl-search-clear" onClick={() => setQ("")} aria-label="Clear search">✕</button>}
            </div>
          )}
          {book && (
            <FilterChips
              autoTags={book.autoTags.filter((a) => a.key !== "a:played" && countsAll.has(a.key))}
              tags={tags.filter((t) => countsAll.has(t.key))}
              keys={keys}
              venueIds={[]}
              counts={counts}
              onToggleKey={(k) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
            />
          )}
        </div>
      )}

      {members.length === 0 ? (
        <div className="pl-empty">
          <div className="big">{list.emoji}</div>
          <h3>{list.smart ? "Nobody matches yet" : "No players yet"}</h3>
          {list.smart
            ? <>This list fills itself as players start matching its rule. You can also add people by hand.</>
            : <>Add players you know, everyone from a past game, or paste the list you keep on WhatsApp.</>}
          <div style={{ marginTop: 14 }}><button type="button" className="pl-btn primary" onClick={() => setPickerOpen(true)}>+ Add players</button></div>
        </div>
      ) : (
        <>
          <div className="pl-label">
            <span>{q || keys.length ? `${plural(filtered.length, "match", "matches")}` : "Players"}</span>
            {selecting && filtered.length > 0 && (
              <button type="button" className="pl-link" onClick={() => setSelected((s) => {
                const next = new Set(s);
                for (const m of filtered) { if (allFilteredSelected) next.delete(m.key); else next.add(m.key); }
                return next;
              })}>
                {allFilteredSelected ? "Unselect all" : `Select all ${filtered.length}`}
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="pl-empty">No one here matches. <button type="button" className="pl-link" onClick={() => { setQ(""); setKeys([]); }}>Clear</button></div>
          ) : (
            <div className="pl-rows">
              {filtered.slice(0, shown).map((m) => {
                const on = selected.has(m.key);
                const sub = m.contact
                  ? `Not on KasaKai · ${m.phone} · invites only`
                  : [m.games ? `${plural(m.games, "game")} with you` : "Hasn't played with you yet", lastPlayedLabel(m.lastAt), m.upcoming ? `${m.upcoming} booked` : "", m.phone].filter(Boolean).join(" · ");
                return (
                  <button key={m.key} type="button" className={`pl-row${on ? " picked" : ""}`} onClick={() => (selecting ? toggleSel(m.key) : setMember(m))} aria-pressed={selecting ? on : undefined}>
                    {selecting && <span className={`pl-check${on ? " on" : ""}`}>{on ? "✓" : ""}</span>}
                    <Avatar name={m.name} img={m.img} contact={m.contact} />
                    <span className="pl-row-main">
                      <span className="pl-row-name">
                        <span>{m.name}</span>
                        {m.auto.includes("gk") && <span title="Goalkeeper">🧤</span>}
                        {m.auto.includes("regular") && <span title="Regular">🔥</span>}
                        {m.auto.includes("new") && <span title="New">🆕</span>}
                      </span>
                      <span className="pl-row-sub">{sub}</span>
                      {m.tags.length > 0 && <span className="pl-mini-tags">{m.tags.map((t) => <span key={t} className="pl-mini-tag">#{t}</span>)}</span>}
                    </span>
                    {m.source === "rule" && <span className="pl-row-side" title="On this list because it matches the auto-fill rule">⚡</span>}
                  </button>
                );
              })}
              {filtered.length > shown && (
                <button type="button" className="pl-more-btn" onClick={() => setShownFor({ key: filterKey, n: shown + PAGE })}>
                  Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* The thumb zone: what you do next is always at the bottom of the screen. */}
      <div className="pl-dock">
        {undo ? (
          <>
            <span className="count" style={{ flex: 1 }}>{undo.text}</span>
            <button type="button" className="pl-btn lime" style={{ flex: "0 0 auto" }} onClick={doUndo}>Undo</button>
          </>
        ) : selecting ? (
          <>
            <span className="count">{selected.size} picked</span>
            <button type="button" className="pl-btn" disabled={selectedPlayers.length === 0} onClick={() => setBulkOpen(true)}>🏷 Tag</button>
            <button type="button" className="pl-btn danger" disabled={selected.size === 0} onClick={() => remove(selectedRows)}>Remove</button>
            <button type="button" className="pl-btn ghost" style={{ flex: "0 0 auto" }} onClick={() => { setSelecting(false); setSelected(new Set()); }}>Done</button>
          </>
        ) : (
          <>
            <button type="button" className="pl-btn primary" onClick={() => setPickerOpen(true)}>+ Add players</button>
            {members.length > 0 && <button type="button" className="pl-btn" style={{ flex: "0 0 auto" }} onClick={() => setSelecting(true)}>Select</button>}
          </>
        )}
      </div>

      <div className="pl-hint" style={{ textAlign: "center", marginTop: 4 }}>
        Use this list from any game&apos;s <b>📣 SOS</b> or <b>✉️ Invite</b> — it shows up under “From your lists”.
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      <PlayerPicker
        open={pickerOpen}
        title={`Add to ${list.emoji} ${list.name}`}
        subtitle="Tap players to pick them. Filters narrow the list — then Select all."
        already={already}
        onClose={() => setPickerOpen(false)}
        onConfirm={async ({ playerIds, contacts, via }) => {
          const d = await addMembers(listId, { playerIds, contacts, via });
          setDetail(d);
          setPickerOpen(false);
          const r = d.result || {};
          showToast("success", `Added ${plural(r.added || 0, "player")}`, r.overLimit ? `${r.overLimit} didn't fit — a list holds ${book?.limits.membersPerList ?? 500}` : undefined);
        }}
      />

      <RuleEditor
        open={ruleOpen}
        initial={list.rule}
        title={list.smart ? "Edit auto-fill" : "Auto-fill this list"}
        saveLabel={list.smart ? "Save" : "Turn on auto-fill"}
        onClose={() => setRuleOpen(false)}
        onSave={async (rule: ListRule) => { await patch({ rule }, list.smart ? "Auto-fill updated" : "Auto-fill on"); setRuleOpen(false); }}
      />

      <Sheet
        open={!!member}
        onClose={() => setMember(null)}
        title={member ? member.name : ""}
        subtitle={member ? (member.contact
          ? `Not on KasaKai · ${member.phone}`
          : [member.games ? `${plural(member.games, "game")} with you` : "Hasn't played with you yet", lastPlayedLabel(member.lastAt), member.phone].filter(Boolean).join(" · ")) : undefined}
        footer={member ? (
          <button type="button" className="pl-btn danger block" onClick={() => remove([member])}>Remove from list</button>
        ) : undefined}
      >
        {member && (
          member.contact ? (
            <div className="pl-note">
              Invites reach {member.name.split(" ")[0]} on WhatsApp; an SOS can’t, because it needs a KasaKai account. When they sign up with this number they’re linked to it automatically.
            </div>
          ) : (
            <div className="pl-stack">
              {member.source === "rule" && <div className="pl-hint">⚡ On this list because they match its auto-fill rule. Removing them keeps them off it.</div>}
              {book && (
                <PlayerTagsSection
                  key={member.playerId as string}
                  playerId={member.playerId as string}
                  tags={member.tags}
                  auto={member.auto}
                  palette={tags}
                  autoTags={book.autoTags}
                  onSaved={(next, nextPalette) => {
                    onTagsSaved(member.playerId as string, next, nextPalette);
                    if (list.smart && ruleUsesTags) load();
                  }}
                />
              )}
            </div>
          )
        )}
      </Sheet>

      <BulkTagSheet
        open={bulkOpen}
        players={selectedPlayers.map((m) => ({ id: m.playerId as string, name: m.name, tags: m.tags }))}
        palette={tags}
        onClose={() => setBulkOpen(false)}
        onDone={(message) => {
          setBulkOpen(false);
          setSelecting(false);
          setSelected(new Set());
          setPalette(null);
          showToast("success", message);
          load();
        }}
      />

      <ListDetailsSheet
        open={renameOpen}
        name={list.name}
        emoji={list.emoji}
        onClose={() => setRenameOpen(false)}
        onSave={async (v) => { await patch(v, "Saved"); setRenameOpen(false); }}
      />

      <ActionMenu open={menuOpen} title={`${list.emoji} ${list.name}`} items={menuItems} onClose={() => setMenuOpen(false)} />

      <ConfirmationModal
        open={confirmDelete}
        title="Delete this list?"
        message={`"${list.name}" will be removed. The players stay on KasaKai and keep their tags.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={async () => {
          try { await deleteList(listId); router.push(base); }
          catch (e) { fail("Couldn't delete")(e); setConfirmDelete(false); }
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
    </div>
  );
}
