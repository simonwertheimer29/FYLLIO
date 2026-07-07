"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import type { NoShowsUserSession, RiskyAppt } from "../../lib/no-shows/types";
import { riskLabel } from "../../lib/no-shows/score";
import AgendaCalendar from "./AgendaCalendar";
import { useClinic } from "../../lib/context/ClinicContext";
import { ChevronLeft, ChevronRight, Clock, Plus, X, ICON_STROKE } from "../icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const MONTHS_ES  = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

type StaffEntry    = { id: string; nombre: string };
type ClinicaEntry  = { id: string; nombre: string; recordId: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayIso(): string {
  const now = new Date();
  const dow = now.getDay(); // 0=Dom, 6=Sáb
  const mon = new Date(now);
  if (dow === 6) {
    // Sábado → lunes siguiente (+2)
    mon.setDate(now.getDate() + 2);
  } else if (dow === 0) {
    // Domingo → lunes siguiente (+1)
    mon.setDate(now.getDate() + 1);
  } else {
    // Lun–Vie → lunes de esta semana
    mon.setDate(now.getDate() - dow + 1);
  }
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

// Versión tokenizada (con dark:) de riskBgClass de lib/no-shows/score.ts —
// solo presentación, mismos niveles.
const RISK_BADGE: Record<RiskyAppt["riskLevel"], string> = {
  HIGH:   "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-300",
  MEDIUM: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300",
  LOW:    "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/25 dark:text-emerald-300",
};

function SidePanel({
  appt,
  onClose,
  onAction,
}: {
  appt: RiskyAppt;
  onClose: () => void;
  onAction: (id: string, estado: string) => void;
}) {
  const bgClass = RISK_BADGE[appt.riskLevel];
  const durationMin = apptDurationMin(appt);
  const endDisplay = minToHHMM(apptStartMin(appt) + durationMin);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-80 z-50 bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">{appt.patientName}</p>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
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
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-full px-2 py-0.5 font-semibold">
                  Sin confirmar
                </span>
              )}
              {appt.confirmed && (
                <span className="text-xs text-[var(--color-accent)] bg-[var(--color-accent-soft)] border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] rounded-full px-2 py-0.5 font-semibold">
                  Confirmada
                </span>
              )}
            </div>
            {appt.patientPhone && (
              <a href={`tel:${appt.patientPhone}`} className="text-xs text-[var(--color-accent)] hover:underline font-medium">
                {appt.patientPhone}
              </a>
            )}
            <p className="text-sm text-[var(--color-foreground)] font-semibold">{appt.treatmentName}</p>
            <p className="text-xs text-[var(--color-muted)]">
              {appt.startDisplay}–{endDisplay} · {durationMin} min
            </p>
            {(appt.doctorNombre ?? appt.doctor) && (
              <p className="text-xs text-[var(--color-muted)]">{appt.doctorNombre ?? appt.doctor}</p>
            )}
            {appt.sillonNombre && (
              <p className="text-xs text-[var(--color-muted)]">{appt.sillonNombre}</p>
            )}
            {(appt.clinicaNombre ?? appt.clinica) && (
              <p className="text-xs text-[var(--color-muted)]">{appt.clinicaNombre ?? appt.clinica}</p>
            )}
          </div>

          {/* Risk factors */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 space-y-1.5">
            <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Factores de riesgo</p>
            <div className="space-y-1 text-xs text-[var(--color-foreground)]">
              {appt.riskFactors.historicalNoShowCount > 0 && (
                <p>{appt.riskFactors.historicalNoShowCount} no-show previo · tasa {Math.round(appt.riskFactors.historicalNoShowRate * 100)}%</p>
              )}
              {appt.riskFactors.historicalNoShowCount === 0 && appt.riskFactors.historicalTotalAppts === 0 && (
                <p className="text-[var(--color-muted)]">Sin historial previo</p>
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
            <div className={`rounded-xl px-3 py-2 text-xs ${appt.actionUrgent ? "bg-[var(--color-danger-soft)] border border-rose-200 dark:border-rose-500/25 text-[var(--color-danger)] font-semibold" : "bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--color-muted)]"}`}>
              {appt.actionUrgent ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  Plazo urgente: {appt.actionDeadline.slice(11, 16)}
                </span>
              ) : (
                <>Plazo: {appt.actionDeadline.slice(11, 16)}</>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="p-4 border-t border-[var(--color-border)] space-y-2">
          {appt.patientPhone && (
            <div className="flex gap-2">
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                target="_blank" rel="noopener noreferrer"
                className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
              >
                WhatsApp
              </a>
              <a
                href={`tel:${appt.patientPhone}`}
                className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
              >
                Llamar
              </a>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onAction(appt.id, "Confirmado")}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              Confirmar
            </button>
            <button
              onClick={() => onAction(appt.id, "Cancelado")}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/25 dark:text-rose-300 dark:hover:bg-rose-500/10 transition-colors"
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
      <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">Nueva cita</p>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]">
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {/* Fecha + hora editable */}
        <div className="rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] font-medium">
          {state.dayIso}
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold text-[var(--color-foreground)]">Inicio</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold text-[var(--color-foreground)]">Fin</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* Búsqueda paciente */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--color-foreground)]">Paciente</label>
          <div className="relative">
            <input
              type="text"
              value={selectedPatient ? selectedPatient.nombre : patientSearch}
              onChange={(e) => { if (selectedPatient) setSelectedPatient(null); handleSearchChange(e.target.value); }}
              placeholder="Buscar por nombre o teléfono…"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            {searchLoading && <span className="absolute right-3 top-2.5 text-xs text-[var(--color-muted)]">…</span>}
          </div>
          {patients.length > 0 && !selectedPatient && (
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
              {patients.map((p) => (
                <button key={p.id} type="button" onClick={() => { setSelectedPatient(p); setPatients([]); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-surface-muted)] transition-colors border-b border-[var(--color-border)] last:border-0"
                >
                  <p className="font-semibold text-[var(--color-foreground)]">{p.nombre}</p>
                  <p className="text-[var(--color-muted)]">{p.telefono}{p.clinica ? ` · ${p.clinica}` : ""}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tratamiento */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--color-foreground)]">Tratamiento</label>
          <input type="text" value={treatment} onChange={(e) => setTreatment(e.target.value)}
            placeholder="Ej: ortodoncia, revisión…"
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Doctor */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--color-foreground)]">Doctor (opcional)</label>
          <input type="text" value={doctor} onChange={(e) => setDoctor(e.target.value)}
            placeholder="Ej: Dra. García…"
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-bold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-60"
        >
          {submitting ? "Creando…" : "Crear cita"}
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

  // Sprint 7 Fase 5: filtro de clínica viene del ClinicContext global.
  const { selectedClinicaId } = useClinic();

  // ── Filter state ──
  const [availableClinics, setAvailableClinics]   = useState<string[]>([]);
  const [profesionalFilter, setProfesionalFilter] = useState("");
  const [clinicasDisponibles, setClinicasDisponibles] = useState<ClinicaEntry[]>([]);
  const [staffPorClinica, setStaffPorClinica]         = useState<Record<string, StaffEntry[]>>({});
  const [riskByDoctor, setRiskByDoctor]               = useState<Record<string, "high" | "medium">>({});

  // clinicaFilter (id lógico, ej "CLINIC_001") se deriva mapeando
  // selectedClinicaId (Airtable recordId).
  const clinicaFilter = useMemo(() => {
    if (!selectedClinicaId) return "";
    return clinicasDisponibles.find((c) => c.recordId === selectedClinicaId)?.id ?? "";
  }, [selectedClinicaId, clinicasDisponibles]);

  // ── Calendar refresh ──
  const [calRefreshKey, setCalRefreshKey]       = useState(0);

  // ── UI state ──
  const [selectedAppt, setSelectedAppt]         = useState<RiskyAppt | null>(null);
  const [newApptState, setNewApptState]         = useState<NewApptState | null>(null);

  // Carga clínicas + staff desde endpoints al montar
  useEffect(() => {
    async function loadMeta() {
      const [clinRes, staffRes] = await Promise.all([
        fetch("/api/no-shows/clinicas"),
        fetch("/api/no-shows/staff"),
      ]);
      if (clinRes.ok) {
        const d = await clinRes.json();
        setClinicasDisponibles(d.clinicas ?? []);
      }
      if (staffRes.ok) {
        const d = await staffRes.json();
        const byClinica: Record<string, StaffEntry[]> = {};
        for (const s of (d.staff ?? [])) {
          if (!s.clinicaRecordId) continue;
          // Salvaguarda client-side: excluir cualquier rol que contenga "recep"
          if (s.rol && String(s.rol).toLowerCase().includes("recep")) continue;
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaffPorClinica(byClinica);
      }
    }
    loadMeta();
  }, []);

  // Auto-select de clínica ya no se hace aquí — el ClinicContext se encarga
  // (coord fuerza su clínica al montar; admin empieza en "Todas").

  // Fetch acciones para risk dots en navbar de doctores
  useEffect(() => {
    fetch("/api/no-shows/acciones")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.tasks) return;
        const map: Record<string, "high" | "medium"> = {};
        for (const t of d.tasks) {
          const pid = t.appt?.profesionalId;
          if (!pid) continue;
          const score = t.scoreAccion ?? 0;
          if (score >= 60) map[pid] = "high";
          else if (score >= 30 && map[pid] !== "high") map[pid] = "medium";
        }
        setRiskByDoctor(map);
      })
      .catch(() => {});
  }, []);

  // Auto-select primer profesional tras loadMeta o cuando cambia la clínica
  // global. Resetea también el profesional seleccionado al cambiar de clínica.
  useEffect(() => {
    if (Object.keys(staffPorClinica).length === 0) return;
    const lista = selectedClinicaId
      ? (staffPorClinica[selectedClinicaId] ?? [])
      : Object.values(staffPorClinica).flat();
    setProfesionalFilter(lista[0]?.id ?? "");
  }, [staffPorClinica, selectedClinicaId]);

  function showToast(msg: string, ok = false) {
    if (ok) toast.success(msg);
    else toast.error(msg);
  }

  function goWeek(delta: number) {
    setMondayIso((w) => offsetMondayIso(w, delta));
  }

  // handleClinicaChange eliminado — la clínica se cambia desde el GlobalHeader.

  // Profesionales disponibles según clínica seleccionada.
  // staffPorClinica está indexado por Airtable recordId = selectedClinicaId del context.
  const allProfesionales = Object.values(staffPorClinica).flat();
  const profesionalesDisponibles = selectedClinicaId
    ? (staffPorClinica[selectedClinicaId] ?? [])
    : allProfesionales;

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
      showToast(estado === "Confirmado" ? "Cita confirmada" : "Marcada como cancelada", true);
      setCalRefreshKey((k) => k + 1);
    } catch {
      showToast("Error al actualizar la cita.");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full">

      {/* Header */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3 space-y-2.5">

        {/* View toggle + Week nav + new button */}
        <div className="flex items-center gap-2">
          {/* View toggle — extremo izquierdo */}
          <div className="flex rounded-xl border border-[var(--color-border)] overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode("timeGridWeek")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "timeGridWeek" ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"}`}
            >Sem.</button>
            <button
              onClick={() => setViewMode("timeGridDay")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "timeGridDay" ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"}`}
            >Día</button>
          </div>
          {/* Navegación semana — centro */}
          <div className="flex-1 flex items-center justify-center gap-1">
            <button onClick={() => goWeek(-1)}
              aria-label="Semana anterior"
              className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
            ><ChevronLeft size={16} strokeWidth={ICON_STROKE} aria-hidden /></button>
            <div className="text-center px-1">
              <p className="text-sm font-bold text-[var(--color-foreground)]">{displayRange}</p>
              {isCurrentWeek && <p className="text-[10px] text-[var(--color-accent)] font-semibold">Semana actual</p>}
            </div>
            <button onClick={() => goWeek(1)}
              aria-label="Semana siguiente"
              className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
            ><ChevronRight size={16} strokeWidth={ICON_STROKE} aria-hidden /></button>
          </div>
          {/* Nueva cita — extremo derecho */}
          <button
            onClick={() => setNewApptState({ dayIso: calendarDate, startMin: 10 * 60, durationMin: 45 })}
            className="w-10 h-10 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors shrink-0 flex items-center justify-center"
            title="Nueva cita"
            aria-label="Nueva cita"
          ><Plus size={18} strokeWidth={ICON_STROKE} aria-hidden /></button>
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
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : slot.dayIso === todayIso
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                    : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                {DAYS_SHORT[i]} {slot.num}
              </button>
            ))}
          </div>
        )}

        {/* NAVBAR CLÍNICAS eliminada — el selector de clínica vive en el
            GlobalHeader (Sprint 7 Fase 5). */}

        {/* NAVBAR DOCTORES */}
        {profesionalesDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {profesionalesDisponibles.map(p => {
              const risk = riskByDoctor[p.id];
              const isActive = profesionalFilter === p.id;
              return (
                <button key={p.id}
                  onClick={() => setProfesionalFilter(p.id)}
                  className={`shrink-0 flex items-center gap-1 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                    ${isActive
                      ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent)]"}`}>
                  {p.nombre}
                  {risk === "high" && (
                    <span className="inline-block w-2 h-2 bg-[var(--color-danger)] rounded-full mb-0.5 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
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
              <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0 bg-emerald-100 border border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/25" />
            <span className="text-[10px] text-[var(--color-muted)]">Hueco disponible</span>
          </div>
        </div>
      </div>

      {/* FullCalendar — solo si hay profesional seleccionado */}
      {profesionalFilter ? (
        <AgendaCalendar
          user={user}
          week={mondayIso}
          calendarDate={calendarDate}
          viewMode={viewMode}
          clinicaFilter={clinicaFilter || undefined}
          profesionalFilter={profesionalFilter}
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
      ) : (
        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-[var(--color-muted)] font-medium">Selecciona un profesional para ver su agenda</p>
        </div>
      )}

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
          onCreated={() => { setCalRefreshKey((k) => k + 1); toast.success("Cita creada"); }}
        />
      )}
    </div>
  );
}
