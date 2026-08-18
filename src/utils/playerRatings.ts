import { buildApiUrl, getSession } from "@/utils/api";

// ── Types ────────────────────────────────────────────────────────────────────
//
// `null` is load-bearing throughout: it means NA — this organiser has not
// recorded an opinion — which the backend stores as null rather than a number,
// so that "unrated" and "rated badly" stay different things.

export interface RatedPlayerRef {
  id: string;
  name: string;
}

export interface StandingRating {
  gameplayRating: number | null;
  conductRating: number | null;
  gkAffinity: number | null;
  preferredPosition: string;
  notes: string | null;
  playWith: RatedPlayerRef[];
  playAgainst: RatedPlayerRef[];
  gamesObserved: number;
  revision: number;
  lastRatedAt: string | null;
  updatedAt: string | null;
}

export interface RosterRow {
  playerId: string;
  name: string;
  phone: string | null;
  profileImage: string | null;
  // They picked GK at signup. Until an organiser says otherwise this is what
  // the team distributor assumes about their keeping.
  declaredGk: boolean;
  gamesWithYou: number;
  lastPlayedAt: string | null;
  rating: StandingRating | null;
}

export interface RosterPage {
  rows: RosterRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  scope: "mine" | "all";
}

export interface RosterQuery {
  q?: string;
  scope?: "mine" | "all";
  filter?: "all" | "rated" | "unrated";
  sort?: "recent" | "name" | "rating";
  page?: number;
  limit?: number;
}

// What a save may change. An omitted key is left alone; an explicit null clears
// the field back to NA.
export interface RatingPatch {
  gameplayRating?: number | null;
  conductRating?: number | null;
  gkAffinity?: number | null;
  preferredPosition?: string;
  notes?: string | null;
  playWith?: string[];
  playAgainst?: string[];
}

// ── REST calls ───────────────────────────────────────────────────────────────
const authFetch = async (path: string, init: RequestInit = {}) => {
  const { token } = getSession();
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return data;
};

export const fetchRoster = async (query: RosterQuery = {}): Promise<RosterPage> => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.scope) params.set("scope", query.scope);
  if (query.filter) params.set("filter", query.filter);
  if (query.sort) params.set("sort", query.sort);
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));

  const data = await authFetch(`/api/v1/games/organisers/player-ratings/roster?${params.toString()}`);
  return data.data as RosterPage;
};

export const saveRating = async (
  playerId: string,
  patch: RatingPatch
): Promise<{ playerId: string; changed: boolean; rating: StandingRating | null }> => {
  const data = await authFetch(`/api/v1/games/organisers/player-ratings/${playerId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return data.data;
};
