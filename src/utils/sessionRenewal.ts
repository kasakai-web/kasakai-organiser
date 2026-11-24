import { buildApiUrl } from "@/utils/api";
import { needsRenewal } from "@/utils/sessionToken";

/**
 * The sliding session. A login token lives 30 days; while the app is in use it
 * is traded, at most once a day, for a fresh 30-day one (POST /auth/refresh).
 * So a session ends after 30 days of NOT opening KasaKai — never on day 30 of
 * using it every day.
 *
 * Nothing here ever signs anyone out. A token that cannot be renewed (expired,
 * suspended account) is left exactly where it is, and the next ordinary API
 * call's 401 does what it always did. That keeps one path for logging out.
 */

let inFlight: Promise<void> | null = null;

/**
 * Renew the stored token if it is more than a day old. Safe to call as often as
 * you like: a fresh token returns at once, and concurrent calls share one
 * request. Other tabs see the new token through localStorage and skip their own.
 */
export function renewSessionIfStale(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inFlight) return inFlight;

  let token: string | null = null;
  try { token = localStorage.getItem("authToken"); } catch { return Promise.resolve(); }
  if (!token || !needsRenewal(token)) return Promise.resolve();
  const sent = token;

  inFlight = (async () => {
    try {
      const res = await fetch(buildApiUrl("/auth/refresh"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sent}` },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const fresh = data?.success && typeof data.token === "string" ? data.token : null;
      // Only replace the token we renewed — if they logged out, or in as someone
      // else, while the request was out, the answer belongs to nobody.
      if (fresh && localStorage.getItem("authToken") === sent) {
        localStorage.setItem("authToken", fresh);
      }
    } catch {
      // Offline or the server is down — try again on the next trigger.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
