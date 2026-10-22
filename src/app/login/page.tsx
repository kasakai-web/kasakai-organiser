"use client";

import { useState, Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlayerLoginForm, type SessionUser } from "@/components/auth/PlayerLoginForm";
import { PlayerSignUpStep1, type ProfileDetails } from "@/components/auth/PlayerSignUpStep1";
import { OTPVerificationPhone } from "@/components/auth/OTPVerificationPhone";
import { buildApiUrl, resolveImageUrl } from "@/utils/api";
import "../home.css";

// One flow signs in and signs up, with no password anywhere:
//   phone  → WhatsApp code → (new number) name, email, photo → awaiting approval
//   Google → (not linked yet) phone + photo → WhatsApp code → (new number) awaiting approval
// A new organiser has no session until an admin approves them, so the photo
// (compulsory) is sent with complete-signup itself.
function AuthFlow() {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "otp" | "profile" | "pending">("start");
  const [phone, setPhone] = useState("");
  const [google, setGoogle] = useState<{ googleToken: string; profile: { name: string; email: string } } | null>(null);
  const [signupToken, setSignupToken] = useState("");
  const [details, setDetails] = useState<ProfileDetails>({ firstName: "", email: "", phone: "" });
  const [error, setError] = useState("");

  const go = (next: typeof step) => {
    setError("");
    setStep(next);
  };

  useEffect(() => {
    const token = localStorage.getItem("authToken");
    const uRole = localStorage.getItem("userRole");
    const uId = localStorage.getItem("userId");

    if (token && uId && uRole === "organiser" && step === "start") {
      router.replace(`/dashboard/organizer/${uId}`);
    }
  }, [router, step]);

  const finishLogin = async (token: string, user: SessionUser) => {
    localStorage.setItem("authToken", token);
    localStorage.setItem("userRole", "organiser");
    localStorage.setItem("userId", user.id);
    localStorage.setItem("userName", user.name || "User");
    if (user.profileImage) {
      localStorage.setItem("userProfileImage", resolveImageUrl(user.profileImage));
    } else {
      localStorage.removeItem("userProfileImage");
    }
    // Signal SocketClient to connect now that we have a token (same-tab login)
    window.dispatchEvent(new CustomEvent("kk-auth-changed"));
    localStorage.removeItem("pendingProfileImage"); // left by the old signup flow

    // Only accounts made before the photo became compulsory can lack one.
    const hasImage = !!localStorage.getItem("userProfileImage");
    if (!hasImage) localStorage.setItem("requirePhotoUpload", "true");

    const isNew = localStorage.getItem("newSignup") === "true";
    if (isNew) {
      localStorage.removeItem("newSignup");
      localStorage.setItem("showProfileBanner", "true");
    }
    router.replace(isNew || !hasImage ? `/dashboard/organizer/${user.id}/profile` : `/dashboard/organizer/${user.id}`);
  };

  // Multipart: the photo is compulsory and the server stores it with the account,
  // so the admin sees it when approving and it never waits in this browser.
  const completeSignup = async (token: string, d: ProfileDetails) => {
    const body = new FormData();
    body.append("signupToken", token);
    body.append("name", d.firstName);
    body.append("email", d.email);
    if (d.profileImageDataUrl) {
      const blob = await (await fetch(d.profileImageDataUrl)).blob();
      body.append("profileImage", blob, `profile.${blob.type.split("/")[1] || "jpg"}`);
    }
    const res = await fetch(buildApiUrl("/api/v1/auth/complete-signup"), { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Couldn't create your account. Please try again.");

    localStorage.setItem("newSignup", "true");
    if (data.token) return finishLogin(data.token, data.user);
    go("pending");
  };

  return (
    <>
      {error && (
        <div style={{ background: "#ff4444", color: "white", padding: "12px", borderRadius: "6px", marginBottom: "16px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      {step === "start" && (
        <PlayerLoginForm
          onCodeSent={(p) => {
            setPhone(p);
            go("otp");
          }}
          onGoogle={async (r) => {
            if ("token" in r) return finishLogin(r.token, r.user);
            setGoogle(r);
            go("profile");
          }}
        />
      )}

      {/* Phone sign-up: name, email, photo. Google sign-up: phone + photo. */}
      {step === "profile" && (
        <PlayerSignUpStep1
          google={google?.profile}
          initial={details}
          onBack={() => {
            setGoogle(null);
            go("start");
          }}
          onContinue={async (d) => {
            setDetails(d);
            if (google) {
              setPhone(d.phone);
              go("otp");
              return;
            }
            try {
              await completeSignup(signupToken, d);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      )}

      {step === "otp" && (
        <OTPVerificationPhone
          phone={phone}
          role="organiser"
          googleToken={google?.googleToken}
          onVerified={async (r) => {
            if ("token" in r) return finishLogin(r.token, r.user);
            setSignupToken(r.signupToken);
            // Google already gave the name and email: nothing left to ask.
            if (google) return completeSignup(r.signupToken, details);
            go("profile");
          }}
          onBack={() => go(google ? "profile" : "start")}
        />
      )}

      {/* NEW ORGANISER — waits for an admin */}
      {step === "pending" && (
        <div style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎉</div>
          <h1 style={{ color: "var(--yellow)", fontSize: "26px", marginBottom: "12px" }}>Account Created!</h1>
          <p style={{ color: "#ccc", fontSize: "14px", marginBottom: "8px", lineHeight: 1.6 }}>
            Welcome to Kasakai, <strong style={{ color: "white" }}>{details.firstName}</strong>!
          </p>
          <p style={{ color: "#999", fontSize: "13px", marginBottom: "28px", lineHeight: 1.6 }}>
            An admin will review your organiser account. Once it&apos;s approved, sign in here with your phone number{google ? " or Google" : ""} and complete your profile to start hosting games.
          </p>
          <button
            onClick={() => {
              setGoogle(null);
              go("start");
            }}
            style={{
              width: "100%",
              background: "var(--yellow)",
              color: "black",
              border: "none",
              padding: "12px",
              borderRadius: "6px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Back to Login
          </button>
        </div>
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="organiser-home" style={{ minHeight: "100vh" }}>
      <header className="site-header">
        <nav className="nav-bar">
          <Link href="/" className="brand-wrap" aria-label="KASAKAI home">
            <div className="brand-mark" aria-hidden="true">
              <span>KASA</span>
              <span>KAI</span>
            </div>
            <div className="brand-stack">
              <p className="brand-label">KASAKAI</p>
              <p className="brand-sub">Organiser Portal</p>
            </div>
          </Link>

          <div className="nav-links" aria-label="Login navigation">
            <Link href="/" onClick={() => window.scrollTo(0, 0)}>Home</Link>
            <a href="#" onClick={(event) => event.preventDefault()}>Organiser Login</a>
          </div>

          <div className="nav-actions">
            <Link href="/" className="btn-login">Back Home</Link>
          </div>
        </nav>
      </header>

      <main style={{ minHeight: "calc(100vh - 72px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>
        <div style={{ width: "100%", maxWidth: "500px" }}>
          <Suspense fallback={<div style={{ color: "white", textAlign: "center" }}>Loading...</div>}>
            <AuthFlow />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
