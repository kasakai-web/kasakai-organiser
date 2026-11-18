"use client";

// The create form's "Test timings" tab — TEST server only (Test_Speedups_Plan.md).
// CreateEventForm renders it only when GET /test-tools/status answered, which
// the production backend never does.
//
// One place for every time a test game needs, as MINUTES FROM NOW: kick-off,
// both check-ins, reporting, length, and the four waits that are fixed in
// production (last call, reminder, auto-complete, video). The first five fill
// the form's own fields, so there is one copy of each time; the waits travel
// with the game as `testTimings`.

import type { ReactNode } from "react";
import {
  PLAN_FIELDS,
  clock,
  timelineFrom,
  timesProblems,
  timingsOf,
  type GameTimes,
  type TestFlag,
  type TestSettings,
} from "@/utils/testTools";

type Props = {
  plan: TestSettings;
  onPlanChange: (next: TestSettings) => void;
  /** Use test timings for this game at all. */
  on: boolean;
  onToggle: (on: boolean) => void;
  /** Re-count the times from the moment Create is pressed. */
  anchor: boolean;
  onAnchorChange: (anchor: boolean) => void;
  /** Write the plan into the form's date/time fields now. */
  onApplyNow: () => void;
  /** The times as the form holds them right now (for the preview). */
  times: GameTimes;
  now: Date;
  flags: TestFlag[];
  testCode?: string;
};

// The form's own reporting / duration fields are what the tab edits for those two.
const FORM_KEYS = new Set(["reportingMins", "durationMins"]);

const box = "bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3 text-white w-full text-sm font-bold focus:outline-none focus:border-[#444]";

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest mb-1.5 block">{label}</span>
      {children}
      <span className="text-[#666] text-[11px] font-medium mt-1 block">{hint}</span>
    </label>
  );
}

export function TestTimingsTab({
  plan, onPlanChange, on, onToggle, anchor, onAnchorChange, onApplyNow, times, now, flags, testCode,
}: Props) {
  const waits = timingsOf(plan);
  const rows = timelineFrom(times, waits);
  const { errors, warnings } = timesProblems(times, waits, now);
  const offFlags = flags.filter((f) => !f.on);

  const setField = (key: keyof TestSettings, raw: string) => {
    const n = raw === "" ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
    onPlanChange({ ...plan, [key]: n });
  };

  return (
    <div>
      <div className="bg-[#1d1a10] border border-[#3d3320] rounded-xl p-4 mb-6">
        <p className="text-[#e7dcb8] text-sm leading-relaxed">
          <span className="font-bold text-white">Test server only.</span> Set every time for this game in minutes from
          now. The waits below are fixed in production (last call 60 min, reminder 30 min, auto-complete 30 min, video
          2 h); a game made with this tab runs on these instead. Production never shows this tab.
        </p>
        {testCode && (
          <p className="text-[#bfb48f] text-xs mt-2">
            Test players (names ending in &quot;D&quot;) sign in on the player app with the code <strong className="text-white">{testCode}</strong>.
          </p>
        )}
      </div>

      {offFlags.length > 0 && (
        <div className="bg-[#2a1515] border border-[#4a2020] rounded-xl p-4 mb-6">
          <p className="text-[#f2b8b8] text-sm leading-relaxed">
            <span className="font-bold text-white">Switched off on this server:</span>{" "}
            {offFlags.map((f) => f.name).join(", ")}. Those steps only log a DRY-RUN line, so a test of them will not do anything.
          </p>
        </div>
      )}

      <label className="flex items-center gap-3 mb-6 cursor-pointer">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="w-5 h-5 accent-[#c4f042]" />
        <span className="text-white font-bold text-sm">Use test timings for this game</span>
      </label>

      {on && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            {PLAN_FIELDS.map((f) => (
              <Row key={f.key} label={f.label} hint={FORM_KEYS.has(f.key) ? `${f.hint} (the form's own field)` : f.hint}>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={1}
                  className={box}
                  value={String(plan[f.key])}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </Row>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-6">
            <button
              type="button"
              onClick={onApplyNow}
              className="bg-[#c4f042] text-[#0f0f0f] px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#d5ff55] transition-colors"
            >
              Fill the times from now
            </button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anchor} onChange={(e) => onAnchorChange(e.target.checked)} className="w-4 h-4 accent-[#c4f042]" />
              <span className="text-[#ccc] text-sm">Count the minutes from when I press Create</span>
            </label>
          </div>
          <p className="text-[#666] text-xs mb-6 -mt-3">
            {anchor
              ? "On: the times keep moving forward while you fill in the rest of the form, and are counted again the moment you press Create — so check-in 1 can never be in the past."
              : "Off: the game is created with the times exactly as they are in the form. Editing a time by hand turns this off."}
          </p>

          <div className="bg-[#151515] border border-[#252525] rounded-xl p-4">
            <p className="text-[10px] md:text-xs font-bold text-[#888] uppercase tracking-[0.2em] mb-3">Timeline</p>
            {rows.length === 0 ? (
              <p className="text-[#666] text-sm">Pick a date and times first.</p>
            ) : (
              <ol className="flex flex-wrap gap-x-2 gap-y-2 items-center">
                {rows.map((r, i) => (
                  <li key={r.key} className="flex items-center gap-2 text-sm">
                    <span className="bg-[#222] rounded-lg px-2.5 py-1">
                      <span className="text-[#888]">{r.label}</span>{" "}
                      <strong className="text-white">{clock(r.at)}</strong>
                    </span>
                    {i < rows.length - 1 && <span className="text-[#555]">→</span>}
                  </li>
                ))}
              </ol>
            )}
            {errors.map((e) => (
              <p key={e} className="text-[#ff5a5f] text-xs font-bold mt-3">{e}</p>
            ))}
            {warnings.map((w) => (
              <p key={w} className="text-[#f0b429] text-xs font-bold mt-3">⚠️ {w}</p>
            ))}
            <p className="text-[#555] text-[11px] mt-3">
              The video WhatsApp only goes out once the game has its match video link saved.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
