"use client";

// Motivo al descartar un lead (kanban y panel).
//
// Antes se escribía "Rechazo_Producto" en silencio; desde el 2026-07-27 se
// pregunta, y desde MEJORAS 42 hay seis motivos reales en vez de dos. El
// vocabulario es CERRADO a propósito: nada de "otro (texto libre)" —el texto
// libre es lo que rompió el dato en la nº 41— y cada motivo dice si el caso
// aún se puede rescatar, que es lo que decide dónde vive después.

import { useEffect, useRef, useState } from "react";
import { MOTIVOS_ORDENADOS, MOTIVO_DEF, type MotivoLead } from "../../../lib/leads/motivos";
import { cargarJSON } from "../../../lib/fetch-json";
import { sugerirMotivoLead, type MotivoDelLog } from "../../../lib/agente/motivo-sugerido";
import { Sparkles, ICON_STROKE } from "../../../components/icons";

export function MotivoNoInteresModal({
  nombre,
  telefono,
  onConfirm,
  onCancel,
}: {
  nombre: string;
  /** F7 — con teléfono, el modal PRE-RELLENA desde el log lo que el agente
   *  ya recogió. La persona confirma; el vocabulario sigue CERRADO. */
  telefono?: string | null;
  onConfirm: (motivo: MotivoLead) => void;
  onCancel: () => void;
}) {
  const [seleccionado, setSeleccionado] = useState<MotivoLead | null>(null);
  const [sugerencia, setSugerencia] = useState<MotivoDelLog | null>(null);
  const tocadoRef = useRef(false);
  useEffect(() => {
    if (!telefono) return;
    let vivo = true;
    void (async () => {
      try {
        const d = await cargarJSON<{ sugerencia: MotivoDelLog | null }>(
          `/api/agente/motivo-sugerido?telefono=${encodeURIComponent(telefono)}`,
        );
        if (!vivo || !d.sugerencia) return;
        setSugerencia(d.sugerencia);
        if (!tocadoRef.current) {
          const mapeado = sugerirMotivoLead(d.sugerencia.frase);
          if (mapeado) setSeleccionado((prev) => prev ?? mapeado);
        }
      } catch {
        // caída-declarada: sin sugerencia el modal funciona como siempre — el pre-relleno es ayuda, no requisito
      }
    })();
    return () => {
      vivo = false;
    };
  }, [telefono]);

  const reactivables = MOTIVOS_ORDENADOS.filter((m) => MOTIVO_DEF[m].reactivable);
  const descartados = MOTIVOS_ORDENADOS.filter((m) => !MOTIVO_DEF[m].reactivable);

  const opcion = (m: MotivoLead) => (
    <label
      key={m}
      className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
        seleccionado === m
          ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      <input
        type="radio"
        name="motivo-no-interes"
        value={m}
        checked={seleccionado === m}
        onChange={() => {
          tocadoRef.current = true;
          setSeleccionado(m);
        }}
        className="accent-[var(--color-danger)] mt-0.5"
      />
      <span>
        <span className="block text-xs font-medium text-[var(--color-foreground)]">
          {MOTIVO_DEF[m].label}
        </span>
        <span className="block text-[11px] text-[var(--color-muted)]">{MOTIVO_DEF[m].hint}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Por qué se descarta este lead?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          <span className="font-semibold">{nombre}</span> — se moverá a{" "}
          <span className="font-bold text-[var(--color-danger)]">No Interesado</span>
        </p>

        {sugerencia && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-[var(--color-accent-soft)] px-3 py-2.5">
            <Sparkles size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-[var(--color-foreground)]">
              El agente recogió en la conversación:{" "}
              <span className="font-medium">«{sugerencia.frase}»</span>. Confírmalo o corrígelo — lo que se guarda lo decides tú.
            </p>
          </div>
        )}

        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warning)] mb-1.5">
          Se puede retomar
        </p>
        <div className="space-y-2 mb-4">{reactivables.map(opcion)}</div>

        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
          Decisión tomada
        </p>
        <div className="space-y-2 mb-4">{descartados.map(opcion)}</div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => seleccionado && onConfirm(seleccionado)}
            disabled={!seleccionado}
            className="flex-1 rounded-lg bg-[var(--color-danger)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirmar y mover
          </button>
        </div>
      </div>
    </div>
  );
}
