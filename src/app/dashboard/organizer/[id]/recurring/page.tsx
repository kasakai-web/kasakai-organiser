"use client";

// Recurring schedules — the organiser's list of repeating games.
//
// Four views in one route: the list, the create form, the edit form, and one
// schedule's occurrence calendar. They share loaded state, so pausing a schedule
// from the list and then opening it doesn't refetch the world.

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { RecurringSeriesForm } from "@/components/dashboard/RecurringSeriesForm";
import { SeriesDetail } from "@/components/dashboard/SeriesDetail";
import {
  listSeries, getSeries, pauseSeries, resumeSeries, duplicateSeries, endSeries, generateNow,
  prettyDate, prettyClock, rupees, turfNameOf,
  type RecurringSeries, type SeriesOccurrence,
} from "@/utils/recurring";
import "../../../organizer-dashboard.css";
import "./recurring.css";

type View = "list" | "new" | "edit" | "detail";

const STATUS_CHIP: Record<RecurringSeries["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "on" },
  paused: { label: "Paused", cls: "paused" },
  ended: { label: "Finished", cls: "muted" },
  archived: { label: "Archived", cls: "muted" },
};

export default function RecurringPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;

  useAuthGuard({ requiredRole: "organiser", routeUserId: organiserId, redirectTo: "/login?role=organiser" });

  const { toast, showToast, hideToast } = useToast();
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [active, setActive] = useState<RecurringSeries | null>(null);
  const [occurrences, setOccurrences] = useState<SeriesOccurrence[]>([]);
  const [confirmEnd, setConfirmEnd] = useState<RecurringSeries | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pivotId, setPivotId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      setSeries(await listSeries());
    } catch (err) {
      showToast("error", "Couldn't load your schedules", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openDetail = useCallback(async (id: string) => {
    try {
      const full = await getSeries(id);
      setActive(full);
      setOccurrences(full.occurrences || []);
      setView("detail");
    } catch (err) {
      showToast("error", "Couldn't open that schedule", err instanceof Error ? err.message : undefined);
    }
  }, [showToast]);

  const refreshDetail = useCallback(async () => {
    if (!active) return;
    try {
      const full = await getSeries(active._id);
      setActive(full);
      setOccurrences(full.occurrences || []);
    } catch { /* the toast from the failed action is enough */ }
  }, [active]);

  const act = async (id: string, fn: () => Promise<unknown>, okTitle: string) => {
    setBusy(id);
    try {
      await fn();
      showToast("success", okTitle);
      await refreshList();
      if (active?._id === id) await refreshDetail();
    } catch (err) {
      showToast("error", "Couldn't do that", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const doEnd = async () => {
    if (!confirmEnd) return;
    const target = confirmEnd;
    setConfirmEnd(null);
    await act(target._id, () => endSeries(target._id, false), "Schedule ended");
    if (active?._id === target._id) setView("list");
  };

  // The occurrence a "this and future" edit splits at — the next one still to
  // come. Resolved when the organiser opens the form rather than on every render,
  // so "next" is read off the clock at the moment they actually start editing.
  const startEdit = () => {
    const next = occurrences.find(
      (o) => new Date(o.scheduledAt).getTime() > Date.now() && ["planned", "created"].includes(o.status)
    );
    setPivotId(next?._id ?? null);
    setView("edit");
  };

  if (view === "new" || view === "edit") {
    return (
      <div className="organizer-dashboard-container">
        <RecurringSeriesForm
          series={view === "edit" ? active : null}
          pivotOccurrenceId={view === "edit" ? pivotId : null}
          onClose={() => setView(active && view === "edit" ? "detail" : "list")}
          onSaved={async (saved) => {
            showToast("success", view === "edit" ? "Schedule updated" : "Schedule created");
            await refreshList();
            await openDetail(saved._id);
          }}
        />
        {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
      </div>
    );
  }

  if (view === "detail" && active) {
    return (
      <div className="organizer-dashboard-container">
        <SeriesDetail
          series={active}
          occurrences={occurrences}
          organiserId={organiserId}
          onRefresh={refreshDetail}
          onEdit={startEdit}
          onBack={() => { setView("list"); setActive(null); refreshList(); }}
          onNotice={showToast}
        />
        {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
      </div>
    );
  }

  return (
    <div className="organizer-dashboard-container">
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Recurring Games</h1>
          <p className="dashboard-subtitle">
            Set a pattern once — games are created automatically a few days before each kick-off, never all at once.
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setActive(null); setView("new"); }}>
          <span className="btn-icon">+ </span>New Schedule
        </button>
      </div>

      {loading ? (
        <div className="rec-empty">Loading schedules…</div>
      ) : series.length === 0 ? (
        <div className="rec-empty">
          <div style={{ fontSize: 34, marginBottom: 10 }}>🔁</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ccc", marginBottom: 6 }}>No recurring schedules yet</div>
          <div style={{ marginBottom: 18 }}>
            Got a weekly fixture? Set the pattern once and stop creating the same game every week.
          </div>
          <button className="btn-primary" onClick={() => setView("new")}><span className="btn-icon">+ </span>New Schedule</button>
        </div>
      ) : (
        <div className="rec-grid">
          {series.map((s) => {
            const chip = STATUS_CHIP[s.status];
            const isBusy = busy === s._id;
            return (
              <div key={s._id} className={`rec-card ${s.status}`}>
                <div>
                  <div className="rec-card-top">
                    <h3 className="rec-card-title">{s.name}</h3>
                    <span className={`rec-status-chip ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <p className="rec-card-rule">{s.description_text}</p>
                  <div className="rec-card-meta">
                    <span className="rec-chip">{s.gameDefaults.format || "6v6"}</span>
                    <span className="rec-chip">{rupees(s.gameDefaults.feeInPaise)}</span>
                    {turfNameOf(s.gameDefaults.turf) && <span className="rec-chip muted">📍 {turfNameOf(s.gameDefaults.turf)}</span>}
                    <span className="rec-chip muted">{s.stats?.gamesCreated ?? 0} game(s) made</span>
                  </div>
                </div>

                <div className="rec-card-next">
                  {s.nextOccurrence ? (
                    <>
                      <span className="rec-card-next-label">Next game</span>
                      <strong>{prettyDate(s.nextOccurrence.scheduledAt)} · {prettyClock(s.nextOccurrence.scheduledAt)}</strong>
                      <small>{s.upcomingCount} upcoming on the calendar</small>
                    </>
                  ) : (
                    <span className="rec-card-next-label">
                      {s.status === "active" ? "Nothing planned yet" : "No upcoming games"}
                    </span>
                  )}
                </div>

                {s.generation?.lastError && (
                  <div className="rec-card-error">Last automatic run failed: {s.generation.lastError}</div>
                )}

                <div className="rec-card-actions">
                  <button className="rec-action primary" onClick={() => openDetail(s._id)}>View calendar</button>
                  {s.status === "active" ? (
                    <button className="rec-action" disabled={isBusy} onClick={() => act(s._id, () => pauseSeries(s._id), "Schedule paused")}>Pause</button>
                  ) : s.status === "paused" ? (
                    <button className="rec-action" disabled={isBusy} onClick={() => act(s._id, () => resumeSeries(s._id), "Schedule resumed")}>Resume</button>
                  ) : null}
                  {s.status === "active" && (
                    <button className="rec-action" disabled={isBusy} onClick={() => act(s._id, () => generateNow(s._id), "Upcoming games generated")}>Generate now</button>
                  )}
                  <button className="rec-action" disabled={isBusy} onClick={() => act(s._id, () => duplicateSeries(s._id), "Schedule duplicated (paused)")}>Duplicate</button>
                  <button className="rec-action danger" disabled={isBusy} onClick={() => setConfirmEnd(s)}>End</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmationModal
        open={!!confirmEnd}
        title="End this schedule?"
        message={confirmEnd
          ? `"${confirmEnd.name}" will stop creating games and any dates not yet turned into games are dropped. Games that already exist are left alone — cancel those individually if you need to.`
          : ""}
        confirmLabel="End schedule"
        cancelLabel="Keep it"
        onConfirm={doEnd}
        onCancel={() => setConfirmEnd(null)}
      />

      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
    </div>
  );
}
