"use client";

import { useState } from "react";
import { validatePassword } from "@/utils/auth";
import { buildApiUrl } from "@/utils/api";

interface PlayerSignUpStep2Props {
  userData: {
    phone: string;
    email: string;
    firstName: string;
  };
  onBack: () => void;
  onSuccess: (password: string) => void;
}

export function PlayerSignUpStep2({ userData, onBack, onSuccess }: PlayerSignUpStep2Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!validatePassword(password)) {
      newErrors.password = "Password must be at least 8 characters";
    }

    if (password !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (!agreeTerms) {
      newErrors.terms = "You must agree to the terms and conditions";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildApiUrl("/api/v1/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userData.firstName,
          phone: userData.phone,
          email: userData.email,
          password: password,
          role: "organiser",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to create account");
      }

      onSuccess(password);
    } catch (err: any) {
      setErrors({ submit: err.message || "Failed to create account. Please try again." });
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

      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px" }}>Confirm Details</h1>
      <p style={{ color: "#999", marginBottom: "30px", fontSize: "14px" }}>Step 2 of 2: Set your password</p>

      {errors.submit && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {errors.submit}
        </div>
      )}

      <form onSubmit={handleCreateAccount}>
        {/* Display user details */}
        <div style={{ background: "#0f0f1e", padding: "16px", borderRadius: "6px", marginBottom: "24px", border: "1px solid #333" }}>
          <p style={{ color: "#999", fontSize: "12px", marginBottom: "4px" }}>ACCOUNT DETAILS</p>
          <p style={{ color: "#ccc", fontSize: "14px", marginBottom: "8px" }}>
            <strong>Name:</strong> {userData.firstName}
          </p>
          <p style={{ color: "#ccc", fontSize: "14px", marginBottom: "8px" }}>
            <strong>Phone:</strong> +91 {userData.phone}
          </p>
          <p style={{ color: "#ccc", fontSize: "14px" }}>
            <strong>Email:</strong> {userData.email}
          </p>
        </div>

        {/* Password */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Create Password *</label>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors({ ...errors, password: "" });
            }}
            placeholder="At least 8 characters"
            style={{ ...inputStyle, borderColor: errors.password ? "#ff6b6b" : "#444" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--yellow)")}
            onBlur={(e) => (e.target.style.borderColor = errors.password ? "#ff6b6b" : "#444")}
          />
          {errors.password && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "4px" }}>{errors.password}</small>}
        </div>

        {/* Confirm Password */}
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

        {/* Terms & Conditions */}
        <div style={{ marginBottom: "24px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            id="terms"
            checked={agreeTerms}
            onChange={(e) => {
              setAgreeTerms(e.target.checked);
              setErrors({ ...errors, terms: "" });
            }}
            style={{ marginTop: "4px", cursor: "pointer", width: "18px", height: "18px" }}
          />
          <label htmlFor="terms" style={{ color: "#999", fontSize: "13px", cursor: "pointer", flex: 1 }}>
            I agree to the <span style={{ color: "var(--yellow)" }}>Terms & Conditions</span> and{" "}
            <span style={{ color: "var(--yellow)" }}>Privacy Policy</span>
          </label>
        </div>
        {errors.terms && <small style={{ color: "#ff6b6b", fontSize: "12px", display: "block", marginTop: "-16px", marginBottom: "12px" }}>{errors.terms}</small>}

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
            transition: "background 0.3s ease",
          }}
          onMouseEnter={(e) => !loading && (e.currentTarget.style.background = "#ffd700")}
          onMouseLeave={(e) => !loading && (e.currentTarget.style.background = "var(--yellow)")}
        >
          {loading ? "Creating Account..." : "Create Account"}
        </button>
      </form>
    </div>
  );
}
