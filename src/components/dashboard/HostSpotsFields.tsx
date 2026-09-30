"use client";

// Host spots — the one form block every game form uses (create, edit, template,
// recurring series), so an organiser sets them up the same way wherever a game
// is made.
//
// A host spot is a seat held for this organiser's approved hosts — players who
// run the game on the ground — at a discount. Nobody else can book it until the
// release time the organiser picks, after which an unbooked one is an ordinary
// open spot. The preview line is computed with the same arithmetic the backend
// charges (utils/hosts.ts), so it never promises a price the booking won't match.

import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import {
  RELEASE_OPTIONS,
  describeHostSlots,
  hostSlotsError,
  type HostSlotsForm,
} from "@/utils/hosts";

interface HostSpotsFieldsProps {
  value: HostSlotsForm;
  onChange: (next: HostSlotsForm) => void;
  feeRs: number;
  totalSlots: number;
  organiserIsPlaying?: boolean;
  /** How many approved hosts this organiser has; null while unknown. */
  approvedHosts?: number | null;
  /** Host spots already booked on this game — the count can't drop below them. */
  minCount?: number;
  /** Where "recommend hosts" points — the organiser's Hosts page. */
  hostsHref?: string;
}

export function HostSpotsFields({
  value,
  onChange,
  feeRs,
  totalSlots,
  organiserIsPlaying = false,
  approvedHosts = null,
  minCount = 0,
  hostsHref,
}: HostSpotsFieldsProps) {
  const seats = Math.max(0, (Number(totalSlots) || 0) - (organiserIsPlaying ? 1 : 0));
  const patch = (p: Partial<HostSlotsForm>) => onChange({ ...value, ...p });
  const setCount = (n: number) => patch({ count: Math.max(minCount, Math.min(seats, n)) });
  const error = hostSlotsError(value, { feeRs, totalSlots, organiserIsPlaying });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[#888] leading-relaxed">
        Hold spots for your approved hosts — players who run the game for you on the day (check-in,
        teams, wrap-up). They book them at your discount; nobody else can until the release time.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl h-11 px-2">
          <button
            type="button"
            aria-label="Fewer host spots"
            onClick={() => setCount(value.count - 1)}
            disabled={value.count <= minCount}
            className="w-9 h-9 flex items-center justify-center text-[#666] hover:text-white disabled:opacity-30"
          >
            <Minus size={18} strokeWidth={2.5} />
          </button>
          <span className="w-10 text-center text-white font-bold text-sm">{value.count}</span>
          <button
            type="button"
            aria-label="More host spots"
            onClick={() => setCount(value.count + 1)}
            disabled={value.count >= seats}
            className="w-9 h-9 flex items-center justify-center text-[#666] hover:text-white disabled:opacity-30"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        </div>
        <span className="text-sm text-white">
          host spot{value.count === 1 ? "" : "s"}
          {minCount > 0 && <span className="text-[#888]"> · {minCount} already booked</span>}
        </span>
      </div>

      {value.count > 0 && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">Host discount</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl border border-[#2a2a2a] overflow-hidden" role="radiogroup" aria-label="Discount type">
                {(["flat", "percent"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={value.discountMode === mode}
                    onClick={() => patch({ discountMode: mode })}
                    className={`px-4 h-11 text-xs font-bold uppercase tracking-widest transition-colors ${
                      value.discountMode === mode ? "bg-[#c4f042] text-[#0f0f0f]" : "bg-[#1a1a1a] text-[#888] hover:text-white"
                    }`}
                  >
                    {mode === "flat" ? "₹ off" : "% off"}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={value.discountMode === "percent" ? 100 : undefined}
                  step={1}
                  value={value.discountValue}
                  placeholder="0"
                  onChange={(e) => patch({ discountValue: e.target.value })}
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl h-11 w-32 pl-4 pr-9 text-white text-sm font-bold focus:outline-none focus:border-[#444] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#888] text-sm font-bold">
                  {value.discountMode === "flat" ? "₹" : "%"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">
              If no host books them
            </span>
            <select
              value={value.releaseMins == null ? "" : String(value.releaseMins)}
              onChange={(e) => patch({ releaseMins: e.target.value === "" ? null : Number(e.target.value) })}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl h-11 px-4 text-white text-sm font-bold focus:outline-none focus:border-[#444] [&>option]:bg-[#111]"
            >
              {RELEASE_OPTIONS.map((o) => (
                <option key={o.label} value={o.value == null ? "" : String(o.value)}>
                  {o.value == null ? o.label : `Open them to everyone ${o.label}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#666] leading-relaxed">
              When they open, anyone on the waitlist is told. A host can still take one at the host price
              while it&apos;s free.
            </p>
          </div>

          <div className="rounded-xl border border-[rgba(196,240,66,0.25)] bg-[rgba(196,240,66,0.06)] px-4 py-3 text-xs font-semibold text-[#c4f042] leading-relaxed">
            {describeHostSlots(value, { feeRs, totalSlots })}
          </div>

          {approvedHosts === 0 && (
            <p className="text-xs text-[#e9b338] leading-relaxed">
              You don&apos;t have any approved hosts yet, so nobody can book these until you do.{" "}
              {hostsHref ? (
                <Link href={hostsHref} className="underline">Recommend a host</Link>
              ) : (
                "Recommend one from the Hosts page"
              )}{" "}
              — KasaKai approves them.
            </p>
          )}
        </>
      )}

      {error && <p className="text-[#ff5a5f] text-xs font-bold leading-relaxed">{error}</p>}
    </div>
  );
}
