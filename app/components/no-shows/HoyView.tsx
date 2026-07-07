"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../lib/no-shows/types";
import { riskColor } from "../../lib/no-shows/score";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCard } from "../ui/KpiCard";
import { StatePill } from "../ui/StatePill";
import { ErrorState, EmptyState } from "../ui/Feedback";
import { ArrowRight, Calendar, Check, Clock, Info, RefreshCw, ICON_STROKE } from "../icons";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type HoyData = {
  todayIso: string;
  todayLabel: string;
  appointments: RiskyAppt[];
  gaps: GapSlot[];
  recalls: RecallAlert[];
  summary: {
    total: number;
    confirmed: number;
    riesgoAlto: number;
    riesgoMedio: number;
    riesgoBajo: number;
    recalls: number;
    eurosEnRiesgo?: number;
    objetivoMensual?: number;
  };
  isDemo?: boolean;
};

type StaffEntry = { id: string; nombre: string };

// ─── WhatsApp helpers ─────────────────────────────────────────────────────────

function buildWhatsApp(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (appt.riskLevel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} hoy a las ${hora}. Por favor responde este mensaje para confirmar o llámanos. ¡Te esperamos!`;
  }
  if (appt.riskLevel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita de ${tratamiento} a las ${hora}. Responde "OK" para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita a las ${hora} para ${tratamiento}.`;
}

// ─── computeGaps ─────────────────────────────────────────────────────────────

function computeGaps(appts: RiskyAppt[], todayIso: string): GapSlot[] {
  const WORK_START = 9 * 60, WORK_END = 19 * 60, MIN_GAP = 30;
  function toMin(iso: string): number {
    if (!iso) return 0;
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }
  const occupied = appts
    .filter(a => a.start && a.end)
    .map(a => ({ start: toMin(a.start), end: toMin(a.end) }))
    .sort((a, b) => a.start - b.start);
  const gaps: GapSlot[] = [];
  let cursor = WORK_START;
  for (const b of occupied) {
    if (b.start > cursor && b.start - cursor >= MIN_GAP) {
      const sm = cursor, em = Math.min(b.start, WORK_END);
      gaps.push({
        dayIso: todayIso,
        startIso: "", endIso: "",
        startDisplay: `${String(Math.floor(sm / 60)).padStart(2, "0")}:${String(sm % 60).padStart(2, "0")}`,
        endDisplay: `${String(Math.floor(em / 60)).padStart(2, "0")}:${String(em % 60).padStart(2, "0")}`,
        durationMin: em - sm,
      });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (WORK_END - cursor >= MIN_GAP) {
    gaps.push({
      dayIso: todayIso, startIso: "", endIso: "",
      startDisplay: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
      endDisplay: "19:00",
      durationMin: WORK_END - cursor,
    });
  }
  return gaps;
}

// ─── Pill navbars helper ───────────────────────────────────────────────────────

const PILL_SCROLL = "flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

// ─── ApptRow ──────────────────────────────────────────────────────────────────

function ApptRow({
  appt, done, onDone, onNavigate,
}: {
  appt: RiskyAppt; done: boolean;
  onDone: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const color = riskColor(appt.riskLevel);
  const score = appt.scoreAccion ?? appt.riskScore;
  const scoreColorClass =
    score >= 80 ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25" :
    score >= 60 ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25" :
    score >= 40 ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]" :
                  "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border-[var(--color-border)]";

  return (
    <button
      onClick={() => onNavigate(appt.id)}
      className={`w-full text-left border-l-4 pl-3 py-2 rounded-r-xl transition-opacity hover:bg-[var(--color-surface-muted)] ${done ? "opacity-40" : ""}`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-[var(--color-muted)] w-12 shrink-0">{appt.startDisplay}</span>
            <span className="text-sm font-semibold text-[var(--color-foreground)] truncate">{appt.patientName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreColorClass}`}>
              {score}
            </span>
            {!appt.confirmed && (
              <StatePill variant="warning">Sin confirmar</StatePill>
            )}
            {appt.actionUrgent && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-danger)] font-bold">
                <Clock size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Urgente
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-0.5 ml-14">
            {appt.treatmentName}
            {appt.riskFactors.dayTimeLabel ? ` · ${appt.riskFactors.dayTimeLabel}` : ""}
            {appt.riskFactors.historicalNoShowCount > 0
              ? ` · ${appt.riskFactors.historicalNoShowCount} no-show prev.`
              : ""}
          </p>
        </div>
        {!done && isEnRiesgo(appt) && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            {appt.patientPhone && (
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white text-[10px] font-bold hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
              >WA</a>
            )}
            {appt.patientPhone && (
              <a href={`tel:${appt.patientPhone}`}
                className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-[10px] hover:bg-[var(--color-surface-muted)] transition-colors"
              >Tel</a>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDone(appt.id); }}
              className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
              title="Marcar hecho"
            ><Check size={12} strokeWidth={ICON_STROKE} aria-hidden /></button>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── 4 Metric Cards ───────────────────────────────────────────────────────────

function MetricCards({ total, confirmed, enRiesgo, euros, label }: {
  total: number; confirmed: number; enRiesgo: number; euros: number; label: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KpiCard label={label} value={total} accent="neutral" />
      <KpiCard label="Confirmadas" value={confirmed} accent="emerald" />
      <KpiCard label="En riesgo" value={enRiesgo} accent="rose" />
      <KpiCard label="€ en riesgo" value={euros} accent="amber" formatter={(n) => `€${n.toLocaleString("es-ES")}`} />
    </div>
  );
}

// ─── Constantes de riesgo ─────────────────────────────────────────────────────

const RIESGO_THRESHOLD = 40;
const AVG_TICKET = 85;
const isEnRiesgo = (a: RiskyAppt) => (a.scoreAccion ?? a.riskScore) >= RIESGO_THRESHOLD;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HoyView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const router = useRouter();

  // Sprint 7 Fase 5: filtro de clínica viene del ClinicContext global.
  // clinicaFilter (logical id) se deriva mapeando selectedClinicaId (recordId).
  const { selectedClinicaId, setSelectedClinicaId } = useClinic();

  const [data, setData] = useState<HoyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMañana, setIsMañana] = useState(false);
  const [clinicasDisponibles, setClinicasDisponibles] = useState<{ id: string; nombre: string; recordId?: string }[]>([]);
  const [doctorFilter, setDoctorFilter] = useState<string>("");
  const [staffPorClinica, setStaffPorClinica] = useState<Record<string, StaffEntry[]>>({});
  const [objetivo, setObjetivo] = useState<number>(10);

  const clinicaFilter = useMemo(() => {
    if (!selectedClinicaId) return "";
    return clinicasDisponibles.find((c) => c.recordId === selectedClinicaId)?.id ?? "";
  }, [selectedClinicaId, clinicasDisponibles]);

  // Al cambiar la clínica global, reseteamos el doctor filter.
  useEffect(() => {
    setDoctorFilter("");
  }, [clinicaFilter]);
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]")); }
    catch { return new Set(); }
  });

  useEffect(() => {
    const stored = localStorage.getItem("fyllio_noshows_objetivo");
    if (stored) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed > 0) setObjetivo(parsed);
    }
  }, []);

  const load = useCallback(async (clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/hoy", location.href);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const todayData: HoyData = await res.json();

      if (todayData.appointments.length === 0) {
        const tomorrowIso = (() => {
          const d = new Date(todayData.todayIso + "T12:00:00");
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })();
        const url2 = new URL("/api/no-shows/hoy", location.href);
        url2.searchParams.set("date", tomorrowIso);
        if (clinica) url2.searchParams.set("clinica", clinica);
        const res2 = await fetch(url2.toString());
        if (res2.ok) {
          const mañanaData: HoyData = await res2.json();
          if (mañanaData.appointments.length > 0) {
            setData(mañanaData); setIsMañana(true); return;
          }
        }
      }
      setData(todayData); setIsMañana(false);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(clinicaFilter || undefined); }, [load, clinicaFilter]);

  useEffect(() => {
    fetch("/api/no-shows/clinicas")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.clinicas) setClinicasDisponibles(d.clinicas); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/no-shows/staff")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.staff) return;
        const byClinica: Record<string, StaffEntry[]> = {};
        for (const s of d.staff as any[]) {
          if (!s.clinicaRecordId) continue;
          if (s.nombre && String(s.nombre).toLowerCase().includes("recep")) continue;
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaffPorClinica(byClinica);
      })
      .catch(() => {});
  }, []);

  function markDone(id: string) {
    const next = new Set(done); next.add(id); setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  const onNavigate = (id: string) => router.push(`/no-shows?tab=acciones&citaId=${id}`);

  // ── Vista selection ─────────────────────────────────────────────────────────
  const vista: "todas" | "clinica" | "doctor" =
    !clinicaFilter ? "todas" :
    !doctorFilter  ? "clinica" :
    "doctor";

  // ── Doctores disponibles para la clínica seleccionada ──────────────────────
  const crId = clinicasDisponibles.find(c => c.id === clinicaFilter)?.recordId;
  const doctoresDisponibles: StaffEntry[] = clinicaFilter && crId
    ? (staffPorClinica[crId] ?? [])
    : Object.values(staffPorClinica).flat();

  // ── First load spinner ──────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 bg-[var(--color-surface-muted)] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-center">
        <ErrorState
          detail="Las citas de hoy no están disponibles en este momento."
          onRetry={() => load(clinicaFilter || undefined)}
        />
      </div>
    );
  }

  // ── Semáforo ────────────────────────────────────────────────────────────────
  const totalEnRiesgo = data.appointments.filter(isEnRiesgo).length;
  const tasaRiesgoHoy = data.summary.total > 0
    ? Math.round((totalEnRiesgo / data.summary.total) * 100)
    : 0;
  const semaforoColor =
    tasaRiesgoHoy < objetivo ? "green" : tasaRiesgoHoy <= objetivo + 3 ? "amber" : "red";

  return (
    <div className={`flex-1 min-h-0 flex flex-col gap-4 w-full transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Esta clínica aún no tiene datos conectados.</span>{" "}Contacta con Fyllio para activarlos.
        </div>
      )}

      {/* ── Header permanente ── */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-4">
        {/* Título + actualizar */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">
              {isMañana ? "Mañana" : "Hoy"}
            </p>
            <p className="font-display text-base font-semibold text-[var(--color-foreground)] capitalize">{data.todayLabel}</p>
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Actualizar
          </button>
        </div>

        {/* Semáforo objetivo */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-[var(--color-foreground)]">Objetivo mensual no-shows</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              semaforoColor === "green" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" :
              semaforoColor === "amber" ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
            }`}>
              {semaforoColor === "green" ? "En objetivo" : semaforoColor === "amber" ? "Cerca del límite" : "Fuera de objetivo"}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
            <div className="absolute top-0 bottom-0 w-px bg-[var(--color-muted)] z-10" style={{ left: `${Math.min(98, objetivo)}%` }} />
            <div
              className={`absolute left-0 top-0 bottom-0 rounded-full transition-all ${
                semaforoColor === "green" ? "bg-[var(--color-success)]" : semaforoColor === "amber" ? "bg-[var(--color-warning)]" : "bg-[var(--color-danger)]"
              }`}
              style={{ width: `${Math.min(100, tasaRiesgoHoy)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[var(--color-muted)] mt-1">
            <span>0%</span>
            <span>Objetivo: {objetivo}%</span>
            <span>Riesgo hoy: {tasaRiesgoHoy}%</span>
          </div>
        </div>

        {/* NAVBAR 1 eliminada — selector de clínica vive en el GlobalHeader
            (Sprint 7 Fase 5). clinicaFilter se deriva de useClinic(). */}

        {/* NAVBAR 2 — Doctores (solo cuando hay clínica seleccionada) */}
        {clinicaFilter && doctoresDisponibles.length > 0 && (
          <div className={PILL_SCROLL}>
            {doctoresDisponibles.map(s => (
              <button key={s.id}
                onClick={() => setDoctorFilter(s.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap ${
                  doctorFilter === s.id
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent)]"
                }`}>
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Banner mañana */}
      {isMañana && (
        <div className="rounded-2xl bg-[var(--color-accent-soft)] border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] px-4 py-2.5 flex items-center gap-2">
          <Info size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)] shrink-0" aria-hidden />
          <p className="text-sm text-[var(--color-foreground)]">
            <span className="font-semibold">Mostrando citas de mañana</span>
            {" · "}<span className="capitalize">{data.todayLabel}</span>
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          VISTA 1 — TODAS LAS CLÍNICAS
          ════════════════════════════════════════════════════════════════ */}
      {vista === "todas" && (() => {
        // Agrupar por clínica
        const apptsByClinica = new Map<string, { nombre: string; appts: RiskyAppt[] }>();
        for (const a of data.appointments) {
          const k = a.clinica ?? "sin-clinica";
          const e = apptsByClinica.get(k) ?? { nombre: a.clinicaNombre ?? k, appts: [] };
          e.appts.push(a);
          apptsByClinica.set(k, e);
        }

        return (
          <>
            {/* Header global */}
            <MetricCards
              total={data.summary.total}
              confirmed={data.summary.confirmed}
              enRiesgo={totalEnRiesgo}
              euros={totalEnRiesgo * AVG_TICKET}
              label={isMañana ? "Citas mañana" : "Citas hoy"}
            />

            {/* Cards por clínica */}
            {apptsByClinica.size === 0 ? (
              <EmptyState
                icon={<Calendar size={20} strokeWidth={ICON_STROKE} />}
                title="Sin citas para hoy en ninguna clínica"
                hint="Cuando haya citas programadas aparecerán aquí."
              />
            ) : [...apptsByClinica.entries()].map(([clinicaId, { nombre, appts }]) => {
              const enRiesgo = appts.filter(isEnRiesgo).length;
              const altoRiesgo = appts.filter(a => (a.scoreAccion ?? a.riskScore) >= 80).length;
              const confirmadas = appts.filter(a => a.confirmed).length;
              const euros = enRiesgo * AVG_TICKET;

              // Agrupar por doctor dentro de la clínica
              const porDoctor = new Map<string, { nombre: string; appts: RiskyAppt[] }>();
              for (const a of appts) {
                const dk = a.profesionalId ?? "sin-doctor";
                const de = porDoctor.get(dk) ?? { nombre: a.doctorNombre ?? dk, appts: [] };
                de.appts.push(a); porDoctor.set(dk, de);
              }

              return (
                <div key={clinicaId} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-3">
                  {/* Header clínica */}
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">{nombre}</p>
                    <div className="flex items-center gap-2">
                      {altoRiesgo > 0 && (
                        <span className="animate-pulse text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25">
                          Atención
                        </span>
                      )}
                      {enRiesgo > 0 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25">
                          {enRiesgo} en riesgo
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {appts.length} citas · {confirmadas} confirmadas · €{euros.toLocaleString("es-ES")} en riesgo
                  </p>
                  {/* Filas de doctor */}
                  <div className="space-y-1">
                    {[...porDoctor.entries()].map(([doctorId, { nombre: dNombre, appts: dAppts }]) => {
                      const dRiesgo = dAppts.filter(isEnRiesgo).length;
                      return (
                        <button key={doctorId}
                          onClick={() => {
                            // Drill-down: el clinicaId local es el recordId de Airtable,
                            // pero si viniera como id lógico lo mapeamos.
                            const rec =
                              clinicasDisponibles.find((c) => c.id === clinicaId)?.recordId ??
                              (clinicasDisponibles.some((c) => c.recordId === clinicaId) ? clinicaId : null);
                            if (rec) setSelectedClinicaId(rec);
                            setDoctorFilter(doctorId);
                          }}
                          className="w-full flex items-center justify-between text-left px-3 py-2 rounded-xl hover:bg-[var(--color-surface-muted)] border border-transparent hover:border-[var(--color-border)] transition-all">
                          <span className="text-xs font-semibold text-[var(--color-foreground)]">{dNombre}</span>
                          <span className="text-xs text-[var(--color-muted)]">
                            {dAppts.length} citas
                            {dRiesgo > 0 && <span className="ml-2 text-[var(--color-danger)] font-semibold">· {dRiesgo} en riesgo</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          </>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════
          VISTA 2 — UNA CLÍNICA, TODOS SUS DOCTORES
          ════════════════════════════════════════════════════════════════ */}
      {vista === "clinica" && (() => {
        const clinicaNombre = clinicasDisponibles.find(c => c.id === clinicaFilter)?.nombre ?? clinicaFilter;
        const clinicaAppts = data.appointments;
        const enRiesgo = clinicaAppts.filter(isEnRiesgo).length;
        const euros = enRiesgo * AVG_TICKET;

        // Agrupar por doctor
        const porDoctor = new Map<string, { nombre: string; appts: RiskyAppt[] }>();
        for (const a of clinicaAppts) {
          const dk = a.profesionalId ?? "sin-doctor";
          const de = porDoctor.get(dk) ?? { nombre: a.doctorNombre ?? dk, appts: [] };
          de.appts.push(a); porDoctor.set(dk, de);
        }

        return (
          <>
            {/* Header clínica */}
            <div className="px-1">
              <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">{clinicaNombre}</p>
            </div>
            <MetricCards
              total={clinicaAppts.length}
              confirmed={clinicaAppts.filter(a => a.confirmed).length}
              enRiesgo={enRiesgo}
              euros={euros}
              label={isMañana ? "Citas mañana" : "Citas hoy"}
            />

            {/* Cards por doctor */}
            {porDoctor.size === 0 ? (
              <EmptyState
                icon={<Calendar size={20} strokeWidth={ICON_STROKE} />}
                title="Sin citas para hoy en esta clínica"
                hint="Cuando haya citas programadas aparecerán aquí."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...porDoctor.entries()].map(([doctorId, { nombre, appts: dAppts }]) => {
                  const dEnRiesgo = dAppts.filter(isEnRiesgo).length;
                  const sinConf = dAppts.filter(a => !a.confirmed).length;
                  const conf = dAppts.filter(a => a.confirmed).length;
                  return (
                    <div key={doctorId} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-2">
                      <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">{nombre}</p>
                      <p className="text-xs text-[var(--color-muted)]">{dAppts.length} citas hoy</p>
                      {dEnRiesgo > 0 && (
                        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger)] font-semibold">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-danger)] shrink-0" aria-hidden />
                          {dEnRiesgo} en riesgo
                        </p>
                      )}
                      {sinConf > 0 && (
                        <p className="flex items-center gap-1.5 text-xs text-[var(--color-warning)] font-semibold">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-warning)] shrink-0" aria-hidden />
                          {sinConf} sin confirmar
                        </p>
                      )}
                      {conf > 0 && (
                        <p className="flex items-center gap-1.5 text-xs text-[var(--color-success)]">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0" aria-hidden />
                          {conf} confirmada{conf > 1 ? "s" : ""}
                        </p>
                      )}
                      <button
                        onClick={() => setDoctorFilter(doctorId)}
                        className="w-full mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface)] transition-colors px-3 py-1.5 text-xs font-semibold text-[var(--color-foreground)] inline-flex items-center justify-center gap-1">
                        Ver agenda del día
                        <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Resumen huecos */}
            {data.gaps.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
                <p className="text-xs text-[var(--color-muted)]">
                  {data.gaps.length} huecos disponibles hoy
                  {data.recalls.length > 0 && ` · ${data.recalls.length} pacientes en recall`}
                </p>
              </div>
            )}

          </>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════
          VISTA 3 — UN DOCTOR ESPECÍFICO
          ════════════════════════════════════════════════════════════════ */}
      {vista === "doctor" && (() => {
        const doctorAppts = data.appointments
          .filter(a => a.profesionalId === doctorFilter)
          .sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));

        const doctorNombre = doctorAppts[0]?.doctorNombre
          ?? doctoresDisponibles.find(d => d.id === doctorFilter)?.nombre
          ?? doctorFilter;

        const enRiesgo = doctorAppts.filter(isEnRiesgo).length;
        const highAppts = doctorAppts.filter(a => (a.scoreAccion ?? a.riskScore) >= 80);
        const medLowAppts = doctorAppts.filter(a => a.riskLevel !== "HIGH");
        const doctorGaps = computeGaps(doctorAppts, data.todayIso);

        return (
          <>
            {/* Header doctor */}
            <div className="px-1">
              <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">{doctorNombre}</p>
            </div>
            <MetricCards
              total={doctorAppts.length}
              confirmed={doctorAppts.filter(a => a.confirmed).length}
              enRiesgo={enRiesgo}
              euros={enRiesgo * AVG_TICKET}
              label={isMañana ? "Citas mañana" : "Citas hoy"}
            />

            {/* Citas HIGH */}
            {highAppts.length > 0 && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10 p-4 space-y-2">
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                  Riesgo alto · actuar antes del plazo
                </p>
                <div className="space-y-2">
                  {highAppts.map(a => (
                    <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            )}

            {/* Citas MED + LOW */}
            {medLowAppts.length > 0 && (
              <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-2">
                <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">
                  Resto de citas
                </p>
                <div className="space-y-2">
                  {medLowAppts.map(a => (
                    <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {doctorAppts.length === 0 && (
              <EmptyState
                icon={<Calendar size={20} strokeWidth={ICON_STROKE} />}
                title="Sin citas para este doctor hoy"
                hint="Cuando tenga citas programadas aparecerán aquí."
              />
            )}

            {/* Huecos del doctor */}
            {doctorGaps.length > 0 && (
              <div className="rounded-2xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-4 space-y-2">
                <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">Huecos disponibles hoy</p>
                {doctorGaps.map((gap, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="text-xs font-semibold text-[var(--color-foreground)] w-24 shrink-0">
                      {gap.startDisplay}–{gap.endDisplay}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">{gap.durationMin} min disponibles</span>
                    <button
                      onClick={() => router.push("/no-shows?tab=acciones")}
                      className="ml-auto text-xs text-[var(--color-accent)] hover:underline shrink-0 inline-flex items-center gap-1">
                      Ver candidatos
                      <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

          </>
        );
      })()}

    </div>
  );
}
