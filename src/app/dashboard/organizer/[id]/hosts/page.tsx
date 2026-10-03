"use client";

// Hosts — the players this organiser trusts to run games on the day.
//
// The organiser recommends a player here; KasaKai approves or rejects. An
// approved host can book the host spots in this organiser's games at the
// organiser's discount, and can be asked to facilitate a game without playing.
// Either way they get the host tools on the player portal for the games they
// run. The organiser needs KasaKai only to START a host — ending one (or
// withdrawing a recommendation) is theirs alone.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { usePlayerSearch, type PlayerSearchResult } from "@/hooks/usePlayerSearch";
import { Toast, useToast } from "@/components/ui/Toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { resolveImageUrl } from "@/utils/api";
import { listMyHosts, recommendHost, endHost, unblockHost, removingEndsHost, type HostRecord } from "@/utils/hosts";
import "../../../organizer-dashboard.css";

const fmtDate = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
    : "—";

function Avatar({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = src ? resolveImageUrl(src) : "";
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} className="w-10 h-10 rounded-full object-cover shrink-0" />;
  }
  return (
    <span className="w-10 h-10 rounded-full bg-[#222] text-[#c8ff3e] text-xs font-bold flex items-center justify-center shrink-0">
      {(name || "P").substring(0, 2).toUpperCase()}
    </span>
  );
}

const endedLabel = (h: HostRecord) =>
  h.status === "rejected"
    ? "Not approved by KasaKai"
    : h.endedByRole === "admin"
      ? "Revoked by KasaKai"
      : h.endedByRole === "player"
        ? "Stepped down"
        : h.endedReason === "withdrawn"
          ? "Recommendation withdrawn"
          : "Ended by you";

export default function HostsPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const { isAuthorized } = useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });

  const { toast, showToast, hideToast } = useToast();
  const [hosts, setHosts] = useState<HostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picked, setPicked] = useState<PlayerSearchResult | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const search = usePlayerSearch(!picked);

  const [ending, setEnding] = useState<HostRecord | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHosts(await listMyHosts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your hosts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthorized) load(); }, [isAuthorized, load]);

  const groups = useMemo(() => ({
    approved: hosts.filter((h) => h.status === "approved" && !h.blocked),
    removed: hosts.filter((h) => h.status === "approved" && h.blocked),
    pending: hosts.filter((h) => h.status === "pending"),
    past: hosts.filter((h) => h.status === "rejected" || h.status === "ended"),
  }), [hosts]);

  const liveIds = useMemo(
    () => new Set(hosts.filter((h) => h.status === "approved" || h.status === "pending").map((h) => h.player?._id)),
    [hosts],
  );

  const submit = async () => {
    if (!picked) return;
    setSending(true);
    try {
      await recommendHost(picked._id, note.trim());
      showToast("success", "Recommended", `${picked.name} is waiting for KasaKai's approval.`, 3000);
      setPicked(null);
      setNote("");
      search.reset();
      load();
    } catch (err) {
      showToast("error", "Couldn't recommend", err instanceof Error ? err.message : undefined, 3500);
    } finally {
      setSending(false);
    }
  };

  const confirmEnd = async () => {
    if (!ending) return;
    setEndBusy(true);
    try {
      await endHost(ending._id);
      showToast(
        "success",
        ending.status === "pending" ? "Recommendation withdrawn" : removingEndsHost(ending) ? "Host ended" : "Removed from your games",
        ending.player?.name,
        2500,
      );
      setEnding(null);
      load();
    } catch (err) {
      showToast("error", "Couldn't update", err instanceof Error ? err.message : undefined, 3500);
    } finally {
      setEndBusy(false);
    }
  };

  const addBack = async (h: HostRecord) => {
    setUnblocking(h._id);
    try {
      await unblockHost(h._id);
      showToast("success", "Added back", `${h.player?.name} can host your games again.`, 2500);
      load();
    } catch (err) {
      showToast("error", "Couldn't update", err instanceof Error ? err.message : undefined, 3500);
    } finally {
      setUnblocking(null);
    }
  };

  if (!isAuthorized) return null;

  return (
    <div className="organizer-dashboard-container">
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Hosts</h1>
          <p className="dashboard-subtitle">
            Players you trust to run your games on the day — check-in, teams and wrap-up. Recommend them here;
            KasaKai approves, and may also make them a host for other organisers. KasaKai can add other
            organisers&apos; approved hosts to your games too, and you can remove any of them from your games.
            An approved host can book the host spots in your games at your discount, or be asked to facilitate a
            game without playing.
          </p>
        </div>
      </div>

      {/* ── Recommend ── */}
      <div className="bg-[#111] border border-[#222] rounded-2xl p-4 md:p-6 mb-6">
        <h2 className="text-xs font-bold text-[#888] uppercase tracking-[0.2em] mb-4">Recommend a host</h2>
        {!picked ? (
          <div className="relative">
            <input
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl h-11 px-4 w-full text-white text-sm focus:outline-none focus:border-[#444]"
              placeholder="Search players by name, phone or email…"
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
            />
            {search.isSearching && (
              <div className="absolute z-20 left-0 right-0 mt-2 bg-[#141414] border border-[#2a2a2a] rounded-xl max-h-72 overflow-y-auto">
                {search.loading && <div className="px-4 py-3 text-xs text-[#888]">Searching…</div>}
                {!search.loading && search.results.length === 0 && (
                  <div className="px-4 py-3 text-xs text-[#888]">No players found.</div>
                )}
                {search.results.map((p) => {
                  const already = liveIds.has(p._id);
                  return (
                    <button
                      key={p._id}
                      type="button"
                      disabled={already}
                      onClick={() => setPicked(p)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#1c1c1c] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Avatar name={p.name} src={p.profileImage} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-white font-semibold truncate">{p.name}</span>
                        <span className="block text-xs text-[#888]">
                          {p.phone || ""}{typeof p.totalGamesPlayed === "number" ? ` · ${p.totalGamesPlayed} games` : ""}
                        </span>
                      </span>
                      {already && <span className="text-[10px] text-[#c8ff3e] uppercase tracking-widest">Already listed</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={picked.name} src={picked.profileImage} />
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold">{picked.name}</div>
                <div className="text-xs text-[#888]">{picked.phone}</div>
              </div>
              <button type="button" className="text-xs text-[#888] hover:text-white" onClick={() => setPicked(null)}>
                Change
              </button>
            </div>
            <textarea
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3 w-full text-white text-sm focus:outline-none focus:border-[#444] min-h-[84px]"
              maxLength={500}
              placeholder="Why them? KasaKai reads this when approving — e.g. 'Plays our Tuesday game every week, always early.'"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={sending} onClick={submit}>
                {sending ? "Sending…" : "Recommend for approval"}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="form-error-banner" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
      {loading && <p className="text-sm text-[#888]">Loading your hosts…</p>}

      {!loading && (
        <>
          <Section title={`Approved hosts (${groups.approved.length})`}>
            {groups.approved.length === 0 && (
              <Empty>No approved hosts yet. Once KasaKai approves a recommendation, they appear here.</Empty>
            )}
            {groups.approved.map((h) => (
              <Row key={h._id} host={h}>
                <div className="text-xs text-[#888]">
                  Hosted {h.stats?.hosted ?? 0} · facilitated {h.stats?.facilitated ?? 0}
                  {h.stats?.upcoming ? <span className="text-[#c8ff3e]"> · {h.stats.upcoming} upcoming</span> : null}
                  <span> · since {fmtDate(h.decidedAt)}</span>
                  <span className="block mt-1">{originLabel(h)}</span>
                </div>
                <button type="button" className="text-xs text-[#f87171] hover:underline" onClick={() => setEnding(h)}>
                  {removingEndsHost(h) ? "End" : "Remove from my games"}
                </button>
              </Row>
            ))}
          </Section>

          {groups.removed.length > 0 && (
            <Section title={`Removed from your games (${groups.removed.length})`}>
              {groups.removed.map((h) => (
                <Row key={h._id} host={h} muted>
                  <div className="text-xs text-[#888]">
                    Can&apos;t book host spots or facilitate in your games.
                    <span className="block mt-1">{originLabel(h)}</span>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-[#c8ff3e] hover:underline disabled:opacity-50"
                    disabled={unblocking === h._id}
                    onClick={() => addBack(h)}
                  >
                    {unblocking === h._id ? "Adding…" : "Add back"}
                  </button>
                </Row>
              ))}
            </Section>
          )}

          <Section title={`Waiting for KasaKai (${groups.pending.length})`}>
            {groups.pending.length === 0 && <Empty>Nothing waiting.</Empty>}
            {groups.pending.map((h) => (
              <Row key={h._id} host={h}>
                <div className="text-xs text-[#888]">
                  Recommended {fmtDate(h.recommendedAt)}
                  {h.recommendedNote ? <span className="block text-[#aaa] mt-1">&ldquo;{h.recommendedNote}&rdquo;</span> : null}
                </div>
                <button type="button" className="text-xs text-[#888] hover:text-white" onClick={() => setEnding(h)}>
                  Withdraw
                </button>
              </Row>
            ))}
          </Section>

          {groups.past.length > 0 && (
            <div className="mb-6">
              <button type="button" className="text-xs text-[#888] hover:text-white uppercase tracking-widest" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Hide" : "Show"} past ({groups.past.length})
              </button>
              {showHistory && (
                <div className="mt-3 flex flex-col gap-2">
                  {groups.past.map((h) => (
                    <Row key={h._id} host={h} muted>
                      <div className="text-xs text-[#888]">
                        {endedLabel(h)} · {fmtDate(h.endedAt || h.decidedAt)}
                        {(h.decisionNote || (h.endedReason && h.endedReason !== "withdrawn")) && (
                          <span className="block text-[#aaa] mt-1">{h.endedReason && h.endedReason !== "withdrawn" ? h.endedReason : h.decisionNote}</span>
                        )}
                      </div>
                    </Row>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmationModal
        open={!!ending}
        title={
          ending?.status === "pending" ? "Withdraw recommendation?"
          : ending && removingEndsHost(ending) ? "End this host?"
          : "Remove from your games?"
        }
        message={
          ending?.status === "pending"
            ? `${ending?.player?.name} won't be considered. They were never told they were recommended.`
            : ending && removingEndsHost(ending)
              ? `${ending?.player?.name} loses the host tools straight away and any facilitator slots in your upcoming games. Host spots they already booked stay theirs — you can remove them from the roster if you want someone else there.`
              : `${ending?.player?.name} can no longer book host spots or facilitate in your games, and loses any facilitator slots in your upcoming games. They stay a host for the other organisers KasaKai approved them for. Host spots they already booked in your games stay theirs. You can add them back later.`
        }
        confirmLabel={
          ending?.status === "pending" ? "Withdraw" : ending && removingEndsHost(ending) ? "End host" : "Remove"
        }
        loading={endBusy}
        onConfirm={confirmEnd}
        onCancel={() => setEnding(null)}
      />

      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
    </div>
  );
}

/** Where this host came from, and how far KasaKai's approval reaches. */
function originLabel(h: HostRecord) {
  if (h.relation === "assigned") {
    return `Added by KasaKai · recommended by ${h.recommendedBy?.name || "another organiser"} · host for ${(h.scopeLabel || "").toLowerCase()}`;
  }
  return (h.scope ?? "organiser") === "organiser"
    ? "Recommended by you"
    : `Recommended by you · KasaKai approved them for ${(h.scopeLabel || "").toLowerCase()}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold text-[#888] uppercase tracking-[0.2em] mb-3">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#666] bg-[#111] border border-[#1e1e1e] rounded-xl px-4 py-3">{children}</p>;
}

function Row({ host, children, muted }: { host: HostRecord; children: React.ReactNode; muted?: boolean }) {
  const p = host.player;
  return (
    <div className={`flex items-center gap-3 bg-[#111] border border-[#1e1e1e] rounded-xl px-4 py-3 ${muted ? "opacity-70" : ""}`}>
      <Avatar name={p?.name || "Player"} src={p?.profileImage} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-semibold truncate">{p?.name || "Deleted player"}</div>
        <div className="text-xs text-[#666]">
          {p?.phone || ""}
          {typeof p?.totalGamesPlayed === "number" ? ` · ${p.totalGamesPlayed} games` : ""}
          {p?.noShowCount ? ` · ${p.noShowCount} no-shows` : ""}
        </div>
      </div>
      <div className="flex items-center gap-4 text-right">{children}</div>
    </div>
  );
}
