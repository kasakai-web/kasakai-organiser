// Player Lists — types and the pure helpers the pages and pickers share.
//
// Deliberately import-free so `npm test` can run it under --experimental-strip-types.
// The REST calls are in utils/playerListsApi.ts. (Not to be confused with
// utils/playerListMessage.ts, which formats one game's roster for WhatsApp.)
//
// The rules themselves live on the backend (kasakai-backend/src/utils/playerLists.js).
// The server stamps every player row with its automatic tags (`auto`) and the
// organiser's own tags (`tags`), so the only thing this file re-implements is the
// trivial filter over those stamps: ALL selected tag keys, ANY selected venue —
// the same predicate a smart list's rule is evaluated with, so a chip's count is
// the size of the list it would save.

export type AutoKey = "played" | "regular" | "new" | "lapsed" | "gk" | "top";
export type AddedVia = "manual" | "search" | "book" | "game" | "paste" | "rule" | "sos" | "invite";

export interface BookRow {
  id: string;
  name: string;
  img: string | null;
  phone: string;
  games: number;
  lastAt: string | null;
  firstAt: string | null;
  upcoming: number;
  venues: string[];
  auto: AutoKey[];
  tags: string[];
  rating: number | null;
}

export interface TagInfo { key: string; label: string; count: number }
export interface AutoTagInfo { key: string; label: string; emoji: string; hint: string; count: number }
export interface VenueInfo { id: string; name: string; count: number }

export interface RecentGame {
  id: string;
  title: string;
  scheduledAt: string;
  upcoming: boolean;
  status: string;
  venue: string | null;
  playerIds: string[];
}

export interface PlayerBook {
  rows: BookRow[];
  tags: TagInfo[];
  autoTags: AutoTagInfo[];
  venues: VenueInfo[];
  games: RecentGame[];
  limits: { membersPerList: number; tagsPerPlayer: number; sendBatch: number };
}

export interface ListRule { tags: string[]; venues: string[] }

export interface ListSummary {
  _id: string;
  name: string;
  emoji: string;
  description: string | null;
  pinned: boolean;
  preset: string | null;
  smart: boolean;
  rule: ListRule | null;
  count: number;
  contacts: number;
  fromRule: number;
  excludedCount: number;
  preview: { id: string; name: string; img: string | null }[];
  topTags: { label: string; count: number }[];
  usage: { sosCount: number; inviteCount: number; lastUsedAt: string | null; lastUsedFor: "sos" | "invite" | null };
  createdAt: string;
  updatedAt: string;
}

export interface Preset {
  key: string;
  name: string;
  emoji: string;
  kind: "auto" | "venue";
  rule: ListRule;
  count: number;
  listId: string | null;
}

export interface ListIndex {
  lists: ListSummary[];
  presets: Preset[];
  totals: { players: number; tags: number; maxLists: number };
}

export interface MemberRow {
  key: string;
  playerId: string | null;
  name: string;
  img: string | null;
  phone: string;
  contactPhone?: string;
  games: number;
  lastAt: string | null;
  upcoming: number;
  auto: AutoKey[];
  tags: string[];
  rating: number | null;
  source: "manual" | "rule";
  contact: boolean;
}

export interface ListDetail {
  list: ListSummary;
  members: MemberRow[];
  excluded: { playerId: string; name: string }[];
  result?: { added?: number; already?: number; overLimit?: number; removed?: number };
}

export interface Contact { name: string; phone: string }

export interface PasteCandidate { id: string; name: string; img: string | null; sub: string }

export interface PastePerson {
  line: string;
  name: string | null;
  status: "matched" | "choose" | "contact" | "none" | "duplicate";
  via?: "phone" | "name";
  player?: PasteCandidate;
  options?: PasteCandidate[];
  contact?: { name: string; phone: string; pretty: string };
}

export interface PasteResult {
  people: PastePerson[];
  counts: Record<PastePerson["status"], number>;
}

export interface ForGamePerson { playerId: string | null; name: string; sub: string; games?: number; phone?: string }

export interface ForGame {
  list: { _id: string; name: string; emoji: string };
  people: ForGamePerson[];
  skipped: { seated: number; invited: number; noAccount: number; overLimit: number };
  total: number;
  limit: number;
}

// ── Keys and filtering ───────────────────────────────────────────────────────

export const tagKeyOf = (label: string) => `t:${label.toLowerCase()}`;

export function rowKeys(row: { auto: readonly string[]; tags: readonly string[] }): Set<string> {
  const keys = new Set<string>();
  for (const a of row.auto) keys.add(`a:${a}`);
  for (const t of row.tags) keys.add(tagKeyOf(t));
  return keys;
}

export interface BookFilter { q?: string; keys?: string[]; venues?: string[] }

// The picker's filter. Unlike a saved rule, an EMPTY filter shows everyone —
// that is just the picker with nothing tapped yet.
export function matchesFilter(row: BookRow, f: BookFilter): boolean {
  const keys = f.keys || [];
  if (keys.length) {
    const have = rowKeys(row);
    for (const k of keys) if (!have.has(k)) return false;
  }
  const venues = f.venues || [];
  if (venues.length && !venues.some((v) => row.venues.includes(v))) return false;
  return searchMatches(row, f.q || "");
}

const fold = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Name words, or the last digits of the (masked) number the row carries.
export function searchMatches(row: { name: string; phone?: string }, q: string): boolean {
  const query = fold(q.trim());
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 3 && digits === query.replace(/\s/g, "")) {
    return (row.phone || "").replace(/\D/g, "").endsWith(digits.slice(-4));
  }
  const name = fold(row.name || "");
  return query.split(/\s+/).every((part) => name.includes(part));
}

export function filterBook(rows: BookRow[], f: BookFilter): BookRow[] {
  return rows.filter((r) => matchesFilter(r, f));
}

// How many of `rows` carry each key — the number shown on an unselected chip,
// which is what tapping it would leave on screen.
export function keyCounts(rows: BookRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const k of rowKeys(r)) counts.set(k, (counts.get(k) || 0) + 1);
    for (const v of r.venues) counts.set(`v:${v}`, (counts.get(`v:${v}`) || 0) + 1);
  }
  return counts;
}

export const personKey = (m: { playerId?: string | null; id?: string; contactPhone?: string; phone?: string }) =>
  m.playerId || m.id ? `p:${m.playerId || m.id}` : `c:${m.contactPhone || m.phone || ""}`;

// ── Words ────────────────────────────────────────────────────────────────────

export function keyLabel(
  key: string,
  ctx: { tags?: TagInfo[]; autoTags?: AutoTagInfo[] },
): { emoji: string; label: string } {
  if (key.startsWith("a:")) {
    const a = (ctx.autoTags || []).find((t) => t.key === key);
    return { emoji: a?.emoji || "•", label: a?.label || key.slice(2) };
  }
  const t = (ctx.tags || []).find((x) => x.key === key);
  return { emoji: "#", label: t?.label || key.slice(2) };
}

// "🔥 Regular + 🧤 Goalkeeper · at Kickoff Arena or Lakeside"
export function describeRule(
  rule: ListRule | null,
  ctx: { tags?: TagInfo[]; autoTags?: AutoTagInfo[]; venues?: VenueInfo[] },
): string {
  if (!rule) return "";
  const tagPart = rule.tags
    .map((k) => {
      const { emoji, label } = keyLabel(k, ctx);
      return emoji === "#" ? `#${label}` : `${emoji} ${label}`;
    })
    .join(" + ");
  const venueNames = rule.venues.map((id) => (ctx.venues || []).find((v) => v.id === id)?.name || "a venue");
  const venuePart = venueNames.length ? `played at ${venueNames.join(" or ")}` : "";
  return [tagPart, venuePart].filter(Boolean).join(" · ");
}

const DAY = 24 * 60 * 60 * 1000;

export function lastPlayedLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  if (!Number.isFinite(days) || days < 0) return "";
  if (days === 0) return "played today";
  if (days === 1) return "played yesterday";
  if (days < 14) return `played ${days}d ago`;
  if (days < 60) return `played ${Math.round(days / 7)}w ago`;
  if (days < 365) return `played ${Math.round(days / 30)}mo ago`;
  return `played ${Math.round(days / 365)}y ago`;
}

export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function usageLabel(u: ListSummary["usage"], now: Date = new Date()): string {
  const total = (u.sosCount || 0) + (u.inviteCount || 0);
  if (!total) return "Not used yet";
  const what = u.lastUsedFor === "sos" ? "SOS" : "invite";
  return `Used ${total}× · last ${what} ${timeAgo(u.lastUsedAt, now)}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Making a list without thinking ───────────────────────────────────────────

export const EMOJI_CHOICES = ["👥", "🔥", "⚽", "🧤", "⭐", "🌅", "🌙", "💼", "🎓", "🏆", "💪", "❤️"];

// The emoji a new list starts with, from its name, until the organiser picks one.
const EMOJI_HINTS: [RegExp, string][] = [
  [/\b(gks?|keepers?|goalies?|goal ?keepers?)\b/i, "🧤"],
  [/\b(regulars?|core|crews?|squads?|gangs?)\b/i, "🔥"],
  [/\b(mornings?|sunrise|early)\b/i, "🌅"],
  [/\b(nights?|evenings?|late)\b/i, "🌙"],
  [/\b(office|work|corporate|colleagues?)\b/i, "💼"],
  [/\b(college|school|uni|campus|students?)\b/i, "🎓"],
  [/\b(leagues?|tournaments?|cups?|pro|elite|best|top)\b/i, "🏆"],
  [/\b(friends?|family|fam)\b/i, "❤️"],
  [/\b(new|beginners?|starters?)\b/i, "⭐"],
];

export function suggestEmoji(name: string): string {
  for (const [re, emoji] of EMOJI_HINTS) if (re.test(name)) return emoji;
  return "👥";
}

// The name "Save as list" offers in the SOS / invite modal: the game's own
// title, so next week's search for "Sunday 7am" finds it.
export function defaultListName(gameTitle: string | null | undefined): string {
  const t = (gameTitle || "").trim();
  return t ? `${t} players`.slice(0, 60) : "My players";
}

// ── SOS / invite recipients built from lists ─────────────────────────────────
//
// Each recipient remembers which lists put them there, so un-ticking a list
// takes back exactly the people it added — and nobody the organiser picked
// some other way.

export interface Sourced { lists?: string[]; manual?: boolean }

export function addFromList<T extends Sourced>(
  current: T[],
  listId: string,
  incoming: T[],
  sameAs: (a: T, b: T) => boolean,
): { next: T[]; added: number } {
  const next = current.map((r) => ({ ...r }));
  let added = 0;
  for (const p of incoming) {
    const hit = next.find((r) => sameAs(r, p));
    if (hit) {
      if (!(hit.lists || []).includes(listId)) hit.lists = [...(hit.lists || []), listId];
      continue;
    }
    next.push({ ...p, lists: [listId] });
    added += 1;
  }
  return { next, added };
}

export function removeList<T extends Sourced>(current: T[], listId: string): T[] {
  const out: T[] = [];
  for (const r of current) {
    if (!(r.lists || []).includes(listId)) { out.push(r); continue; }
    const lists = (r.lists || []).filter((x) => x !== listId);
    if (lists.length === 0 && !r.manual) continue;
    out.push({ ...r, lists });
  }
  return out;
}

export const listsUsed = (rows: Sourced[]): string[] =>
  [...new Set(rows.flatMap((r) => r.lists || []))];
