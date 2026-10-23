"use client";

import { useState, Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlayerLoginForm } from "@/components/auth/PlayerLoginForm";
import { PlayerSignUpStep1 } from "@/components/auth/PlayerSignUpStep1";
import { PlayerSignUpStep2 } from "@/components/auth/PlayerSignUpStep2";
import { OTPVerificationPhone } from "@/components/auth/OTPVerificationPhone";
import { ForgotPasswordStep1 } from "@/components/auth/ForgotPasswordStep1";
import { SetNewPasswordForm } from "@/components/auth/SetNewPasswordForm";
import "../home.css";

function AuthFlow() {
  const router = useRouter();

  const [step, setStep] = useState<
    | "login"
    | "signup-form"
    | "signup-otp"
    | "signup-confirm"
    | "signup-success"
    | "forgot-step1"
    | "forgot-otp"
    | "forgot-newpass"
  >("login");

  const [userData, setUserData] = useState({
    phone: "",
    email: "",
    firstName: "",
    resetToken: "",
    profileImageDataUrl: "",
  });


  useEffect(() => {
    const token = localStorage.getItem("authToken");
    const uRole = localStorage.getItem("userRole");
    const uId = localStorage.getItem("userId");

    if (token && uId && uRole === "organiser" && step === "login") {
      router.replace(`/dashboard/organizer/${uId}`);
    }
  }, [router, step]);

  return (
    <>
      {/* LOGIN */}
      {step === "login" && (
        <PlayerLoginForm
          onSignupClick={() => setStep("signup-form")}
          onForgotClick={() => setStep("forgot-step1")}
        />
      )}

      {/* SIGNUP - STEP 1: Details */}
      {step === "signup-form" && (
        <PlayerSignUpStep1
          onBack={() => setStep("login")}
          onContinue={(data: { firstName: string; phone: string; email: string; profileImageDataUrl?: string }) => {
            setUserData((prev) => ({ ...prev, ...data, profileImageDataUrl: data.profileImageDataUrl || "" }));
            setStep("signup-confirm");
          }}
        />
      )}

      {/* SIGNUP - STEP 2: Confirm Details & Create Account */}
      {step === "signup-confirm" && (
        <PlayerSignUpStep2
          userData={userData}
          onBack={() => setStep("signup-form")}
          onSuccess={() => {
            setStep("signup-otp");
          }}
        />
      )}

      {/* SIGNUP - STEP 3: OTP Verification */}
      {step === "signup-otp" && (
        <OTPVerificationPhone
          phone={userData.phone}
          role="organiser"
          mode="signup"
          onVerified={() => setStep("signup-success")}
          onBack={() => setStep("signup-confirm")}
        />
      )}

      {/* SIGNUP SUCCESS */}
      {step === "signup-success" && (
        <div style={{ background: "var(--dark-navy)", padding: "40px 30px", borderRadius: "12px", border: "1px solid #333", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎉</div>
          <h1 style={{ color: "var(--yellow)", fontSize: "26px", marginBottom: "12px" }}>Account Verified!</h1>
          <p style={{ color: "#ccc", fontSize: "14px", marginBottom: "8px", lineHeight: 1.6 }}>
            Welcome to Kasakai, <strong style={{ color: "white" }}>{userData.firstName}</strong>!
          </p>
          <p style={{ color: "#999", fontSize: "13px", marginBottom: "28px", lineHeight: 1.6 }}>
            Your organiser account is ready. After logging in, complete your profile to start hosting games — add your city, WhatsApp number, and default game settings.
          </p>
          <button
            onClick={() => {
              localStorage.setItem("newSignup", "true");
              if (userData.profileImageDataUrl) {
                localStorage.setItem("pendingProfileImage", userData.profileImageDataUrl);
              }
              setStep("login");
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
            Login Now
          </button>
        </div>
      )}

      {/* FORGOT PASSWORD - STEP 1: Enter Phone */}
      {step === "forgot-step1" && (
        <ForgotPasswordStep1
          onBack={() => setStep("login")}
          onContinue={(phone: string) => {
            setUserData((prev) => ({ ...prev, phone }));
            setStep("forgot-otp");
          }}
        />
      )}

      {/* FORGOT PASSWORD - STEP 2: OTP Verification */}
      {step === "forgot-otp" && (
        <OTPVerificationPhone
          phone={userData.phone}
          role="organiser"
          mode="forgot-password"
          onVerified={(token: string) => {
            setUserData((prev) => ({ ...prev, resetToken: token }));
            setStep("forgot-newpass");
          }}
          onBack={() => setStep("forgot-step1")}
        />
      )}

      {/* FORGOT PASSWORD - STEP 3: Set New Password */}
      {step === "forgot-newpass" && (
        <SetNewPasswordForm
          phone={userData.phone}
          resetToken={userData.resetToken}
          onSuccess={() => {
            setStep("login");
            alert("Password changed successfully! Please login with new password.");
          }}
          onBack={() => setStep("forgot-step1")}
        />
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
