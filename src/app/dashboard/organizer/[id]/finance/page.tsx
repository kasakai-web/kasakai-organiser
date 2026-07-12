"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import "../../../organizer-dashboard.css";
import "./finance.css";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlayerSlot {
  name: string;
  amountPaise?: number;
}

interface GameFinance {
  _id: string;
  title: string;
  format?: string;
  scheduledAt?: string;
  status: string;
  feeInPaise: number;
  turfName?: string;
  revenuePaise: number;
  refundedPaise: number;
  paidPlayers: PlayerSlot[];
  paidGuests: PlayerSlot[];
  orgFreeSlots: PlayerSlot[];
  orgFreeGuests: PlayerSlot[];
}

interface FinanceSummary {
  totalRevenuePaise: number;
  totalRefundedPaise: number;
  netRevenuePaise: number;
  totalPaidPlayers: number;
  totalPaidGuests: number;
  totalOrgFreeSlots: number;
  totalOrgFreeGuests: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const rs = (paise: number) => {
  const val = paise / 100;
  return val % 1 === 0 ? `₹${val.toLocaleString("en-IN")}` : `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "fb-status-draft" },
  open:      { label: "Open",      cls: "fb-status-open" },
  confirmed: { label: "Confirmed", cls: "fb-status-confirmed" },
  completed: { label: "Completed", cls: "fb-status-completed" },
  cancelled: { label: "Cancelled", cls: "fb-status-cancelled" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: "fb-status-draft" };
  return <span className={`fb-status-pill ${s.cls}`}>{s.label}</span>;
}

// ── Slot list inside expanded card ────────────────────────────────────────────
function SlotSection({
  title,
  dotClass,
  slots,
  paid,
}: {
  title: string;
  dotClass: string;
  slots: PlayerSlot[];
  paid: boolean;
}) {
  if (slots.length === 0) return null;
  return (
    <div className="fin-slot-section">
      <div className="fin-slot-head">
        <span className={`fin-dot ${dotClass}`} />
        <span className="fin-slot-head-text">{title}</span>
        <span className="fin-slot-count">{slots.length}</span>
      </div>
      <div className="fin-slot-grid">
        {slots.map((p, i) => (
          <div key={i} className="fin-slot-item">
            <span className="fin-slot-name">{p.name}</span>
            {paid ? (
              <span className="fin-slot-amt">{rs(p.amountPaise || 0)}</span>
            ) : (
              <span className="fin-slot-free-tag">Free</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OrgFinancePage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [games, setGames]     = useState<GameFinance[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter]   = useState("all");

  const fetchData = useCallback(async () => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(buildApiUrl("/api/v1/games/organisers/financial-summary"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || `HTTP ${res.status}`);
      }
      const d = await res.json();
      if (d.success) { setSummary(d.data.summary); setGames(d.data.games || []); }
      else throw new Error(d.message || "Failed to load financials");
    } catch (err: any) {
      setFetchError(err.message || "Failed to load financial data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthorized) { setLoading(false); return; }
    fetchData();
  }, [isAuthorized, fetchData]);

  const toggleExpand = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const FILTERS = ["all", "completed", "confirmed", "open", "draft", "cancelled"] as const;

  const visible = filter === "all" ? games : games.filter((g) => g.status === filter);

  const totalFreeSlots  = (summary?.totalOrgFreeSlots  ?? 0) + (summary?.totalOrgFreeGuests ?? 0);
  const totalPaid       = (summary?.totalPaidPlayers    ?? 0) + (summary?.totalPaidGuests   ?? 0);

  return (
    <div className="organizer-dashboard-container">
      {/* ── Page header ── */}
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Financials</h1>
          <p className="dashboard-subtitle">Revenue · Paid players · Free slots · Refunds — across all your games</p>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading…</p></div>
      ) : fetchError ? (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "16px 20px", color: "#f87171", fontSize: 14 }}>
          ⚠️ {fetchError}
          <button onClick={fetchData} style={{ marginLeft: 12, background: "transparent", border: "1px solid #f87171", color: "#f87171", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* ── Summary section ── */}
          {summary && (
            <div className="fin-overview">
              {/* Hero row: money */}
              <div className="fin-hero-row">
                <div className="fin-hero-card fin-hero-net">
                  <div className="fin-hero-label">Net Revenue</div>
                  <div className="fin-hero-val fin-col-green">{rs(summary.netRevenuePaise)}</div>
                  <div className="fin-hero-sub">after refunds</div>
                </div>
                <div className="fin-hero-card">
                  <div className="fin-hero-label">Total Collected</div>
                  <div className="fin-hero-val fin-col-lime">{rs(summary.totalRevenuePaise)}</div>
                  <div className="fin-hero-sub">from {totalPaid} paid slots</div>
                </div>
                <div className="fin-hero-card">
                  <div className="fin-hero-label">Refunded</div>
                  <div className="fin-hero-val fin-col-red">{rs(summary.totalRefundedPaise)}</div>
                  <div className="fin-hero-sub">returned to players</div>
                </div>
              </div>

              {/* Player counts row */}
              <div className="fin-counts-row">
                <div className="fin-count-item">
                  <span className="fin-count-val">{summary.totalPaidPlayers}</span>
                  <span className="fin-count-label">Paid Players</span>
                </div>
                <div className="fin-count-divider" />
                <div className="fin-count-item">
                  <span className="fin-count-val">{summary.totalPaidGuests}</span>
                  <span className="fin-count-label">Paid Plus-Ones</span>
                </div>
                <div className="fin-count-divider" />
                <div className="fin-count-item">
                  <span className="fin-count-val fin-col-muted">{summary.totalOrgFreeSlots}</span>
                  <span className="fin-count-label">Free Players (Org)</span>
                </div>
                <div className="fin-count-divider" />
                <div className="fin-count-item">
                  <span className="fin-count-val fin-col-muted">{summary.totalOrgFreeGuests}</span>
                  <span className="fin-count-label">Free Guests (Org)</span>
                </div>
                <div className="fin-count-divider" />
                <div className="fin-count-item">
                  <span className="fin-count-val">{totalPaid + totalFreeSlots}</span>
                  <span className="fin-count-label">Total Slots</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Filter tabs ── */}
          <div className="fin-filter-bar">
            {FILTERS.map((f) => {
              const cnt = f === "all" ? games.length : games.filter((g) => g.status === f).length;
              return (
                <button
                  key={f}
                  className={`fin-filter-btn ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="fin-filter-pill">{cnt}</span>
                </button>
              );
            })}
          </div>

          {/* ── Game breakdown list ── */}
          {visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💰</div>
              <h3>No games here</h3>
              <p>Create paid games and players will start appearing in your financial breakdown.</p>
            </div>
          ) : (
            <div className="fin-game-list">
              {visible.map((game) => {
                const isOpen  = !!expanded[game._id];
                const paidCnt = game.paidPlayers.length + game.paidGuests.length;
                const freeCnt = game.orgFreeSlots.length + game.orgFreeGuests.length;
                const netGame = game.revenuePaise - game.refundedPaise;

                return (
                  <div key={game._id} className={`fin-game-card ${isOpen ? "fin-game-card--open" : ""}`}>

                    {/* ── Collapsed header ── */}
                    <div
                      className="fin-game-header"
                      onClick={() => toggleExpand(game._id)}
                      role="button"
                      aria-expanded={isOpen}
                    >
                      {/* Left: title + meta */}
                      <div className="fin-game-left">
                        <div className="fin-game-row1">
                          <span className="fin-game-title">{game.title || "Untitled Game"}</span>
                          <StatusPill status={game.status} />
                          {game.format && <span className="fin-format-badge">{game.format}</span>}
                        </div>
                        <div className="fin-game-row2">
                          {game.scheduledAt && <span className="fin-meta-dim">{fmtDate(game.scheduledAt)}</span>}
                          {game.turfName    && <span className="fin-meta-dim">{game.turfName}</span>}
                          <span className="fin-meta-dim">
                            {game.feeInPaise > 0 ? `${rs(game.feeInPaise)}/slot` : "Free game"}
                          </span>
                        </div>
                      </div>

                      {/* Right: numbers */}
                      <div className="fin-game-right">
                        <div className="fin-stat-chip fin-chip-green">
                          <span className="fin-chip-val">{rs(game.revenuePaise)}</span>
                          <span className="fin-chip-lbl">collected</span>
                        </div>
                        {game.refundedPaise > 0 && (
                          <div className="fin-stat-chip fin-chip-red">
                            <span className="fin-chip-val">−{rs(game.refundedPaise)}</span>
                            <span className="fin-chip-lbl">refunded</span>
                          </div>
                        )}
                        <div className="fin-stat-chip">
                          <span className="fin-chip-val">{paidCnt + freeCnt}</span>
                          <span className="fin-chip-lbl">slots</span>
                        </div>
                        <span className={`fin-chevron ${isOpen ? "fin-chevron--up" : ""}`}>›</span>
                      </div>
                    </div>

                    {/* ── Expanded detail panel ── */}
                    {isOpen && (
                      <div className="fin-detail-panel">

                        {/* Mini money summary inside */}
                        <div className="fin-detail-money">
                          <div className="fin-detail-money-item">
                            <span className="fin-detail-money-lbl">Collected</span>
                            <span className="fin-detail-money-val fin-col-lime">{rs(game.revenuePaise)}</span>
                          </div>
                          {game.refundedPaise > 0 && (
                            <div className="fin-detail-money-item">
                              <span className="fin-detail-money-lbl">Refunded</span>
                              <span className="fin-detail-money-val fin-col-red">−{rs(game.refundedPaise)}</span>
                            </div>
                          )}
                          <div className="fin-detail-money-item fin-detail-money-net">
                            <span className="fin-detail-money-lbl">Net</span>
                            <span className={`fin-detail-money-val ${netGame >= 0 ? "fin-col-green" : "fin-col-red"}`}>
                              {rs(netGame)}
                            </span>
                          </div>
                          <div className="fin-detail-money-item">
                            <span className="fin-detail-money-lbl">Paid slots</span>
                            <span className="fin-detail-money-val">{paidCnt}</span>
                          </div>
                          <div className="fin-detail-money-item">
                            <span className="fin-detail-money-lbl">Free slots</span>
                            <span className="fin-detail-money-val fin-col-muted">{freeCnt}</span>
                          </div>
                        </div>

                        {/* Slot sections */}
                        {(paidCnt > 0 || freeCnt > 0) ? (
                          <div className="fin-slot-sections">
                            <SlotSection title="Paid Players"          dotClass="fin-dot-green" slots={game.paidPlayers}  paid />
                            <SlotSection title="Paid Plus-Ones"        dotClass="fin-dot-lime"  slots={game.paidGuests}   paid />
                            <SlotSection title="Free Players (Org)"    dotClass="fin-dot-gray"  slots={game.orgFreeSlots}  paid={false} />
                            <SlotSection title="Free Guests (Org)"     dotClass="fin-dot-gray"  slots={game.orgFreeGuests} paid={false} />
                          </div>
                        ) : (
                          <p className="fin-no-slots">No player registrations recorded for this game.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
