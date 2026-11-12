"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { leaveSheets } from "@/hooks/useBackToClose";
import { usePlayerBook } from "@/hooks/usePlayerBook";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/playerLists/Avatar";
import { ActionMenu, NewListSheet } from "@/components/playerLists/ListSheets";
import { ManageTagsSheet } from "@/components/playerLists/TagEditors";
import { createList, deleteList, duplicateList, fetchLists, updateList } from "@/utils/playerListsApi";
import { plural, usageLabel, type ListIndex, type ListSummary, type Preset } from "@/utils/playerLists";
import "../../../organizer-dashboard.css";
import "@/components/playerLists/playerLists.css";

// Player Lists — saved groups of players for SOS and invites. Like templates and
// recurring schedules, made once and reused: a list is picked from the SOS and
// invite modals in one tap.

export default function PlayerListsPage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  useAuthGuard({ requiredRole: "organiser", routeUserId: organiserId, redirectTo: "/login?role=organiser" });

  const { toast, showToast, hideToast } = useToast();
  const [index, setIndex] = useState<ListIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<ListSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ListSummary | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const { book, reload: reloadBook } = usePlayerBook(tagsOpen);

  const base = `/dashboard/organizer/${organiserId}/player-lists`;

  const refresh = useCallback(async () => {
    setError(null);
    try { setIndex(await fetchLists()); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load your lists"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const open = (id: string, add = false) => router.push(`${base}/${id}${add ? "?add=1" : ""}`);

  const quickStart = async (p: Preset) => {
    if (p.listId) { open(p.listId); return; }
    setStarting(p.key);
    try {
      const detail = await createList({ preset: p.key });
      open(detail.list._id);
    } catch (e) {
      showToast("error", "Couldn't create the list", e instanceof Error ? e.message : undefined);
      setStarting(null);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteList(confirmDelete._id);
      showToast("success", "List deleted");
      setConfirmDelete(null);
      refresh();
    } catch (e) {
      showToast("error", "Couldn't delete", e instanceof Error ? e.message : undefined);
    }
  };

  const lists = useMemo(() => {
    const all = index?.lists || [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((l) => l.name.toLowerCase().includes(needle)) : all;
  }, [index, q]);

  const presets = (index?.presets || []).filter((p) => p.count > 0);
  const hasLists = (index?.lists.length || 0) > 0;

  return (
    <div className="organizer-dashboard-container pl-page">
      <div className="pl-head">
        <div>
          <h1>Player Lists</h1>
          <p>Save groups of players once — then send an SOS or invites to a whole list in one tap. Lists can fill themselves from tags, venues and who plays regularly.</p>
        </div>
        <div className="pl-head-actions">
          <button type="button" className="pl-btn" onClick={() => setTagsOpen(true)}>🏷 Tags</button>
          <button type="button" className="pl-btn primary" onClick={() => setNewOpen(true)}>+ New list</button>
        </div>
      </div>

      {error && <div className="pl-note err" style={{ marginBottom: 14 }}>{error} <button type="button" className="pl-link" onClick={refresh}>Retry</button></div>}

      {loading ? (
        <div className="pl-empty">Loading your lists…</div>
      ) : index && (
        <>
          {presets.length > 0 && (
            <section style={{ marginBottom: 22 }}>
              <div className="pl-label lime">{hasLists ? "Quick start" : "Start with one tap"}</div>
              <div className="pl-chips scroll">
                {presets.map((p) => (
                  <button key={p.key} type="button" className={`pl-quick${p.listId ? " done" : ""}`} disabled={starting === p.key} onClick={() => quickStart(p)}>
                    <span className="e">{p.emoji}</span>
                    <span className="t">{p.name}</span>
                    <span className="s">{starting === p.key ? "Creating…" : p.listId ? "✓ Open list" : plural(p.count, "player")}</span>
                  </button>
                ))}
              </div>
              <div className="pl-hint" style={{ marginTop: 6 }}>These fill themselves from your games and stay up to date.</div>
            </section>
          )}

          <section>
            <div className="pl-label">
              <span>Your lists {hasLists ? `(${index.lists.length})` : ""}</span>
            </div>
            {index.lists.length > 6 && (
              <div className="pl-search" style={{ marginBottom: 12 }}>
                <input className="pl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a list…" aria-label="Find a list" />
              </div>
            )}

            {!hasLists ? (
              <div className="pl-empty">
                <div className="big">👥</div>
                <h3>No lists yet</h3>
                {index.totals.players > 0
                  ? <>Tap a quick start above, or make your own — pick players, add a whole game, or paste the list you keep on WhatsApp.</>
                  : <>Once people play your games they show up here. You can already build a list by searching KasaKai or pasting numbers.</>}
                <div style={{ marginTop: 14 }}><button type="button" className="pl-btn primary" onClick={() => setNewOpen(true)}>+ New list</button></div>
              </div>
            ) : lists.length === 0 ? (
              <div className="pl-empty">No list called “{q}”.</div>
            ) : (
              <div className="pl-grid">
                {lists.map((l) => (
                  <div key={l._id} role="button" tabIndex={0} className={`pl-card${l.pinned ? " pinned" : ""}`}
                    onClick={() => open(l._id)} onKeyDown={(e) => { if (e.key === "Enter") open(l._id); }}>
                    <span className="pl-card-emoji">{l.emoji}</span>
                    <div className="pl-card-body">
                      <h3 className="pl-card-title">
                        <span>{l.name}</span>
                        {l.smart && <span className="pl-badge" title="Fills itself from its rule">⚡ Auto</span>}
                        {l.pinned && <span title="Pinned">📌</span>}
                      </h3>
                      <div className="pl-card-sub">
                        <b>{plural(l.count, "player")}</b>
                        {l.contacts > 0 && <> · {plural(l.contacts, "contact")}</>}
                        {" · "}{usageLabel(l.usage)}
                      </div>
                      {l.preview.length > 0 && (
                        <div className="pl-faces">
                          {l.preview.map((p) => <Avatar key={p.id} name={p.name} img={p.img} />)}
                          {l.count > l.preview.length && <span className="more">+{l.count - l.preview.length}</span>}
                        </div>
                      )}
                      {l.topTags.length > 0 && (
                        <div className="pl-mini-tags" style={{ marginTop: 8 }}>
                          {l.topTags.map((t) => <span key={t.label} className="pl-mini-tag">#{t.label} {t.count}</span>)}
                        </div>
                      )}
                    </div>
                    <button type="button" className="pl-icon-btn" aria-label={`More for ${l.name}`} onClick={(e) => { e.stopPropagation(); setMenuFor(l); }}>⋯</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <NewListSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(detail, { openPicker }) => {
          leaveSheets();
          setNewOpen(false);
          open(detail.list._id, openPicker);
        }}
      />

      <ManageTagsSheet
        open={tagsOpen}
        palette={book?.tags || []}
        onClose={() => setTagsOpen(false)}
        onChanged={(message) => { showToast("success", message); reloadBook(true); refresh(); }}
      />

      <ActionMenu
        open={!!menuFor}
        title={menuFor ? `${menuFor.emoji} ${menuFor.name}` : ""}
        onClose={() => setMenuFor(null)}
        items={menuFor ? [
          { label: "Open", onClick: () => open(menuFor._id) },
          {
            label: menuFor.pinned ? "Unpin" : "📌 Pin to top",
            hint: menuFor.pinned ? undefined : "Pinned lists come first in SOS and invites",
            onClick: async () => {
              try { await updateList(menuFor._id, { pinned: !menuFor.pinned }); refresh(); }
              catch (e) { showToast("error", "Couldn't update", e instanceof Error ? e.message : undefined); }
            },
          },
          {
            label: "Duplicate",
            onClick: async () => {
              try { const d = await duplicateList(menuFor._id); showToast("success", "Duplicated", d.list.name); refresh(); }
              catch (e) { showToast("error", "Couldn't duplicate", e instanceof Error ? e.message : undefined); }
            },
          },
          { label: "Delete list", danger: true, onClick: () => setConfirmDelete(menuFor) },
        ] : []}
      />

      <ConfirmationModal
        open={!!confirmDelete}
        title="Delete this list?"
        message={confirmDelete ? `"${confirmDelete.name}" will be removed. The players stay on KasaKai and keep their tags.` : ""}
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
    </div>
  );
}
