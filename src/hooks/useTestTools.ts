"use client";

// Is this the TEST server? Asks the backend once per page load
// (GET /test-tools/status). Production never mounts that route, so there it
// answers 404 and every test control stays hidden. Any failure reads as "off".
// See Test_Speedups_Plan.md.

import { useEffect, useState } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import type { TestStatus } from "@/utils/testTools";

let cached: Promise<TestStatus | null> | null = null;

function fetchStatus(): Promise<TestStatus | null> {
  if (cached) return cached;
  const { token } = getSession();
  if (!token) return Promise.resolve(null);
  cached = fetch(buildApiUrl("/api/v1/test-tools/status"), { headers: { Authorization: `Bearer ${token}` } })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return body?.success && body.data?.enabled ? (body.data as TestStatus) : null;
    })
    .catch(() => null);
  return cached;
}

export function useTestTools(): { enabled: boolean; status: TestStatus | null } {
  const [status, setStatus] = useState<TestStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);
  return { enabled: Boolean(status?.enabled), status };
}
