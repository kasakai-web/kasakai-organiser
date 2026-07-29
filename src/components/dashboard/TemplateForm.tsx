"use client";

// Create / edit a reusable game template. Mirrors the field set of
// CreateEventForm (and reuses its CSS) but carries NO fixed date — it stores a
// default time-of-day. A template made here is what the Templates page turns
// into a real game, either instantly or via the prefilled create form.
//
// Templates schedule nothing. A template can SEED a recurring schedule, but the
// schedule then owns its own copy of these settings — see the Recurring page.

import { useState, useEffect, useRef } from "react";
import "./CreateEventForm.css";
import { buildApiUrl, getSession } from "@/utils/api";
import { saveTemplate, updateTemplate, type Template, type Format } from "@/utils/templates";

const TIME_SLOT_OPTIONS = Array.from({ length: 96 }, (_, idx) => {
  const hours = Math.floor(idx / 4);
  const minutes = String((idx % 4) * 15).padStart(2, "0");
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const period = hours < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${minutes} ${period}` };
});

const FORMATS: Format[] = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"];
const slotsFromFormat = (fmt: string) => {
  const p = fmt.split("v");
  return p.length === 2 ? parseInt(p[0]) + parseInt(p[1]) : 10;
};

interface Turf { _id: string; name: string; location?: { city?: string }; }
const turfId = (t?: Template["turf"]): string =>
  !t ? "" : typeof t === "string" ? t : t._id;

export interface TemplateFormProps {
  template?: Template | null; // present = edit mode
  onClose?: () => void;
  onSaved?: (t: Template) => void;
}

export function TemplateForm({ template, onClose, onSaved }: TemplateFormProps) {
  const editing = !!template;
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(template?.visibility === "private" ? "private" : "public");
  const [requiresApproval, setRequiresApproval] = useState<boolean>(template?.requiresApproval === true);
  const [turf, setTurf] = useState(turfId(template?.turf));
  const [timeOfDay, setTimeOfDay] = useState(template?.defaultTimeOfDay ?? "18:00");
  const initialFormat = (template?.format as Format) ?? "6v6";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [durationMins, setDuration] = useState(template?.durationMins ?? 60);
  const [reportingMins, setReporting] = useState(template?.reportingMinsBeforeGame ?? 30);
  const [cutoffHours, setCutoffHours] = useState(template?.cutoffHoursBeforeGame ?? 2);
  const [feeInRs, setFeeInRs] = useState(template?.feeInPaise ? String(template.feeInPaise / 100) : "");
  const [backoutFeeInRs, setBackoutFeeInRs] = useState(template?.backoutFeeInPaise ? String(template.backoutFeeInPaise / 100) : "");
  const [minPlayers, setMinPlayers] = useState<string>(
    template?.minPlayers ? String(template.minPlayers) : String(Math.ceil(slotsFromFormat(initialFormat) / 2))
  );
  const [maxPlayers, setMaxPlayers] = useState<string>(
    template?.totalSlots ? String(template.totalSlots) : String(slotsFromFormat(initialFormat))
  );
  const minEdited = useRef(!!template?.minPlayers);
  const [organiserIsPlaying, setOrganiserPlaying] = useState(template?.organiserIsPlaying ?? false);

  const [allowSizeChange, setAllowSizeChange] = useState(template?.allowSizeChange ?? false);
  const lastAlt = template?.alternateFormats?.[0] || null;
  const [altFormat, setAltFormat] = useState<Format>((lastAlt?.format as Format) ?? "5v5");
  const [altTurf, setAltTurf] = useState<string>(turfId(lastAlt?.turf));
  const [altMin, setAltMin] = useState<string>(lastAlt?.minPlayers ? String(lastAlt.minPlayers) : "");
  const [altMax, setAltMax] = useState<string>(lastAlt?.maxPlayers ? String(lastAlt.maxPlayers) : "");
  const [altFee, setAltFee] = useState<string>(lastAlt?.feeInPaise ? String(lastAlt.feeInPaise / 100) : "");

  const [automationEnabled, setAutomationEnabled] = useState(template?.automationEnabled ?? false);
  const [customChecks, setCustomChecks] = useState<boolean>(!!(template?.firstCheckTime || template?.secondCheckTime));
  const [firstCheckTime, setFirstCheckTime] = useState(template?.firstCheckTime ?? "14:00");
  const [secondCheckTime, setSecondCheckTime] = useState(template?.secondCheckTime ?? "16:00");

  useEffect(() => {
    const { token } = getSession();
    fetch(buildApiUrl("/api/v1/turfs"), token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setTurfs(d.data);
          if (!turf && d.data.length > 0) setTurf(d.data[0]._id);
        }
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const slots = slotsFromFormat(format);
    setMaxPlayers((prev) => (Number(prev) >= slots ? prev : String(slots)));
    if (!minEdited.current) setMinPlayers(String(Math.ceil(slots / 2)));
    else setMinPlayers((prev) => String(Math.min(Number(prev), slots)));
  }, [format]);

  const handleSubmit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Template name is required";
    if (!turf) e.turf = "Please select a turf";
    if (!feeInRs || isNaN(Number(feeInRs)) || Number(feeInRs) < 0) e.feeInRs = "Valid fee is required";
    const slots = slotsFromFormat(format);
    if (Number(minPlayers) < 2) e.minMax = "Min players must be at least 2";
    else if (Number(minPlayers) > slots) e.minMax = `Min players cannot exceed ${slots} for ${format}`;
    else if (Number(maxPlayers) < slots) e.minMax = `Max players must be at least ${slots} for ${format}`;
    else if (Number(maxPlayers) < Number(minPlayers)) e.minMax = "Max cannot be less than min";
    if (allowSizeChange) {
      const altSlots = slotsFromFormat(altFormat);
      if (altFormat === format) e.alt = `Alternate format must differ from ${format}`;
      else if (!altMin || Number(altMin) < 2) e.alt = "Alternate min must be at least 2";
      else if (Number(altMin) >= Number(minPlayers)) e.alt = `Alternate min must be less than main min (${minPlayers})`;
      else if (Number(altMax) < altSlots) e.alt = `Alternate max must be at least ${altSlots}`;
      else if (altFee === "" || Number(altFee) < 0) e.alt = "Alternate fee is required";
      else if (feeInRs !== "" && Number(altFee) >= Number(feeInRs)) e.alt = `Alternate fee must be less than the main fee (₹${feeInRs})`;
    }
    if (customChecks && firstCheckTime >= secondCheckTime) e.checks = "Second check-in must be after the first";
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        title: title.trim() || null,
        visibility,
        requiresApproval,
        turf,
        format,
        defaultTimeOfDay: timeOfDay,
        durationMins: Number(durationMins),
        reportingMinsBeforeGame: Number(reportingMins),
        cutoffHoursBeforeGame: Number(cutoffHours),
        feeInRs: Number(feeInRs),
        backoutFeeInRs: backoutFeeInRs === "" ? 0 : Number(backoutFeeInRs),
        minPlayers: Number(minPlayers),
        totalSlots: Number(maxPlayers),
        allowSizeChange,
        organiserIsPlaying,
        automationEnabled,
        firstCheckTime: customChecks ? firstCheckTime : null,
        secondCheckTime: customChecks ? secondCheckTime : null,
        alternateFormats: allowSizeChange
          ? [{ format: altFormat, turf: altTurf || turf, minPlayers: Number(altMin), maxPlayers: Number(altMax), feeInRs: Number(altFee) }]
          : [],
      };
      const saved = editing ? await updateTemplate(template!._id, payload) : await saveTemplate(payload);
      onSaved?.(saved);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "An error occurred" });
    } finally {
      setLoading(false);
    }
  };

  const slots = slotsFromFormat(format);

  return (
    <div className="create-event-page">
      <div className="create-event-header">
        <div className="header-content">
          <div className="header-badge">📋 {editing ? "Edit Template" : "New Template"}</div>
          <h2 className="header-title">{editing ? "Update your game template" : "Save a reusable game template"}</h2>
          <p className="header-subtitle">Set it up once, then spin up a game any day in one tap. For games that repeat, create a recurring schedule instead.</p>
        </div>
      </div>

      <form className="create-event-form" onSubmit={(ev) => { ev.preventDefault(); handleSubmit(); }}>
        {errors.submit && (
          <div className="form-error-banner"><span className="error-icon">⚠️</span><span>{errors.submit}</span></div>
        )}

        <div className="form-section">
          <h3 className="section-title">Template</h3>
          <div className="form-group">
            <label className="form-label"><span className="label-text">Template name</span><span className="label-required">*</span></label>
            <input type="text" placeholder="e.g. Friday Night 6v6" value={name} onChange={(ev) => setName(ev.target.value)} className={`form-input ${errors.name ? "error" : ""}`} />
            {errors.name && <div className="field-error">{errors.name}</div>}
            <div className="field-hint">A label for you — not shown to players.</div>
          </div>
          <div className="form-group">
            <label className="form-label"><span className="label-text">Default event name</span></label>
            <input type="text" placeholder="e.g. Friday Night Clash" value={title} onChange={(ev) => setTitle(ev.target.value)} className="form-input" />
            <div className="field-hint">Used as the game title (defaults to the template name if left blank).</div>
          </div>

          <div className="form-group">
            <label className="form-label"><span className="label-text">Visibility</span></label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["public", "private"] as const).map((v) => (
                <button type="button" key={v} onClick={() => setVisibility(v)} style={{
                  flex: 1, padding: "12px 14px", borderRadius: 10,
                  border: visibility === v ? "1.5px solid #c8ff3e" : "1.5px solid #2a2a2a",
                  background: visibility === v ? "rgba(200,255,62,0.12)" : "#141414",
                  color: visibility === v ? "#c8ff3e" : "#bbb", cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v === "public" ? "🌍 Public" : "🔒 Private"}</div>
                  <div style={{ fontSize: 11.5, color: "#888", marginTop: 3 }}>{v === "public" ? "Listed for everyone." : "Invite-only via link."}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="toggle-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={requiresApproval} onChange={(ev) => setRequiresApproval(ev.target.checked)} className="toggle-checkbox" />
            <span className="toggle-label">Require approval — players request, you approve</span>
          </label>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label"><span className="label-text">Turf / Venue</span><span className="label-required">*</span></label>
            <select value={turf} onChange={(ev) => setTurf(ev.target.value)} className={`form-select ${errors.turf ? "error" : ""}`}>
              <option value="">Choose a turf…</option>
              {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}{t.location?.city ? ` • ${t.location.city}` : ""}</option>)}
            </select>
            {errors.turf && <div className="field-error">{errors.turf}</div>}
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Default Schedule</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Kick-off time</span></label>
              <select value={timeOfDay} onChange={(ev) => setTimeOfDay(ev.target.value)} className="form-select">
                {TIME_SLOT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <div className="field-hint">The time each game starts — the day is chosen when you use the template.</div>
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">Duration (min)</span></label>
              <input type="number" min="15" step="15" value={durationMins} onChange={(ev) => setDuration(Math.max(15, Number(ev.target.value) || 15))} className="form-input" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Players report (min before)</span></label>
              <select value={String(reportingMins)} onChange={(ev) => setReporting(Number(ev.target.value))} className="form-select">
                {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} mins before</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">Registration cutoff (hrs before)</span></label>
              <input type="number" min="0" step="1" value={cutoffHours} onChange={(ev) => setCutoffHours(Math.max(0, Number(ev.target.value) || 0))} className="form-input" />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Game Configuration</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Format</span></label>
              <select value={format} onChange={(ev) => setFormat(ev.target.value as Format)} className="form-select">
                {FORMATS.map((f) => <option key={f} value={f}>{f} ({slotsFromFormat(f)} players)</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">Fee per player</span><span className="label-required">*</span></label>
              <div className="input-with-prefix">
                <span className="input-prefix">₹</span>
                <input type="number" min="0" step="1" placeholder="e.g. 350" value={feeInRs} onChange={(ev) => setFeeInRs(ev.target.value)} className={`form-input ${errors.feeInRs ? "error" : ""}`} />
              </div>
              {errors.feeInRs && <div className="field-error">{errors.feeInRs}</div>}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Min players</span></label>
              <input type="number" min="2" max={slots} value={minPlayers}
                onChange={(ev) => { minEdited.current = true; setMinPlayers(ev.target.value); }}
                className={`form-input ${errors.minMax ? "error" : ""}`} />
              <div className="field-hint">Min to confirm · max {slots} for {format}</div>
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">Max players</span></label>
              <input type="number" min={slots} value={maxPlayers} onChange={(ev) => setMaxPlayers(ev.target.value)} className={`form-input ${errors.minMax ? "error" : ""}`} />
              {errors.minMax && <div className="field-error">{errors.minMax}</div>}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label"><span className="label-text">Backout fee</span></label>
            <div className="input-with-prefix">
              <span className="input-prefix">₹</span>
              <input type="number" min="0" step="1" placeholder="0" value={backoutFeeInRs} onChange={(ev) => setBackoutFeeInRs(ev.target.value)} className="form-input" />
            </div>
            <div className="field-hint">Charged if a player backs out after the cutoff. Leave 0 for none.</div>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={organiserIsPlaying} onChange={(ev) => setOrganiserPlaying(ev.target.checked)} className="toggle-checkbox" />
            <span className="toggle-label">I play in these games (uses 1 slot)</span>
          </label>
        </div>

        <div className="form-section">
          <h3 className="section-title">Format Change</h3>
          <label className="toggle-row">
            <input type="checkbox" checked={allowSizeChange} onChange={(ev) => setAllowSizeChange(ev.target.checked)} className="toggle-checkbox" />
            <span className="toggle-label">Allow switching to a smaller format if it can&apos;t fill</span>
          </label>
          {allowSizeChange && (
            <>
              <div className="form-row" style={{ marginTop: 10 }}>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. format</span></label>
                  <select className="form-select" value={altFormat} onChange={(ev) => setAltFormat(ev.target.value as Format)}>
                    {FORMATS.map((f) => <option key={f} value={f}>{f} ({slotsFromFormat(f)})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. turf</span></label>
                  <select className="form-select" value={altTurf || turf} onChange={(ev) => setAltTurf(ev.target.value)}>
                    {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. min</span></label>
                  <input type="number" min={2} className="form-input" value={altMin} onChange={(ev) => setAltMin(ev.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. max</span></label>
                  <input type="number" min={slotsFromFormat(altFormat)} className="form-input" value={altMax} onChange={(ev) => setAltMax(ev.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. fee</span></label>
                  <div className="input-with-prefix"><span className="input-prefix">₹</span>
                    <input type="number" min="0" step="1" className="form-input" value={altFee} onChange={(ev) => setAltFee(ev.target.value)} />
                  </div>
                </div>
              </div>
              {errors.alt && <div className="field-error">{errors.alt}</div>}
            </>
          )}
        </div>

        <div className="form-section">
          <h3 className="section-title">Confirmation Check-ins</h3>
          <label className="toggle-row">
            <input type="checkbox" checked={automationEnabled} onChange={(ev) => setAutomationEnabled(ev.target.checked)} className="toggle-checkbox" />
            <span className="toggle-label">Automation — auto-confirm / auto-cancel at the 2nd check-in</span>
          </label>
          <label className="toggle-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={customChecks} onChange={(ev) => setCustomChecks(ev.target.checked)} className="toggle-checkbox" />
            <span className="toggle-label">Set custom check-in times (else auto: 2pm/4pm, or 8pm/10pm the day before for morning games)</span>
          </label>
          {customChecks && (
            <div className="form-row" style={{ marginTop: 10 }}>
              <div className="form-group">
                <label className="form-label"><span className="label-text">First check-in time</span></label>
                <select className="form-select" value={firstCheckTime} onChange={(ev) => setFirstCheckTime(ev.target.value)}>
                  {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><span className="label-text">Second check-in time</span></label>
                <select className="form-select" value={secondCheckTime} onChange={(ev) => setSecondCheckTime(ev.target.value)}>
                  {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          )}
          {errors.checks && <div className="field-error">{errors.checks}</div>}
        </div>

        <div className="form-actions">
          {onClose && <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <><span className="btn-spinner">⏳</span> Saving…</> : <><span className="btn-icon">✓</span> {editing ? "Save changes" : "Create template"}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
