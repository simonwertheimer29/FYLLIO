"use client";

import { useState, useRef } from "react";
import type { NoShowsUserSession, RiskyAppt } from "../../lib/no-shows/types";
import { riskBgClass, riskLabel } from "../../lib/no-shows/score";
import AgendaCalendar from "./AgendaCalendar";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const MONTHS_ES  = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayIso(): string {
  const now = new Date();
  const dow = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - dow + 1);
  return mon.toISOString().slice(0, 10);
}

function offsetMondayIso(mondayIso: string, delta: number): string {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function weekLabel(mondayIso: string): string {
  const mon = new Date(mondayIso + "T12:00:00Z");
  const fri = new Date(mondayIso + "T12:00:00Z");
  fri.setUTCDate(fri.getUTCDate() + 4);
  return `${mon.getUTCDate()}–${fri.getUTCDate()} ${MONTHS_ES[mon.getUTCMonth()]} ${mon.getUTCFullYear()}`;
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function apptDurationMin(appt: RiskyAppt): number {
  if (!appt.end) return 30;
  const [eh, em] = appt.end.slice(11, 16).split(":").map(Number);
  const [sh, sm] = appt.start.slice(11, 16).split(":").map(Number);
  return Math.max(15, (eh * 60 + em) - (sh * 60 + sm));
}

function apptStartMin(appt: RiskyAppt): number {
  const [h, m] = appt.startDisplay.split(":").map(Number);
  return h * 60 + m;
}

function buildWhatsApp(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  const hora   = appt.startDisplay;
  const trat   = appt.treatmentName;
  if (appt.riskLevel === "HIGH")   return `Hola ${nombre}, queremos confirmar tu cita de ${trat} a las ${hora}. Por favor responde para confirmar. ¡Te esperamos!`;
  if (appt.riskLevel === "MEDIUM") return `Hola ${nombre}, te recordamos tu cita de ${trat} a las ${hora}. Responde OK para confirmar.`;
  return `Hola ${nombre}, recordatorio de tu cita de ${trat} a las ${hora}.`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PatientResult  = { id: string; nombre: string; telefono: string; clinica: string };
type NewApptState   = { dayIso: string; startMin: number; durationMin: number };

// ─── SidePanel ────────────────────────────────────────────────────────────────

function SidePanel({
  appt,
  onClose,
  onAction,
}: {
  appt: RiskyAppt;
  onClose: () => void;
  onAction: (id: string, estado: string) => void;
}) {
  const bgClass = riskBgClass(appt.riskLevel);
  const durationMin = apptDurationMin(appt);
  const endDisplay = minToHHMM(apptStartMin(appt) + durationMin);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-80 z-50 bg-white border-l border-slate-200 shadow-xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-800">{appt.patientName}</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 flex-1">
          {/* Treatment + time */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${bgClass}`}>
                {riskLabel(appt.riskLevel)} {appt.riskScore}
              </span>
              {!appt.confirmed && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 font-semibold">
                  Sin confirmar
                </span>
              )}
              {appt.confirmed && (
                <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 font-semibold">
                  Confirmada
                </span>
              )}
            </div>
            {appt.patientPhone && (
              <a href={`tel:${appt.patientPhone}`} className="text-xs text-cyan-700 hover:underline font-medium">
                {appt.patientPhone}
              </a>
            )}
            <p className="text-sm text-slate-700 font-semibold">{appt.treatmentName}</p>
            <p className="text-xs text-slate-500">
              {appt.startDisplay}–{endDisplay} · {durationMin} min
            </p>
            {appt.doctor && (
              <p className="text-xs text-slate-500">{appt.doctor}</p>
            )}
            {appt.clinica && (
              <p className="text-xs text-slate-400">{appt.clinica}</p>
            )}
          </div>

          {/* Risk factors */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1.5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Factores de riesgo</p>
            <div className="space-y-1 text-xs text-slate-600">
              {appt.riskFactors.historicalNoShowCount > 0 && (
                <p>{appt.riskFactors.historicalNoShowCount} no-show previo · tasa {Math.round(appt.riskFactors.historicalNoShowRate * 100)}%</p>
              )}
              {appt.riskFactors.historicalNoShowCount === 0 && appt.riskFactors.historicalTotalAppts === 0 && (
                <p className="text-slate-400">Sin historial previo</p>
              )}
              {appt.riskFactors.dayTimeLabel && (
                <p>{appt.riskFactors.dayTimeLabel}</p>
              )}
              {appt.riskFactors.daysSinceBooked > 7 && (
                <p>Reservado hace {appt.riskFactors.daysSinceBooked} días</p>
              )}
              {appt.riskFactors.treatmentRisk === "HIGH" && (
                <p>Tratamiento de riesgo alto</p>
              )}
            </div>
          </div>

          {appt.actionDeadline && (
            <div className={`rounded-xl px-3 py-2 text-xs ${appt.actionUrgent ? "bg-red-50 border border-red-200 text-red-700 font-semibold" : "bg-slate-50 border border-slate-200 text-slate-600"}`}>
              {appt.actionUrgent ? "⏰ Deadline urgente: " : "Deadline: "}
              {appt.actionDeadline.slice(11, 16)}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="p-4 border-t border-slate-100 space-y-2">
          {appt.patientPhone && (
            <div className="flex gap-2">
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                target="_blank" rel="noopener noreferrer"
                className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                WhatsApp
              </a>
              <a
                href={`tel:${appt.patientPhone}`}
                className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Llamar
              </a>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onAction(appt.id, "CONFIRMADO")}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Confirmar
            </button>
            <button
              onClick={() => onAction(appt.id, "NO_SHOW")}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
            >
              No-show
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── NewApptModal ─────────────────────────────────────────────────────────────

function NewApptModal({
  state,
  onClose,
  onCreated,
}: {
  state: NewApptState;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patientSearch, setPatientSearch]   = useState("");
  const [patients, setPatients]             = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [treatment, setTreatment]           = useState("");
  const [doctor, setDoctor]                 = useState("");
  const [startTime, setStartTime]           = useState(minToHHMM(state.startMin));
  const [endTime, setEndTime]               = useState(minToHHMM(state.startMin + state.durationMin));
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(v: string) {
    setPatientSearch(v);
    setSelectedPatient(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (v.length < 2) { setPatients([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/no-shows/agenda/pacientes-buscar?q=${encodeURIComponent(v)}`);
        if (res.ok) { const data = await res.json(); setPatients(data.patients ?? []); }
      } finally { setSearchLoading(false); }
    }, 350);
  }

  async function handleSubmit() {
    if (!patientSearch) { setError("Introduce el nombre del paciente"); return; }
    if (!startTime || !endTime) { setError("Introduce la hora de inicio y fin"); return; }
    setSubmitting(true);
    setError("");
    try {
      const si = `${state.dayIso}T${startTime}:00`;
      const ei = `${state.dayIso}T${endTime}:00`;
      const res = await fetch("/api/no-shows/agenda/nueva-cita", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startIso:        si,
          endIso:          ei,
          patientNombre:   selectedPatient?.nombre   ?? patientSearch,
          patientTelefono: selectedPatient?.telefono ?? "",
          treatmentName:   treatment || "Sin especificar",
          doctor:          doctor    || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Error al crear la cita");
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Error al crear");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">Nueva cita</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">✕</button>
        </div>

        {/* Fecha + hora editable */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500 font-medium">
          {state.dayIso}
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold text-slate-600">Inicio</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold text-slate-600">Fin</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
        </div>

        {/* Búsqueda paciente */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Paciente</label>
          <div className="relative">
            <input
              type="text"
              value={selectedPatient ? selectedPatient.nombre : patientSearch}
              onChange={(e) => { if (selectedPatient) setSelectedPatient(null); handleSearchChange(e.target.value); }}
              placeholder="Buscar por nombre o teléfono..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            {searchLoading && <span className="absolute right-3 top-2.5 text-xs text-slate-400">...</span>}
          </div>
          {patients.length > 0 && !selectedPatient && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {patients.map((p) => (
                <button key={p.id} type="button" onClick={() => { setSelectedPatient(p); setPatients([]); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                >
                  <p className="font-semibold text-slate-800">{p.nombre}</p>
                  <p className="text-slate-400">{p.telefono}{p.clinica ? ` · ${p.clinica}` : ""}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tratamiento */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Tratamiento</label>
          <input type="text" value={treatment} onChange={(e) => setTreatment(e.target.value)}
            placeholder="Ej: ortodoncia, revisión..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
          />
        </div>

        {/* Doctor */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Doctor (opcional)</label>
          <input type="text" value={doctor} onChange={(e) => setDoctor(e.target.value)}
            placeholder="Ej: Dra. García..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 transition-colors disabled:opacity-60"
        >
          {submitting ? "Creando..." : "Crear cita"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgendaView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  // ── Week / day state ──
  const [mondayIso, setMondayIso]               = useState<string>(getMondayIso);
  const [viewMode, setViewMode]                 = useState<"timeGridWeek" | "timeGridDay">("timeGridWeek");
  const [selectedDayOffset, setSelectedDayOffset] = useState(0);
  // Driven by FullCalendar's datesSet — source of truth for header label
  const [displayedMonday, setDisplayedMonday]   = useState<string>(getMondayIso);
  const [displayedLabel, setDisplayedLabel]     = useState<string>(() => weekLabel(getMondayIso()));
  const [displayRange, setDisplayRange]         = useState<string>(() => weekLabel(getMondayIso()));

  // ── Filter state ──
  const [clinicaFilter, setClinicaFilter]       = useState("");
  const [availableClinics, setAvailableClinics] = useState<string[]>([]);

  // ── Calendar refresh ──
  const [calRefreshKey, setCalRefreshKey]       = useState(0);

  // ── UI state ──
  const [selectedAppt, setSelectedAppt]         = useState<RiskyAppt | null>(null);
  const [newApptState, setNewApptState]         = useState<NewApptState | null>(null);
  const [toast, setToast]                       = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok = false) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  function goWeek(delta: number) {
    setMondayIso((w) => offsetMondayIso(w, delta));
  }

  // Day slots computed purely from mondayIso (no API data needed)
  const todayIso = new Date().toISOString().slice(0, 10);
  const daySlots = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mondayIso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return { dayIso: d.toISOString().slice(0, 10), num: d.getUTCDate() };
  });
  const isCurrentWeek = displayedMonday === getMondayIso();

  // In day mode, pass the specific day to FullCalendar navigation
  const calendarDate = viewMode === "timeGridDay"
    ? (daySlots[selectedDayOffset]?.dayIso ?? mondayIso)
    : mondayIso;

  async function handleSidePanelAction(id: string, estado: string) {
    setSelectedAppt(null);
    try {
      const res = await fetch(`/api/no-shows/agenda/${id}/mover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) throw new Error();
      showToast(estado === "CONFIRMADO" ? "Cita confirmada" : "Marcada como no-show", true);
      setCalRefreshKey((k) => k + 1);
    } catch {
      showToast("Error al actualizar la cita.");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full">

      {/* Toast */}
      {toast && (
        <div className={`rounded-2xl px-4 py-2 text-sm font-semibold ${toast.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2.5">

        {/* View toggle + Week nav + new button */}
        <div className="flex items-center gap-2">
          {/* View toggle — extremo izquierdo */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode("timeGridWeek")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "timeGridWeek" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >Sem.</button>
            <button
              onClick={() => setViewMode("timeGridDay")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "timeGridDay" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >Día</button>
          </div>
          {/* Navegación semana — centro */}
          <div className="flex-1 flex items-center justify-center gap-1">
            <button onClick={() => goWeek(-1)}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
            >←</button>
            <div className="text-center px-1">
              <p className="text-sm font-bold text-slate-900">{displayRange}</p>
              {isCurrentWeek && <p className="text-[10px] text-cyan-600 font-semibold">Semana actual</p>}
            </div>
            <button onClick={() => goWeek(1)}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
            >→</button>
          </div>
          {/* Nueva cita — extremo derecho */}
          <button
            onClick={() => setNewApptState({ dayIso: calendarDate, startMin: 10 * 60, durationMin: 45 })}
            className="w-10 h-10 rounded-xl bg-cyan-600 text-white text-xl font-bold hover:bg-cyan-700 transition-colors shrink-0 flex items-center justify-center"
            title="Nueva cita"
          >+</button>
        </div>

        {/* Day selector (day mode only) */}
        {viewMode === "timeGridDay" && (
          <div className="flex gap-1">
            {daySlots.map((slot, i) => (
              <button
                key={slot.dayIso}
                onClick={() => setSelectedDayOffset(i)}
                className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-colors ${
                  i === selectedDayOffset
                    ? "bg-cyan-600 text-white"
                    : slot.dayIso === todayIso
                    ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {DAYS_SHORT[i]} {slot.num}
              </button>
            ))}
          </div>
        )}

        {/* Clinic filter (manager only, populated dynamically) */}
        {isManager && availableClinics.length > 0 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {availableClinics.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {[
            { color: "#DC2626", label: "Alto" },
            { color: "#D97706", label: "Medio" },
            { color: "#16A34A", label: "Bajo" },
            { color: "#2563EB", label: "Confirmada" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-slate-400">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0 bg-emerald-100 border border-emerald-200" />
            <span className="text-[10px] text-slate-400">Hueco disponible</span>
          </div>
        </div>
      </div>

      {/* FullCalendar */}
      <AgendaCalendar
        user={user}
        week={mondayIso}
        calendarDate={calendarDate}
        viewMode={viewMode}
        clinicaFilter={clinicaFilter || undefined}
        refreshKey={calRefreshKey}
        onApptClick={setSelectedAppt}
        onNewAppt={(dayIso, startMin) => setNewApptState({ dayIso, startMin, durationMin: 45 })}
        onToast={showToast}
        onClinciasAvailable={isManager ? setAvailableClinics : undefined}
        onDatesSet={(start, end) => {
          // Fake-UTC: UTC components = Madrid local time
          const sD = start.getUTCDate(), sM = start.getUTCMonth(), sY = start.getUTCFullYear();
          const prev = new Date(end);
          prev.setUTCDate(prev.getUTCDate() - 1);
          const eD = prev.getUTCDate(), eM = prev.getUTCMonth(), eY = prev.getUTCFullYear();
          setDisplayRange(`${sD} ${MONTHS_ES[sM]} – ${eD} ${MONTHS_ES[eM]} ${eY}`);
          const mondayIso = `${sY}-${String(sM + 1).padStart(2, "0")}-${String(sD).padStart(2, "0")}`;
          setDisplayedMonday(mondayIso);
          setDisplayedLabel(`${sD}–${eD} ${MONTHS_ES[sM]} ${eY}`);
        }}
      />

      {/* SidePanel */}
      {selectedAppt && (
        <SidePanel
          appt={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onAction={handleSidePanelAction}
        />
      )}

      {/* NewApptModal */}
      {newApptState && (
        <NewApptModal
          state={newApptState}
          onClose={() => setNewApptState(null)}
          onCreated={() => setCalRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
