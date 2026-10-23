"use client";

import { useEffect, useRef, useState } from "react";
import { validatePhone, validateEmail } from "@/utils/auth";
import { buildApiUrl } from "@/utils/api";

interface PlayerSignUpStep1Props {
  onBack: () => void;
  onContinue: (data: { firstName: string; phone: string; email: string; profileImageDataUrl?: string }) => void;
}

export function PlayerSignUpStep1({ onBack, onContinue }: PlayerSignUpStep1Props) {
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [checking, setChecking] = useState<{ phone?: boolean; email?: boolean }>({});

  useEffect(() => {
    if (!showPhotoPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) setShowPhotoPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPhotoPicker]);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacing } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      })
      .catch(() => { if (!cancelled) { setCameraOpen(false); fileInputRef.current?.click(); } });
    return () => { cancelled = true; };
  }, [cameraOpen, cameraFacing]);

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  const closeCamera = () => { stopStream(); setCameraOpen(false); };
  const flipCamera = () => setCameraFacing((f) => f === "user" ? "environment" : "user");

  const handleTakePhoto = () => { setShowPhotoPicker(false); setCameraOpen(true); };
  const handleChooseGallery = () => { setShowPhotoPicker(false); fileInputRef.current?.click(); };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current; const c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      closeCamera();
      const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
      setErrors((prev) => ({ ...prev, image: "" }));
      const reader = new FileReader();
      reader.onload = () => setProfileImageDataUrl(reader.result as string);
      reader.readAsDataURL(file);
    }, "image/jpeg", 0.9);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrors((prev) => ({ ...prev, image: "Only JPEG, PNG, or WebP images allowed" }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, image: "Image must be under 5MB" }));
      return;
    }
    setErrors((prev) => ({ ...prev, image: "" }));
    const reader = new FileReader();
    reader.onload = () => setProfileImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const checkField = async (field: "phone" | "email", value: string) => {
    setChecking((prev) => ({ ...prev, [field]: true }));
    try {
      const body: Record<string, string> = { role: "organiser" };
      body[field] = value;
      const res = await fetch(buildApiUrl("/api/v1/auth/check-availability"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        if (field === "phone" && data.data.phoneExists) {
          setErrors((prev) => ({ ...prev, phone: "This phone number is already registered. Please login or use a different number." }));
        }
        if (field === "email" && data.data.emailExists) {
          setErrors((prev) => ({ ...prev, email: "This email is already registered. Please login or use a different email." }));
        }
      }
    } catch {
      // non-critical — don't block the form
    } finally {
      setChecking((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) newErrors.firstName = "Name is required";
    if (!validatePhone(phone)) newErrors.phone = "Enter valid 10-digit phone (starting 6-9)";
    if (!validateEmail(email)) newErrors.email = "Enter valid email";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Final availability check on submit in case user skipped blur
    if (!errors.phone && !errors.email) {
      setChecking({ phone: true, email: true });
      try {
        const res = await fetch(buildApiUrl("/api/v1/auth/check-availability"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, email, role: "organiser" }),
        });
        const data = await res.json();
        if (data.success) {
          const submitErrors: Record<string, string> = {};
          if (data.data.phoneExists) submitErrors.phone = "This phone number is already registered. Please login or use a different number.";
          if (data.data.emailExists) submitErrors.email = "This email is already registered. Please login or use a different email.";
          if (Object.keys(submitErrors).length > 0) { setErrors(submitErrors); return; }
        }
      } catch { /* non-critical */ } finally {
        setChecking({});
      }
    }

    if (errors.phone || errors.email) return;

    onContinue({ firstName, phone, email, profileImageDataUrl });
  };

  const inputStyle = {
    width: "100%",
    background: "#1a1a2e",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "12px",
    color: "white",
    fontSize: "16px",
    outline: "none",
    boxSizing: "border-box" as const,
  };

  return (
    <>
    {cameraOpen && (
      <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#000", display: "flex", flexDirection: "column" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", flex: 1, objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 32px 48px", background: "linear-gradient(transparent,rgba(0,0,0,0.85))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={closeCamera} style={{ color: "#fff", background: "none", border: "none", fontSize: 15, cursor: "pointer", padding: "8px 12px", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" onClick={capturePhoto} style={{ width: 70, height: 70, borderRadius: "50%", background: "#fff", border: "5px solid rgba(255,255,255,0.4)", cursor: "pointer", boxShadow: "0 0 0 3px rgba(255,255,255,0.2)" }} aria-label="Capture" />
          <button type="button" onClick={flipCamera} style={{ color: "#fff", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 44, height: 44, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Flip camera">🔄</button>
        </div>
      </div>
    )}
    <div style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333" }}>
      <button
        onClick={onBack}
        style={{
          background: "transparent",
          color: "var(--yellow)",
          border: "none",
          fontSize: "14px",
          cursor: "pointer",
          marginBottom: "20px",
          padding: 0,
        }}
      >
        ← Back
      </button>

      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px" }}>Create Account</h1>
      <p style={{ color: "#999", marginBottom: "30px", fontSize: "14px" }}>Step 1 of 2: Enter your details</p>

      {/* Profile Image Picker */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "28px" }}>
        <div
          onClick={() => setShowPhotoPicker(true)}
          style={{
            width: "90px", height: "90px", borderRadius: "50%",
            background: profileImageDataUrl ? "transparent" : "#1a1a2e",
            border: `2px dashed ${profileImageDataUrl ? "var(--yellow)" : "#555"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", overflow: "hidden", marginBottom: "10px", transition: "border-color 0.2s",
          }}
        >
          {profileImageDataUrl ? (
            <img src={profileImageDataUrl} alt="Profile preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px" }}>📷</div>
              <div style={{ color: "#666", fontSize: "10px", marginTop: "2px" }}>Add Photo</div>
            </div>
          )}
        </div>

        {/* Photo button + inline dropdown */}
        <div ref={pickerWrapRef} style={{ position: "relative" }}>
          <button type="button"
            onClick={() => setShowPhotoPicker((v) => !v)}
            style={{ background: "transparent", border: "none", color: "var(--yellow)", fontSize: "13px", cursor: "pointer", padding: 0 }}
          >
            {profileImageDataUrl ? "Change photo" : "Upload profile photo"} (optional)
          </button>
          {showPhotoPicker && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
              background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 10,
              overflow: "hidden", zIndex: 200, minWidth: 190,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}>
              <button type="button"
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", borderBottom: "1px solid #2a2a4a", color: "#fff", cursor: "pointer", fontSize: 14 }}
                onClick={handleTakePhoto}
              >
                <span style={{ fontSize: 18 }}>📷</span> Take Photo
              </button>
              <button type="button"
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 14 }}
                onClick={handleChooseGallery}
              >
                <span style={{ fontSize: 18 }}>🖼️</span> Choose from Gallery
              </button>
            </div>
          )}
        </div>

        {errors.image && <small style={{ color: "#ff6b6b", fontSize: "12px", marginTop: "4px" }}>{errors.image}</small>}
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleImageChange} />
      </div>

      <form onSubmit={handleContinue}>
        {/* Name */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Full Name *</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setErrors({ ...errors, firstName: "" });
            }}
            placeholder="Your full name"
            style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
            onBlur={(e) => (e.target.style.borderColor = "#444")}
          />
          {errors.firstName && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.firstName}</small>}
        </div>

        {/* Phone */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Phone Number *</label>
          <div style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: errors.phone ? "1px solid #ff6b6b" : "1px solid #444", borderRadius: "6px", padding: "0 12px" }}>
            <span style={{ color: "#999", fontSize: "14px", fontWeight: "600" }}>+91</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                setPhone(val);
                setErrors({ ...errors, phone: "" });
              }}
              placeholder="9876543210"
              maxLength={10}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                padding: "12px 12px",
                color: "white",
                fontSize: "16px",
                outline: "none",
              }}
              onFocus={(e) => {
                const container = e.currentTarget.parentElement;
                if (container) container.style.borderColor = "var(--yellow)";
              }}
              onBlur={(e) => {
                const val = e.target.value;
                const container = e.currentTarget.parentElement;
                if (container) container.style.borderColor = errors.phone ? "#ff6b6b" : "#444";
                if (validatePhone(val) && !errors.phone) checkField("phone", val);
              }}
            />
          </div>
          {checking.phone
            ? <small style={{ color: "#999", fontSize: "12px", display: "block", marginTop: "4px" }}>Checking availability…</small>
            : errors.phone && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.phone}</small>
          }
        </div>

        {/* Email */}
        <div style={{ marginBottom: "24px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Email Address *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors({ ...errors, email: "" });
            }}
            placeholder="your@email.com"
            style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
            onBlur={(e) => {
              e.target.style.borderColor = errors.email ? "#ff6b6b" : "#444";
              if (validateEmail(email) && !errors.email) checkField("email", e.target.value);
            }}
          />
          {checking.email
            ? <small style={{ color: "#999", fontSize: "12px", display: "block", marginTop: "4px" }}>Checking availability…</small>
            : errors.email && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.email}</small>
          }
        </div>

        <button
          type="submit"
          disabled={!!(checking.phone || checking.email)}
          style={{
            width: "100%",
            background: (checking.phone || checking.email) ? "#666" : "var(--yellow)",
            color: (checking.phone || checking.email) ? "#999" : "black",
            border: "none",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: (checking.phone || checking.email) ? "not-allowed" : "pointer",
            transition: "background 0.3s ease",
          }}
          onMouseEnter={(e) => { if (!checking.phone && !checking.email) e.currentTarget.style.background = "#ffd700"; }}
          onMouseLeave={(e) => { if (!checking.phone && !checking.email) e.currentTarget.style.background = "var(--yellow)"; }}
        >
          {(checking.phone || checking.email) ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
    </>
  );
}
