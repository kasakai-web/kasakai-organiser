"use client";

import { useState, useEffect, useRef } from "react";
import "./CreateEventForm.css";
import { buildApiUrl, getSession } from "@/utils/api";
import { checkInDate, defaultCheckTimes, checkInIsoFromParts } from "@/utils/checkins";
import { saveTemplate, listTemplates, prettyTime, type Template } from "@/utils/templates";

const TIME_SLOT_OPTIONS = Array.from({ length: 96 }, (_, idx) => {
  const hours = Math.floor(idx / 4);
  const minutes = String((idx % 4) * 15).padStart(2, "0");
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const period = hours < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${minutes} ${period}` };
});

const FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10", "11v11","Screening"] as const;
type Format = typeof FORMATS[number];

const slotsFromFormat = (fmt: string) => {
  if (fmt === "Screening") return 0; // Screening format has no fixed slots
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

const templateTurfId = (t?: Template["turf"]): string =>
  !t ? "" : typeof t === "string" ? t : t._id || "";

export interface CreateEventFormProps {
  lastEvent?: any;
  presetDate?: string; // YYYY-MM-DD to seed the date field (used by "Customize from template")
  onClose?: () => void;
  onCreate?: (eventData: any) => void;
  onSuccess?: () => void;
}

export function CreateEventForm({ lastEvent, presetDate, onClose, onCreate, onSuccess }: CreateEventFormProps) {
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [title, setTitle] = useState(lastEvent?.title ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(lastEvent?.visibility === "private" ? "private" : "public");
  const [requiresApproval, setRequiresApproval] = useState<boolean>(lastEvent?.requiresApproval === true);
  const [turf, setTurf] = useState(lastEvent?.turf?._id || (typeof lastEvent?.turf === "string" ? lastEvent.turf : ""));
  const [date, setDate] = useState(presetDate ?? "");
  const initialTime = lastEvent ? (() => { const hm = new Date(lastEvent.scheduledAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }); const [hh, mm] = hm.split(":"); return `${hh}:${Number(mm) >= 30 ? "30" : "00"}`; })() : "18:00";
  const [time, setTime] = useState(initialTime);
  const initialFormat = (lastEvent?.format as Format) ?? "5v5";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [durationMins, setDuration] = useState(lastEvent?.durationMins ?? 60);
  const [feeInRs, setFeeInRs] = useState(lastEvent?.feeInPaise ? String(lastEvent.feeInPaise / 100) : "");
  const [backoutFeeInRs, setBackoutFeeInRs] = useState(lastEvent?.backoutFeeInPaise ? String(lastEvent.backoutFeeInPaise / 100) : "");
  const [cutoffHours, setCutoffHours] = useState<number>(lastEvent?.cutoffHoursBeforeGame ?? 2);
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

  // "Start from a template" picker — the organiser's saved templates, in the same
  // search-and-pick shape as the invite player typeahead.
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pickedTemplateId, setPickedTemplateId] = useState("");
  const [tmplPickerOpen, setTmplPickerOpen] = useState(false);
  const [tmplQuery, setTmplQuery] = useState("");
  const tmplPickerRef = useRef<HTMLDivElement>(null);

  // "Save as template" mini-modal
  const [tmplModalOpen, setTmplModalOpen] = useState(false);
  const [tmplName, setTmplName] = useState(lastEvent?.title ?? "");
  const [tmplSaving, setTmplSaving] = useState(false);
  const [tmplMsg, setTmplMsg] = useState<string | null>(null);

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

  const pickedTemplate = templates.find((t) => t._id === pickedTemplateId) || null;
  const tmplTurfName = (t: Template) => (typeof t.turf === "object" ? t.turf?.name : "") || "";
  // One-line summary of what a template will fill in.
  const templateMeta = (t: Template) =>
    [
      tmplTurfName(t),
      t.format,
      prettyTime(t.defaultTimeOfDay),
      t.feeInPaise ? `₹${(t.feeInPaise / 100).toLocaleString("en-IN")}` : "",
    ].filter(Boolean).join(" · ");
  const tmplMatches = tmplQuery.trim()
    ? templates.filter((t) =>
        `${t.name} ${t.title || ""} ${tmplTurfName(t)} ${t.format || ""}`
          .toLowerCase()
          .includes(tmplQuery.trim().toLowerCase())
      )
    : templates;


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
    if (!tmplPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (tmplPickerRef.current && !tmplPickerRef.current.contains(e.target as Node)) setTmplPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [tmplPickerOpen]);

  useEffect(() => {
    // Saved templates for the "Start from a template" picker. A failure here is
    // never fatal — the picker just stays hidden and the form works as before.
    listTemplates()
      .then((list) => {
        // Most-used first, so the regular fixture sits at the top.
        setTemplates([...list].sort((a, b) => (b.usage?.useCount || 0) - (a.usage?.useCount || 0)));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const slots = slotsFromFormat(format);
    if (format === "Screening") {
      // For Screening, preserve user's input or use defaults
      if (!minPlayersEdited.current && !minPlayers) setMinPlayers("2");
      if (!maxPlayers) setMaxPlayers("20");
    } else {
      // For regular formats, constrain to format slots
      setMaxPlayers((prev) => (Number(prev) >= slots ? prev : String(slots)));
      if (!minPlayersEdited.current) {
        setMinPlayers(String(Math.ceil(slots / 2)));
      } else {
        setMinPlayers((prev) => String(Math.min(Number(prev), slots)));
      }
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

  // Pour a saved template into the form. Everything stays editable afterwards and
  // the template itself is untouched — this is a prefill, not a link.
  const applyTemplate = (templateId: string) => {
    setPickedTemplateId(templateId);

    // "Start blank" — leave whatever has already been typed in alone.
    const t = templates.find((x) => x._id === templateId);
    if (!t) return;

    const turfId = templateTurfId(t.turf);
    const turfRef = typeof t.turf === "object" ? t.turf : null;
    // A template can point at a turf the list call didn't return — keep it
    // selectable so the venue doesn't silently fall back to blank.
    if (turfId && turfRef) {
      setTurfs((prev) =>
        prev.some((x) => x._id === turfId)
          ? prev
          : [...prev, { _id: turfId, name: turfRef.name || "Saved venue", location: { city: turfRef.location?.city } }]
      );
    }

    setTitle(t.title || t.name);
    setVisibility(t.visibility === "private" ? "private" : "public");
    setRequiresApproval(!!t.requiresApproval);
    if (turfId) setTurf(turfId);
    if (t.format) setFormat(t.format);
    if (t.defaultTimeOfDay) setTime(t.defaultTimeOfDay);
    setDuration(t.durationMins ?? 60);
    setReporting(t.reportingMinsBeforeGame ?? 30);
    setCutoffHours(t.cutoffHoursBeforeGame ?? 2);
    setFeeInRs(t.feeInPaise ? String(t.feeInPaise / 100) : "");
    setBackoutFeeInRs(t.backoutFeeInPaise ? String(t.backoutFeeInPaise / 100) : "");
    setOrganiserPlaying(!!t.organiserIsPlaying);
    setAutomationEnabled(!!t.automationEnabled);

    // The format effect re-runs on a format change and clamps these — flagging min
    // as edited keeps the template's number instead of the half-of-slots default.
    const slots = slotsFromFormat(t.format || format);
    if (t.minPlayers) {
      minPlayersEdited.current = true;
      setMinPlayers(String(t.minPlayers));
    } else {
      minPlayersEdited.current = false;
      setMinPlayers(String(Math.ceil(slots / 2)));
    }
    setMaxPlayers(String(t.totalSlots || slots));

    setAllowSizeChange(!!t.allowSizeChange);
    const alt = t.alternateFormats?.[0];
    if (t.allowSizeChange && alt) {
      // Real alternate values — stop the defaults effect from overwriting them.
      altDefaultsSet.current = true;
      if (alt.format) setAltFormat(alt.format);
      setAltTurf(templateTurfId(alt.turf) || turfId);
      setAltMin(alt.minPlayers ? String(alt.minPlayers) : "");
      setAltMax(alt.maxPlayers ? String(alt.maxPlayers) : "");
      setAltFee(alt.feeInPaise ? String(alt.feeInPaise / 100) : "");
    } else {
      // Let the effect derive sensible alternate defaults from the new format.
      altDefaultsSet.current = false;
    }

    // Check-in times are deliberately left to the form: they're derived from the
    // kickoff time (same as the Customize-from-template path), and their DATES
    // only resolve once a date is picked.
    setErrors({});
  };

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
    else if (format !== "Screening" && Number(minPlayers) > formatSlots)
      newErrors.minMax = `Min players cannot exceed ${formatSlots} (total slots for ${format})`;
    else if (format !== "Screening" && Number(maxPlayers) < formatSlots)
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
      const cutoffAt = new Date(scheduledAt.getTime() - Number(cutoffHours) * 60 * 60 * 1000);
      const slots = Number(maxPlayers) || slotsFromFormat(format);
      const payload: any = {
        title: title.trim(),
        sport: "football",
        visibility,
        requiresApproval,
        format,
        turf,
        scheduledAt: scheduledAt.toISOString(),
        durationMins: Number(durationMins),
        cutoffAt: cutoffAt.toISOString(),
        feeInRs: Number(feeInRs),
        backoutFeeInPaise: backoutFeeInRs === "" ? 0 : Math.round(Number(backoutFeeInRs) * 100),
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

  const handleSaveTemplate = async () => {
    if (!tmplName.trim()) { setTmplMsg("Please enter a template name."); return; }
    if (!turf) { setTmplMsg("Pick a turf before saving a template."); return; }
    setTmplSaving(true);
    setTmplMsg(null);
    try {
      await saveTemplate({
        name: tmplName.trim(),
        title: title.trim() || null,
        visibility,
        requiresApproval,
        turf,
        format,
        defaultTimeOfDay: time,
        durationMins: Number(durationMins),
        reportingMinsBeforeGame: Number(reportingMins),
        cutoffHoursBeforeGame: Number(cutoffHours),
        feeInRs: feeInRs === "" ? 0 : Number(feeInRs),
        backoutFeeInRs: backoutFeeInRs === "" ? 0 : Number(backoutFeeInRs),
        minPlayers: Number(minPlayers) || 0,
        totalSlots: Number(maxPlayers) || slotsFromFormat(format),
        allowSizeChange,
        organiserIsPlaying,
        automationEnabled,
        firstCheckTime,
        secondCheckTime,
        alternateFormats: allowSizeChange ? [{
          format: altFormat, turf: altTurf || turf,
          minPlayers: Number(altMin), maxPlayers: Number(altMax), feeInRs: Number(altFee),
        }] : [],
      });
      setTmplMsg("✅ Template saved!");
      setTimeout(() => { setTmplModalOpen(false); setTmplMsg(null); }, 1200);
    } catch (err: any) {
      setTmplMsg(err?.message || "Couldn't save template.");
    } finally {
      setTmplSaving(false);
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

        {templates.length > 0 && (
          <div
            className="form-section"
            style={{
              background: "rgba(200,255,62,0.06)",
              border: "1px solid rgba(200,255,62,0.25)",
              borderRadius: 12,
              padding: 16,
              gap: 0, // spacing is handled per-element below, not by the section gap
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#c8ff3e", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              Start from a template
            </div>

            {/* Template typeahead — same shape as the invite player search */}
            <div ref={tmplPickerRef} style={{ position: "relative" }}>
              <input
                value={tmplQuery}
                onChange={(e) => { setTmplQuery(e.target.value); setTmplPickerOpen(true); }}
                onFocus={() => setTmplPickerOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setTmplPickerOpen(false); return; }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (tmplMatches[0]) { applyTemplate(tmplMatches[0]._id); setTmplPickerOpen(false); setTmplQuery(""); }
                  }
                }}
                placeholder="🔍 Search your templates by name, venue or format…"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 13, boxSizing: "border-box" }}
              />
              {tmplPickerOpen && (
                <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 4px)", left: 0, right: 0, background: "#161616", border: "1px solid #2a2a2a", borderRadius: 10, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                  {tmplMatches.length === 0 ? (
                    <div style={{ padding: "10px 12px", fontSize: 12, color: "#888" }}>No templates match “{tmplQuery.trim()}”</div>
                  ) : tmplMatches.map((t) => {
                    const picked = t._id === pickedTemplateId;
                    return (
                      <button
                        key={t._id}
                        type="button"
                        onClick={() => { applyTemplate(t._id); setTmplPickerOpen(false); setTmplQuery(""); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "transparent", border: "none", borderBottom: "1px solid #202020", color: "#eee", cursor: "pointer", textAlign: "left" }}
                      >
                        <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#242424", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#c8ff3e" }}>
                          {(t.name?.[0] || "T").toUpperCase()}
                        </span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                          <span style={{ display: "block", fontSize: 11, color: "#777", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {templateMeta(t) || "No details saved"}
                          </span>
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 12, color: "#c8ff3e", fontWeight: 700 }}>{picked ? "✓ Used" : "Use"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {pickedTemplate && (
              <span style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#c8ff3e", background: "rgba(200,255,62,0.08)", border: "1px solid rgba(200,255,62,0.3)", borderRadius: 20, padding: "4px 6px 4px 11px", marginTop: 10 }}>
                Filled from {pickedTemplate.name}
                <button
                  type="button"
                  title="Clear the template tag — your entries below are kept"
                  onClick={() => setPickedTemplateId("")}
                  style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
                >✕</button>
              </span>
            )}

            <div className="field-hint" style={{ marginTop: 8 }}>
              {pickedTemplate
                ? "Everything below is filled in — pick a date and change whatever you like. Your template stays as it is."
                : "Reuse a saved setup instead of filling everything in by hand."}
            </div>
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
                After creating, open this game from your dashboard to invite players and copy the shareable invite link.
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Registration approval</span>
            </label>
            <button
              type="button"
              onClick={() => setRequiresApproval((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 10,
                border: requiresApproval ? "1.5px solid #c8ff3e" : "1.5px solid #2a2a2a",
                background: requiresApproval ? "rgba(200,255,62,0.12)" : "#141414",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>
                <span style={{ display: "block", fontWeight: 700, fontSize: 14, color: requiresApproval ? "#c8ff3e" : "#ddd" }}>
                  {requiresApproval ? "✅ Approval required" : "⚡ Instant join"}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "#888", marginTop: 3 }}>
                  {requiresApproval
                    ? "Players send a join request — you approve or reject. Players you invite directly still skip approval."
                    : "Players join instantly (subject to available slots)."}
                </span>
              </span>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 42,
                  height: 24,
                  borderRadius: 999,
                  background: requiresApproval ? "#c8ff3e" : "#333",
                  position: "relative",
                  transition: "background .15s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: requiresApproval ? 21 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "#0a0a0a",
                    transition: "left .15s",
                  }}
                />
              </span>
            </button>
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
                  <option key={f} value={f}>{f === "Screening" ? "Screening" : `${f} (${slotsFromFormat(f)} Players)`}</option>
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
                  type="number" min="2" max={format === "Screening" ? undefined : slotsFromFormat(format)}
                  value={minPlayers}
                  onChange={(e) => {
                    minPlayersEdited.current = true;
                    const val = Number(e.target.value);
                    if (val < 2) setMinPlayers("2");
                    else if (format !== "Screening") {
                      const cap = slotsFromFormat(format);
                      if (val > cap) setMinPlayers(String(cap));
                      else setMinPlayers(e.target.value);
                    } else {
                      setMinPlayers(e.target.value);
                    }
                  }}
                  className={`form-input stepper-input ${errors.minMax ? "error" : ""}`}
                />
                <button type="button" className="stepper-btn"
                  onClick={() => { minPlayersEdited.current = true; setMinPlayers((v: string) => format === "Screening" ? String(Number(v) + 1) : String(Math.min(slotsFromFormat(format), Number(v) + 1))); }}
                  disabled={format !== "Screening" && Number(minPlayers) >= slotsFromFormat(format)}
                >+</button>
              </div>
              <div className="field-hint">{format === "Screening" ? "Min players to confirm" : `Min to confirm · max ${slotsFromFormat(format)} for ${format}`}</div>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Max Players Allowed</span></label>
              <div className="stepper-row">
                <button type="button" className="stepper-btn"
                  onClick={() => setMaxPlayers((v: string) => String(Math.max(format === "Screening" ? 2 : slotsFromFormat(format), Number(v) - 1)))}
                  disabled={format !== "Screening" && Number(maxPlayers) <= slotsFromFormat(format)}
                >−</button>
                <input
                  type="number" min={format === "Screening" ? 2 : slotsFromFormat(format)}
                  value={maxPlayers}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (format === "Screening") {
                      if (val < 2) setMaxPlayers("2");
                      else setMaxPlayers(e.target.value);
                    } else {
                      const floor = slotsFromFormat(format);
                      if (val < floor) setMaxPlayers(String(floor));
                      else setMaxPlayers(e.target.value);
                    }
                  }}
                  className={`form-input stepper-input ${errors.minMax ? "error" : ""}`}
                />
                <button type="button" className="stepper-btn"
                  onClick={() => setMaxPlayers((v: string) => String(Number(v) + 1))}
                >+</button>
              </div>
              {errors.minMax && <div className="field-error">{errors.minMax}</div>}
              <div className="field-hint">{format === "Screening" ? "Max players allowed" : `Must be ≥ ${slotsFromFormat(format)} (format slots)`}</div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><span className="label-text">Backout Fee</span></label>
              <div className="input-with-prefix">
                <span className="input-prefix">₹</span>
                <input
                  type="number" min="0" step="1" placeholder="0"
                  value={backoutFeeInRs}
                  onChange={(e) => setBackoutFeeInRs(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="field-hint">Charged if a player backs out after the cutoff. Leave 0 for none.</div>
            </div>

            <div className="form-group">
              <label className="form-label"><span className="label-text">Registration Cutoff</span></label>
              <div className="stepper-row">
                <button type="button" className="stepper-btn"
                  onClick={() => setCutoffHours((v) => Math.max(0, v - 1))}
                  disabled={cutoffHours <= 0}
                >−</button>
                <input
                  type="number" min="0" step="1"
                  value={cutoffHours}
                  onChange={(e) => setCutoffHours(Math.max(0, Number(e.target.value) || 0))}
                  className="form-input stepper-input"
                />
                <span className="stepper-unit">hrs</span>
                <button type="button" className="stepper-btn" onClick={() => setCutoffHours((v) => v + 1)}>+</button>
              </div>
              <div className="field-hint">Registration closes this many hours before kick-off.</div>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setTmplName(title.trim()); setTmplMsg(null); setTmplModalOpen(true); }}
            disabled={loading}
            title="Save these settings as a reusable template"
          >
            💾 Save as template
          </button>
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

      {tmplModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !tmplSaving && setTmplModalOpen(false)}>
          <div style={{ background: "#0f0f1e", border: "1px solid #333", borderRadius: 12, padding: "24px 20px", width: "100%", maxWidth: 380 }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: "#c8ff3e", margin: "0 0 4px", fontSize: 17 }}>Save as template</h3>
            <p style={{ color: "#666", fontSize: 12, margin: "0 0 18px" }}>
              Reuse these settings later — spin up a game in one tap from the Templates page.
            </p>

            <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Template name
            </label>
            <input type="text" value={tmplName} onChange={(e) => setTmplName(e.target.value)} autoFocus
              placeholder="e.g. Friday Night 6v6" maxLength={60}
              style={{ width: "100%", background: "#1a1a2e", border: "1px solid #444", borderRadius: 7, padding: "9px 12px", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveTemplate(); }} />

            {tmplMsg && (
              <div style={{ marginTop: 12, fontSize: 13, color: tmplMsg.startsWith("✅") ? "#7bd88f" : "#f87171" }}>
                {tmplMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setTmplModalOpen(false)} disabled={tmplSaving}
                style={{ flex: 1, padding: "10px", borderRadius: 7, background: "transparent", border: "1px solid #444", color: "#888", fontSize: 14, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveTemplate} disabled={tmplSaving}
                style={{ flex: 2, padding: "10px", borderRadius: 7, background: "#c8ff3e", color: "#000", fontSize: 14, fontWeight: 700, border: "none", cursor: tmplSaving ? "not-allowed" : "pointer", opacity: tmplSaving ? 0.7 : 1 }}>
                {tmplSaving ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
