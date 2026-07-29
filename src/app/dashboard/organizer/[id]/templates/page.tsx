"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Toast, useToast } from "@/components/ui/Toast";
import { TemplateForm } from "@/components/dashboard/TemplateForm";
import {
  listTemplates, deleteTemplate, saveTemplate, createGameFromTemplate,
  dayOffsetToDate, scheduledAtISO, prettyDay, prettyTime, templateToLastEventShape,
  type Template,
} from "@/utils/templates";
import "../../../organizer-dashboard.css";
import "./templates.css";

const rupees = (paise?: number) => `₹${((paise || 0) / 100).toLocaleString("en-IN")}`;
const turfName = (t?: Template["turf"]) => (t && typeof t === "object" ? t.name : "") || "";

type Pending = { template: Template; dateYMD: string };

export default function TemplatesPage() {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const organiserId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;

  useAuthGuard({ requiredRole: "organiser", routeUserId: organiserId, redirectTo: "/login?role=organiser" });

  const { toast, showToast, hideToast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "new" | "edit">("list");
  const [editing, setEditing] = useState<Template | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listTemplates());
    } catch (err) {
      showToast("error", "Couldn't load templates", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Quick create (Today / Tomorrow / Day-after / picked date) ──────────────
  const askCreate = (template: Template, dateYMD: string) => {
    const iso = scheduledAtISO(dateYMD, template.defaultTimeOfDay || "18:00");
    if (!iso || new Date(iso).getTime() <= new Date().getTime()) {
      showToast("error", "That time has already passed", "Pick a later day for this game.");
      return;
    }
    setPending({ template, dateYMD });
  };

  const doCreate = async () => {
    if (!pending) return;
    const iso = scheduledAtISO(pending.dateYMD, pending.template.defaultTimeOfDay || "18:00")!;
    setCreating(true);
    try {
      await createGameFromTemplate(pending.template._id, iso);
      setPending(null);
      sessionStorage.setItem("kk-game-created", "1");
      router.push(`/dashboard/organizer/${organiserId}`);
    } catch (err) {
      showToast("error", "Couldn't create game", err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  // ── Customize: hand the template to the full create form, prefilled ────────
  const customize = (template: Template, dateYMD: string) => {
    sessionStorage.setItem("kk-template-prefill", JSON.stringify(templateToLastEventShape(template, dateYMD)));
    sessionStorage.setItem("kk-template-presetdate", dateYMD);
    router.push(`/dashboard/organizer/${organiserId}/create-event`);
  };

  const duplicate = async (t: Template) => {
    try {
      const copy = templateToPayload(t);
      copy.name = `${t.name} (copy)`;
      await saveTemplate(copy);
      showToast("success", "Template duplicated");
      refresh();
    } catch (err) {
      showToast("error", "Couldn't duplicate", err instanceof Error ? err.message : undefined);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteTemplate(confirmDelete._id);
      setConfirmDelete(null);
      showToast("success", "Template deleted");
      refresh();
    } catch (err) {
      showToast("error", "Couldn't delete", err instanceof Error ? err.message : undefined);
    }
  };

  if (view === "new" || view === "edit") {
    return (
      <div className="organizer-dashboard-container">
        <TemplateForm
          template={view === "edit" ? editing : null}
          onClose={() => { setView("list"); setEditing(null); }}
          onSaved={() => { setView("list"); setEditing(null); showToast("success", "Template saved"); refresh(); }}
        />
        {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
      </div>
    );
  }

  return (
    <div className="organizer-dashboard-container">
      <div className="dashboard-header-section">
        <div className="header-left">
          <h1 className="dashboard-title">Game Templates</h1>
          <p className="dashboard-subtitle">Save a game blueprint once — launch it any day in one tap. For games that repeat, set up a <strong>Recurring</strong> schedule instead.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setView("new"); }}>
          <span className="btn-icon">+ </span>New Template
        </button>
      </div>

      {loading ? (
        <div className="tmpl-empty">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="tmpl-empty">
          <div style={{ fontSize: 34, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ccc", marginBottom: 6 }}>No templates yet</div>
          <div style={{ marginBottom: 18 }}>Create one to skip filling the whole form every time.</div>
          <button className="btn-primary" onClick={() => setView("new")}><span className="btn-icon">+ </span>New Template</button>
        </div>
      ) : (
        <div className="tmpl-grid">
          {templates.map((t) => (
            <div key={t._id} className="tmpl-card">
                <div>
                  <h3 className="tmpl-card-title">{t.name}</h3>
                  <div className="tmpl-meta" style={{ marginTop: 8 }}>
                    <span className="tmpl-chip">{t.format || "6v6"}</span>
                    <span className="tmpl-chip">{rupees(t.feeInPaise)}</span>
                    <span className="tmpl-chip">🕒 {prettyTime(t.defaultTimeOfDay)}</span>
                    {turfName(t.turf) && <span className="tmpl-chip muted">📍 {turfName(t.turf)}</span>}
                    <span className="tmpl-chip muted">{t.visibility === "private" ? "🔒 Private" : "🌍 Public"}</span>
                  </div>
                </div>

                <div>
                  <div className="tmpl-quick-label" style={{ marginBottom: 7 }}>Create a game for</div>
                  <div className="tmpl-quick-row">
                    {[0, 1, 2].map((offset) => {
                      const date = dayOffsetToDate(offset);
                      return (
                        <button key={offset} className="tmpl-day-btn" onClick={() => askCreate(t, date)}>
                          {offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day after"}
                          <small>{prettyDay(date)}</small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="tmpl-date-row" style={{ marginTop: 8 }}>
                    <input
                      type="date"
                      min={dayOffsetToDate(0)}
                      onChange={(e) => { if (e.target.value) askCreate(t, e.target.value); }}
                    />
                    <span style={{ fontSize: 11.5, color: "#777" }}>or pick a date</span>
                  </div>
                </div>

                <div className="tmpl-actions">
                  <button className="tmpl-action-btn primary" onClick={() => customize(t, dayOffsetToDate(1))}>Customize</button>
                  <button className="tmpl-action-btn" onClick={() => { setEditing(t); setView("edit"); }}>Edit</button>
                  <button className="tmpl-action-btn" onClick={() => duplicate(t)}>Duplicate</button>
                  <button className="tmpl-action-btn danger" onClick={() => setConfirmDelete(t)}>Delete</button>
                </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        open={!!pending}
        title="Create this game?"
        message={pending
          ? `A ${pending.template.format || "6v6"} game "${pending.template.title || pending.template.name}" will be created for ${prettyDay(pending.dateYMD)} at ${prettyTime(pending.template.defaultTimeOfDay)}${turfName(pending.template.turf) ? `, ${turfName(pending.template.turf)}` : ""}. It opens for registration immediately.`
          : ""}
        confirmLabel="Create game"
        cancelLabel="Cancel"
        loading={creating}
        onConfirm={doCreate}
        onCancel={() => setPending(null)}
      />

      <ConfirmationModal
        open={!!confirmDelete}
        title="Delete template?"
        message={confirmDelete ? `"${confirmDelete.name}" will be removed. Games already created from it are not affected.` : ""}
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {toast && <Toast type={toast.type} title={toast.title} subtitle={toast.subtitle} onClose={hideToast} />}
    </div>
  );
}

// Turn an existing (populated) template into a save payload for duplication.
function templateToPayload(t: Template): Record<string, unknown> {
  const turfIdOf = (x: Template["turf"]) => (!x ? null : typeof x === "string" ? x : x._id);
  return {
    name: t.name,
    title: t.title || null,
    visibility: t.visibility || "public",
    requiresApproval: !!t.requiresApproval,
    turf: turfIdOf(t.turf),
    format: t.format || "6v6",
    defaultTimeOfDay: t.defaultTimeOfDay || "18:00",
    durationMins: t.durationMins ?? 60,
    reportingMinsBeforeGame: t.reportingMinsBeforeGame ?? 30,
    cutoffHoursBeforeGame: t.cutoffHoursBeforeGame ?? 2,
    feeInPaise: t.feeInPaise ?? 0,
    backoutFeeInPaise: t.backoutFeeInPaise ?? 0,
    minPlayers: t.minPlayers ?? 0,
    totalSlots: t.totalSlots ?? 0,
    allowSizeChange: !!t.allowSizeChange,
    organiserIsPlaying: !!t.organiserIsPlaying,
    automationEnabled: !!t.automationEnabled,
    firstCheckTime: t.firstCheckTime ?? null,
    secondCheckTime: t.secondCheckTime ?? null,
    alternateFormats: (t.alternateFormats || []).map((af) => ({
      format: af.format,
      turf: turfIdOf(af.turf),
      minPlayers: af.minPlayers,
      maxPlayers: af.maxPlayers,
      feeInPaise: af.feeInPaise ?? 0,
    })),
  };
}
