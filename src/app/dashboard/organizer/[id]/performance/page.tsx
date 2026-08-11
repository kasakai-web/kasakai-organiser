"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import "../../../organizer-dashboard.css";
import "./performance.css";

// ── Types ─────────────────────────────────────────────────────────────────────
// One standing record per player — what you currently think of them, not a log of
// every night you rated them.
interface PlayerRatingGiven {
  _id: string;
  player: { _id: string; name: string; phone?: string };
  lastRatedGame?: { _id: string; title?: string; format?: string; scheduledAt?: string } | null;
  conductRating: number;
  gameplayRating: number;
  preferredPosition?: string;
  gkAffinity?: number | null;
  notes?: string;
  gamesObserved?: number;
  revision?: number;
  lastRatedAt?: string | null;
  updatedAt?: string;
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
  const totalGamesObserved = ratingsGiven.reduce((s, r) => s + (r.gamesObserved || 0), 0);

  return (
    <div className="organizer-dashboard-container">
      {/* Header */}
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Your Player Ratings</h1>
          <p className="dashboard-subtitle">
            One standing rating per player, revised whenever you rate them again after a game
          </p>
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
              {totalGamesObserved > 0 && (
                <div className="op-stat">
                  <div className="op-stat-value">{totalGamesObserved}</div>
                  <div className="op-stat-label">Games Observed</div>
                </div>
              )}
            </div>
          )}

          {ratingsGiven.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⭐</div>
              <h3>No ratings given yet</h3>
              <p>
                After completing a game and marking attendance, rate your players. Each player gets one
                rating you can revise later — you will never be asked to rate the same regular twice.
              </p>
            </div>
          ) : (
            <div className="op-cards">
              {ratingsGiven.map((r) => (
                <div key={r._id} className="op-card">
                  <div className="op-card-header">
                    <div className="op-card-main">
                      <div className="op-card-name">{r.player?.name || "Player"}</div>
                      <div className="op-card-meta">
                        {(r.gamesObserved ?? 0) > 0 && (
                          <span className="op-badge">
                            {r.gamesObserved} game{r.gamesObserved === 1 ? "" : "s"} observed
                          </span>
                        )}
                        {r.lastRatedAt && (
                          <span className="op-muted">
                            last rated {new Date(r.lastRatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                        {(r.revision ?? 1) > 1 && (
                          <span className="op-muted">revised {r.revision! - 1}×</span>
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
