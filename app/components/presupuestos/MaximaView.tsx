"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Download, Phone, MessageCircle, Search, ICON_STROKE } from "../icons";
import { ErrorState, EmptyState } from "../ui/Feedback";
import type {
  PresupuestoIntervencion,
  MaximaResponse,
  EstadoVisual,
} from "../../lib/presupuestos/types";
import { ESTADO_VISUAL_VARIANTE } from "../../lib/presupuestos/colors";
import { StatePill } from "../ui/StatePill";
import { useClinic } from "../../lib/context/ClinicContext";
import { CardListSkeleton } from "../ui/Skeleton";
import { hoyISO, fechaClinica } from "../../lib/time";
import { type RangoKanban } from "../shared/RangoTemporal";
import { seVeConRango } from "../../lib/presupuestos/pipeline";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";
import { eur } from "../shared/Cifra";

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

// Ordenar por "urgencia" vivía aquí sin cabecera que lo disparase (MEJORAS 40):
// código muerto de un criterio muerto. La fecha del presupuesto ordenada desc
// ES el orden por días parados, así que no hace falta una cuarta columna.
type SortField = "fecha" | "amount" | "nombre";

// El euro sale de `eur` (components/shared/Cifra), como en todo el producto.
// Aquí vivía un `formatCurrency` propio: la séptima implementación, y convivía
// con `€2.400` de la card del tablero y `2.400€` del panel — tres formatos
// visibles en tres clics sobre el mismo importe.

function formatDate(iso: string): string {
  if (!iso) return "—";
  // `fechaClinica` distingue un día de calendario de un instante y hace lo
  // correcto con cada uno. Aquí vivía a mano el ancla al mediodía; era correcta
  // pero muda, y es la única vista que se ORDENA por fecha.
  return fechaClinica(iso);
}

// ─── CSV Export ──────────────────────────────────────────────────────────────
//
// Sprint 14b Bloque 7 — la generacion del CSV vive ahora en
// /api/export/presupuestos.csv (server-side, formato Excel ES con
// columnas oficiales). El click descarga directamente desde el endpoint
// con filtros opcionales (clinicaId del ClinicContext, estado).

// ─── Component ───────────────────────────────────────────────────────────────

export default function MaximaView({
  onOpenDrawer,
  refreshKey = 0,
  rango,
}: {
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
  /** El MISMO rango que el Tablero, con la MISMA función pura (`seVeConRango`):
   *  cero criterio nuevo. Antes esta vista no lo aplicaba, así que enseñaba 123
   *  filas mientras el Tablero enseñaba 45 y el selector desaparecía al cambiar
   *  de lente (MEJORAS 71). Y desde MEJORAS 75 el rango acota SOLO los cerrados:
   *  un caso abierto es trabajo pendiente y no se esconde nunca. */
  rango: RangoKanban;
  /** Sube cuando se actúa desde el panel. Antes el Shell pasaba
   *  `onRefresh={() => {}}` con el comentario "la cola se recupera con su propio
   *  polling interno" — y esta vista NO tiene polling: carga al montar y nada
   *  más. Enviar un WhatsApp dejaba la fila diciendo la última acción de antes
   *  hasta que alguien pulsara "Actualizar". */
  refreshKey?: number;
}) {
  const { selectedClinicaNombre, selectedClinicaId } = useClinic();
  const [data, setData] = useState<MaximaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Antes: `fetch` a pelo, `if (res.ok)` sin else y `catch { /* silent */ }`. En
  // el primer arranque acababa en ErrorState por casualidad (data seguía null),
  // pero al pulsar "Actualizar" un fallo NO cambiaba nada: la tabla seguía
  // enseñando datos viejos como si fuesen frescos, sin decir una palabra.
  // Ahora `cargarJSON` (§10) y el fallo se dice conservando lo último bueno.
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const json = await cargarJSON<MaximaResponse>("/api/presupuestos/maxima", {
        validar: traeLista("presupuestos"),
      });
      setError(null);
      setData(json);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // ─── Filtered + sorted list ─────────────────────────────────────────────────

  /** El conjunto del que habla TODA la vista: filas dentro del rango. Los pills
   *  y el recuento se derivan de aquí, no del total — un pill que cuenta cosas
   *  que la tabla no pinta es el mismo error, un nivel más abajo. */
  const enRango = useMemo(
    () => (data ? data.presupuestos.filter((p) => seVeConRango(p, rango)) : []),
    [data, rango],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    let items = enRango;

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
  }, [data, enRango, selectedClinicaNombre, filtroDoctor, filtroTratamiento, pillActiva, searchQuery, sortField, sortDir]);

  // ─── Pill counts ────────────────────────────────────────────────────────────

  const pillCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const pill of PILL_DEFS) {
      counts[pill.id] = pill.estadosVisuales
        ? enRango.filter((p) => pill.estadosVisuales!.includes(p.estadoVisual)).length
        : enRango.length;
    }
    return counts as Record<PillCategory, number>;
  }, [enRango]);

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

  if (loading && !data) {
    return <CardListSkeleton rows={6} />;
  }

  if (!data) {
    return (
      <ErrorState
        detail={error ?? "No se pudieron cargar los presupuestos."}
        onRetry={fetchData}
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* La cabecera propia se retiró: el título de la pantalla y sus cifras
          viven en el Shell, una sola vez para las dos vistas. Aquí decía "Vista
          máxima · Presupuestos centralizados" —el nombre que se retiró el
          2026-07-29 y una frase que no dice nada— y repetía un total que ya
          estaba arriba. Queda solo lo que es de ESTA vista: exportar y refrescar.

          El banner rojo "N casos requieren intervención" también sale: hacía
          exactamente lo mismo que el pill "Intervención · N" de dos líneas más
          abajo (setPillActiva("intervencion")), así que era el mismo botón dos
          veces, uno de ellos a pantalla completa. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-muted)] tabular-nums">
          {enRango.length} presupuesto{enRango.length === 1 ? "" : "s"}
          {/* Lo que el rango esconde se DICE, igual que en las columnas del
              tablero: nunca se recorta en silencio. Y se dice QUÉ esconde —solo
              cerrados—, porque desde MEJORAS 75 lo abierto no se filtra nunca. */}
          {data.totales.total > enRango.length &&
            ` · ${data.totales.total - enRango.length} cerrado${data.totales.total - enRango.length === 1 ? "" : "s"} fuera del periodo`}
          {intervencionCount > 0 && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setPillActiva("intervencion")}
                className="font-semibold text-[var(--color-danger)] hover:underline"
              >
                {intervencionCount} necesita{intervencionCount === 1 ? "" : "n"} intervención
              </button>
            </>
          )}
        </p>
        <div className="flex gap-2">
          <ExportCsvButton clinicaId={selectedClinicaId} />
          <button
            onClick={fetchData}
            disabled={loading}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:opacity-50"
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {/* Un refresco fallido se DICE conservando la tabla, en vez de dejarla
          enseñando datos de hace un rato con cara de recién cargados. */}
      {error && (
        <p className="text-xs text-[var(--color-danger)]">
          No se pudo actualizar la tabla (se muestra lo último que sí cargó).{" "}
          <button type="button" onClick={fetchData} className="font-semibold underline">
            Reintentar
          </button>
        </p>
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
        Mostrando {filtered.length} de {enRango.length}
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
                  {/* "Ajusta los filtros" no sirve si lo que sobra es el RANGO:
                      el vacío tiene que decir cuál de las dos cosas pasa, y
                      ofrecer la salida. */}
                  <EmptyState
                    icon={<Search size={20} strokeWidth={ICON_STROKE} />}
                    title="Sin resultados"
                    hint={
                      enRango.length === 0 && data.totales.total > 0
                        ? `Sin presupuestos abiertos, y ningún cierre en el periodo elegido. Hay ${data.totales.total} cerrados fuera de él.`
                        : "Ajusta los filtros o la búsqueda para ver presupuestos."
                    }
                  />
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const isIntervencion = p.estadoVisual === "Necesita intervención";
              return (
                <tr
                  key={p.id}
                  onClick={() => onOpenDrawer(p)}
                  className="cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  {/* Marca de urgencia: una línea fija en el borde, sin latido.
                      Era `animate-pulse` — decoración que se mueve en una tabla
                      que se lee de arriba abajo. Y el resto de estados pintaban
                      su propio hex al 50%: nueve colores de barra para nueve
                      colores de badge, la misma información dos veces. */}
                  <td className="px-0">
                    <div
                      className={`h-full w-[3px] ${
                        isIntervencion ? "bg-[var(--color-danger)]" : ""
                      }`}
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
                      href={`/pipeline/presupuestos/paciente/${encodeURIComponent(p.patientName)}`}
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
                    {p.amount != null ? eur(p.amount) : "—"}
                  </td>
                  {/* Estado de seguimiento — primitivo compartido, cinco
                      variantes funcionales, no un color por estado. */}
                  <td className="px-3 py-2.5">
                    <StatePill variant={ESTADO_VISUAL_VARIANTE[p.estadoVisual]}>
                      {p.estadoVisual}
                    </StatePill>
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
                          {/* Censo wa.me a cero (2026-07-26): abre el PANEL de
                              conversación (hilo + composer con servicio
                              central), nunca wa.me a pelo — aquello abría un
                              chat vacío y fingía un registro sin contenido. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDrawer(p);
                            }}
                            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--fyllio-wa-green)]"
                            title="Abrir conversación"
                            aria-label="Abrir conversación"
                          >
                            <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                          </button>
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

// OJO (a MEJORAS): esto exporta con el filtro de CLÍNICA, no con el filtro que
// la coordinadora tiene puesto en la tabla. Antes recibía un `estado` que era
// `pillActiva === "todos" ? null : null` —un ternario con la misma rama dos
// veces— así que el parámetro no existía de verdad; se retira en vez de fingir
// que se manda algo.
function ExportCsvButton({ clinicaId }: { clinicaId: string | null }) {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (clinicaId) params.set("clinicaId", clinicaId);
      const url = `/api/export/presupuestos.csv${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const filenameMatch = cd.match(/filename="([^"]+)"/i);
      const today = hoyISO();
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
