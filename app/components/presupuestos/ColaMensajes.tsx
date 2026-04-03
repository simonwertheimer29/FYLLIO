"use client";

// app/components/presupuestos/ColaMensajes.tsx
// Cola de mensajes automáticos pendientes de envío.
// Se muestra en TareasView antes de las tareas urgentes.

import { useState, useEffect, useCallback } from "react";
import type { Secuencia, TipoEvento } from "../../lib/presupuestos/types";

interface Props {
  clinica?: string; // undefined = todas (manager/admin)
}

const EVENTO_CONFIG: Record<TipoEvento, { label: string; color: string }> = {
  presupuesto_inactivo:           { label: "Sin actividad",  color: "bg-amber-100 text-amber-700" },
  portal_visto_sin_respuesta:     { label: "Portal visto",   color: "bg-sky-100 text-sky-700" },
  reactivacion_programada:        { label: "Reactivación",   color: "bg-violet-100 text-violet-700" },
  presupuesto_aceptado_notificacion: { label: "Aceptado ✓",  color: "bg-emerald-100 text-emerald-700" },
};

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export default function ColaMensajes({ clinica }: Props) {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const fetchSecuencias = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/automatizaciones/secuencias", location.href);
      url.searchParams.set("estado", "pendiente");
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      const d = await res.json();
      setSecuencias(d.secuencias ?? []);
    } catch {
      setSecuencias([]);
    } finally {
      setLoading(false);
    }
  }, [clinica]);

  useEffect(() => {
    fetchSecuencias();
  }, [fetchSecuencias]);

  async function handleAccion(id: string, accion: "enviar" | "descartar" | "editar", mensaje?: string) {
    try {
      await fetch("/api/automatizaciones/secuencias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, accion, mensaje }),
      });
      if (accion === "enviar" || accion === "descartar") {
        setSecuencias((prev) => prev.filter((s) => s.id !== id));
      } else if (accion === "editar" && mensaje != null) {
        setSecuencias((prev) =>
          prev.map((s) => (s.id === id ? { ...s, mensajeGenerado: mensaje } : s))
        );
        setEditingId(null);
      }
    } catch {
      // silent
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
      <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 animate-pulse">
        <div className="h-4 w-48 bg-violet-200 rounded mb-3" />
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 bg-violet-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (secuencias.length === 0) return null;

  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-violet-100">
        <span className="text-sm font-bold text-violet-800">Cola de mensajes automáticos</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-200 text-violet-700">
          {secuencias.length} pendiente{secuencias.length !== 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex gap-1 flex-wrap">
          {(["presupuesto_inactivo", "portal_visto_sin_respuesta", "reactivacion_programada", "presupuesto_aceptado_notificacion"] as TipoEvento[]).map((tipo) => {
            const count = secuencias.filter((s) => s.tipoEvento === tipo).length;
            if (!count) return null;
            const cfg = EVENTO_CONFIG[tipo];
            return (
              <span key={tipo} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.color}`}>
                {cfg.label} ({count})
              </span>
            );
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="divide-y divide-violet-100">
        {secuencias.map((sec) => {
          const cfg = EVENTO_CONFIG[sec.tipoEvento];
          const isEditing = editingId === sec.id;
          const isInternal = sec.canalSugerido === "interno";

          return (
            <div key={sec.id} className="p-4 bg-white hover:bg-violet-50/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {sec.clinica && (
                      <span className="text-[10px] text-slate-400">{sec.clinica}</span>
                    )}
                  </div>

                  <p className="font-semibold text-sm text-slate-900">
                    {isInternal ? "📬" : "📱"} {sec.pacienteNombre}
                    {sec.tratamiento && (
                      <span className="font-normal text-slate-500 ml-1">— {sec.tratamiento}</span>
                    )}
                  </p>

                  {isInternal ? (
                    <p className="text-xs text-emerald-700 mt-1 font-medium">
                      Presupuesto aceptado — notificación registrada
                    </p>
                  ) : isEditing ? (
                    <div className="mt-2">
                      <textarea
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        rows={3}
                        className="w-full border border-violet-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-violet-400"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed italic">
                      &ldquo;{sec.mensajeGenerado}&rdquo;
                    </p>
                  )}
                </div>

                {sec.tonoUsado && !isInternal && (
                  <span className="text-[9px] text-slate-400 shrink-0">{sec.tonoUsado}</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleAccion(sec.id, "editar", editVal)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    {!isInternal && sec.mensajeGenerado && (
                      <button
                        onClick={() => handleEnviar(sec)}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        💬 Enviar por WhatsApp
                      </button>
                    )}
                    {!isInternal && (
                      <button
                        onClick={() => { setEditVal(sec.mensajeGenerado); setEditingId(sec.id); }}
                        className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      onClick={() => handleAccion(sec.id, "descartar")}
                      className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 ml-auto"
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
