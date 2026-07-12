"use client";

import React, { useState } from "react";

interface NavBtnProps {
  onClick: () => void;
  text: string;
}

export function NavBtn({ onClick, text }: NavBtnProps) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 18px",
        background: hov ? "rgba(200,255,62,0.07)" : "transparent",
        border: `1.5px solid ${hov ? "rgba(200,255,62,0.65)" : "rgba(200,255,62,0.35)"}`,
        borderRadius: 8,
        color: "#c8ff3e",
        fontSize: 12,
        fontFamily: "inherit",
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase" as const,
        cursor: "pointer",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
    >
      {text}
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </button>
  );
}
