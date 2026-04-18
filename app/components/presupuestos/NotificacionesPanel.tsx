"use client";

// app/components/presupuestos/NotificacionesPanel.tsx
// Panel lateral de notificaciones in-app.

import { useState, useEffect, useCallback } from "react";
import type { Notificacion } from "../../lib/presupuestos/types";

const TIPO_DOT: Record<string, string> = {
  Intervencion_urgente: "bg-red-500",
  Nuevo_mensaje_paciente: "bg-blue-500",
  Presupuesto_aceptado: "bg-emerald-500",
  Recordatorio_envio: "bg-amber-500",
  Sistema: "bg-slate-400",
};

function tiempoRelativo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  return `hace ${days}d`;
}

export default function NotificacionesPanel({
  onClose,
  onNotifCountChange,
}: {
  onClose: () => void;
  onNotifCountChange?: (count: number) => void;
}) {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones");
      const data = await res.json();
      setNotificaciones(data.notificaciones ?? []);
      onNotifCountChange?.(data.noLeidas ?? 0);
    } catch {
      setNotificaciones([]);
    } finally {
      setLoading(false);
    }
  }, [onNotifCountChange]);

  useEffect(() => {
    fetchNotifs();
  }, [fetchNotifs]);

  async function handleMarcarTodasLeidas() {
    try {
      await fetch("/api/notificaciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
      onNotifCountChange?.(0);
    } catch {
      /* silent */
    }
  }

  async function handleClick(notif: Notificacion) {
    if (!notif.leida) {
      try {
        await fetch("/api/notificaciones", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [notif.id] }),
        });
        setNotificaciones((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, leida: true } : n)),
        );
        const noLeidas = notificaciones.filter((n) => !n.leida && n.id !== notif.id).length;
        onNotifCountChange?.(noLeidas);
      } catch {
        /* silent */
      }
    }
    onClose();
  }

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Notificaciones
              {noLeidas > 0 && (
                <span className="ml-2 text-violet-600 font-bold">({noLeidas})</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {noLeidas > 0 && (
                <button
                  onClick={handleMarcarTodasLeidas}
                  className="text-[10px] font-semibold text-violet-600 hover:text-violet-700"
                >
                  Marcar todas leídas
                </button>
              )}
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-3 p-4 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-slate-100 rounded-xl" />
              ))}
            </div>
          )}

          {!loading && notificaciones.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-400">Sin notificaciones</p>
            </div>
          )}

          {!loading &&
            notificaciones.map((n) => {
              const dotColor = !n.leida ? (TIPO_DOT[n.tipo] ?? "bg-slate-400") : "";
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-5 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    !n.leida ? "bg-violet-50/40" : ""
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Dot indicator */}
                    <div className="mt-1.5 shrink-0">
                      {!n.leida ? (
                        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${!n.leida ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                        {n.titulo}
                      </p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mt-0.5">
                        {n.mensaje}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {tiempoRelativo(n.fechaCreacion)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
