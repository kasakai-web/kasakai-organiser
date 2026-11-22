"use client";

// The two per-occurrence editors — Move and Edit this game — shared by the
// Recurring page (SeriesDetail) and the dashboard's planned-game cards, so the
// same date cannot be edited two different ways depending on where the
// organiser happened to click. Both touch ONE occurrence and nothing else; a
// change to the whole schedule stays on the schedule form's edit scope.

import { useEffect, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import type { Format } from "@/utils/templates";
import {
  prettyClock, prettyDateFull, toISTInputValue, fromISTInputValue, turfNameOf, turfIdOf,
  type SeriesGameDefaults, type OccurrenceOverrides, type OccurrenceStatus,
} from "@/utils/recurring";
import "./OccurrenceModals.css";

interface Turf { _id: string; name: string; location?: { city?: string } }

const FORMATS: Format[] = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"];

// ── Move ─────────────────────────────────────────────────────────────────────

interface MoveProps {
  scheduledAt: string;
  onClose: () => void;
  /** Called with the new kickoff as an ISO instant. */
  onSave: (iso: string) => void;
  onInvalid: (message: string) => void;
}

export function OccurrenceMoveModal({ scheduledAt, onClose, onSave, onInvalid }: MoveProps) {
  const [value, setValue] = useState(() => toISTInputValue(scheduledAt));

  const save = () => {
    const iso = fromISTInputValue(value);
    if (!iso) { onInvalid("Pick a valid date and time"); return; }
    onSave(iso);
  };

  return (
    <div className="rec-modal-backdrop" onClick={onClose}>
      <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Move this game</h3>
        <p>
          Only this occurrence moves — {prettyDateFull(scheduledAt)} at {prettyClock(scheduledAt)}.
          The rest of the schedule stays exactly as it is.
        </p>
        <input type="datetime-local" className="form-input" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="rec-modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Move it</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit this game ───────────────────────────────────────────────────────────

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

const draftFrom = (ov: OccurrenceOverrides = {}): OverrideDraft => ({
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

interface EditProps {
  scheduledAt: string;
  status: OccurrenceStatus;
  overrides?: OccurrenceOverrides;
  /** What an un-overridden field inherits — shown as each field's placeholder. */
  defaults: SeriesGameDefaults;
  seriesName: string;
  /** The live game's own name, when the occurrence already has one. */
  liveTitle?: string;
  onClose: () => void;
  /** Called with the full override set — null for every field left to inherit. */
  onSave: (overrides: Record<string, unknown>) => void;
  onInvalid: (message: string) => void;
}

export function OccurrenceEditModal({
  scheduledAt, status, overrides, defaults: sd, seriesName, liveTitle, onClose, onSave, onInvalid,
}: EditProps) {
  const [draft, setDraft] = useState<OverrideDraft>(() => draftFrom(overrides));
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const isLive = status === "created";

  // Venues for the override picker. Same call the schedule form makes; the list
  // is small and rarely changes, so one fetch per open is plenty.
  useEffect(() => {
    const { token } = getSession();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(buildApiUrl("/api/v1/turfs"), headers ? { headers } : undefined)
      .then((r) => r.json())
      .then((res) => { if (res.success) setTurfs(res.data); })
      .catch(() => {});
  }, []);

  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    // Only guard what the schema would reject outright — everything else is a
    // legitimate one-off, however odd it looks next to the schedule's defaults.
    const duration = asNum(draft.durationMins);
    if (duration !== null && (isNaN(duration) || duration < 15)) {
      onInvalid("Duration must be at least 15 minutes"); return;
    }
    const slots = asNum(draft.totalSlots);
    const min = asNum(draft.minPlayers);
    if (slots !== null && min !== null && min > slots) {
      onInvalid("Min players can't be more than max players"); return;
    }

    onSave({
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
    });
  };

  return (
    <div className="rec-modal-backdrop" onClick={onClose}>
      <div className="rec-modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Edit this game</h3>
        <p>
          {prettyDateFull(scheduledAt)} at {prettyClock(scheduledAt)}{" "}only — the
          schedule and every other date are untouched. Leave a field blank to keep using the schedule&apos;s setting.
          {isLive && " This game is already live, so changes reach players straight away."}
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
              placeholder={liveTitle || (sd.titlePattern ? "Built from the schedule's name pattern" : sd.title || seriesName)}
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

          {/* A rupee override is inert on a series charging a percentage — the
              engine reads feePercent there — so it is not offered. */}
          <label className="rec-ov-field">
            <span className="form-label">Backout fee (₹)</span>
            <input type="number" min={0} step={1} className="form-input" value={draft.backoutFeeInRs}
              disabled={sd.backoutPolicy?.feeUnit === "percent"}
              placeholder={sd.backoutPolicy?.feeUnit === "percent"
                ? `${sd.backoutPolicy.feePercent ?? 0}% (set on the series)`
                : String((sd.backoutFeeInPaise || 0) / 100)}
              onChange={(e) => setField("backoutFeeInRs", e.target.value)} />
          </label>

          {/* Visibility is decided when the Game is built and is not among
              the fields pushed onto a live game, so offering it after
              materialisation would be a control that does nothing. */}
          <label className="rec-ov-field">
            <span className="form-label">Visibility</span>
            <select className="form-select" value={draft.visibility} disabled={isLive}
              onChange={(e) => setField("visibility", e.target.value)}>
              <option value="">Same ({sd.visibility === "private" ? "private" : "public"})</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            {isLive && <small className="rec-ov-note">Fixed once the game is live</small>}
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
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save this game</button>
        </div>
      </div>
    </div>
  );
}
