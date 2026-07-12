const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

const isBrowser = () => typeof window !== "undefined";

const normalizeApiPath = (path: string): string => {
  if (!path) return "";

  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  const baseHasApiPrefix = /\/api\/v1\/?$/i.test(API_BASE_URL);

  if (baseHasApiPrefix && withLeadingSlash.startsWith("/api/v1/")) {
    return withLeadingSlash.replace(/^\/api\/v1/i, "");
  }

  return withLeadingSlash;
};

export const buildApiUrl = (path: string): string => {
  if (!path) return API_BASE_URL;

  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const normalizedPath = normalizeApiPath(path);
  return `${base}${normalizedPath}`;
};

export const getSession = () => {
  if (!isBrowser()) {
    return { token: null, role: null, userId: null };
  }

  const token = localStorage.getItem("authToken");
  const role = localStorage.getItem("userRole");
  const userId = localStorage.getItem("userId");

  return { token, role, userId };
};

export const clearSession = () => {
  if (!isBrowser()) return;

  localStorage.removeItem("authToken");
  localStorage.removeItem("token");
  localStorage.removeItem("userRole");
  localStorage.removeItem("userId");
  localStorage.removeItem("userName");
  localStorage.removeItem("userProfileImage");
};

export const getAuthHeaders = () => {
  const token = isBrowser() ? localStorage.getItem("authToken") : null;

  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

// Resilient fetch for transient failures (cold starts, brief DB reconnects,
// network blips). Retries on network error or 5xx — NOT on 4xx (auth/validation).
export const fetchWithRetry = async (
  url: string,
  options: RequestInit = {},
  { retries = 2, backoffMs = 700 }: { retries?: number; backoffMs?: number } = {},
): Promise<Response> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
};
