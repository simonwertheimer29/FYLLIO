"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  SeccionIntervencion,
  IntervencionResponse,
} from "../../lib/presupuestos/types";
import { URGENCIA_INTERVENCION_COLOR } from "../../lib/presupuestos/colors";

// ─── IntervencionCard ────────────────────────────────────────────────────────

function IntervencionCard({
  item,
  hexAccent,
  onOpenPanel,
  onRefresh,
}: {
  item: PresupuestoIntervencion;
  hexAccent: string;
  onOpenPanel: (p: PresupuestoIntervencion) => void;
  onRefresh: () => void;
}) {
  const [waEnviado, setWaEnviado] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const [respuestaInput, setRespuestaInput] = useState("");
  const [clasificando, setClasificando] = useState(false);

  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
  const urgenciaColor = item.urgenciaIntervencion
    ? URGENCIA_INTERVENCION_COLOR[item.urgenciaIntervencion]
    : "bg-slate-100 text-slate-500";

  async function handleEnviarWA() {
    if (!cleanPhone || !item.mensajeSugerido) return;

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(item.mensajeSugerido);
    } catch { /* fallback: user can paste manually */ }

    // Open WhatsApp
    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido)}`,
      "_blank"
    );

    // Record action
    setWaEnviado(true);
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
      }),
    }).then(() => onRefresh()).catch(() => {});
  }

  async function handleLlamar() {
    window.open(`tel:${item.patientPhone}`, "_self");
    setLlamando(true);

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "Llamada realizada",
      }),
    }).catch(() => {});
  }

  async function handleClasificarRespuesta() {
    if (!respuestaInput.trim()) return;
    setClasificando(true);
    try {
      await fetch("/api/presupuestos/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          tipo: "Mensaje recibido",
          mensaje: respuestaInput.trim(),
        }),
      });
      setRespuestaInput("");
      setLlamando(false);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setClasificando(false);
    }
  }

  const tiempoResp = item.fechaUltimaRespuesta
    ? formatTimeAgo(item.fechaUltimaRespuesta)
    : item.diasDesdeUltimoContacto != null
      ? `Hace ${item.diasDesdeUltimoContacto}d`
      : "";

  return (
    <div
      className={`rounded-2xl border bg-white transition-opacity ${waEnviado ? "opacity-50" : ""}`}
      style={{ borderLeft: `4px solid ${hexAccent}` }}
    >
      {/* Card body — clickable */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={() => onOpenPanel(item)}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 flex flex-col gap-1 items-start">
            {item.urgenciaIntervencion && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${urgenciaColor}`}>
                {item.urgenciaIntervencion}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <a
                href={`/presupuestos/paciente/${encodeURIComponent(item.patientName)}`}
                className="font-bold text-sm text-slate-900 truncate hover:text-violet-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {item.patientName}
              </a>
              {item.amount != null && (
                <span className="text-sm font-extrabold text-slate-700 shrink-0">
                  €{item.amount.toLocaleString("es-ES")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {item.treatments.map((t, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
              {item.doctor && <span>{item.doctor}</span>}
              {tiempoResp && <span>· {tiempoResp}</span>}
            </div>

            {/* Última respuesta del paciente */}
            {item.ultimaRespuestaPaciente && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                <p className="text-xs text-slate-700 line-clamp-2">
                  💬 &quot;{item.ultimaRespuestaPaciente}&quot;
                </p>
              </div>
            )}

            {/* Acción sugerida */}
            {item.accionSugerida && (
              <p className="text-[10px] text-violet-600 font-semibold mt-1.5">
                💡 {item.accionSugerida}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {cleanPhone && item.mensajeSugerido && (
          <button
            onClick={handleEnviarWA}
            disabled={waEnviado}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            {waEnviado ? "✓ WA enviado" : "✉️ Enviar WA"}
          </button>
        )}
        {cleanPhone && (
          <button
            onClick={handleLlamar}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            📞 Llamar
          </button>
        )}
        <button
          onClick={() => onOpenPanel(item)}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 ml-auto"
        >
          📋 Ver ficha →
        </button>
      </div>

      {/* Quick input after call */}
      {llamando && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">¿Qué dijo el paciente?</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={respuestaInput}
                onChange={(e) => setRespuestaInput(e.target.value)}
                placeholder="Respuesta del paciente (opcional)"
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleClasificarRespuesta();
                }}
              />
              <button
                onClick={handleClasificarRespuesta}
                disabled={!respuestaInput.trim() || clasificando}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {clasificando ? "..." : "Clasificar"}
              </button>
              <button
                onClick={() => setLlamando(false)}
                className="text-xs px-2 py-2 rounded-lg text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function IntervencionSection({ seccion, onOpenPanel, onRefresh }: {
  seccion: SeccionIntervencion;
  onOpenPanel: (p: PresupuestoIntervencion) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-base">{seccion.icono}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${seccion.color}`}>
          {seccion.titulo}
        </span>
        <span className="text-xs text-slate-400">{seccion.items.length}</span>
      </div>
      {seccion.items.map((item) => (
        <IntervencionCard
          key={item.id}
          item={item}
          hexAccent={seccion.hexAccent}
          onOpenPanel={onOpenPanel}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function IntervencionView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  const [data, setData] = useState<IntervencionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [completadosOpen, setCompletadosOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL("/api/presupuestos/intervencion", location.href);
      if (user.clinica) url.searchParams.set("clinica", user.clinica);
      const res = await fetch(url.toString());
      const d: IntervencionResponse = await res.json();
      setData(d);
      setLastUpdate(new Date());
    } catch {
      // Keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [user.clinica]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const secondsAgo = Math.round((Date.now() - lastUpdate.getTime()) / 1000);

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-40 rounded-2xl bg-slate-100" />
        <div className="h-40 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const totalPendientes = data?.totalPendientes ?? 0;
  const completadasHoy = data?.completadasHoy ?? 0;
  const total = totalPendientes + completadasHoy;
  const pct = total > 0 ? Math.round((completadasHoy / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 p-4 text-white">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">
              Cola de intervención · Hoy
            </p>
            <h2 className="text-xl font-extrabold mt-0.5">
              {totalPendientes} pendiente{totalPendientes !== 1 ? "s" : ""} · {completadasHoy} completada{completadasHoy !== 1 ? "s" : ""}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {/* Progress bar */}
            {total > 0 && (
              <div className="text-center">
                <div className="w-28 h-2 bg-violet-500 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-violet-200 mt-0.5">{pct}% del plan de hoy</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-400"
          >
            🔄 Actualizar
          </button>
          <span className="text-[10px] text-violet-300">
            Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
          </span>
        </div>
      </div>

      {/* Empty state */}
      {(!data?.secciones || data.secciones.length === 0) && completadasHoy === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <p className="text-2xl mb-3">📭</p>
          <p className="text-sm font-bold text-slate-700">Sin casos pendientes de intervención</p>
          <p className="text-xs text-slate-400 mt-1">
            Los presupuestos con respuesta del paciente o urgencia asignada aparecerán aquí.
          </p>
        </div>
      )}

      {/* Priority sections */}
      {data?.secciones?.map((seccion) => (
        <IntervencionSection
          key={seccion.id}
          seccion={seccion}
          onOpenPanel={onOpenDrawer}
          onRefresh={fetchData}
        />
      ))}

      {/* Completed today — collapsible */}
      {completadasHoy > 0 && (
        <div>
          <button
            onClick={() => setCompletadosOpen(!completadosOpen)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <span className={`transition-transform ${completadosOpen ? "rotate-90" : ""}`}>▸</span>
            Completadas hoy ({completadasHoy})
          </button>
          {completadosOpen && data?.casosCompletados && (
            <div className="mt-2 space-y-2 opacity-60">
              {data.casosCompletados.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border bg-emerald-50 border-emerald-100 p-3 cursor-pointer"
                  onClick={() => onOpenDrawer(item)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">✓</span>
                    <span className="text-sm font-semibold text-slate-700">{item.patientName}</span>
                    {item.amount != null && (
                      <span className="text-sm font-bold text-slate-500">€{item.amount.toLocaleString("es-ES")}</span>
                    )}
                    <span className="text-[10px] text-slate-400 ml-auto">{item.tipoUltimaAccion}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `Hace ${diffDay}d`;
}
