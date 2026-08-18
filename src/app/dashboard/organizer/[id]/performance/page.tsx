"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// This was "My Feedback": a read-only card grid of the same standing ratings the
// Player Ratings page now shows and lets you edit. Kept as a redirect rather than
// deleted so bookmarks and any link still in the wild land somewhere useful.
export default function OrgPerformanceRedirect() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;

  useEffect(() => {
    if (!organiserId) return;
    router.replace(`/dashboard/organizer/${organiserId}/player-ratings`);
  }, [organiserId, router]);

  return (
    <div className="loading-container">
      <div className="spinner" />
      <p>Taking you to Player Ratings…</p>
    </div>
  );
}
