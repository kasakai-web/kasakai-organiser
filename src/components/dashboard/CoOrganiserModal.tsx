"use client";

import { useEffect, useRef, useState } from "react";
import { buildApiUrl, getSession, resolveImageUrl } from "@/utils/api";

interface Organiser {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  profileImage?: string;
}

interface CoOrganiser {
  _id: string;
  organiser: Organiser | null;
  permission: "view" | "edit";
  addedAt?: string;
}

interface Props {
  gameId: string;
  gameTitle?: string;
  initialCoOrganisers?: CoOrganiser[];
  onClose: () => void;
  onChanged?: () => void; // refresh the dashboard's games list
}

const ACCENT = "#c8ff3e";

const permInfo: Record<string, { label: string; hint: string }> = {
  edit: { label: "Edit", hint: "Can manage the game (approve, edit, teams, attendance)" },
  view: { label: "View", hint: "Read-only access" },
};

export default function CoOrganiserModal({
  gameId,
  gameTitle,
  initialCoOrganisers = [],
  onClose,
  onChanged,
}: Props) {
  const { token } = getSession();

  const [coOrgs, setCoOrgs] = useState<CoOrganiser[]>(initialCoOrganisers);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Organiser[]>([]);
  const [searching, setSearching] = useState(false);
  const [addPermission, setAddPermission] = useState<"view" | "edit">("edit");
  const [busyId, setBusyId] = useState<string | null>(null); // co-org _id being changed/removed
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Debounced organiser search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = search.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          buildApiUrl(`/api/v1/organisers/search?q=${encodeURIComponent(q)}`),
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json = await res.json();
        setResults(res.ok && json.success ? json.data || [] : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search, token]);

  const alreadyAdded = (id: string) => coOrgs.some((c) => c.organiser?._id === id);

  const handleAdd = async (organiserId: string) => {
    setError(null);
    setAdding(true);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${gameId}/co-organisers`),
        { method: "POST", headers: authHeaders, body: JSON.stringify({ organiserId, permission: addPermission }) }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not add co-organiser");
      setCoOrgs(json.data || []);
      setSearch("");
      setResults([]);
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handlePermissionChange = async (coId: string, permission: "view" | "edit") => {
    setError(null);
    setBusyId(coId);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${gameId}/co-organisers/${coId}`),
        { method: "PATCH", headers: authHeaders, body: JSON.stringify({ permission }) }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not update permission");
      setCoOrgs(json.data || []);
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (coId: string) => {
    setError(null);
    setBusyId(coId);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/games/organisers/${gameId}/co-organisers/${coId}`),
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not remove co-organiser");
      setCoOrgs(json.data || []);
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const avatar = (o: Organiser | null) => (
    <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: "#242424", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: ACCENT, overflow: "hidden" }}>
      {o?.profileImage ? (
        <img src={resolveImageUrl(o.profileImage)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        (o?.name?.[0] || "?").toUpperCase()
      )}
    </span>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, background: "#111214", border: "1px solid #2a2a2a", borderRadius: 16, padding: 22, color: "#fff", maxHeight: "88vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>👥 Co-organisers</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 14px", lineHeight: 1.5 }}>
          Delegate help running <b style={{ color: "#ddd" }}>{gameTitle || "this game"}</b>.{" "}
          <b style={{ color: "#ddd" }}>Edit</b> co-organisers can run the game but can’t cancel it or manage co-organisers. <b style={{ color: "#ddd" }}>View</b> is read-only.
        </p>

        {error && (
          <div style={{ fontSize: 12.5, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 9, padding: "8px 11px", marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* ── Add a co-organiser ── */}
        <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Add a co-organiser</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "stretch" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search organisers by name, email or phone…"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13, boxSizing: "border-box" }}
            />
            {search.trim().length >= 2 && (searching || results.length > 0 || !searching) && (
              <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 4px)", left: 0, right: 0, background: "#161616", border: "1px solid #2a2a2a", borderRadius: 10, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                {searching && results.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 12, color: "#888" }}>Searching…</div>
                ) : results.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 12, color: "#888" }}>No organisers found</div>
                ) : (
                  results.map((o) => {
                    const added = alreadyAdded(o._id);
                    return (
                      <button
                        key={o._id}
                        type="button"
                        disabled={added || adding}
                        onClick={() => handleAdd(o._id)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "transparent", border: "none", borderBottom: "1px solid #202020", color: added ? "#666" : "#eee", cursor: added || adding ? "default" : "pointer", textAlign: "left" }}
                      >
                        {avatar(o)}
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</span>
                          <span style={{ display: "block", fontSize: 11, color: "#777" }}>{o.phone || o.email || ""}</span>
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 12, color: added ? "#666" : ACCENT, fontWeight: 700 }}>{added ? "✓ Added" : "+ Add"}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <select
            value={addPermission}
            onChange={(e) => setAddPermission(e.target.value as "view" | "edit")}
            title="Permission for newly added co-organisers"
            style={{ flexShrink: 0, padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13, cursor: "pointer" }}
          >
            <option value="edit">Edit</option>
            <option value="view">View</option>
          </select>
        </div>

        {/* ── Current co-organisers ── */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9aa", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          Current ({coOrgs.length})
        </div>

        {coOrgs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#777", padding: "14px 0", textAlign: "center" }}>
            No co-organisers yet. Search above to add one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coOrgs.map((c) => {
              const busy = busyId === c._id;
              return (
                <div
                  key={c._id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#161616", border: "1px solid #232323", borderRadius: 11, opacity: busy ? 0.55 : 1 }}
                >
                  {avatar(c.organiser)}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.organiser?.name || "Unknown organiser"}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "#777" }}>
                      {c.organiser?.phone || c.organiser?.email || ""}
                      <span title={permInfo[c.permission]?.hint} style={{ marginLeft: 6, color: "#888" }}>· {permInfo[c.permission]?.hint}</span>
                    </span>
                  </span>
                  <select
                    value={c.permission}
                    disabled={busy}
                    onChange={(e) => handlePermissionChange(c._id, e.target.value as "view" | "edit")}
                    style={{ flexShrink: 0, padding: "6px 8px", borderRadius: 8, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 12, cursor: busy ? "default" : "pointer" }}
                  >
                    <option value="edit">Edit</option>
                    <option value="view">View</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRemove(c._id)}
                    title="Remove co-organiser"
                    style={{ flexShrink: 0, background: "none", border: "none", color: "#f87171", fontSize: 16, cursor: busy ? "default" : "pointer", lineHeight: 1, padding: 4 }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
