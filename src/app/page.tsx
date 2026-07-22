"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession } from "@/utils/api";
import "./home.css";

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    const syncSession = () => setIsLoggedIn(Boolean(getSession().token));
    syncSession();

    window.addEventListener("kk-auth-changed", syncSession);
    return () => window.removeEventListener("kk-auth-changed", syncSession);
  }, []);

  const dashboardHref = "/dashboard";

  return (
    <div className="organiser-home">
      <header className="site-header">
        <nav className="nav-bar">
          <div className="brand-wrap">
            <div className="brand-mark" aria-hidden="true">
              <span>KASA</span>
              <span>KAI</span>
            </div>
            <div className="brand-stack">
              <p className="brand-label">KASAKAI</p>
              <p className="brand-sub">Organiser Portal</p>
            </div>
          </div>

          <div className="nav-links" aria-label="Primary navigation">
            <a href="#features" onClick={closeMobileMenu}>Features</a>
            <a href="#workflow" onClick={closeMobileMenu}>Workflow</a>
            <a href="#dashboard-preview" onClick={closeMobileMenu}>Preview</a>
            <a href="#contact" onClick={closeMobileMenu}>Contact</a>
          </div>

          <div className="nav-actions">
            <Link href={isLoggedIn ? dashboardHref : "/login"} className="btn-login">
              {isLoggedIn ? "Dashboard" : "Login"}
            </Link>
            <button
              className="mobile-menu-btn"
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </nav>

        {mobileMenuOpen && (
          <div className="mobile-menu-panel">
            <a href="#features" onClick={closeMobileMenu}>Features</a>
            <a href="#workflow" onClick={closeMobileMenu}>Workflow</a>
            <a href="#contact" onClick={closeMobileMenu}>Contact</a>
            <Link
              href={isLoggedIn ? dashboardHref : "/login"}
              className="mobile-menu-login"
              onClick={closeMobileMenu}
            >
              {isLoggedIn ? "Dashboard" : "Login"}
            </Link>
          </div>
        )}
      </header>

      <main className="home-content">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="hero-kicker">Built for game organisers</p>
            <h1 className="hero-title">Run your football communities with less noise.</h1>
            <p className="hero-subtitle">
              Publish games, track signups, manage payments, and keep every player updated from one clean workspace.
            </p>

            <div className="hero-actions">
              <Link href={isLoggedIn ? dashboardHref : "/login"} className="btn-primary">
                {isLoggedIn ? "Open Dashboard" : "Login to Get Started"}
              </Link>
              <a href="#workflow" className="btn-secondary" onClick={closeMobileMenu}>See Workflow</a>
            </div>

            <div className="hero-points">
              <div>
                <span>Fast setup</span>
                <p>Create and publish matches in minutes.</p>
              </div>
              <div>
                <span>Live control</span>
                <p>Handle slots, waitlists, and confirmations in real time.</p>
              </div>
              <div>
                <span>Clear comms</span>
                <p>Send updates to players without juggling chats.</p>
              </div>
            </div>
          </div>

          <div className="hero-visual" id="dashboard-preview" aria-label="Dashboard preview">
            <div className="visual-orb visual-orb-a" />
            <div className="visual-orb visual-orb-b" />
            <div className="preview-shell">
              <div className="preview-topline">
                <span>Live organiser dashboard</span>
                <span>Today · 6 events</span>
              </div>

              <div className="preview-grid">
                <article className="preview-card preview-card-large">
                  <p>Upcoming game</p>
                  <h3>Sunday 7v7</h3>
                  <div className="preview-meta">
                    <span>Koramangala Turf</span>
                    <span>28 players</span>
                  </div>
                </article>

                <article className="preview-card">
                  <p>Registrations</p>
                  <h3>92%</h3>
                  <span className="preview-note">12 of 13 spots filled</span>
                </article>

                <article className="preview-card">
                  <p>Payments</p>
                  <h3>₹24,800</h3>
                  <span className="preview-note">Collected this week</span>
                </article>

                <article className="preview-card preview-card-accent">
                  <p>Alerts</p>
                  <h3>3 pending</h3>
                  <span className="preview-note">Players waiting for approval</span>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-strip" aria-label="Platform highlights">
          <article>
            <strong>146</strong>
            <span>Games managed each month</span>
          </article>
          <article>
            <strong>8</strong>
            <span>Communities across cities</span>
          </article>
          <article>
            <strong>99.2%</strong>
            <span>On-time updates delivered</span>
          </article>
          <article>
            <strong>24/7</strong>
            <span>Dashboard access from any device</span>
          </article>
        </section>

        <section className="feature-section" id="features">
          <div className="section-heading">
            <p>Designed for organisers who want speed and clarity</p>
            <h2>All the operational tools you need, without the clutter.</h2>
          </div>

          <div className="feature-grid">
            <article>
              <span>01</span>
              <h3>Match control</h3>
              <p>Open slots, freeze registrations, and keep the waitlist moving when you need a quick fill.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Payment clarity</h3>
              <p>Track collections and refunds with less back-and-forth and more confidence in every game.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Player communication</h3>
              <p>Keep players informed with match notes, confirmations, and cancellation updates in one place.</p>
            </article>
          </div>
        </section>

        <section className="workflow-section" id="workflow">
          <div className="section-heading section-heading-tight">
            <p>The workflow</p>
            <h2>From creating a match to confirming attendance.</h2>
          </div>

          <div className="workflow-grid">
            <article>
              <span>1</span>
              <h3>Create</h3>
              <p>Add venue, format, fee, and start time in a single flow.</p>
            </article>
            <article>
              <span>2</span>
              <h3>Publish</h3>
              <p>Share the game with your community and fill the roster fast.</p>
            </article>
            <article>
              <span>3</span>
              <h3>Run</h3>
              <p>Manage check-ins, payments, and last-minute changes from the dashboard.</p>
            </article>
          </div>
        </section>

        <section className="cta-section" id="contact">
          <div>
            <p>Ready to run your next game?</p>
            <h2>Open the organiser dashboard and manage everything from one place.</h2>
          </div>
          <Link href={isLoggedIn ? dashboardHref : "/login"} className="btn-primary">
            {isLoggedIn ? "Go to Dashboard" : "Login to Continue"}
          </Link>
        </section>
      </main>
    </div>
  );
}

