"use client";

// Create / edit a recurring game schedule.
//
// The form is split in two: the RULE (how often, from when, until when) and the
// GAME (what each occurrence looks like — the same field set as a template).
// A live calendar preview sits alongside, driven by the backend's own expansion
// engine, so the organiser sees the actual dates and any venue/organiser clashes
// before a single game exists.

import { useState, useEffect, useRef, useCallback } from "react";
import "./CreateEventForm.css";
import "../../app/dashboard/organizer/[id]/recurring/recurring.css";
import { buildApiUrl, getSession } from "@/utils/api";
import { listTemplates, type Template, type Format } from "@/utils/templates";
import {
  createSeries, updateSeries, previewSchedule,
  WEEKDAYS, WEEKDAYS_LONG, todayIST, prettyDate, prettyClock, turfIdOf,
  type RecurringSeries, type Freq, type EndMode, type SchedulePreview, type EditScope,
} from "@/utils/recurring";

interface Turf { _id: string; name: string; location?: { city?: string } }

// 15-minute kickoff slots, matching the template + create forms.
const TIME_SLOTS = Array.from({ length: 96 }, (_, idx) => {
  const h = Math.floor(idx / 4);
  const m = (idx % 4) * 15;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { value, label: `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
});

const slotsFromFormat = (fmt: Format): number => {
  const [a, b] = fmt.split("v").map(Number);
  return (a || 0) + (b || 0);
};

interface Props {
  series?: RecurringSeries | null;
  /** The occurrence a "this and future" edit should split at (the next one up). */
  pivotOccurrenceId?: string | null;
  onClose?: () => void;
  onSaved?: (s: RecurringSeries) => void;
}

export function RecurringSeriesForm({ series, pivotOccurrenceId, onClose, onSaved }: Props) {
  const editing = !!series;
  const d = series?.gameDefaults;

  // ── Schedule ──
  const [name, setName] = useState(series?.name ?? "");
  const [freq, setFreq] = useState<Freq>(series?.rule?.freq ?? "weekly");
  const [interval, setInterval] = useState(series?.rule?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(series?.rule?.weekdays ?? []);
  const [monthlyMode, setMonthlyMode] = useState<"dayOfMonth" | "nthWeekday">(series?.rule?.monthlyMode ?? "dayOfMonth");
  const [dayOfMonth, setDayOfMonth] = useState(series?.rule?.dayOfMonth ?? 1);
  const [nth, setNth] = useState(series?.rule?.nth ?? 1);
  const [nthWeekday, setNthWeekday] = useState(series?.rule?.nthWeekday ?? 0);
  const [timeOfDay, setTimeOfDay] = useState(series?.rule?.timeOfDay ?? "18:00");

  const [startDate, setStartDate] = useState(series?.startDate ?? todayIST());
  const [endMode, setEndMode] = useState<EndMode>(series?.endMode ?? "never");
  const [endDate, setEndDate] = useState(series?.endDate ?? "");
  const [maxOccurrences, setMaxOccurrences] = useState(series?.maxOccurrences ?? 12);

  const [blackouts, setBlackouts] = useState(series?.blackoutRanges ?? []);
  const [boFrom, setBoFrom] = useState("");
  const [boTo, setBoTo] = useState("");
  const [boLabel, setBoLabel] = useState("");

  const [conflictMode, setConflictMode] = useState<"warn" | "block">(series?.conflictPolicy?.mode ?? "warn");
  const [checkVenue, setCheckVenue] = useState(series?.conflictPolicy?.checkVenue ?? true);
  const [checkOrganiser, setCheckOrganiser] = useState(series?.conflictPolicy?.checkOrganiser ?? true);
  const [checkOverlap, setCheckOverlap] = useState(series?.conflictPolicy?.checkOverlap ?? true);

  const [horizonDays, setHorizonDays] = useState(series?.generation?.horizonDays ?? 60);
  const [leadDays, setLeadDays] = useState(series?.generation?.leadDays ?? 7);

  // ── Game blueprint ──
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [turf, setTurf] = useState<string>(turfIdOf(d?.turf ?? null));
  const [title, setTitle] = useState(d?.title ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(d?.visibility ?? "public");
  const [requiresApproval, setRequiresApproval] = useState(d?.requiresApproval ?? false);
  const [format, setFormat] = useState<Format>((d?.format as Format) ?? "6v6");
  const [durationMins, setDurationMins] = useState(d?.durationMins ?? 60);
  const [reportingMins, setReportingMins] = useState(d?.reportingMinsBeforeGame ?? 30);
  const [cutoffHours, setCutoffHours] = useState(d?.cutoffHoursBeforeGame ?? 2);
  const [feeInRs, setFeeInRs] = useState(d?.feeInPaise != null ? String(d.feeInPaise / 100) : "");
  const [backoutFeeInRs, setBackoutFeeInRs] = useState(d?.backoutFeeInPaise ? String(d.backoutFeeInPaise / 100) : "");
  const [minPlayers, setMinPlayers] = useState(String(d?.minPlayers || Math.ceil(slotsFromFormat((d?.format as Format) ?? "6v6") / 2)));
  const [totalSlots, setTotalSlots] = useState(String(d?.totalSlots || slotsFromFormat((d?.format as Format) ?? "6v6")));
  const [organiserIsPlaying, setOrganiserIsPlaying] = useState(d?.organiserIsPlaying ?? false);
  const [automationEnabled, setAutomationEnabled] = useState(d?.automationEnabled ?? false);

  const [notifyOnCreate, setNotifyOnCreate] = useState(series?.notifyOrganiser?.onCreate ?? true);
  const [notifyOnChange, setNotifyOnChange] = useState(series?.notifyOrganiser?.onChange ?? true);
  const [notifyOnCancel, setNotifyOnCancel] = useState(series?.notifyOrganiser?.onCancel ?? true);

  // ── Seeding from a saved template ──
  const [templates, setTemplates] = useState<Template[]>([]);
  const [seedTemplateId, setSeedTemplateId] = useState("");

  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Exclude<EditScope, "occurrence">>("series");

  const minEdited = useRef(!!d?.minPlayers);

  useEffect(() => {
    const { token } = getSession();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(buildApiUrl("/api/v1/turfs"), headers ? { headers } : undefined)
      .then((r) => r.json())
      .then((res) => {
        if (!res.success) return;
        setTurfs(res.data);
        setTurf((prev) => prev || (res.data[0]?._id ?? ""));
      })
      .catch(() => {});
    if (!editing) listTemplates().then(setTemplates).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Squad size follows the format unless the organiser has said otherwise.
  useEffect(() => {
    const slots = slotsFromFormat(format);
    setTotalSlots((prev) => (Number(prev) >= slots ? prev : String(slots)));
    if (!minEdited.current) setMinPlayers(String(Math.ceil(slots / 2)));
  }, [format]);

  // Weekly with nothing picked is meaningless — seed it from the start date so
  // the preview is never mysteriously empty on first open.
  useEffect(() => {
    if (freq === "weekly" && weekdays.length === 0 && startDate) {
      const wd = new Date(`${startDate}T12:00:00+05:30`).getUTCDay();
      setWeekdays([wd]);
    }
  }, [freq, startDate, weekdays.length]);

  const applyTemplate = (templateId: string) => {
    setSeedTemplateId(templateId);
    const t = templates.find((x) => x._id === templateId);
    if (!t) return;
    if (!name.trim()) setName(t.name);
    setTitle(t.title ?? "");
    setVisibility(t.visibility ?? "public");
    setRequiresApproval(!!t.requiresApproval);
    setTurf(turfIdOf(t.turf ?? null) || turf);
    setFormat((t.format as Format) ?? "6v6");
    setTimeOfDay(t.defaultTimeOfDay ?? "18:00");
    setDurationMins(t.durationMins ?? 60);
    setReportingMins(t.reportingMinsBeforeGame ?? 30);
    setCutoffHours(t.cutoffHoursBeforeGame ?? 2);
    setFeeInRs(String((t.feeInPaise ?? 0) / 100));
    setBackoutFeeInRs(t.backoutFeeInPaise ? String(t.backoutFeeInPaise / 100) : "");
    if (t.minPlayers) { minEdited.current = true; setMinPlayers(String(t.minPlayers)); }
    if (t.totalSlots) setTotalSlots(String(t.totalSlots));
    setOrganiserIsPlaying(!!t.organiserIsPlaying);
    setAutomationEnabled(!!t.automationEnabled);
  };

  // The payload is assembled once and used for both preview and save, so the
  // preview can never describe a different schedule than the one that saves.
  const buildPayload = useCallback((): Record<string, unknown> => ({
    name: name.trim(),
    rule: {
      freq,
      interval: Number(interval) || 1,
      weekdays,
      monthlyMode,
      dayOfMonth: Number(dayOfMonth),
      nth: Number(nth),
      nthWeekday: Number(nthWeekday),
      timeOfDay,
    },
    startDate,
    endMode,
    endDate: endMode === "onDate" ? endDate : null,
    maxOccurrences: endMode === "afterCount" ? Number(maxOccurrences) : null,
    blackoutRanges: blackouts,
    conflictPolicy: { mode: conflictMode, checkVenue, checkOrganiser, checkOverlap },
    generation: { horizonDays: Number(horizonDays), leadDays: Number(leadDays) },
    notifyOrganiser: { onCreate: notifyOnCreate, onChange: notifyOnChange, onCancel: notifyOnCancel },
    gameDefaults: {
      title: title.trim() || null,
      visibility,
      requiresApproval,
      turf,
      format,
      durationMins: Number(durationMins),
      reportingMinsBeforeGame: Number(reportingMins),
      cutoffHoursBeforeGame: Number(cutoffHours),
      feeInRs: feeInRs === "" ? 0 : Number(feeInRs),
      backoutFeeInRs: backoutFeeInRs === "" ? 0 : Number(backoutFeeInRs),
      minPlayers: Number(minPlayers),
      totalSlots: Number(totalSlots),
      organiserIsPlaying,
      automationEnabled,
    },
  }), [
    name, freq, interval, weekdays, monthlyMode, dayOfMonth, nth, nthWeekday, timeOfDay,
    startDate, endMode, endDate, maxOccurrences, blackouts, conflictMode, checkVenue,
    checkOrganiser, checkOverlap, horizonDays, leadDays, notifyOnCreate, notifyOnChange,
    notifyOnCancel, title, visibility, requiresApproval, turf, format, durationMins,
    reportingMins, cutoffHours, feeInRs, backoutFeeInRs, minPlayers, totalSlots,
    organiserIsPlaying, automationEnabled,
  ]);

  // Debounced preview. Every keystroke in the rule would otherwise be a request,
  // and the conflict check behind it is a real query.
  useEffect(() => {
    if (!turf) return;
    let cancelled = false;
    setPreviewing(true);
    const handle = setTimeout(() => {
      previewSchedule({ ...buildPayload(), seriesId: series?._id }, 10)
        .then((res) => { if (!cancelled) { setPreview(res); setPreviewError(null); } })
        .catch((err) => { if (!cancelled) { setPreview(null); setPreviewError(err.message); } })
        .finally(() => { if (!cancelled) setPreviewing(false); });
    }, 450);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [buildPayload, turf, series?._id]);

  const toggleWeekday = (day: number) =>
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day].sort((a, b) => a - b)));

  const addBlackout = () => {
    if (!boFrom || !boTo || boTo < boFrom) return;
    setBlackouts((prev) => [...prev, { from: boFrom, to: boTo, label: boLabel.trim() || null }]);
    setBoFrom(""); setBoTo(""); setBoLabel("");
  };

  const handleSubmit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Give this schedule a name";
    if (!turf) e.turf = "Pick a venue";
    if (freq === "weekly" && weekdays.length === 0) e.rule = "Pick at least one day of the week";
    if (endMode === "onDate" && (!endDate || endDate < startDate)) e.end = "End date must be on or after the start date";
    if (endMode === "afterCount" && (!maxOccurrences || Number(maxOccurrences) < 1)) e.end = "Enter how many games to create";
    if (feeInRs === "" || isNaN(Number(feeInRs)) || Number(feeInRs) < 0) e.fee = "Enter a valid fee";
    const slots = slotsFromFormat(format);
    if (Number(minPlayers) < 2) e.squad = "Minimum players must be at least 2";
    else if (Number(totalSlots) < slots) e.squad = `Max players must be at least ${slots} for ${format}`;
    else if (Number(minPlayers) > Number(totalSlots)) e.squad = "Minimum cannot exceed maximum";
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    setErrors({});
    setLoading(true);
    try {
      const payload = buildPayload();
      if (editing) {
        const result = await updateSeries(
          series!._id,
          seedTemplateId ? { ...payload, templateId: seedTemplateId } : payload,
          scope,
          scope === "future" ? pivotOccurrenceId ?? undefined : undefined
        );
        // A whole-series edit answers with { series, report }; a split answers
        // with the new series directly.
        onSaved?.((result?.series ?? result) as RecurringSeries);
      } else {
        onSaved?.(await createSeries(seedTemplateId ? { ...payload, templateId: seedTemplateId } : payload));
      }
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-event-page">
      <div className="create-event-header">
        <div className="header-content">
          <div className="header-badge">🔁 {editing ? "Edit Schedule" : "New Recurring Schedule"}</div>
          <h2 className="header-title">{editing ? "Update this recurring schedule" : "Set up games that repeat"}</h2>
          <p className="header-subtitle">
            Games are created automatically {leadDays} day{Number(leadDays) === 1 ? "" : "s"} before each kick-off — not all at once.
          </p>
        </div>
      </div>

      <div className="rec-layout">
        <form className="create-event-form rec-form" onSubmit={(ev) => { ev.preventDefault(); handleSubmit(); }}>
          {errors.submit && <div className="form-error-banner">{errors.submit}</div>}

          {/* ── Basics ─────────────────────────────────────────────── */}
          <div className="form-section">
            <h3 className="section-title">Schedule</h3>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Schedule name *</span></label>
              <input
                className="form-input"
                placeholder="e.g. Tuesday & Thursday evenings"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
              {errors.name && <div className="field-error">{errors.name}</div>}
            </div>

            {!editing && templates.length > 0 && (
              <div className="form-group">
                <label className="form-label"><span className="label-text">Start from a saved template</span></label>
                <select className="form-select" value={seedTemplateId} onChange={(ev) => applyTemplate(ev.target.value)}>
                  <option value="">Don&apos;t use a template</option>
                  {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
                <div className="field-hint">The schedule takes a copy — editing the template later won&apos;t change it.</div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label"><span className="label-text">Repeats</span></label>
                <select className="form-select" value={freq} onChange={(ev) => setFreq(ev.target.value as Freq)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Every</span></label>
                <div className="rec-inline">
                  <input
                    type="number" min={1} max={52} className="form-input" style={{ maxWidth: 90 }}
                    value={interval} onChange={(ev) => setInterval(Math.max(1, Number(ev.target.value) || 1))}
                  />
                  <span className="rec-inline-label">
                    {freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : "month(s)"}
                  </span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Kick-off time</span></label>
                <select className="form-select" value={timeOfDay} onChange={(ev) => setTimeOfDay(ev.target.value)}>
                  {TIME_SLOTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {freq === "weekly" && (
              <div className="form-group">
                <label className="form-label"><span className="label-text">On these days</span></label>
                <div className="rec-day-picker">
                  {WEEKDAYS.map((label, day) => (
                    <button
                      key={day} type="button"
                      className={`rec-day-btn ${weekdays.includes(day) ? "on" : ""}`}
                      onClick={() => toggleWeekday(day)}
                      aria-pressed={weekdays.includes(day)}
                    >{label}</button>
                  ))}
                </div>
                {errors.rule && <div className="field-error">{errors.rule}</div>}
              </div>
            )}

            {freq === "monthly" && (
              <div className="form-group">
                <label className="form-label"><span className="label-text">Which day of the month</span></label>
                <div className="rec-radio-row">
                  <label className="rec-radio">
                    <input type="radio" checked={monthlyMode === "dayOfMonth"} onChange={() => setMonthlyMode("dayOfMonth")} />
                    <span>On day</span>
                    <input
                      type="number" min={1} max={31} className="form-input rec-mini"
                      value={dayOfMonth} disabled={monthlyMode !== "dayOfMonth"}
                      onChange={(ev) => setDayOfMonth(Math.min(31, Math.max(1, Number(ev.target.value) || 1)))}
                    />
                  </label>
                  <label className="rec-radio">
                    <input type="radio" checked={monthlyMode === "nthWeekday"} onChange={() => setMonthlyMode("nthWeekday")} />
                    <span>On the</span>
                    <select
                      className="form-select rec-mini" value={nth} disabled={monthlyMode !== "nthWeekday"}
                      onChange={(ev) => setNth(Number(ev.target.value))}
                    >
                      <option value={1}>first</option>
                      <option value={2}>second</option>
                      <option value={3}>third</option>
                      <option value={4}>fourth</option>
                      <option value={-1}>last</option>
                    </select>
                    <select
                      className="form-select rec-mini" value={nthWeekday} disabled={monthlyMode !== "nthWeekday"}
                      onChange={(ev) => setNthWeekday(Number(ev.target.value))}
                    >
                      {WEEKDAYS_LONG.map((label, day) => <option key={day} value={day}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="field-hint">A month too short for the chosen day simply has no game that month.</div>
              </div>
            )}
          </div>

          {/* ── Date range ─────────────────────────────────────────── */}
          <div className="form-section">
            <h3 className="section-title">Runs from / until</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label"><span className="label-text">First game on</span></label>
                <input type="date" className="form-input" min={editing ? undefined : todayIST()} value={startDate} onChange={(ev) => setStartDate(ev.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Ends</span></label>
                <select className="form-select" value={endMode} onChange={(ev) => setEndMode(ev.target.value as EndMode)}>
                  <option value="never">Never — keeps going</option>
                  <option value="onDate">On a date</option>
                  <option value="afterCount">After a number of games</option>
                </select>
              </div>
              {endMode === "onDate" && (
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Last game by</span></label>
                  <input type="date" className="form-input" min={startDate} value={endDate} onChange={(ev) => setEndDate(ev.target.value)} />
                </div>
              )}
              {endMode === "afterCount" && (
                <div className="form-group">
                  <label className="form-label"><span className="label-text">How many games</span></label>
                  <input
                    type="number" min={1} max={500} className="form-input"
                    value={maxOccurrences} onChange={(ev) => setMaxOccurrences(Math.max(1, Number(ev.target.value) || 1))}
                  />
                </div>
              )}
            </div>
            {errors.end && <div className="field-error">{errors.end}</div>}

            <div className="form-group" style={{ marginTop: 6 }}>
              <label className="form-label"><span className="label-text">Breaks (no games in these ranges)</span></label>
              {blackouts.length > 0 && (
                <div className="rec-blackout-list">
                  {blackouts.map((b, i) => (
                    <span key={`${b.from}-${b.to}-${i}`} className="rec-blackout-chip">
                      {b.label ? `${b.label}: ` : ""}{prettyDate(b.from)} – {prettyDate(b.to)}
                      <button type="button" onClick={() => setBlackouts((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove break">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rec-blackout-add">
                <input type="date" className="form-input" value={boFrom} onChange={(ev) => setBoFrom(ev.target.value)} />
                <span className="rec-inline-label">to</span>
                <input type="date" className="form-input" min={boFrom} value={boTo} onChange={(ev) => setBoTo(ev.target.value)} />
                <input className="form-input" placeholder="Reason (optional)" value={boLabel} onChange={(ev) => setBoLabel(ev.target.value)} />
                <button type="button" className="btn btn-secondary rec-add-btn" onClick={addBlackout} disabled={!boFrom || !boTo}>Add</button>
              </div>
              <div className="field-hint">Blacked-out dates are skipped without using up your game count.</div>
            </div>
          </div>

          {/* ── The game itself ────────────────────────────────────── */}
          <div className="form-section">
            <h3 className="section-title">Each game</h3>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label"><span className="label-text">Venue *</span></label>
                <select className="form-select" value={turf} onChange={(ev) => setTurf(ev.target.value)}>
                  <option value="">Select a venue</option>
                  {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}{t.location?.city ? ` — ${t.location.city}` : ""}</option>)}
                </select>
                {errors.turf && <div className="field-error">{errors.turf}</div>}
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Format</span></label>
                <select className="form-select" value={format} onChange={(ev) => setFormat(ev.target.value as Format)}>
                  {(["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"] as Format[]).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Duration (mins)</span></label>
                <input type="number" min={15} step={15} className="form-input" value={durationMins} onChange={(ev) => setDurationMins(Number(ev.target.value) || 60)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Game name</span></label>
              <input className="form-input" placeholder={name || "Defaults to the schedule name"} value={title} onChange={(ev) => setTitle(ev.target.value)} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label"><span className="label-text">Fee per player *</span></label>
                <div className="input-with-prefix">
                  <span className="input-prefix">₹</span>
                  <input type="number" min="0" step="1" className="form-input" value={feeInRs} onChange={(ev) => setFeeInRs(ev.target.value)} />
                </div>
                {errors.fee && <div className="field-error">{errors.fee}</div>}
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Back-out fee</span></label>
                <div className="input-with-prefix">
                  <span className="input-prefix">₹</span>
                  <input type="number" min="0" step="1" className="form-input" value={backoutFeeInRs} onChange={(ev) => setBackoutFeeInRs(ev.target.value)} />
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label"><span className="label-text">Min players</span></label>
                <input
                  type="number" min={2} className="form-input" value={minPlayers}
                  onChange={(ev) => { minEdited.current = true; setMinPlayers(ev.target.value); }}
                />
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Max players</span></label>
                <input type="number" min={slotsFromFormat(format)} className="form-input" value={totalSlots} onChange={(ev) => setTotalSlots(ev.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Reporting (mins before)</span></label>
                <input type="number" min={0} className="form-input" value={reportingMins} onChange={(ev) => setReportingMins(Number(ev.target.value) || 0)} />
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Registration closes (hrs before)</span></label>
                <input type="number" min={0} className="form-input" value={cutoffHours} onChange={(ev) => setCutoffHours(Number(ev.target.value) || 0)} />
              </div>
            </div>
            {errors.squad && <div className="field-error">{errors.squad}</div>}

            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={visibility === "private"} onChange={(ev) => setVisibility(ev.target.checked ? "private" : "public")} />
              <span className="toggle-label">Private — invite only</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={requiresApproval} onChange={(ev) => setRequiresApproval(ev.target.checked)} />
              <span className="toggle-label">Players need my approval to join</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={organiserIsPlaying} onChange={(ev) => setOrganiserIsPlaying(ev.target.checked)} />
              <span className="toggle-label">I&apos;m playing in these games</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={automationEnabled} onChange={(ev) => setAutomationEnabled(ev.target.checked)} />
              <span className="toggle-label">Auto-confirm / auto-cancel at the second check-in</span>
            </label>
          </div>

          {/* ── Conflicts & generation ─────────────────────────────── */}
          <div className="form-section">
            <h3 className="section-title">Clashes &amp; automation</h3>

            <div className="form-group">
              <label className="form-label"><span className="label-text">When a game clashes</span></label>
              <select className="form-select" value={conflictMode} onChange={(ev) => setConflictMode(ev.target.value as "warn" | "block")}>
                <option value="warn">Warn me but still create the game</option>
                <option value="block">Don&apos;t create the game — hold it for me to sort out</option>
              </select>
            </div>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={checkVenue} onChange={(ev) => setCheckVenue(ev.target.checked)} />
              <span className="toggle-label">Check the venue isn&apos;t double-booked</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={checkOrganiser} onChange={(ev) => setCheckOrganiser(ev.target.checked)} />
              <span className="toggle-label">Check I&apos;m not running another game at that time</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={checkOverlap} onChange={(ev) => setCheckOverlap(ev.target.checked)} />
              <span className="toggle-label">Check games in this schedule don&apos;t overlap each other</span>
            </label>

            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Create each game this many days ahead</span></label>
                <input type="number" min={0} max={7} className="form-input" value={leadDays} onChange={(ev) => setLeadDays(Math.min(7, Math.max(0, Number(ev.target.value) || 0)))} />
                <div className="field-hint">This is also when registration opens.</div>
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Plan the calendar this far ahead (days)</span></label>
                <input type="number" min={7} max={365} className="form-input" value={horizonDays} onChange={(ev) => setHorizonDays(Math.max(7, Number(ev.target.value) || 60))} />
                <div className="field-hint">Dates are planned this far out; games are only created inside the window above.</div>
              </div>
            </div>

            <label className="toggle-row" style={{ marginTop: 8 }}>
              <input type="checkbox" className="toggle-checkbox" checked={notifyOnCreate} onChange={(ev) => setNotifyOnCreate(ev.target.checked)} />
              <span className="toggle-label">WhatsApp me when games are created</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={notifyOnChange} onChange={(ev) => setNotifyOnChange(ev.target.checked)} />
              <span className="toggle-label">WhatsApp me when the schedule changes</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" className="toggle-checkbox" checked={notifyOnCancel} onChange={(ev) => setNotifyOnCancel(ev.target.checked)} />
              <span className="toggle-label">WhatsApp me when a game is cancelled</span>
            </label>
          </div>

          {/* ── Edit scope (existing schedules only) ───────────────── */}
          {editing && (
            <div className="form-section rec-scope-section">
              <h3 className="section-title">Apply these changes to</h3>
              <label className="rec-scope-option">
                <input type="radio" checked={scope === "series"} onChange={() => setScope("series")} />
                <div>
                  <strong>The entire schedule</strong>
                  <span>Past games stay as they were. Upcoming games are updated, and any that the new pattern no longer produces are cancelled where no one has joined yet.</span>
                </div>
              </label>
              <label className="rec-scope-option">
                <input type="radio" checked={scope === "future"} onChange={() => setScope("future")} disabled={!pivotOccurrenceId} />
                <div>
                  <strong>This and all future games</strong>
                  <span>
                    {pivotOccurrenceId
                      ? "Splits the schedule at the next game — everything before it keeps the current settings."
                      : "Not available: there are no upcoming games to split at."}
                  </span>
                </div>
              </label>
              <div className="field-hint" style={{ marginTop: 8 }}>
                To change just one game, use <strong>Edit this game</strong> on the occurrence itself.
              </div>
            </div>
          )}

          <div className="form-actions">
            {onClose && <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="btn-spinner">⏳</span> Saving…</> : <><span className="btn-icon">✓</span> {editing ? "Save changes" : "Create schedule"}</>}
            </button>
          </div>
        </form>

        {/* ── Live calendar preview ─────────────────────────────────── */}
        <aside className="rec-preview">
          <div className="rec-preview-head">
            <h3>Calendar preview</h3>
            {previewing && <span className="rec-preview-spinner">updating…</span>}
          </div>

          {previewError ? (
            <div className="rec-preview-error">{previewError}</div>
          ) : !preview ? (
            <div className="rec-preview-empty">Fill in the schedule to see the dates.</div>
          ) : (
            <>
              <p className="rec-preview-desc">{preview.description}</p>

              {preview.occurrences.length === 0 ? (
                <div className="rec-preview-empty">This pattern produces no games. Check the dates and days.</div>
              ) : (
                <ol className="rec-preview-list">
                  {preview.occurrences.map((o) => (
                    <li key={o.date} className={o.conflicts.length > 0 ? "clash" : ""}>
                      <span className="rec-preview-seq">#{o.seq}</span>
                      <span className="rec-preview-when">
                        {prettyDate(o.date)}
                        <small>{prettyClock(o.scheduledAt)}</small>
                      </span>
                      {o.conflicts.length > 0 && (
                        <span className="rec-preview-clash" title={o.conflicts.map((c) => c.message).join("\n")}>
                          ⚠ {o.conflicts[0].message}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {preview.blackedOut.length > 0 && (
                <div className="rec-preview-note">
                  Skipped for breaks: {preview.blackedOut.map((b) => prettyDate(b.date)).join(", ")}
                </div>
              )}
              {preview.complete && preview.occurrences.length > 0 && (
                <div className="rec-preview-note">That&apos;s the whole schedule — it ends after these games.</div>
              )}
              {!preview.complete && preview.occurrences.length >= 10 && (
                <div className="rec-preview-note">Showing the next 10 games. The schedule continues beyond these.</div>
              )}
              {conflictMode === "block" && preview.occurrences.some((o) => o.conflicts.length > 0) && (
                <div className="rec-preview-warn">
                  Clashing games won&apos;t be created while &ldquo;don&apos;t create&rdquo; is selected — they&apos;ll wait for you on the schedule page.
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
