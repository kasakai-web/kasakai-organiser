"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ToastType = "success" | "error";

export interface ToastState {
  type: ToastType;
  title: string;
  subtitle?: string;
}

interface ToastProps extends ToastState {
  onClose: () => void;
  duration?: number;
}

const ICONS: Record<ToastType, { symbol: string; bg: string; border: string; color: string; glow: string }> = {
  success: {
    symbol: "✓",
    bg: "rgba(74,222,128,0.12)",
    border: "rgba(74,222,128,0.4)",
    color: "#4ade80",
    glow: "0 0 24px rgba(74,222,128,0.25)",
  },
  error: {
    symbol: "✕",
    bg: "rgba(248,113,113,0.12)",
    border: "rgba(248,113,113,0.4)",
    color: "#f87171",
    glow: "0 0 24px rgba(248,113,113,0.25)",
  },
};

export function Toast({ type, title, subtitle, onClose, duration = 2000 }: ToastProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep onClose in a ref so the useEffect doesn't re-run when the parent re-renders
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
    const show = setTimeout(() => setVisible(true), 10);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onCloseRef.current(), 260);
    }, duration);
    return () => {
      clearTimeout(show);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration]); // intentionally omit onClose — using ref above

  if (!mounted) return null;

  const icon = ICONS[type];

  const content = (
    <>
      <style>{`
        @keyframes kkToastIn {
          from { opacity: 0; transform: scale(0.86); }
          to   { opacity: 1; transform: scale(1);    }
        }
        @keyframes kkToastOut {
          from { opacity: 1; transform: scale(1);    }
          to   { opacity: 0; transform: scale(0.86); }
        }
        @keyframes kkProgressShrink {
          from { width: 100%; }
          to   { width: 0%;   }
        }
      `}</style>

      {/* Backdrop — separate layer so it never moves */}
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 99998,
        background: "rgba(0,0,0,0.22)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        pointerEvents: "none",
      }} />

      {/* Flex centring container — works on every viewport */}
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        pointerEvents: "none",
      }}>
        {/* Card */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          background: "linear-gradient(160deg, #1e1e1e 0%, #141414 100%)",
          border: `1px solid ${icon.border}`,
          borderRadius: 20,
          padding: "28px 28px 22px",
          width: "100%",
          maxWidth: 320,
          boxShadow: `0 20px 60px rgba(0,0,0,0.75), ${icon.glow}`,
          textAlign: "center",
          animation: visible
            ? "kkToastIn 0.26s cubic-bezier(0.34,1.56,0.64,1) forwards"
            : "kkToastOut 0.22s ease-in forwards",
        }}>
          {/* Icon */}
          <div style={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: icon.bg,
            border: `2px solid ${icon.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
            color: icon.color,
            boxShadow: icon.glow,
            flexShrink: 0,
          }}>
            {icon.symbol}
          </div>

          {/* Title */}
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1.35,
            letterSpacing: "-0.2px",
            wordBreak: "break-word",
          }}>
            {title}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <div style={{
              fontSize: 12,
              color: "#888",
              lineHeight: 1.5,
              marginTop: -4,
              wordBreak: "break-word",
            }}>
              {subtitle}
            </div>
          )}

          {/* Progress bar */}
          <div style={{
            width: "100%",
            height: 3,
            borderRadius: 99,
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
            marginTop: 2,
          }}>
            <div style={{
              height: "100%",
              background: icon.color,
              borderRadius: 99,
              animation: `kkProgressShrink ${duration}ms linear forwards`,
            }} />
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

/** Simple hook for managing a single toast at a time */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: ToastType, title: string, subtitle?: string, duration = 2000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ type, title, subtitle });
    timerRef.current = setTimeout(() => setToast(null), duration + 300);
  }, []);

  const hideToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return { toast, showToast, hideToast };
}
