"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/hooks/useBackToClose";
import "./playerLists.css";

// The one container every Player Lists dialog uses: a bottom sheet on a phone, a
// centred panel on a desktop. Back (hardware or gesture) and Escape close the TOP
// sheet only, so a tag editor opened from a picker closes back to the picker.

const stack: number[] = [];
let nextId = 1;

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  headerRight,
  footer,
  children,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => setMounted(true), []);

  useBackToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    const id = nextId++;
    idRef.current = id;
    stack.push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="pl-sheet-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        className={`pl-sheet ${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pl-sheet-head">
          <span className="pl-sheet-grab" aria-hidden />
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headerRight}
          <button type="button" className="pl-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pl-sheet-body">{children}</div>
        {footer && <div className="pl-sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
