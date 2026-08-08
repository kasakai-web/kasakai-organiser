"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import { checkInIsoFromParts, istYMD, istHHmm, sameMinute } from "@/utils/checkins";

interface Turf { _id: string; name: string; location: { city: string } }

const FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10"] as const;
type Format = typeof FORMATS[number];

const slotsFromFormat = (fmt: string) => {
  const parts = fmt.split("v");
  if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]);
  return 10;
};

// "18:30" → "6:30 PM"
const to12h = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return v;
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const TIME_SLOT_OPTIONS = Array.from({ length: 96 }, (_, idx) => {
  const hours = Math.floor(idx / 4);
  const minutes = String((idx % 4) * 15).padStart(2, "0");
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  return { value, label: to12h(value) };
});

// The quarter-hour grid, plus `value` itself when it sits off-grid. Games created
// through the API (or seeded) can hold any minute, and a <select> whose value
// matches no option renders blank — saving it would then silently move the time
// to whatever the browser fell back to.
const timeOptionsFor = (value: string) => {
  if (!value || TIME_SLOT_OPTIONS.some((o) => o.value === value)) return TIME_SLOT_OPTIONS;
  return [...TIME_SLOT_OPTIONS, { value, label: `${to12h(value)} (current)` }]
    .sort((a, b) => a.value.localeCompare(b.value));
};

// "Sun, 19 Jul 2026 · 9:00 AM" — always IST, never the browser's zone.
const prettyIst = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
};

interface GuestReg {
  _id: string; plusOneName: string;
  preferredPosition?: string; teamPreference?: string;
}

const POSITION_LABELS: Record<string, string> = {
  goalkeeper: "GK", defender: "DEF", midfielder: "MID", forward: "FWD",
};
const TEAM_LABELS: Record<string, string> = { red: "Red Team", blue: "Blue Team" };

function extractOrgGuests(game: any): GuestReg[] {
  const orgId = String(game.organiser?._id ?? game.organiser ?? "");
  return (game.registrations || [])
    .filter((r: any) => {
      if (!r.plusOneName) return false;
      if (!r.player) return true;
      return String(r.player?._id ?? r.player ?? "") === orgId;
    })
    .map((r: any) => ({
      _id: String(r._id), plusOneName: r.plusOneName,
      preferredPosition: r.preferredPosition, teamPreference: r.teamPreference,
    }));
}

function liveActiveCount(game: any): number {
  return (game.registrations || []).filter(
    (r: any) => !r.backedOutAt && !["refunded", "forfeited"].includes(r.paymentStatus || "") && !r.optedOut
  ).length;
}

interface EditEventModalProps {
  gameId: string;
  initialData: any;
  onClose: () => void;
  onSuccess: () => void;
  onParticipationChange?: () => void;
}

export function EditEventModal({
  gameId, initialData, onClose, onSuccess, onParticipationChange,
}: EditEventModalProps) {

  /* ── Live participation state (real-time, not batched) ── */
  const [organiserPlaying, setOrganiserPlaying] = useState(Boolean(initialData.organiserIsPlaying));
  const [regsCount, setRegsCount] = useState(() => liveActiveCount(initialData));
  const [guests, setGuests] = useState<GuestReg[]>(() => extractOrgGuests(initialData));

  /* ── Action feedback ── */
  const [actionLoading, setActionLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [guestLoading, setGuestLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /* ── Inline confirmation ── */
  type PendingAction =
    | { type: "join" | "leave" }
    | { type: "remove-guest"; guest: GuestReg };
  const [pending, setPending] = useState<PendingAction | null>(null);
  // The kickoff-move confirmation, raised by Save rather than by a field.
  const [pendingSave, setPendingSave] = useState(false);

  /* ── Guest pref mini-modal ── */
  const [prefOpen, setPrefOpen] = useState(false);
  const [prefName, setPrefName] = useState("");
  const [prefPosition, setPrefPosition] = useState("Any");
  const [prefTeam, setPrefTeam] = useState("No Preference");

  /* ── Form settings state (batched, saved via Save button) ── */
  const [turfs, setTurfs] = useState<Turf[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(initialData.title ?? "");
  const [turf, setTurf] = useState(initialData.turf?._id || "");
  const [status, setStatus] = useState(initialData.status ?? "open");
  const [requiresApproval, setRequiresApproval] = useState(Boolean(initialData.requiresApproval));

  // How many join requests are currently awaiting a decision — used to warn the
  // organiser that turning approval OFF will auto-approve them up to capacity.
  const pendingRequestsCount = (initialData.invitations || []).filter(
    (i: any) => ["pending", "approved_unpaid"].includes(i.status)
  ).length;
  const [format, setFormat] = useState<Format>((initialData.format as Format) ?? "5v5");
  const [totalSlots, setTotalSlots] = useState(initialData.totalSlots ?? slotsFromFormat(initialData.format ?? "5v5"));
  const [feeInRs, setFeeInRs] = useState(initialData.feeInPaise ? initialData.feeInPaise / 100 : 0);
  const [durationMins, setDurationMins] = useState(initialData.durationMins ?? 60);
  const [minPlayers, setMinPlayers] = useState(initialData.minPlayers ?? 7);
  const [reportingMins, setReportingMins] = useState(initialData.reportingMinsBeforeGame ?? 30);

  const initialDateTime = useMemo(() => {
    if (!initialData.scheduledAt) return { date: "", time: "18:00" };
    // Read both date and time in IST — never browser TZ or UTC, so late-night IST
    // games keep the correct calendar date and hour when editing. The exact stored
    // minute is kept: snapping it to the picker's grid here would move the game
    // the first time the organiser saved anything at all.
    return {
      date: istYMD(initialData.scheduledAt),
      time: istHHmm(initialData.scheduledAt),
    };
  }, [initialData.scheduledAt]);

  const [date, setDate] = useState(initialDateTime.date);
  const [time, setTime] = useState(initialDateTime.time);

  /* ── Format change + alternate format (3.2) ── */
  const lastAlt = initialData.alternateFormats?.[0] || null;
  // An alternate's fee is locked only if it ALREADY existed at creation. A game
  // with no alternate (e.g. the format review asked the organiser to define one)
  // can still have its brand-new alternate fee set here.
  const hadAlternate = Boolean(lastAlt && lastAlt.format);
  const [allowSizeChange, setAllowSizeChange] = useState(Boolean(initialData.allowSizeChange));
  const [altFormat, setAltFormat] = useState<Format>((lastAlt?.format as Format) ?? "5v5");
  const [altTurf, setAltTurf] = useState<string>(lastAlt?.turf?._id || (typeof lastAlt?.turf === "string" ? lastAlt.turf : ""));
  const [altMin, setAltMin] = useState<string>(lastAlt?.minPlayers ? String(lastAlt.minPlayers) : "");
  const [altMax, setAltMax] = useState<string>(lastAlt?.maxPlayers ? String(lastAlt.maxPlayers) : "");
  // Show the actual stored fee — including ₹0. The old `feeInPaise ? … : ""`
  // treated 0 (a free alternate) as falsy, so the field went blank and showed a
  // misleading "< main fee" placeholder instead of the real cost.
  const [altFee, setAltFee] = useState<string>(hadAlternate ? String((lastAlt!.feeInPaise ?? 0) / 100) : "");

  /* ── Confirmation check-ins (3.1) — restore the saved times/dates ── */
  const [automationEnabled, setAutomationEnabled] = useState(Boolean(initialData.lifecycle?.automationEnabled));
  const [firstCheckDate, setFirstCheckDate]   = useState(istYMD(initialData.lifecycle?.firstCheckAt));
  const [firstCheckTime, setFirstCheckTime]   = useState(istHHmm(initialData.lifecycle?.firstCheckAt));
  const [secondCheckDate, setSecondCheckDate] = useState(istYMD(initialData.lifecycle?.secondCheckAt));
  const [secondCheckTime, setSecondCheckTime] = useState(istHHmm(initialData.lifecycle?.secondCheckAt));

  /* ── Start-time edit (see Game-Time-Edit-Plan §3) ──
     A check-in that has ALREADY run is settled — its moment has passed and the
     engine is done with it, so it is neither shown nor sent. A check-in still
     PENDING has to stay before kickoff, which is what the validation below and
     the backend both enforce. */
  const firstCheckDone  = Boolean(initialData.lifecycle?.firstCheckDoneAt);
  const secondCheckDone = Boolean(initialData.lifecycle?.secondCheckDoneAt);
  const timeEditable    = !["completed", "cancelled"].includes(initialData.status);

  // Set once the organiser actually touches the kickoff / a check-in, so the
  // re-anchoring below never fires on mount (which would overwrite saved values)
  // and never overrules a check-in they set by hand.
  const scheduleTouched  = useRef(false);
  const checkTimesEdited = useRef(false);

  useEffect(() => {
    const { token } = getSession();
    fetch(buildApiUrl("/api/v1/turfs"), token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then((r) => r.json())
      .then((d) => { if (d.success) setTurfs(d.data || []); })
      .catch(console.error);
  }, []);

  /* ── Helpers ── */
  const showMsg = (type: "success" | "error", text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 2500);
  };

  const syncFromGame = (game: any) => {
    if (!game) return;
    setGuests(extractOrgGuests(game));
    setRegsCount(liveActiveCount(game));
  };

  /* ── Capacity (live) ── */
  const hardCap = Number(totalSlots);
  const filled = regsCount + (organiserPlaying ? 1 : 0);
  const openSlots = Math.max(0, hardCap - filled);

  /* ── Check-in date pickers: lower bound + live ordering check ── */
  // Today in IST — the pickers are IST, so a UTC "today" would offer yesterday
  // to anyone editing between midnight and 5:30am IST.
  const todayStr = istYMD(new Date().toISOString());
  const firstCheckIso  = checkInIsoFromParts(firstCheckDate, firstCheckTime);
  const secondCheckIso = checkInIsoFromParts(secondCheckDate, secondCheckTime);

  /* ── The kickoff the form currently describes ── */
  const scheduledIso = date && time
    ? new Date(`${date}T${time}:00+05:30`).toISOString()   // entered in IST
    : null;

  // Only genuinely moved fields are treated as edits — and only those are sent
  // (see handleSubmit). sameMinute is what stops an untouched save from reading
  // as a reschedule and WhatsApping everyone about a change that never happened.
  const timeChanged        = Boolean(scheduledIso) && !sameMinute(scheduledIso, initialData.scheduledAt);
  const firstCheckChanged  = !firstCheckDone  && !sameMinute(firstCheckIso,  initialData.lifecycle?.firstCheckAt);
  const secondCheckChanged = !secondCheckDone && !sameMinute(secondCheckIso, initialData.lifecycle?.secondCheckAt);

  // How many people the save would message: every active registered person
  // (a player and their guests are one human) plus the waitlist.
  const notifyCount = useMemo(() => {
    const ids = new Set<string>();
    const idOf = (v: any) => String(v?._id ?? v ?? "");
    (initialData.registrations || []).forEach((r: any) => {
      if (r.backedOutAt || ["refunded", "forfeited"].includes(r.paymentStatus || "") || r.optedOut) return;
      if (idOf(r.player)) ids.add(idOf(r.player));
    });
    (initialData.waitlist || []).forEach((w: any) => {
      if (!["waiting", "notified", "approved"].includes(w.status || "")) return;
      if (idOf(w.player)) ids.add(idOf(w.player));
    });
    return ids.size;
  }, [initialData]);

  /* ── Move the pending check-ins with the kickoff ──
     A check-in is "N hours before kickoff", not a fixed wall-clock moment. If the
     game moves a week out and the check-ins stay put, the engine reaches the 2nd
     check-in on the old date and decides the game's fate a week early — with
     automation ON, that auto-cancels and refunds a game nobody had a chance to
     fill. Translating every pending check by the same delta keeps the organiser's
     intent and preserves 1st < 2nd < kickoff for free. Always measured from the
     ORIGINAL values so repeated edits can't compound. */
  useEffect(() => {
    if (!scheduleTouched.current || checkTimesEdited.current) return;
    if (!scheduledIso || !initialData.scheduledAt) return;
    const delta = +new Date(scheduledIso) - +new Date(initialData.scheduledAt);
    if (delta === 0) return;

    const shift = (iso: string | null | undefined) =>
      new Date(+new Date(iso as string) + delta).toISOString();

    if (!firstCheckDone && initialData.lifecycle?.firstCheckAt) {
      const moved = shift(initialData.lifecycle.firstCheckAt);
      setFirstCheckDate(istYMD(moved));
      setFirstCheckTime(istHHmm(moved));
    }
    if (!secondCheckDone && initialData.lifecycle?.secondCheckAt) {
      const moved = shift(initialData.lifecycle.secondCheckAt);
      setSecondCheckDate(istYMD(moved));
      setSecondCheckTime(istHHmm(moved));
    }
  }, [date, time]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Execute confirmed action ── */
  const executeAction = async () => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    setActionLoading(true);
    try {
      const { token } = getSession();
      if (!token) return;

      if (action.type === "join" || action.type === "leave") {
        const newVal = action.type === "join";
        const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}`), {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ organiserIsPlaying: newVal }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to update");
        setOrganiserPlaying(newVal);
        syncFromGame(data.data);
        showMsg("success", newVal ? "You're in! Slot reserved." : "Withdrawn from game.");
        onParticipationChange?.();
      } else if (action.type === "remove-guest") {
        setRemovingId(action.guest._id);
        const res = await fetch(
          buildApiUrl(`/api/v1/games/organisers/${gameId}/registrations/${action.guest._id}`),
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to remove guest");
        syncFromGame(data.data);
        showMsg("success", `${action.guest.plusOneName} removed.`);
        onParticipationChange?.();
      }
    } catch (err: any) {
      showMsg("error", err.message || "Action failed. Please try again.");
    } finally {
      setActionLoading(false);
      setRemovingId(null);
    }
  };

  /* ── Add guest (real-time, pref modal IS the confirmation) ── */
  const addGuest = async (name: string, position: string, teamPreference: string) => {
    const { token } = getSession();
    if (!token) return;
    setGuestLoading(true);
    setPrefOpen(false);
    try {
      const body: Record<string, string> = { position, teamPreference };
      if (name.trim()) body.guestName = name.trim();
      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}/add-guest`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { showMsg("error", data.message || "Failed to add guest"); return; }
      syncFromGame(data.data);
      showMsg("success", "Guest added.");
      onParticipationChange?.();
    } catch (err: any) {
      showMsg("error", err.message || "Failed to add guest");
    } finally {
      setGuestLoading(false);
    }
  };

  /* ── Form save — only game settings, participation is handled separately ── */
  const handleFormatChange = (f: Format) => {
    setFormat(f);
    const slots = slotsFromFormat(f);
    setTotalSlots(slots);
    setMinPlayers(Math.floor(slots * 0.7));
  };

  // `timeConfirmed` is set when the organiser has OK'd the "this messages N
  // people" bar; a plain submit with a moved kickoff raises that bar instead.
  const handleSubmit = async (e: React.FormEvent | null, timeConfirmed = false) => {
    e?.preventDefault();
    setPendingSave(false);
    const newErrors: Record<string, string> = {};
    if (!title.trim()) newErrors.title = "Title is required";
    if (!turf) newErrors.turf = "Venue is required";
    if (!date) newErrors.date = "Date is required";
    if (Number(minPlayers) > Number(totalSlots))
      newErrors.minMax = "Min players cannot exceed total slots";
    // Alternate format: valid min/max and a fee strictly below the main fee.
    // Only validated when the section is actually shown (an alternate existed at
    // creation) — otherwise a hidden section could block submit with an unseeable error.
    if (hadAlternate && allowSizeChange) {
      const altSlots = slotsFromFormat(altFormat);
      if (!altMin || Number(altMin) < 2) newErrors.alt = "Alternate min must be at least 2";
      else if (Number(altMin) >= Number(minPlayers)) newErrors.alt = `Alternate min (${altMin}) must be less than the main format min (${minPlayers})`;
      else if (Number(altMax) < altSlots) newErrors.alt = `Alternate max must be at least ${altSlots} for ${altFormat}`;
      else if (Number(altMax) < Number(altMin)) newErrors.alt = "Alternate max cannot be less than min";
      else {
        const altFeeNum = Number(altFee);
        if (altFee === "" || isNaN(altFeeNum) || altFeeNum < 0) newErrors.alt = "Alternate fee is required (₹0 or more)";
        else if (Number(feeInRs) > 0 && altFeeNum >= Number(feeInRs)) newErrors.alt = `Alternate fee must be less than the main fee (₹${feeInRs})`;
      }
    }
    // Start time + check-ins (plan §4). The backend re-validates all of this —
    // this is only here to fail fast with a message that names what to fix.
    if (timeChanged && scheduledIso && new Date(scheduledIso) <= new Date()) {
      newErrors.date = "The new start time must be in the future.";
    }
    if (scheduledIso) {
      const kickoff = new Date(scheduledIso);
      // A check that already ran is exempt — its moment has passed.
      if (!secondCheckDone && secondCheckIso && new Date(secondCheckIso) >= kickoff) {
        newErrors.checks = `Your game would start before its 2nd check-in (${prettyIst(secondCheckIso)}). Move the 2nd check-in too, or pick a later start time.`;
      } else if (!firstCheckDone && firstCheckIso && new Date(firstCheckIso) >= kickoff) {
        newErrors.checks = `Your game would start before its 1st check-in (${prettyIst(firstCheckIso)}). Move the 1st check-in too, or pick a later start time.`;
      } else if (!firstCheckDone && !secondCheckDone && firstCheckIso && secondCheckIso
                 && new Date(firstCheckIso) >= new Date(secondCheckIso)) {
        newErrors.checks = "The 2nd check-in must be after the 1st check-in.";
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    // Moving the kickoff messages everyone holding a place — confirm it first.
    if (timeChanged && !timeConfirmed) { setErrors({}); setPendingSave(true); return; }

    setLoading(true);
    try {
      const { token } = getSession();
      if (!token) { setErrors({ submit: "Please login as organiser first" }); return; }

      // Only fields that actually moved are sent. A check-in that has already run
      // is never sent (nothing to change about it), and neither is one the
      // organiser left alone — re-sending it could only ever disturb it.
      const lifecycle: Record<string, unknown> = { automationEnabled };
      if (firstCheckChanged)  lifecycle.firstCheckAt  = firstCheckIso;
      if (secondCheckChanged) lifecycle.secondCheckAt = secondCheckIso;

      // organiserIsPlaying is NOT included — it's managed in real-time above.
      // cutoffAt is not sent either: the backend always re-derives it from the
      // start time, so sending it would just be a second opinion it ignores.
      const payload: Record<string, unknown> = {
        title: title.trim(),
        turf,
        status,
        format,
        totalSlots: Number(totalSlots),
        feeInRs: Number(feeInRs),
        durationMins: Number(durationMins),
        minPlayers: Number(minPlayers),
        reportingMinsBeforeGame: Number(reportingMins),
        requiresApproval,
        lifecycle,
      };
      // IST-anchored, and only when the organiser actually moved it — the backend
      // treats an absent start time as "leave it alone".
      if (timeChanged) payload.scheduledAt = scheduledIso;

      // Format Change is only editable when an alternate was defined at creation.
      // If none existed, leave allowSizeChange / alternateFormats untouched (don't
      // send them) so a hidden section can never create a bogus alternate.
      if (hadAlternate) {
        payload.allowSizeChange = allowSizeChange;
        payload.alternateFormats = allowSizeChange ? [{
          format:     altFormat,
          turf:       altTurf || turf,
          minPlayers: Number(altMin),
          maxPlayers: Number(altMax),
          feeInRs:    Number(altFee),
        }] : [];
      }

      const res = await fetch(buildApiUrl(`/api/v1/games/organisers/${gameId}`), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const data = res.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : { success: false, message: text || `HTTP ${res.status}` };

      if (!res.ok || !data.success) { setErrors({ submit: data.message || `HTTP ${res.status}` }); return; }
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrors({ submit: err.message || "Failed to update event" });
    } finally {
      setLoading(false);
    }
  };

  /* ── Inline confirmation UI ── */
  const ConfirmBar = ({ action }: { action: PendingAction }) => {
    const isJoin = action.type === "join";
    const isLeave = action.type === "leave";
    const isRemove = action.type === "remove-guest";
    const msg = isJoin
      ? "Reserve 1 slot and join this game?"
      : isLeave
        ? "Withdraw your slot from this game?"
        : `Remove ${(action as any).guest?.plusOneName} from your guest list?`;
    const accent = isRemove || isLeave ? "#f87171" : "#c8ff3e";
    return (
      <div style={{
        marginBottom: 10, padding: "10px 12px",
        background: isRemove || isLeave ? "rgba(220,38,38,0.07)" : "rgba(200,255,62,0.07)",
        border: `1px solid ${isRemove || isLeave ? "rgba(220,38,38,0.3)" : "rgba(200,255,62,0.25)"}`,
        borderRadius: 8, display: "flex", alignItems: "center",
        gap: 10, flexWrap: "wrap" as const,
      }}>
        <span style={{ flex: 1, fontSize: 12, color: "#ddd", minWidth: 140 }}>{msg}</span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => setPending(null)}
            style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", border: "1px solid #444", color: "#888", fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="button" onClick={executeAction} disabled={actionLoading}
            style={{ padding: "5px 14px", borderRadius: 6, background: accent, color: "#000", fontWeight: 700, fontSize: 12, border: "none", cursor: "pointer" }}>
            {actionLoading ? "…" : "Confirm"}
          </button>
        </div>
      </div>
    );
  };

  /* ── Render ── */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content edit-event-modal"
        style={{ maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-section">
            <h2 style={{ margin: 0 }}>Edit Event</h2>
            <p className="modal-subtitle" style={{ marginTop: 4 }}>{initialData.title}</p>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "0 4px" }}>
          {errors.submit && (
            <div className="form-error-banner" style={{ marginBottom: 16 }}>⚠️ {errors.submit}</div>
          )}

          {/* ── Event Details ── */}
          <Section title="Event Details">
            <Field label="Event Title" error={errors.title}>
              <input className={`form-input ${errors.title ? "error" : ""}`} value={title}
                onChange={(e) => setTitle(e.target.value)} required />
            </Field>
            <Field label="Venue / Turf" error={errors.turf}>
              <select className={`form-select ${errors.turf ? "error" : ""}`} value={turf}
                onChange={(e) => setTurf(e.target.value)} required>
                <option value="">Choose a turf…</option>
                {turfs.map((t) => (
                  <option key={t._id} value={t._id}>{t.name} · {t.location?.city}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}
                disabled={!["draft", "open", "tentative"].includes(status)}
                title={!["draft", "open", "tentative"].includes(status) ? "Use the Confirm / Complete / Cancel action to change this" : undefined}>
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="tentative">Tentative</option>
                {!["draft", "open", "tentative"].includes(status) && (
                  <option value={status}>{status.charAt(0).toUpperCase() + status.slice(1)} (use its own action)</option>
                )}
              </select>
            </Field>
            <Field label="Registration approval">
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                  style={{ width: 17, height: 17, accentColor: "#c8ff3e", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#ddd" }}>Require my approval before players join</span>
              </label>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                {requiresApproval
                  ? "Players send a join request you approve or reject. Players you invite directly still skip approval."
                  : "Players join instantly (subject to available slots)."}
              </div>
              {initialData.requiresApproval && !requiresApproval && pendingRequestsCount > 0 && (
                <div style={{
                  marginTop: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                  background: "rgba(233,179,56,0.08)", border: "1px solid rgba(233,179,56,0.3)", color: "#e9b338",
                }}>
                  ⚠️ Turning approval off will auto-approve your {pendingRequestsCount} pending request{pendingRequestsCount !== 1 ? "s" : ""} in order — filling open slots and charging each their fee. Any that don&apos;t fit stay pending.
                </div>
              )}
            </Field>
          </Section>

          {/* ── Schedule ── */}
          <Section title="Schedule">
            {!timeEditable && (
              <div style={{ fontSize: 11, color: "#e9b338", marginBottom: 4 }}>
                🔒 This game is {initialData.status} — its date &amp; start time can no longer be edited.
              </div>
            )}
            <div className="form-row">
              <Field label={timeEditable ? "Date" : "Date 🔒"} error={errors.date}>
                <input type="date" className={`form-input ${errors.date ? "error" : ""}`} value={date}
                  disabled={!timeEditable} min={todayStr}
                  onChange={(e) => { scheduleTouched.current = true; setDate(e.target.value); }}
                  title={timeEditable ? undefined : `The date of a ${initialData.status} game can't be edited.`} />
              </Field>
              <Field label={timeEditable ? "Game Start Time" : "Game Start Time 🔒"}>
                <select className="form-select" value={time} disabled={!timeEditable}
                  onChange={(e) => { scheduleTouched.current = true; setTime(e.target.value); }}
                  title={timeEditable ? undefined : `The start time of a ${initialData.status} game can't be edited.`}>
                  {timeOptionsFor(time).map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            {timeEditable && timeChanged && (
              <div style={{
                padding: "9px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: "rgba(233,179,56,0.08)", border: "1px solid rgba(233,179,56,0.3)", color: "#e9b338",
              }}>
                ⚠️ Changing the time notifies {notifyCount === 0
                  ? "everyone registered & the waitlist"
                  : `all ${notifyCount} ${notifyCount === 1 ? "person" : "people"} registered & waitlisted`} on WhatsApp.
                <div style={{ marginTop: 6, color: "#aaa" }}>
                  <span style={{ textDecoration: "line-through", color: "#777" }}>{prettyIst(initialData.scheduledAt)}</span>
                  <span style={{ margin: "0 6px" }}>→</span>
                  <span style={{ color: "#c8ff3e", fontWeight: 700 }}>{prettyIst(scheduledIso)}</span>
                </div>
              </div>
            )}
            {errors.checks && (
              <div style={{
                padding: "9px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", color: "#f87171",
              }}>
                ⚠️ {errors.checks}
              </div>
            )}
            <div className="form-row">
              <Field label="Duration (mins)">
                <input type="number" className="form-input" min="15" step="15" value={durationMins}
                  onChange={(e) => setDurationMins(Number(e.target.value))} />
              </Field>
              <Field label="Players Report (mins before)">
                <select className="form-select" value={String(reportingMins)}
                  onChange={(e) => setReportingMins(Number(e.target.value))}>
                  {[15, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>{m} mins before kickoff</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          {/* ── Game Configuration ── */}
          <Section title="Game Configuration">
            <div style={{ fontSize: 11, color: "#e9b338", marginBottom: 4 }}>
              🔒 The format &amp; fee are fixed at creation and can&apos;t be edited. To change a confirmed game&apos;s format, use the <b>Switch</b> action.
            </div>
            <div className="form-row">
              <Field label="Format 🔒">
                <select className="form-select" value={format} disabled
                  onChange={(e) => handleFormatChange(e.target.value as Format)}
                  title="The format is fixed at creation. Use the Switch action to move to the alternate format.">
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>{f} ({slotsFromFormat(f)} players)</option>
                  ))}
                </select>
              </Field>
              <Field label="Fee per Player (₹) 🔒">
                <input type="number" className="form-input" min="0" step="1" value={feeInRs} disabled
                  onChange={(e) => setFeeInRs(Number(e.target.value))} required title="The fee is fixed at creation and can't be edited." />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Max Players Allowed (cap)">
                <input type="number" className="form-input" min={minPlayers || 2} value={totalSlots}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val < minPlayers) setMinPlayers(val);
                    setTotalSlots(val);
                  }} />
              </Field>
              <Field label="Min Players to Confirm" error={errors.minMax}>
                <input type="number" className="form-input" min="2" max={totalSlots} value={minPlayers} disabled={status === "confirmed"}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setMinPlayers(val > totalSlots ? totalSlots : val);
                  }} />
              </Field>
            </div>
          </Section>

          {/* ── Format Change — shown ONLY when an alternate format was defined at
                game creation. If none was set up, there's nothing to switch to, so
                the whole section is hidden (a new alternate can't be added via edit). ── */}
          {hadAlternate && (
          <Section
            title="Format Change"
            collapsible
            defaultOpen={allowSizeChange}
            forceOpen={!!errors.alt}
            summary={allowSizeChange ? `${altFormat} · ₹${altFee || "—"}` : "Off"}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={allowSizeChange} onChange={(e) => setAllowSizeChange(e.target.checked)}
                style={{ width: 17, height: 17, accentColor: "#c8ff3e", flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: "#ddd" }}>Allow switch to a smaller / cheaper alternate format</span>
            </label>
            {allowSizeChange && (
              <>
                {hadAlternate && (
                  <div style={{ fontSize: 11, color: "#e9b338", marginBottom: 2 }}>
                    🔒 The alternate format &amp; fee are fixed at creation. You can still adjust the alt turf, min and max.
                  </div>
                )}
                <div className="form-row">
                  <Field label={hadAlternate ? "Alt. format 🔒" : "Alt. format"}>
                    <select className="form-select" value={altFormat} disabled={hadAlternate}
                      onChange={(e) => setAltFormat(e.target.value as Format)}
                      title={hadAlternate ? "The alternate format is fixed at creation." : undefined}>
                      {FORMATS.map((f) => <option key={f} value={f}>{f} ({slotsFromFormat(f)})</option>)}
                    </select>
                  </Field>
                  <Field label="Alt. turf">
                    <select className="form-select" value={altTurf || turf}
                      onChange={(e) => setAltTurf(e.target.value)}>
                      {turfs.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="form-row">
                  <Field label={`Alt. min (< main min ${minPlayers})`}>
                    <input type="number" className="form-input" min={2} value={altMin}
                      onChange={(e) => setAltMin(e.target.value)} placeholder={String(Math.ceil(slotsFromFormat(altFormat) / 2))} />
                  </Field>
                  <Field label="Alt. max">
                    <input type="number" className="form-input" min={slotsFromFormat(altFormat)} value={altMax}
                      onChange={(e) => setAltMax(e.target.value)} placeholder={String(slotsFromFormat(altFormat))} />
                  </Field>
                </div>
                <Field label={hadAlternate ? "Alt. fee (₹) 🔒 — set at creation, can't be edited" : "Alt. fee (₹) — must be less than the main fee"} error={errors.alt}>
                  <input type="number" className="form-input" min="0" step="1" value={altFee} disabled={hadAlternate}
                    onChange={(e) => setAltFee(e.target.value)} placeholder={hadAlternate ? undefined : (feeInRs ? `< ${feeInRs}` : "0")}
                    title={hadAlternate ? "The alternate-format fee is fixed at creation and can't be edited." : undefined} />
                </Field>
                <div style={{ fontSize: 11, color: "#666" }}>
                  On switch, players are refunded the per-player fee difference automatically.
                </div>
              </>
            )}
          </Section>
          )}

          {/* ── Confirmation Check-in (3.1) ──
              Only the 2nd check-in is exposed, and only while it is still pending:
              it is the decision point, and it is the one that constrains how far
              back the kickoff can move. The 1st check-in follows the kickoff
              automatically. Once the 2nd check has run there is nothing left to
              change, so the section states that instead. */}
          {initialData.lifecycle?.secondCheckAt && (
            <Section title="Confirmation Check-in">
              {secondCheckDone ? (
                <div style={{ fontSize: 12, color: "#888" }}>
                  ✓ 2nd check-in completed ({prettyIst(initialData.lifecycle.secondCheckAt)}) — only the start time can change now.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>
                    The game&apos;s fate is decided here — it must stay before kickoff. It follows the start time automatically unless you set it yourself.
                  </div>
                  <div className="form-row">
                    <Field label="2nd check-in date">
                      <input type="date" className={`form-input ${errors.checks ? "error" : ""}`}
                        value={secondCheckDate} min={todayStr}
                        onChange={(e) => { checkTimesEdited.current = true; setSecondCheckDate(e.target.value); }} />
                    </Field>
                    <Field label="2nd check-in time">
                      <select className={`form-select ${errors.checks ? "error" : ""}`} value={secondCheckTime}
                        onChange={(e) => { checkTimesEdited.current = true; setSecondCheckTime(e.target.value); }}>
                        {timeOptionsFor(secondCheckTime).map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div style={{ fontSize: 11, color: "#666" }}>
                    {automationEnabled
                      ? `Automation is ON — the system will decide at ${prettyIst(secondCheckIso)}.`
                      : `Automation is OFF — you'll be asked to decide at ${prettyIst(secondCheckIso)}.`}
                  </div>
                </>
              )}
            </Section>
          )}

          {/* ── Your Participation (real-time) ── */}
          <Section title="Your Participation">

            {/* Inline action feedback */}
            {actionMsg && (
              <div style={{
                padding: "8px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: actionMsg.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(220,38,38,0.1)",
                border: `1px solid ${actionMsg.type === "success" ? "rgba(74,222,128,0.3)" : "rgba(220,38,38,0.3)"}`,
                color: actionMsg.type === "success" ? "#4ade80" : "#f87171",
              }}>
                {actionMsg.type === "success" ? "✓" : "⚠️"} {actionMsg.text}
              </div>
            )}

            {/* Confirmation bar for join/leave */}
            {pending && (pending.type === "join" || pending.type === "leave") && (
              <ConfirmBar action={pending} />
            )}

            {/* Toggle */}
            {!(pending?.type === "join" || pending?.type === "leave") && (
              <label style={{
                display: "flex", alignItems: "center", gap: 10,
                cursor: (actionLoading || (!organiserPlaying && openSlots === 0)) ? "not-allowed" : "pointer",
                opacity: (actionLoading || (!organiserPlaying && openSlots === 0)) ? 0.55 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={organiserPlaying}
                  disabled={actionLoading || (!organiserPlaying && openSlots === 0)}
                  onChange={(e) => setPending({ type: e.target.checked ? "join" : "leave" })}
                  style={{ width: 17, height: 17, accentColor: "#c8ff3e", flexShrink: 0 }}
                />
                <span style={{ fontSize: 14, color: "#ddd" }}>
                  I want to play in this game{organiserPlaying ? " ✓" : " (uses 1 slot)"}
                </span>
              </label>
            )}

            {!organiserPlaying && openSlots === 0 && !(pending?.type === "join") && (
              <p style={{ margin: "4px 0 0 27px", fontSize: 11, color: "#f87171" }}>
                Game is full — no slot available.
              </p>
            )}

            {/* Capacity bar */}
            <div style={{
              marginTop: 10,
              background: filled > hardCap ? "rgba(251,146,60,0.08)" : openSlots === 0 ? "rgba(220,38,38,0.08)" : "rgba(200,255,62,0.06)",
              border: `1px solid ${filled > hardCap ? "rgba(251,146,60,0.4)" : openSlots === 0 ? "rgba(220,38,38,0.3)" : "rgba(200,255,62,0.2)"}`,
              borderRadius: 8, padding: "9px 13px", fontSize: 12,
              color: filled > hardCap ? "#fb923c" : openSlots === 0 ? "#f87171" : "#c8ff3e",
              fontWeight: 600,
            }}>
              {filled > hardCap
                ? `⚠️ Over capacity — ${filled} of ${hardCap} filled`
                : openSlots === 0
                  ? "⚠️ All slots filled"
                  : `✓ ${openSlots} open slot${openSlots !== 1 ? "s" : ""} remaining`}
              <span style={{ color: "#555", fontWeight: 400, marginLeft: 8 }}>
                cap {hardCap} · filled {filled}
              </span>
            </div>
          </Section>

          {/* ── Your Guests (real-time) ── */}
          <Section title="Your Guests">

            {/* Confirmation bar for remove */}
            {pending?.type === "remove-guest" && (
              <ConfirmBar action={pending} />
            )}

            {guests.length === 0 && (
              <p style={{ fontSize: 12, color: "#666", margin: 0 }}>No guests added yet.</p>
            )}

            {guests.map((g, idx) => {
              const isRemoving = removingId === g._id;
              const posLabel = g.preferredPosition && g.preferredPosition !== "any"
                ? POSITION_LABELS[g.preferredPosition] ?? g.preferredPosition.toUpperCase() : null;
              const teamLabel = g.teamPreference ? TEAM_LABELS[g.teamPreference] : null;
              return (
                <div key={g._id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "rgba(200,255,62,0.04)", border: "1px solid #2a2a2a",
                  borderRadius: 8, padding: "10px 12px",
                  opacity: isRemoving ? 0.45 : 1, transition: "opacity 0.15s",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#ddd", fontWeight: 500 }}>
                      <span style={{ color: "#c8ff3e", fontWeight: 700, marginRight: 8 }}>#{idx + 1}</span>
                      {g.plusOneName}
                    </div>
                    {(posLabel || teamLabel) ? (
                      <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" as const }}>
                        {posLabel && (
                          <span style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700,
                            background: "rgba(147,197,253,0.12)", color: "#93c5fd", border: "1px solid rgba(147,197,253,0.25)"
                          }}>
                            {posLabel}
                          </span>
                        )}
                        {teamLabel && (
                          <span style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700,
                            background: g.teamPreference === "red" ? "rgba(231,76,60,0.12)" : "rgba(52,152,219,0.12)",
                            color: g.teamPreference === "red" ? "#ff6b6b" : "#74b9ff",
                            border: `1px solid ${g.teamPreference === "red" ? "rgba(231,76,60,0.3)" : "rgba(52,152,219,0.3)"}`
                          }}>
                            {teamLabel}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>No preferences set</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPending({ type: "remove-guest", guest: g })}
                    disabled={isRemoving || !!removingId || guestLoading || actionLoading || pending?.type === "remove-guest"}
                    style={{
                      background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)",
                      color: "#f87171", borderRadius: 6, padding: "5px 12px", fontSize: 12,
                      cursor: (isRemoving || !!removingId || guestLoading || actionLoading || pending?.type === "remove-guest")
                        ? "not-allowed" : "pointer",
                      minWidth: 68, flexShrink: 0,
                    }}
                  >
                    {isRemoving ? "…" : "Remove"}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => { setPrefName(""); setPrefPosition("Any"); setPrefTeam("No Preference"); setPrefOpen(true); }}
              disabled={guestLoading || !!removingId || actionLoading || openSlots === 0}
              title={openSlots === 0 ? "No open slots remaining" : "Add a guest"}
              style={{
                marginTop: 4, width: "100%", padding: "9px 0",
                background: openSlots === 0 ? "rgba(255,255,255,0.02)" : "rgba(200,255,62,0.06)",
                border: `1px dashed ${openSlots === 0 ? "rgba(255,255,255,0.1)" : "rgba(200,255,62,0.3)"}`,
                borderRadius: 8,
                color: openSlots === 0 ? "#444" : "#c8ff3e",
                fontSize: 13, fontWeight: 600,
                cursor: (guestLoading || !!removingId || actionLoading || openSlots === 0) ? "not-allowed" : "pointer",
                opacity: (guestLoading || !!removingId || actionLoading) ? 0.5 : 1,
              }}
            >
              {guestLoading ? "Adding…" : openSlots === 0 ? "No open slots remaining" : "+ Add Guest"}
            </button>
          </Section>



          {/* Moving the kickoff is the one edit here that reaches out to other
              people, so it gets a summary to confirm before the request fires. */}
          {pendingSave && (
            <div style={{
              marginTop: 20, padding: "12px 14px",
              background: "rgba(233,179,56,0.07)", border: "1px solid rgba(233,179,56,0.3)",
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 13, color: "#ddd", marginBottom: 10, lineHeight: 1.5 }}>
                Move <b>{initialData.title}</b> from{" "}
                <span style={{ textDecoration: "line-through", color: "#888" }}>{prettyIst(initialData.scheduledAt)}</span>{" "}
                to <b style={{ color: "#c8ff3e" }}>{prettyIst(scheduledIso)}</b>
                {notifyCount > 0
                  ? <> and notify {notifyCount} {notifyCount === 1 ? "person" : "people"}?</>
                  : <>?</>}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setPendingSave(false)} disabled={loading}
                  style={{ padding: "6px 14px", borderRadius: 6, background: "transparent", border: "1px solid #444", color: "#888", fontSize: 12, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="button" onClick={() => handleSubmit(null, true)} disabled={loading}
                  style={{ padding: "6px 16px", borderRadius: 6, background: "#e9b338", color: "#000", fontWeight: 700, fontSize: 12, border: "none", cursor: "pointer" }}>
                  {loading ? "Saving…" : "Move & notify"}
                </button>
              </div>
            </div>
          )}

          <div className="form-actions" style={{ marginTop: 24 }}>
            <button type="button" className="btn-cancel" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-save" disabled={loading || pendingSave}>
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
      {/* ── Guest Preferences Mini-Modal ── */}
      {prefOpen && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16
          }}
          onClick={() => setPrefOpen(false)}
        >
          <div
            style={{
              background: "#0f0f1e", border: "1px solid #333", borderRadius: 12,
              padding: "24px 20px", width: "100%", maxWidth: 360
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: "#c8ff3e", margin: "0 0 4px", fontSize: 17 }}>Add Guest</h3>
            <p style={{ color: "#666", fontSize: 12, margin: "0 0 20px" }}>
              Set guest name, position and team preference.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                color: "#aaa", fontSize: 11, display: "block", marginBottom: 6,
                textTransform: "uppercase" as const, letterSpacing: "0.08em"
              }}>
                Guest Name <span style={{ color: "#555", textTransform: "none" as const }}>(optional)</span>
              </label>
              <input type="text" value={prefName} onChange={(e) => setPrefName(e.target.value)}
                placeholder="e.g. Rahul" maxLength={40}
                style={{
                  width: "100%", background: "#1a1a2e", border: "1px solid #444", borderRadius: 7,
                  padding: "9px 12px", color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" as const
                }}
                onFocus={(e) => (e.target.style.borderColor = "#c8ff3e")}
                onBlur={(e) => (e.target.style.borderColor = "#444")}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                color: "#aaa", fontSize: 11, display: "block", marginBottom: 8,
                textTransform: "uppercase" as const, letterSpacing: "0.08em"
              }}>Position</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                {["Any", "GK", "DEF", "MID", "FWD"].map((pos) => (
                  <button key={pos} type="button" onClick={() => setPrefPosition(pos)} style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: prefPosition === pos ? "rgba(200,255,62,0.18)" : "rgba(255,255,255,0.04)",
                    color: prefPosition === pos ? "#c8ff3e" : "#888",
                    border: `1px solid ${prefPosition === pos ? "rgba(200,255,62,0.5)" : "rgba(255,255,255,0.08)"}`,
                  }}>{pos}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{
                color: "#aaa", fontSize: 11, display: "block", marginBottom: 8,
                textTransform: "uppercase" as const, letterSpacing: "0.08em"
              }}>Team</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                {["No Preference", "Red Team", "Blue Team"].map((t) => (
                  <button key={t} type="button" onClick={() => setPrefTeam(t)} style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: prefTeam === t
                      ? t === "Red Team" ? "rgba(220,38,38,0.18)" : t === "Blue Team" ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.04)",
                    color: prefTeam === t
                      ? t === "Red Team" ? "#f87171" : t === "Blue Team" ? "#60a5fa" : "#c8ff3e"
                      : "#888",
                    border: `1px solid ${prefTeam === t
                      ? t === "Red Team" ? "rgba(220,38,38,0.4)" : t === "Blue Team" ? "rgba(59,130,246,0.4)" : "rgba(200,255,62,0.4)"
                      : "rgba(255,255,255,0.08)"}`,
                  }}>{t === "No Preference" ? "No Pref" : t}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setPrefOpen(false)}
                style={{
                  flex: 1, padding: "10px", borderRadius: 7, background: "transparent",
                  border: "1px solid #444", color: "#888", fontSize: 14, cursor: "pointer"
                }}>
                Cancel
              </button>
              <button type="button" onClick={() => addGuest(prefName, prefPosition, prefTeam)}
                style={{
                  flex: 2, padding: "10px", borderRadius: 7, background: "#c8ff3e",
                  color: "#000", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer"
                }}>
                Add Guest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── tiny layout helpers ── */
const sectionLabel = (color: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color,
});

// A section is a flat titled group, or — when `collapsible` — a tidy box that
// folds away its fields and shows a one-line summary, so the form isn't a wall.
// `forceOpen` re-expands it (e.g. when one of its fields has a validation error).
function Section({
  title, children, collapsible = false, defaultOpen = true, summary, forceOpen = false,
}: {
  title: string; children: React.ReactNode;
  collapsible?: boolean; defaultOpen?: boolean; summary?: React.ReactNode; forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);

  if (!collapsible) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ ...sectionLabel("#666"), marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid #222" }}>
          {title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12, border: "1px solid #242424", borderRadius: 10, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <span style={sectionLabel(open ? "#c8ff3e" : "#999")}>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {!open && summary != null && (
            <span style={{ fontSize: 12, color: "#7a7a7a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{summary}</span>
          )}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s", flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && <div style={{ padding: "0 14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
    </div>
  );
}

function Field({ label, error, children }: { label: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div className="form-group" style={{ flex: 1 }}>
      <label className="form-label" style={{ marginBottom: 6, display: "block", fontSize: 12, color: "#aaa", fontWeight: 600 }}>{label}</label>
      {children}
      {error && <div className="field-error" style={{ marginTop: 4, fontSize: 11, color: "#f87171" }}>{error}</div>}
    </div>
  );
}
