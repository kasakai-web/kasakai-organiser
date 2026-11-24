/** How old a login token is — pure, so it is testable (see sessionRenewal.ts). */

/** A token younger than this is left alone — one renewal a day is plenty. */
export const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** When the token was issued (ms), read from its payload; null if unreadable. */
export function tokenIssuedAt(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    return typeof json.iat === "number" ? json.iat * 1000 : null;
  } catch {
    return null;
  }
}

export function needsRenewal(token: string, now = Date.now()): boolean {
  const iat = tokenIssuedAt(token);
  return iat !== null && now - iat >= RENEW_AFTER_MS;
}
