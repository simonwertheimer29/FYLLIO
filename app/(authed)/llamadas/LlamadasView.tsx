"use client";

// Sprint 17 Bloque 6 — panel Llamadas IA. Tokens v4 (Card primitivo,
// Tailwind sky/slate/rose), KPIs hero + tabla últimas + drawer detalle.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import {
  KpiCardSkeleton,
  CardListSkeleton,
} from "../../components/ui/Skeleton";
import { toast } from "sonner";
import { Phone, RefreshCw, X } from "lucide-react";

type Llamada = {
  id: string;
  citaId: string | null;
  pacienteId: string;
  tipo: "confirmacion_cita" | "reactivacion" | "recuperacion_presupuesto";
  vapiCallId: string | null;
  estado:
    | "pendiente"
    | "iniciada"
    | "en_curso"
    | "completada"
    | "fallida"
    | "cancelada";
  resultado:
    | "confirmada"
    | "reagenda_solicitada"
    | "cancelada"
    | "no_contesta"
    | "escalado_humano"
    | "sin_resultado";
  iniciadaAt: string;
  finalizadaAt: string | null;
  duracionSegundos: number | null;
  notas: string | null;
  transcripcion: string | null;
  costeUSD: number | null;
};

type Kpis = {
  llamadasHoy: number;
  confirmadasHoy: number;
  fallidasHoy: number;
  costeMesUSD: number;
};

const ESTADO_BADGE: Record<Llamada["estado"], { tone: string; label: string }> = {
  pendiente: { tone: "bg-slate-100 text-slate-600 border-slate-200", label: "Pendiente" },
  iniciada: { tone: "bg-amber-50 text-amber-700 border-amber-200", label: "Iniciada" },
  en_curso: { tone: "bg-sky-50 text-sky-700 border-sky-200", label: "En curso" },
  completada: { tone: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Completada" },
  fallida: { tone: "bg-rose-50 text-rose-700 border-rose-200", label: "Fallida" },
  cancelada: { tone: "bg-slate-100 text-slate-500 border-slate-200", label: "Cancelada" },
};

const RESULTADO_BADGE: Record<Llamada["resultado"], { tone: string; label: string }> = {
  confirmada: { tone: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Confirmada" },
  reagenda_solicitada: { tone: "bg-amber-50 text-amber-700 border-amber-200", label: "Reagenda" },
  cancelada: { tone: "bg-rose-50 text-rose-700 border-rose-200", label: "Cancelada" },
  no_contesta: { tone: "bg-slate-100 text-slate-500 border-slate-200", label: "No contesta" },
  escalado_humano: { tone: "bg-orange-50 text-orange-700 border-orange-200", label: "Escalado" },
  sin_resultado: { tone: "bg-slate-100 text-slate-400 border-slate-200", label: "Sin resultado" },
};

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuracion(seg: number | null): string {
  if (!seg && seg !== 0) return "—";
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LlamadasView({ isAdmin }: { isAdmin: boolean }) {
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<Llamada["estado"] | "todas">(
    "todas",
  );
  const [filtroResultado, setFiltroResultado] = useState<
    Llamada["resultado"] | "todos"
  >("todos");
  const [drawerLlamada, setDrawerLlamada] = useState<Llamada | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, k] = await Promise.all([
        fetch("/api/llamadas?limit=100").then((r) => r.json()),
        fetch("/api/llamadas/kpis").then((r) => r.json()),
      ]);
      setLlamadas(r.llamadas ?? []);
      setKpis(k);
    } catch {
      toast.error("Error cargando llamadas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    return llamadas.filter((l) => {
      if (filtroEstado !== "todas" && l.estado !== filtroEstado) return false;
      if (filtroResultado !== "todos" && l.resultado !== filtroResultado)
        return false;
      return true;
    });
  }, [llamadas, filtroEstado, filtroResultado]);

  return (
    <div className="space-y-5 max-w-6xl">
      <header>
        <div className="flex items-center gap-2">
          <Phone size={20} strokeWidth={2.25} className="text-sky-700" />
          <h1 className="text-xl font-extrabold text-slate-900">Llamadas IA</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Llamadas de voz IA salientes para confirmar citas 24h antes,
          reactivar pacientes y recuperar presupuestos. Sprint 17 cubre el
          Use Case 1 (confirmación de citas).
        </p>
      </header>

      {/* KPIs hero */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading || !kpis ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </>
        ) : (
          <>
            <Kpi label="Llamadas hoy" value={String(kpis.llamadasHoy)} tone="sky" />
            <Kpi
              label="Confirmadas hoy"
              value={String(kpis.confirmadasHoy)}
              tone="emerald"
            />
            <Kpi
              label="Fallidas hoy"
              value={String(kpis.fallidasHoy)}
              tone={kpis.fallidasHoy > 0 ? "rose" : "slate"}
            />
            <Kpi
              label="Coste mes (USD)"
              value={`$${kpis.costeMesUSD.toFixed(2)}`}
              tone="slate"
            />
          </>
        )}
      </section>

      {/* Filtros */}
      <section className="flex flex-wrap gap-2 items-center">
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as any)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white"
        >
          <option value="todas">Todos los estados</option>
          {Object.entries(ESTADO_BADGE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={filtroResultado}
          onChange={(e) => setFiltroResultado(e.target.value as any)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white"
        >
          <option value="todos">Todos los resultados</option>
          {Object.entries(RESULTADO_BADGE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={fetchAll}
          className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-sm text-slate-700 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} strokeWidth={2.25} /> Refrescar
        </button>
      </section>

      {/* Tabla */}
      <section>
        {loading && llamadas.length === 0 ? (
          <CardListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <Card padding="none" className="p-8 text-center text-sm text-slate-500">
            Sin llamadas para los filtros seleccionados.
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Paciente</th>
                  <th className="text-left font-semibold px-3 py-2">Tipo</th>
                  <th className="text-left font-semibold px-3 py-2">Estado</th>
                  <th className="text-left font-semibold px-3 py-2">Resultado</th>
                  <th className="text-left font-semibold px-3 py-2">Duración</th>
                  <th className="text-left font-semibold px-3 py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setDrawerLlamada(l)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-medium text-slate-800 font-mono text-xs">
                      {l.pacienteId.slice(-6)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">
                      {l.tipo.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${ESTADO_BADGE[l.estado].tone}`}
                      >
                        {ESTADO_BADGE[l.estado].label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[l.resultado].tone}`}
                      >
                        {RESULTADO_BADGE[l.resultado].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs font-mono">
                      {fmtDuracion(l.duracionSegundos)}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {fmtFecha(l.iniciadaAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {drawerLlamada && (
        <LlamadaDrawer
          llamada={drawerLlamada}
          isAdmin={isAdmin}
          onClose={() => setDrawerLlamada(null)}
          onReintentado={() => {
            setDrawerLlamada(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "sky" | "slate";
}) {
  const c =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : tone === "sky"
          ? "text-sky-700"
          : "text-slate-900";
  return (
    <Card>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-2xl font-extrabold mt-1 ${c}`}>{value}</p>
    </Card>
  );
}

function LlamadaDrawer({
  llamada,
  isAdmin,
  onClose,
  onReintentado,
}: {
  llamada: Llamada;
  isAdmin: boolean;
  onClose: () => void;
  onReintentado: () => void;
}) {
  const [reintentando, setReintentando] = useState(false);

  async function reintentar() {
    setReintentando(true);
    try {
      const res = await fetch(`/api/llamadas/${llamada.id}/reintentar`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.detalle ?? d.motivo ?? "No se pudo reintentar.");
        return;
      }
      toast.success("Llamada reintentada.");
      onReintentado();
    } catch {
      toast.error("Error de red.");
    } finally {
      setReintentando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Llamada IA
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {llamada.tipo.replace(/_/g, " ")} ·{" "}
              <span className="font-mono">{llamada.pacienteId.slice(-6)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Estado"
              value={
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${ESTADO_BADGE[llamada.estado].tone}`}
                >
                  {ESTADO_BADGE[llamada.estado].label}
                </span>
              }
            />
            <Field
              label="Resultado"
              value={
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[llamada.resultado].tone}`}
                >
                  {RESULTADO_BADGE[llamada.resultado].label}
                </span>
              }
            />
            <Field label="Iniciada" value={fmtFecha(llamada.iniciadaAt)} />
            <Field
              label="Finalizada"
              value={fmtFecha(llamada.finalizadaAt ?? "")}
            />
            <Field label="Duración" value={fmtDuracion(llamada.duracionSegundos)} />
            <Field
              label="Coste"
              value={
                llamada.costeUSD != null ? `$${llamada.costeUSD.toFixed(3)}` : "—"
              }
            />
          </div>

          {llamada.citaId && (
            <div className="text-[11px] text-slate-500">
              Cita asociada:{" "}
              <span className="font-mono">{llamada.citaId.slice(-8)}</span>
            </div>
          )}

          <div>
            <Link
              href={`/pacientes/${llamada.pacienteId}`}
              className="text-xs text-sky-700 hover:underline"
            >
              Ver paciente →
            </Link>
          </div>

          {llamada.notas && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                Notas
              </p>
              <p className="text-xs text-slate-700 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 border border-slate-200">
                {llamada.notas}
              </p>
            </div>
          )}

          {llamada.transcripcion && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                Transcripción
              </p>
              <pre className="text-[11px] text-slate-700 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 border border-slate-200 font-sans max-h-72 overflow-y-auto">
                {llamada.transcripcion}
              </pre>
            </div>
          )}

          {llamada.vapiCallId && (
            <div className="text-[10px] text-slate-400">
              Vapi Call ID:{" "}
              <span className="font-mono">{llamada.vapiCallId}</span>
            </div>
          )}
        </div>
        {isAdmin && llamada.estado === "fallida" && (
          <footer className="border-t border-slate-200 p-3 shrink-0">
            <button
              type="button"
              onClick={reintentar}
              disabled={reintentando}
              className="w-full rounded-lg bg-sky-600 text-white text-sm font-bold py-2 hover:bg-sky-700 disabled:opacity-50"
            >
              {reintentando ? "Reintentando…" : "Reintentar llamada"}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </p>
      <div className="text-sm text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}
