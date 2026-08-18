"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { Calendar, Minus, Plus, Check, ChevronDown, Info, Save } from "lucide-react";
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
  if (fmt === "Screening") return 0;
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

const TABS = ["Event Details", "Configuration", "Check-in & Guests"] as const;
type Tab = typeof TABS[number];

// Which tab owns each validation error, so a failed submit can surface the tab
// that actually holds the offending field instead of a silent no-op.
const TAB_FOR_ERROR: Record<string, Tab> = {
  title: "Event Details",
  turf: "Event Details",
  date: "Event Details",
  feeInRs: "Configuration",
  minMax: "Configuration",
  alt: "Configuration",
  checks: "Check-in & Guests",
};

const inputBase =
  "bg-[#1a1a1a] border rounded-xl p-3 text-white w-full text-sm font-bold focus:outline-none transition-colors placeholder:text-[#444] placeholder:font-medium";
const inputCls = (invalid?: boolean) =>
  `${inputBase} ${invalid ? "border-[#ff5a5f] focus:border-[#ff5a5f]" : "border-[#2a2a2a] focus:border-[#444]"}`;
const selectCls = (invalid?: boolean) =>
  `${inputCls(invalid)} appearance-none pr-10 cursor-pointer [&>option]:bg-[#111] [&>option]:text-white`;
const dateCls = (invalid?: boolean) =>
  `${inputCls(invalid)} relative pr-12 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`;
const noSpinner =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const Label = ({ text, required }: { text: ReactNode; required?: boolean }) => (
  <label className="text-[10px] md:text-sm font-bold text-white uppercase tracking-widest mb-2.5 block">
    {text} {required && <span className="text-[#ff5a5f] ml-1">*</span>}
  </label>
);

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="bg-[#111] border border-[#222] rounded-3xl p-4 md:p-8 mb-8 shadow-sm">
    {children}
  </div>
);

const TabNavigation = ({tabs,activeTab,onChange,errorTabs,}: {tabs: readonly string[];activeTab: string;onChange: (tab: string) => void;errorTabs: Set<string>;}) => (
  <div className="bg-[#1a1a1a] p-1.5 rounded-2xl flex flex-col md:flex-row gap-1 mb-8 border border-[#2a2a2a]">
    {tabs.map((tab: string) => (
      <button
        key={tab}
        type="button"
        className={`flex-1 text-center py-3.5 px-4 text-[11px] md:text-xs font-black tracking-widest uppercase rounded-xl transition-all ${
          activeTab === tab
            ? "bg-[#c4f042] text-[#0f0f0f] shadow-md"
            : "text-[#888] hover:text-white"
        }`}
        onClick={() => onChange(tab)}
      >
        {tab}
        {errorTabs.has(tab) && (
          <span className={`ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle ${activeTab === tab ? "bg-[#0f0f0f]" : "bg-[#ff5a5f]"}`} />
        )}
      </button>
    ))}
  </div>
);

const SubSectionHeader = ({ title, first }: { title: string; first?: boolean }) => (
  <div className={`mb-5 ${first ? "" : "mt-10"}`}>
    <h3 className="text-[11px] md:text-xs font-bold text-[#888] uppercase tracking-[0.2em]">{title}</h3>
  </div>
);

const CheckboxRow = ({
label,
helper,
checked,
onChange,
}: {
  label: ReactNode;
  helper?: ReactNode;
  checked: boolean;
  onChange: () => void;
}) => (
  <div className="flex flex-col gap-2.5">
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className="flex items-center gap-4 cursor-pointer text-left"
    >
      <span
        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center border transition-colors ${
          checked ? "bg-[#c4f042] border-[#c4f042]" : "bg-[#1a1a1a] border-[#333]"
        }`}
      >
        {checked && <Check size={16} className="text-[#0f0f0f] stroke-4" />}
      </span>
      <span className="text-sm md:text-base text-white">{label}</span>
    </button>
    {helper && <p className="text-xs text-[#666] leading-relaxed">{helper}</p>}
  </div>
);

const Counter = ({
  value,
  onInput,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
  unit,
  invalid,
  placeholder,
  min,
  max,
  step,
}: {
  value: string | number;
  onInput: (raw: string) => void;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
  unit?: string;
  invalid?: boolean;
  placeholder?: string;
  min?: number | string;
  max?: number | string;
  step?: number;
}) => (
  <div
    className={`flex items-center justify-between bg-[#1a1a1a] border rounded-xl h-11 px-2 w-full transition-colors ${
      invalid ? "border-[#ff5a5f]" : "border-[#2a2a2a] focus-within:border-[#444]"
    }`}
  >
    <button
      type="button"
      onClick={onDec}
      disabled={decDisabled}
      aria-label="Decrease"
      className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-white disabled:opacity-30 disabled:hover:text-[#666] transition-colors shrink-0"
    >
      <Minus size={20} strokeWidth={2.5} />
    </button>
    <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 text-white font-bold text-sm">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onInput(e.target.value)}
        className={`w-full min-w-0 bg-transparent text-center text-white font-bold text-sm outline-none placeholder:text-[#444] ${noSpinner}`}
      />
      {unit && <span className="text-[#888] font-normal shrink-0">{unit}</span>}
    </div>
    <button
      type="button"
      onClick={onInc}
      disabled={incDisabled}
      aria-label="Increase"
      className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-white disabled:opacity-30 disabled:hover:text-[#666] transition-colors shrink-0"
    >
      <Plus size={20} strokeWidth={2.5} />
    </button>
  </div>
);

const bumpRs = (v: string, delta: number) => String(Math.max(0, (Number(v) || 0) + delta));

const MoneyField = ({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) => (
  <div className="relative flex items-center">
    <span className="absolute left-0 pl-5 h-full flex items-center text-[#888] font-bold border-r border-[#2a2a2a] pr-4 pointer-events-none">₹</span>
    <input
      type="number"
      min="0"
      step="1"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls(invalid)} pl-18 pr-10 ${noSpinner}`}
    />
    <span className="absolute right-3 flex flex-col items-center justify-center text-[#888]">
      <button type="button" tabIndex={-1} aria-label="Increase" onClick={() => onChange(bumpRs(value, 1))} className="hover:text-white transition-colors">
        <ChevronDown size={14} className="rotate-180 -mb-1" />
      </button>
      <button type="button" tabIndex={-1} aria-label="Decrease" onClick={() => onChange(bumpRs(value, -1))} className="hover:text-white transition-colors">
        <ChevronDown size={14} className="-mt-1" />
      </button>
    </span>
  </div>
);

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="text-[#666] text-xs font-medium mt-3 ml-1 leading-relaxed">{children}</p>
);

const FieldError = ({ children }: { children: ReactNode }) => (
  <p className="text-[#ff5a5f] text-xs font-bold mt-2.5 ml-1 leading-relaxed">{children}</p>
);

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

  const [activeTab, setActiveTab] = useState<Tab>("Event Details");

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

  const errorTabs = new Set<string>();
  Object.keys(errors).forEach((k) => { const t = TAB_FOR_ERROR[k]; if (t) errorTabs.add(t); });
  if (checkOrderBad) errorTabs.add("Check-in & Guests");

  const goToTab = (tab: Tab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };


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
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-tmpl-picker]")) setTmplPickerOpen(false);
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
    if (!title.trim()) newErrors.title = "Event name is required";
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
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // First Error  Tab jump to that
      const firstBadTab = TABS.find((t) => Object.keys(newErrors).some((k) => TAB_FOR_ERROR[k] === t));
      if (firstBadTab) goToTab(firstBadTab);
      return;
    }

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

  const templatePicker = templates.length === 0 ? null : (
    <div data-tmpl-picker className="relative flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setTmplPickerOpen((v) => !v)}
        className="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] text-white text-[10px] md:text-xs font-bold uppercase tracking-widest px-4 py-3 rounded-xl hover:bg-[#222] transition-colors shadow-sm"
      >
        Saved Templates <ChevronDown size={14} className={`transition-transform ${tmplPickerOpen ? "rotate-180" : ""}`} />
      </button>
      <p className="text-[#666] text-[10px] font-bold uppercase tracking-wide">
        {pickedTemplate
          ? `Filled from ${pickedTemplate.name}`
          : lastEvent
            ? "Pre-filled from last event"
            : "Reuse a saved setup"}
      </p>

      {tmplPickerOpen && (
        <div className="absolute z-30 top-full left-0 sm:left-auto sm:right-0 mt-2 w-[320px] max-w-[80vw] bg-[#111] border border-[#2a2a2a] rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] font-black text-[#c4f042] uppercase tracking-widest mb-2.5">
            Start from a template
          </div>
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
            placeholder="🔍 Search by name, venue or format…"
            className="bg-[#1a1a1a] border border-[#2a2a2a] focus:border-[#444] rounded-xl px-3.5 py-3 text-white w-full text-xs font-bold outline-none transition-colors placeholder:text-[#555] placeholder:font-medium"
          />

          <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-[#222]">
            {tmplMatches.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-[#888]">No templates match “{tmplQuery.trim()}”</div>
            ) : tmplMatches.map((t) => {
              const picked = t._id === pickedTemplateId;
              return (
                <button
                  key={t._id}
                  type="button"
                  onClick={() => { applyTemplate(t._id); setTmplPickerOpen(false); setTmplQuery(""); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-[#202020] last:border-b-0 text-left hover:bg-[#1a1a1a] transition-colors"
                >
                  <span className="shrink-0 w-7 h-7 rounded-full bg-[#242424] flex items-center justify-center text-[11px] font-black text-[#c4f042]">
                    {(t.name?.[0] || "T").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-[#eee] truncate">{t.name}</span>
                    <span className="block text-[11px] text-[#777] truncate">{templateMeta(t) || "No details saved"}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-black text-[#c4f042]">{picked ? "✓ Used" : "Use"}</span>
                </button>
              );
            })}
          </div>

          {pickedTemplate && (
            <span className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-bold text-[#c4f042] bg-[#1a2e05] border border-[#c4f042]/30 rounded-full pl-3 pr-1.5 py-1">
              Filled from {pickedTemplate.name}
              <button
                type="button"
                title="Clear the template tag — your entries below are kept"
                onClick={() => setPickedTemplateId("")}
                className="text-[#888] hover:text-white transition-colors leading-none text-sm"
              >✕</button>
            </span>
          )}

          <p className="text-[#666] text-[11px] font-medium mt-3 leading-relaxed">
            {pickedTemplate
              ? "Everything below is filled in — pick a date and change whatever you like. Your template stays as it is."
              : "Reuse a saved setup instead of filling everything in by hand."}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full bg-[#0d0d0d] text-white p-4 pb-12">
      <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
        <div className="mx-auto">
          <header className="mb-3 flex justify-between items-start  gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">⚽</span>
                <span className="text-xs font-black text-[#ff5a5f] uppercase tracking-widest">Create Event</span>
              </div>
              <h1 className="text-lg md:text-[32px] font-black text-white tracking-tight leading-[1.05] mb-1">Organise a New Game</h1>
              <p className="text-[#666] text-xs font-medium mt-3 leading-relaxed">
                {lastEvent ? "Pre-filled from your last event — update the date." : "Fill in the details to create and notify players."}
              </p>
            </div>
            <div className="flex flex-col items-end gap-5 shrink-0">
              {templatePicker && <div className="hidden sm:flex flex-col items-end mt-2">{templatePicker}</div>}
            </div>
          </header>

          {templatePicker && <div className="flex flex-col items-start mb-8 sm:hidden">{templatePicker}</div>}

          {errors.submit && (
            <div className="bg-[#2a1517] border border-[#ff5a5f]/40 rounded-2xl p-4 mb-8 flex items-start gap-3">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <p className="text-[#ffb3b5] text-sm leading-relaxed">{errors.submit}</p>
            </div>
          )}

          <TabNavigation tabs={TABS} activeTab={activeTab} onChange={(t) => goToTab(t as Tab)} errorTabs={errorTabs} />

          {activeTab === "Event Details" && (
          <Panel>
            <SubSectionHeader title="Visibility" first />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["public", "private"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`border rounded-xl p-3 cursor-pointer transition-colors text-left ${
                    visibility === v ? "border-[#c4f042] bg-[#1a2e05]" : "border-[#333] bg-[#111] hover:border-[#555]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{v === "public" ? "🌍" : "🔒"}</span>
                    <span className={`font-black text-sm capitalize ${visibility === v ? "text-[#c4f042]" : "text-white"}`}>{v}</span>
                  </div>
                  <p className="text-[#888] text-xs leading-relaxed">
                    {v === "public" ? "Listed for everyone to browse & join." : "Hidden — invite players by WhatsApp."}
                  </p>
                </button>
              ))}
            </div>
            {visibility === "private" && (
              <p className="text-[#c4f042] text-xs font-medium mt-3 ml-1 leading-relaxed">
                After creating, open this game from your dashboard to invite players and copy the shareable invite link.
              </p>
            )}
            <SubSectionHeader title="Registration Approval" />
            <button
              type="button"
              onClick={() => setRequiresApproval((v) => !v)}
              className={`w-full border rounded-xl p-4 flex justify-between items-center gap-4 text-left transition-colors ${
                requiresApproval ? "border-[#c4f042] bg-[#1a2e05]" : "border-[#333] bg-[#111]"
              }`}
            >
              <span>
                <span className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{requiresApproval ? "✅" : "⚡"}</span>
                  <span className={`font-black text-sm ${requiresApproval ? "text-[#c4f042]" : "text-white"}`}>
                    {requiresApproval ? "Approval required" : "Instant join"}
                  </span>
                </span>
                <span className="block text-[#888] text-xs leading-relaxed">
                  {requiresApproval
                    ? "Players send a join request — you approve or reject. Players you invite directly still skip approval."
                    : "Players join instantly (subject to available slots)."}
                </span>
              </span>
              <span
                aria-hidden
                className={`shrink-0 w-12 h-7 rounded-full relative transition-colors ${requiresApproval ? "bg-[#c4f042]" : "bg-[#333]"}`}
              >
                <span className={`w-5 h-5 rounded-full absolute top-1 transition-all ${requiresApproval ? "left-6 bg-black" : "left-1 bg-[#888]"}`} />
              </span>
            </button>

            <div className="flex flex-col gap-7 mt-10">
              <div>
                <Label text="Event Name" required />
                <input
                  type="text"
                  placeholder="e.g. Friday Night Clash"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputCls(!!errors.title)}
                />
                {errors.title && <FieldError>{errors.title}</FieldError>}
              </div>
              <div>
                <Label text="Turf / Venue" required />
                <div className="relative">
                  <select value={turf} onChange={(e) => setTurf(e.target.value)} className={selectCls(!!errors.turf)}>
                    <option value="">Choose a turf…</option>
                    {turfs.map((t) => (
                      <option key={t._id} value={t._id}>{t.name} • {t.location?.city}</option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                </div>
                {errors.turf && <FieldError>{errors.turf}</FieldError>}
              </div>
            </div>

            <SubSectionHeader title="Schedule" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-7 border-b border-[#222] pb-10">
              <div>
                <Label text="Date" required />
                <div className="relative">
                  <input
                    type="date"
                    value={date}
                    min={todayStr}
                    onChange={(e) => setDate(e.target.value)}
                    className={dateCls(!!errors.date)}
                  />
                  <Calendar size={18} className="absolute right-5 top-4 text-[#888] pointer-events-none" />
                </div>
                {errors.date && <FieldError>{errors.date}</FieldError>}
              </div>
              <div>
                <Label text="Game Start Time" />
                <div className="relative">
                  <select
                    value={time}
                    onChange={(e) => { checkTimesEdited.current = false; setTime(e.target.value); }}
                    className={selectCls()}
                  >
                    {TIME_SLOT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                </div>
              </div>
              <div>
                <Label text="Players Report" />
                <div className="relative">
                  <select
                    value={String(reportingMins)}
                    onChange={(e) => setReporting(Number(e.target.value))}
                    className={selectCls()}
                  >
                    {[15,30,45,60].map((m) => (
                      <option key={m} value={m}>{m} mins before game{reportingTime && date ? ` (${reportingTime})` : ""}</option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                </div>
                <Hint>Time players should arrive at the turf</Hint>
              </div>
              <div>
                <Label text="Duration" />
                <Counter
                  value={durationMins}
                  unit="min"
                  min={15}
                  step={15}
                  onInput={(raw) => setDuration(Math.max(15, Number(raw) || 15))}
                  onDec={() => setDuration((v: number) => Math.max(15, v - 15))}
                  onInc={() => setDuration((v: number) => v + 15)}
                  decDisabled={Number(durationMins) <= 15}
                />
                {endTime && date && <Hint>Game ends at <strong className="text-[#aaa]">{endTime}</strong></Hint>}
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={() => goToTab("Configuration")}
                className="bg-white text-black px-6 py-3 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
              >
                Next
              </button>
            </div>
          </Panel>
          )}

          {activeTab === "Configuration" && (
          <Panel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-10">
              <div>
                <Label text="Format" required />
                <div className="relative">
                  <select
                    value={format}
                    onChange={(e) => {
                      const f = e.target.value as Format;
                      setFormat(f);
                      const s = slotsFromFormat(f);
                      setMaxPlayers(String(s));
                      if (!minPlayersEdited.current) setMinPlayers(String(Math.ceil(s / 2)));
                    }}
                    className={selectCls()}
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>{f === "Screening" ? "Screening" : `${f} (${slotsFromFormat(f)} Players)`}</option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                </div>
              </div>
              <div>
                <Label text="Fee Per Player" required />
                <MoneyField value={feeInRs} onChange={setFeeInRs} placeholder="e.g. 350" invalid={!!errors.feeInRs} />
                {errors.feeInRs && <FieldError>{errors.feeInRs}</FieldError>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-10 border-b border-[#222] pb-10">
              <div>
                <Label text="Min Players Required" />
                <Counter
                  value={minPlayers}
                  invalid={!!errors.minMax}
                  min={2}
                  max={format === "Screening" ? undefined : slotsFromFormat(format)}
                  onInput={(raw) => {
                    minPlayersEdited.current = true;
                    const val = Number(raw);
                    if (val < 2) setMinPlayers("2");
                    else if (format !== "Screening") {
                      const cap = slotsFromFormat(format);
                      if (val > cap) setMinPlayers(String(cap));
                      else setMinPlayers(raw);
                    } else {
                      setMinPlayers(raw);
                    }
                  }}
                  onDec={() => { minPlayersEdited.current = true; setMinPlayers((v: string) => String(Math.max(2, Number(v) - 1))); }}
                  onInc={() => { minPlayersEdited.current = true; setMinPlayers((v: string) => format === "Screening" ? String(Number(v) + 1) : String(Math.min(slotsFromFormat(format), Number(v) + 1))); }}
                  decDisabled={Number(minPlayers) <= 2}
                  incDisabled={format !== "Screening" && Number(minPlayers) >= slotsFromFormat(format)}
                />
                <Hint>{format === "Screening" ? "Min players to confirm" : `Min to confirm · max ${slotsFromFormat(format)} for ${format}`}</Hint>
              </div>
              <div>
                <Label text="Max Players Allowed" />
                <Counter
                  value={maxPlayers}
                  invalid={!!errors.minMax}
                  min={format === "Screening" ? 2 : slotsFromFormat(format)}
                  onInput={(raw) => {
                    const val = Number(raw);
                    if (format === "Screening") {
                      if (val < 2) setMaxPlayers("2");
                      else setMaxPlayers(raw);
                    } else {
                      const floor = slotsFromFormat(format);
                      if (val < floor) setMaxPlayers(String(floor));
                      else setMaxPlayers(raw);
                    }
                  }}
                  onDec={() => setMaxPlayers((v: string) => String(Math.max(format === "Screening" ? 2 : slotsFromFormat(format), Number(v) - 1)))}
                  onInc={() => setMaxPlayers((v: string) => String(Number(v) + 1))}
                  decDisabled={format !== "Screening" && Number(maxPlayers) <= slotsFromFormat(format)}
                />
                {errors.minMax && <FieldError>{errors.minMax}</FieldError>}
                <Hint>{format === "Screening" ? "Max players allowed" : `Must be ≥ ${slotsFromFormat(format)} (format slots)`}</Hint>
              </div>
              <div>
                <Label text="Backout Fee" />
                <MoneyField value={backoutFeeInRs} onChange={setBackoutFeeInRs} placeholder="0" />
                <Hint>Charged if a player backs out after the cutoff. Leave 0 for none.</Hint>
              </div>
              <div>
                <Label text="Registration Cutoff" />
                <Counter
                  value={cutoffHours}
                  unit="hrs"
                  min={0}
                  step={1}
                  onInput={(raw) => setCutoffHours(Math.max(0, Number(raw) || 0))}
                  onDec={() => setCutoffHours((v) => Math.max(0, v - 1))}
                  onInc={() => setCutoffHours((v) => v + 1)}
                  decDisabled={cutoffHours <= 0}
                />
                <Hint>Registration closes this many hours before kick-off.</Hint>
              </div>
            </div>

            <SubSectionHeader title="Format Change" />
            <div className="mb-10">
              <CheckboxRow
                label="Allow switch to a smaller format if it can't fill"
                checked={allowSizeChange}
                onChange={() => setAllowSizeChange((v: boolean) => !v)}
              />

              {allowSizeChange && (
                <div className="mt-8 pt-8 border-t border-[#222]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-10">
                    <div>
                      <Label text="Alt. Format" />
                      <div className="relative">
                        <select className={selectCls()} value={altFormat} onChange={(e) => setAltFormat(e.target.value as Format)}>
                          {FORMATS.map((f) => <option key={f} value={f}>{f} ({slotsFromFormat(f)})</option>)}
                        </select>
                        <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <Label text="Alt. Turf" />
                      <div className="relative">
                        <select className={selectCls()} value={altTurf || turf} onChange={(e) => setAltTurf(e.target.value)}>
                          {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                        </select>
                        <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
                    <div>
                      <Label text={<>Alt. Min (&lt; Main Min {minPlayers || "—"})</>} />
                      <Counter
                        value={altMin}
                        min={2}
                        placeholder={String(Math.ceil(slotsFromFormat(altFormat) / 2))}
                        onInput={setAltMin}
                        onDec={() => setAltMin((v) => String(Math.max(2, (Number(v) || 0) - 1)))}
                        onInc={() => setAltMin((v) => String(Math.max(2, (Number(v) || 0) + 1)))}
                      />
                    </div>
                    <div>
                      <Label text="Alt. Max" />
                      <Counter
                        value={altMax}
                        min={slotsFromFormat(altFormat)}
                        placeholder={String(slotsFromFormat(altFormat))}
                        onInput={setAltMax}
                        onDec={() => setAltMax((v) => String(Math.max(slotsFromFormat(altFormat), (Number(v) || 0) - 1)))}
                        onInc={() => setAltMax((v) => String(Math.max(slotsFromFormat(altFormat), (Number(v) || 0) + 1)))}
                      />
                    </div>
                    <div>
                      <Label text="Alt. Fee" />
                      <MoneyField value={altFee} onChange={setAltFee} placeholder={feeInRs ? `< ${feeInRs}` : "0"} />
                      <Hint>Must be less than the main fee{feeInRs ? ` (₹${feeInRs})` : ""}</Hint>
                    </div>
                  </div>

                  {errors.alt && <FieldError>{errors.alt}</FieldError>}
                </div>
              )}
            </div>

            <div className="mt-8 flex justify-between">
              <button
                type="button"
                onClick={() => goToTab("Event Details")}
                className="bg-[#222] text-[#888] px-6 py-3 rounded-xl font-bold text-sm hover:bg-[#333] hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToTab("Check-in & Guests")}
                className="bg-white text-black px-6 py-3 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
              >
                Next
              </button>
            </div>
          </Panel>
          )}

          {activeTab === "Check-in & Guests" && (
          <Panel>
            <SubSectionHeader title="Confirmation Check-ins" first />
            <div className="mb-12">
              <p className="text-[#666] text-xs font-medium -mt-1.5  mb-6">Two automatic reviews of turnout — to confirm, switch format, or cancel.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-6">
                <div>
                  <Label text={<>First Check-in Date{" "}
                    <button
                      type="button"
                      title="What is the first check-in?"
                      onClick={() => setCheckTip(checkTip === "first" ? null : "first")}
                      className="inline-flex align-middle ml-1 text-[#4f90ea] hover:text-[#7fb0f0] transition-colors"
                    >
                      <Info size={14} />
                    </button>
                  </>} />
                  <div className="relative">
                    <input
                      type="date"
                      className={dateCls()}
                      value={firstCheckDate}
                      min={todayStr}
                      max={date || undefined}
                      onChange={(e) => { checkTimesEdited.current = true; setFirstCheckDate(e.target.value); }}
                    />
                    <Calendar size={18} className="absolute right-5 top-4 text-[#888] pointer-events-none" />
                  </div>
                </div>
                <div>
                  <Label text="First Check-in Time" />
                  <div className="relative">
                    <select
                      className={selectCls()}
                      value={firstCheckTime}
                      onChange={(e) => { checkTimesEdited.current = true; setFirstCheckTime(e.target.value); }}
                    >
                      {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                  </div>
                </div>
                <div>
                  <Label text={<>Second Check-in Date{" "}
                    <button
                      type="button"
                      title="What is the second check-in?"
                      onClick={() => setCheckTip(checkTip === "second" ? null : "second")}
                      className="inline-flex align-middle ml-1 text-[#4f90ea] hover:text-[#7fb0f0] transition-colors"
                    >
                      <Info size={14} />
                    </button>
                  </>} />
                  <div className="relative">
                    <input
                      type="date"
                      className={dateCls()}
                      value={secondCheckDate}
                      min={firstCheckDate || todayStr}
                      max={date || undefined}
                      onChange={(e) => { checkTimesEdited.current = true; setSecondCheckDate(e.target.value); }}
                    />
                    <Calendar size={18} className="absolute right-5 top-4 text-[#888] pointer-events-none" />
                  </div>
                </div>
                <div>
                  <Label text="Second Check-in Time" />
                  <div className="relative">
                    <select
                      className={selectCls()}
                      value={secondCheckTime}
                      onChange={(e) => { checkTimesEdited.current = true; setSecondCheckTime(e.target.value); }}
                    >
                      {TIME_SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-4.5 text-[#888] pointer-events-none" />
                  </div>
                </div>
              </div>

              {checkTip === "first" && (
                <div className="bg-[#241f14] border border-[#3d3320] p-4 rounded-xl mb-6">
                  <p className="text-[#e7dcb8] text-sm leading-relaxed">
                    <span className="font-bold text-white">First check-in — early heads-up.</span> Only <i>suggests</i> (confirm, switch, SOS, or cancel). Nothing is automatic — you decide, or wait for the second check.
                  </p>
                </div>
              )}

              {checkTip === "second" && (
                <div className="bg-[#1a2322] border border-[#233527] p-4 rounded-xl mb-6">
                  <p className="text-[#99c8a9] text-sm leading-relaxed">
                    <span className="font-bold text-white">Second check-in — the deadline.</span> Automation ON: the system acts by itself — enough players → confirm; enough for the alternate → switch &amp; confirm; too few → cancel + refund.<br />
                    Automation OFF: you get a pop-up + WhatsApp and <span className="font-bold text-white">you</span> decide (confirm / switch / cancel / keep waiting).
                  </p>
                </div>
              )}

              <p className="text-[#666] text-xs font-medium leading-relaxed">
                {date
                  ? `Defaults to ${prettyDate(checkInDate(date, time))} (${Number(time.split(":")[0]) < 12 ? "day before — morning game" : "game day"}). Change either date or time — the reminder, pop-up and WhatsApp all follow what you set.`
                  : "Pick a game date first; the check-ins default near it and can be moved to any day before kickoff."}
              </p>

              {(checkOrderBad || errors.checks) && (
                <FieldError>{checkOrderBad ? "Second check-in must be after the first." : errors.checks}</FieldError>
              )}

              <div className="mt-10 pt-10 border-t border-[#222]">
                <CheckboxRow
                  label={<span className="font-bold">Automation — auto-confirm / auto-cancel at the 2nd check-in</span>}
                  helper={automationEnabled
                    ? "ON: at the 2nd check-in the system acts by itself — enough players → game confirmed automatically; enough for the alternate → switched & confirmed; too few → auto-cancelled and everyone refunded."
                    : "OFF: the system never acts on its own. At the 2nd check-in you get a pop-up + WhatsApp with a recommendation — you confirm, switch, cancel, or keep waiting."}
                  checked={automationEnabled}
                  onChange={() => setAutomationEnabled((v: boolean) => !v)}
                />
              </div>
            </div>

            <SubSectionHeader title="Your Participation" />
            <div className="mb-10 flex flex-col gap-8">
              <CheckboxRow
                label={<span className="font-bold">I want to play in this game</span>}
                helper="Check this if you as the organiser will also be playing — uses 1 slot from the total"
                checked={organiserIsPlaying}
                onChange={() => {
                  const next = !organiserIsPlaying;
                  setOrganiserPlaying(next);
                  if (!next && organiserGuestCount > hardCap) {
                    setOrganiserGuests((prev) => prev.slice(0, hardCap));
                  }
                }}
              />

              <div>
                <Label text="Guests you're bringing" />

                {organiserGuests.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {organiserGuests.map((g, idx) => {
                      const posLabel = ({ GK: "GK", DEF: "DEF", MID: "MID", FWD: "FWD" } as Record<string, string>)[g.position];
                      const teamCls = g.teamPreference === "Red Team"
                        ? "bg-[#dc2626]/20 text-[#f87171]"
                        : g.teamPreference === "Blue Team"
                          ? "bg-[#3b82f6]/20 text-[#60a5fa]"
                          : null;
                      return (
                        <div key={idx} className="flex items-center gap-3 bg-[#1a2322] border border-[#233527] rounded-xl px-4 py-3">
                          <span className="text-[#c4f042] font-black text-sm shrink-0">#{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={g.name}
                              onChange={(e) => setOrganiserGuests((prev) => prev.map((guest, i) => i === idx ? { ...guest, name: e.target.value } : guest))}
                              placeholder={`Guest ${idx + 1}`}
                              maxLength={40}
                              className="w-full bg-transparent border-b border-[#333] focus:border-[#c4f042] text-[#ddd] text-sm outline-none py-0.5 transition-colors placeholder:text-[#555]"
                            />
                            {(posLabel || teamCls) && (
                              <div className="flex gap-1.5 mt-1.5">
                                {posLabel && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#c4f042]/20 text-[#c4f042]">{posLabel}</span>}
                                {teamCls && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${teamCls}`}>{g.teamPreference}</span>}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setOrganiserGuests((prev) => prev.filter((_, i) => i !== idx))}
                            className="shrink-0 bg-[#ff5a5f]/10 border border-[#ff5a5f]/30 text-[#ff5a5f] rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-[#ff5a5f]/20 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {organiserGuestCount < maxGuests && (
                  <button
                    type="button"
                    onClick={() => { setGuestPrefName(""); setGuestPrefPosition("Any"); setGuestPrefTeam("No Preference"); setGuestPrefOpen(true); }}
                    className="w-full border border-dashed border-[#233527] bg-[#1a2322] hover:bg-[#202b2a] text-[#c4f042] text-sm font-bold py-4 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 mt-2"
                  >
                    <Plus size={18} strokeWidth={2.5} /> Add Guest
                  </button>
                )}
                <p className="text-[#666] text-xs font-medium mt-3 ml-1 mb-6">Each guest uses 1 slot from the total capacity</p>

                <div className={`border rounded-xl p-4 ${openSlots === 0 ? "border-[#ff5a5f]/40 bg-[#2a1517]" : "border-[#233527] bg-[#1a2322]"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`font-black ${openSlots === 0 ? "text-[#ff5a5f]" : "text-[#c4f042]"}`}>{openSlots === 0 ? "⚠️" : "✓"}</span>
                    <span className={`font-black text-sm ${openSlots === 0 ? "text-[#ff5a5f]" : "text-[#c4f042]"}`}>
                      {openSlots === 0
                        ? "No open slots — all capacity is reserved"
                        : `${openSlots} open slot${openSlots !== 1 ? "s" : ""} for players to book slots`}
                    </span>
                  </div>
                  <p className="text-[#888] text-xs font-medium">
                    Total cap: {hardCap}
                    {organiserSlot > 0 && ` · You: 1`}
                    {organiserGuestCount > 0 && ` · Your guests: ${organiserGuestCount}`}
                    {` · Open: ${openSlots}`}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-start">
              <button
                type="button"
                onClick={() => goToTab("Configuration")}
                className="bg-[#222] text-[#888] px-6 py-3 rounded-xl font-bold text-sm hover:bg-[#333] hover:text-white transition-colors"
              >
                Back
              </button>
            </div>
          </Panel>
          )}
        </div>

        <div className=" mx-auto mt-12 pt-6 border-t border-[#222]">
          <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="bg-[#222] text-white text-[11px] min-[400px]:text-xs sm:text-sm font-bold px-3 min-[400px]:px-4 sm:px-6 py-3 sm:py-4 rounded-xl hover:bg-[#333] transition-colors shrink-0 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <div className="flex flex-row gap-2 sm:gap-4 justify-end flex-1">
              <button
                type="button"
                onClick={() => { setTmplName(title.trim()); setTmplMsg(null); setTmplModalOpen(true); }}
                disabled={loading}
                title="Save these settings as a reusable template"
                className="bg-[#2a2a2a] text-white text-[11px] min-[400px]:text-xs sm:text-sm font-bold px-3 min-[400px]:px-4 sm:px-6 py-3 sm:py-4 rounded-xl hover:bg-[#333] transition-colors flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Save size={14} className="sm:w-4.5 sm:h-4.5" /> Save template
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-[#c4f042] text-[#0f0f0f] text-xs min-[400px]:text-sm sm:text-base font-black px-4 min-[400px]:px-5 sm:px-10 py-3 sm:py-4 rounded-xl hover:bg-[#d5ff55] transition-colors flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap flex-1 sm:flex-none shadow-lg disabled:opacity-60"
              >
                {loading
                  ? <><span className="font-black sm:text-lg">⏳</span> Creating…</>
                  : <><span className="font-black sm:text-lg">✓</span> Create Event</>}
              </button>
            </div>
          </div>
        </div>
      </form>

      {guestPrefOpen && (
        <div
          className="fixed inset-0 bg-black/75 z-9999 flex items-center justify-center p-4"
          onClick={() => setGuestPrefOpen(false)}
        >
          <div
            className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-90 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[#c4f042] font-black text-lg mb-1">Add Guest</h3>
            <p className="text-[#666] text-xs mb-5">Set guest name, position and team preference.</p>

            <div className="mb-4">
              <Label text={<>Guest Name <span className="text-[#555] normal-case">(optional)</span></>} />
              <input
                type="text"
                value={guestPrefName}
                onChange={(e) => setGuestPrefName(e.target.value)}
                placeholder="e.g. Rahul"
                maxLength={40}
                className={inputCls()}
              />
            </div>

            <div className="mb-4">
              <Label text="Position" />
              <div className="flex flex-wrap gap-1.5">
                {["Any","GK","DEF","MID","FWD"].map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setGuestPrefPosition(pos)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      guestPrefPosition === pos
                        ? "bg-[#c4f042]/20 text-[#c4f042] border-[#c4f042]/50"
                        : "bg-[#1a1a1a] text-[#888] border-[#2a2a2a] hover:text-white"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <Label text="Team" />
              <div className="flex flex-wrap gap-1.5">
                {["No Preference","Red Team","Blue Team"].map((t) => {
                  const on = guestPrefTeam === t;
                  const onCls = t === "Red Team"
                    ? "bg-[#dc2626]/20 text-[#f87171] border-[#dc2626]/40"
                    : t === "Blue Team"
                      ? "bg-[#3b82f6]/20 text-[#60a5fa] border-[#3b82f6]/40"
                      : "bg-[#c4f042]/20 text-[#c4f042] border-[#c4f042]/40";
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setGuestPrefTeam(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        on ? onCls : "bg-[#1a1a1a] text-[#888] border-[#2a2a2a] hover:text-white"
                      }`}
                    >
                      {t === "No Preference" ? "No Pref" : t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGuestPrefOpen(false)}
                className="flex-1 py-3 rounded-xl bg-transparent border border-[#2a2a2a] text-[#888] text-sm font-bold hover:text-white hover:bg-[#1a1a1a] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrganiserGuests((prev) => [...prev, { name: guestPrefName.trim(), position: guestPrefPosition, teamPreference: guestPrefTeam }]);
                  setGuestPrefOpen(false);
                }}
                className="flex-2 py-3 rounded-xl bg-[#c4f042] text-[#0f0f0f] text-sm font-black hover:bg-[#d5ff55] transition-colors"
              >
                Add Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {tmplModalOpen && (
        <div
          className="fixed inset-0 bg-black/75 z-9999 flex items-center justify-center p-4"
          onClick={() => !tmplSaving && setTmplModalOpen(false)}
        >
          <div
            className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[#c4f042] font-black text-lg mb-1">Save as template</h3>
            <p className="text-[#666] text-xs mb-5 leading-relaxed">
              Reuse these settings later — spin up a game in one tap from the Templates page.
            </p>

            <Label text="Template name" />
            <input
              type="text"
              value={tmplName}
              onChange={(e) => setTmplName(e.target.value)}
              autoFocus
              placeholder="e.g. Friday Night 6v6"
              maxLength={60}
              className={inputCls()}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSaveTemplate(); } }}
            />

            {tmplMsg && (
              <p className={`mt-3 text-sm font-bold ${tmplMsg.startsWith("✅") ? "text-[#c4f042]" : "text-[#ff5a5f]"}`}>{tmplMsg}</p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setTmplModalOpen(false)}
                disabled={tmplSaving}
                className="flex-1 py-3 rounded-xl bg-transparent border border-[#2a2a2a] text-[#888] text-sm font-bold hover:text-white hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={tmplSaving}
                className="flex-2 py-3 rounded-xl bg-[#c4f042] text-[#0f0f0f] text-sm font-black hover:bg-[#d5ff55] transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {tmplSaving ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
