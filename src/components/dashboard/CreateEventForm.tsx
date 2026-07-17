"use client";

import { useState, useEffect, useRef } from "react";
import "./CreateEventForm.css"; 
import { buildApiUrl, getSession } from "@/utils/api";
import { checkInDate, defaultCheckTimes, checkInIsoFromParts } from "@/utils/checkins";

const TIME_SLOT_OPTIONS = Array.from({ length: 96 }, (_, idx) => {
  const hours = Math.floor(idx / 4);
  const minutes = String((idx % 4) * 15).padStart(2, "0");
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const period = hours < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${minutes} ${period}` };
});

const FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"] as const;
type Format = typeof FORMATS[number];

const slotsFromFormat = (fmt: string) => {
  const parts = fmt.split("v");
  if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]);
  return 10;
};

const addMins = (timeStr: string, date: string, mins: number): string => {
  if (!date || !timeStr) return "";
  const dt = new Date(`${date}T${timeStr}:00+05:30`);
  if (isNaN(dt.getTime())) return "";
  const result = new Date(dt.getTime() + mins * 60000);
  return result.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
};

const subtractMins = (timeStr: string, date: string, mins: number): string => {
  return addMins(timeStr, date, -mins);
};

const prettyDate = (dateStr: string): string => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
};

interface Turf { _id: string; name: string; location?: { city?: string }; }

export interface CreateEventFormProps {
  lastEvent?: any;
  onClose?: () => void;
  onCreate?: (eventData: any) => void;
  onSuccess?: () => void;
}

export function CreateEventForm({ lastEvent, onClose, onCreate, onSuccess }: CreateEventFormProps) {
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [title, setTitle] = useState(lastEvent?.title ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(lastEvent?.visibility === "private" ? "private" : "public");
  const [turf, setTurf] = useState(lastEvent?.turf?._id || (typeof lastEvent?.turf === "string" ? lastEvent.turf : ""));
  const [date, setDate] = useState("");
  const initialTime = lastEvent ? (() => { const hm = new Date(lastEvent.scheduledAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }); const [hh, mm] = hm.split(":"); return `${hh}:${Number(mm) >= 30 ? "30" : "00"}`; })() : "18:00";
  const [time, setTime] = useState(initialTime);
  const initialFormat = (lastEvent?.format as Format) ?? "5v5";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [durationMins, setDuration] = useState(lastEvent?.durationMins ?? 60);
  const [feeInRs, setFeeInRs] = useState(lastEvent?.feeInPaise ? String(lastEvent.feeInPaise / 100) : "");
  const [reportingMins, setReporting] = useState(lastEvent?.reportingMinsBeforeGame ?? 30);
  const [minPlayers, setMinPlayers] = useState<string>(
    lastEvent?.minPlayers ? String(lastEvent.minPlayers) : String(Math.ceil(slotsFromFormat(initialFormat) / 2))
  );
  const [maxPlayers, setMaxPlayers] = useState<string>(lastEvent?.totalSlots ? String(lastEvent.totalSlots) : String(slotsFromFormat(initialFormat)));
  const minPlayersEdited = useRef(!!lastEvent?.minPlayers);

  const [allowSizeChange, setAllowSizeChange] = useState(lastEvent?.allowSizeChange ?? false);
  const lastAlt = (lastEvent?.alternateFormats && lastEvent.alternateFormats[0]) || null;
  const [altFormat, setAltFormat] = useState<Format>((lastAlt?.format as Format) ?? "5v5");
  const [altTurf, setAltTurf] = useState<string>(lastAlt?.turf?._id || (typeof lastAlt?.turf === "string" ? lastAlt.turf : ""));
  const [altMin, setAltMin] = useState<string>(lastAlt?.minPlayers ? String(lastAlt.minPlayers) : "");
  const [altMax, setAltMax] = useState<string>(lastAlt?.maxPlayers ? String(lastAlt.maxPlayers) : "");
  const [altFee, setAltFee] = useState<string>(lastAlt?.feeInPaise ? String(lastAlt.feeInPaise / 100) : "");
  const altDefaultsSet = useRef(!!lastAlt);
  // Automation master switch (section 3.1, amended Jul 2026): governs EVERYTHING at
  // the 2nd check-in. ON = auto-confirm main/alternate or auto-cancel by itself;
  // OFF = the system only prompts (pop-up + WhatsApp) and waits for the organiser.
  const [automationEnabled, setAutomationEnabled] = useState(lastEvent?.lifecycle?.automationEnabled ?? false);
  const [firstCheckTime, setFirstCheckTime] = useState(defaultCheckTimes(initialTime).first);
  const [secondCheckTime, setSecondCheckTime] = useState(defaultCheckTimes(initialTime).second);
  const [firstCheckDate, setFirstCheckDate] = useState("");
  const [secondCheckDate, setSecondCheckDate] = useState("");
  const [checkTip, setCheckTip] = useState<"first" | "second" | null>(null);
  const checkTimesEdited = useRef(false);
  const [organiserIsPlaying, setOrganiserPlaying] = useState(lastEvent?.organiserIsPlaying ?? false);
  const [organiserGuests, setOrganiserGuests] = useState<{ name: string; position: string; teamPreference: string }[]>([]);
  const [guestPrefOpen, setGuestPrefOpen] = useState(false);
  const [guestPrefName, setGuestPrefName] = useState("");
  const [guestPrefPosition, setGuestPrefPosition] = useState("Any");
  const [guestPrefTeam, setGuestPrefTeam] = useState("No Preference");
  const organiserGuestCount = organiserGuests.length;

  const reportingTime = subtractMins(time, date, reportingMins);
  const endTime = addMins(time, date, Number(durationMins));

  const todayStr = new Date().toISOString().slice(0, 10);
  const firstCheckIso = checkInIsoFromParts(firstCheckDate, firstCheckTime);
  const secondCheckIso = checkInIsoFromParts(secondCheckDate, secondCheckTime);
  const checkOrderBad = !!(firstCheckIso && secondCheckIso && new Date(firstCheckIso) >= new Date(secondCheckIso));

  const hardCap = Number(maxPlayers) || slotsFromFormat(format);
  const organiserSlot = organiserIsPlaying ? 1 : 0;
  const reservedSlots = organiserSlot + organiserGuestCount;
  const openSlots = Math.max(0, hardCap - reservedSlots);
  const maxGuests = Math.max(0, hardCap - organiserSlot); 


  useEffect(() => {
    const { token } = getSession();
    fetch(buildApiUrl("/api/v1/turfs"), token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTurfs(d.data);
          if (!turf && d.data.length > 0) setTurf(d.data[0]._id);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const slots = slotsFromFormat(format);
    setMaxPlayers((prev) => (Number(prev) >= slots ? prev : String(slots)));
    if (!minPlayersEdited.current) {
      setMinPlayers(String(Math.ceil(slots / 2)));
    } else {
      setMinPlayers((prev) => String(Math.min(Number(prev), slots)));
    }
  }, [format]);

  useEffect(() => {
    if (checkTimesEdited.current) return;
    const t = defaultCheckTimes(time);
    setFirstCheckTime(t.first);
    setSecondCheckTime(t.second);
    const cd = checkInDate(date, time);
    if (cd) { setFirstCheckDate(cd); setSecondCheckDate(cd); }
  }, [date, time]);

  useEffect(() => {
    if (!allowSizeChange || altDefaultsSet.current) return;
    altDefaultsSet.current = true;
    const idx = FORMATS.indexOf(format);
    const smaller = idx > 0 ? FORMATS[idx - 1] : format;
    const slots = slotsFromFormat(smaller);
    setAltFormat(smaller);
    setAltTurf((prev) => prev || turf);
    setAltMin((prev) => prev || String(Math.ceil(slots / 2)));
    setAltMax((prev) => prev || String(slots));
  }, [allowSizeChange,format,turf]);

  const handleCreate = async () => {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) newErrors.title = "Event title is required";
    if (!turf) newErrors.turf = "Please select a turf";
    if (!date) newErrors.date = "Date is required";
    if (date && new Date(`${date}T${time}:00+05:30`) <= new Date())
      newErrors.date = "Game must be scheduled in the future";
    if (!feeInRs || isNaN(Number(feeInRs)) || Number(feeInRs) < 0)
      newErrors.feeInRs = "Valid fee is required";
    const formatSlots = slotsFromFormat(format);
    if (Number(minPlayers) < 2)
      newErrors.minMax = "Min players required must be at least 2";
    else if (Number(minPlayers) > formatSlots)
      newErrors.minMax = `Min players cannot exceed ${formatSlots} (total slots for ${format})`;
    else if (Number(maxPlayers) < formatSlots)
      newErrors.minMax = `Max players must be at least ${formatSlots} for ${format}`;
    else if (Number(maxPlayers) < Number(minPlayers))
      newErrors.minMax = "Max players cannot be less than min players";
    const cap = Number(maxPlayers) || slotsFromFormat(format);
    const orgSlot = organiserIsPlaying ? 1 : 0;
    if (orgSlot + organiserGuestCount > cap) {
      newErrors.submit = `You + ${organiserGuestCount} guest${organiserGuestCount !== 1 ? "s" : ""} exceeds the max of ${cap} players. Reduce guests or increase the player limit.`;
    }
    if (allowSizeChange) {
      const altSlots = slotsFromFormat(altFormat);
      if (altFormat === format)
        newErrors.alt = `Alternate format must be different from the main format (${format})`;
      else if (!altMin || Number(altMin) < 2)
        newErrors.alt = "Alternate min players must be at least 2";
      else if (minPlayers !== "" && Number(altMin) >= Number(minPlayers))
        newErrors.alt = `Alternate min (${altMin}) must be less than the main format min (${minPlayers})`;
      else if (Number(altMin) > altSlots)
        newErrors.alt = `Alternate min cannot exceed ${altSlots} (slots for ${altFormat})`;
      else if (Number(altMax) < altSlots)
        newErrors.alt = `Alternate max must be at least ${altSlots} for ${altFormat}`;
      else if (Number(altMax) < Number(altMin))
        newErrors.alt = "Alternate max cannot be less than min";
      else {
        const altFeeNum = Number(altFee);
        if (altFee === "" || isNaN(altFeeNum) || altFeeNum < 0)
          newErrors.alt = "Alternate fee is required (₹0 or more)";
        else if (feeInRs !== "" && altFeeNum >= Number(feeInRs))
          newErrors.alt = `Alternate fee must be less than the main fee (₹${feeInRs})`;
      }
    }
    if (date) {
      const firstIso = checkInIsoFromParts(firstCheckDate, firstCheckTime);
      const secondIso = checkInIsoFromParts(secondCheckDate, secondCheckTime);
      const kickoff = new Date(`${date}T${time}:00+05:30`);
      if (!firstIso || !secondIso) {
        newErrors.checks = "Both check-in dates and times are required.";
      } else if (new Date(firstIso) >= new Date(secondIso)) {
        newErrors.checks = "Second check-in must be after the first.";
      } else if (new Date(secondIso) >= kickoff) {
        newErrors.checks = "Check-ins must be before the game start time.";
      } else if (new Date(firstIso) <= new Date()) {
        newErrors.checks = "First check-in must be in the future.";
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setLoading(true);
    try {
      const { token } = getSession();
      if (!token) { setErrors({ submit: "Please login as organiser first" }); return; }
      const scheduledAt = new Date(`${date}T${time}:00+05:30`);
      const cutoffAt = new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000);
      const slots = Number(maxPlayers) || slotsFromFormat(format);
      const payload: any = {
        title: title.trim(),
        sport: "football",
        visibility,
        format,
        turf,
        scheduledAt: scheduledAt.toISOString(),
        durationMins: Number(durationMins),
        cutoffAt: cutoffAt.toISOString(),
        feeInRs: Number(feeInRs),
        totalSlots: slots,
        minPlayers: Number(minPlayers) || slots,
        reportingMinsBeforeGame: Number(reportingMins),
        allowSizeChange,
        organiserIsPlaying,
        organiserGuests,
        community: null,
        lifecycle: {
          firstCheckAt: checkInIsoFromParts(firstCheckDate, firstCheckTime),
          secondCheckAt: checkInIsoFromParts(secondCheckDate, secondCheckTime),
          automationEnabled,
        },
        alternateFormats: allowSizeChange ? [{
          format: altFormat,
          turf: altTurf || turf,
          minPlayers: Number(altMin),
          maxPlayers: Number(altMax),
          feeInRs: Number(altFee),
        }] : [],
      };

      const res = await fetch(buildApiUrl("/api/v1/games/organisers/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrors({ submit: data?.message || `HTTP ${res.status}` });
        return;
      }

      onCreate?.(data.data);
      onSuccess?.();
    } catch (err: any) {
      setErrors({ submit: err.message || "An error occurred" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-event-page">
      <div className="create-event-header">
        <div className="header-content">
          <div className="header-badge">⚽ Create Event</div>
          <h2 className="header-title">Organise a New Game</h2>
          <p className="header-subtitle">
            {lastEvent ? "Pre-filled from your last event — update the date." : "Fill in the details to create and notify players."}
          </p>
        </div>
      </div>

      <form className="create-event-form" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
        {errors.submit && (
          <div className="form-error-banner">
            <span className="error-icon">⚠️</span>
            <span>{errors.submit}</span>
          </div>
        )}

        <div className="form-section">
          <h3 className="section-title">Event Details</h3>

          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Visibility</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["public", "private"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setVisibility(v)}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: visibility === v ? "1.5px solid #c8ff3e" : "1.5px solid #2a2a2a",
                    background: visibility === v ? "rgba(200,255,62,0.12)" : "#141414",
                    color: visibility === v ? "#c8ff3e" : "#bbb",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {v === "public" ? "🌍 Public" : "🔒 Private"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#888", marginTop: 3 }}>
                    {v === "public"
                      ? "Listed for everyone to browse & join."
                      : "Hidden — invite players by WhatsApp."}
                  </div>
                </button>
              ))}
            </div>
            {visibility === "private" && (
              <div className="field-hint" style={{ marginTop: 8, color: "#c8ff3e" }}>
                After creating, open this game from your dashboard to invite players.
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Event Name</span>
              <span className="label-required">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Friday Night Clash"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`form-input ${errors.title ? "error" : ""}`}
            />
            {errors.title && <div className="field-error">{errors.title}</div>}
          </div>

          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Turf / Venue</span>
              <span className="label-required">*</span>
            </label>
            <select
              value={turf}
              onChange={(e) => setTurf(e.target.value)}
              className={`form-select ${errors.turf ? "error" : ""}`}
            >
              <option value="">Choose a turf…</option>
              {turfs.map((t) => (
                <option key={t._id} value={t._id}>{t.name} • {t.location?.city}</option>
              ))}
            </select>
            {errors.turf && <div className="field-error">{errors.turf}</div>}
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Schedule</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Date</span><span className="label-required">*</span></label>
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className={`form-input ${errors.date ? "error" : ""}`}
              />
              {errors.date && <div className="field-error">{errors.date}</div>}
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Game Start Time</span></label>
              <select value={time} onChange={(e) => { checkTimesEdited.current = false; setTime(e.target.value); }} className="form-select">
                {TIME_SLOT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Players Report</span></label>
              <select
                value={String(reportingMins)}
                onChange={(e) => setReporting(Number(e.target.value))}
                className="form-select"
              >
                {[15,30,45,60].map((m) => (
                  <option key={m} value={m}>{m} mins before game{reportingTime && date ? ` (${reportingTime})` : ""}</option>
                ))}
              </select>
              <div className="field-hint">Time players should arrive at the turf</div>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Duration</span></label>
              <div className="stepper-row">
                <button type="button" className="stepper-btn"
                  onClick={() => setDuration((v: number) => Math.max(15, v - 15))}
                  disabled={Number(durationMins) <= 15}
                >−</button>
                <input
                  type="number" min="15" step="15"
                  value={durationMins}
                  onChange={(e) => setDuration(Math.max(15, Number(e.target.value) || 15))}
                  className="form-input stepper-input"
                />
                <span className="stepper-unit">min</span>
                <button type="button" className="stepper-btn"
                  onClick={() => setDuration((v: number) => v + 15)}
                >+</button>
              </div>
              {endTime && date && (
                <div className="field-hint">Game ends at <strong>{endTime}</strong></div>
              )}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Game Configuration</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Format</span><span className="label-required">*</span></label>
              <select
                value={format}
                onChange={(e) => {
                  const f = e.target.value as Format;
                  setFormat(f);
                  const s = slotsFromFormat(f);
                  setMaxPlayers(String(s));
                  if (!minPlayersEdited.current) setMinPlayers(String(Math.ceil(s / 2)));
                }}
                className="form-select"
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>{f} ({slotsFromFormat(f)} Players)</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Fee per Player</span><span className="label-required">*</span></label>
              <div className="input-with-prefix">
                <span className="input-prefix">₹</span>
                <input
                  type="number"
                  placeholder="e.g. 350"
                  min="0"
                  step="1"
                  value={feeInRs}
                  onChange={(e) => setFeeInRs(e.target.value)}
                  className={`form-input ${errors.feeInRs ? "error" : ""}`}
                />
              </div>
              {errors.feeInRs && <div className="field-error">{errors.feeInRs}</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Min Players Required</span></label>
              <div className="stepper-row">
                <button type="button" className="stepper-btn"
                  onClick={() => { minPlayersEdited.current = true; setMinPlayers((v: string) => String(Math.max(2, Number(v) - 1))); }}
                  disabled={Number(minPlayers) <= 2}
                >−</button>
                <input
                  type="number" min="2" max={slotsFromFormat(format)}
                  value={minPlayers}
                  onChange={(e) => {
                    minPlayersEdited.current = true;
                    const val = Number(e.target.value);
                    const cap = slotsFromFormat(format);
                    if (val < 2) setMinPlayers("2");
                    else if (val > cap) setMinPlayers(String(cap));
                    else setMinPlayers(e.target.value);
                  }}
                  className={`form-input stepper-input ${errors.minMax ? "error" : ""}`}
                />
                <button type="button" className="stepper-btn"
                  onClick={() => { minPlayersEdited.current = true; setMinPlayers((v: string) => String(Math.min(slotsFromFormat(format), Number(v) + 1))); }}
                  disabled={Number(minPlayers) >= slotsFromFormat(format)}
                >+</button>
              </div>
              <div className="field-hint">Min to confirm · max {slotsFromFormat(format)} for {format}</div>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Max Players Allowed</span></label>
              <div className="stepper-row">
                <button type="button" className="stepper-btn"
                  onClick={() => setMaxPlayers((v: string) => String(Math.max(slotsFromFormat(format), Number(v) - 1)))}
                  disabled={Number(maxPlayers) <= slotsFromFormat(format)}
                >−</button>
                <input
                  type="number" min={slotsFromFormat(format)}
                  value={maxPlayers}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const floor = slotsFromFormat(format);
                    if (val < floor) setMaxPlayers(String(floor));
                    else setMaxPlayers(e.target.value);
                  }}
                  className={`form-input stepper-input ${errors.minMax ? "error" : ""}`}
                />
                <button type="button" className="stepper-btn"
                  onClick={() => setMaxPlayers((v: string) => String(Number(v) + 1))}
                >+</button>
              </div>
              {errors.minMax && <div className="field-error">{errors.minMax}</div>}
              <div className="field-hint">Must be ≥ {slotsFromFormat(format)} (format slots)</div>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Format Change</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={allowSizeChange}
              onChange={(e) => setAllowSizeChange(e.target.checked)}
              className="toggle-checkbox"
            />
            <span className="toggle-label">Allow switch to a smaller format if it can&apos;t fill</span>
          </label>

          {allowSizeChange && (
            <>
              <div className="form-row" style={{ marginTop: 10 }}>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. format</span></label>
                  <select className="form-select" value={altFormat} onChange={(e) => setAltFormat(e.target.value as Format)}>
                    {FORMATS.map((f) => <option key={f} value={f}>{f} ({slotsFromFormat(f)})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. turf</span></label>
                  <select className="form-select" value={altTurf || turf} onChange={(e) => setAltTurf(e.target.value)}>
                    {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. min (&lt; main min {minPlayers || "—"})</span></label>
                  <input type="number" min={2} className="form-input" value={altMin} onChange={(e) => setAltMin(e.target.value)} placeholder={String(Math.ceil(slotsFromFormat(altFormat) / 2))} />
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. max</span></label>
                  <input type="number" min={slotsFromFormat(altFormat)} className="form-input" value={altMax} onChange={(e) => setAltMax(e.target.value)} placeholder={String(slotsFromFormat(altFormat))} />
                </div>
                <div className="form-group">
                  <label className="form-label"><span className="label-text">Alt. fee</span></label>
                  <div className="input-with-prefix">
                    <span className="input-prefix">₹</span>
                    <input
                      type="number" min="0" step="1"
                      className="form-input"
                      value={altFee}
                      onChange={(e) => setAltFee(e.target.value)}
                      placeholder={feeInRs ? `< ${feeInRs}` : "0"}
                    />
                  </div>
                  <div className="field-hint">Must be less than the main fee{feeInRs ? ` (₹${feeInRs})` : ""}</div>
                </div>
              </div>
              {errors.alt && <div className="field-error">{errors.alt}</div>}
            </>
          )}
        </div>

        <div className="form-section">
          <h3 className="section-title">Confirmation Check-ins</h3>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Two automatic reviews of turnout — to confirm, switch format, or cancel.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="label-text">First check-in date</span>
                <button type="button" title="What is the first check-in?"
                  onClick={() => setCheckTip(checkTip === "first" ? null : "first")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1, fontSize: 13, opacity: 0.75 }}>ℹ️</button>
              </label>
              <input
                type="date"
                className="form-input"
                value={firstCheckDate}
                min={todayStr}
                max={date || undefined}
                onChange={(e) => { checkTimesEdited.current = true; setFirstCheckDate(e.target.value); }}
              />
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">First check-in time</span></label>
              <select
                className="form-select"
                value={firstCheckTime}
                onChange={(e) => { checkTimesEdited.current = true; setFirstCheckTime(e.target.value); }}
              >
                {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {checkTip === "first" && (
            <div style={{ marginTop: 6, marginBottom: 6, padding: "8px 11px", background: "rgba(233,179,56,0.08)", border: "1px solid rgba(233,179,56,0.22)", borderRadius: 8, fontSize: 12, color: "#e7dcb8", lineHeight: 1.55 }}>
              <b>First check-in — early heads-up.</b> Only <i>suggests</i> (confirm, switch, SOS, or cancel). Nothing is automatic — you decide, or wait for the second check.
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="label-text">Second check-in date</span>
                <button type="button" title="What is the second check-in?"
                  onClick={() => setCheckTip(checkTip === "second" ? null : "second")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1, fontSize: 13, opacity: 0.75 }}>ℹ️</button>
              </label>
              <input
                type="date"
                className="form-input"
                value={secondCheckDate}
                min={firstCheckDate || todayStr}
                max={date || undefined}
                onChange={(e) => { checkTimesEdited.current = true; setSecondCheckDate(e.target.value); }}
              />
            </div>
            <div className="form-group">
              <label className="form-label"><span className="label-text">Second check-in time</span></label>
              <select
                className="form-select"
                value={secondCheckTime}
                onChange={(e) => { checkTimesEdited.current = true; setSecondCheckTime(e.target.value); }}
              >
                {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {checkTip === "second" && (
            <div style={{ marginTop: 6, marginBottom: 6, padding: "8px 11px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.22)", borderRadius: 8, fontSize: 12, color: "#c9efdd", lineHeight: 1.55 }}>
              <b>Second check-in — the deadline.</b> Automation ON: the system acts by itself — enough players → confirm; enough for the alternate → switch &amp; confirm; too few → cancel + refund. Automation OFF: you get a pop-up + WhatsApp and <b>you</b> decide (confirm / switch / cancel / keep waiting).
            </div>
          )}
          <div className="field-hint">
            {date
              ? `Defaults to ${prettyDate(checkInDate(date, time))} (${Number(time.split(":")[0]) < 12 ? "day before — morning game" : "game day"}). Change either date or time — the reminder, pop-up and WhatsApp all follow what you set.`
              : "Pick a game date first; the check-ins default near it and can be moved to any day before kickoff."}
          </div>
          {(checkOrderBad || errors.checks) && (
            <div className="field-error">
              {checkOrderBad ? "Second check-in must be after the first." : errors.checks}
            </div>
          )}

          <label className="toggle-row" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={automationEnabled}
              onChange={(e) => setAutomationEnabled(e.target.checked)}
              className="toggle-checkbox"
            />
            <span className="toggle-label">Automation — auto-confirm / auto-cancel at the 2nd check-in</span>
          </label>
          <div className="field-hint">
            {automationEnabled
              ? "ON: at the 2nd check-in the system acts by itself — enough players → game confirmed automatically; enough for the alternate → switched & confirmed; too few → auto-cancelled and everyone refunded."
              : "OFF: the system never acts on its own. At the 2nd check-in you get a pop-up + WhatsApp with a recommendation — you confirm, switch, cancel, or keep waiting."}
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title">Your Participation</h3>
          <div className="form-group">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={organiserIsPlaying}
                onChange={(e) => {
                  setOrganiserPlaying(e.target.checked);
                  if (!e.target.checked && organiserGuestCount > hardCap) {
                    setOrganiserGuests((prev) => prev.slice(0, hardCap));
                  }
                }}
                className="toggle-checkbox"
              />
              <span className="toggle-label">I want to play in this game</span>
            </label>
            <div className="field-hint">
              Check this if you as the organiser will also be playing — uses 1 slot from the total
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Guests you&apos;re bringing</span>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {organiserGuests.map((g, idx) => {
                const posLabel = ({ GK: "GK", DEF: "DEF", MID: "MID", FWD: "FWD" } as Record<string, string>)[g.position];
                const teamColor = g.teamPreference === "Red Team" ? { bg: "rgba(220,38,38,0.15)", color: "#f87171" } : g.teamPreference === "Blue Team" ? { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" } : null;
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(200,255,62,0.04)", border: "1px solid #2a2a2a", borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ color: "#c8ff3e", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>#{idx + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="text"
                        value={g.name}
                        onChange={(e) => setOrganiserGuests((prev) => prev.map((guest, i) => i === idx ? { ...guest, name: e.target.value } : guest))}
                        placeholder={`Guest ${idx + 1}`}
                        maxLength={40}
                        style={{ background: "transparent", border: "none", borderBottom: "1px solid #333", color: "#ddd", fontSize: 13, outline: "none", width: "100%", padding: "1px 0", fontFamily: "inherit" }}
                        onFocus={(e) => (e.target.style.borderBottomColor = "#c8ff3e")}
                        onBlur={(e) => (e.target.style.borderBottomColor = "#333")}
                      />
                      {(posLabel || teamColor) && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          {posLabel && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(200,255,62,0.12)", color: "#c8ff3e", fontWeight: 600 }}>{posLabel}</span>}
                          {teamColor && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 600, background: teamColor.bg, color: teamColor.color }}>{g.teamPreference}</span>}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => setOrganiserGuests((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", color: "#f87171", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {organiserGuestCount < maxGuests && (
                <button type="button"
                  onClick={() => { setGuestPrefName(""); setGuestPrefPosition("Any"); setGuestPrefTeam("No Preference"); setGuestPrefOpen(true); }}
                  style={{ width: "100%", padding: "9px 0", background: "rgba(200,255,62,0.06)", border: "1px dashed rgba(200,255,62,0.3)", borderRadius: 8, color: "#c8ff3e", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  + Add Guest
                </button>
              )}
            </div>
            <div className="field-hint">Each guest uses 1 slot from the total capacity</div>
          </div>

          <div style={{
            background: openSlots === 0 ? "rgba(220,38,38,0.08)" : "rgba(200,255,62,0.06)",
            border: `1px solid ${openSlots === 0 ? "rgba(220,38,38,0.3)" : "rgba(200,255,62,0.2)"}`,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "#ccc",
            display: "flex",
            flexDirection: "column" as const,
            gap: 4,
          }}>
            <div style={{ fontWeight: 600, color: openSlots === 0 ? "#f87171" : "#c8ff3e" }}>
              {openSlots === 0
                ? "⚠️ No open slots — all capacity is reserved"
                : `✓ ${openSlots} open slot${openSlots !== 1 ? "s" : ""} for players to book slots`}
            </div>
            <div style={{ color: "#888", fontSize: 12 }}>
              Total cap: {hardCap}
              {organiserSlot > 0 && ` · You: 1`}
              {organiserGuestCount > 0 && ` · Your guests: ${organiserGuestCount}`}
              {` · Open: ${openSlots}`}
            </div>
          </div>
        </div>

        <div className="form-actions">
          {onClose && (
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary " disabled={loading}>
            {loading ? <><span className="btn-spinner">⏳</span> Creating…</> : <><span className="btn-icon">✓</span> Create Event</>}
          </button>
        </div>
      </form>

      {guestPrefOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setGuestPrefOpen(false)}>
          <div style={{ background: "#0f0f1e", border: "1px solid #333", borderRadius: 12, padding: "24px 20px", width: "100%", maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: "#c8ff3e", margin: "0 0 4px", fontSize: 17 }}>Add Guest</h3>
            <p style={{ color: "#666", fontSize: 12, margin: "0 0 20px" }}>Set guest name, position and team preference.</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
                Guest Name <span style={{ color: "#555", textTransform: "none" as const }}>(optional)</span>
              </label>
              <input type="text" value={guestPrefName} onChange={(e) => setGuestPrefName(e.target.value)}
                placeholder="e.g. Rahul" maxLength={40}
                style={{ width: "100%", background: "#1a1a2e", border: "1px solid #444", borderRadius: 7, padding: "9px 12px", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" as const }}
                onFocus={(e) => (e.target.style.borderColor = "#c8ff3e")}
                onBlur={(e) => (e.target.style.borderColor = "#444")} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Position</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                {["Any","GK","DEF","MID","FWD"].map((pos) => (
                  <button key={pos} type="button" onClick={() => setGuestPrefPosition(pos)} style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: guestPrefPosition===pos ? "rgba(200,255,62,0.18)" : "rgba(255,255,255,0.04)",
                    color: guestPrefPosition===pos ? "#c8ff3e" : "#888",
                    border: `1px solid ${guestPrefPosition===pos ? "rgba(200,255,62,0.5)" : "rgba(255,255,255,0.08)"}`,
                  }}>{pos}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Team</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                {["No Preference","Red Team","Blue Team"].map((t) => (
                  <button key={t} type="button" onClick={() => setGuestPrefTeam(t)} style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: guestPrefTeam===t ? (t==="Red Team"?"rgba(220,38,38,0.18)":t==="Blue Team"?"rgba(59,130,246,0.18)":"rgba(255,255,255,0.08)") : "rgba(255,255,255,0.04)",
                    color: guestPrefTeam===t ? (t==="Red Team"?"#f87171":t==="Blue Team"?"#60a5fa":"#c8ff3e") : "#888",
                    border: `1px solid ${guestPrefTeam===t ? (t==="Red Team"?"rgba(220,38,38,0.4)":t==="Blue Team"?"rgba(59,130,246,0.4)":"rgba(200,255,62,0.4)") : "rgba(255,255,255,0.08)"}`,
                  }}>{t==="No Preference"?"No Pref":t}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setGuestPrefOpen(false)}
                style={{ flex: 1, padding: "10px", borderRadius: 7, background: "transparent", border: "1px solid #444", color: "#888", fontSize: 14, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => {
                setOrganiserGuests((prev) => [...prev, { name: guestPrefName.trim(), position: guestPrefPosition, teamPreference: guestPrefTeam }]);
                setGuestPrefOpen(false);
              }} style={{ flex: 2, padding: "10px", borderRadius: 7, background: "#c8ff3e", color: "#000", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer" }}>
                Add Guest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
