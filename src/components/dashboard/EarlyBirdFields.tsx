"use client";

// Early-bird pricing — up to 3 cheaper prices for a game's first seats. The
// server (utils/seatPricing.js) is the authority and refuses a bad ladder on
// save; the hints here only catch the common slips as the organiser types.

export type EarlyBirdRow = { priceRs: string; seats: string; closesHoursBefore: string; sold?: number; held?: number };

type StoredTier = { pricePaise: number; seats: number; closesHoursBefore?: number | null; sold?: number; held?: number };

export const earlyBirdFromStored = (pricing?: { tiers?: StoredTier[] } | null): EarlyBirdRow[] =>
  (pricing?.tiers || []).map((t) => ({
    priceRs: String(t.pricePaise / 100),
    seats: String(t.seats),
    closesHoursBefore: t.closesHoursBefore == null ? "" : String(t.closesHoursBefore),
    sold: t.sold || 0,
    held: t.held || 0,
  }));

export const earlyBirdToPayload = (rows: EarlyBirdRow[]) => ({
  tiers: rows.map((r) => ({
    priceRs: Number(r.priceRs),
    seats: Number(r.seats),
    closesHoursBefore: r.closesHoursBefore === "" ? null : Number(r.closesHoursBefore),
  })),
});

const CLOSE_OPTIONS = [
  { value: "", label: "When sold out" },
  { value: "72", label: "3 days before" },
  { value: "48", label: "2 days before" },
  { value: "24", label: "1 day before" },
  { value: "12", label: "12 hrs before" },
];

const box =
  "bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl h-11 w-full px-3 text-white text-sm font-bold focus:outline-none focus:border-[#c4f042] disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none";
const label = "flex flex-col gap-1 text-[10px] font-bold text-[#888] uppercase tracking-widest";
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function rowHint(r: EarlyBirdRow, prev: EarlyBirdRow | undefined, feeRs: number): string | null {
  const p = Number(r.priceRs);
  if (r.priceRs === "" || r.seats === "") return null;
  if (p >= feeRs) return `Must be below the fee (${rs(feeRs)}).`;
  if (p < Math.ceil(feeRs / 2)) return `Can't go below ${rs(Math.ceil(feeRs / 2))} (half the fee).`;
  if (prev && prev.priceRs !== "" && p <= Number(prev.priceRs)) return "Each tier must cost more than the one before.";
  if (Number(r.seats) < 1) return "At least 1 seat.";
  return null;
}

export function EarlyBirdFields({
  value,
  onChange,
  feeRs,
  totalSlots = 0,
}: {
  value: EarlyBirdRow[];
  onChange: (rows: EarlyBirdRow[]) => void;
  feeRs: number;
  totalSlots?: number;
}) {
  const set = (i: number, patch: Partial<EarlyBirdRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (feeRs <= 0) return <p className="text-xs text-[#888]">Set a game fee to offer early-bird prices.</p>;

  // A sensible next tier: halfway between the last price and the fee, a quarter of the seats.
  const addTier = () => {
    const last = value[value.length - 1];
    const lastPrice = last && last.priceRs !== "" ? Number(last.priceRs) : Math.round(feeRs * 0.6);
    const price = Math.min(feeRs - 10, Math.round((lastPrice + feeRs) / 2 / 10) * 10);
    onChange([...value, { priceRs: String(price), seats: String(Math.max(1, Math.round(totalSlots / 4))), closesHoursBefore: "" }]);
  };

  const filled = value.filter((r) => r.priceRs !== "" && Number(r.seats) > 0);
  const earlySeats = filled.reduce((n, r) => n + Number(r.seats), 0);
  const earlyGross = filled.reduce((n, r) => n + Number(r.priceRs) * Number(r.seats), 0);
  const restSeats = Math.max(0, totalSlots - earlySeats);

  if (value.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-[#888]">Reward players who book early — the first seats sell cheaper, then the price rises.</p>
        <button
          type="button"
          onClick={addTier}
          className="self-start h-10 px-4 rounded-xl border border-[#c4f042] text-[#c4f042] text-xs font-bold uppercase tracking-widest hover:bg-[#c4f042] hover:text-[#0f0f0f] transition-colors"
        >
          + Add early-bird pricing
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((r, i) => {
        const locked = (r.sold || 0) + (r.held || 0) > 0;
        const hint = rowHint(r, value[i - 1], feeRs);
        return (
          <div key={i} className="rounded-xl border border-[#2a2a2a] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span>Tier {i + 1}{locked && <span className="text-[#888] font-normal"> · {r.sold || 0} sold · {r.held || 0} held — price locked</span>}</span>
              {!locked && (
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-[#888] hover:text-[#f87171]">
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className={label}>
                Price ₹
                <input type="number" inputMode="numeric" min={1} className={box} value={r.priceRs} disabled={locked} onChange={(e) => set(i, { priceRs: e.target.value })} />
              </label>
              <label className={label}>
                Seats
                <input type="number" inputMode="numeric" min={1} className={box} value={r.seats} onChange={(e) => set(i, { seats: e.target.value })} />
              </label>
              <label className={label}>
                Ends
                <select className={box} value={r.closesHoursBefore} onChange={(e) => set(i, { closesHoursBefore: e.target.value })}>
                  {CLOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {!CLOSE_OPTIONS.some((o) => o.value === r.closesHoursBefore) && (
                    <option value={r.closesHoursBefore}>{r.closesHoursBefore} hrs before</option>
                  )}
                </select>
              </label>
            </div>
            {hint && <span className="text-[11px] text-[#f87171]">{hint}</span>}
          </div>
        );
      })}

      {value.length < 3 && (
        <button type="button" onClick={addTier} className="self-start text-xs font-bold text-[#c4f042] uppercase tracking-widest">
          + Add another tier
        </button>
      )}

      {filled.length > 0 && (
        <div className="rounded-xl bg-[#c4f042]/10 border border-[#c4f042]/30 p-3 text-xs text-white flex flex-col gap-1">
          <span>
            <span className="font-bold text-[#c4f042]">Players see: </span>
            {filled.map((r) => `${r.seats} seats at ${rs(Number(r.priceRs))}`).join(" → ")} → then {rs(feeRs)}
          </span>
          {totalSlots > 0 && (
            <span className="text-[#888]">
              If every early seat sells: {rs(earlyGross + restSeats * feeRs)} instead of {rs(totalSlots * feeRs)}. Guests always pay {rs(feeRs)}.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
