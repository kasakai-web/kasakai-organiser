// Hosts, for the organiser portal: the host-spot form's mapping to and from what
// the API stores, the preview line the form shows, and the REST calls for the
// host pool and a game's facilitators.
//
// A HOST is a player the organiser recommended and KasaKai approved to run games
// on the ground for them — check-in, teams, wrap-up. Host spots are seats in a
// game held for those hosts at a discount; a FACILITATOR is a host asked to run a
// game without taking a spot. The rules live in the backend's utils/hostSeats.js;
// this file only draws them. The preview arithmetic below mirrors its host price
// exactly (flat ₹ off or % off, never more than the fee), because a preview that
// disagrees with the charge is worse than none.

import { buildApiUrl, getSession } from "@/utils/api";

// ── The form ─────────────────────────────────────────────────────────────────

export type HostDiscountMode = "flat" | "percent";

export interface HostSlotsForm {
  count: number;
  discountMode: HostDiscountMode;
  /** Rupees for "flat", a percentage for "percent" — as typed. */
  discountValue: string;
  /** Minutes before kickoff unbooked host spots open to everyone; null = never. */
  releaseMins: number | null;
}

export interface StoredHostSlots {
  count?: number;
  discountPaise?: number;
  discountPercent?: number;
  releaseMinsBeforeKickoff?: number | null;
}

export const RELEASE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Never — keep them for hosts" },
  { value: 24 * 60, label: "24 hours before kickoff" },
  { value: 12 * 60, label: "12 hours before kickoff" },
  { value: 6 * 60, label: "6 hours before kickoff" },
  { value: 2 * 60, label: "2 hours before kickoff" },
];

export const EMPTY_HOST_SLOTS: HostSlotsForm = {
  count: 0,
  discountMode: "flat",
  discountValue: "",
  releaseMins: 6 * 60,
};

export const hostSlotsFromStored = (stored?: StoredHostSlots | null): HostSlotsForm => {
  if (!stored || !stored.count) return { ...EMPTY_HOST_SLOTS };
  const percent = Number(stored.discountPercent) || 0;
  return {
    count: Number(stored.count) || 0,
    discountMode: percent > 0 ? "percent" : "flat",
    discountValue: percent > 0
      ? String(percent)
      : stored.discountPaise ? String(Math.round(Number(stored.discountPaise) / 100)) : "",
    releaseMins: stored.releaseMinsBeforeKickoff ?? null,
  };
};

export const hostSlotsToPayload = (form: HostSlotsForm): Required<StoredHostSlots> => {
  const value = Math.max(0, Number(form.discountValue) || 0);
  return {
    count: Math.max(0, Math.floor(form.count || 0)),
    discountPaise: form.discountMode === "flat" ? Math.round(value * 100) : 0,
    discountPercent: form.discountMode === "percent" ? Math.min(100, Math.round(value)) : 0,
    releaseMinsBeforeKickoff: form.releaseMins,
  };
};

/** What a host pays for their own seat, in rupees — the backend's hostPrice. */
export const hostPriceRs = (feeRs: number, form: HostSlotsForm) => {
  const fee = Math.max(0, Number(feeRs) || 0);
  const value = Math.max(0, Number(form.discountValue) || 0);
  const raw = form.discountMode === "percent" ? Math.round((fee * Math.min(100, value)) / 100) : value;
  const discount = Math.min(raw, fee);
  return { priceRs: fee - discount, discountRs: discount };
};

/** The form's own validation — the backend re-checks all of it. */
export const hostSlotsError = (
  form: HostSlotsForm,
  { feeRs, totalSlots, organiserIsPlaying }: { feeRs: number; totalSlots: number; organiserIsPlaying?: boolean },
): string | null => {
  if (!form.count) return null;
  const seats = Math.max(0, (Number(totalSlots) || 0) - (organiserIsPlaying ? 1 : 0));
  if (form.count > seats) return `Host spots can't be more than the game's ${seats} player spots.`;
  const value = Number(form.discountValue) || 0;
  if (value < 0) return "The host discount can't be negative.";
  if (form.discountMode === "percent" && value > 100) return "A percentage discount can be at most 100%.";
  if (form.discountMode === "flat" && value > (Number(feeRs) || 0)) return "The host discount can't be more than the game fee.";
  return null;
};

const releaseText = (mins: number) =>
  mins % 60 === 0 ? `${mins / 60}h` : `${mins} mins`;

/** "Hosts pay ₹200 instead of ₹300 · 2 of 14 spots held for hosts until 6h before kickoff, then open to everyone". */
export const describeHostSlots = (
  form: HostSlotsForm,
  { feeRs, totalSlots }: { feeRs: number; totalSlots: number },
): string => {
  if (!form.count) return "No host spots — every spot is open to everyone.";
  const { priceRs, discountRs } = hostPriceRs(feeRs, form);
  const fee = Number(feeRs) || 0;
  const price = discountRs > 0 ? `Hosts pay ₹${priceRs} instead of ₹${fee}` : "Hosts pay the normal fee";
  const held = `${form.count} of ${Number(totalSlots) || 0} spots held for hosts`;
  const release = form.releaseMins == null
    ? `${held} to the end`
    : `${held} until ${releaseText(form.releaseMins)} before kickoff, then open to everyone`;
  return `${price} · ${release}`;
};

// ── REST ─────────────────────────────────────────────────────────────────────

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
  if (!res.ok || data?.success === false) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
};

export type HostStatus = "pending" | "approved" | "rejected" | "ended";

export interface HostRecord {
  _id: string;
  status: HostStatus;
  recommendedNote?: string | null;
  recommendedAt?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  endedAt?: string | null;
  endedByRole?: "admin" | "organiser" | "player" | null;
  endedReason?: string | null;
  player?: {
    _id: string; name: string; phone?: string; profileImage?: string | null;
    totalGamesPlayed?: number; noShowCount?: number; backoutCount?: number;
  } | null;
  stats?: { hosted: number; facilitated: number; upcoming: number } | null;
}

export const listMyHosts = async (): Promise<HostRecord[]> => (await authFetch("/api/v1/organisers/hosts")).data || [];

export const recommendHost = async (playerId: string, note: string) =>
  (await authFetch("/api/v1/organisers/hosts", { method: "POST", body: JSON.stringify({ playerId, note }) })).data;

export const endHost = async (approvalId: string, reason?: string) =>
  (await authFetch(`/api/v1/organisers/hosts/${approvalId}`, { method: "DELETE", body: JSON.stringify({ reason }) })).data;

export interface FacilitatorEntry {
  _id: string;
  status: "invited" | "accepted" | "declined" | "removed";
  note?: string | null;
  invitedByName?: string | null;
  invitedAt?: string;
  respondedAt?: string | null;
  player: { _id: string; name: string; phone?: string; profileImage?: string | null };
}

export interface FacilitatorPanel {
  facilitators: FacilitatorEntry[];
  candidates: { _id: string; name: string; phone?: string; profileImage?: string | null }[];
  maxLive: number;
}

export const getFacilitators = async (gameId: string): Promise<FacilitatorPanel> =>
  (await authFetch(`/api/v1/games/organisers/${gameId}/facilitators`)).data;

export const inviteFacilitator = async (gameId: string, playerId: string, note?: string): Promise<FacilitatorPanel> =>
  (await authFetch(`/api/v1/games/organisers/${gameId}/facilitators`, {
    method: "POST",
    body: JSON.stringify({ playerId, note }),
  })).data;

export const removeFacilitator = async (gameId: string, facilitatorId: string): Promise<FacilitatorPanel> =>
  (await authFetch(`/api/v1/games/organisers/${gameId}/facilitators/${facilitatorId}`, { method: "DELETE" })).data;

// ── Game reads ───────────────────────────────────────────────────────────────

/** The `hostInfo` block the backend stamps on the organiser's game list. */
export interface HostInfo {
  enabled: boolean;
  total: number;
  filled: number;
  open: number;
  held: number;
  releaseAt: string | null;
  released: boolean;
  runBy: { name: string; role: "host" | "facilitator" }[];
}
