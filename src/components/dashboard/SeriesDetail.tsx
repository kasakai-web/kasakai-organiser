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
import { buildApiUrl, getSession } from "@/utils/api";
import type { Format } from "@/utils/templates";
import {
  skipOccurrence, restoreOccurrence, updateOccurrence, createGameForOccurrence, addExtraOccurrence,
  prettyDate, prettyClock, prettyDateFull, rupees, toISTInputValue, fromISTInputValue, turfNameOf, turfIdOf,
  type RecurringSeries, type SeriesOccurrence,
} from "@/utils/recurring";

interface Turf { _id: string; name: string; location?: { city?: string } }

const FORMATS: Format[] = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"];

// The modal edits strings so that "" can mean "no override — inherit the
// schedule's setting". Anything left empty is sent as null, which is what the
// backend reads as "stop overriding this".
type OverrideDraft = Record<string, string>;

const EMPTY_DRAFT: OverrideDraft = {
  title: "", turf: "", format: "", feeInRs: "", backoutFeeInRs: "",
  totalSlots: "", minPlayers: "", durationMins: "", reportingMinsBeforeGame: "",
  cutoffHoursBeforeGame: "", visibility: "", organiserIsPlaying: "",
};

const numOrEmpty = (v?: number | null): string => (v === null || v === undefined ? "" : String(v));
const paiseToRs = (v?: number | null): string => (v === null || v === undefined ? "" : String(v / 100));

// "" → null (inherit), otherwise the typed value.
const asNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const asStr = (v: string): string | null => (v.trim() === "" ? null : v.trim());

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
  // What an un-overridden occurrence inherits — shown as the placeholder in the
  // per-occurrence editor so "blank" reads as a value, not a gap.
  const sd = series.gameDefaults;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState<SeriesOccurrence | null>(null);
  const [rescheduling, setRescheduling] = useState<SeriesOccurrence | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraAt, setExtraAt] = useState("");
  const [customising, setCustomising] = useState<SeriesOccurrence | null>(null);
  const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT);
  const [turfs, setTurfs] = useState<Turf[]>([]);

  // Venues for the override picker. Same call the schedule form makes; the list
  // is small and rarely changes, so one fetch per mount is plenty.
  useEffect(() => {
    const { token } = getSession();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(buildApiUrl("/api/v1/turfs"), headers ? { headers } : undefined)
      .then((r) => r.json())
      .then((res) => { if (res.success) setTurfs(res.data); })
      .catch(() => {});
  }, []);

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

  const doReschedule = async () => {
    if (!rescheduling) return;
    const iso = fromISTInputValue(rescheduleAt);
    if (!iso) { onNotice("error", "Pick a valid date and time"); return; }
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

  const openCustomise = (o: SeriesOccurrence) => {
    const ov = o.overrides || {};
    setDraft({
      title: ov.title ?? "",
      turf: turfIdOf(ov.turf ?? null),
      format: ov.format ?? "",
      feeInRs: paiseToRs(ov.feeInPaise),
      backoutFeeInRs: paiseToRs(ov.backoutFeeInPaise),
      totalSlots: numOrEmpty(ov.totalSlots),
      minPlayers: numOrEmpty(ov.minPlayers),
      durationMins: numOrEmpty(ov.durationMins),
      reportingMinsBeforeGame: numOrEmpty(ov.reportingMinsBeforeGame),
      cutoffHoursBeforeGame: numOrEmpty(ov.cutoffHoursBeforeGame),
      visibility: ov.visibility ?? "",
      organiserIsPlaying: ov.organiserIsPlaying === null || ov.organiserIsPlaying === undefined
        ? ""
        : ov.organiserIsPlaying ? "yes" : "no",
    });
    setCustomising(o);
  };

  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const doCustomise = async () => {
    if (!customising) return;

    // Only guard what the schema would reject outright — everything else is a
    // legitimate one-off, however odd it looks next to the schedule's defaults.
    const duration = asNum(draft.durationMins);
    if (duration !== null && (isNaN(duration) || duration < 15)) {
      onNotice("error", "Duration must be at least 15 minutes"); return;
    }
    const slots = asNum(draft.totalSlots);
    const min = asNum(draft.minPlayers);
    if (slots !== null && min !== null && min > slots) {
      onNotice("error", "Min players can't be more than max players"); return;
    }

    const overrides = {
      title: asStr(draft.title),
      turf: asStr(draft.turf),
      format: asStr(draft.format),
      feeInRs: asNum(draft.feeInRs),
      backoutFeeInRs: asNum(draft.backoutFeeInRs),
      totalSlots: slots,
      minPlayers: min,
      durationMins: duration,
      reportingMinsBeforeGame: asNum(draft.reportingMinsBeforeGame),
      cutoffHoursBeforeGame: asNum(draft.cutoffHoursBeforeGame),
      visibility: asStr(draft.visibility),
      organiserIsPlaying: draft.organiserIsPlaying === "" ? null : draft.organiserIsPlaying === "yes",
    };

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
                <button className="rec-occ-btn" disabled={busy} onClick={() => { setRescheduling(o); setRescheduleAt(toISTInputValue(o.scheduledAt)); }}>Move</button>
                <button className="rec-occ-btn" disabled={busy} onClick={() => openCustomise(o)}>Edit this game</button>
                <button
                  className="rec-occ-btn"
                  disabled={busy}
                  onClick={() => run(o._id, () => createGameForOccurrence(o._id, true), "Game created")}
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
                <button className="rec-occ-btn" disabled={busy} onClick={() => { setRescheduling(o); setRescheduleAt(toISTInputValue(o.scheduledAt)); }}>Move</button>
                <button className="rec-occ-btn" disabled={busy} onClick={() => openCustomise(o)}>Edit this game</button>
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
        <div className="rec-modal-backdrop" onClick={() => setRescheduling(null)}>
          <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Move this game</h3>
            <p>
              Only this occurrence moves — {prettyDateFull(rescheduling.scheduledAt)} at {prettyClock(rescheduling.scheduledAt)}.
              The rest of the schedule stays exactly as it is.
            </p>
            <input type="datetime-local" className="form-input" value={rescheduleAt} onChange={(e) => setRescheduleAt(e.target.value)} />
            <div className="rec-modal-actions">
              <button className="btn btn-secondary" onClick={() => setRescheduling(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doReschedule}>Move it</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit one occurrence's settings — overrides, not a schedule change */}
      {customising && (
        <div className="rec-modal-backdrop" onClick={() => setCustomising(null)}>
          <div className="rec-modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Edit this game</h3>
            <p>
              {prettyDateFull(customising.scheduledAt)} at {prettyClock(customising.scheduledAt)} only — the
              schedule and every other date are untouched. Leave a field blank to keep using the schedule&apos;s setting.
              {customising.status === "created" && " This game is already live, so changes reach players straight away."}
            </p>

            <div className="rec-ov-grid">
              <label className="rec-ov-field full">
                <span className="form-label">Title</span>
                {/* With a name pattern the inherited title isn't a fixed string, so
                    the placeholder shows the live game's own name where there is
                    one and names the pattern otherwise — never a value this game
                    would not actually get. */}
                <input
                  className="form-input"
                  value={draft.title}
                  placeholder={
                    gameTitleOf(customising.game)
                    || (sd.titlePattern ? "Built from the schedule's name pattern" : sd.title || series.name)
                  }
                  onChange={(e) => setField("title", e.target.value)}
                />
                {sd.titlePattern && (
                  <span className="field-hint">
                    Typing a title here replaces the pattern for this game only.
                  </span>
                )}
              </label>

              <label className="rec-ov-field full">
                <span className="form-label">Venue</span>
                <select className="form-select" value={draft.turf} onChange={(e) => setField("turf", e.target.value)}>
                  <option value="">Same as schedule{turfNameOf(sd.turf) ? ` — ${turfNameOf(sd.turf)}` : ""}</option>
                  {turfs.map((t) => (
                    <option key={t._id} value={t._id}>{t.name}{t.location?.city ? ` — ${t.location.city}` : ""}</option>
                  ))}
                </select>
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Format</span>
                <select className="form-select" value={draft.format} onChange={(e) => setField("format", e.target.value)}>
                  <option value="">Same ({sd.format || "6v6"})</option>
                  {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Fee (₹)</span>
                <input type="number" min={0} step={1} className="form-input" value={draft.feeInRs}
                  placeholder={String((sd.feeInPaise || 0) / 100)}
                  onChange={(e) => setField("feeInRs", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Max players</span>
                <input type="number" min={0} step={1} className="form-input" value={draft.totalSlots}
                  placeholder={numOrEmpty(sd.totalSlots) || "—"}
                  onChange={(e) => setField("totalSlots", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Min players</span>
                <input type="number" min={0} step={1} className="form-input" value={draft.minPlayers}
                  placeholder={numOrEmpty(sd.minPlayers) || "—"}
                  onChange={(e) => setField("minPlayers", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Duration (min)</span>
                <input type="number" min={15} step={15} className="form-input" value={draft.durationMins}
                  placeholder={numOrEmpty(sd.durationMins) || "60"}
                  onChange={(e) => setField("durationMins", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Report (min before)</span>
                <input type="number" min={0} step={5} className="form-input" value={draft.reportingMinsBeforeGame}
                  placeholder={numOrEmpty(sd.reportingMinsBeforeGame) || "30"}
                  onChange={(e) => setField("reportingMinsBeforeGame", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Cutoff (hrs before)</span>
                <input type="number" min={0} step={1} className="form-input" value={draft.cutoffHoursBeforeGame}
                  placeholder={numOrEmpty(sd.cutoffHoursBeforeGame) || "2"}
                  onChange={(e) => setField("cutoffHoursBeforeGame", e.target.value)} />
              </label>

              <label className="rec-ov-field">
                <span className="form-label">Backout fee (₹)</span>
                <input type="number" min={0} step={1} className="form-input" value={draft.backoutFeeInRs}
                  placeholder={String((sd.backoutFeeInPaise || 0) / 100)}
                  onChange={(e) => setField("backoutFeeInRs", e.target.value)} />
              </label>

              {/* Visibility is decided when the Game is built and is not among
                  the fields pushed onto a live game, so offering it after
                  materialisation would be a control that does nothing. */}
              <label className="rec-ov-field">
                <span className="form-label">Visibility</span>
                <select className="form-select" value={draft.visibility} disabled={customising.status === "created"}
                  onChange={(e) => setField("visibility", e.target.value)}>
                  <option value="">Same ({sd.visibility === "private" ? "private" : "public"})</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
                {customising.status === "created" && (
                  <small className="rec-ov-note">Fixed once the game is live</small>
                )}
              </label>

              <label className="rec-ov-field">
                <span className="form-label">I&apos;m playing</span>
                <select className="form-select" value={draft.organiserIsPlaying} onChange={(e) => setField("organiserIsPlaying", e.target.value)}>
                  <option value="">Same ({sd.organiserIsPlaying ? "yes" : "no"})</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>

            <div className="rec-modal-actions">
              <button className="btn btn-secondary" onClick={() => setDraft(EMPTY_DRAFT)}>Clear all</button>
              <button className="btn btn-secondary" onClick={() => setCustomising(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doCustomise}>Save this game</button>
            </div>
          </div>
        </div>
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
