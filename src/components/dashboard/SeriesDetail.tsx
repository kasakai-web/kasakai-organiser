"use client";

// One recurring schedule, occurrence by occurrence.
//
// This is where the per-occurrence half of the feature lives: skip a date, move
// one game without touching the rest, add a one-off extra, or create a game
// early. Anything that reaches more than one game is handled by the form's edit
// scope instead — the two are kept apart on purpose, because "just this one" and
// "all of them" going through the same control is how organisers cancel a whole
// season by accident.

import { useEffect, useState } from "react";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { OccurrenceEditModal, OccurrenceMoveModal } from "@/components/dashboard/OccurrenceModals";
import {
  skipOccurrence, restoreOccurrence, updateOccurrence, createGameForOccurrence, addExtraOccurrence,
  prettyDate, prettyClock, prettyDateFull, rupees, fromISTInputValue, turfNameOf,
  type RecurringSeries, type SeriesOccurrence,
} from "@/utils/recurring";

interface Props {
  series: RecurringSeries;
  occurrences: SeriesOccurrence[];
  organiserId?: string;
  onRefresh: () => void;
  onEdit: () => void;
  onBack: () => void;
  onNotice: (type: "success" | "error", title: string, subtitle?: string) => void;
}

const gameIdOf = (g: SeriesOccurrence["game"]): string => (!g ? "" : typeof g === "string" ? g : g._id);
const gameTitleOf = (g: SeriesOccurrence["game"]): string =>
  g && typeof g === "object" && g.title ? g.title : "";

const STATUS_LABEL: Record<SeriesOccurrence["status"], string> = {
  planned: "Planned",
  created: "Game live",
  skipped: "Skipped",
  cancelled: "Cancelled",
  detached: "Managed separately",
};

export function SeriesDetail({ series, occurrences, organiserId, onRefresh, onEdit, onBack, onNotice }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState<SeriesOccurrence | null>(null);
  // Create now passes `force`, which also creates a date held back by a clash —
  // so a date with one is confirmed first, same as on the dashboard's cards.
  const [confirmCreate, setConfirmCreate] = useState<SeriesOccurrence | null>(null);
  const [rescheduling, setRescheduling] = useState<SeriesOccurrence | null>(null);
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraAt, setExtraAt] = useState("");
  const [customising, setCustomising] = useState<SeriesOccurrence | null>(null);

  // Splitting past from upcoming needs the clock, which is not something render
  // may read. Take the reading once per data load instead; the list is only a
  // few dozen rows, so re-partitioning on refresh costs nothing.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { setNowMs(Date.now()); }, [occurrences]);

  const upcoming = nowMs === null ? [] : occurrences.filter((o) => new Date(o.scheduledAt).getTime() > nowMs);
  const past = nowMs === null ? [] : occurrences.filter((o) => new Date(o.scheduledAt).getTime() <= nowMs);

  const run = async (id: string, fn: () => Promise<unknown>, okTitle: string) => {
    setBusyId(id);
    try {
      await fn();
      onNotice("success", okTitle);
      onRefresh();
    } catch (err) {
      const e = err as Error & { code?: string };
      onNotice(
        "error",
        e.code === "HAS_PLAYERS" ? "Players have already joined" : "Couldn't do that",
        e.message
      );
    } finally {
      setBusyId(null);
    }
  };

  const doSkip = async () => {
    if (!confirmSkip) return;
    const target = confirmSkip;
    setConfirmSkip(null);
    await run(target._id, () => skipOccurrence(target._id), target.status === "created" ? "Game cancelled" : "Date skipped");
  };

  const doReschedule = async (iso: string) => {
    if (!rescheduling) return;
    const target = rescheduling;
    setRescheduling(null);
    await run(target._id, () => updateOccurrence(target._id, { scheduledAt: iso }), "Game moved");
  };

  const doAddExtra = async () => {
    const iso = fromISTInputValue(extraAt);
    if (!iso) { onNotice("error", "Pick a valid date and time"); return; }
    setAddingExtra(false);
    setExtraAt("");
    await run("extra", () => addExtraOccurrence(series._id, iso), "Extra game added");
  };

  const doCustomise = async (overrides: Record<string, unknown>) => {
    if (!customising) return;
    const target = customising;
    setCustomising(null);
    await run(target._id, () => updateOccurrence(target._id, { overrides }), "This game updated");
  };

  const renderRow = (o: SeriesOccurrence, isPast: boolean) => {
    const gameId = gameIdOf(o.game);
    const busy = busyId === o._id;
    const clashes = o.conflicts || [];

    return (
      <li key={o._id} className={`rec-occ ${o.status} ${clashes.length > 0 ? "has-clash" : ""}`}>
        <div className="rec-occ-when">
          <span className="rec-occ-seq">#{o.seq}</span>
          <div>
            <strong>{prettyDate(o.scheduledAt)}</strong>
            <small>{prettyClock(o.scheduledAt)}</small>
          </div>
        </div>

        <div className="rec-occ-tags">
          <span className={`rec-occ-status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
          {o.isRescheduled && <span className="rec-occ-flag">moved</span>}
          {o.isCustomised && <span className="rec-occ-flag">customised</span>}
          {o.isExtra && <span className="rec-occ-flag">one-off</span>}
          {o.blockedByConflict && <span className="rec-occ-flag danger">held back</span>}
        </div>

        {clashes.length > 0 && (
          <div className="rec-occ-clash">
            {clashes.map((c, i) => <div key={i}>⚠ {c.message}</div>)}
          </div>
        )}

        {o.skipReason && <div className="rec-occ-reason">Reason: {o.skipReason}</div>}

        {!isPast && (
          <div className="rec-occ-actions">
            {o.status === "planned" && (
              <>
                <button className="rec-occ-btn" disabled={busy} onClick={() => setRescheduling(o)}>Move</button>
                <button className="rec-occ-btn" disabled={busy} onClick={() => setCustomising(o)}>Edit this game</button>
                <button
                  className="rec-occ-btn"
                  disabled={busy}
                  onClick={() => (o.blockedByConflict || clashes.length > 0
                    ? setConfirmCreate(o)
                    : run(o._id, () => createGameForOccurrence(o._id, true), "Game created"))}
                >Create now</button>
                <button className="rec-occ-btn danger" disabled={busy} onClick={() => setConfirmSkip(o)}>Skip</button>
              </>
            )}
            {o.status === "created" && (
              <>
                {/* Games are managed from the main dashboard — there is no
                    standalone game route in this portal. */}
                {gameId && organiserId && (
                  <a className="rec-occ-btn" href={`/dashboard/organizer/${organiserId}`}>Manage game</a>
                )}
                <button className="rec-occ-btn" disabled={busy} onClick={() => setRescheduling(o)}>Move</button>
                <button className="rec-occ-btn" disabled={busy} onClick={() => setCustomising(o)}>Edit this game</button>
                <button className="rec-occ-btn danger" disabled={busy} onClick={() => setConfirmSkip(o)}>Cancel game</button>
              </>
            )}
            {o.status === "skipped" && (
              <button className="rec-occ-btn" disabled={busy} onClick={() => run(o._id, () => restoreOccurrence(o._id), "Date restored")}>Restore</button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="rec-detail">
      <div className="dashboard-header-section">
        <div className="header-left">
          <button className="rec-back" onClick={onBack}>← All schedules</button>
          <h1 className="dashboard-title">{series.name}</h1>
          <p className="dashboard-subtitle">
            {series.description_text}
            {turfNameOf(series.gameDefaults.turf) ? ` · 📍 ${turfNameOf(series.gameDefaults.turf)}` : ""}
            {` · ${rupees(series.gameDefaults.feeInPaise)} · ${series.gameDefaults.format || "6v6"}`}
          </p>
        </div>
        <button className="btn-primary" onClick={onEdit}>Edit schedule</button>
      </div>

      {series.generation?.lastError && (
        <div className="rec-banner danger">
          The last automatic run failed: {series.generation.lastError}
        </div>
      )}
      {series.status === "paused" && (
        <div className="rec-banner">
          This schedule is paused — no new games are being created. Games already made are unaffected.
        </div>
      )}
      {series.status === "ended" && (
        <div className="rec-banner">This schedule has run its course. Every game it was going to make has been made.</div>
      )}

      <div className="rec-detail-stats">
        <div><span>{series.stats?.gamesCreated ?? 0}</span>games created</div>
        <div><span>{upcoming.length}</span>upcoming</div>
        <div><span>{series.stats?.occurrencesSkipped ?? 0}</span>skipped</div>
        <div><span>{series.stats?.occurrencesCancelled ?? 0}</span>cancelled</div>
      </div>

      <div className="rec-section-head">
        <h2>Upcoming</h2>
        <button className="rec-occ-btn" onClick={() => setAddingExtra(true)}>+ Add a one-off game</button>
      </div>

      {nowMs === null ? (
        <div className="rec-empty-inline">Loading dates…</div>
      ) : upcoming.length === 0 ? (
        <div className="rec-empty-inline">
          Nothing planned yet.
          {series.status === "active"
            ? " The next automatic run will fill this in — or use \"Generate now\" from the schedules list."
            : " Resume the schedule to start planning dates again."}
        </div>
      ) : (
        <ol className="rec-occ-list">{upcoming.map((o) => renderRow(o, false))}</ol>
      )}

      {past.length > 0 && (
        <>
          <div className="rec-section-head"><h2>Past</h2></div>
          <ol className="rec-occ-list past">{past.slice(-20).reverse().map((o) => renderRow(o, true))}</ol>
        </>
      )}

      {/* Move one occurrence */}
      {rescheduling && (
        <OccurrenceMoveModal
          scheduledAt={rescheduling.scheduledAt}
          onClose={() => setRescheduling(null)}
          onSave={doReschedule}
          onInvalid={(m) => onNotice("error", m)}
        />
      )}

      {/* Edit one occurrence's settings — overrides, not a schedule change */}
      {customising && (
        <OccurrenceEditModal
          scheduledAt={customising.scheduledAt}
          status={customising.status}
          overrides={customising.overrides}
          defaults={series.gameDefaults}
          seriesName={series.name}
          liveTitle={gameTitleOf(customising.game)}
          onClose={() => setCustomising(null)}
          onSave={doCustomise}
          onInvalid={(m) => onNotice("error", m)}
        />
      )}

      {/* Add an extra occurrence */}
      {addingExtra && (
        <div className="rec-modal-backdrop" onClick={() => setAddingExtra(false)}>
          <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add a one-off game</h3>
            <p>An extra game on this schedule&apos;s settings, on a date the pattern wouldn&apos;t normally produce.</p>
            <input type="datetime-local" className="form-input" value={extraAt} onChange={(e) => setExtraAt(e.target.value)} />
            <div className="rec-modal-actions">
              <button className="btn btn-secondary" onClick={() => setAddingExtra(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doAddExtra}>Add it</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        open={!!confirmCreate}
        title="Create this game despite the clash?"
        message={confirmCreate
          ? `${(confirmCreate.conflicts || []).map((c) => c.message).join(" ") || "This date clashes with another game."} Creating it now opens the game on ${prettyDateFull(confirmCreate.scheduledAt)} at ${prettyClock(confirmCreate.scheduledAt)} for booking anyway.`
          : ""}
        confirmLabel="Create anyway"
        cancelLabel="Not now"
        onCancel={() => setConfirmCreate(null)}
        onConfirm={() => {
          const target = confirmCreate;
          setConfirmCreate(null);
          if (target) run(target._id, () => createGameForOccurrence(target._id, true), "Game created");
        }}
      />

      <ConfirmationModal
        open={!!confirmSkip}
        title={confirmSkip?.status === "created" ? "Cancel this game?" : "Skip this date?"}
        message={confirmSkip
          ? confirmSkip.status === "created"
            ? `The game on ${prettyDateFull(confirmSkip.scheduledAt)} will be cancelled. The rest of the schedule carries on. If players have already joined, you'll need to cancel it from the game page so they're refunded.`
            : `No game will be created for ${prettyDateFull(confirmSkip.scheduledAt)}. You can restore it later.`
          : ""}
        confirmLabel={confirmSkip?.status === "created" ? "Cancel game" : "Skip it"}
        cancelLabel="Keep it"
        onConfirm={doSkip}
        onCancel={() => setConfirmSkip(null)}
      />
    </div>
  );
}
