"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import "../../../organizer-dashboard.css";
import "./notifications.css";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { NavBtn } from "@/components/ui/NavBtn";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Notification {
  _id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  actionUrl?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const TYPE_ICON: Record<string, string> = {
  game_created:           "🏟️",
  game_registered:        "✅",
  game_cancelled:         "⛔",
  game_backout_player:    "↩️",
  game_backout_organiser: "📢",
  waitlist_joined:        "⏳",
  waitlist_spot:          "🔔",
  waitlist_approved:      "🎉",
  player_removed:         "❌",
  wallet_topup:           "💰",
  wallet_debit:           "💸",
  wallet_refund:          "💚",
  refund_credited:        "💚",
  guest_waitlisted:       "📋",
  guest_waitlist_spot:    "🔔",
  guest_confirmed:        "✅",
  system:                 "ℹ️",
};

const TYPE_COLOR: Record<string, string> = {
  game_created:           "rgba(200,255,62,0.14)",
  game_registered:        "rgba(74,222,128,0.14)",
  game_cancelled:         "rgba(255,68,68,0.14)",
  game_backout_player:    "rgba(249,115,22,0.14)",
  game_backout_organiser: "rgba(245,158,11,0.14)",
  waitlist_joined:        "rgba(96,165,250,0.14)",
  waitlist_spot:          "rgba(34,211,238,0.14)",
  waitlist_approved:      "rgba(167,139,250,0.14)",
  player_removed:         "rgba(239,68,68,0.14)",
  wallet_topup:           "rgba(74,222,128,0.14)",
  wallet_debit:           "rgba(248,113,113,0.14)",
  wallet_refund:          "rgba(74,222,128,0.14)",
  refund_credited:        "rgba(74,222,128,0.14)",
  guest_waitlisted:       "rgba(96,165,250,0.14)",
  guest_waitlist_spot:    "rgba(34,211,238,0.14)",
  guest_confirmed:        "rgba(74,222,128,0.14)",
  system:                 "rgba(148,163,184,0.14)",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function groupByDate(list: Notification[]): { label: string; items: Notification[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const thisWeek  = today - 7 * 86_400_000;
  const groups: Record<string, Notification[]> = {};
  for (const n of list) {
    const d = new Date(n.createdAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let label: string;
    if (day >= today)     label = "Today";
    else if (day >= yesterday) label = "Yesterday";
    else if (day >= thisWeek)  label = "This week";
    else label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  }
  const ORDER = ["Today", "Yesterday", "This week"];
  const result: { label: string; items: Notification[] }[] = [];
  for (const lbl of ORDER) {
    if (groups[lbl]) { result.push({ label: lbl, items: groups[lbl] }); delete groups[lbl]; }
  }
  for (const lbl of Object.keys(groups)) result.push({ label: lbl, items: groups[lbl] });
  return result;
}

const PAGE_SIZE = 30;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OrganizerNotificationsPage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const routeUserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;

  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId,
    redirectTo: "/login",
  });

  const handleNav = () => {
    if (routeUserId) {
      router.push(`/dashboard/organizer/${routeUserId}`);
    }
  };

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [marking, setMarking] = useState(false);

  const clearSessionAndExit = () => {
    clearSession();
    router.replace("/login");
  };

  const fetchNotifications = useCallback(async (skip = 0, append = false) => {
    const { token } = getSession();
    if (!token) { clearSessionAndExit(); return; }
    if (!append) setLoading(true);
    setError("");
    try {
      const res = await fetch(buildApiUrl(`/api/v1/notifications?limit=${PAGE_SIZE}&skip=${skip}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) { clearSessionAndExit(); return; }
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.message || "Failed to load notifications"); return; }
      const list: Notification[] = data.data?.notifications ?? [];
      setNotifications((prev) => append ? [...prev, ...list] : list);
      setHasMore(list.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;
    fetchNotifications(0);
    const { token } = getSession();
    if (token) {
      fetch(buildApiUrl("/api/v1/notifications/read-all"), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [isAuthorized, fetchNotifications]);

  const markRead = async (n: Notification) => {
    if (!n.isRead) {
      const { token } = getSession();
      if (!token) return;
      try {
        await fetch(buildApiUrl(`/api/v1/notifications/${n._id}/read`), {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        setNotifications((prev) => prev.map((x) => x._id === n._id ? { ...x, isRead: true } : x));
      } catch {}
    }
    if (n.actionUrl) router.push(n.actionUrl);
  };

  const markAllRead = async () => {
    if (marking) return;
    setMarking(true);
    const { token } = getSession();
    if (!token) { setMarking(false); return; }
    try {
      await fetch(buildApiUrl("/api/v1/notifications/read-all"), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
    } catch {}
    finally { setMarking(false); }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage * PAGE_SIZE, true);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const groups = groupByDate(notifications);

  return (
    <div className="organizer-dashboard-container">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div className="page-title-group">
          <h1 className="dashboard-title">Notifications</h1>
          <p className="dashboard-subtitle">Game events and player activity</p>
        </div>
        <NavBtn text="My Games" onClick={handleNav} />
      </div>

      {/* Toolbar */}
      <div className="pn-toolbar" style={{ marginBottom: 16, maxWidth: 840 }}>
        <span className="pn-toolbar-count">
          {loading ? "Loading…" : `${notifications.length} notification${notifications.length !== 1 ? "s" : ""}`}
        </span>
        <button
          className="pn-mark-all-btn"
          onClick={markAllRead}
          disabled={marking || unreadCount === 0}
        >
          {marking ? "Marking…" : "Mark all read"}
        </button>
      </div>

      {/* Error */}
      {error && <div className="op-error" style={{ marginBottom: 16, maxWidth: 840 }}>{error}</div>}

      {loading && (
        <div className="loading-container">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="pn-skeleton-item">
              <div className="pn-skeleton-icon" />
              <div className="pn-skeleton-content">
                <div className="pn-skeleton-title" />
                <div className="pn-skeleton-body" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && notifications.length === 0 && (
        <div className="pn-empty" style={{ maxWidth: 840 }}>
          <div className="pn-empty-icon">🔔</div>
          <div className="pn-empty-title">All caught up!</div>
          <div className="pn-empty-desc">You have no notifications yet. Game events and player activity will appear here.</div>
        </div>
      )}

      {!loading && notifications.length > 0 && (
        <div className="pn-list" style={{ maxWidth: 840 }}>
          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="pn-date-label">{group.label}</div>
              {group.items.map((n) => (
                <button
                  key={n._id}
                  className={`pn-item${!n.isRead ? " pn-item-unread" : ""}`}
                  onClick={() => markRead(n)}
                >
                  <span
                    className="pn-item-icon"
                    style={{ background: TYPE_COLOR[n.type] ?? "rgba(255,255,255,0.06)" }}
                  >
                    {TYPE_ICON[n.type] ?? "ℹ️"}
                  </span>
                  <span className="pn-item-content">
                    <span className="pn-item-title">{n.title}</span>
                    <span className="pn-item-body">{n.body}</span>
                    <span className="pn-item-time">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.isRead && <span className="pn-item-dot" />}
                  {n.actionUrl && <span className="pn-item-arrow">→</span>}
                </button>
              ))}
            </React.Fragment>
          ))}

          {hasMore && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <button className="pn-load-more" onClick={loadMore}>
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
