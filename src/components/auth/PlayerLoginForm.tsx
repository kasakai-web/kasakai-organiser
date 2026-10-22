"use client";

import { useState } from "react";
import { validatePhone } from "@/utils/auth";
import { buildApiUrl } from "@/utils/api";
import { GoogleSignInButton, useGoogleAvailable } from "./GoogleSignInButton";

export type SessionUser = { id: string; name?: string; profileImage?: string | null };

// Linked → a session. Not linked yet → a googleToken, and the organiser goes on
// to verify a phone (which either links an existing account or starts a new one).
export type GoogleResult =
  | { token: string; user: SessionUser }
  | { googleToken: string; profile: { name: string; email: string } };

interface PlayerLoginFormProps {
  onCodeSent: (phone: string) => void;
  onGoogle: (result: GoogleResult) => void | Promise<void>;
}

// Sign in AND sign up: a number with no account goes on to the details step.
export function PlayerLoginForm({ onCodeSent, onGoogle }: PlayerLoginFormProps) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const googleAvailable = useGoogleAvailable();

  const post = async (path: string, body: object) => {
    const res = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, role: "organiser" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Something went wrong. Please try again.");
    return data;
  };

  const fail = (err: unknown) => {
    if (err instanceof TypeError && /fetch/i.test(err.message || "")) {
      setError("Unable to reach backend server. Please check backend is running and CORS is configured.");
    } else {
      setError((err as Error).message || "Login failed. Please try again.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validatePhone(phone)) {
      setError("Please enter a valid 10-digit phone number (starting with 6-9)");
      return;
    }
    setLoading(true);
    try {
      await post("/api/v1/auth/otp/send", { phone });
      onCodeSent(phone);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential: string) => {
    setError("");
    setLoading(true);
    try {
      await onGoogle(await post("/api/v1/auth/google", { credential }));
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333" }}>
      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px", textAlign: "center" }}>
        Organiser Login
      </h1>
      <p style={{ color: "#999", textAlign: "center", marginBottom: "30px", fontSize: "14px" }}>
        Sign in or create an account with your phone number. No password needed.
      </p>

      {error && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "24px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Phone Number</label>
          <div style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: "1px solid #444", borderRadius: "6px", padding: "0 12px" }}>
            <span style={{ color: "#999", fontSize: "14px", fontWeight: "600" }}>+91</span>
            <input
              type="tel"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
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
            />
          </div>
          <small style={{ color: "#666", fontSize: "12px", marginTop: "4px", display: "block" }}>We&apos;ll send a code to this number on WhatsApp</small>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            background: "transparent",
            color: loading ? "#666" : "var(--yellow)",
            border: `1px solid ${loading ? "#666" : "var(--yellow)"}`,
            padding: "12px",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: "20px",
            transition: "background 0.3s ease, color 0.3s ease",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.background = "var(--yellow)";
              e.currentTarget.style.color = "black";
            }
          }}
          onMouseLeave={(e) => {
            if (!loading) {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--yellow)";
            }
          }}
        >
          {loading ? "Please wait..." : "Send code on WhatsApp"}
        </button>

        {googleAvailable && (
          <div style={{ paddingTop: "20px", borderTop: "1px solid #333" }}>
            <p style={{ color: "#999", fontSize: "13px", textAlign: "center", marginBottom: "12px" }}>or</p>
            <GoogleSignInButton onCredential={handleGoogle} />
          </div>
        )}
      </form>
    </div>
  );
}
