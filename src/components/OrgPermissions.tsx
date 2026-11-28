"use client";

/* What KasaKai lets this organiser do (GET /organisers/me/permissions).
   - Loaded once per page and again whenever the tab regains focus.
   - Every 403 ORG_PERMISSION_DENIED from ANY request becomes a toast with the
     server's reason, so a control the UI did not grey out still explains itself.
   - A banner says when the account is frozen, and which features are off or at
     their limit. Controls use useOrgPermission(key) to grey themselves out. */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import { Toast } from "@/components/ui/Toast";

type Entry = { on: boolean; cap: number | null; source: string; windowCap?: number; windowDays?: number; period?: "day" | "week" };
type Feature = { key: string; group: string; label: string; capUnit?: string };
type Perms = {
  trustLevel: "new" | "trusted" | "partner";
  frozen: boolean;
  frozenReason: string | null;
  features: Feature[];
  permissions: Record<string, Entry>;
  usage: Record<string, number>;
};

const Ctx = createContext<Perms | null>(null);

export const DISABLED_NOTE = "Disabled by KasaKai";

/** { on, note } for one feature. `on` is true until permissions have loaded. */
export function useOrgPermission(key: string) {
  const p = useContext(Ctx);
  const e = p?.permissions?.[key];
  if (!p || !e) return { on: true, atLimit: false, note: "" };
  if (key === "createGames" && p.frozen) return { on: false, atLimit: false, note: "Your account is frozen by KasaKai" };
  if (!e.on) return { on: false, atLimit: false, note: DISABLED_NOTE };
  const used = p.usage?.[key];
  let unit = p.features.find((f) => f.key === key)?.capUnit ?? "";
  if (key === "sosBlasts") unit += e.period === "week" ? " this week" : " today";
  // Depends on the kickoff the organiser picks, so it never greys the button; the server's refusal toasts.
  const windowNote = e.windowCap !== undefined && e.windowDays ? `max ${e.windowCap} games in any ${e.windowDays} days` : "";
  const notes: string[] = [];
  let atLimit = false;
  if (e.cap !== null && used !== undefined) {
    atLimit = used >= e.cap;
    notes.push(`${used} of ${e.cap} ${unit} used`.trim());
  }
  if (windowNote) notes.push(windowNote);
  return { on: true, atLimit, note: notes.join(" · ") };
}

export function useOrgPermissions() {
  return useContext(Ctx);
}

let fetchPatched = false;
let onDenied: ((message: string) => void) | null = null;

// One wrapper for the whole tab: it only reads a clone of 403 responses.
function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    if (res.status === 403 && onDenied) {
      res.clone().json()
        .then((b) => { if (b?.code === "ORG_PERMISSION_DENIED") onDenied?.(b.message || b.reason || DISABLED_NOTE); })
        .catch(() => {});
    }
    return res;
  };
}

export function OrgPermissionsProvider({ children }: { children: React.ReactNode }) {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { token } = getSession();
    if (!token) return;
    try {
      const res = await fetch(buildApiUrl("/api/v1/organisers/me/permissions"), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.data) setPerms(body.data);
    } catch { /* keep the last known permissions */ }
  }, []);

  useEffect(() => {
    patchFetch();
    onDenied = (m) => { setToast(m); load(); };
    const t = setTimeout(load, 0);
    window.addEventListener("focus", load);
    return () => { clearTimeout(t); window.removeEventListener("focus", load); onDenied = null; };
  }, [load]);

  // netRevenue is hidden silently (user's call, 26 Nov 2026), so it is never named here.
  const off = perms ? perms.features.filter((f) => f.key !== "netRevenue" && !perms.permissions[f.key]?.on) : [];

  return (
    <Ctx.Provider value={perms}>
      {perms && (perms.frozen || off.length > 0) && (
        <div style={{
          background: perms.frozen ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${perms.frozen ? "rgba(248,113,113,0.35)" : "#333"}`,
          borderRadius: "8px", padding: "10px 14px", margin: "16px 16px 0", fontSize: "12px", color: "var(--muted)",
        }}>
          {perms.frozen && (
            <p style={{ margin: 0, color: "#f87171", fontWeight: 700, fontSize: "13px" }}>
              Your account is frozen by KasaKai: no new games and no new players for now. Your existing games still run.
              {perms.frozenReason ? ` Reason: ${perms.frozenReason}` : ""}
            </p>
          )}
          {off.length > 0 && (
            <p style={{ margin: perms.frozen ? "4px 0 0" : 0 }}>
              {DISABLED_NOTE}: {off.map((f) => f.label).join(" · ")}
            </p>
          )}
        </div>
      )}
      {children}
      {toast && <Toast type="error" title="Not allowed" subtitle={toast} duration={4000} onClose={() => setToast(null)} />}
    </Ctx.Provider>
  );
}
