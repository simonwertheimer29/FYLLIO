"use client";

// app/components/presupuestos/Paciente360View.tsx
// Vista 360° de un paciente: todos sus presupuestos + timeline unificado

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Presupuesto, HistorialAccion, TipoAccion, UserSession } from "../../lib/presupuestos/types";
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

export default function Paciente360View({ nombre }: Props) {
  const router = useRouter();
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

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
      } catch {
        setPresupuestos([]);
        setHistorial([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [nombre]);

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
                          {p.estado}
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
                          Estado: {p.estado}
                          {p.amount != null && ` · €${p.amount.toLocaleString("es-ES")}`}
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
    </div>
  );
}
