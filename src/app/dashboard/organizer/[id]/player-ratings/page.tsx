"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { resolveImageUrl } from "@/utils/api";
import { StarRating } from "@/components/ui/StarRating";
import { PlayerMultiSelect, type PlayerOption } from "@/components/ui/PlayerMultiSelect";
import { Toast, useToast } from "@/components/ui/Toast";
import {
  fetchRoster,
  saveRating,
  type RatingPatch,
  type RosterQuery,
  type RosterRow,
  type StandingRating,
} from "@/utils/playerRatings";
import "../../../organizer-dashboard.css";
import "./player-ratings.css";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

type Scope = "mine" | "all";
type Filter = "all" | "rated" | "unrated";

// The editable state of one row. Mirrors StandingRating, but flat — a table cell
// binds to a field, not to a nested object.
interface Draft {
  gameplayRating: number | null;
  conductRating: number | null;
  gkAffinity: number | null;
  playWith: PlayerOption[];
  playAgainst: PlayerOption[];
}

const draftFrom = (rating: StandingRating | null): Draft => ({
  gameplayRating: rating?.gameplayRating ?? null,
  conductRating: rating?.conductRating ?? null,
  gkAffinity: rating?.gkAffinity ?? null,
  playWith: rating?.playWith ?? [],
  playAgainst: rating?.playAgainst ?? [],
});

const sameIds = (a: PlayerOption[], b: PlayerOption[]) =>
  a.length === b.length
  && a.map((x) => x.id).sort().join() === b.map((x) => x.id).sort().join();

const isDirty = (draft: Draft, rating: StandingRating | null) => {
  const base = draftFrom(rating);
  return draft.gameplayRating !== base.gameplayRating
    || draft.conductRating !== base.conductRating
    || draft.gkAffinity !== base.gkAffinity
    || !sameIds(draft.playWith, base.playWith)
    || !sameIds(draft.playAgainst, base.playAgainst);
};

function PlayerAvatar({ name, profileImage }: { name: string; profileImage: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || "P").substring(0, 2).toUpperCase();

  if (profileImage && !failed) {
    return (
      <span className="pr-avatar pr-avatar-img">
        <img src={resolveImageUrl(profileImage)} alt={name} onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="pr-avatar">{initials}</span>;
}

export default function PlayerRatingsPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });

  const { toast, showToast, hideToast } = useToast();

  const [rows, setRows] = useState<RosterRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("mine");
  const [filter, setFilter] = useState<Filter>("all");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Debounce the box, not the request — the request is driven off `query`, so a
  // scope or filter change fires immediately while typing still waits.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Searching the whole platform needs something to search for; the backend
  // rejects a bare "give me every player" for the same reason.
  const needsQuery = scope === "all" && query.length < 2;

  // Every in-flight load writes to the same state, so a slow page-1 landing
  // after a fast page-2 would clobber it. Only the newest request may write.
  const requestSeq = useRef(0);

  const load = useCallback(async (opts: { page: number; append: boolean }) => {
    const seq = ++requestSeq.current;
    if (opts.append) setLoadingMore(true); else setLoading(true);
    setError(null);

    const params: RosterQuery = {
      scope,
      filter,
      page: opts.page,
      limit: PAGE_SIZE,
      ...(query ? { q: query } : {}),
    };

    try {
      const data = await fetchRoster(params);
      if (seq !== requestSeq.current) return;

      setRows((prev) => (opts.append ? [...prev, ...data.rows] : data.rows));
      setDrafts((prev) => {
        const next = opts.append ? { ...prev } : {};
        for (const row of data.rows) next[row.playerId] = draftFrom(row.rating);
        return next;
      });
      setTotal(data.total);
      setHasMore(data.hasMore);
      setPage(data.page);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : "Could not load players");
      if (!opts.append) setRows([]);
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [scope, filter, query]);

  useEffect(() => {
    if (!isAuthorized) { setLoading(false); return; }
    if (needsQuery) {
      setRows([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    load({ page: 1, append: false });
  }, [isAuthorized, needsQuery, load]);

  const updateDraft = (playerId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [playerId]: { ...prev[playerId], ...patch } }));
  };

  const togglePick = (playerId: string, field: "playWith" | "playAgainst", option: PlayerOption) => {
    setDrafts((prev) => {
      const current = prev[playerId];
      const list = current[field];
      const next = list.some((p) => p.id === option.id)
        ? list.filter((p) => p.id !== option.id)
        : [...list, option];
      return { ...prev, [playerId]: { ...current, [field]: next } };
    });
  };

  const handleSave = async (row: RosterRow) => {
    const draft = drafts[row.playerId];
    if (!draft) return;

    setSavingIds((prev) => ({ ...prev, [row.playerId]: true }));
    try {
      // Send the whole draft rather than a diff: an explicit null is how a star
      // gets cleared back to NA, and a diff would drop exactly that.
      const patch: RatingPatch = {
        gameplayRating: draft.gameplayRating,
        conductRating: draft.conductRating,
        gkAffinity: draft.gkAffinity,
        playWith: draft.playWith.map((p) => p.id),
        playAgainst: draft.playAgainst.map((p) => p.id),
      };
      const saved = await saveRating(row.playerId, patch);

      setRows((prev) => prev.map((r) => (
        r.playerId === row.playerId ? { ...r, rating: saved.rating } : r
      )));
      setDrafts((prev) => ({ ...prev, [row.playerId]: draftFrom(saved.rating) }));
      showToast("success", "Ratings saved", row.name);
    } catch (err) {
      showToast("error", "Couldn't save ratings", err instanceof Error ? err.message : undefined);
    } finally {
      setSavingIds((prev) => ({ ...prev, [row.playerId]: false }));
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setScope("mine");
    setFilter("all");
  };

  const filtersActive = query.length > 0 || scope !== "mine" || filter !== "all";

  const summary = useMemo(() => {
    const rated = rows.filter((r) => r.rating).length;
    return { rated, shown: rows.length };
  }, [rows]);

  // The players already on screen, offered as the pairing menu's opening
  // suggestions. Almost every pairing is between two of your own regulars, so
  // this is free and saves a search in the common case — anyone further afield
  // is still one keystroke away.
  const pairSuggestions: PlayerOption[] = useMemo(
    () => rows.map((r) => ({ id: r.playerId, name: r.name })),
    [rows]
  );

  if (!isAuthorized) return null;

  return (
    <div className="organizer-dashboard-container">
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Player Ratings</h1>
          <p className="dashboard-subtitle">
            One standing rating per player — what you think of them now, not a score for one night.
            Change it whenever you like; only you can see your ratings.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-search-wrap">
          <svg className="filter-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="filter-search-input"
            placeholder={scope === "all" ? "Search every player by name, phone or email…" : "Search your players…"}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button className="filter-search-clear" onClick={() => setSearchInput("")} title="Clear search">✕</button>
          )}
        </div>

        <select className="filter-select" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="mine">My players</option>
          <option value="all">All players</option>
        </select>

        <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Rated &amp; unrated</option>
          <option value="rated">Rated only</option>
          <option value="unrated">Unrated only</option>
        </select>

        {filtersActive && (
          <button className="filter-clear-btn" onClick={clearFilters}>Clear</button>
        )}

        {!loading && !needsQuery && (
          <span className="filter-result-count">
            {summary.shown} / {total} player{total === 1 ? "" : "s"} · {summary.rated} rated
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading players…</p></div>
      ) : error ? (
        <div className="pr-error">
          <p>{error}</p>
          <button className="btn-primary" onClick={() => load({ page: 1, append: false })}>Retry</button>
        </div>
      ) : needsQuery ? (
        <div className="empty-state">
          <div className="empty-icon">🔎</div>
          <h3>Search for a player</h3>
          <p>Type at least two characters to find anyone on the platform, then rate them.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⭐</div>
          <h3>{filtersActive ? "No players match" : "No players yet"}</h3>
          <p>
            {filtersActive
              ? "Nothing here fits those filters. Try widening the search."
              : "Once players join your games they show up here, ready to rate."}
          </p>
          {filtersActive && <button className="btn-primary" onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          <div className="pr-table-container">
            <table className="pr-table">
              <thead>
                <tr>
                  <th className="pr-col-player">Player</th>
                  <th>Skill</th>
                  <th>Conduct</th>
                  <th>GK Affinity</th>
                  <th>Play With</th>
                  <th>Play Against</th>
                  <th aria-label="Save" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = drafts[row.playerId];
                  if (!draft) return null;
                  const dirty = isDirty(draft, row.rating);
                  const saving = !!savingIds[row.playerId];

                  return (
                    <tr key={row.playerId} className={dirty ? "pr-row-dirty" : ""}>
                      <td className="pr-col-player">
                        <div className="pr-player-cell">
                          <PlayerAvatar name={row.name} profileImage={row.profileImage} />
                          <div className="pr-player-meta">
                            <span className="pr-player-name">{row.name}</span>
                            <span className="pr-player-sub">
                              {row.gamesWithYou > 0
                                ? `${row.gamesWithYou} game${row.gamesWithYou === 1 ? "" : "s"} with you`
                                : "Not played with you"}
                              {row.declaredGk && <span className="pr-gk-tag" title="Picked goalkeeper at signup">GK</span>}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <StarRating
                          size="mini"
                          disabled={saving}
                          value={draft.gameplayRating}
                          onChange={(v) => updateDraft(row.playerId, { gameplayRating: v })}
                        />
                        <span className="pr-cell-note">{draft.gameplayRating == null ? "NA" : `${draft.gameplayRating}/5`}</span>
                      </td>

                      <td>
                        <StarRating
                          size="mini"
                          disabled={saving}
                          value={draft.conductRating}
                          onChange={(v) => updateDraft(row.playerId, { conductRating: v })}
                        />
                        <span className="pr-cell-note">{draft.conductRating == null ? "NA" : `${draft.conductRating}/5`}</span>
                      </td>

                      <td>
                        <select
                          className="pr-select"
                          disabled={saving}
                          value={draft.gkAffinity == null ? "na" : String(draft.gkAffinity)}
                          onChange={(e) => updateDraft(row.playerId, {
                            gkAffinity: e.target.value === "na" ? null : Number(e.target.value),
                          })}
                        >
                          <option value="na">NA</option>
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>

                      <td className="pr-col-picker">
                        <PlayerMultiSelect
                          variant="with"
                          remoteSearch
                          disabled={saving}
                          suggestions={pairSuggestions}
                          selected={draft.playWith}
                          excludeIds={[row.playerId, ...draft.playAgainst.map((p) => p.id)]}
                          onToggle={(opt) => togglePick(row.playerId, "playWith", opt)}
                        />
                      </td>

                      <td className="pr-col-picker">
                        <PlayerMultiSelect
                          variant="against"
                          remoteSearch
                          disabled={saving}
                          suggestions={pairSuggestions}
                          selected={draft.playAgainst}
                          excludeIds={[row.playerId, ...draft.playWith.map((p) => p.id)]}
                          onToggle={(opt) => togglePick(row.playerId, "playAgainst", opt)}
                        />
                      </td>

                      <td>
                        <button
                          className="pr-save-btn"
                          disabled={!dirty || saving}
                          onClick={() => handleSave(row)}
                        >
                          {saving ? "Saving…" : "Save Ratings"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="pr-load-more">
              <button
                className="btn-primary"
                disabled={loadingMore}
                onClick={() => load({ page: page + 1, append: true })}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      {toast && (
        <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />
      )}
    </div>
  );
}
