"use client";

import  { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { EditEventModal } from "@/components/dashboard/EditEventModal";
import { PlayerDetailsModal } from "@/components/dashboard/PlayerDetailsModal";
import { PostGameModal } from "@/components/dashboard/PostGameModal";
import { LifecycleAlertModal } from "@/components/dashboard/LifecycleAlertModal";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { buildApiUrl, clearSession, getSession, resolveImageUrl } from "@/utils/api";
import { activeRegCount, filledCount } from "@/utils/playerCount";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import "../../organizer-dashboard.css"; 
import GameCard from "@/components/dashboard/GameCard/GameCard";
import CoOrganiserModal from "@/components/dashboard/CoOrganiserModal";
import { TeamSheetHistory } from "@/components/dashboard/TeamSheetHistory";


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
  // Private-game invitations
  const [inviteGameId, setInviteGameId] = useState<string | null>(null);
  const [inviteRegulars, setInviteRegulars] = useState<{ id?: string; name: string; phone: string; games: number }[]>([]);
  const [inviteRegLoading, setInviteRegLoading] = useState(false);
  const [inviteRows, setInviteRows] = useState<{ name: string; phone?: string; playerId?: string }[]>([]);
  const [inviteName, setInviteName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteActionId, setInviteActionId] = useState<string | null>(null);
  // Player-search typeahead (debounced) inside the invite modal
  const [inviteSearch, setInviteSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ _id: string; name: string; phone?: string; email?: string; profileImage?: string; totalGamesPlayed?: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // Shared invite-link management
  const [linkBusy, setLinkBusy] = useState(false);
  const [maxJoinsInput, setMaxJoinsInput] = useState<string>("");
  const [showPostGameModal, setShowPostGameModal] = useState(false);
  const [postGameTarget, setPostGameTarget] = useState<any>(null);
  const [coOrgGame, setCoOrgGame] = useState<any>(null);
  const [teamHistoryGame, setTeamHistoryGame] = useState<any>(null);
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
  const [openMenuGameId, setOpenMenuGameId] = useState<string | null>(null);
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

  // Close an open GameCard actions dropdown when clicking outside it
  useEffect(() => {
    if (!openMenuGameId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".game-actions")) {
        setOpenMenuGameId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuGameId]);

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

  // ── Private-game invitations ───────────────────────────────────────────────
  const openInviteModal = (game: any) => {
    setInviteGameId(game._id);
    setInviteRows([]);
    setInviteName("");
    setInvitePhone("");
    setInviteSearch("");
    setSearchResults([]);
    setMaxJoinsInput(game.inviteLinkMaxJoins != null ? String(game.inviteLinkMaxJoins) : "");
    setInviteRegulars([]);
    // Regulars suggestions + invite form only apply to private games.
    if (game.visibility !== "private") { setInviteRegLoading(false); return; }
    setInviteRegLoading(true);
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    fetch(buildApiUrl(`/api/v1/games/organisers/${game._id}/regulars`), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d?.success) setInviteRegulars(d.data?.regulars || []); })
      .catch(() => {})
      .finally(() => setInviteRegLoading(false));
  };

  // Debounced (300ms) player search for the invite typeahead. Aborts the in-flight
  // request on each keystroke so only the latest query's results ever land.
  useEffect(() => {
    const q = inviteSearch.trim();
    if (!inviteGameId || q.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const { token } = getSession();
        const res = await fetch(buildApiUrl(`/api/v1/organisers/search-players?q=${encodeURIComponent(q)}`), {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        const data = await res.json();
        setSearchResults(res.ok && data?.success ? (data.data || []) : []);
      } catch (e) {
        if ((e as any)?.name !== "AbortError") setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [inviteSearch, inviteGameId]);

  const addSearchInvitee = (p: { _id: string; name: string }) => {
    if (inviteRows.some((r) => r.playerId === p._id)) return;
    setInviteRows((rows) => [...rows, { name: p.name, playerId: p._id }]);
    setInviteSearch("");
    setSearchResults([]);
  };

  // Manage the shared invite link — toggle on/off, set/clear the cap, or regenerate.
  const manageLink = async (patch: { enabled?: boolean; maxJoins?: number | null; regenerate?: boolean }) => {
    if (!inviteGameId) return;
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    setLinkBusy(true);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${inviteGameId}/invite-link`), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || "Failed to update link"); return; }
      showToast("success", "Invite link updated");
      await fetchGames({ silent: true });
    } catch {
      showToast("error", "Failed to update link. Please try again.");
    } finally {
      setLinkBusy(false);
    }
  };

  const addManualInvitee = () => {
    const name = inviteName.trim();
    const phone = invitePhone.replace(/\D/g, "");
    if (!name || phone.length < 10) { showToast("error", "Enter a name and a valid phone number"); return; }
    if (inviteRows.some((r) => r.phone === phone)) { showToast("error", "That number is already in the list"); return; }
    setInviteRows((rows) => [...rows, { name, phone }]);
    setInviteName(""); setInvitePhone("");
  };

  const addRegularInvitee = (reg: { id?: string; name: string }) => {
    if (!reg.id || inviteRows.some((r) => r.playerId === reg.id)) return;
    setInviteRows((rows) => [...rows, { name: reg.name, playerId: reg.id }]);
  };

  const removeInviteRow = (idx: number) => setInviteRows((rows) => rows.filter((_, i) => i !== idx));

  const submitInvites = async () => {
    if (!inviteGameId || inviteRows.length === 0) return;
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    setInviteSending(true);
    try {
      const invitees  = inviteRows.filter((r) => r.phone).map((r) => ({ name: r.name, phone: r.phone }));
      const playerIds = inviteRows.filter((r) => r.playerId).map((r) => r.playerId);
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${inviteGameId}/invite`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invitees, playerIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || "Failed to send invites"); return; }
      const wa = data.whatsapp;
      if (wa && wa.failed > 0) {
        showToast("error", "Saved, but WhatsApp failed", `${wa.sent} sent, ${wa.failed} not delivered. Copy the link to share manually.`);
      } else {
        showToast("success", "Invites sent", data.message);
      }
      setInviteRows([]);
      await fetchGames({ silent: true });
    } catch {
      showToast("error", "Failed to send invites. Please try again.");
    } finally {
      setInviteSending(false);
    }
  };

  const respondToInvite = async (inviteId: string, action: "approve" | "reject") => {
    if (!inviteGameId) return;
    const { token } = getSession();
    if (!token) { clearSession(); router.replace("/login?role=organiser"); return; }
    setInviteActionId(inviteId + action);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${inviteGameId}/invitations/${inviteId}/${action}`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showToast("error", data.message || `Failed to ${action}`); return; }
      showToast("success", action === "approve" ? "Player approved" : "Request rejected", data.message);
      await fetchGames({ silent: true });
    } catch {
      showToast("error", `Failed to ${action}. Please try again.`);
    } finally {
      setInviteActionId(null);
    }
  };

  const copyInviteLink = async (token: string) => {
    const link = `https://www.kasakai.in/join/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("success", "Link copied", link);
    } catch {
      showToast("error", "Couldn't copy link", link);
    }
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
        <button className="btn-primary " onClick={() => router.push(`/dashboard/organizer/${organiserId}/create-event`)}>
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

      {/* Published team sheets — what the players were told, and when */}
      {teamHistoryGame && (
        <div className="modal-overlay" onClick={() => setTeamHistoryGame(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, maxHeight: "85vh", overflowY: "auto", background: "#111214", border: "1px solid #2a2a2a", borderRadius: 16, padding: 22, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📣 Team history</h2>
              <button onClick={() => setTeamHistoryGame(null)} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 14px", lineHeight: 1.5 }}>
              Every time the teams for <b style={{ color: "#ddd" }}>{teamHistoryGame.title}</b> were published, newest first — and whether each player&apos;s message got through.
            </p>
            <TeamSheetHistory gameId={teamHistoryGame._id} />
          </div>
        </div>
      )}

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

      {/* Private-game invite manager */}
      {inviteGameId && (() => {
        const inviteGame = games.find((g) => g._id === inviteGameId);
        if (!inviteGame) return null;
        const isPrivateInvite = inviteGame.visibility === 'private';
        const invitations = (inviteGame.invitations || []) as any[];
        // The approval queue shows live requests: those awaiting a decision ('pending')
        // AND those already approved but waiting on the player's wallet top-up
        // ('approved_unpaid') — so an approved-but-unpaid request never silently vanishes.
        const pending = invitations.filter((i) => ['pending', 'approved_unpaid'].includes(i.status));
        // Only personal invites (with a token) belong in the "invitations" list;
        // self-service requests live only in the approval queue above.
        const sent = invitations.filter((i) => !['pending', 'approved_unpaid'].includes(i.status) && i.invitedByRole !== 'self');
        const linkJoins = invitations.filter(
          (i) => i.via === 'invite_link' && ['pending', 'accepted', 'approved_unpaid'].includes(i.status)
        ).length;
        const closeInvite = () => { setInviteGameId(null); setInviteRows([]); };
        const nameOf = (inv: any) => inv.isGuest
          ? (inv.plusOneName || 'Guest')
          : (inv.player?.name || inv.inviteeName || 'Player');
        const badge = (status: string) => {
          const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
            invited:         { label: 'Invited',           color: '#9aa',     bg: 'rgba(255,255,255,0.05)', border: '#333' },
            pending:         { label: 'Awaiting approval', color: '#f59e0b',  bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.3)' },
            accepted:        { label: 'Accepted',          color: '#c8ff3e',  bg: 'rgba(200,255,62,0.1)',   border: 'rgba(200,255,62,0.25)' },
            approved_unpaid: { label: 'Awaiting payment',  color: '#60a5fa',  bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.3)' },
            rejected:        { label: 'Rejected',          color: '#f87171',  bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' },
          };
          const b = map[status] || map.invited;
          return <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: b.color, background: b.bg, border: `1px solid ${b.border}`, borderRadius: 20, padding: '2px 9px' }}>{b.label}</span>;
        };
        const invitedByText = (inv: any) => inv.isGuest
          ? `+1 guest of ${inv.invitedByName || inv.player?.name || 'a player'}`
          : inv.invitedByRole === 'self'
            ? (inv.via === 'invite_link' ? 'requested via invite link' : 'requested to join')
            : inv.invitedByRole === 'player'
              ? `invited by ${inv.invitedByName || 'a player'}`
              : 'invited by you';
        return (
          <div className="modal-overlay" onClick={closeInvite}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "#111214", border: "1px solid #2a2a2a", borderRadius: 16, padding: 22, color: "#fff", maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{isPrivateInvite ? "🔒 Invites & requests" : "🙋 Join requests"}</h2>
                <button onClick={closeInvite} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 14px", lineHeight: 1.5 }}>
                {isPrivateInvite
                  ? <>Invite players to <b style={{ color: "#ddd" }}>{inviteGame.title}</b>, or share the invite link. Approve requests below.</>
                  : <>Players you approve join <b style={{ color: "#ddd" }}>{inviteGame.title}</b> and are charged their fee. Players you invite directly skip approval.</>}
              </p>

              {isPrivateInvite && <>
              {/* ── Add invites ── */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c8ff3e", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Add invites</div>

              {/* Player search typeahead (300ms debounce) */}
              <div style={{ position: "relative", marginBottom: 12 }}>
                <input
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="🔍 Search players by name, email or phone…"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13, boxSizing: "border-box" }}
                />
                {(searchLoading || searchResults.length > 0) && inviteSearch.trim().length >= 2 && (
                  <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 4px)", left: 0, right: 0, background: "#161616", border: "1px solid #2a2a2a", borderRadius: 10, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                    {searchLoading && searchResults.length === 0 ? (
                      <div style={{ padding: "10px 12px", fontSize: 12, color: "#888" }}>Searching…</div>
                    ) : searchResults.length === 0 ? (
                      <div style={{ padding: "10px 12px", fontSize: 12, color: "#888" }}>No players found</div>
                    ) : searchResults.map((p) => {
                      const added = inviteRows.some((x) => x.playerId === p._id);
                      return (
                        <button
                          key={p._id}
                          type="button"
                          disabled={added}
                          onClick={() => addSearchInvitee(p)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "transparent", border: "none", borderBottom: "1px solid #202020", color: added ? "#666" : "#eee", cursor: added ? "default" : "pointer", textAlign: "left" }}
                        >
                          <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#242424", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#c8ff3e", overflow: "hidden" }}>
                            {p.profileImage ? <img src={resolveImageUrl(p.profileImage)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (p.name?.[0] || "?").toUpperCase()}
                          </span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                            <span style={{ display: "block", fontSize: 11, color: "#777", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {[p.phone, p.email].filter(Boolean).join(" · ")}{typeof p.totalGamesPlayed === "number" ? ` · ${p.totalGamesPlayed}g` : ""}
                          </span>
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 12, color: added ? "#666" : "#c8ff3e", fontWeight: 700 }}>{added ? "✓ Added" : "+ Add"}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {inviteRegLoading ? (
                <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>Loading venue regulars…</div>
              ) : inviteRegulars.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#777", marginBottom: 6 }}>Venue regulars — tap to add</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {inviteRegulars.map((r) => {
                      const added = !!r.id && inviteRows.some((x) => x.playerId === r.id);
                      return (
                        <button
                          key={r.id || r.name}
                          type="button"
                          disabled={added}
                          onClick={() => addRegularInvitee(r)}
                          style={{ fontSize: 12, fontWeight: 600, color: added ? "#666" : "#ddd", background: added ? "#1a1a1a" : "#1c1f16", border: `1px solid ${added ? "#333" : "rgba(200,255,62,0.25)"}`, borderRadius: 20, padding: "5px 11px", cursor: added ? "default" : "pointer" }}
                        >
                          {added ? "✓ " : "+ "}{r.name} <span style={{ color: "#888" }}>· {r.games}g</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Name"
                  style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13 }}
                />
                <input
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  placeholder="Phone"
                  inputMode="tel"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualInvitee(); } }}
                  style={{ width: 130, padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13 }}
                />
                <button type="button" onClick={addManualInvitee} style={{ flexShrink: 0, padding: "0 14px", borderRadius: 9, border: "1px solid rgba(200,255,62,0.3)", background: "rgba(200,255,62,0.08)", color: "#c8ff3e", fontWeight: 700, cursor: "pointer" }}>Add</button>
              </div>

              {inviteRows.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {inviteRows.map((r, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#eee", background: "#1c1c1c", border: "1px solid #333", borderRadius: 20, padding: "4px 6px 4px 11px" }}>
                      {r.name}{r.phone ? ` · ${r.phone}` : ""}
                      <button onClick={() => removeInviteRow(i)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}

              <button
                disabled={inviteRows.length === 0 || inviteSending}
                onClick={submitInvites}
                style={{ width: "100%", padding: 11, borderRadius: 9, border: "none", fontWeight: 800, marginBottom: 20,
                  background: inviteRows.length === 0 ? "#2a2a2a" : "#c8ff3e",
                  color: inviteRows.length === 0 ? "#888" : "#000",
                  cursor: inviteRows.length === 0 || inviteSending ? "not-allowed" : "pointer", opacity: inviteSending ? 0.7 : 1 }}
              >
                {inviteSending ? "Sending…" : inviteRows.length === 0 ? "Add someone to invite" : `Send ${inviteRows.length} invite${inviteRows.length !== 1 ? "s" : ""}`}
              </button>

              {/* ── Shared invite link ── */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c8ff3e", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Shared invite link</div>
              {inviteGame.inviteLinkToken ? (
                <div style={{ border: "1px solid #262626", borderRadius: 10, padding: 12, marginBottom: 20 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <input
                      readOnly
                      value={`https://www.kasakai.in/join/${inviteGame.inviteLinkToken}`}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 8, border: "1px solid #2a2a2a", background: "#0e0e0e", color: inviteGame.inviteLinkEnabled === false ? "#666" : "#bbb", fontSize: 12 }}
                    />
                    <button type="button" onClick={() => copyInviteLink(inviteGame.inviteLinkToken)}
                      style={{ flexShrink: 0, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(200,255,62,0.3)", background: "rgba(200,255,62,0.08)", color: "#c8ff3e", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Copy</button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <button type="button" disabled={linkBusy}
                      onClick={() => manageLink({ enabled: !(inviteGame.inviteLinkEnabled !== false) })}
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: inviteGame.inviteLinkEnabled === false ? "#c8ff3e" : "#f87171", fontWeight: 700, fontSize: 12, cursor: linkBusy ? "not-allowed" : "pointer" }}>
                      {inviteGame.inviteLinkEnabled === false ? "Enable link" : "Disable link"}
                    </button>
                    <button type="button" disabled={linkBusy}
                      onClick={() => manageLink({ regenerate: true })}
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#bbb", fontWeight: 700, fontSize: 12, cursor: linkBusy ? "not-allowed" : "pointer" }}>
                      ↻ Regenerate
                    </button>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                      <input
                        type="number" min={1} placeholder="No limit" value={maxJoinsInput}
                        onChange={(e) => setMaxJoinsInput(e.target.value)}
                        style={{ width: 92, padding: "6px 9px", borderRadius: 8, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 12 }}
                      />
                      <button type="button" disabled={linkBusy}
                        onClick={() => manageLink({ maxJoins: maxJoinsInput.trim() === "" ? null : Number(maxJoinsInput) })}
                        style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#bbb", fontWeight: 700, fontSize: 12, cursor: linkBusy ? "not-allowed" : "pointer" }}>
                        Set cap
                      </button>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#777", marginTop: 8 }}>
                    {inviteGame.inviteLinkEnabled === false
                      ? "Link is off — nobody can join through it."
                      : inviteGame.requiresApproval
                        ? "Anyone with this link sends a join request for your approval."
                        : "Anyone with this link joins instantly (subject to slots)."}
                    {inviteGame.inviteLinkMaxJoins != null && ` · ${linkJoins}/${inviteGame.inviteLinkMaxJoins} link joins used`}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 12, marginBottom: 20, fontSize: 12, color: "#888", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid #222" }}>
                  No link yet — <button type="button" disabled={linkBusy} onClick={() => manageLink({ regenerate: true })} style={{ background: "none", border: "none", color: "#c8ff3e", fontWeight: 700, cursor: "pointer", padding: 0 }}>generate one</button> to share.
                </div>
              )}
              </>}

              {/* ── Requests to approve (public & private) ── */}
              {pending.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6, fontWeight: 700 }}>Requests to approve</div>
                  <div style={{ border: "1px solid #262626", borderRadius: 10 }}>
                    {pending.map((inv, i) => {
                      // 'approved_unpaid' = already approved, waiting on the player's top-up.
                      const awaitingPayment = inv.status === 'approved_unpaid';
                      // canAfford===false means the player can't currently cover the fee, so
                      // approving would only strand them — the backend annotates this per request.
                      const cantAfford = !awaitingPayment && inv.canAfford === false;
                      const approveBlocked = awaitingPayment || cantAfford;
                      const shortfall = Math.round((inv.walletShortfallPaise || 0) / 100);
                      return (
                      <div key={inv._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: i < pending.length - 1 ? "1px solid #1c1c1c" : "none" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#eee" }}>{nameOf(inv)}</div>
                          <div style={{ fontSize: 11, color: approveBlocked ? "#f59e0b" : "#777" }}>
                            {awaitingPayment
                              ? "Approved — waiting for the player to top up their wallet"
                              : cantAfford
                                ? (shortfall > 0
                                    ? `Low wallet balance — short by ₹${shortfall}. Can't approve until they recharge.`
                                    : "Insufficient wallet balance — can't approve until they recharge.")
                                : invitedByText(inv)}
                          </div>
                        </div>
                        {inv.token && (
                          <button
                            onClick={() => copyInviteLink(inv.token)}
                            title="Copy invite link"
                            style={{ flexShrink: 0, padding: "6px 9px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#bbb", fontSize: 13, cursor: "pointer" }}
                          >🔗</button>
                        )}
                        <button
                          disabled={!!inviteActionId}
                          onClick={() => respondToInvite(inv._id, "reject")}
                          style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.35)", background: "transparent", color: "#f87171", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                        >
                          {inviteActionId === inv._id + "reject" ? "…" : "Reject"}
                        </button>
                        {approveBlocked ? (
                          <button
                            disabled
                            title={awaitingPayment ? "Waiting for the player to top up their wallet" : "The player must recharge before you can approve"}
                            style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#666", fontWeight: 700, fontSize: 12, cursor: "not-allowed" }}
                          >
                            {awaitingPayment ? "Awaiting payment" : "Can't approve"}
                          </button>
                        ) : (
                          <button
                            disabled={!!inviteActionId}
                            onClick={() => respondToInvite(inv._id, "approve")}
                            style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 8, border: "none", background: "#c8ff3e", color: "#000", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
                          >
                            {inviteActionId === inv._id + "approve" ? "…" : "Approve"}
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isPrivateInvite && sent.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#c8ff3e", textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 8px" }}>
                    Invitations <span style={{ color: "#777" }}>({sent.length})</span>
                  </div>
                  <div style={{ border: "1px solid #262626", borderRadius: 10 }}>
                    {sent.map((inv, i) => (
                      <div key={inv._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: i < sent.length - 1 ? "1px solid #1c1c1c" : "none" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#eee" }}>{nameOf(inv)}</div>
                          <div style={{ fontSize: 11, color: "#777" }}>{invitedByText(inv)}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          {inv.token && ['invited', 'approved_unpaid'].includes(inv.status) && (
                            <button
                              onClick={() => copyInviteLink(inv.token)}
                              title="Copy invite link"
                              style={{ flexShrink: 0, padding: "5px 8px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#bbb", fontSize: 12.5, cursor: "pointer" }}
                            >🔗</button>
                          )}
                          {badge(inv.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {pending.length === 0 && (!isPrivateInvite || sent.length === 0) && (
                <div style={{ padding: 16, textAlign: "center", color: "#999", fontSize: 13, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid #222" }}>
                  {isPrivateInvite
                    ? "No invitations yet — add players above to get started."
                    : "No join requests yet. Requests appear here for you to approve or reject."}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
      {/* <div className="table-section"> */}
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
            <div className="games-list">
              {filteredUpcoming.map((game) => (
                <GameCard
                key={game._id}
                game={game}
                isMenuOpen={openMenuGameId === game._id}
                onToggleMenu={() => setOpenMenuGameId(openMenuGameId === game._id ? null : game._id)}
                onPlayers={() => {
                  setSelectedGame(game);
                  setShowPlayersModal(true);
                }}
                onEdit={() => {
                  setSelectedGame(game);
                  setShowEditModal(true);
                }}
                onConfirm={() => handleConfirmGame(game._id)}
                onSwitch={() => requestSwitchFormat(game)}
                onSOS={() => requestSendSos(game)}
                onWithdraw={() => handleOrganiserWithdraw(game._id)}
                onComplete={() => {
                  setPostGameTarget(game);
                  setShowPostGameModal(true);
                }}
                onCancel={() => openCancelModal(game)}
                onInvite={()=>openInviteModal(game)}
                onManageCoOrgs={() => { setCoOrgGame(game); setOpenMenuGameId(null); }}
                onTeamHistory={() => { setTeamHistoryGame(game); setOpenMenuGameId(null); }}
              />
              ))}
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
            <div className="games-list">
              {filteredPast.map((game) => (
                <GameCard
                  key={game._id}
                  game={game}
                  variant="past"
                  isMenuOpen={openMenuGameId === game._id}
                  onToggleMenu={() => setOpenMenuGameId(openMenuGameId === game._id ? null : game._id)}
                  onPlayers={() => {
                    setSelectedGame(game);
                    setShowPlayersModal(true);
                  }}
                  onComplete={() => {
                    setPostGameTarget(game);
                    setShowPostGameModal(true);
                  }}
                  onTeamHistory={() => { setTeamHistoryGame(game); setOpenMenuGameId(null); }}
                />
              ))}
            </div>
          )
        )}
     
      {/* </div> */}

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

      {coOrgGame && (
        <CoOrganiserModal
          gameId={coOrgGame._id}
          gameTitle={coOrgGame.title}
          initialCoOrganisers={coOrgGame.coOrganisers || []}
          onClose={() => setCoOrgGame(null)}
          onChanged={() => fetchGames({ silent: true })}
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