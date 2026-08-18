"use client";

import React, { useState } from "react";
import "./StarRating.css";

export type StarValue = number | null;

/**
 * A 1-5 star selector with a third state: NA.
 *
 * `null` means no organiser has recorded an opinion — which is not the same as a
 * low score, and the backend stores it as null rather than a number for exactly
 * that reason. Clicking the currently selected star clears back to NA, so an
 * organiser can withdraw a rating they no longer stand behind.
 *
 * `0` is accepted on the way in and treated as NA, because the post-game modal
 * has always used 0 for "untouched row".
 */
export function StarRating({
  value,
  onChange,
  label,
  size = "normal",
  disabled = false,
}: {
  value: StarValue;
  onChange: (v: StarValue) => void;
  label?: string;
  size?: "normal" | "mini";
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  const current = value == null || value === 0 ? 0 : value;

  return (
    <div className={`pgm-star-row ${size === "mini" ? "pgm-star-row-mini" : ""}`}>
      {label && <span className="pgm-star-label">{label}</span>}
      <div className="pgm-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            className={`pgm-star ${size === "mini" ? "pgm-star-mini" : ""} ${n <= (hovered || current) ? "filled" : ""}`}
            onMouseEnter={() => !disabled && setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(current === n ? null : n)}
            title={current === n ? "Clear rating" : `${n} Stars`}
          >
            ★
          </button>
        ))}
        {size !== "mini" && (
          current > 0
            ? <span className="pgm-star-value">{current}/5</span>
            : <span className="pgm-star-value pgm-star-na">NA</span>
        )}
      </div>
    </div>
  );
}

export default StarRating;
