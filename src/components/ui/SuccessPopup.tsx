"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SuccessPopupProps = {
  show: boolean;
  message: string;
  onClose: () => void;
};

export function SuccessPopup({ show, message, onClose }: SuccessPopupProps) {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    setIsBrowser(true);
  }, []);

  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!isBrowser || !show) {
    return null;
  }

  const popup = (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10000,
        animation: "popupFadeIn 0.3s ease-out",
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, rgba(74,222,128,0.95), rgba(59,200,100,0.95))",
          color: "#fff",
          padding: "24px 48px",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          textAlign: "center",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(74,222,128,0.3)",
          minWidth: "300px",
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.5px",
            lineHeight: 1.2,
          }}
        >
          {message}
        </div>
      </div>
      <style>{`
        @keyframes popupFadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(popup, document.body);
}
