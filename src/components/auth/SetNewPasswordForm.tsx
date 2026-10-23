"use client";

import { useState } from "react";
import { validatePassword } from "@/utils/auth";
import { buildApiUrl } from "@/utils/api";

interface SetNewPasswordFormProps {
  email?: string;
  phone?: string;
  resetToken: string;
  onSuccess: () => void;
  onBack: () => void;
}

export function SetNewPasswordForm({ email, phone, resetToken, onSuccess, onBack }: SetNewPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!validatePassword(newPassword)) {
      newErrors.newPassword = "Password must be at least 8 characters";
    }

    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildApiUrl("/api/v1/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          phone: email ? undefined : phone,
          resetToken: resetToken,
          newPassword: newPassword,
          role: "organiser",
        }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to reset password.");
      }

      onSuccess();
    } catch (err: any) {
      setErrors({ submit: err.message || "Failed to reset password. Please try again." });
    } finally {
      setLoading(false);
    }
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

      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px" }}>Set New Password</h1>
      <p style={{ color: "#999", marginBottom: "30px", fontSize: "14px" }}>Enter your new password for {email || phone}</p>

      {errors.submit && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {errors.submit}
        </div>
      )}

      <form onSubmit={handleResetPassword}>
        <div style={{ marginBottom: "20px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>New Password *</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors({ ...errors, newPassword: "" });
            }}
            placeholder="At least 8 characters"
            style={{ ...inputStyle, borderColor: errors.newPassword ? "#ff6b6b" : "#444" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
            onBlur={(e) => (e.target.style.borderColor = errors.newPassword ? "#ff6b6b" : "#444")}
          />
          {errors.newPassword && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.newPassword}</small>}
          <small style={{ color: "#666", fontSize: "12px", marginTop: "4px", display: "block" }}>Use uppercase, lowercase, numbers, and symbols for strength</small>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Confirm Password *</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setErrors({ ...errors, confirmPassword: "" });
            }}
            placeholder="Re-enter password"
            style={{ ...inputStyle, borderColor: errors.confirmPassword ? "#ff6b6b" : "#444" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
            onBlur={(e) => (e.target.style.borderColor = errors.confirmPassword ? "#ff6b6b" : "#444")}
          />
          {errors.confirmPassword && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.confirmPassword}</small>}
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
          {loading ? "Resetting Password..." : "Reset Password"}
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
          Back
        </button>
      </form>
    </div>
  );
}
