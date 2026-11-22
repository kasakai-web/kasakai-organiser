"use client";

import { useState } from "react";
import { resolveImageUrl } from "@/utils/api";

export function Avatar({ name, img, contact = false, size }: { name: string; img?: string | null; contact?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = img ? resolveImageUrl(img) : "";
  const style = size ? { width: size, height: size, fontSize: Math.max(10, Math.round(size / 3)) } : undefined;
  return (
    <span className={`pl-avatar${contact ? " contact" : ""}`} style={style} aria-hidden>
      {src && !failed
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : contact ? "☎" : (name || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
