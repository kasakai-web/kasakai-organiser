"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getSession } from "@/utils/api";

type Role = "player" | "organiser";

type UseAuthGuardOptions = {
  requiredRole: Role;
  routeUserId?: string;
  redirectTo: string;
};

const normalizeRole = (role: string | null): Role | null => {
  if (role === "player") return "player";
  if (role === "organiser" || role === "organizer") return "organiser";
  return null;
};

export function useAuthGuard({ requiredRole, routeUserId, redirectTo }: UseAuthGuardOptions) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [session, setSession] = useState({ token: null as string | null, role: null as string | null, userId: null as string | null });

  useEffect(() => {
    const currentSession = getSession();
    setSession(currentSession);

    const normalizedRole = normalizeRole(currentSession.role);
    const roleMismatch = normalizedRole !== requiredRole;
    const idMismatch = Boolean(routeUserId && currentSession.userId && routeUserId !== currentSession.userId);

    if (!currentSession.token || !currentSession.userId || roleMismatch || idMismatch) {
      clearSession();
      setIsAuthorized(false);
      router.replace(redirectTo);
      return;
    }

    setIsAuthorized(true);
  }, [requiredRole, routeUserId, redirectTo, router]);

  return { session, isAuthorized };
}
