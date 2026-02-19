"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useState, useEffect } from "react";

type Appt = {
  id: string;
  recordId: string;
  start: string; // Madrid naive ISO "YYYY-MM-DDTHH:mm:ss"
  end: string;
  patientName: string;
  type: string;
  durationMin?: number;
  status?: string;
};

type Props = {
  staffId: string;
  week: string; // YYYY-MM-DD (Monday)
};

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
  const [notes, setNotes] = useState("");
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{appt.patientName}</h3>
            <p className="text-sm text-slate-500">{appt.type}</p>
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
  onClose,
  onSaved,
}: {
  start: Date;
  end: Date;
  staffId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patientName, setPatientName] = useState("");
  const [treatment, setTreatment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <input
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Ej: Limpieza, Ortodoncia..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
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
export default function InteractiveCalendar({ staffId, week }: Props) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAppt, setEditAppt] = useState<Appt | null>(null);
  const [newSlot, setNewSlot] = useState<{ start: Date; end: Date } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/db/week?staffId=${staffId}&week=${week}`, { cache: "no-store" });
      const json = await res.json();
      setAppts(json.appointments ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (staffId && week) load();
  }, [staffId, week]);

  const events = appts.map((a) => ({
    id: a.recordId,
    title: `${a.patientName}\n${a.type}`,
    start: a.start,
    end: a.end,
    extendedProps: { appt: a },
    backgroundColor: "#3b82f6",
    borderColor: "#2563eb",
    textColor: "#fff",
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {loading && (
        <div className="px-6 py-3 border-b border-slate-100 text-sm text-slate-500">
          Cargando agenda...
        </div>
      )}

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
          events={events}
          editable={true}
          selectable={true}
          selectMirror={true}
          eventClick={(info) => {
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
          onClose={() => setNewSlot(null)}
          onSaved={() => { setNewSlot(null); load(); }}
        />
      )}
    </div>
  );
}
