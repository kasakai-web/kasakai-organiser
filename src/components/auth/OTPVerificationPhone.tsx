"use client";

import { useState, useEffect } from "react";
import { buildApiUrl } from "@/utils/api";
import "../../app/auth-styles.css";

interface OTPVerificationPhoneProps {
  phone?: string;
  email?: string;
  role: "player" | "organiser";
  mode: "signup" | "forgot-password";
  onVerified: (otpString: string) => void;
  onBack: () => void;
  devOtp?: string;
}

export function OTPVerificationPhone({ phone, email, role, mode, onVerified, onBack, devOtp }: OTPVerificationPhoneProps) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setError("");

    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`) as HTMLInputElement;
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`) as HTMLInputElement;
      prevInput?.focus();
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpString = otp.join("");

    if (otpString.length !== 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildApiUrl('/api/v1/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, email, otp: otpString, role, mode }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Invalid OTP');
      }

      // For forgot-password mode the backend exchanges the OTP for a secure
      // resetToken — pass that through so SetNewPasswordForm can use it.
      const tokenToPass = (mode === "forgot-password" && resData.resetToken)
        ? resData.resetToken
        : otpString;
      onVerified(tokenToPass);
    } catch (err: any) {
      setError(err.message || "OTP verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setOtp(["", "", "", "", "", ""]);

    try {
      const endpoint = mode === "signup" ? "/api/v1/auth/resend-otp" : "/api/v1/auth/forgot-password";
      const response = await fetch(buildApiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, email, role }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to resend OTP");
      }

      setResendTimer(60);
    } catch (err: any) {
      setError(err.message || "Failed to resend OTP. Please try again.");
    }
  };

  const maskPhone = (p: string) => `••••••${p.slice(-4)}`;

  const destinationText = phone ? `+91 ${maskPhone(phone)}` : "your WhatsApp";

  return (
    <div className="auth-form-container" style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333" }}>
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

      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px" }}>
        Verify via WhatsApp
      </h1>
      <p style={{ color: "#999", marginBottom: "30px", fontSize: "14px" }}>
        OTP sent to your WhatsApp at {destinationText}
      </p>

      {error && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleVerify}>
        <div style={{ marginBottom: "30px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "16px", textAlign: "center" }}>Enter 6-digit OTP</label>
          <div className="otp-input-container" style={{ display: "flex", gap: "10px", justifyContent: "center", marginBottom: "20px" }}>
            {otp.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="otp-input"
                style={{
                  width: "50px",
                  height: "50px",
                  background: "#1a1a2e",
                  border: "2px solid #444",
                  borderRadius: "8px",
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "white",
                  textAlign: "center",
                  outline: "none",
                  transition: "border-color 0.2s",
                  cursor: "text",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
                onBlur={(e) => (e.target.style.borderColor = digit ? "var(--yellow)" : "#444")}
              />
            ))}
          </div>

          {resendTimer > 0 ? (
            <p style={{ color: "#999", fontSize: "14px", textAlign: "center" }}>Resend OTP in {resendTimer}s</p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
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
              Resend OTP
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || otp.some((d) => !d)}
          style={{
            width: "100%",
            background: loading || otp.some((d) => !d) ? "#666" : "var(--yellow)",
            color: loading || otp.some((d) => !d) ? "#999" : "black",
            border: "none",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: loading || otp.some((d) => !d) ? "not-allowed" : "pointer",
            transition: "background 0.3s ease",
          }}
          onMouseEnter={(e) => {
            if (!loading && !otp.some((d) => !d)) {
              e.currentTarget.style.background = "#ffd700";
            }
          }}
          onMouseLeave={(e) => {
            if (!loading && !otp.some((d) => !d)) {
              e.currentTarget.style.background = "var(--yellow)";
            }
          }}
        >
          {loading ? "Verifying..." : "Verify OTP"}
        </button>
      </form>
    </div>
  );
}
