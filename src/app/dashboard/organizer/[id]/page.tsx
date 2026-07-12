"use client";

import  { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { EditEventModal } from "@/components/dashboard/EditEventModal";
import { PlayerDetailsModal } from "@/components/dashboard/PlayerDetailsModal";
import { PostGameModal } from "@/components/dashboard/PostGameModal";
import { LifecycleAlertModal } from "@/components/dashboard/LifecycleAlertModal";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { buildApiUrl, clearSession, getSession } from "@/utils/api";
import { activeRegCount, filledCount } from "@/utils/playerCount";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import "../../organizer-dashboard.css";

export default function OrganizerDashboard() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPlayersModal, setShowPlayersModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [sosModal, setSosModal] = useState<null | { gameId: string; gameTitle: string; loading: boolean; sending?: boolean; error?: string; regulars: { name: string; games: number; phone: string }[] }>(null);
  const [showPostGameModal, setShowPostGameModal] = useState(false);
  const [postGameTarget, setPostGameTarget] = useState<any>(null);
  const [cancelTargetGame, setCancelTargetGame] = useState<any>(null);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<any>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmLabel, setConfirmLabel]     = useState("Confirm");
  const confirmActionRef = useRef<null | (() => Promise<void>)>(null);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalRefreshing, setModalRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [relativeTime, setRelativeTime] = useState("");
  const isFetchingGamesRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFormat, setFilterFormat] = useState('all');
  const [sortBy, setSortBy] = useState('date-asc');
  const { toast, showToast, hideToast } = useToast();

  // Arriving back from the create-event page: surface its success toast here
  useEffect(() => {
    if (sessionStorage.getItem("kk-game-created")) {
      sessionStorage.removeItem("kk-game-created");
      showToast("success", "Game Created!", "Your event is now live.");
    }
  }, [showToast]);

  const fetchWithLocalFallback = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      try {
        return await fetch(url, init);
      } catch (err) {
        // On some local setups, localhost can fail while 127.0.0.1 works.
        if (
          err instanceof TypeError &&
          url.includes("localhost")
        ) {
          const fallbackUrl = url.replace("localhost", "127.0.0.1");
          return fetch(fallbackUrl, init);
        }
        throw err;
      }
    },
    []
  );

  const fetchGames = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (isFetchingGamesRef.current) return;
    isFetchingGamesRef.current = true;
    try {
      if (!silent) setLoading(true);
      if (!silent) setFetchError(null);
      const { token } = getSession();
      if (!token) {
        if (!silent) setLoading(false);
        clearSession();
        router.replace("/login?role=organiser");
        return;
      }
      
      const res = await fetchWithLocalFallback(buildApiUrl("/api/v1/games/organisers/my-games"), {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearSession();
          router.replace("/login?role=organiser");
          return;
        }
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      
      if (data.success) {
        const nextGames: any[] = data.data || [];
        setGames(nextGames);
        setFetchError(null);  

        if(nextGames.length > 0) 
         {
          const lastEvent=  nextGames.length > 0
              ? [...nextGames].sort(
                  (a, b) =>
                    new Date(b.createdAt || b.scheduledAt).getTime() -
                    new Date(a.createdAt || a.scheduledAt).getTime()
                )[0]
              : undefined  

              
            localStorage.setItem("lastEvent", JSON.stringify(lastEvent));  
          }
        setSelectedGame((prev: any) =>
          prev ? nextGames.find((g) => g._id === prev._id) ?? prev : prev
        );
        setLastUpdated(new Date());
      } else {
        if (!silent) setFetchError(data.message || "Could not load games right now.");
      }
    } catch (error) {
      const msg =
        error instanceof TypeError
          ? "Unable to reach backend. Ensure backend is running on port 5000 and check NEXT_PUBLIC_API_BASE_URL."
          : "Failed to load games. Please try again.";
      if (!silent) setFetchError(msg);
      console.warn("[ORG_DASHBOARD] fetchGames failed:", error);
    } finally {
      if (!silent) setLoading(false);
      isFetchingGamesRef.current = false;
    }
  }, [fetchWithLocalFallback, router]);

  // Silently re-fetch and update selectedGame (used by modal refresh)
  const refreshSelectedGame = useCallback(async (silent = false) => {
    if (!silent) setModalRefreshing(true);
    try {
      await fetchGames({ silent: true });
    } finally {
      if (!silent) setModalRefreshing(false);
    }
  }, [fetchGames]);

  // Auto-poll every 15 s while the players modal is open
  const modalSilentRefresh = useCallback(() => refreshSelectedGame(true), [refreshSelectedGame]);
  useAutoRefresh(showPlayersModal ? modalSilentRefresh : null, { interval: 15_000 });

  // Keep dashboard data fresh — 20 s poll + focus + visibility
  const silentFetch = useCallback(() => fetchGames({ silent: true }), [fetchGames]);
  useAutoRefresh(isAuthorized ? silentFetch : null, { interval: 20_000 });

  // Real-time: re-fetch whenever a socket notification arrives (e.g. guest waitlist changes)
  useEffect(() => {
    const onSocketNotif = () => { silentFetch(); };
    window.addEventListener('kk-new-notification', onSocketNotif);
    return () => window.removeEventListener('kk-new-notification', onSocketNotif);
  }, [silentFetch]);

  // Real-time game count: when the backend broadcasts a player joining/leaving or
  // a guest being added/removed, silently re-fetch so the FULL registrations array
  // (the single source of truth for the count) stays fresh — keeping the table,
  // the players modal, and the count in perfect agreement. Guarded so we only
  // refetch when the changed game is one of this organiser's.
  const gameIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { gameIdsRef.current = new Set(games.map((g) => g._id)); }, [games]);
  useEffect(() => {
    const handler = (e: Event) => {
      const { gameId } = (e as CustomEvent<{ gameId: string }>).detail || {};
      if (gameId && gameIdsRef.current.has(gameId)) silentFetch();
    };
    window.addEventListener('kk-game-update', handler);
    return () => window.removeEventListener('kk-game-update', handler);
  }, [silentFetch]);

  // Tick every 5 s to update "Updated X ago" text
  useEffect(() => {
    function formatRelativeTime(d: Date) {
      const secs = Math.floor((Date.now() - d.getTime()) / 1000);
      if (secs < 5) return "just now";
      if (secs < 60) return `${secs}s ago`;
      return `${Math.floor(secs / 60)}m ago`;
    }
    if (!lastUpdated) return;
    setRelativeTime(formatRelativeTime(lastUpdated));
    const id = setInterval(() => setRelativeTime(formatRelativeTime(lastUpdated)), 5000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    fetchGames();
  }, [isAuthorized, fetchGames]);

  const handleCreateEvent = (_data: any) => {
    fetchGames();
  };

  const handleConfirmGame = async (gameId: string) => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    try {
      const res  = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/confirm`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || "Failed to confirm game"); return; }
      showToast("success", "Game Confirmed!", "Players have been notified.");
      if (data.data) {
        const updated = data.data;
        setGames((prev) => prev.map((g) => g._id === updated._id ? updated : g));
        setSelectedGame((prev: any) => prev?._id === updated._id ? updated : prev);
      } else {
        setGames((prev) => prev.map((g) => g._id === gameId ? { ...g, status: "confirmed" } : g));
      }
    } catch (err) {
      showToast("error", "Failed to confirm game. Please try again.");
    }
  };

  const handleSwitchFormat = async (gameId: string) => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    try {
      const res  = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/switch-format`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || "Failed to switch format"); return; }
      showToast("success", "Format Switched", data.message || "Players have been notified.");
      if (data.data) {
        const updated = data.data;
        setGames((prev) => prev.map((g) => g._id === updated._id ? updated : g));
        setSelectedGame((prev: any) => prev?._id === updated._id ? updated : prev);
      }
    } catch {
      showToast("error", "Failed to switch format. Please try again.");
    }
  };

  const requestSwitchFormat = (game: any) => {
    const alt = game.alternateFormats?.[0];
    const altFeeRs  = typeof alt?.feeInPaise === "number" ? alt.feeInPaise / 100 : null;
    const mainFeeRs = typeof game.feeInPaise === "number" ? game.feeInPaise / 100 : null;
    const diffNote  = (altFeeRs != null && mainFeeRs != null && altFeeRs < mainFeeRs)
      ? ` Remaining players are refunded the ₹${mainFeeRs - altFeeRs} fee difference.`
      : "";
    // Rule 1 — how many active players said "No" to a format change at signup?
    // They're removed + fully refunded automatically when the switch goes through.
    const optOutCount = (game.registrations || []).filter((r: any) =>
      r?.player && !r?.plusOneName &&
      !["refunded", "forfeited"].includes(r?.paymentStatus) && !r?.optedOut &&
      r?.willingIfFormatChange === false
    ).length;
    const isConfirmed = game.status === "confirmed";
    const optOutNote = optOutCount > 0
      ? ` ${optOutCount} player${optOutCount === 1 ? "" : "s"} who said No to format changes will be removed and fully refunded.`
      : " Players who said No to format changes are removed and fully refunded.";
    const undoNote = isConfirmed ? " This game is already confirmed — this cannot be undone." : "";
    setConfirmMessage(`Switch this game to the alternate format${alt?.format ? ` (${alt.format})` : ""}?${optOutNote}${diffNote}${undoNote}`);
    setConfirmLabel("Switch");
    confirmActionRef.current = () => handleSwitchFormat(game._id);
    setConfirmVisible(true);
  };

  const handleSendSos = async (gameId: string) => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    try {
      const res  = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/sos`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || "Failed to send SOS"); return; }
      showToast("success", "SOS Sent", data.message || `Notified ${data.data?.notified ?? 0} regular(s).`);
    } catch {
      showToast("error", "Failed to send SOS. Please try again.");
    }
  };

  // SOS flow: first preview WHO is eligible (per the regulars algorithm), then the
  // organiser confirms with a Send button in the pop-up.
  const requestSendSos = async (game: any) => {
    setSosModal({ gameId: game._id, gameTitle: game.title, loading: true, regulars: [] });
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${game._id}/regulars`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSosModal((m) => (m ? { ...m, loading: false, error: data.message || "Couldn't load eligible players" } : m));
        return;
      }
      setSosModal((m) => (m ? { ...m, loading: false, regulars: data.data?.regulars || [] } : m));
    } catch {
      setSosModal((m) => (m ? { ...m, loading: false, error: "Couldn't load eligible players" } : m));
    }
  };

  const confirmSendSos = async () => {
    if (!sosModal) return;
    setSosModal((m) => (m ? { ...m, sending: true } : m));
    await handleSendSos(sosModal.gameId);
    setSosModal(null);
  };

  const handleOrganiserWithdraw = async (gameId: string) => {
    const doWithdraw = async () => {
      const { token } = getSession();
      if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
      try {
        const res  = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/withdraw`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!res.ok || !data.success) { showToast("error", data.message || "Failed to withdraw"); return; }
        showToast("success", "Withdrawn", "You've been removed from this game.");
        if (data.data) {
          const updated = data.data;
          setGames((prev) => prev.map((g) => g._id === updated._id ? updated : g));
          setSelectedGame((prev: any) => prev?._id === updated._id ? updated : prev);
        } else {
          setGames((prev) => prev.map((g) => g._id === gameId ? { ...g, organiserIsPlaying: false } : g));
        }
      } catch (err) {
        showToast("error", "Failed to withdraw. Please try again.");
      }
    };

    setConfirmMessage('Are you sure you want to withdraw yourself from this game?');
    setConfirmLabel("Withdraw");
    confirmActionRef.current = doWithdraw;
    setConfirmVisible(true);
  };

  const handleRemoveRegistration = async (gameId: string, regId: string) => {
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    try {
      const res  = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/registrations/${regId}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      // Patch immediately from response — no second fetch needed
      if (data.data) {
        const updated = data.data;
        setGames((prev) => prev.map((g) => g._id === updated._id ? updated : g));
        setSelectedGame((prev: any) => prev?._id === updated._id ? updated : prev);
      }
    } catch (err: any) {
      throw err;
    }
  };

  const handleCancelGame = async (gameId: string, message: string) => {
    setCancellingId(gameId);
    try {
      const { token } = getSession();

      if (!token) {
        clearSession();
        router.replace("/login?role=organiser");
        return;
      }

      const response = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cancelMessage: message }),
      });

      const contentType = response.headers.get("content-type") || "";
      const responseText = await response.text();
      const data = contentType.includes("application/json")
        ? JSON.parse(responseText)
        : { success: false, message: responseText || `HTTP ${response.status}` };

      if (response.status === 401 || response.status === 403) {
        clearSession();
        router.replace("/login?role=organiser");
        return;
      }

      if (!response.ok || !data.success) {
        showToast("error", data.message || `Failed to cancel event`);
        return;
      }

      setShowCancelModal(false);
      setCancelTargetGame(null);
      setCancelMessage("");
      showToast("success", "Event Cancelled", "All players have been notified.");
      fetchGames({ silent: true });
    } catch (error) {
      console.error('Error cancelling event:', error);
      showToast("error", "Failed to cancel event. Please try again.");
    } finally {
      setCancellingId(null);
    }
  };

  const openCancelModal = (game: any) => {
    setCancelTargetGame(game);
    setCancelMessage("");
    setShowCancelModal(true);
  };

  // Separate games into upcoming and past based on both status and scheduled date
  const now = new Date();
  const upcomingGames = games.filter(g => {
    const isNotCancelled = g.status !== 'cancelled' && g.status !== 'completed';
    const scheduledDate = new Date(g.scheduledAt);
    const isInFuture = scheduledDate > now;
    return isNotCancelled && isInFuture;
  });

  const pastGames = games.filter(g => {
    const scheduledDate = new Date(g.scheduledAt);
    const isInPast = scheduledDate <= now;
    const isCompleted = g.status === 'completed';
    const isCancelled = g.status === 'cancelled';
    return isInPast || isCompleted || isCancelled;
  });

  // All counts go through the shared single-source-of-truth helpers so the table,
  // sorting, and the players modal can never disagree.
  const getActiveRegs   = (game: any) => activeRegCount(game);
  const getTotalPlayers = (game: any) => filledCount(game);

  const allFormats = [...new Set(games.map((g: any) => g.format).filter(Boolean))] as string[];

  const applyFilters = (list: any[]) => {
    let result = [...list];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.turf?.name?.toLowerCase().includes(q) ||
        g.turf?.address?.city?.toLowerCase().includes(q) ||
        g.format?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') result = result.filter(g => g.status === filterStatus);
    if (filterFormat !== 'all') result = result.filter(g => g.format === filterFormat);
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date-asc':   return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
        case 'date-desc':  return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
        case 'players-desc': return getTotalPlayers(b) - getTotalPlayers(a);
        case 'fee-asc':    return (a.feeInPaise || 0) - (b.feeInPaise || 0);
        case 'fee-desc':   return (b.feeInPaise || 0) - (a.feeInPaise || 0);
        default: return 0;
      }
    });
    return result;
  };

  const filteredUpcoming = applyFilters(upcomingGames);
  const filteredPast     = applyFilters(pastGames);
  const hasActiveFilters = !!(searchQuery || filterStatus !== 'all' || filterFormat !== 'all' || sortBy !== 'date-asc');
  const clearFilters = () => { setSearchQuery(''); setFilterStatus('all'); setFilterFormat('all'); setSortBy('date-asc'); };

  const handleLogout = () => {
  clearSession(); // ✅ better than localStorage.clear()
  router.replace("/login?role=organiser");
};

  return (
    <div className="organizer-dashboard-container">
      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}

      {/* Header */}
      <div className="dashboard-header-section">
        <div className="header-left">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 className="dashboard-title">Organizer Dashboard</h1>
            <span className="live-badge"><span className="live-dot" />Live</span>
          </div>
          <p className="dashboard-subtitle">
            Manage your events, track players, and monitor revenue
          </p>
        </div>
        <button className="btn-primary btn-lg" onClick={() => router.push(`/dashboard/organizer/${organiserId}/create-event`)}>
          <span className="btn-icon">+ </span>Create New Event
        </button>
      </div>

      <ConfirmationModal
        open={confirmVisible}
        title={confirmLabel === "Switch" ? "Switch to alternate format" : confirmLabel === "Send SOS" ? "Send SOS to regulars" : "Withdraw from game"}
        message={confirmMessage || "Are you sure you want to continue?"}
        confirmLabel={confirmLabel}
        cancelLabel={confirmLabel === "Withdraw" ? "Keep me in" : "Cancel"}
        onCancel={() => {
          setConfirmVisible(false);
          confirmActionRef.current = null;
          setConfirmMessage(null);
        }}
        onConfirm={async () => {
          setConfirmVisible(false);
          const act = confirmActionRef.current;
          confirmActionRef.current = null;
          setConfirmMessage(null);
          if (act) {
            await act();
          }
        }}
      />

      {/* Confirmation-algorithm pop-up: shows when a game needs a decision or the 30-min reminder */}
      <LifecycleAlertModal
        games={games}
        onConfirm={handleConfirmGame}
        onSwitch={requestSwitchFormat}
        onSos={requestSendSos}
        onCancel={(g) => { setCancelTargetGame(g); setCancelMessage(""); setShowCancelModal(true); }}
      />

      {/* SOS preview — shows the eligible regulars before sending */}
      {sosModal && (
        <div className="modal-overlay" onClick={() => setSosModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "#111214", border: "1px solid #2a2a2a", borderRadius: 16, padding: 22, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📣 Send SOS</h2>
              <button onClick={() => setSosModal(null)} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 12px", lineHeight: 1.5 }}>
              Eligible regulars for <b style={{ color: "#ddd" }}>{sosModal.gameTitle}</b> — players who've played at this venue &amp; time often. Review, then send.
            </p>
            {sosModal.loading ? (
              <div style={{ padding: 22, textAlign: "center", color: "#888", fontSize: 13 }}>Finding eligible regulars…</div>
            ) : sosModal.error ? (
              <div style={{ padding: 12, color: "#f87171", fontSize: 13 }}>{sosModal.error}</div>
            ) : sosModal.regulars.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", color: "#999", fontSize: 13, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid #222" }}>
                No eligible regulars for this venue &amp; time yet.
              </div>
            ) : (
              <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #262626", borderRadius: 10 }}>
                {sosModal.regulars.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: i < sosModal.regulars.length - 1 ? "1px solid #1c1c1c" : "none" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#eee" }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: "#777" }}>{r.phone}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#c8ff3e", background: "rgba(200,255,62,0.1)", border: "1px solid rgba(200,255,62,0.25)", borderRadius: 20, padding: "2px 9px" }}>
                      {r.games} games
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setSosModal(null)} style={{ flex: 1, padding: 11, borderRadius: 9, border: "1px solid #333", background: "transparent", color: "#ccc", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button
                disabled={sosModal.loading || sosModal.sending || sosModal.regulars.length === 0}
                onClick={confirmSendSos}
                style={{ flex: 2, padding: 11, borderRadius: 9, border: "none", fontWeight: 800,
                  background: sosModal.regulars.length === 0 || sosModal.loading ? "#2a2a2a" : "#c8ff3e",
                  color: sosModal.regulars.length === 0 || sosModal.loading ? "#888" : "#000",
                  cursor: sosModal.regulars.length === 0 || sosModal.loading ? "not-allowed" : "pointer", opacity: sosModal.sending ? 0.7 : 1 }}
              >
                {sosModal.sending ? "Sending…" : sosModal.regulars.length === 0 ? "No one to notify" : `Send SOS to ${sosModal.regulars.length} regular${sosModal.regulars.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {fetchError && (
        <div style={{
          marginBottom: 14,
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.28)",
          color: "#fda4af",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 13,
          fontWeight: 600,
        }}>
          {fetchError}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs-section">
        <div className="tab-navigation">
          <button
            className={`tab-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
            onClick={() => setActiveTab('upcoming')}
          >
            <span className="tab-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
            <span className="tab-text">Upcoming Events</span>
            <span className="tab-badge">{upcomingGames.length}</span>
          </button>
          <button
            className={`tab-btn ${activeTab === 'past' ? 'active' : ''}`}
            onClick={() => setActiveTab('past')}
          >
            <span className="tab-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            <span className="tab-text">Past Events</span>
            <span className="tab-badge">{pastGames.length}</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      {!loading && games.length > 0 && (
        <div className="filter-bar">
          <div className="filter-search-wrap">
            <svg className="filter-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="filter-search-input"
              type="text"
              placeholder="Search by title, venue, city, format…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="filter-search-clear" onClick={() => setSearchQuery('')} title="Clear search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="tentative">Tentative</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select className="filter-select" value={filterFormat} onChange={e => setFilterFormat(e.target.value)}>
            <option value="all">All Formats</option>
            {allFormats.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <select className="filter-select filter-sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="date-asc">Date ↑</option>
            <option value="date-desc">Date ↓</option>
            <option value="players-desc">Most Players</option>
            <option value="fee-asc">Fee ↑</option>
            <option value="fee-desc">Fee ↓</option>
          </select>

          {hasActiveFilters && (
            <button className="filter-clear-btn" onClick={clearFilters} title="Clear all filters">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Clear
            </button>
          )}

          <span className="filter-result-count">
            {activeTab === 'upcoming' ? filteredUpcoming.length : filteredPast.length}
            {' '}/{' '}
            {activeTab === 'upcoming' ? upcomingGames.length : pastGames.length} events
          </span>
        </div>
      )}

      {/* Table Section */}
      <div className="table-section">
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading events...</p>
          </div>
        ) : activeTab === 'upcoming' ? (
          filteredUpcoming.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              {hasActiveFilters ? (
                <>
                  <h3>No events match your filters</h3>
                  <p>Try adjusting your search or filters</p>
                  <button className="btn-primary" onClick={clearFilters}>Clear Filters</button>
                </>
              ) : (
                <>
                  <h3>No upcoming events</h3>
                  <p>Create your first event to get started</p>
                  <button className="btn-primary" onClick={() => router.push(`/dashboard/organizer/${organiserId}/create-event`)}>
                    <span>+ </span>Create Event
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="games-table">
              <div className="table-header">
                <div className="col col-title">Event</div>
                <div className="col col-details">Venue & Date</div>
                <div className="col col-format">Format</div>
                <div className="col col-fee">Fee</div>
                <div className="col col-players">Players</div>
                <div className="col col-actions">Actions</div>
              </div>
              <div className="table-body">
                {filteredUpcoming.map(game => (
                  <div key={game._id} className="table-row">
                    <div className="col col-title">
                      <div className="game-title-col">
                        <div className="title-main">{game.title}</div>
                        <div className="status-inline">
                          <span className={`status-label ${game.status}`}>{game.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="col col-details">
                      <div className="venue-info">
                        <div className="venue-name">{game.turf?.name || 'Unknown'}</div>
                        <div className="venue-location">{(game.turf as any)?.address?.city || ''}</div>
                        <div className="date-time">
                          {new Date(game.scheduledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} · {new Date(game.scheduledAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {game.reportingMinsBeforeGame > 0 && (
                          <div className="date-time" style={{ color: '#7a7a7a', fontSize: 10.5, marginTop: 3 }}>
                            Report {(() => {
                              const d = new Date(new Date(game.scheduledAt).getTime() - game.reportingMinsBeforeGame * 60000);
                              return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                            })()}
                            {game.endsAt && ` · Ends ${new Date(game.endsAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`}
                          </div>
                        )}
                        {(game.lifecycle?.firstCheckAt || game.lifecycle?.secondCheckAt) && (() => {
                          const gDay = new Date(game.scheduledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
                          const fmt = (v: any) => {
                            const dt = new Date(v);
                            const t = dt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                            return dt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === gDay
                              ? t
                              : `${dt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}, ${t}`;
                          };
                          const pill = (label: string, v: any) => v ? (
                            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#b7d16a', background: 'rgba(200,255,62,0.06)', border: '1px solid rgba(200,255,62,0.18)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: '#87984f', fontWeight: 700 }}>{label}</span>{fmt(v)}
                            </span>
                          ) : null;
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 6 }} title="Automatic confirmation check-in times">
                              <span style={{ fontSize: 10, color: '#666', marginRight: 1 }}>⏱</span>
                              {pill('1st', game.lifecycle?.firstCheckAt)}
                              {pill('2nd', game.lifecycle?.secondCheckAt)}
                            </div>
                          );
                        })()}
                        {game.organiserIsPlaying && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#c8ff3e', fontWeight: 600, marginTop: 6 }}>⚽ You are playing</div>
                        )}
                      </div>
                    </div>
                    <div className="col col-format">
                      <span className="format-badge">{game.format}</span>
                      {game.allowSizeChange && (
                        <div style={{ fontSize: 10, color: '#888', marginTop: 3 }} title="Format change allowed">⇄ flexible</div>
                      )}
                    </div>
                    <div className="col col-fee">
                      <div className="fee-value">₹{game.feeInPaise ? game.feeInPaise / 100 : 0}</div>
                    </div>
                    <div className="col col-players">
                      {(() => {
                        const total = filledCount(game);
                        return (
                          <div className="players-info">
                            <div className="players-count">{total}/{game.totalSlots}</div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="col col-actions">
                      <div className="action-buttons">
                        <button
                          className="btn-action btn-players"
                          onClick={() => { setSelectedGame(game); setShowPlayersModal(true); }}
                          title="View Players"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                          <span className="btn-label">Players</span>
                        </button>
                        <button
                          className="btn-action btn-edit"
                          onClick={() => { setSelectedGame(game); setShowEditModal(true); }}
                          title="Edit Event"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                          <span className="btn-label">Edit</span>
                        </button>
                        {['open','tentative'].includes(game.status) && (
                          <button
                            className="btn-action btn-confirm"
                            onClick={() => handleConfirmGame(game._id)}
                            title="Confirm Game"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span className="btn-label">Confirm</span>
                          </button>
                        )}
                        {['open','tentative','confirmed'].includes(game.status) && game.alternateFormats?.length > 0 && !game.lifecycle?.switchedAt && (
                          <button
                            className="btn-action btn-edit"
                            onClick={() => requestSwitchFormat(game)}
                            title={`Switch to alternate format${game.alternateFormats[0]?.format ? ` (${game.alternateFormats[0].format})` : ""}`}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                            </svg>
                            <span className="btn-label">Switch</span>
                          </button>
                        )}
                        {/* SOS: open/tentative + confirmed — a confirmed game still accepts
                            registrations, and the post-switch shortfall prompt offers SOS */}
                        {['open','tentative','confirmed'].includes(game.status) && (
                          <button
                            className="btn-action btn-edit"
                            onClick={() => requestSendSos(game)}
                            title="Send SOS to venue regulars"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
                            </svg>
                            <span className="btn-label">SOS</span>
                          </button>
                        )}
                        {game.organiserIsPlaying && (
                          <button
                            className="btn-action btn-withdraw"
                            onClick={() => handleOrganiserWithdraw(game._id)}
                            title="Withdraw from game"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                            </svg>
                            <span className="btn-label">Withdraw</span>
                          </button>
                        )}
                        {!['cancelled', 'completed'].includes(game.status) && new Date(game.scheduledAt).getTime() <= Date.now() && (
                          <button
                            className="btn-action btn-complete"
                            onClick={() => { setPostGameTarget(game); setShowPostGameModal(true); }}
                            title="Complete Game & Rate Players"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                              <line x1="4" y1="22" x2="4" y2="15"/>
                            </svg>
                            <span className="btn-label">Complete</span>
                          </button>
                        )}
                        <button
                          className="btn-action btn-cancel"
                          onClick={() => openCancelModal(game)}
                          title="Cancel Event"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                          <span className="btn-label">Cancel</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          filteredPast.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              {hasActiveFilters ? (
                <>
                  <h3>No events match your filters</h3>
                  <p>Try adjusting your search or filters</p>
                  <button className="btn-primary" onClick={clearFilters}>Clear Filters</button>
                </>
              ) : (
                <>
                  <h3>No past events yet</h3>
                  <p>Completed events will appear here</p>
                </>
              )}
            </div>
          ) : (
            <div className="games-table">
              <div className="table-header">
                <div className="col col-title">Event</div>
                <div className="col col-details">Venue & Date</div>
                <div className="col col-format">Format</div>
                <div className="col col-fee">Fee</div>
                <div className="col col-players">Attended</div>
                <div className="col col-postgame">Post-Game</div>
                <div className="col col-actions">Actions</div>
              </div>
              <div className="table-body">
                {filteredPast.map(game => (
                  <div key={game._id} className="table-row">
                    <div className="col col-title">
                      <div className="game-title-col">
                        <div className="title-main">{game.title}</div>
                        <div className="status-inline">
                          <span className={`status-label ${game.status}`}>{game.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="col col-details">
                      <div className="venue-info">
                        <div className="venue-name">{game.turf?.name || 'Unknown'}</div>
                        <div className="venue-location">{(game.turf as any)?.address?.city || ''}</div>
                        <div className="date-time">
                          {new Date(game.scheduledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </div>
                      </div>
                    </div>
                    <div className="col col-format">
                      <span className="format-badge">{game.format}</span>
                      {game.allowSizeChange && (
                        <div style={{ fontSize: 10, color: '#888', marginTop: 3 }} title="Format change allowed">⇄ flexible</div>
                      )}
                    </div>
                    <div className="col col-fee">
                      <div className="fee-value">₹{game.feeInPaise ? game.feeInPaise / 100 : 0}</div>
                    </div>
                    <div className="col col-players">
                      <div className="players-count">
                        {getTotalPlayers(game)}
                      </div>
                    </div>
                    <div className="col col-postgame">
                      {game.status === 'completed' ? (
                        <div className="postgame-stats">
                          <div className="postgame-stat">
                            <span className="postgame-label">Present:</span>
                            <span className="postgame-value">
                              {game.registrations?.filter((r: any) => r.attended === 'present').length || 0}
                            </span>
                          </div>
                          <div className="postgame-stat">
                            <span className="postgame-label">Ratings:</span>
                            <span className="postgame-value">
                              {game.playerRatingsCount || 0}
                            </span>
                          </div>
                          <div className="postgame-stat">
                            <span className="postgame-label">Feedback:</span>
                            <span className="postgame-value">
                              {game.feedbackCount || 0}
                            </span>
                          </div>
                        </div>
                      ) : game.status === 'cancelled' ? (
                        <div className="postgame-cancelled">
                          <span>Cancelled</span>
                        </div>
                      ) : (
                        <div className="postgame-pending">
                          <span>Pending</span>
                        </div>
                      )}
                    </div>
                    <div className="col col-actions">
                      <div className="action-buttons">
                        <button
                          className="btn-action btn-players"
                          onClick={() => { setSelectedGame(game); setShowPlayersModal(true); }}
                          title="View Players"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                          <span className="btn-label">Players</span>
                        </button>
                        {game.status !== 'completed' && game.status !== 'cancelled' && (
                          <button
                            className="btn-action btn-complete"
                            onClick={() => { setPostGameTarget(game); setShowPostGameModal(true); }}
                            title="Complete Game & Rate Players"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                              <line x1="4" y1="22" x2="4" y2="15"/>
                            </svg>
                            <span className="btn-label">Complete</span>
                          </button>
                        )}
                        {game.status === 'completed' && !game.attendanceMarked && (
                          <button
                            className="btn-action btn-attendance"
                            onClick={() => { setPostGameTarget(game); setShowPostGameModal(true); }}
                            title="Mark Attendance & Rate Players"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                            </svg>
                            <span className="btn-label">Attendance</span>
                          </button>
                        )}
                        {game.status === 'completed' && game.attendanceMarked && (
                          <button
                            className="btn-action btn-ratings"
                            onClick={() => { setPostGameTarget(game); setShowPostGameModal(true); }}
                            title="View / Edit Ratings"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                            <span className="btn-label">Ratings</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>

      {/* Modals */}
      {showEditModal && selectedGame && (
        <EditEventModal
          gameId={selectedGame._id}
          initialData={selectedGame}
          onClose={() => {
            setShowEditModal(false);
            setSelectedGame(null);
          }}
          onSuccess={() => {
            fetchGames({ silent: true });
          }}
          onParticipationChange={() => fetchGames({ silent: true })}
        />
      )}

      {showPlayersModal && selectedGame && (
        <PlayerDetailsModal
          gameId={selectedGame._id}
          gameName={selectedGame.title}
          gameStatus={selectedGame.status}
          players={selectedGame.registrations || []}
          waitlist={selectedGame.waitlist || []}
          guestWaitlist={selectedGame.guestWaitlist || []}
          totalSlots={selectedGame.totalSlots}
          spotsRemaining={typeof selectedGame.spotsRemaining === 'number' ? selectedGame.spotsRemaining : undefined}
          organiserIsPlaying={Boolean(selectedGame.organiserIsPlaying)}
          scheduledAt={selectedGame.scheduledAt}
          venue={selectedGame.turf?.name}
          location={selectedGame.turf?.address?.city || selectedGame.turf?.location || ''}
          feeInPaise={selectedGame.feeInPaise}
          format={selectedGame.format}
          reportingMinsBeforeGame={selectedGame.reportingMinsBeforeGame}
          onToggleOrganiserPlaying={() => handleOrganiserWithdraw(selectedGame._id)}
          onRemoveRegistration={async (regId) => {
            await handleRemoveRegistration(selectedGame._id, regId);
          }}
          onRefresh={() => refreshSelectedGame(false)}
          onGameUpdate={(updated) => {
            setGames((prev) => prev.map((g) => g._id === updated._id ? updated : g));
            setSelectedGame((prev: any) => prev?._id === updated._id ? updated : prev);
          }}
          isRefreshing={modalRefreshing}
          onClose={() => {
            setShowPlayersModal(false);
            setSelectedGame(null);
          }}
        />
      )}

      {showPostGameModal && postGameTarget && (
        <PostGameModal
          game={postGameTarget}
          onClose={() => { setShowPostGameModal(false); setPostGameTarget(null); }}
          onDone={() => {
            setShowPostGameModal(false);
            setPostGameTarget(null);
            showToast("success", "Ratings Saved!", "Post-game report complete.");
            fetchGames({ silent: true });
          }}
        />
      )}

      {showCancelModal && cancelTargetGame && (
        <div className="modal-overlay" onClick={() => { setShowCancelModal(false); setCancelTargetGame(null); setCancelMessage(""); }}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            {/* Header: warning icon + title + summary */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(192,57,43,0.14)",
                  border: "1px solid rgba(192,57,43,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  lineHeight: 1,
                }}
              >
                ⚠️
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                Cancel this event?
              </h2>
              <p style={{ margin: 0, color: "#9ca3af", fontSize: 14, lineHeight: 1.55 }}>
                You're about to cancel <strong style={{ color: "#fff" }}>{cancelTargetGame.title}</strong>.
                All registered players will be <strong style={{ color: "#fff" }}>refunded</strong> and notified by email.
              </p>
            </div>

            {/* Message field */}
            <div style={{ marginTop: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#d1d5db" }}>
                Message to players <span style={{ color: "#6b7280", fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                rows={4}
                value={cancelMessage}
                onChange={(e) => setCancelMessage(e.target.value)}
                placeholder="e.g. Due to bad weather, we're unable to host this event. Apologies for the inconvenience."
                style={{
                  width: "100%",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  resize: "vertical",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(192,57,43,0.6)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
              />
              <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 12, lineHeight: 1.4 }}>
                This note is included in the cancellation email each player receives.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button
                type="button"
                onClick={() => { setShowCancelModal(false); setCancelTargetGame(null); setCancelMessage(""); }}
                disabled={cancellingId === cancelTargetGame._id}
                style={{
                  flex: 1,
                  padding: "11px 16px",
                  borderRadius: 8,
                  cursor: cancellingId === cancelTargetGame._id ? "not-allowed" : "pointer",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "#e5e7eb",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Go Back
              </button>
              <button
                type="button"
                className="btn-cancel-confirm"
                disabled={cancellingId === cancelTargetGame._id}
                onClick={() => handleCancelGame(cancelTargetGame._id, cancelMessage)}
                style={{
                  flex: 1,
                  padding: "11px 16px",
                  borderRadius: 8,
                  background: "#c0392b",
                  color: "#fff",
                  border: "none",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: cancellingId === cancelTargetGame._id ? "not-allowed" : "pointer",
                  opacity: cancellingId === cancelTargetGame._id ? 0.7 : 1,
                }}
              >
                {cancellingId === cancelTargetGame._id ? "Cancelling…" : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}