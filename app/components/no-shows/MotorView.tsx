"use client";

// Sprint 18 Bloque 18.4 — Experiencia "Motor" del módulo No-shows.
// 3 sub-tabs (pills): Citas próximas (default) · Histórico · Estadísticas.
//  - Próximas: 4 KPIs hero + lista de AccionCard por cita (acciones del motor).
//  - Histórico: tabla de predicciones con cierre de loop (Supabase).
//  - Estadísticas: charts recharts (tasa por mes/día/tratamiento + precisión).
//
// Consume:
//   GET  /api/no-shows/motor?tab=proximas|historico|estadisticas (+ filtros)
//   POST /api/no-shows/motor/accion { citaId, accion }

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line,
} from "recharts";
import type { NoShowsUserSession } from "../../lib/no-shows/types";
import type { FactorPonderado } from "../../lib/supabase/client";
import { Card } from "../ui/Card";
import { KpiCard } from "../ui/KpiCard";
import { StatePill, type StatePillVariant } from "../ui/StatePill";
import { AccionCard } from "../shared/AccionCard";
import { Skeleton, KpiCardSkeleton } from "../ui/Skeleton";

type MotorNivel = "alto" | "medio" | "bajo";

type MotorCitaProxima = {
  citaId: string;
  pacienteNombre: string;
  pacienteTelefono: string;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorId: string | null;
  doctorNombre: string | null;
  tratamiento: string;
  startIso: string;
  startDisplay: string;
  dayIso: string;
  score: number;
  nivel: MotorNivel;
  factores: FactorPonderado[];
  accionRecomendada: string;
  contactado: boolean;
};

type ProximasResponse = {
  tab: "proximas";
  persistencia: boolean;
  truncado: boolean;
  kpis: {
    citasManana: number;
    riesgoAlto: number;
    riesgoAltoPct: number;
    riesgoMedio: number;
    riesgoMedioPct: number;
    costeOportunidad: number;
    totalEvaluadas: number;
  };
  citas: MotorCitaProxima[];
};

type HistoricoRow = {
  citaId: string;
  evaluadoAt: string;
  pacienteNombre: string | null;
  doctorNombre: string | null;
  tratamiento: string | null;
  startIso: string | null;
  nivel: MotorNivel;
  score: number;
  resultadoReal: string | null;
  prediccionCorrecta: boolean | null;
};

type HistoricoResponse = { tab: "historico"; persistencia: boolean; rows: HistoricoRow[]; error?: string };

type EstadisticasResponse = {
  tab: "estadisticas";
  persistencia: boolean;
  precision: {
    total: number;
    correctas: number;
    tasa: number;
    porNivel: { nivel: MotorNivel; total: number; correctas: number; tasa: number }[];
  };
  byMonth: { month: string; tasa: number; total: number; noShows: number }[];
  byDayOfWeek: { day: string; tasa: number; total: number; noShows: number }[];
  byTreatment: { treatment: string; tasa: number; total: number; noShows: number }[];
};

type SubTab = "proximas" | "historico" | "estadisticas";
type ClinicaMeta = { id: string; nombre: string; recordId: string };
type StaffMeta = { id: string; nombre: string; clinicaRecordId: string };

// ─── Helpers de nivel/color ─────────────────────────────────────────────────────

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function nivelLabel(n: MotorNivel): string {
  return n === "alto" ? "Alto" : n === "medio" ? "Medio" : "Bajo";
}
function nivelBorder(n: MotorNivel): string {
  return n === "alto" ? "#DC2626" : n === "medio" ? "#D97706" : "#16A34A";
}
function nivelPillVariant(n: MotorNivel): StatePillVariant {
  return n === "alto" ? "danger" : n === "medio" ? "warning" : "success";
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 19));
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

function formatFechaHora(iso: string | null): string {
  if (!iso) return "—";
  const day = formatFecha(iso);
  const hhmm = iso.slice(11, 16);
  return hhmm ? `${day} ${hhmm}` : day;
}

/** Etiqueta legible de un factor del predictor (los de mayor |peso|). */
function factorLabel(f: FactorPonderado): string {
  const v = f.valor;
  switch (f.factor) {
    case "historico_no_shows":
      return typeof v === "number" && v > 0 ? `${v}× no-show prev.` : "Sin no-shows";
    case "historico_cancelaciones":
      return typeof v === "number" && v > 0 ? `${v}× cancel. prev.` : "";
    case "tiempo_agendamiento":
      return typeof v === "number" ? `Agendada hace ${v}d` : "";
    case "dia_semana":
      return v && v !== "resto" ? String(v) : "";
    case "hora":
      return v && v !== "resto" ? String(v) : "";
    case "tipo_tratamiento":
      return v ? String(v) : "";
    case "origen_lead":
      return v ? `Origen: ${v}` : "";
    case "edad":
      return typeof v === "number" ? `${v} años` : "";
    default:
      return String(f.factor);
  }
}

/** Top factores por |peso| (positivos primero) para mostrar como tags. */
function topFactores(factores: FactorPonderado[], max = 3): FactorPonderado[] {
  return [...factores]
    .filter((f) => f.peso > 0)
    .sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso))
    .slice(0, max);
}

// ─── Sub-tab: CITAS PRÓXIMAS ─────────────────────────────────────────────────────

function ProximasTab({
  user,
  clinicas,
  staff,
}: {
  user: NoShowsUserSession;
  clinicas: ClinicaMeta[];
  staff: StaffMeta[];
}) {
  const isManager = user.rol === "manager_general";
  const [data, setData] = useState<ProximasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [nivelFilter, setNivelFilter] = useState<"" | MotorNivel>("");
  const [clinicaFilter, setClinicaFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [fechaFilter, setFechaFilter] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, string>>({}); // citaId → mensaje feedback

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/motor", location.href);
      url.searchParams.set("tab", "proximas");
      if (clinicaFilter) url.searchParams.set("clinica", clinicaFilter);
      if (doctorFilter) url.searchParams.set("doctor", doctorFilter);
      if (fechaFilter) url.searchParams.set("fecha", fechaFilter);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [clinicaFilter, doctorFilter, fechaFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAccion(citaId: string, accion: string, etiqueta: string) {
    setBusy((b) => ({ ...b, [`${citaId}:${accion}`]: true }));
    try {
      const res = await fetch("/api/no-shows/motor/accion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ citaId, accion }),
      });
      const r = await res.json();
      if (r.ok) {
        setDone((d) => ({ ...d, [citaId]: `✓ ${etiqueta}` }));
        if (accion === "marcar_contactado") {
          setData((prev) =>
            prev
              ? { ...prev, citas: prev.citas.map((c) => (c.citaId === citaId ? { ...c, contactado: true } : c)) }
              : prev,
          );
        }
      } else {
        setDone((d) => ({ ...d, [citaId]: `⚠ ${motivoLegible(r.motivo)}` }));
      }
    } catch {
      setDone((d) => ({ ...d, [citaId]: "⚠ Error de red" }));
    } finally {
      setBusy((b) => ({ ...b, [`${citaId}:${accion}`]: false }));
    }
  }

  const citasVisibles = useMemo(() => {
    if (!data) return [];
    return nivelFilter ? data.citas.filter((c) => c.nivel === nivelFilter) : data.citas;
  }, [data, nivelFilter]);

  // Doctores disponibles para el filtro (según clínica seleccionada).
  const doctores = useMemo(() => {
    const recId = clinicaFilter ? clinicas.find((c) => c.id === clinicaFilter)?.recordId ?? "" : "";
    const base = recId ? staff.filter((s) => s.clinicaRecordId === recId) : staff;
    return base;
  }, [clinicaFilter, clinicas, staff]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <KpiCardSkeleton key={i} />)}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-[var(--color-muted)] py-8 text-center">Error cargando datos. Intenta refrescar.</p>;
  }

  const k = data.kpis;

  return (
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {/* Aviso degradación */}
      {!data.persistencia && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Persistencia no configurada.</span>{" "}
          Las predicciones se calculan en vivo pero no se guardan para histórico/precisión.
        </div>
      )}

      {/* 4 KPIs hero */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Citas mañana" value={k.citasManana} accent="sky" subline={`${k.totalEvaluadas} en ventana 14d`} />
        <KpiCard label="Riesgo alto" value={k.riesgoAlto} accent="rose" subline={`${k.riesgoAltoPct}% del total`} />
        <KpiCard label="Riesgo medio" value={k.riesgoMedio} accent="amber" subline={`${k.riesgoMedioPct}% del total`} />
        <KpiCard
          label="Coste oportunidad"
          value={k.costeOportunidad}
          accent="violet"
          formatter={(n) => `€${n.toLocaleString("es-ES")}`}
          subline="Riesgo alto + medio est."
        />
      </div>

      {/* Filtros */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Nivel */}
          <div className="flex gap-1.5">
            {([
              { id: "", label: "Todos" },
              { id: "alto", label: "Alto" },
              { id: "medio", label: "Medio" },
              { id: "bajo", label: "Bajo" },
            ] as { id: "" | MotorNivel; label: string }[]).map((n) => (
              <button
                key={n.id}
                onClick={() => setNivelFilter(n.id)}
                className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
                  nivelFilter === n.id ? "bg-sky-600 text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-slate-50"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>

          {/* Clínica (solo manager) */}
          {isManager && clinicas.length > 0 && (
            <select
              value={clinicaFilter}
              onChange={(e) => {
                setClinicaFilter(e.target.value);
                setDoctorFilter("");
              }}
              className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
            >
              <option value="">Todas las clínicas</option>
              {clinicas.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          )}

          {/* Doctor */}
          {doctores.length > 0 && (
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
            >
              <option value="">Todos los doctores</option>
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
            </select>
          )}

          {/* Fecha */}
          <input
            type="date"
            value={fechaFilter}
            onChange={(e) => setFechaFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
          />
          {fechaFilter && (
            <button
              onClick={() => setFechaFilter("")}
              className="text-xs text-[var(--color-muted)] hover:text-slate-700"
            >
              limpiar fecha
            </button>
          )}

          <span className="ml-auto text-xs text-[var(--color-muted)]">
            {citasVisibles.length} cita{citasVisibles.length !== 1 ? "s" : ""}
          </span>
        </div>
      </Card>

      {/* Lista de cards */}
      {citasVisibles.length === 0 ? (
        <Card padding="lg">
          <p className="text-sm text-[var(--color-muted)] text-center py-4">
            Sin citas en riesgo para los filtros seleccionados.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {citasVisibles.map((c) => {
            const tags = [
              { label: nivelLabel(c.nivel), tone: c.nivel === "alto" ? "rose" : c.nivel === "medio" ? "neutral" : "neutral" } as const,
              ...topFactores(c.factores)
                .map((f) => ({ label: factorLabel(f), tone: "violet" as const }))
                .filter((t) => t.label),
            ];
            const meta = [
              c.clinicaNombre,
              c.doctorNombre,
              c.tratamiento,
              `${formatFecha(c.dayIso)} ${c.startDisplay}`,
            ]
              .filter(Boolean)
              .join(" · ");
            const feedback = done[c.citaId];

            return (
              <div key={c.citaId} className="space-y-1">
                <AccionCard
                  borderColor={nivelBorder(c.nivel)}
                  title={c.pacienteNombre}
                  titleRight={
                    <span className="flex items-center gap-1.5">
                      <StatePill variant={nivelPillVariant(c.nivel)} size="sm">
                        {nivelLabel(c.nivel)} {c.score}
                      </StatePill>
                      {c.contactado && (
                        <StatePill variant="info" size="sm">✓ contactado</StatePill>
                      )}
                    </span>
                  }
                  score={c.score}
                  tags={tags}
                  meta={meta}
                  accionSugerida={c.accionRecomendada}
                  faded={c.contactado}
                  actions={[
                    {
                      label: "📞 Llamada IA",
                      variant: "primary",
                      disabled: !!busy[`${c.citaId}:programar_llamada_ia`],
                      onClick: () => runAccion(c.citaId, "programar_llamada_ia", "Llamada IA programada"),
                    },
                    {
                      label: "💬 Plantilla",
                      variant: "emerald",
                      disabled: !!busy[`${c.citaId}:enviar_plantilla_recordatorio`],
                      onClick: () => runAccion(c.citaId, "enviar_plantilla_recordatorio", "Plantilla enviada"),
                    },
                    {
                      label: "✓ Contactado",
                      variant: "ghost",
                      disabled: c.contactado || !!busy[`${c.citaId}:marcar_contactado`],
                      onClick: () => runAccion(c.citaId, "marcar_contactado", "Marcado contactado"),
                    },
                    {
                      label: "Overbooking",
                      variant: "ghost",
                      disabled: !!busy[`${c.citaId}:considerar_overbooking`],
                      onClick: () => runAccion(c.citaId, "considerar_overbooking", "Alerta overbooking creada"),
                    },
                  ]}
                />
                {feedback && (
                  <p className={`text-[11px] px-1 ${feedback.startsWith("✓") ? "text-emerald-600" : "text-amber-600"}`}>
                    {feedback}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.truncado && (
        <p className="text-[11px] text-[var(--color-muted)] text-center">
          Mostrando las primeras citas de la ventana. Afina los filtros para ver el resto.
        </p>
      )}
    </div>
  );
}

function motivoLegible(motivo?: string): string {
  switch (motivo) {
    case "sin_paciente": return "Cita sin paciente vinculado";
    case "paciente_sin_telefono": return "Paciente sin teléfono";
    case "paciente_optout": return "Paciente con opt-out de automatizaciones";
    case "cooldown_plantilla_extra": return "Ya recibió una plantilla en las últimas 24h";
    case "plantilla_no_encontrada": return "Plantilla no encontrada";
    case "cita_no_existe": return "Cita no encontrada";
    case "fuera_horario": return "Fuera de horario laboral";
    case "limite_clinica": return "Límite de llamadas de la clínica alcanzado";
    case "pausado": return "Llamadas IA en pausa";
    default: return motivo ?? "No se pudo completar";
  }
}

// ─── Sub-tab: HISTÓRICO ──────────────────────────────────────────────────────────

function HistoricoTab({ user, clinicas }: { user: NoShowsUserSession; clinicas: ClinicaMeta[] }) {
  const isManager = user.rol === "manager_general";
  const [data, setData] = useState<HistoricoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState("");
  const [resultadoFilter, setResultadoFilter] = useState("");
  const [fechaFilter, setFechaFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/motor", location.href);
      url.searchParams.set("tab", "historico");
      if (clinicaFilter) url.searchParams.set("clinica", clinicaFilter);
      if (resultadoFilter) url.searchParams.set("resultado", resultadoFilter);
      if (fechaFilter) url.searchParams.set("fecha", fechaFilter);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [clinicaFilter, resultadoFilter, fechaFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          {isManager && clinicas.length > 0 && (
            <select
              value={clinicaFilter}
              onChange={(e) => setClinicaFilter(e.target.value)}
              className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
            >
              <option value="">Todas las clínicas</option>
              {clinicas.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          )}
          <select
            value={resultadoFilter}
            onChange={(e) => setResultadoFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
          >
            <option value="">Todos los resultados</option>
            <option value="asistio">Asistió</option>
            <option value="no_show">No-show</option>
          </select>
          <input
            type="date"
            value={fechaFilter}
            onChange={(e) => setFechaFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
          />
          {fechaFilter && (
            <button onClick={() => setFechaFilter("")} className="text-xs text-[var(--color-muted)] hover:text-slate-700">
              limpiar fecha
            </button>
          )}
        </div>
      </Card>

      {loading && !data ? (
        <Card padding="none">
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 rounded" />)}
          </div>
        </Card>
      ) : !data || !data.persistencia ? (
        <Card padding="lg">
          <p className="text-sm text-[var(--color-muted)] text-center py-4">
            El histórico de predicciones requiere persistencia (Supabase) configurada.
          </p>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card padding="lg">
          <p className="text-sm text-[var(--color-muted)] text-center py-4">
            Aún no hay predicciones con resultado real. El loop se cierra cuando una cita se marca asistió o no-show.
          </p>
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Paciente</th>
                  <th className="px-3 py-2 font-semibold hidden sm:table-cell">Doctor</th>
                  <th className="px-3 py-2 font-semibold hidden md:table-cell">Tratamiento</th>
                  <th className="px-3 py-2 font-semibold text-center">Riesgo</th>
                  <th className="px-3 py-2 font-semibold text-center">Resultado</th>
                  <th className="px-3 py-2 font-semibold text-center">Acertó</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.citaId + r.evaluadoAt} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">
                      {formatFecha(r.startIso ?? r.evaluadoAt)}
                    </td>
                    <td className="px-3 py-2 text-slate-800 font-medium truncate max-w-[140px]">
                      {r.pacienteNombre ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 hidden sm:table-cell truncate max-w-[120px]">
                      {r.doctorNombre ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 hidden md:table-cell truncate max-w-[140px]">
                      {r.tratamiento ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatePill variant={nivelPillVariant(r.nivel)} size="sm">
                        {nivelLabel(r.nivel)} {r.score}
                      </StatePill>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatePill variant={r.resultadoReal === "no_show" ? "danger" : "success"} size="sm">
                        {r.resultadoReal === "no_show" ? "No-show" : "Asistió"}
                      </StatePill>
                    </td>
                    <td className="px-3 py-2 text-center text-base">
                      {r.prediccionCorrecta == null ? (
                        <span className="text-slate-300">—</span>
                      ) : r.prediccionCorrecta ? (
                        <span className="text-emerald-600">✓</span>
                      ) : (
                        <span className="text-rose-500">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-tab: ESTADÍSTICAS ───────────────────────────────────────────────────────

function EstadisticasTab({ user, clinicas }: { user: NoShowsUserSession; clinicas: ClinicaMeta[] }) {
  const isManager = user.rol === "manager_general";
  const [data, setData] = useState<EstadisticasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/motor", location.href);
      url.searchParams.set("tab", "estadisticas");
      if (clinicaFilter) url.searchParams.set("clinica", clinicaFilter);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [clinicaFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-[var(--color-muted)] py-8 text-center">Error cargando datos.</p>;
  }

  const precisionPct = Math.round(data.precision.tasa * 100);
  const maxDayTasa = Math.max(...data.byDayOfWeek.map((d) => d.tasa), 0.001);
  const maxTreatTasa = Math.max(...data.byTreatment.map((t) => t.tasa), 0.001);

  return (
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {/* Filtro clínica */}
      {isManager && clinicas.length > 0 && (
        <Card padding="sm">
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </Card>
      )}

      {/* Precisión del predictor */}
      <Card padding="lg">
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <span className="inline-block text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5 bg-violet-50 text-violet-700">
              Precisión del predictor
            </span>
            <p className="font-display text-4xl font-semibold text-[var(--color-foreground)] tabular-nums leading-tight mt-3">
              {data.precision.total > 0 ? `${precisionPct}%` : "—"}
            </p>
            <p className="text-[11px] text-[var(--color-muted)] mt-1">
              {data.precision.correctas} de {data.precision.total} predicciones acertadas
              {!data.persistencia && " · persistencia no configurada"}
            </p>
          </div>
          {data.precision.total > 0 && (
            <div className="flex-1 min-w-[180px] space-y-2 pt-2">
              {data.precision.porNivel.filter((n) => n.total > 0).map((n) => (
                <div key={n.nivel} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-muted)] w-12 shrink-0 capitalize">{nivelLabel(n.nivel)}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(n.tasa * 100)}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-600 w-16 text-right tabular-nums">
                    {Math.round(n.tasa * 100)}% ({n.total})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Tasa no-show por mes */}
      <Card padding="lg">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Tasa de no-show por mes</p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data.byMonth} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={1} />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, "Tasa"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e8ee" }}
            />
            <Line type="monotone" dataKey="tasa" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Tasa por día de semana */}
      <Card padding="lg">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Tasa por día de semana</p>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data.byDayOfWeek} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, "Tasa"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e8ee" }}
            />
            <Bar dataKey="tasa" radius={[4, 4, 0, 0]}>
              {data.byDayOfWeek.map((d, i) => (
                <Cell key={i} fill={d.tasa >= maxDayTasa * 0.85 ? "#DC2626" : "#0EA5E9"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Tasa por tratamiento */}
      <Card padding="lg">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Tasa por tipo de tratamiento</p>
        {data.byTreatment.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] py-4 text-center">Sin datos suficientes por tratamiento.</p>
        ) : (
          <div className="space-y-2">
            {data.byTreatment.map((t) => {
              const pct = (t.tasa / maxTreatTasa) * 100;
              const over = t.tasa >= maxTreatTasa * 0.85;
              return (
                <div key={t.treatment} className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 shrink-0 truncate" style={{ minWidth: 120, maxWidth: 140 }}>
                    {t.treatment}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-semibold shrink-0 w-24 text-right tabular-nums ${over ? "text-rose-600" : "text-slate-600"}`}>
                    {(t.tasa * 100).toFixed(0)}% ({t.total})
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "proximas", label: "Citas próximas" },
  { id: "historico", label: "Histórico" },
  { id: "estadisticas", label: "Estadísticas" },
];

export default function MotorView({ user }: { user: NoShowsUserSession }) {
  const [sub, setSub] = useState<SubTab>("proximas");
  const [clinicas, setClinicas] = useState<ClinicaMeta[]>([]);
  const [staff, setStaff] = useState<StaffMeta[]>([]);

  useEffect(() => {
    async function loadMeta() {
      try {
        const [clinRes, staffRes] = await Promise.all([
          fetch("/api/no-shows/clinicas"),
          fetch("/api/no-shows/staff"),
        ]);
        if (clinRes.ok) {
          const d = await clinRes.json();
          setClinicas(d.clinicas ?? []);
        }
        if (staffRes.ok) {
          const d = await staffRes.json();
          setStaff(d.staff ?? []);
        }
      } catch {
        /* silent */
      }
    }
    loadMeta();
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {/* Sub-tabs (pills) */}
      <div className="flex gap-1.5 flex-wrap">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`text-sm px-4 py-1.5 rounded-full font-semibold transition-colors ${
              sub === t.id
                ? "bg-sky-50 text-sky-700 border border-sky-200"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "proximas" && <ProximasTab user={user} clinicas={clinicas} staff={staff} />}
      {sub === "historico" && <HistoricoTab user={user} clinicas={clinicas} />}
      {sub === "estadisticas" && <EstadisticasTab user={user} clinicas={clinicas} />}
    </div>
  );
}
