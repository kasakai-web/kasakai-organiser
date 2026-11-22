// Player Lists — the REST calls. Types and pure helpers are in utils/playerLists.ts.
//
// Every write announces itself with a `kk-player-lists-changed` window event, so
// the cached book (hooks/usePlayerBook.ts) and any open list picker refresh
// without each caller having to remember to.

import { buildApiUrl, getSession } from "@/utils/api";
import type {
  AddedVia, Contact, ForGame, ListDetail, ListIndex, ListRule, PlayerBook, TagInfo,
} from "@/utils/playerLists";

export const LISTS_CHANGED_EVENT = "kk-player-lists-changed";

const BASE = "/api/v1/organisers/me";

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { token } = getSession();
  const res = await fetch(buildApiUrl(`${BASE}${path}`), {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let data: { success?: boolean; message?: string; data?: T } = {};
  try { data = await res.json(); } catch { /* an empty or HTML error page */ }
  if (!res.ok || !data.success) throw new Error(data.message || "Something went wrong — try again.");
  if ((init.method || "GET") !== "GET" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(LISTS_CHANGED_EVENT));
  }
  return data.data as T;
}

export const fetchBook = () => call<PlayerBook>("/player-book");
export const fetchLists = () => call<ListIndex>("/player-lists");
export const fetchList = (id: string) => call<ListDetail>(`/player-lists/${id}`);

export interface MembersInput { playerIds?: string[]; contacts?: Contact[] }

export const createList = (body: {
  name?: string;
  emoji?: string;
  description?: string | null;
  preset?: string;
  rule?: ListRule | null;
  members?: MembersInput;
  via?: AddedVia;
}) => call<ListDetail>("/player-lists", { method: "POST", body });

export const updateList = (id: string, body: {
  name?: string;
  emoji?: string;
  description?: string | null;
  pinned?: boolean;
  rule?: ListRule | null;
  freeze?: boolean;
  restore?: string[] | true;
}) => call<ListDetail>(`/player-lists/${id}`, { method: "PATCH", body });

export const deleteList = (id: string) => call<{ deleted: boolean }>(`/player-lists/${id}`, { method: "DELETE" });
export const duplicateList = (id: string) => call<ListDetail>(`/player-lists/${id}/duplicate`, { method: "POST", body: {} });

export const addMembers = (id: string, body: MembersInput & { via?: AddedVia }) =>
  call<ListDetail>(`/player-lists/${id}/members`, { method: "POST", body });

export const removeMembers = (id: string, body: { playerIds?: string[]; phones?: string[] }) =>
  call<ListDetail>(`/player-lists/${id}/members/remove`, { method: "POST", body });

export const listForGame = (id: string, gameId: string, purpose: "sos" | "invite") =>
  call<ForGame>(`/player-lists/${id}/for-game/${gameId}?purpose=${purpose}`);


export const setPlayerTags = (playerId: string, tags: string[]) =>
  call<{ playerId: string; tags: string[]; palette: TagInfo[] }>(`/player-tags/players/${playerId}`, { method: "PUT", body: { tags } });

export const bulkTag = (body: { playerIds: string[]; add?: string[]; remove?: string[] }) =>
  call<{ updated: number; skipped: number; note: string | null; palette: TagInfo[] }>("/player-tags/bulk", { method: "POST", body });

export const renameTag = (label: string, to: string) =>
  call<{ label: string; merged: boolean; palette: TagInfo[] }>(`/player-tags/${encodeURIComponent(label)}`, { method: "PATCH", body: { to } });

export const deleteTag = (label: string) =>
  call<{ deleted: string; frozenLists: number; widenedLists: number; palette: TagInfo[] }>(`/player-tags/${encodeURIComponent(label)}`, { method: "DELETE" });
