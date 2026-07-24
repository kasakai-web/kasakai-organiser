"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { CreateEventForm } from "@/components/dashboard/CreateEventForm";
import "../../../organizer-dashboard.css";
import { useState } from "react";

export default function CreateEventPage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  // Prefer a template prefill (arriving from a template's "Customize"), else fall
  // back to the "prefill from last event" convenience. The template prefill is
  // one-shot — consumed and cleared so a later plain visit isn't hijacked.
  const [{ lastEvent, presetDate }] = useState<{ lastEvent: any; presetDate?: string }>(() => {
    if (typeof window === "undefined") return { lastEvent: null };
    const tmpl = sessionStorage.getItem("kk-template-prefill");
    if (tmpl) {
      const date = sessionStorage.getItem("kk-template-presetdate") || undefined;
      sessionStorage.removeItem("kk-template-prefill");
      sessionStorage.removeItem("kk-template-presetdate");
      try {
        return { lastEvent: JSON.parse(tmpl), presetDate: date };
      } catch {
        /* fall through to lastEvent */
      }
    }
    const saved = localStorage.getItem("lastEvent");
    return { lastEvent: saved ? JSON.parse(saved) : null };
  });

  useAuthGuard({
    requiredRole: "organiser",
    routeUserId: organiserId,
    redirectTo: "/login?role=organiser",
  });

  const handleSuccess = () => {
    router.push(`/dashboard/organizer/${organiserId}`);
  };

  return (
    <div className="organizer-dashboard-container">
        <div className="dashboard-header-section">
          <div className="header-left">
            <h1  className="dashboard-title">Create Event</h1>
            <p className="dashboard-subtitle">Fill the event details and you will be redirected to the dashboard when it is created.</p>
          </div>
        </div>
        <CreateEventForm
         lastEvent={lastEvent}
         presetDate={presetDate}
         onClose={()=>{router.push(`/dashboard/organizer/${organiserId}`)}}
         onCreate={() => { sessionStorage.setItem("kk-game-created", "1"); }}
         onSuccess={handleSuccess}/>
    </div>
  );
}
