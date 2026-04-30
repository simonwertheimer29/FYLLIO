"use client";

// app/components/presupuestos/Paciente360View.tsx
// Vista 360° de un paciente: todos sus presupuestos + timeline unificado.
// Sprint 14a Bloque 1 — añade tab "Pagos" con historial + KPIs mini.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Presupuesto, HistorialAccion, TipoAccion, UserSession } from "../../lib/presupuestos/types";
import type { Pago } from "../../lib/pagos";
import { ESTADO_CONFIG } from "../../lib/presupuestos/colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_ACCION_ICON: Record<TipoAccion, string> = {
  cambio_estado:      "→",
  contacto:           "📞",
  portal_generado:    "🔗",
  portal_visto:       "👁",
  portal_aceptado:    "✅",
  portal_rechazado:   "❌",
  mensaje_automatico: "✦",
};

function formatFecha(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatFechaCorta(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  user: UserSession;
  nombre: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

type TabKey = "resumen" | "pagos";

type PagosKpis = {
  totalFacturado: number;
  pendiente: number | null;
  numPagos: number;
  ultimoPagoHaceDias: number | null;
};

type PagosResponse = {
  paciente: { id: string; nombre: string };
  pagos: Pago[];
  usuariosNombres: Record<string, string>;
  kpis: PagosKpis;
};

export default function Paciente360View({ nombre }: Props) {
  const router = useRouter();
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  const [pagosData, setPagosData] = useState<PagosResponse | null>(null);
  const [pagosLoading, setPagosLoading] = useState(false);
  const [pagosError, setPagosError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const url = new URL("/api/presupuestos/paciente", location.href);
        url.searchParams.set("nombre", nombre);
        const res = await fetch(url.toString());
        const d = await res.json();
        setPresupuestos(d.presupuestos ?? []);
        setHistorial(d.historial ?? []);
        setIsDemo(d.isDemo ?? false);
        setPacienteId(d.pacienteId ?? null);
      } catch {
        setPresupuestos([]);
        setHistorial([]);
        setPacienteId(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [nombre]);

  // Carga lazy de pagos: solo si entra al tab "Pagos" y hay pacienteId.
  useEffect(() => {
    if (activeTab !== "pagos" || !pacienteId || pagosData || pagosLoading) return;
    setPagosLoading(true);
    setPagosError(null);
    fetch(`/api/pacientes/${pacienteId}/pagos`)
      .then(async (res) => {
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
        return res.json() as Promise<PagosResponse>;
      })
      .then((d) => setPagosData(d))
      .catch((err) => {
        console.error("[Paciente360 pagos]", err);
        setPagosError(err instanceof Error ? err.message : "Error al cargar pagos");
      })
      .finally(() => setPagosLoading(false));
  }, [activeTab, pacienteId, pagosData, pagosLoading]);

  // ─── Métricas rápidas ──────────────────────────────────────────────────────

  const totalPres = presupuestos.length;
  const aceptados = presupuestos.filter(
    (p) => p.estado === "ACEPTADO"
  ).length;
  const tasaConversion = totalPres > 0 ? Math.round((aceptados / totalPres) * 100) : 0;
  const importeTotal = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  const ultimaActividad = historial[0]?.fecha ?? presupuestos[0]?.fechaPresupuesto;

  // ─── Timeline unificado ────────────────────────────────────────────────────

  type TimelineItem =
    | { kind: "historial"; item: HistorialAccion; date: string }
    | { kind: "presupuesto"; item: Presupuesto; date: string };

  const timeline: TimelineItem[] = [
    ...historial.map((h) => ({ kind: "historial" as const, item: h, date: h.fecha })),
    ...presupuestos.map((p) => ({ kind: "presupuesto" as const, item: p, date: p.fechaAlta })),
  ].sort((a, b) => (b.date > a.date ? 1 : -1));

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm animate-pulse">Cargando datos del paciente…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-700 text-sm font-medium flex items-center gap-1"
        >
          ← Volver
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <p className="font-bold text-slate-900 text-sm truncate">{nombre}</p>
        {isDemo && (
          <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
            DEMO
          </span>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Tabs locales — Sprint 14a Bloque 1 */}
        <div className="flex gap-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab("resumen")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "resumen"
                ? "text-slate-900 border-slate-900"
                : "text-slate-500 border-transparent hover:text-slate-700"
            }`}
          >
            Resumen
          </button>
          <button
            onClick={() => setActiveTab("pagos")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "pagos"
                ? "text-slate-900 border-slate-900"
                : "text-slate-500 border-transparent hover:text-slate-700"
            }`}
          >
            Pagos
            {pagosData && pagosData.kpis.numPagos > 0 && (
              <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-semibold">
                {pagosData.kpis.numPagos}
              </span>
            )}
          </button>
        </div>

        {activeTab === "pagos" ? (
          <PagosTabContent
            pacienteId={pacienteId}
            data={pagosData}
            loading={pagosLoading}
            error={pagosError}
          />
        ) : (
          <ResumenTabContent
            presupuestos={presupuestos}
            historial={historial}
            nombre={nombre}
          />
        )}
      </div>
    </div>
  );
}

// ─── Resumen tab (refactor del contenido original) ─────────────────────

function ResumenTabContent({
  presupuestos,
  historial,
  nombre,
}: {
  presupuestos: Presupuesto[];
  historial: HistorialAccion[];
  nombre: string;
}) {
  const totalPres = presupuestos.length;
  const aceptados = presupuestos.filter((p) => p.estado === "ACEPTADO").length;
  const tasaConversion = totalPres > 0 ? Math.round((aceptados / totalPres) * 100) : 0;
  const importeTotal = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);
  const ultimaActividad = historial[0]?.fecha ?? presupuestos[0]?.fechaPresupuesto;

  type TimelineItem =
    | { kind: "historial"; item: HistorialAccion; date: string }
    | { kind: "presupuesto"; item: Presupuesto; date: string };

  const timeline: TimelineItem[] = [
    ...historial.map((h) => ({ kind: "historial" as const, item: h, date: h.fecha })),
    ...presupuestos.map((p) => ({ kind: "presupuesto" as const, item: p, date: p.fechaAlta })),
  ].sort((a, b) => (b.date > a.date ? 1 : -1));

  return (
    <div className="space-y-6">
      {/* Métricas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-extrabold text-slate-900">{totalPres}</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">Presupuestos</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-extrabold text-emerald-700">{aceptados}</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">Aceptados</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-extrabold text-violet-700">{tasaConversion}%</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">Conversión</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-extrabold text-slate-900">
              {ultimaActividad ? formatFechaCorta(ultimaActividad) : "—"}
            </p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">Última actividad</p>
          </div>
        </div>

        {totalPres === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">No se encontraron presupuestos para &ldquo;{nombre}&rdquo;.</p>
          </div>
        )}

        {/* Presupuestos */}
        {presupuestos.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
              Presupuestos ({presupuestos.length})
            </p>
            <div className="divide-y divide-slate-50">
              {presupuestos.map((p) => {
                const estadoCfg = ESTADO_CONFIG[p.estado];
                return (
                  <div key={p.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: estadoCfg?.hex + "22", color: estadoCfg?.hex ?? "#64748b" }}
                        >
                          {estadoCfg?.label ?? p.estado}
                        </span>
                        {p.ofertaActiva && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            Oferta activa
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 mt-1 truncate">
                        {p.treatments.join(" · ") || "Sin tratamiento"}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {formatFecha(p.fechaPresupuesto)}
                        {p.doctor && ` · ${p.doctor}`}
                        {p.clinica && ` · ${p.clinica}`}
                      </p>
                    </div>
                    {p.amount != null && (
                      <p className="text-sm font-bold text-slate-800 shrink-0">
                        €{p.amount.toLocaleString("es-ES")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {importeTotal > 0 && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-right">
                <span className="text-xs text-slate-500">Importe total aceptado: </span>
                <span className="text-sm font-bold text-slate-900">
                  €{presupuestos
                    .filter((p) => p.estado === "ACEPTADO")
                    .reduce((s, p) => s + (p.amount ?? 0), 0)
                    .toLocaleString("es-ES")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Timeline unificado */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
              Actividad ({timeline.length})
            </p>
            <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
              {timeline.map((item, i) => {
                if (item.kind === "historial") {
                  const h = item.item;
                  const icon = TIPO_ACCION_ICON[h.tipo] ?? "·";
                  return (
                    <div key={`h-${h.id}`} className="px-4 py-3 flex gap-3 items-start">
                      <span className="text-base mt-0.5 shrink-0 w-5 text-center">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700">{h.descripcion}</p>
                        {h.registradoPor && (
                          <p className="text-[10px] text-slate-400">por {h.registradoPor}</p>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 shrink-0">{formatFechaCorta(h.fecha)}</p>
                    </div>
                  );
                } else {
                  const p = item.item;
                  return (
                    <div key={`p-${p.id}-${i}`} className="px-4 py-3 flex gap-3 items-start bg-violet-50/40">
                      <span className="text-base mt-0.5 shrink-0 w-5 text-center">📋</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 font-medium">
                          Presupuesto creado — {p.treatments.join(", ") || "Sin tratamiento"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {ESTADO_CONFIG[p.estado]?.label ?? p.estado}
                          {p.amount != null && ` · €${p.amount.toLocaleString("es-ES")}`}
                          {p.doctor && ` · ${p.doctor}`}
                          {p.clinica && ` · ${p.clinica}`}
                        </p>
                      </div>
                      <p className="text-[10px] text-slate-400 shrink-0">{formatFechaCorta(p.fechaAlta)}</p>
                    </div>
                  );
                }
              })}
            </div>
          </div>
        )}
    </div>
  );
}

// ─── Pagos tab — Sprint 14a Bloque 1 ──────────────────────────────────

const TIPO_PAGO_DOT: Record<string, string> = {
  Pago_Unico: "bg-sky-500",
  Cuota: "bg-amber-500",
  Senal: "bg-violet-500",
  Liquidacion: "bg-emerald-500",
};

const TIPO_PAGO_LABEL: Record<string, string> = {
  Pago_Unico: "Pago único",
  Cuota: "Cuota",
  Senal: "Señal",
  Liquidacion: "Liquidación",
};

function PagosTabContent({
  pacienteId,
  data,
  loading,
  error,
}: {
  pacienteId: string | null;
  data: PagosResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (!pacienteId) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-sm">
          Sin ficha de paciente vinculada — los pagos solo se muestran cuando hay un
          paciente registrado en la tabla de Pacientes.
        </p>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-sm animate-pulse">Cargando pagos…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-6 text-center">
        <p className="text-sm text-rose-700">No se pudieron cargar los pagos.</p>
        <p className="text-[11px] text-rose-500 mt-1">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const { pagos, kpis, usuariosNombres } = data;
  const fmtEUR = (n: number) => `€${n.toLocaleString("es-ES")}`;
  const fmtUltimoPago = (() => {
    if (kpis.ultimoPagoHaceDias == null) return "—";
    if (kpis.ultimoPagoHaceDias === 0) return "hoy";
    if (kpis.ultimoPagoHaceDias === 1) return "hace 1 día";
    return `hace ${kpis.ultimoPagoHaceDias} días`;
  })();

  return (
    <div className="space-y-6">
      {/* KPIs mini header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-extrabold text-slate-900">
            {fmtEUR(kpis.totalFacturado)}
          </p>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
            Total facturado
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p
            className={`text-2xl font-extrabold ${
              kpis.pendiente != null && kpis.pendiente > 0
                ? "text-rose-700"
                : "text-slate-900"
            }`}
          >
            {kpis.pendiente == null ? "—" : fmtEUR(kpis.pendiente)}
          </p>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
            Pendiente
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-extrabold text-slate-900">{kpis.numPagos}</p>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
            Nº pagos
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-extrabold text-slate-900">{fmtUltimoPago}</p>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
            Último pago
          </p>
        </div>
      </div>

      {/* CTA Registrar pago — inerte hasta Bloque 6 */}
      <div className="flex justify-end">
        <button
          disabled
          title="Disponible cuando se cierre el Bloque 6 (CRUD pagos)."
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        >
          + Registrar pago
        </button>
      </div>

      {/* Timeline o estado vacío */}
      {pagos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div className="text-3xl mb-2">💳</div>
          <p className="text-sm font-semibold text-slate-700">Sin pagos registrados</p>
          <p className="text-xs text-slate-400 mt-1">
            El historial financiero del paciente aparecerá aquí.
          </p>
          <button
            disabled
            title="Disponible cuando se cierre el Bloque 6 (CRUD pagos)."
            className="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
          >
            Registrar primer pago
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
            Historial ({pagos.length})
          </p>
          <div className="divide-y divide-slate-50">
            {pagos.map((p) => (
              <PagoRow key={p.id} pago={p} usuariosNombres={usuariosNombres} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PagoRow({
  pago,
  usuariosNombres,
}: {
  pago: Pago;
  usuariosNombres: Record<string, string>;
}) {
  const dotClass = TIPO_PAGO_DOT[pago.tipo] ?? "bg-slate-400";
  const tipoLabel = TIPO_PAGO_LABEL[pago.tipo] ?? pago.tipo;
  const usuarioLabel = (() => {
    if (!pago.usuarioCreadorId) return "Coordinación";
    const nombre = usuariosNombres[pago.usuarioCreadorId];
    if (nombre) return nombre;
    return "Usuario eliminado";
  })();
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-base font-bold text-slate-900">
            €{pago.importe.toLocaleString("es-ES")}
          </p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {tipoLabel}
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-100">
            {pago.metodo}
          </span>
        </div>
        {pago.nota && (
          <p className="text-xs text-slate-600 italic mt-1 line-clamp-2">
            {pago.nota}
          </p>
        )}
        <p className="text-[11px] text-slate-400 mt-1">
          Registrado por {usuarioLabel}
        </p>
      </div>
      <p className="text-xs text-slate-500 shrink-0 font-medium">
        {formatFecha(pago.fechaPago)}
      </p>
    </div>
  );
}
