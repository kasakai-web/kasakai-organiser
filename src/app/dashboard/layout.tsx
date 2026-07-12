"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { SuccessPopup } from "@/components/ui/SuccessPopup";

const SERVER_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1").replace(/\/api\/v1\/?$/, "");
import "./dashboard.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [userId, setUserId] = useState<string>("");
  const [userName, setUserName] = useState<string>("User");
  const [userProfileImage, setUserProfileImage] = useState<string>("");
  const [activeSection, setActiveSection] = useState("games");
  const [authResolved, setAuthResolved] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [sidebarUnread, setSidebarUnread] = useState(0);
  const [showPhotoReminder, setShowPhotoReminder] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const resolveProfileImageUrl = useCallback((img?: string | null) => {
    if (!img) return "";
    if (/^(https?:|data:|blob:)/i.test(img)) return img;
    if (img.startsWith("/")) return `${SERVER_BASE}${img}`;
    return `${SERVER_BASE}/${img}`;
  }, []);

  const refreshSidebarProfile = useCallback(async () => {
    const { token } = getSession();
    if (!token) return;

    try {
      const res = await fetch(buildApiUrl("/api/v1/organisers/me"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const name = data?.data?.name;
      const img = data?.data?.profileImage;
      if (name) {
        setUserName(name);
        localStorage.setItem("userName", name);
      }
      {
        const url = resolveProfileImageUrl(img);
        setUserProfileImage(url);
        if (url) {
          localStorage.setItem("userProfileImage", url);
        } else {
          localStorage.removeItem("userProfileImage");
        }
      }
    } catch {
      // non-critical
    }
  }, [resolveProfileImageUrl]);

  useEffect(() => {
    const { token: authToken, role: storedRole, userId: storedUserId } = getSession();
    const storedUserName = typeof window !== "undefined" ? localStorage.getItem("userName") : null;
    const storedProfileImage = typeof window !== "undefined" ? localStorage.getItem("userProfileImage") : null;

    if (storedUserName) {
      setUserName(storedUserName);
    }
    if (storedProfileImage) {
      setUserProfileImage(resolveProfileImageUrl(storedProfileImage));
    }

    if (storedUserId) {
      setUserId(storedUserId);
    }

    if (authToken && storedRole && storedUserId) {
      const normalizedRole = storedRole === "organizer" ? "organiser" : storedRole;

      if (normalizedRole !== "organiser") {
        clearSession();
        setAuthenticated(false);
        router.replace("/login");
        setAuthResolved(true);
        return;
      }

      setAuthenticated(true);
      if (localStorage.getItem("requirePhotoUpload") === "true") {
        setShowPhotoReminder(true);
      }
    } else {
      setAuthenticated(false);
      clearSession();
      router.replace("/login");
    }

    setAuthResolved(true);
  }, [pathname, resolveProfileImageUrl, router]);

  // Re-read profile image from localStorage whenever path changes (e.g. after profile page update)
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("userProfileImage") : null;
    setUserProfileImage(resolveProfileImageUrl(stored));
    if (pathname.includes("/profile") || stored) {
      setShowPhotoReminder(false);
    }
  }, [pathname, resolveProfileImageUrl]);

  // Keep sidebar profile data synced without hard refresh.
  useEffect(() => {
    if (!authenticated) return;
    refreshSidebarProfile();
  }, [authenticated, refreshSidebarProfile]);

  useAutoRefresh(authenticated ? refreshSidebarProfile : null, { interval: 30_000 });

  const refreshUnreadCount = useCallback(async () => {
    const { token } = getSession();
    if (!token) return;
    try {
      const res = await fetch(buildApiUrl("/api/v1/notifications/unread-count"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.success) setSidebarUnread(data.data?.count ?? 0);
    } catch {}
  }, []);

  useEffect(() => { if (authenticated) refreshUnreadCount(); }, [authenticated, refreshUnreadCount, pathname]);
  useAutoRefresh(authenticated ? refreshUnreadCount : null, { interval: 15_000 });

  // Real-time notification badge via Socket.io event relayed by SocketClient
  useEffect(() => {
    const onNewNotification = () => {
      if (authenticated) refreshUnreadCount();
    };
    window.addEventListener("kk-new-notification", onNewNotification);
    return () => window.removeEventListener("kk-new-notification", onNewNotification);
  }, [authenticated, refreshUnreadCount]);

  // Storage events keep sidebar in sync when profile is updated in another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "userName" && e.newValue) setUserName(e.newValue);
      if (e.key === "userProfileImage") setUserProfileImage(resolveProfileImageUrl(e.newValue || ""));
    };

    const onProfileUpdated = (evt: Event) => {
      const customEvt = evt as CustomEvent<{ name?: string; profileImage?: string }>;
      const nextName = customEvt.detail?.name;
      const nextImage = customEvt.detail?.profileImage;
      if (nextName) setUserName(nextName);
      if (nextImage !== undefined) {
        setUserProfileImage(resolveProfileImageUrl(nextImage));
        if (nextImage) setShowPhotoReminder(false);
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("organiser-profile-updated", onProfileUpdated as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("organiser-profile-updated", onProfileUpdated as EventListener);
    };
  }, [resolveProfileImageUrl]);

  useEffect(() => {
    if (pathname.includes("/dashboard/organizer/") && pathname.endsWith("/notifications")) {
      setActiveSection("notifications");
      return;
    }
    if (pathname.includes("/dashboard/organizer/") && pathname.endsWith("/profile")) {
      setActiveSection("profile");
      return;
    }
    if (pathname.includes("/dashboard/organizer/") && pathname.endsWith("/performance")) {
      setActiveSection("performance");
      return;
    }
    if (pathname.includes("/dashboard/organizer/") && pathname.endsWith("/finance")) {
      setActiveSection("finance");
      return;
    }
    setActiveSection("games");
  }, [pathname]);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLogoutSuccess, setShowLogoutSuccess] = useState(false);

  const doLogout = () => {
    clearSession();
    localStorage.removeItem("userProfileImage");
    router.replace("/login");
  };

  const handleLogout = () => setShowLogoutConfirm(true);

  if (!authResolved || !authenticated) {
    return null;
  }

  return (
    <div className="dashboard-app-wrapper">
      <ConfirmationModal
        open={showLogoutConfirm}
        title="Log Out"
        message="Are you sure you want to log out of Kasakai?"
        confirmLabel="Yes, Log Out"
        onConfirm={() => { setShowLogoutConfirm(false); setShowLogoutSuccess(true); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
      <SuccessPopup
        show={showLogoutSuccess}
        message="Logged out. See you on the pitch! 👋"
        onClose={doLogout}
      />

      {/* NAVBAR */}
      <nav className="dashboard-nav">
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            height: "66px",
            padding: "0 26px",
            textDecoration: "none",
            flexShrink: 0,
            gap: "12px",
            transition: "background 0.18s",
          }}
        >
          <div style={{
            display: "flex",
            flexDirection: "column",
            width: "34px",
            height: "34px",
            overflow: "hidden",
            border: "1.5px solid #333",
            flexShrink: 0,
          }}>
            <div style={{ flex: 1, background: "var(--white)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: "var(--cond)", fontWeight: 900, fontSize: "8px", letterSpacing: "0.08em", color: "#000" }}>KASA</span>
            </div>
            <div style={{ flex: 1, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", borderTop: "1.5px solid #333" }}>
              <span style={{ fontFamily: "var(--cond)", fontWeight: 900, fontSize: "8px", letterSpacing: "0.08em", color: "var(--white)" }}>KAI</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, gap: 0 }}>
            <p style={{ fontFamily: "var(--cond)", fontWeight: 800, fontSize: "16px", letterSpacing: "0.14em", color: "var(--white)", lineHeight: 1 }}>KASA</p>
            <p style={{ fontFamily: "var(--cond)", fontWeight: 800, fontSize: "16px", letterSpacing: "0.14em", color: "var(--muted)", lineHeight: 1 }}>KAI</p>
          </div>
        </Link>

        <div className="nav-center">
          <div className="role-tab active organiser" style={{ cursor: "default" }}>Organiser Dashboard</div>
        </div>

        <div className="nav-right" style={{ paddingRight: "8px", gap: "4px" }}>
          <NotificationBell unreadCount={sidebarUnread} onViewAll={() => {
            if (userId) router.push(`/dashboard/organizer/${userId}/notifications`);
          }} />
          <button className="sidebar-link" onClick={handleLogout} style={{ color: "#ff4444", opacity: 0.9 }}>
            <span className="sidebar-icon">🚪</span>Log Out
          </button>
        </div>

        {/* Mobile sidebar toggle */}
        <button
          className="mobile-sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? (
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </nav>

      <div className="dashboard-app">
        {/* Sidebar overlay (mobile) */}
        <div
          className={`sidebar-overlay ${sidebarOpen ? "sidebar-open" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* SIDEBAR */}
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} id="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Organiser</div>
            <button
              className={`sidebar-link ${activeSection === 'games' ? 'active' : ''}`}
              onClick={() => {
                setActiveSection("games");
                setSidebarOpen(false);
                if (userId) {
                  router.push(`/dashboard/organizer/${userId}`);
                }
              }}
            >
              <span className="sidebar-icon">🗂</span>My Games
            </button>
            <button
              className={`sidebar-link ${activeSection === 'performance' ? 'active' : ''}`}
              onClick={() => {
                setActiveSection("performance");
                setSidebarOpen(false);
                if (userId) router.push(`/dashboard/organizer/${userId}/performance`);
              }}
            >
              <span className="sidebar-icon">📊</span>My Feedback
            </button>
            <button
              className={`sidebar-link ${activeSection === 'finance' ? 'active' : ''}`}
              onClick={() => {
                setActiveSection("finance");
                setSidebarOpen(false);
                if (userId) router.push(`/dashboard/organizer/${userId}/finance`);
              }}
            >
              <span className="sidebar-icon">💰</span>Financials
            </button>
            <button
              className={`sidebar-link ${activeSection === 'notifications' ? 'active' : ''}`}
              onClick={() => {
                setActiveSection("notifications");
                setSidebarOpen(false);
                if (userId) router.push(`/dashboard/organizer/${userId}/notifications`);
              }}
            >
              <span className="sidebar-icon">🔔</span>Notifications
              {sidebarUnread > 0 && (
                <span style={{ marginLeft: "auto", background: "#ff4444", color: "#fff", fontFamily: "var(--mono)", fontSize: "9px", padding: "2px 6px", borderRadius: "10px", fontWeight: 700 }}>
                  {sidebarUnread > 99 ? "99+" : sidebarUnread}
                </span>
              )}
            </button>
            <button
              className={`sidebar-link ${activeSection === 'profile' ? 'active' : ''}`}
              onClick={() => {
                setActiveSection("profile");
                setSidebarOpen(false);
                if (userId) {
                  router.push(`/dashboard/organizer/${userId}/profile`);
                }
              }}
            >
              <span className="sidebar-icon">👤</span>Profile
            </button>
          </div>

          <div className="sidebar-bottom">
            <button
              className="sidebar-link sidebar-profile-btn"
              onClick={() => {
                setActiveSection("profile");
                setSidebarOpen(false);
                if (userId) router.push(`/dashboard/organizer/${userId}/profile`);
              }}
            >
              <div className="user-avatar" style={{ overflow: "hidden" }}>
                {userProfileImage ? (
                  <img src={userProfileImage} alt={userName} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => { setUserProfileImage(""); localStorage.removeItem("userProfileImage"); }} />
                ) : (
                  userName.substring(0, 2).toUpperCase()
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="user-name" style={{ fontWeight: 600, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</span>
                <span style={{ color: "var(--muted)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Organiser</span>
              </div>
            </button>

            <button
              className="sidebar-link sidebar-logout-btn"
              onClick={handleLogout}
            >
              <span className="sidebar-icon">🚪</span>Log Out
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="dashboard-main">
          {showPhotoReminder && (
            <div style={{
              background: "rgba(200,255,62,0.08)",
              border: "1px solid rgba(200,255,62,0.3)",
              borderRadius: "8px",
              padding: "12px 16px",
              margin: "16px 16px 0",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "18px" }}>📸</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, color: "#c8ff3e", fontWeight: 700, fontSize: "14px" }}>Profile photo required</p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                  Add a profile photo so players can recognise you as their organiser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (userId) router.push(`/dashboard/organizer/${userId}/profile`); }}
                style={{
                  background: "#c8ff3e", color: "#000", border: "none",
                  borderRadius: "6px", padding: "7px 14px",
                  fontSize: "12px", fontWeight: 700, cursor: "pointer", flexShrink: 0,
                }}
              >
                Add Photo
              </button>
              <button
                type="button"
                onClick={() => { setShowPhotoReminder(false); localStorage.removeItem("requirePhotoUpload"); }}
                aria-label="Dismiss"
                style={{
                  background: "none", border: "none", color: "var(--muted)",
                  cursor: "pointer", fontSize: "18px", lineHeight: 1, flexShrink: 0, padding: "0 4px",
                }}
              >
                ×
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
