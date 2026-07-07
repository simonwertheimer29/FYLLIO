"use client";

// app/components/presupuestos/ColaMensajes.tsx
// Cola de mensajes automáticos pendientes de envío.
// Se muestra en TareasView antes de las tareas urgentes.

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Secuencia, TipoEvento } from "../../lib/presupuestos/types";
import { Inbox, Smartphone, MessageCircle, Check, ICON_STROKE } from "../icons";
import { StatePill, type StatePillVariant } from "../ui/StatePill";
import { ErrorState } from "../ui/Feedback";

interface Props {
  clinica?: string; // undefined = todas (manager/admin)
}

const EVENTO_CONFIG: Record<TipoEvento, { label: string; variant: StatePillVariant; aceptado?: boolean }> = {
  presupuesto_inactivo:           { label: "Sin actividad", variant: "warning" },
  portal_visto_sin_respuesta:     { label: "Portal visto",  variant: "info" },
  reactivacion_programada:        { label: "Reactivación",  variant: "info" },
  presupuesto_aceptado_notificacion: { label: "Aceptado",   variant: "success", aceptado: true },
};

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export default function ColaMensajes({ clinica }: Props) {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const fetchSecuencias = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const url = new URL("/api/automatizaciones/secuencias", location.href);
      url.searchParams.set("estado", "pendiente");
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      const d = await res.json();
      setSecuencias(d.secuencias ?? []);
    } catch {
      setSecuencias([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [clinica]);

  useEffect(() => {
    fetchSecuencias();
  }, [fetchSecuencias]);

  async function handleAccion(id: string, accion: "enviar" | "descartar" | "editar", mensaje?: string) {
    try {
      const res = await fetch("/api/automatizaciones/secuencias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, accion, mensaje }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (accion === "enviar" || accion === "descartar") {
        setSecuencias((prev) => prev.filter((s) => s.id !== id));
        toast.success(accion === "enviar" ? "Mensaje enviado" : "Mensaje descartado");
      } else if (accion === "editar" && mensaje != null) {
        setSecuencias((prev) =>
          prev.map((s) => (s.id === id ? { ...s, mensajeGenerado: mensaje } : s))
        );
        setEditingId(null);
        toast.success("Mensaje guardado");
      }
    } catch {
      toast.error("No se pudo completar la acción. Inténtalo de nuevo.");
    }
  }

  function handleEnviar(sec: Secuencia) {
    const phone = cleanPhone(sec.telefono);
    if (phone) {
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(sec.mensajeGenerado)}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
    }
    handleAccion(sec.id, "enviar");
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 animate-pulse">
        <div className="h-4 w-48 bg-[var(--color-border)] rounded mb-3" />
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 bg-[var(--color-border)]/60 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="No se pudo cargar la cola de mensajes"
        detail="Los mensajes automáticos pendientes no están disponibles ahora mismo."
        onRetry={fetchSecuencias}
      />
    );
  }

  if (secuencias.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--color-border)]">
        <span className="text-sm font-bold text-[var(--color-foreground)]">Cola de mensajes automáticos</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface)] text-[var(--color-accent)]">
          {secuencias.length} pendiente{secuencias.length !== 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex gap-1 flex-wrap">
          {(["presupuesto_inactivo", "portal_visto_sin_respuesta", "reactivacion_programada", "presupuesto_aceptado_notificacion"] as TipoEvento[]).map((tipo) => {
            const count = secuencias.filter((s) => s.tipoEvento === tipo).length;
            if (!count) return null;
            const cfg = EVENTO_CONFIG[tipo];
            return (
              <StatePill key={tipo} variant={cfg.variant}>
                {cfg.aceptado && <Check size={10} strokeWidth={ICON_STROKE} aria-hidden />}
                {cfg.label} ({count})
              </StatePill>
            );
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="divide-y divide-[var(--color-border)]">
        {secuencias.map((sec) => {
          const cfg = EVENTO_CONFIG[sec.tipoEvento];
          const isEditing = editingId === sec.id;
          const isInternal = sec.canalSugerido === "interno";

          return (
            <div key={sec.id} className="p-4 bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatePill variant={cfg.variant} className="uppercase">
                      {cfg.aceptado && <Check size={10} strokeWidth={ICON_STROKE} aria-hidden />}
                      {cfg.label}
                    </StatePill>
                    {sec.clinica && (
                      <span className="text-[10px] text-[var(--color-muted)]">{sec.clinica}</span>
                    )}
                  </div>

                  <p className="flex items-center gap-1.5 font-semibold text-sm text-[var(--color-foreground)]">
                    {isInternal ? (
                      <Inbox size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                    ) : (
                      <Smartphone size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                    )}
                    <span>
                      {sec.pacienteNombre}
                      {sec.tratamiento && (
                        <span className="font-normal text-[var(--color-muted)] ml-1">— {sec.tratamiento}</span>
                      )}
                    </span>
                  </p>

                  {isInternal ? (
                    <p className="text-xs text-[var(--color-success)] mt-1 font-medium">
                      Presupuesto aceptado — notificación registrada
                    </p>
                  ) : isEditing ? (
                    <div className="mt-2">
                      <textarea
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        rows={3}
                        className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-accent)]"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed italic">
                      &ldquo;{sec.mensajeGenerado}&rdquo;
                    </p>
                  )}
                </div>

                {sec.tonoUsado && !isInternal && (
                  <span className="text-[9px] text-[var(--color-muted)] shrink-0">{sec.tonoUsado}</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleAccion(sec.id, "editar", editVal)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    {!isInternal && sec.mensajeGenerado && (
                      <button
                        onClick={() => handleEnviar(sec)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
                      >
                        <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Enviar por WhatsApp
                      </button>
                    )}
                    {!isInternal && (
                      <button
                        onClick={() => { setEditVal(sec.mensajeGenerado); setEditingId(sec.id); }}
                        className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      onClick={() => handleAccion(sec.id, "descartar")}
                      className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)] ml-auto"
                    >
                      Descartar
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
