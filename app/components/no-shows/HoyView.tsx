"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../lib/no-shows/types";
import { riskColor } from "../../lib/no-shows/score";

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
    score >= 80 ? "bg-red-100 text-red-700 border-red-200" :
    score >= 60 ? "bg-orange-100 text-orange-700 border-orange-200" :
    score >= 40 ? "bg-blue-100 text-blue-700 border-blue-200" :
                  "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <button
      onClick={() => onNavigate(appt.id)}
      className={`w-full text-left border-l-4 pl-3 py-2 rounded-r-xl transition-opacity hover:bg-slate-50 ${done ? "opacity-40" : ""}`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 w-12 shrink-0">{appt.startDisplay}</span>
            <span className="text-sm font-semibold text-slate-800 truncate">{appt.patientName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreColorClass}`}>
              {score}
            </span>
            {!appt.confirmed && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">
                Sin confirmar
              </span>
            )}
            {appt.actionUrgent && (
              <span className="text-[10px] text-red-700 font-bold">⏰ Urgente</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 ml-14">
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
                className="p-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
              >WA</a>
            )}
            {appt.patientPhone && (
              <a href={`tel:${appt.patientPhone}`}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
              >Tel</a>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDone(appt.id); }}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors"
              title="Marcar hecho"
            >✓</button>
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
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <p className="text-2xl font-black text-slate-800 leading-none">{total}</p>
        <p className="text-xs text-slate-500 mt-1">{label}</p>
      </div>
      <div className="rounded-xl border border-green-100 bg-green-50 p-3">
        <p className="text-2xl font-black text-green-700 leading-none">{confirmed}</p>
        <p className="text-xs text-green-600 mt-1">Confirmadas</p>
      </div>
      <div className="rounded-xl border border-red-100 bg-red-50 p-3">
        <p className="text-2xl font-black text-red-700 leading-none">{enRiesgo}</p>
        <p className="text-xs text-red-600 mt-1">En riesgo</p>
      </div>
      <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
        <p className="text-2xl font-black text-amber-700 leading-none">€{euros}</p>
        <p className="text-xs text-amber-600 mt-1">€ en riesgo</p>
      </div>
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

  const [data, setData] = useState<HoyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMañana, setIsMañana] = useState(false);
  const [clinicaFilter, setClinicaFilter] = useState<string>("");
  const [clinicasDisponibles, setClinicasDisponibles] = useState<{ id: string; nombre: string; recordId?: string }[]>([]);
  const [doctorFilter, setDoctorFilter] = useState<string>("");
  const [staffPorClinica, setStaffPorClinica] = useState<Record<string, StaffEntry[]>>({});
  const [objetivo, setObjetivo] = useState<number>(10);
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
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 bg-slate-100 rounded-xl" />)}
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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* ── Header permanente ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
        {/* Título + actualizar */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {isMañana ? "MAÑANA" : "HOY"}
            </p>
            <p className="text-base font-extrabold text-slate-900 capitalize">{data.todayLabel}</p>
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >↻ Actualizar</button>
        </div>

        {/* Semáforo objetivo */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-600">Objetivo mensual no-shows</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              semaforoColor === "green" ? "bg-green-100 text-green-700" :
              semaforoColor === "amber" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            }`}>
              {semaforoColor === "green" ? "En objetivo" : semaforoColor === "amber" ? "Cerca del límite" : "Fuera de objetivo"}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="absolute top-0 bottom-0 w-px bg-slate-500 z-10" style={{ left: `${Math.min(98, objetivo)}%` }} />
            <div
              className={`absolute left-0 top-0 bottom-0 rounded-full transition-all ${
                semaforoColor === "green" ? "bg-green-400" : semaforoColor === "amber" ? "bg-amber-400" : "bg-red-500"
              }`}
              style={{ width: `${Math.min(100, tasaRiesgoHoy)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>0%</span>
            <span>Objetivo: {objetivo}%</span>
            <span>Riesgo hoy: {tasaRiesgoHoy}%</span>
          </div>
        </div>

        {/* NAVBAR 1 — Clínicas */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className={PILL_SCROLL}>
            <button
              onClick={() => { setClinicaFilter(""); setDoctorFilter(""); }}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap ${
                !clinicaFilter ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}>
              Todas las clínicas
            </button>
            {clinicasDisponibles.map(c => (
              <button key={c.id}
                onClick={() => { setClinicaFilter(c.id); setDoctorFilter(""); }}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap ${
                  clinicaFilter === c.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {/* NAVBAR 2 — Doctores (solo cuando hay clínica seleccionada) */}
        {clinicaFilter && doctoresDisponibles.length > 0 && (
          <div className={PILL_SCROLL}>
            {doctoresDisponibles.map(s => (
              <button key={s.id}
                onClick={() => setDoctorFilter(s.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap ${
                  doctorFilter === s.id ? "bg-violet-700 text-white border-violet-700" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                }`}>
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Banner mañana */}
      {isMañana && (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base shrink-0">ℹ️</span>
          <p className="text-sm text-blue-800">
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
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <p className="text-sm text-slate-400">Sin citas para hoy en ninguna clínica</p>
              </div>
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
                <div key={clinicaId} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
                  {/* Header clínica */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-800">{nombre}</p>
                    <div className="flex items-center gap-2">
                      {altoRiesgo > 0 && (
                        <span className="animate-pulse text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                          ATENCIÓN
                        </span>
                      )}
                      {enRiesgo > 0 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                          {enRiesgo} en riesgo
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    {appts.length} citas · {confirmadas} confirmadas · €{euros.toLocaleString("es-ES")} en riesgo
                  </p>
                  {/* Filas de doctor */}
                  <div className="space-y-1">
                    {[...porDoctor.entries()].map(([doctorId, { nombre: dNombre, appts: dAppts }]) => {
                      const dRiesgo = dAppts.filter(isEnRiesgo).length;
                      return (
                        <button key={doctorId}
                          onClick={() => { setClinicaFilter(clinicaId); setDoctorFilter(doctorId); }}
                          className="w-full flex items-center justify-between text-left px-3 py-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all">
                          <span className="text-xs font-semibold text-slate-700">{dNombre}</span>
                          <span className="text-xs text-slate-500">
                            {dAppts.length} citas
                            {dRiesgo > 0 && <span className="ml-2 text-red-600 font-semibold">· {dRiesgo} en riesgo</span>}
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
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{clinicaNombre}</p>
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
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <p className="text-sm text-slate-400">Sin citas para hoy en esta clínica</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...porDoctor.entries()].map(([doctorId, { nombre, appts: dAppts }]) => {
                  const dEnRiesgo = dAppts.filter(isEnRiesgo).length;
                  const sinConf = dAppts.filter(a => !a.confirmed).length;
                  const conf = dAppts.filter(a => a.confirmed).length;
                  return (
                    <div key={doctorId} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
                      <p className="text-sm font-bold text-slate-800">{nombre}</p>
                      <p className="text-xs text-slate-500">{dAppts.length} citas hoy</p>
                      {dEnRiesgo > 0 && <p className="text-xs text-red-600 font-semibold">🔴 {dEnRiesgo} en riesgo</p>}
                      {sinConf > 0 && <p className="text-xs text-amber-600 font-semibold">🟡 {sinConf} sin confirmar</p>}
                      {conf > 0 && <p className="text-xs text-green-600">✅ {conf} confirmada{conf > 1 ? "s" : ""}</p>}
                      <button
                        onClick={() => setDoctorFilter(doctorId)}
                        className="w-full mt-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors px-3 py-1.5 text-xs font-semibold text-slate-700">
                        Ver agenda del día →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Resumen huecos */}
            {data.gaps.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">
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
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{doctorNombre}</p>
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
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
                <p className="text-xs font-bold text-red-700 uppercase tracking-wider">
                  Riesgo ALTO · actuar antes del deadline
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
              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
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
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <p className="text-sm text-slate-400">Sin citas para este doctor hoy</p>
              </div>
            )}

            {/* Huecos del doctor */}
            {doctorGaps.length > 0 && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Huecos disponibles hoy</p>
                {doctorGaps.map((gap, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="text-xs font-semibold text-slate-600 w-24 shrink-0">
                      {gap.startDisplay}–{gap.endDisplay}
                    </span>
                    <span className="text-xs text-slate-400">{gap.durationMin} min disponibles</span>
                    <button
                      onClick={() => router.push("/no-shows?tab=acciones")}
                      className="ml-auto text-xs text-cyan-600 hover:underline shrink-0">
                      Ver candidatos →
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
