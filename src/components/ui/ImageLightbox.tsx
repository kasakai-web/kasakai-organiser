"use client";

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ImageLightbox.css";
type ImageLightboxProps = {
  lightboxImage: string | null;
  alt?: string;
  setLightboxImage?: Dispatch<SetStateAction<string | null>>;
};

export function ImageLightbox({ lightboxImage, setLightboxImage, alt = "Profile full size" }: ImageLightboxProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const setterRef = useRef(setLightboxImage);
  setterRef.current = setLightboxImage;

  const close = () => setterRef.current?.(null);

  const open = lightboxImage != null;

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setterRef.current?.(null);
        
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, true);

    return () => { 
      //mantaining the previous overflow status of previous page from where this ImageLightbox is opened...
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  if (!mounted || !lightboxImage) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes kkLightboxIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes kkLightboxZoom {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1);    }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        onClick={(event) => {
          event.stopPropagation();
          close();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: "rgba(0,0,0,0.92)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          cursor: "zoom-out",
          animation: "kkLightboxIn 0.16s ease-out",
        }}
      >
        <img
          src={lightboxImage}
          alt={alt}
          style={{
            maxWidth: "90vw",
            maxHeight: "90vh",
            borderRadius: 8,
            objectFit: "contain",
            boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
            cursor: "default",
            animation: "kkLightboxZoom 0.2s cubic-bezier(0.34,1.3,0.64,1)",
          }}
          onClick={(e) => e.stopPropagation()}
        />

        <button
          type="button"
          onClick={close}
          aria-label="Close"
          autoFocus
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "rgba(255,255,255,0.1)",
            border: "none",
            color: "#fff",
            fontSize: 28,
            lineHeight: 1,
            width: 44,
            height: 44,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>
    </>,
    document.body
  );
}
