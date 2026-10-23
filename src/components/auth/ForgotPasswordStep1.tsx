"use client";

import { useState } from "react";
import { validatePhone } from "@/utils/auth";
import { buildApiUrl } from "@/utils/api";

interface ForgotPasswordStep1Props {
  onBack: () => void;
  onContinue: (phone: string) => void;
}

export function ForgotPasswordStep1({ onBack, onContinue }: ForgotPasswordStep1Props) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validatePhone(phone)) {
      setError("Please enter a valid 10-digit phone number (starting with 6–9)");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildApiUrl("/api/v1/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, role: "organiser" }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to send reset OTP.");
      }

      onContinue(phone);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
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

      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px" }}>Reset Password</h1>
      <p style={{ color: "#999", marginBottom: "30px", fontSize: "14px" }}>Enter your phone number to receive a reset OTP on WhatsApp</p>

      {error && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleContinue}>
        <div style={{ marginBottom: "24px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Phone Number</label>
          <div style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: error ? "1px solid #ff6b6b" : "1px solid #444", borderRadius: "6px", padding: "0 12px", transition: "border-color 0.2s" }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = "var(--yellow)")}
            onBlurCapture={(e) => (e.currentTarget.style.borderColor = error ? "#ff6b6b" : "#444")}
          >
            <span style={{ color: "#999", fontSize: "14px", fontWeight: "600" }}>+91</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                setError("");
              }}
              placeholder="9876543210"
              maxLength={10}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                padding: "12px",
                color: "white",
                fontSize: "16px",
                outline: "none",
              }}
            />
          </div>
          <small style={{ color: "#666", fontSize: "12px", marginTop: "4px", display: "block" }}>OTP will be sent to this number via WhatsApp</small>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            background: loading ? "#666" : "var(--yellow)",
            color: loading ? "#999" : "black",
            border: "none",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: "16px",
            transition: "background 0.3s ease",
          }}
          onMouseEnter={(e) => !loading && (e.currentTarget.style.background = "#ffd700")}
          onMouseLeave={(e) => !loading && (e.currentTarget.style.background = "var(--yellow)")}
        >
          {loading ? "Sending OTP..." : "Send OTP on WhatsApp"}
        </button>

        <button
          type="button"
          onClick={onBack}
          style={{
            width: "100%",
            background: "transparent",
            color: "var(--yellow)",
            border: "1px solid var(--yellow)",
            padding: "10px",
            borderRadius: "6px",
            fontSize: "14px",
            cursor: "pointer",
            transition: "all 0.3s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--yellow)";
            e.currentTarget.style.color = "black";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--yellow)";
          }}
        >
          Back to Login
        </button>
      </form>
    </div>
  );
}
