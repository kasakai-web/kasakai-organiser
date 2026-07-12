"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import "../../../organizer-dashboard.css";
import "./performance.css";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlayerRatingGiven {
  _id: string;
  player: { _id: string; name: string; phone?: string };
  game: { _id: string; title?: string; format?: string; scheduledAt?: string };
  conductRating: number;
  gameplayRating: number;
  preferredPosition?: string;
  gkAffinity?: number | null;
  notes?: string;
  createdAt: string;
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: size, color: n <= value ? "#fbbf24" : "#222", lineHeight: 1 }}>★</span>
      ))}
      <span style={{ fontSize: 11, color: "#555", marginLeft: 5, fontFamily: "var(--mono, monospace)" }}>{value}/5</span>
    </div>
  );
}

export default function OrgPerformancePage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });

  const [ratingsGiven, setRatingsGiven] = useState<PlayerRatingGiven[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/api/v1/games/organisers/my-ratings-given"), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        if (d.success) setRatingsGiven(d.data || []);
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthorized) { setLoading(false); return; }
    fetchData();
  }, [isAuthorized, fetchData]);

  // Ratings-given stats
  const totalRated = ratingsGiven.length;
  const avgConduct  = totalRated ? (ratingsGiven.reduce((s, r) => s + r.conductRating,  0) / totalRated).toFixed(1) : null;
  const avgGameplay = totalRated ? (ratingsGiven.reduce((s, r) => s + r.gameplayRating, 0) / totalRated).toFixed(1) : null;

  return (
    <div className="organizer-dashboard-container">
      {/* Header */}
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Ratings Given to Players</h1>
          <p className="dashboard-subtitle">Conduct and gameplay ratings you gave after completed games</p>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading…</p></div>
      ) : (

        /* ── RATINGS GIVEN TO PLAYERS ── */
        <>
          {totalRated > 0 && (
            <div className="op-stats-row">
              <div className="op-stat">
                <div className="op-stat-value">{totalRated}</div>
                <div className="op-stat-label">Players Rated</div>
              </div>
              {avgConduct && (
                <div className="op-stat">
                  <div className="op-stat-value op-gold">{avgConduct}</div>
                  <div className="op-stat-label">Avg Conduct Given</div>
                </div>
              )}
              {avgGameplay && (
                <div className="op-stat">
                  <div className="op-stat-value op-gold">{avgGameplay}</div>
                  <div className="op-stat-label">Avg Gameplay Given</div>
                </div>
              )}
            </div>
          )}

          {ratingsGiven.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⭐</div>
              <h3>No ratings given yet</h3>
              <p>After completing a game and marking attendance, rate your players. All ratings appear here.</p>
            </div>
          ) : (
            <div className="op-cards">
              {ratingsGiven.map((r) => (
                <div key={r._id} className="op-card">
                  <div className="op-card-header">
                    <div className="op-card-main">
                      <div className="op-card-name">{r.player?.name || "Player"}</div>
                      <div className="op-card-meta">
                        {r.game?.title && <span className="op-muted">{r.game.title}</span>}
                        {r.game?.format && <span className="op-badge">{r.game.format}</span>}
                        {r.game?.scheduledAt && (
                          <span className="op-muted">
                            {new Date(r.game.scheduledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>
                    {r.preferredPosition && r.preferredPosition !== "any" && (
                      <span className="op-badge op-badge-pos">
                        {r.preferredPosition.charAt(0).toUpperCase() + r.preferredPosition.slice(1)}
                      </span>
                    )}
                  </div>

                  <div className="op-ratings-row">
                    <div className="op-rating-cell">
                      <div className="op-rating-label">Conduct</div>
                      <Stars value={r.conductRating} size={17} />
                    </div>
                    <div className="op-rating-cell">
                      <div className="op-rating-label">Gameplay</div>
                      <Stars value={r.gameplayRating} size={17} />
                    </div>
                    {r.gkAffinity != null && (
                      <div className="op-rating-cell">
                        <div className="op-rating-label">GK Affinity</div>
                        <Stars value={r.gkAffinity} size={17} />
                      </div>
                    )}
                  </div>

                  {r.notes && <div className="op-comment">"{r.notes}"</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
