"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validatePhone, validatePassword } from "@/utils/auth";
import { buildApiUrl, resolveImageUrl } from "@/utils/api";

interface PlayerLoginFormProps {
  onSignupClick: () => void;
  onForgotClick: () => void;
}

export function PlayerLoginForm({ onSignupClick, onForgotClick }: PlayerLoginFormProps) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validatePhone(phone)) {
      setError("Please enter a valid 10-digit phone number (starting with 6-9)");
      return;
    }

    if (!validatePassword(password)) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildApiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password, role: "organiser" }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Wrong credentials" : data.message || "Failed to login");
      }

      const { token, user } = data;
      localStorage.setItem("authToken", token); // ✅ consistent
      localStorage.setItem("userRole", user.role || "organiser");
      // Signal SocketClient to connect now that we have a token (same-tab login)
      window.dispatchEvent(new CustomEvent("kk-auth-changed"));
      localStorage.setItem("userId", user._id || user.id); // API returns 'id' field
      localStorage.setItem("userName", user.name || "User");
      if (user.profileImage) {
        localStorage.setItem("userProfileImage", resolveImageUrl(user.profileImage));
      } else {
        localStorage.removeItem("userProfileImage");
      }

      // Upload pending profile image from signup if present
      const pendingImage = localStorage.getItem("pendingProfileImage");
      if (pendingImage) {
        try {
          const blob = await (await fetch(pendingImage)).blob();
          const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
          const formData = new FormData();
          formData.append("profileImage", blob, `profile.${ext}`);
          const imgRes = await fetch(buildApiUrl("/api/v1/organisers/me/profile-image"), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            if (imgData.data?.profileImage) {
              localStorage.setItem("userProfileImage", resolveImageUrl(imgData.data.profileImage));
            }
          }
        } catch {
          // Non-critical — don't block login
        } finally {
          localStorage.removeItem("pendingProfileImage");
        }
      }

      const hasImage = !!localStorage.getItem("userProfileImage");
      if (!hasImage) localStorage.setItem("requirePhotoUpload", "true");

      const orgId = user._id || user.id;
      const isNew = localStorage.getItem("newSignup") === "true";
      if (isNew) {
        localStorage.removeItem("newSignup");
        localStorage.setItem("showProfileBanner", "true");
        router.replace(`/dashboard/organizer/${orgId}/profile`);
      } else if (!hasImage) {
        router.replace(`/dashboard/organizer/${orgId}/profile`);
      } else {
        router.replace(`/dashboard/organizer/${orgId}`);
      }
    } catch (err: any) {
      if (err instanceof TypeError && /fetch/i.test(err.message || "")) {
        setError("Unable to reach backend server. Please check backend is running and CORS is configured.");
      } else {
        setError(err.message || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333" }}>
      <h1 style={{ color: "var(--yellow)", fontSize: "28px", marginBottom: "10px", textAlign: "center" }}>
        Organiser Login
      </h1>
      <p style={{ color: "#999", textAlign: "center", marginBottom: "30px", fontSize: "14px" }}>Enter your phone number and password</p>

      {error && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "20px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} autoComplete="off">
        <div style={{ marginBottom: "20px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Phone Number</label>
          <div style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: "1px solid #444", borderRadius: "6px", padding: "0 12px" }}>
            <span style={{ color: "#999", fontSize: "14px", fontWeight: "600" }}>+91</span>
            <input
              type="tel"
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
          <small style={{ color: "#666", fontSize: "12px", marginTop: "4px", display: "block" }}>10-digit mobile number</small>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ color: "#ccc", fontSize: "14px", display: "block", marginBottom: "8px" }}>Password</label>
          <div style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: "1px solid #444", borderRadius: "6px" }}>
            <input
              type={showPassword ? "text" : "password"}
              name="organiserPassword"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              spellCheck={false}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                padding: "12px",
                color: "white",
                fontSize: "16px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              style={{
                background: "transparent",
                border: "none",
                color: "#999",
                padding: "0 12px",
                cursor: "pointer",
                fontSize: "12px",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              {showPassword ? "HIDE" : "SHOW"}
            </button>
          </div>
          <small style={{ color: "#666", fontSize: "12px", marginTop: "4px", display: "block" }}>Minimum 8 characters</small>
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
            marginBottom: "16px",
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
          {loading ? "Logging in..." : "Login"}
        </button>

        <button
          type="button"
          onClick={onForgotClick}
          style={{
            width: "100%",
            background: "transparent",
            color: "var(--yellow)",
            border: "1px solid var(--yellow)",
            padding: "10px",
            borderRadius: "6px",
            fontSize: "14px",
            cursor: "pointer",
            marginBottom: "20px",
            transition: "all 0.3s ease",
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
          Forgot Password?
        </button>

        <div style={{ textAlign: "center", paddingTop: "16px", borderTop: "1px solid #333" }}>
          <p style={{ color: "#999", fontSize: "14px", marginBottom: "8px" }}>Don't have an account?</p>
          <button
            type="button"
            onClick={onSignupClick}
            style={{
              background: "transparent",
              color: "var(--yellow)",
              border: "none",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Create one now
          </button>
        </div>
      </form>
    </div>
  );
}
