"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { NoShowsUserSession, RiskyAppt, GapSlot } from "../../lib/no-shows/types";
import type { AgendaDay } from "../../lib/no-shows/demo";
import { riskBgClass, riskLabel } from "../../lib/no-shows/score";

// ─── Constantes del calendario ────────────────────────────────────────────────

const PX_PER_MIN = 1.5;
const START_H = 9;
const END_H   = 19;
const START_MIN = START_H * 60;
const END_MIN   = END_H * 60;
const CAL_H   = (END_H - START_H) * 60 * PX_PER_MIN; // 900px
const MIN_BLOCK_H = 20;
const HOURS = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const MONTHS_ES  = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snap15(min: number) { return Math.round(min / 15) * 15; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(v, hi)); }

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

function topPx(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h * 60 + m) - START_MIN) * PX_PER_MIN;
}

function heightPx(durationMin: number): number {
  return Math.max(MIN_BLOCK_H, durationMin * PX_PER_MIN);
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

function apptColor(appt: RiskyAppt): string {
  if (appt.confirmed) return "#2563EB";
  if (appt.riskScore >= 61) return "#DC2626";
  if (appt.riskScore >= 31) return "#D97706";
  return "#16A34A";
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildWhatsApp(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (appt.riskLevel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} a las ${hora}. Por favor responde para confirmar. ¡Te esperamos!`;
  }
  if (appt.riskLevel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita de ${tratamiento} a las ${hora}. Responde OK para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita de ${tratamiento} a las ${hora}.`;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type PosOverride = { top: number; height: number };
type PatientResult = { id: string; nombre: string; telefono: string; clinica: string };
type NewApptState = { dayIso: string; startMin: number; durationMin: number };
type AgendaData = { week: string; days: AgendaDay[]; isDemo?: boolean };
type DragRef = {
  type: "drag" | "resize";
  apptId: string;
  dayIso: string;
  startClientY: number;
  origTopPx: number;
  origHeightPx: number;
  origStartMin: number;
  origDuration: number;
  currentTopPx: number;
  currentHeightPx: number;
};

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
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
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
            <div className="flex items-center gap-2">
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
            <p className="text-sm text-slate-700 font-semibold">{appt.treatmentName}</p>
            <p className="text-xs text-slate-500">
              {appt.startDisplay}–{endDisplay} · {durationMin} min
            </p>
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
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [treatment, setTreatment] = useState("");
  const [duration, setDuration] = useState(state.durationMin);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
        if (res.ok) {
          const data = await res.json();
          setPatients(data.patients ?? []);
        }
      } finally { setSearchLoading(false); }
    }, 350);
  }

  async function handleSubmit() {
    if (!patientSearch) { setError("Introduce el nombre del paciente"); return; }
    setSubmitting(true);
    setError("");
    try {
      const startMin = state.startMin;
      const endMin = startMin + duration;
      const si = `${state.dayIso}T${minToHHMM(startMin)}:00`;
      const ei = `${state.dayIso}T${minToHHMM(endMin)}:00`;
      const res = await fetch("/api/no-shows/agenda/nueva-cita", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startIso:       si,
          endIso:         ei,
          patientNombre:  selectedPatient?.nombre ?? patientSearch,
          patientTelefono: selectedPatient?.telefono ?? "",
          treatmentName:  treatment || "Sin especificar",
        }),
      });
      if (!res.ok) throw new Error("Error al crear la cita");
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >✕</button>
        </div>

        {/* Hora */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
          {state.dayIso} · {minToHHMM(state.startMin)} – {minToHHMM(state.startMin + duration)}
        </div>

        {/* Búsqueda paciente */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Paciente</label>
          <div className="relative">
            <input
              type="text"
              value={selectedPatient ? selectedPatient.nombre : patientSearch}
              onChange={(e) => {
                if (selectedPatient) { setSelectedPatient(null); }
                handleSearchChange(e.target.value);
              }}
              placeholder="Buscar por nombre o teléfono..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            {searchLoading && (
              <span className="absolute right-3 top-2.5 text-xs text-slate-400">...</span>
            )}
          </div>
          {patients.length > 0 && !selectedPatient && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {patients.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedPatient(p);
                    setPatients([]);
                  }}
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
          <input
            type="text"
            value={treatment}
            onChange={(e) => setTreatment(e.target.value)}
            placeholder="Ej: ortodoncia, revisión..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
          />
        </div>

        {/* Duración */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Duración</label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            {[15, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 transition-colors disabled:opacity-60"
        >
          {submitting ? "Creando..." : "Crear cita"}
        </button>
      </div>
    </div>
  );
}

// ─── ApptBlock ────────────────────────────────────────────────────────────────

function ApptBlock({
  appt,
  posOverride,
  onPointerDownBody,
  onPointerDownResize,
  onClick,
}: {
  appt: RiskyAppt;
  posOverride?: PosOverride;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownResize: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const top        = posOverride?.top    ?? topPx(appt.startDisplay);
  const height     = posOverride?.height ?? heightPx(apptDurationMin(appt));
  const color      = apptColor(appt);
  const nombre     = appt.patientName.split(" ")[0];
  const endDisplay = minToHHMM(apptStartMin(appt) + apptDurationMin(appt));

  if (top < 0 || top > CAL_H) return null;

  return (
    <div
      style={{ top, height, left: 2, right: 2, backgroundColor: color }}
      className="absolute rounded overflow-hidden text-white leading-none z-10 cursor-grab active:cursor-grabbing select-none"
      onPointerDown={onPointerDownBody}
      onClick={onClick}
    >
      <div className="px-1 pt-0.5 pointer-events-none">
        <p className="text-[9px] font-bold">{appt.startDisplay}–{endDisplay}</p>
        <p className="text-[10px] font-semibold truncate">{nombre}</p>
        {height > 36 && (
          <p className="text-[9px] opacity-80 truncate">
            {appt.treatmentName.length > 14 ? appt.treatmentName.slice(0, 13) + "…" : appt.treatmentName}
          </p>
        )}
      </div>
      {/* Resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-black/20 transition-colors"
        onPointerDown={(e) => { e.stopPropagation(); onPointerDownResize(e); }}
      />
    </div>
  );
}

// ─── GapBlock ─────────────────────────────────────────────────────────────────

function GapBlock({ gap, onClick }: { gap: GapSlot; onClick: () => void }) {
  const top    = topPx(gap.startDisplay);
  const height = heightPx(gap.durationMin);
  if (top < 0 || top > CAL_H) return null;
  return (
    <div
      style={{ top, height, left: 2, right: 2 }}
      className="absolute rounded border border-dashed border-green-300 bg-green-50 flex items-center justify-center overflow-hidden z-0 cursor-pointer hover:bg-green-100 transition-colors"
      onClick={onClick}
      title={`Hueco ${gap.startDisplay}–${gap.endDisplay} · Clic para nueva cita`}
    >
      {height > 28 && (
        <span className="text-[9px] text-green-600 text-center px-0.5 leading-tight pointer-events-none">
          + Cita<br />{gap.durationMin}m
        </span>
      )}
    </div>
  );
}

// ─── CalendarDayColumn ────────────────────────────────────────────────────────

function CalendarDayColumn({
  dayLabel,
  dayNum,
  dayData,
  posOverrides,
  isToday,
  onApptPointerDown,
  onApptResizeDown,
  onApptClick,
  onGapClick,
  wide,
}: {
  dayLabel: string;
  dayNum: number;
  dayData: AgendaDay;
  posOverrides: Record<string, PosOverride>;
  isToday: boolean;
  onApptPointerDown: (e: React.PointerEvent, appt: RiskyAppt) => void;
  onApptResizeDown: (e: React.PointerEvent, appt: RiskyAppt) => void;
  onApptClick: (appt: RiskyAppt) => void;
  onGapClick: (gap: GapSlot) => void;
  wide?: boolean;
}) {
  return (
    <div className="flex-1 min-w-0" style={{ minWidth: wide ? 200 : 80 }}>
      {/* Day header */}
      <div className={`text-center pb-1.5 border-b ${isToday ? "border-cyan-400" : "border-slate-200"}`}>
        <p className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? "text-cyan-700" : "text-slate-500"}`}>
          {dayLabel}
        </p>
        <p className={`text-sm font-extrabold leading-none mt-0.5 ${isToday ? "text-cyan-700" : "text-slate-800"}`}>
          {dayNum}
        </p>
      </div>

      {/* Calendar body */}
      <div className="relative border-l border-slate-100" style={{ height: CAL_H }}>
        {/* Hour grid lines */}
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-slate-100"
            style={{ top: (h - START_H) * 60 * PX_PER_MIN }}
          />
        ))}
        {/* Gap blocks */}
        {dayData.gaps.map((g) => (
          <GapBlock key={g.startIso} gap={g} onClick={() => onGapClick(g)} />
        ))}
        {/* Appointment blocks */}
        {dayData.appointments.map((a) => (
          <ApptBlock
            key={a.id}
            appt={a}
            posOverride={posOverrides[a.id]}
            onPointerDownBody={(e) => onApptPointerDown(e, a)}
            onPointerDownResize={(e) => onApptResizeDown(e, a)}
            onClick={() => onApptClick(a)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgendaView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  // ── Core data ──
  const [mondayIso, setMondayIso] = useState<string>(getMondayIso);
  const [data, setData]           = useState<AgendaData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState("");

  // ── View mode ──
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0=Lun … 4=Vie

  // ── DnD state ──
  const [posOverrides, setPosOverrides] = useState<Record<string, PosOverride>>({});
  const dragRef = useRef<DragRef | null>(null);
  const wasDraggedRef = useRef<Set<string>>(new Set());

  // ── UI state ──
  const [selectedAppt, setSelectedAppt] = useState<RiskyAppt | null>(null);
  const [newApptState, setNewApptState] = useState<NewApptState | null>(null);
  const [actionMsg, setActionMsg] = useState("");

  // Stable refs for use in pointer event handlers
  const mondayIsoRef = useRef(mondayIso);
  const clinicaFilterRef = useRef(clinicaFilter);
  const loadRef = useRef<((m: string, c?: string) => Promise<void>) | null>(null);

  useEffect(() => { mondayIsoRef.current = mondayIso; }, [mondayIso]);
  useEffect(() => { clinicaFilterRef.current = clinicaFilter; }, [clinicaFilter]);

  const load = useCallback(async (monday: string, clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/agenda", location.href);
      url.searchParams.set("week", monday);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    load(mondayIso, clinicaFilter || undefined);
  }, [load, mondayIso, clinicaFilter]);

  // ── Global pointer event handlers for DnD ──
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaY = e.clientY - d.startClientY;
      const deltaMins = deltaY / PX_PER_MIN;

      let newTop: number, newHeight: number;
      if (d.type === "drag") {
        const ns = snap15(d.origStartMin + deltaMins);
        const cns = clamp(ns, START_MIN, END_MIN - d.origDuration);
        newTop    = (cns - START_MIN) * PX_PER_MIN;
        newHeight = d.origHeightPx;
      } else {
        const ne  = snap15(d.origStartMin + d.origDuration + deltaMins);
        const cne = clamp(ne, d.origStartMin + 15, END_MIN);
        newTop    = d.origTopPx;
        newHeight = Math.max(MIN_BLOCK_H, (cne - d.origStartMin) * PX_PER_MIN);
      }
      d.currentTopPx    = newTop;
      d.currentHeightPx = newHeight;

      setPosOverrides((prev) => ({ ...prev, [d.apptId]: { top: newTop, height: newHeight } }));
    };

    const onUp = async () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      document.body.style.cursor = "";

      const moved =
        Math.abs(d.currentTopPx    - d.origTopPx)    > PX_PER_MIN * 4 ||
        Math.abs(d.currentHeightPx - d.origHeightPx) > PX_PER_MIN * 4;

      setPosOverrides((prev) => { const n = { ...prev }; delete n[d.apptId]; return n; });

      if (!moved) return;

      wasDraggedRef.current.add(d.apptId);
      setTimeout(() => wasDraggedRef.current.delete(d.apptId), 200);

      const ns = Math.round(d.currentTopPx / PX_PER_MIN) + START_MIN;
      const ne = Math.round((d.currentTopPx + d.currentHeightPx) / PX_PER_MIN) + START_MIN;
      const pad = (n: number) => String(n).padStart(2, "0");
      const si = `${d.dayIso}T${pad(Math.floor(ns / 60))}:${pad(ns % 60)}:00`;
      const ei = `${d.dayIso}T${pad(Math.floor(ne / 60))}:${pad(ne % 60)}:00`;

      try {
        const res = await fetch(`/api/no-shows/agenda/${d.apptId}/mover`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startIso: si, endIso: ei }),
        });
        if (!res.ok) throw new Error();
      } catch { /* silent rollback via reload */ }
      // Always reload to sync state
      await loadRef.current?.(mondayIsoRef.current, clinicaFilterRef.current || undefined);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ── Handlers ──

  function handleApptPointerDown(e: React.PointerEvent, appt: RiskyAppt, type: "drag" | "resize") {
    e.preventDefault();
    const origTopPx    = topPx(appt.startDisplay);
    const origHeightPx = heightPx(apptDurationMin(appt));
    const origStartMin = apptStartMin(appt);
    const origDuration = apptDurationMin(appt);
    dragRef.current = {
      type, apptId: appt.id, dayIso: appt.dayIso,
      startClientY: e.clientY,
      origTopPx, origHeightPx, origStartMin, origDuration,
      currentTopPx: origTopPx, currentHeightPx: origHeightPx,
    };
    document.body.style.cursor = type === "drag" ? "grabbing" : "ns-resize";
  }

  function handleApptClick(appt: RiskyAppt) {
    if (wasDraggedRef.current.has(appt.id)) return;
    setSelectedAppt(appt);
  }

  function handleGapClick(gap: GapSlot) {
    const [h, m] = gap.startDisplay.split(":").map(Number);
    setNewApptState({
      dayIso: gap.dayIso,
      startMin: h * 60 + m,
      durationMin: Math.min(gap.durationMin, 60),
    });
  }

  async function handleSidePanelAction(id: string, estado: string) {
    setSelectedAppt(null);
    try {
      await fetch(`/api/no-shows/agenda/${id}/mover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      setActionMsg(estado === "CONFIRMADO" ? "Cita confirmada" : "Marcada como no-show");
      setTimeout(() => setActionMsg(""), 2500);
      load(mondayIso, clinicaFilter || undefined);
    } catch { /* silent */ }
  }

  function goWeek(delta: number) {
    setMondayIso((w) => offsetMondayIso(w, delta));
  }

  // ── Loading / error states ──

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
          <div className="h-20 bg-slate-100 rounded-2xl" />
          <div className="h-64 bg-slate-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-slate-500">Error cargando datos. Intenta refrescar.</p>
      </div>
    );
  }

  // Build 5 day slots
  const todayIso = new Date().toISOString().slice(0, 10);
  const daySlots = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mondayIso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const found = data.days.find((day) => day.dayIso === iso);
    return { dayIso: iso, dayData: found ?? { dayIso: iso, appointments: [], gaps: [] }, num: d.getUTCDate() };
  });

  const clinicas = isManager
    ? [...new Set(data.days.flatMap((d) => d.appointments.map((a) => a.clinica)).filter(Boolean) as string[])].sort()
    : [];

  const totalAppts = data.days.reduce((s, d) => s + d.appointments.length, 0);
  const highCount  = data.days.reduce((s, d) => s + d.appointments.filter((a) => a.riskScore >= 61).length, 0);
  const isCurrentWeek = mondayIso === getMondayIso();

  // Columnas visibles según viewMode
  const visibleSlots = viewMode === "week"
    ? daySlots
    : [daySlots[selectedDayOffset]];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full">

      {/* Action flash message */}
      {actionMsg && (
        <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800 font-semibold">
          {actionMsg}
        </div>
      )}

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales. El DnD no persiste en modo demo.
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2.5">
        {/* Week navigation + view toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => goWeek(-1)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
          >←</button>
          <div className="flex-1 text-center">
            <p className="text-sm font-bold text-slate-900">{weekLabel(mondayIso)}</p>
            {isCurrentWeek && (
              <p className="text-[10px] text-cyan-600 font-semibold">Semana actual</p>
            )}
          </div>
          <button
            onClick={() => goWeek(1)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
          >→</button>
          {/* View toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode("week")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "week" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >Sem.</button>
            <button
              onClick={() => setViewMode("day")}
              className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${viewMode === "day" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >Día</button>
          </div>
        </div>

        {/* Day selector (day mode only) */}
        {viewMode === "day" && (
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

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span><span className="font-bold text-slate-800">{totalAppts}</span> citas</span>
          {highCount > 0 && (
            <span className="text-red-700 font-semibold">⚠️ {highCount} riesgo alto</span>
          )}
          <button
            onClick={() => load(mondayIso, clinicaFilter || undefined)}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >↻</button>
        </div>

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
            <div className="w-2.5 h-2.5 rounded-sm shrink-0 border border-dashed border-green-400 bg-green-50" />
            <span className="text-[10px] text-slate-400">Hueco (clic → nueva cita)</span>
          </div>
        </div>

        {/* Clinic filter */}
        {isManager && clinicas.length > 0 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Calendar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3 overflow-x-auto">
        <div style={{ minWidth: viewMode === "week" ? 440 : 260 }} className="flex">
          {/* Time gutter */}
          <div className="shrink-0 relative" style={{ width: 36 }}>
            <div style={{ height: 40 }} />
            <div className="relative" style={{ height: CAL_H }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[9px] text-slate-400 font-mono leading-none"
                  style={{ top: (h - START_H) * 60 * PX_PER_MIN - 5 }}
                >
                  {h}:00
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          <div className="flex flex-1 gap-0">
            {visibleSlots.map((slot, i) => {
              const offsetIdx = viewMode === "week" ? i : selectedDayOffset;
              return (
                <CalendarDayColumn
                  key={slot.dayIso}
                  dayLabel={DAYS_SHORT[offsetIdx]}
                  dayNum={slot.num}
                  dayData={slot.dayData}
                  posOverrides={posOverrides}
                  isToday={slot.dayIso === todayIso}
                  wide={viewMode === "day"}
                  onApptPointerDown={(e, appt) => handleApptPointerDown(e, appt, "drag")}
                  onApptResizeDown={(e, appt) => handleApptPointerDown(e, appt, "resize")}
                  onApptClick={handleApptClick}
                  onGapClick={handleGapClick}
                />
              );
            })}
          </div>
        </div>
      </div>

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
          onCreated={() => load(mondayIso, clinicaFilter || undefined)}
        />
      )}
    </div>
  );
}
