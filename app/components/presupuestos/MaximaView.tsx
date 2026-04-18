"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoMaxima,
  MaximaResponse,
  EstadoVisual,
} from "../../lib/presupuestos/types";
import { ESTADO_VISUAL_CONFIG } from "../../lib/presupuestos/colors";

// ─── Filter pill categories ─────────────────────────────────────────────────

type PillCategory = "todos" | "intervencion" | "acepta_sin_pagar" | "sin_contactar" | "en_seguimiento" | "cerrados";

const PILL_DEFS: { id: PillCategory; label: string; estadosVisuales: EstadoVisual[] | null }[] = [
  { id: "todos",            label: "Todos",            estadosVisuales: null },
  { id: "intervencion",     label: "Intervención",     estadosVisuales: ["Necesita intervención"] },
  { id: "acepta_sin_pagar", label: "Acepta sin pagar", estadosVisuales: ["Acepta sin pagar"] },
  { id: "sin_contactar",    label: "Sin contactar",    estadosVisuales: ["Inicial"] },
  { id: "en_seguimiento",   label: "En seguimiento",   estadosVisuales: ["Primer contacto", "Segundo contacto"] },
  { id: "cerrados",         label: "Cerrados",         estadosVisuales: ["Cerrado ganado", "Cerrado perdido"] },
];

// ─── Sort fields ─────────────────────────────────────────────────────────────

type SortField = "urgency" | "fecha" | "amount" | "nombre";

function formatCurrency(n: number): string {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y?.slice(2)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MaximaView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  const [data, setData] = useState<MaximaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filtroClinica, setFiltroClinica] = useState("");
  const [filtroDoctor, setFiltroDoctor] = useState("");
  const [filtroTratamiento, setFiltroTratamiento] = useState("");
  const [pillActiva, setPillActiva] = useState<PillCategory>("todos");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("urgency");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/presupuestos/maxima");
      if (res.ok) {
        const json: MaximaResponse = await res.json();
        setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Filtered + sorted list ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!data) return [];
    let items = data.presupuestos;

    // Clinic filter
    if (filtroClinica) {
      items = items.filter((p) => p.clinica === filtroClinica);
    }
    // Doctor filter
    if (filtroDoctor) {
      items = items.filter((p) => p.doctor === filtroDoctor);
    }
    // Treatment filter
    if (filtroTratamiento) {
      items = items.filter((p) => p.treatments.some((t) => t === filtroTratamiento));
    }
    // Pill filter
    const pill = PILL_DEFS.find((pd) => pd.id === pillActiva);
    if (pill?.estadosVisuales) {
      items = items.filter((p) => pill.estadosVisuales!.includes(p.estadoVisual));
    }
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.patientName.toLowerCase().includes(q) ||
          p.treatments.some((t) => t.toLowerCase().includes(q)) ||
          (p.doctor && p.doctor.toLowerCase().includes(q))
      );
    }

    // Sort
    const sorted = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "urgency":
          cmp = a.urgencyScore - b.urgencyScore;
          break;
        case "fecha":
          cmp = a.fechaPresupuesto.localeCompare(b.fechaPresupuesto);
          break;
        case "amount":
          cmp = (a.amount ?? 0) - (b.amount ?? 0);
          break;
        case "nombre":
          cmp = a.patientName.localeCompare(b.patientName, "es");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [data, filtroClinica, filtroDoctor, filtroTratamiento, pillActiva, searchQuery, sortField, sortDir]);

  // ─── Pill counts ────────────────────────────────────────────────────────────

  const pillCounts = useMemo(() => {
    if (!data) return {} as Record<PillCategory, number>;
    const counts: Record<string, number> = {};
    for (const pill of PILL_DEFS) {
      if (!pill.estadosVisuales) {
        counts[pill.id] = data.presupuestos.length;
      } else {
        counts[pill.id] = data.presupuestos.filter((p) =>
          pill.estadosVisuales!.includes(p.estadoVisual)
        ).length;
      }
    }
    return counts as Record<PillCategory, number>;
  }, [data]);

  // Intervención count for priority block
  const intervencionCount = pillCounts["intervencion"] ?? 0;

  // ─── Sort toggle ────────────────────────────────────────────────────────────

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "nombre" ? "asc" : "desc");
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No se pudieron cargar los datos</p>
        <button onClick={fetchData} className="mt-2 text-xs text-blue-600 hover:underline">
          Reintentar
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">VISTA MAXIMA</h2>
            <p className="text-xs text-slate-500 mt-0.5">Presupuestos centralizados</p>
            <p className="text-xs text-slate-400 mt-1">
              {data.totales.total} presupuestos &middot;{" "}
              {formatCurrency(data.totales.importeTotal)} pipeline
            </p>
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Actualizar
          </button>
        </div>
      </div>

      {/* Priority block */}
      {intervencionCount > 0 && (
        <button
          onClick={() => setPillActiva("intervencion")}
          className="w-full rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-left transition-colors hover:bg-red-100"
        >
          <p className="text-sm font-bold text-red-700">
            {intervencionCount} {intervencionCount === 1 ? "caso requiere" : "casos requieren"} intervención hoy
          </p>
        </button>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Clinic select */}
        <select
          value={filtroClinica}
          onChange={(e) => setFiltroClinica(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
        >
          <option value="">Todas clínicas</option>
          {data.clinicasUnicas.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Doctor select */}
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
        >
          <option value="">Todos doctores</option>
          {data.doctoresUnicos.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Treatment select */}
        <select
          value={filtroTratamiento}
          onChange={(e) => setFiltroTratamiento(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
        >
          <option value="">Todos tratamientos</option>
          {data.tratamientosUnicos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Buscar paciente..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 placeholder:text-slate-400 w-48"
        />
      </div>

      {/* Estado pills */}
      <div className="flex flex-wrap gap-1.5">
        {PILL_DEFS.map((pill) => {
          const count = pillCounts[pill.id] ?? 0;
          const active = pillActiva === pill.id;
          return (
            <button
              key={pill.id}
              onClick={() => setPillActiva(pill.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {pill.label} &middot; {count}
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <p className="text-xs text-slate-400">
        Mostrando {filtered.length} de {data.totales.total}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-white text-left text-slate-500">
              <th className="w-[3px] px-0" />
              <th
                className="w-[72px] cursor-pointer select-none px-3 py-2.5 font-medium hover:text-slate-700"
                onClick={() => toggleSort("fecha")}
              >
                Fecha{sortIndicator("fecha")}
              </th>
              <th
                className="w-[140px] cursor-pointer select-none px-3 py-2.5 font-medium hover:text-slate-700"
                onClick={() => toggleSort("nombre")}
              >
                Paciente{sortIndicator("nombre")}
              </th>
              <th className="w-[100px] px-3 py-2.5 font-medium">Doctor</th>
              <th className="w-[130px] px-3 py-2.5 font-medium">Tratamiento</th>
              <th
                className="w-[80px] cursor-pointer select-none px-3 py-2.5 font-medium text-right hover:text-slate-700"
                onClick={() => toggleSort("amount")}
              >
                Importe{sortIndicator("amount")}
              </th>
              <th className="w-[130px] px-3 py-2.5 font-medium">Estado</th>
              <th className="w-[110px] px-3 py-2.5 font-medium">Última acción</th>
              <th className="w-[120px] px-3 py-2.5 font-medium">Próx. acción</th>
              <th className="w-[70px] px-3 py-2.5 font-medium text-center">Acc.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-6 py-10 text-center text-slate-400">
                  No hay presupuestos con estos filtros
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const cfg = ESTADO_VISUAL_CONFIG[p.estadoVisual];
              const isIntervencion = p.estadoVisual === "Necesita intervención";
              return (
                <tr
                  key={p.id}
                  onClick={() => onOpenDrawer(p)}
                  className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 ${cfg.bgClass}`}
                >
                  {/* Urgency bar */}
                  <td className="px-0">
                    <div
                      className={`h-full w-[3px] ${
                        isIntervencion
                          ? "bg-red-500 animate-pulse"
                          : ""
                      }`}
                      style={
                        isIntervencion
                          ? { animationDuration: "3s" }
                          : { backgroundColor: cfg.hex, opacity: 0.5 }
                      }
                    />
                  </td>
                  {/* Fecha */}
                  <td className="px-3 py-2.5 text-slate-600">
                    {formatDate(p.fechaPresupuesto)}
                  </td>
                  {/* Paciente */}
                  <td className="truncate px-3 py-2.5 font-medium text-slate-800">
                    {p.patientName}
                  </td>
                  {/* Doctor */}
                  <td className="truncate px-3 py-2.5 text-slate-600">
                    {p.doctor ?? "—"}
                  </td>
                  {/* Tratamiento */}
                  <td className="truncate px-3 py-2.5 text-slate-600">
                    {p.treatments.join(", ") || "—"}
                  </td>
                  {/* Importe */}
                  <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                    {p.amount != null ? formatCurrency(p.amount) : "—"}
                  </td>
                  {/* Estado visual badge */}
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${cfg.badgeClass}`}
                    >
                      {p.estadoVisual}
                    </span>
                  </td>
                  {/* Última acción */}
                  <td className="truncate px-3 py-2.5 text-slate-500">
                    {p.ultimaAccionTexto ?? "—"}
                  </td>
                  {/* Próxima acción */}
                  <td className="truncate px-3 py-2.5 text-slate-500">
                    {p.proximaAccionTexto ?? "—"}
                  </td>
                  {/* Quick actions */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {p.patientPhone && (
                        <>
                          <a
                            href={`tel:${p.patientPhone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="Llamar"
                          >
                            Tel
                          </a>
                          <a
                            href={`https://wa.me/${p.patientPhone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-green-600"
                            title="WhatsApp"
                          >
                            WA
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
