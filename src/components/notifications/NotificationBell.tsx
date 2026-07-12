"use client";

import { useState, useEffect, useCallback } from "react";
import { buildApiUrl, getSession } from "@/utils/api";
import { useNotificationSocket, type IncomingNotification } from "@/hooks/useNotificationSocket";
import "./NotificationBell.css";

interface NotificationBellProps {
  onViewAll?: () => void;
  unreadCount?: number;
}

const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export function NotificationBell({ onViewAll, unreadCount }: NotificationBellProps) {
  const [unread, setUnread] = useState(unreadCount ?? 0);

  useEffect(() => {
    if (unreadCount !== undefined) setUnread(unreadCount);
  }, [unreadCount]);

  const fetchUnreadCount = useCallback(async () => {
    const { token } = getSession();
    if (!token) return;
    try {
      const res = await fetch(buildApiUrl("/api/v1/notifications/unread-count"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success) setUnread(data.data?.count ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (unreadCount !== undefined) return;
    fetchUnreadCount();
    const id = setInterval(fetchUnreadCount, 15_000);
    return () => clearInterval(id);
  }, [fetchUnreadCount, unreadCount]);

  // Only increment locally when no parent is managing the count via prop.
  // When unreadCount prop is provided, the dashboard layout already listens for
  // kk-new-notification → refreshes via API → updates the prop. Incrementing here
  // too would cause a brief double-count before the prop corrects it.
  const handleSocketNotification = useCallback((_n: IncomingNotification) => {
    if (unreadCount === undefined) setUnread((c) => c + 1);
  }, [unreadCount]);

  useNotificationSocket(handleSocketNotification);

  return (
    <div className="nb-wrap">
      <button
        className="nb-btn"
        onClick={() => onViewAll?.()}
        aria-label="Notifications"
      >
        <BellIcon />
        {unread > 0 && <span className="nb-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
    </div>
  );
}
