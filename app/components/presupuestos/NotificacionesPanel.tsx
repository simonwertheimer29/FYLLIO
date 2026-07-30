"use client";

// app/components/presupuestos/NotificacionesPanel.tsx
// Panel lateral de notificaciones in-app.
//
// Pasada visual 2026-07-29: este panel se había quedado fuera del sprint de UI.
// Lo que tenía, y por qué importa (está a un clic de la cabecera de /presupuestos):
//   · `bg-white` fijo y nueve colores `slate-*` sin variante oscura → un
//     rectángulo blanco en una app en modo oscuro;
//   · `text-violet-600` y `bg-violet-50/40` → el violeta viejo, retirado del
//     producto como color, vivo en tres sitios;
//   · `✕` como botón de cerrar en vez del icono lucide;
//   · un título en `font-bold uppercase` fuera de la escala tipográfica;
//   · y lo peor, que no es visual: sus dos mutaciones (marcar una leída,
//     marcar todas) no comprobaban `res.ok` y tragaban el error con un catch
//     vacío, mientras la UI bajaba el contador de forma optimista. La campana
//     se ponía a cero sin que el servidor lo supiera, y al recargar volvían.

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Notificacion } from "../../lib/presupuestos/types";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";
import { X, ICON_STROKE } from "../icons";
import { ErrorState } from "../ui/Feedback";
import { Skeleton } from "../ui/Skeleton";

/** El punto de color dice de QUÉ es el aviso, con los tokens semánticos. */
const TIPO_DOT: Record<string, string> = {
  Intervencion_urgente: "bg-[var(--color-danger)]",
  Nuevo_mensaje_paciente: "bg-[var(--color-accent)]",
  Presupuesto_aceptado: "bg-[var(--color-success)]",
  Recordatorio_envio: "bg-[var(--color-warning)]",
  Sistema: "bg-[var(--color-muted)]",
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
  // Un fallo dejaba la campana a cero, indistinguible de "no tienes nada
  // pendiente" (censo 2026-07-29). Se conserva lo último bueno y se dice.
  const [error, setError] = useState<string | null>(null);

  const fetchNotifs = useCallback(async () => {
    try {
      const data = await cargarJSON<{ notificaciones: Notificacion[]; noLeidas?: number }>(
        "/api/notificaciones",
        { validar: traeLista("notificaciones") },
      );
      setError(null);
      setNotificaciones(data.notificaciones);
      onNotifCountChange?.(data.noLeidas ?? 0);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setLoading(false);
    }
  }, [onNotifCountChange]);

  useEffect(() => {
    fetchNotifs();
  }, [fetchNotifs]);

  /** Marca leídas en SERVIDOR y solo entonces baja el contador (§1). */
  async function marcarLeidas(cuerpo: { ids: string[] } | { all: true }) {
    const res = await fetch("/api/notificaciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function handleMarcarTodasLeidas() {
    try {
      await marcarLeidas({ all: true });
      setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
      onNotifCountChange?.(0);
    } catch {
      toast.error("No se pudieron marcar como leídas. Inténtalo de nuevo.");
    }
  }

  async function handleClick(notif: Notificacion) {
    if (notif.leida) {
      onClose();
      return;
    }
    try {
      await marcarLeidas({ ids: [notif.id] });
      setNotificaciones((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, leida: true } : n)),
      );
      onNotifCountChange?.(
        notificaciones.filter((n) => !n.leida && n.id !== notif.id).length,
      );
      onClose();
    } catch {
      // No se cierra el panel: el aviso sigue sin leer y hay que poder reintentar.
      toast.error("No se pudo marcar como leída. Inténtalo de nuevo.");
    }
  }

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Cabecera con la escala del producto: título de sección en Geist
            semibold, no un `text-xs font-bold uppercase`. */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              Avisos
              {noLeidas > 0 && (
                <span className="ml-2 text-[var(--color-accent)] tabular-nums">({noLeidas})</span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              {noLeidas > 0 && (
                <button
                  onClick={handleMarcarTodasLeidas}
                  className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                >
                  Marcar todos leídos
                </button>
              )}
              <button
                onClick={onClose}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
                aria-label="Cerrar"
              >
                <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={56} className="rounded-xl" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="p-4">
              <ErrorState detail={error} onRetry={() => { setLoading(true); void fetchNotifs(); }} />
            </div>
          )}

          {!loading && !error && notificaciones.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-sm text-[var(--color-muted)]">
                Sin avisos por ahora.
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                Aquí aparecerán los presupuestos aceptados y los mensajes nuevos
                de pacientes.
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            notificaciones.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] transition-colors ${
                  !n.leida ? "bg-[var(--color-accent-soft)]" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-1.5 shrink-0">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        !n.leida ? (TIPO_DOT[n.tipo] ?? "bg-[var(--color-muted)]") : ""
                      }`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm truncate ${
                        !n.leida
                          ? "font-semibold text-[var(--color-foreground)]"
                          : "text-[var(--color-muted)]"
                      }`}
                    >
                      {n.titulo}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)] line-clamp-2 leading-relaxed mt-0.5">
                      {n.mensaje}
                    </p>
                    <p className="text-[10px] text-[var(--color-muted)] mt-1 tabular-nums">
                      {tiempoRelativo(n.fechaCreacion)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
