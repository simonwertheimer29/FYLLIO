"use client";

// Bloque 3 — cambiar el estado de un presupuesto DESDE la tabla de Pacientes.
//
// La celda "Aceptado" es un derivado: lo que se edita es el estado del
// presupuesto ORIGEN, con las MISMAS reglas y modales del kanban:
//   - un solo presupuesto abierto → editor directo
//   - varios → paso previo de selección (navegación, no un modal de flujo)
//   - solo estados alcanzables desde el actual (transiciones.ts)
//   - ACEPTADO → PagoCierreModal · PERDIDO → MotivoPerdidaModal
//   - la escritura va por la ruta kanban de siempre (mismo servicio)
// Los presupuestos CERRADOS no se editan desde aquí: se corrigen en el
// kanban o la ficha (la tabla corrige, no esquiva el flujo).

import { useState } from "react";
import { toast } from "sonner";
import PagoCierreModal, { type PagoCierre } from "../../components/presupuestos/PagoCierreModal";
import MotivoPerdidaModal from "../../components/presupuestos/MotivoPerdidaModal";
import { estadosAlcanzables } from "../../lib/presupuestos/transiciones";
import { ESTADO_CONFIG } from "../../lib/presupuestos/colors";
import type { PresupuestoEstado, MotivoPerdida } from "../../lib/presupuestos/types";
import { X, ICON_STROKE } from "../../components/icons";

export type PresupuestoBrief = {
  id: string;
  estado: string;
  importe: number | null;
  tratamiento: string | null;
};

const fmtEUR = (n: number) => `${n.toLocaleString("es-ES")} €`;

export function EstadoPresupuestoFlow({
  pacienteNombre,
  presupuestosAbiertos,
  onClose,
  onMutado,
}: {
  pacienteNombre: string;
  /** Solo abiertos (el caller ya excluyó ACEPTADO/PERDIDO). */
  presupuestosAbiertos: PresupuestoBrief[];
  onClose: () => void;
  /** Tras una mutación confirmada: el caller refresca los derivados de la fila. */
  onMutado: () => void;
}) {
  const [sel, setSel] = useState<PresupuestoBrief | null>(
    presupuestosAbiertos.length === 1 ? presupuestosAbiertos[0] : null,
  );
  const [modal, setModal] = useState<"ACEPTADO" | "PERDIDO" | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function mutar(body: Record<string, unknown>, exito: string) {
    if (!sel || guardando) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/presupuestos/kanban/${sel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d?.error ?? "No se pudo actualizar el estado — inténtalo de nuevo");
        return;
      }
      // Honesto: el estado se guardó pero el pago del cierre falló.
      if (d?.pagoRegistrado === false) {
        toast.error("Estado guardado, pero el pago NO se registró — regístralo desde la ficha");
      } else {
        toast.success(exito);
      }
      onMutado();
      onClose();
    } catch {
      toast.error("No se pudo actualizar el estado — comprueba la conexión e inténtalo de nuevo");
    } finally {
      setGuardando(false);
    }
  }

  function elegirEstado(e: PresupuestoEstado) {
    if (e === "ACEPTADO") return setModal("ACEPTADO");
    if (e === "PERDIDO") return setModal("PERDIDO");
    void mutar({ estado: e }, `Estado cambiado a ${ESTADO_CONFIG[e]?.label ?? e} — actualizado en Presupuestos`);
  }

  function confirmarAceptado(pago: PagoCierre | null) {
    setModal(null);
    void mutar(
      { estado: "ACEPTADO", ...(pago ? { pago } : {}) },
      pago
        ? `Cobro registrado (${fmtEUR(pago.importe)}) — actualizado en Presupuestos y Cobros`
        : "Presupuesto aceptado — actualizado en Presupuestos",
    );
  }

  function confirmarPerdido(motivo: MotivoPerdida, texto?: string, reactivar?: boolean) {
    setModal(null);
    void mutar(
      {
        estado: "PERDIDO",
        motivoPerdida: motivo,
        ...(texto ? { motivoPerdidaTexto: texto } : {}),
        ...(reactivar ? { reactivacion: true } : {}),
      },
      "Presupuesto marcado Perdido — motivo guardado en Presupuestos",
    );
  }

  if (modal === "ACEPTADO" && sel) {
    return (
      <PagoCierreModal
        patientName={pacienteNombre}
        amount={sel.importe ?? undefined}
        onConfirm={confirmarAceptado}
        onCancel={() => setModal(null)}
      />
    );
  }
  if (modal === "PERDIDO" && sel) {
    return (
      <MotivoPerdidaModal
        patientName={pacienteNombre}
        onConfirm={confirmarPerdido}
        onCancel={() => setModal(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-display text-sm font-semibold text-[var(--color-foreground)]">
            {sel ? "Cambiar estado del presupuesto" : "¿Qué presupuesto quieres corregir?"}
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {!sel ? (
          <div className="p-3 space-y-2">
            {presupuestosAbiertos.map((p) => (
              <button
                key={p.id}
                onClick={() => setSel(p)}
                className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] px-4 py-3"
              >
                <span className="text-sm font-semibold text-[var(--color-foreground)]">
                  {p.tratamiento ?? "Presupuesto"}
                </span>
                <span className="ml-2 text-xs text-[var(--color-muted)] tabular-nums">
                  {p.importe != null ? fmtEUR(p.importe) : ""}
                </span>
                <p className="text-[10px] text-[var(--color-muted)] mt-0.5">
                  {ESTADO_CONFIG[p.estado as PresupuestoEstado]?.label ?? p.estado}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-3">
            <p className="px-2 pb-2 text-xs text-[var(--color-muted)]">
              {sel.tratamiento ?? "Presupuesto"}
              {sel.importe != null ? ` · ${fmtEUR(sel.importe)}` : ""} — ahora en{" "}
              <span className="font-semibold text-[var(--color-foreground)]">
                {ESTADO_CONFIG[sel.estado as PresupuestoEstado]?.label ?? sel.estado}
              </span>
            </p>
            <div className="space-y-1.5">
              {estadosAlcanzables(sel.estado as PresupuestoEstado).map((e) => (
                <button
                  key={e}
                  disabled={guardando}
                  onClick={() => elegirEstado(e)}
                  className="w-full text-left text-xs font-semibold rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] px-4 py-2.5 text-[var(--color-foreground)] disabled:opacity-40"
                >
                  {ESTADO_CONFIG[e]?.label ?? e}
                  {e === "ACEPTADO" && (
                    <span className="ml-2 font-normal text-[10px] text-[var(--color-muted)]">abre el registro de pago</span>
                  )}
                  {e === "PERDIDO" && (
                    <span className="ml-2 font-normal text-[10px] text-[var(--color-muted)]">pide el motivo</span>
                  )}
                </button>
              ))}
            </div>
            {presupuestosAbiertos.length > 1 && (
              <button
                onClick={() => setSel(null)}
                className="mt-2 text-[10px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-2"
              >
                ← Elegir otro presupuesto
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
