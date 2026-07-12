"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

type ConfirmationModalProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmationModal({
  open,
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loading, onCancel, open]);

  if (!open) return null;

  const modal = (
    <div
      role="presentation"
      onClick={() => {
        if (!loading) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(100%, 460px)",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "linear-gradient(180deg, #16161c 0%, #111115 100%)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
          color: "#f4f4f5",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "22px 22px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              marginBottom: 12,
              background: "rgba(255,255,255,0.06)",
              color: "#d4d4d8",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
            }}
          >
            Confirmation
          </div>
          <h3 id="confirmation-modal-title" style={{ margin: 0, fontSize: 20, lineHeight: 1.2 }}>
            {title}
          </h3>
        </div>

        <div style={{ padding: "18px 22px 22px" }}>
          <p style={{ margin: 0, color: "#c9c9cf", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {message}
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              style={{
                minWidth: 110,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: loading ? "#80808a" : "#ececf0",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              style={{
                minWidth: 110,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(200,213,108,0.32)",
                background: loading
                  ? "rgba(200,213,108,0.18)"
                  : "linear-gradient(135deg, rgba(200,213,108,0.96) 0%, rgba(169,190,57,0.96) 100%)",
                color: "#111111",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 800,
                boxShadow: "0 10px 24px rgba(200,213,108,0.18)",
              }}
            >
              {loading ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
