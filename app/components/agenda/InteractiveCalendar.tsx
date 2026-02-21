"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useState, useEffect } from "react";
import { DateTime } from "luxon";

type Appt = {
  id: string;
  recordId: string;
  start: string; // Madrid naive ISO "YYYY-MM-DDTHH:mm:ss"
  end: string;
  patientName: string;
  type: string;
  durationMin?: number;
  status?: string;
  nombre?: string;   // Citas."Nombre" — block title
  notes?: string;    // Citas."Notas"
  isBlock?: boolean; // true = no patient linked = internal block
};

type GapInfo = {
  dayIso: string;
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
  durationMin: number;
};

type Treatment = { id: string; name: string; duration: number };

type Schedule = {
  lunchStart?: string | null;
  lunchEnd?: string | null;
};

type Props = {
  staffId: string;
  week: string; // YYYY-MM-DD (Monday)
  staffRecordId?: string; // Airtable record ID for the Profesional link
};

// ── Color helper ──────────────────────────────────────────────────────────────
function eventColors(appt: Appt): { bg: string; border: string; text: string } {
  if (appt.isBlock) {
    const n = (appt.nombre ?? "").toLowerCase();
    if (
      n.includes("descanso") ||
      n.includes("almuerzo") ||
      n.includes("pausa") ||
      n.includes("comida")
    ) {
      return { bg: "#7c3aed", border: "#6d28d9", text: "#fff" }; // purple
    }
    return { bg: "#d97706", border: "#b45309", text: "#fff" }; // amber
  }
  return { bg: "#3b82f6", border: "#2563eb", text: "#fff" }; // blue
}

// Convert JS Date → UTC ISO string for Airtable PATCH
function toUtcIso(d: Date) {
  return d.toISOString();
}

async function patchAppt(recordId: string, data: { startIso?: string; endIso?: string; notes?: string }) {
  const res = await fetch(`/api/db/appointments/${recordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function deleteAppt(recordId: string) {
  const res = await fetch(`/api/db/appointments/${recordId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({
  appt,
  onClose,
  onSaved,
}: {
  appt: Appt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await patchAppt(appt.recordId, { notes });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!confirm("¿Confirmas la cancelación de esta cita?")) return;
    setCancelling(true);
    setError(null);
    try {
      await deleteAppt(appt.recordId);
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Error al cancelar");
    } finally {
      setCancelling(false);
    }
  }

  const timeStr = (iso: string) => iso.slice(11, 16);
  const dateStr = (iso: string) =>
    new Date(iso + "Z").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  const title = appt.nombre || (appt.isBlock ? "Bloque" : appt.patientName);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {!appt.isBlock && <p className="text-sm text-slate-500">{appt.type}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
          <p>📅 {dateStr(appt.start)}</p>
          <p>🕐 {timeStr(appt.start)} – {timeStr(appt.end)}</p>
          {appt.durationMin && <p>⏱ {appt.durationMin} min</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Añadir nota..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-sky-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex-1 bg-red-50 text-red-600 border border-red-200 rounded-xl py-2 text-sm font-semibold hover:bg-red-100 disabled:opacity-50"
          >
            {cancelling ? "Cancelando..." : "Cancelar cita"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New appointment modal ─────────────────────────────────────────────────────
function NewApptModal({
  start,
  end,
  staffId,
  staffRecordId,
  onClose,
  onSaved,
}: {
  start: Date;
  end: Date;
  staffId: string;
  staffRecordId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patientName, setPatientName] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/db/treatments")
      .then((r) => r.json())
      .then((j) => setTreatments(j.treatments ?? []))
      .catch(() => {});
  }, []);

  async function handleCreate() {
    if (!patientName.trim()) { setError("Nombre del paciente requerido"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/db/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: patientName,
          startIso: toUtcIso(start),
          endIso: toUtcIso(end),
          staffRecordId,
          treatmentRecordId: treatmentId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Error al crear");
    } finally {
      setSaving(false);
    }
  }

  const fmt = (d: Date) =>
    d.toLocaleString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">Nueva cita</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <p>📅 {fmt(start)} – {end.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Paciente</label>
            <input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Nombre del paciente"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Tratamiento</label>
            <select
              value={treatmentId}
              onChange={(e) => setTreatmentId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
            >
              <option value="">— Sin especificar —</option>
              {treatments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.duration ? ` (${t.duration} min)` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 bg-sky-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Creando..." : "Crear cita"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function InteractiveCalendar({ staffId, week, staffRecordId }: Props) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [gaps, setGaps] = useState<GapInfo[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGaps, setShowGaps] = useState(true);
  const [editAppt, setEditAppt] = useState<Appt | null>(null);
  const [newSlot, setNewSlot] = useState<{ start: Date; end: Date } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [weekRes, gapsRes] = await Promise.all([
        fetch(`/api/db/week?staffId=${staffId}&week=${week}`, { cache: "no-store" }),
        fetch(`/api/db/gaps?staffId=${staffId}&week=${week}`, { cache: "no-store" }),
      ]);
      const weekJson = await weekRes.json();
      const gapsJson = await gapsRes.json();
      setAppts(weekJson.appointments ?? []);
      setSchedule(weekJson.schedule ?? null);
      setGaps(gapsJson.gaps ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (staffId && week) load();
  }, [staffId, week]);

  const apptEvents = appts.map((a) => {
    const colors = eventColors(a);
    const title = a.isBlock
      ? (a.nombre || "Bloque")
      : `${a.patientName}\n${a.type}`;
    return {
      id: a.recordId,
      title,
      start: a.start,
      end: a.end,
      extendedProps: { appt: a },
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
    };
  });

  const gapEvents = showGaps
    ? gaps.map((g) => ({
        id: `gap-${g.dayIso}-${g.start}`,
        start: `${g.dayIso}T${g.start}:00`,
        end: `${g.dayIso}T${g.end}:00`,
        display: "background" as const,
        backgroundColor: "#bbf7d0", // green-200
        extendedProps: { isGap: true, durationMin: g.durationMin },
      }))
    : [];

  // Lunch background bands (violet-100) Mon–Fri
  const lunchEvents =
    schedule?.lunchStart && schedule?.lunchEnd
      ? [0, 1, 2, 3, 4].map((d) => {
          const dayIso = DateTime.fromISO(week).plus({ days: d }).toISODate()!;
          return {
            id: `lunch-${dayIso}`,
            start: `${dayIso}T${schedule.lunchStart}:00`,
            end: `${dayIso}T${schedule.lunchEnd}:00`,
            display: "background" as const,
            backgroundColor: "#ede9fe", // violet-100
          };
        })
      : [];

  const allEvents = [...apptEvents, ...gapEvents, ...lunchEvents];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Calendar toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
          {loading && <span>Cargando...</span>}
          {!loading && gaps.length > 0 && (
            <span>
              {gaps.length} {gaps.length === 1 ? "franja disponible" : "franjas disponibles"} esta semana
            </span>
          )}
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500 inline-block" /> Cita</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500 inline-block" /> Interno</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-600 inline-block" /> Descanso</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-300 inline-block" /> Franja disponible</span>
        </div>
        <button
          onClick={() => setShowGaps((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
            showGaps
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
              : "text-slate-500 border-slate-200 hover:bg-slate-50"
          }`}
        >
          {showGaps ? "🟢 Ocultar franjas" : "🟢 Mostrar franjas disponibles"}
        </button>
      </div>

      <div className="p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          timeZone="Europe/Madrid"
          locale="es"
          firstDay={1}
          initialDate={week}
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          height="auto"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay",
          }}
          buttonText={{ today: "Hoy", week: "Semana", day: "Día" }}
          events={allEvents}
          editable={true}
          selectable={true}
          selectMirror={true}
          eventClick={(info) => {
            if (info.event.extendedProps.isGap) return;
            setEditAppt(info.event.extendedProps.appt as Appt);
          }}
          select={(info) => {
            setNewSlot({ start: info.start, end: info.end });
          }}
          eventDrop={async (info) => {
            const recordId = info.event.id;
            try {
              await patchAppt(recordId, {
                startIso: toUtcIso(info.event.start!),
                endIso: toUtcIso(info.event.end!),
                ...(staffRecordId ? { staffRecordId } : {}),
              });
              load();
            } catch (e) {
              console.error("eventDrop failed", e);
              info.revert();
            }
          }}
          eventResize={async (info) => {
            const recordId = info.event.id;
            try {
              await patchAppt(recordId, {
                startIso: toUtcIso(info.event.start!),
                endIso: toUtcIso(info.event.end!),
                ...(staffRecordId ? { staffRecordId } : {}),
              });
              load();
            } catch (e) {
              console.error("eventResize failed", e);
              info.revert();
            }
          }}
        />
      </div>

      {editAppt && (
        <EditModal
          appt={editAppt}
          onClose={() => setEditAppt(null)}
          onSaved={() => { setEditAppt(null); load(); }}
        />
      )}

      {newSlot && (
        <NewApptModal
          start={newSlot.start}
          end={newSlot.end}
          staffId={staffId}
          staffRecordId={staffRecordId}
          onClose={() => setNewSlot(null)}
          onSaved={() => { setNewSlot(null); load(); }}
        />
      )}
    </div>
  );
}
