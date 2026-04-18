"use client";

// app/components/presupuestos/EnviosView.tsx
// Cola de envíos diaria basada en plantillas configurables.

import { useState, useEffect, useCallback } from "react";
import type { UserSession, EnvioItem, TipoEnvio } from "../../lib/presupuestos/types";

interface Props {
  user: UserSession;
}

const TIPO_CONFIG: Record<string, { label: string; color: string }> = {
  "Primer contacto": { label: "Primer contacto", color: "bg-emerald-100 text-emerald-700" },
  "Recordatorio 1":  { label: "Recordatorio 1",  color: "bg-amber-100 text-amber-700" },
  "Recordatorio 2":  { label: "Recordatorio 2",  color: "bg-amber-100 text-amber-700" },
  "Recordatorio 3":  { label: "Recordatorio 3",  color: "bg-orange-100 text-orange-700" },
  "Detalles de pago": { label: "Detalles de pago", color: "bg-indigo-100 text-indigo-700" },
  "Reactivacion":    { label: "Reactivación",     color: "bg-violet-100 text-violet-700" },
};

const GRUPO_ORDER: { key: string; tipos: TipoEnvio[] }[] = [
  { key: "primer", tipos: ["Primer contacto"] },
  { key: "recordatorios", tipos: ["Recordatorio 1", "Recordatorio 2", "Recordatorio 3"] },
  { key: "pago", tipos: ["Detalles de pago"] },
  { key: "reactivacion", tipos: ["Reactivacion"] },
];

function cleanPhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

function formatFechaHoy(): string {
  return new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function EnviosView({ user }: Props) {
  const [envios, setEnvios] = useState<EnvioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Batch wizard state
  const [batchTipo, setBatchTipo] = useState<string | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchSent, setBatchSent] = useState(0);

  const fetchEnvios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/presupuestos/cola-envios");
      const data = await res.json();
      setEnvios(data.envios ?? []);
    } catch {
      setEnvios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEnvios(); }, [fetchEnvios]);

  const pendientes = envios.filter((e) => e.estado === "Pendiente");
  const enviados = envios.filter((e) => e.estado === "Enviado");

  async function handleGenerar() {
    setGenerando(true);
    try {
      await fetch("/api/presupuestos/cola-envios/generar", { method: "POST" });
      await fetchEnvios();
    } finally {
      setGenerando(false);
    }
  }

  async function handleEnviar(envio: EnvioItem) {
    const phone = cleanPhone(envio.telefono);
    if (phone) {
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(envio.contenido)}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
    }
    try {
      await fetch("/api/presupuestos/cola-envios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: envio.id, estado: "Enviado" }),
      });
      setEnvios((prev) =>
        prev.map((e) => (e.id === envio.id ? { ...e, estado: "Enviado" as const } : e)),
      );
    } catch { /* silent */ }
  }

  async function handleSaltar(envio: EnvioItem) {
    try {
      await fetch("/api/presupuestos/cola-envios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: envio.id, estado: "Cancelado" }),
      });
      setEnvios((prev) =>
        prev.map((e) => (e.id === envio.id ? { ...e, estado: "Cancelado" as const } : e)),
      );
    } catch { /* silent */ }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── Batch wizard ─────────────────────────────────────────────────────

  function startBatch(tipos: TipoEnvio[]) {
    const items = pendientes.filter((e) => tipos.includes(e.tipo));
    if (items.length === 0) return;
    setBatchTipo(tipos.join(","));
    setBatchIndex(0);
    setBatchSent(0);
  }

  function getBatchItems(): EnvioItem[] {
    if (!batchTipo) return [];
    const tipos = batchTipo.split(",") as TipoEnvio[];
    return pendientes.filter((e) => tipos.includes(e.tipo));
  }

  async function handleBatchSend() {
    const items = getBatchItems();
    const current = items[batchIndex];
    if (!current) return;

    await handleEnviar(current);
    setBatchSent((s) => s + 1);

    if (batchIndex + 1 < items.length) {
      setBatchIndex((i) => i + 1);
    } else {
      setBatchTipo(null);
    }
  }

  function closeBatch() {
    setBatchTipo(null);
    setBatchIndex(0);
    setBatchSent(0);
  }

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-64 bg-slate-200 rounded" />
        <div className="h-4 w-40 bg-slate-100 rounded" />
        <div className="space-y-3 mt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-1">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
            Envíos de hoy
            <span className="ml-2 text-slate-400 font-normal normal-case text-xs">
              {formatFechaHoy()}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerar}
              disabled={generando}
              className="text-xs px-3 py-1.5 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50"
            >
              {generando ? "Generando..." : "Generar cola del día"}
            </button>
            <button
              onClick={fetchEnvios}
              className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
            >
              Actualizar
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {pendientes.length} mensaje{pendientes.length !== 1 ? "s" : ""} pendiente{pendientes.length !== 1 ? "s" : ""}
          {" · "}
          {enviados.length} enviado{enviados.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Empty state */}
      {envios.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-600 mb-1">Sin envíos programados para hoy</p>
          <p className="text-xs text-slate-400 mb-4">
            Genera la cola de envíos para preparar los mensajes del día.
          </p>
          <button
            onClick={handleGenerar}
            disabled={generando}
            className="text-sm px-5 py-2.5 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 disabled:opacity-50"
          >
            {generando ? "Generando cola..." : "Generar cola de envíos de hoy"}
          </button>
        </div>
      )}

      {/* Grouped sections */}
      {GRUPO_ORDER.map(({ key, tipos }) => {
        const items = envios.filter((e) => (tipos as string[]).includes(e.tipo));
        if (items.length === 0) return null;

        const pendientesGrupo = items.filter((e) => e.estado === "Pendiente");
        const groupLabel = tipos.length === 1
          ? (TIPO_CONFIG[tipos[0]]?.label ?? tipos[0])
          : "Recordatorios";

        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                {groupLabel}
                <span className="ml-1.5 text-slate-400 font-normal">({items.length})</span>
              </h3>
              {pendientesGrupo.length > 1 && (
                <button
                  onClick={() => startBatch(tipos)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-violet-50 text-violet-600 font-semibold hover:bg-violet-100"
                >
                  Enviar todos en lote
                </button>
              )}
            </div>

            <div className="space-y-2">
              {items.map((envio) => {
                const cfg = TIPO_CONFIG[envio.tipo] ?? { label: envio.tipo, color: "bg-slate-100 text-slate-600" };
                const isExpanded = expandedIds.has(envio.id);
                const isPendiente = envio.estado === "Pendiente";

                return (
                  <div
                    key={envio.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      envio.estado === "Enviado"
                        ? "border-emerald-200 bg-emerald-50/50"
                        : envio.estado === "Cancelado"
                          ? "border-slate-200 bg-slate-50 opacity-60"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {envio.paciente}
                          </p>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          {envio.estado === "Enviado" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                              Enviado
                            </span>
                          )}
                          {envio.estado === "Cancelado" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold">
                              Saltado
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Plantilla: {(envio.plantillaUsada || "").replace(/\[SEED_COLA\]/g, "").trim() || "—"}
                        </p>
                      </div>

                      {isPendiente && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleEnviar(envio)}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
                          >
                            Enviar
                          </button>
                          <button
                            onClick={() => toggleExpanded(envio.id)}
                            className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                          >
                            {isExpanded ? "Ocultar" : "Ver"}
                          </button>
                          <button
                            onClick={() => handleSaltar(envio)}
                            className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                          >
                            Saltar
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {envio.contenido}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Batch wizard modal */}
      {batchTipo && (() => {
        const items = getBatchItems();
        const current = items[batchIndex];
        if (!current) return null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800">Envío en lote</h3>
                <p className="text-xs text-slate-500">
                  {batchSent + 1} de {items.length}
                </p>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-slate-100 rounded-full mb-4">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${((batchSent) / items.length) * 100}%` }}
                />
              </div>

              <div className="mb-4">
                <p className="text-sm font-semibold text-slate-800 mb-1">
                  {current.paciente}
                </p>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 max-h-48 overflow-y-auto">
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {current.contenido}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={closeBatch}
                  className="text-xs px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Terminar
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      handleSaltar(current);
                      if (batchIndex + 1 < items.length) {
                        setBatchIndex((i) => i + 1);
                      } else {
                        closeBatch();
                      }
                    }}
                    className="text-xs px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  >
                    Saltar
                  </button>
                  <button
                    onClick={handleBatchSend}
                    className="text-xs px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                  >
                    {batchIndex + 1 < items.length ? "Enviar y siguiente" : "Enviar último"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
