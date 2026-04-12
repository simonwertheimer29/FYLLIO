"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../lib/no-shows/types";
import { riskColor, riskLabel, riskBgClass } from "../../lib/no-shows/score";

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

function buildRecallWhatsApp(recall: RecallAlert): string {
  const nombre = recall.patientName.split(" ")[0];
  return `Hola ${nombre}, llevamos ${recall.weeksSinceLast} semanas desde tu última cita de ${recall.treatmentName}. ¿Te gustaría agendar tu próxima sesión? Puedes elegir tu horario respondiendo a este mensaje.`;
}

// ─── RecallCard ───────────────────────────────────────────────────────────────

function RecallCard({ recall }: { recall: RecallAlert }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-orange-50 border border-orange-200 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{recall.patientName}</p>
        <p className="text-xs text-slate-500 truncate">{recall.treatmentName}</p>
        <p className="text-xs text-orange-700 font-medium mt-0.5">
          {recall.weeksSinceLast} semanas sin próxima cita
          {recall.clinica ? ` · ${recall.clinica}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {recall.patientPhone && (
          <a
            href={`https://wa.me/${recall.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildRecallWhatsApp(recall))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-xl bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
            title="WhatsApp"
          >
            WA
          </a>
        )}
        {recall.patientPhone && (
          <a
            href={`tel:${recall.patientPhone}`}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 transition-colors"
            title="Llamar"
          >
            Tel
          </a>
        )}
      </div>
    </div>
  );
}

// ─── ApptRow ──────────────────────────────────────────────────────────────────

function ApptRow({
  appt,
  done,
  onDone,
  onNavigate,
}: {
  appt: RiskyAppt;
  done: boolean;
  onDone: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const color = riskColor(appt.riskLevel);
  const label = riskLabel(appt.riskLevel);
  const bgClass = riskBgClass(appt.riskLevel);

  return (
    <button
      onClick={() => onNavigate(appt.id)}
      className={`w-full text-left border-l-4 pl-3 py-2 rounded-r-xl transition-opacity hover:bg-slate-50 ${done ? "opacity-40" : ""}`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 w-12 shrink-0">
              {appt.startDisplay}
            </span>
            <span className="text-sm font-semibold text-slate-800 truncate">
              {appt.patientName}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${bgClass}`}>
              {label} {appt.riskScore}
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
        {!done && appt.riskLevel !== "LOW" && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            {appt.patientPhone && (
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
                title="WhatsApp"
              >
                WA
              </a>
            )}
            {appt.patientPhone && (
              <a
                href={`tel:${appt.patientPhone}`}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
                title="Llamar"
              >
                Tel
              </a>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDone(appt.id); }}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors"
              title="Marcar hecho"
            >
              ✓
            </button>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── GapRow ───────────────────────────────────────────────────────────────────

function GapRow({ gap }: { gap: GapSlot }) {
  return (
    <div className="border-l-4 border-slate-200 pl-3 py-2 rounded-r-xl bg-slate-50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-400 w-12 shrink-0">
          {gap.startDisplay}
        </span>
        <span className="text-xs text-slate-400">
          Hueco disponible · {gap.durationMin} min
        </span>
      </div>
    </div>
  );
}

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
    try {
      return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]"));
    } catch { return new Set(); }
  });

  // Leer objetivo mensual de localStorage (guardado por ConfigView)
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

      // Fallback: si hoy no hay citas, intentar con mañana
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
            setData(mañanaData);
            setIsMañana(true);
            return;
          }
        }
      }

      setData(todayData);
      setIsMañana(false);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(clinicaFilter || undefined); }, [load, clinicaFilter]);

  // Fetch clinicas
  useEffect(() => {
    fetch("/api/no-shows/clinicas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.clinicas) setClinicasDisponibles(d.clinicas); })
      .catch(() => {});
  }, []);

  // Fetch staff
  useEffect(() => {
    fetch("/api/no-shows/staff")
      .then(r => (r.ok ? r.json() : null))
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

  // Auto-seleccionar primera clínica para managers
  useEffect(() => {
    if (!isManager || clinicasDisponibles.length === 0) return;
    if (!clinicaFilter) setClinicaFilter(clinicasDisponibles[0].id);
  }, [clinicasDisponibles]); // eslint-disable-line

  // Auto-seleccionar primer doctor al cambiar clínica o staff
  useEffect(() => {
    const crId = clinicasDisponibles.find(c => c.id === clinicaFilter)?.recordId;
    const lista: StaffEntry[] = clinicaFilter && crId
      ? (staffPorClinica[crId] ?? [])
      : Object.values(staffPorClinica).flat();
    if (lista.length > 0) setDoctorFilter(lista[0].id);
  }, [staffPorClinica, clinicaFilter]); // eslint-disable-line

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  if (loading && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl" />
          ))}
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

  // Filtrar citas por doctor seleccionado
  const filteredAppts = doctorFilter
    ? data.appointments.filter(a => (a as any).profesionalId === doctorFilter)
    : data.appointments;

  // Métricas filtradas
  const filteredSummary = {
    total: filteredAppts.length,
    confirmed: filteredAppts.filter(a => a.confirmed).length,
    riesgoAlto: filteredAppts.filter(a => a.riskLevel === "HIGH").length,
    riesgoMedio: filteredAppts.filter(a => a.riskLevel === "MEDIUM").length,
    eurosEnRiesgo: filteredAppts.filter(a => a.riskLevel !== "LOW").length * 85,
  };

  // Semáforo objetivo
  const tasaRiesgoHoy = filteredSummary.total > 0
    ? Math.round(((filteredSummary.riesgoAlto + filteredSummary.riesgoMedio) / filteredSummary.total) * 100)
    : 0;
  const semaforoColor =
    tasaRiesgoHoy < objetivo         ? "green"
    : tasaRiesgoHoy <= objetivo + 3  ? "amber"
    : "red";

  // Separar citas por nivel (usando filteredAppts)
  const highAppts   = filteredAppts.filter((a) => a.riskLevel === "HIGH")
    .sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));
  const medLowAppts = filteredAppts.filter((a) => a.riskLevel !== "HIGH")
    .sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));

  // Lista de doctores disponibles según clínica seleccionada
  const crId = clinicasDisponibles.find(c => c.id === clinicaFilter)?.recordId;
  const doctoresDisponibles: StaffEntry[] = clinicaFilter && crId
    ? (staffPorClinica[crId] ?? [])
    : Object.values(staffPorClinica).flat();

  return (
    <div className={`flex-1 min-h-0 flex flex-col gap-4 w-full transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* ── Header ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {isMañana ? "MAÑANA" : "HOY"}
            </p>
            <p className="text-base font-extrabold text-slate-900 capitalize">{data.todayLabel}</p>
            {isMañana && (
              <p className="text-[10px] text-blue-500 font-medium">(datos de mañana)</p>
            )}
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            ↻ Actualizar
          </button>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-2xl font-black text-slate-800 leading-none">{filteredSummary.total}</p>
            <p className="text-xs text-slate-500 mt-1">{isMañana ? "Citas mañana" : "Citas hoy"}</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <p className="text-2xl font-black text-green-700 leading-none">{filteredSummary.confirmed}</p>
            <p className="text-xs text-green-600 mt-1">Confirmadas</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-2xl font-black text-red-700 leading-none">
              {filteredSummary.riesgoAlto + filteredSummary.riesgoMedio}
            </p>
            <p className="text-xs text-red-600 mt-1">En riesgo</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-2xl font-black text-amber-700 leading-none">
              €{filteredSummary.eurosEnRiesgo}
            </p>
            <p className="text-xs text-amber-600 mt-1">€ en riesgo</p>
          </div>
        </div>

        {/* Semáforo objetivo mensual */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-600">Objetivo mensual no-shows</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              semaforoColor === "green" ? "bg-green-100 text-green-700" :
              semaforoColor === "amber" ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700"
            }`}>
              {semaforoColor === "green" ? "En objetivo" :
               semaforoColor === "amber" ? "Cerca del límite" : "Fuera de objetivo"}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-500 z-10"
              style={{ left: `${Math.min(98, objetivo)}%` }}
            />
            <div
              className={`absolute left-0 top-0 bottom-0 rounded-full transition-all ${
                semaforoColor === "green" ? "bg-green-400" :
                semaforoColor === "amber" ? "bg-amber-400" : "bg-red-500"
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

        {/* Navbar clínicas — solo manager */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {clinicasDisponibles.map(c => (
              <button key={c.id}
                onClick={() => { setClinicaFilter(c.id); setDoctorFilter(""); }}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                  ${clinicaFilter === c.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Navbar doctores */}
        {doctoresDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {doctoresDisponibles.map(s => (
              <button key={s.id}
                onClick={() => setDoctorFilter(s.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                  ${doctorFilter === s.id
                    ? "bg-violet-700 text-white border-violet-700"
                    : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"}`}>
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Banner fallback mañana */}
      {isMañana && (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base shrink-0">ℹ️</span>
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Mostrando citas de mañana</span>
            {" · "}
            <span className="capitalize">{data.todayLabel}</span>
          </p>
        </div>
      )}

      {/* ── Riesgo ALTO ── */}
      {highAppts.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider">
            Riesgo ALTO · actuar antes del deadline
          </p>
          <div className="space-y-2">
            {highAppts.map((a) => (
              <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone}
                onNavigate={(id) => router.push(`/no-shows?tab=acciones&citaId=${id}`)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Resto de citas (MED + LOW) ── */}
      {medLowAppts.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Resto de citas
          </p>
          <div className="space-y-2">
            {medLowAppts.map((a) => (
              <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone}
                onNavigate={(id) => router.push(`/no-shows?tab=acciones&citaId=${id}`)} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {filteredAppts.length === 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">Sin citas para el doctor seleccionado</p>
        </div>
      )}

      {/* ── Huecos + Recall en 2 cols en md+ ── */}
      <div className="md:grid md:grid-cols-2 md:gap-4 flex flex-col gap-4">

      {/* ── Huecos del día ── */}
      {data.gaps.length > 0 && (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Huecos del día
          </p>
          <div className="space-y-1.5">
            {data.gaps.map((gap, i) => (
              <GapRow key={i} gap={gap} />
            ))}
          </div>
        </div>
      )}

      {/* ── RECALL (colapsable al final) ── */}
      {data.recalls.length > 0 && (
        <details className="rounded-2xl bg-white border border-orange-200 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 flex items-center justify-between select-none list-none">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔔</span>
              <p className="text-sm font-semibold text-orange-800">
                Recall — {data.recalls.length} paciente{data.recalls.length !== 1 ? "s" : ""} sin próxima cita
              </p>
            </div>
            <span className="text-xs text-slate-400">Ver ▾</span>
          </summary>
          <div className="border-t border-orange-100 p-4 space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone} recall={recall} />
            ))}
          </div>
        </details>
      )}

      </div>{/* end 2-col grid */}

    </div>
  );
}
