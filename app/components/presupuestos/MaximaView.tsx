"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Phone, MessageCircle, Search, ICON_STROKE } from "../icons";
import { ErrorState, EmptyState } from "../ui/Feedback";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoMaxima,
  MaximaResponse,
  EstadoVisual,
} from "../../lib/presupuestos/types";
import { ESTADO_VISUAL_CONFIG } from "../../lib/presupuestos/colors";
import { useClinic } from "../../lib/context/ClinicContext";
import { CardListSkeleton, KpiCardSkeleton } from "../ui/Skeleton";

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
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// ─── CSV Export ──────────────────────────────────────────────────────────────
//
// Sprint 14b Bloque 7 — la generacion del CSV vive ahora en
// /api/export/presupuestos.csv (server-side, formato Excel ES con
// columnas oficiales). El click descarga directamente desde el endpoint
// con filtros opcionales (clinicaId del ClinicContext, estado).

// ─── Component ───────────────────────────────────────────────────────────────

export default function MaximaView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  const { selectedClinicaNombre, selectedClinicaId } = useClinic();
  const [data, setData] = useState<MaximaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters — el filtro de clínica pasa a consumirse desde ClinicContext
  // (selectedClinicaNombre). Este Shell filtra por `p.clinica === nombre`.
  // Sprint 15 Bloque 6 — initial state lee ?doctor= del URL para que el
  // link "Menor tasa: Dr. X" del CommandCenter pre-filtre la vista.
  const [filtroDoctor, setFiltroDoctor] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("doctor") ?? "";
  });
  const [filtroTratamiento, setFiltroTratamiento] = useState("");
  const [pillActiva, setPillActiva] = useState<PillCategory>("todos");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("fecha");
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

    // Clinic filter (desde ClinicContext global, Sprint 7 Fase 5).
    if (selectedClinicaNombre) {
      items = items.filter((p) => p.clinica === selectedClinicaNombre);
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
  }, [data, selectedClinicaNombre, filtroDoctor, filtroTratamiento, pillActiva, searchQuery, sortField, sortDir]);

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
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
        <CardListSkeleton rows={5} />
      </div>
    );
  }

  if (!data) {
    return (
      <ErrorState
        detail="No se pudieron cargar los presupuestos."
        onRetry={fetchData}
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Vista máxima</h2>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">Presupuestos centralizados</p>
            <p className="text-xs text-[var(--color-muted)] mt-1">
              {data.totales.total} presupuestos &middot;{" "}
              {formatCurrency(data.totales.importeTotal)} pipeline
            </p>
          </div>
          <div className="flex gap-2">
            <ExportCsvButton
              clinicaId={selectedClinicaId}
              estado={pillActiva === "todos" ? null : null /* pillActiva no mapea 1:1 a Estado; lo cubre el server */}
            />
            <button
              onClick={fetchData}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Priority block — Sprint 15 Bloque 8: estilo banner alerta
          coherente con el resto del sistema (rose-50 + border-left
          rose-700 + AlertTriangle Lucide). */}
      {intervencionCount > 0 && (
        <button
          onClick={() => setPillActiva("intervencion")}
          className="w-full rounded-xl bg-rose-50 dark:bg-rose-500/10 px-5 py-3 text-left transition-colors hover:bg-rose-100 dark:hover:bg-rose-500/20 border-l-4 border-rose-700 dark:border-rose-400 flex items-center gap-3"
        >
          <AlertTriangle
            size={20}
            strokeWidth={ICON_STROKE}
            className="text-rose-700 dark:text-rose-300 shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            {intervencionCount} {intervencionCount === 1 ? "caso requiere" : "casos requieren"} intervención hoy
          </p>
        </button>
      )}

      {/* Filters row — el selector de clínica vive en el GlobalHeader
          (Sprint 7 Fase 5). Aquí solo quedan filtros específicos del área. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Doctor select */}
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="">Todos los doctores</option>
          {data.doctoresUnicos.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Treatment select */}
        <select
          value={filtroTratamiento}
          onChange={(e) => setFiltroTratamiento(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="">Todos los tratamientos</option>
          {data.tratamientosUnicos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Buscar paciente…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] w-48 outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
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
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {pill.label} &middot; {count}
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <p className="text-xs text-[var(--color-muted)]">
        Mostrando {filtered.length} de {data.totales.total}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left text-[var(--color-muted)]">
              <th className="w-[3px] px-0" />
              <th
                className="w-[72px] cursor-pointer select-none px-3 py-2.5 font-medium hover:text-[var(--color-foreground)]"
                onClick={() => toggleSort("fecha")}
              >
                Fecha{sortIndicator("fecha")}
              </th>
              <th
                className="w-[140px] cursor-pointer select-none px-3 py-2.5 font-medium hover:text-[var(--color-foreground)]"
                onClick={() => toggleSort("nombre")}
              >
                Paciente{sortIndicator("nombre")}
              </th>
              <th className="w-[100px] px-3 py-2.5 font-medium">Doctor</th>
              <th className="w-[130px] px-3 py-2.5 font-medium">Tratamiento</th>
              <th
                className="w-[80px] cursor-pointer select-none px-3 py-2.5 font-medium text-right hover:text-[var(--color-foreground)]"
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
                <td colSpan={10} className="px-6 py-6">
                  <EmptyState
                    icon={<Search size={20} strokeWidth={ICON_STROKE} />}
                    title="Sin resultados"
                    hint="Ajusta los filtros o la búsqueda para ver presupuestos."
                  />
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
                  className={`cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-muted)] ${cfg.bgClass}`}
                >
                  {/* Urgency bar */}
                  <td className="px-0">
                    <div
                      className={`h-full w-[3px] ${
                        isIntervencion
                          ? "bg-rose-500 animate-pulse"
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
                  <td className="px-3 py-2.5 text-[var(--color-muted)]">
                    {formatDate(p.fechaPresupuesto)}
                  </td>
                  {/* Paciente */}
                  <td className="truncate px-3 py-2.5 font-medium text-[var(--color-foreground)]">
                    {/* Sprint 14a Bloque 1.5 — link al hub del paciente
                        vía redirect legacy (resuelve nombre→id en server). */}
                    <a
                      href={`/presupuestos/paciente/${encodeURIComponent(p.patientName)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-[var(--color-accent)] hover:underline"
                    >
                      {p.patientName}
                    </a>
                  </td>
                  {/* Doctor */}
                  <td className="truncate px-3 py-2.5 text-[var(--color-muted)]">
                    {p.doctor ?? "—"}
                  </td>
                  {/* Tratamiento */}
                  <td className="truncate px-3 py-2.5 text-[var(--color-muted)]">
                    {p.treatments.join(", ") || "—"}
                  </td>
                  {/* Importe */}
                  <td className="px-3 py-2.5 text-right font-medium text-[var(--color-foreground)] tabular-nums">
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
                  <td className="truncate px-3 py-2.5 text-[var(--color-muted)]">
                    {p.ultimaAccionTexto ?? "—"}
                  </td>
                  {/* Próxima acción */}
                  <td className="truncate px-3 py-2.5 text-[var(--color-muted)]">
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
                            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
                            title="Llamar"
                            aria-label="Llamar"
                          >
                            <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                          </a>
                          <a
                            href={`https://wa.me/${p.patientPhone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--fyllio-wa-green)]"
                            title="WhatsApp"
                            aria-label="Enviar WhatsApp"
                          >
                            <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
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

// ─── ExportCsvButton — Sprint 14b Bloque 7 ────────────────────────────
// Llama al endpoint server-side /api/export/presupuestos.csv (formato
// Excel ES, columnas oficiales). Loading state mientras la respuesta
// no llega; cuando llega el body, lo convierte en blob y dispara
// download con el filename del header Content-Disposition.

function ExportCsvButton({
  clinicaId,
  estado,
}: {
  clinicaId: string | null;
  estado: string | null;
}) {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (clinicaId) params.set("clinicaId", clinicaId);
      if (estado) params.set("estado", estado);
      const url = `/api/export/presupuestos.csv${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const filenameMatch = cd.match(/filename="([^"]+)"/i);
      const today = new Date().toISOString().slice(0, 10);
      const filename = filenameMatch?.[1] ?? `fyllio_presupuestos_${today}.csv`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("No se pudo exportar el CSV. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title="Descarga CSV (Excel español, UTF-8)."
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      {busy ? (
        "Generando…"
      ) : (
        <>
          <Download size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Exportar CSV
        </>
      )}
    </button>
  );
}
