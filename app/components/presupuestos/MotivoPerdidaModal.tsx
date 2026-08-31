"use client";

import { useEffect, useRef, useState } from "react";
import type { MotivoPerdida } from "../../lib/presupuestos/types";
import { cargarJSON } from "../../lib/fetch-json";
import { sugerirMotivoPerdida, type MotivoDelLog } from "../../lib/agente/motivo-sugerido";
import { Droplet, Sparkles, ICON_STROKE } from "../icons";

import { MOTIVOS_PERDIDA as MOTIVOS } from "../../lib/presupuestos/motivos-perdida";

export default function MotivoPerdidaModal({
  patientName,
  presupuestoId,
  onConfirm,
  onCancel,
}: {
  patientName: string;
  /** F7 — con id, el modal PRE-RELLENA desde el log lo que el agente ya
   *  recogió (motivo_rechazo / que_le_frena). La persona confirma: la
   *  columna la escribe ella, una vez — escritor único humano. */
  presupuestoId?: string;
  onConfirm: (motivo: MotivoPerdida, texto?: string, reactivar?: boolean) => void;
  onCancel: () => void;
}) {
  const [seleccionado, setSeleccionado] = useState<MotivoPerdida | null>(null);
  const [texto, setTexto] = useState("");
  const [reactivar, setReactivar] = useState(false);
  // La sugerencia del agente: contexto SIEMPRE que exista; preselección solo
  // con mapeo léxico inequívoco, y solo si la persona no ha tocado nada aún.
  const [sugerencia, setSugerencia] = useState<MotivoDelLog | null>(null);
  const tocadoRef = useRef(false);
  useEffect(() => {
    if (!presupuestoId) return;
    let vivo = true;
    void (async () => {
      try {
        const d = await cargarJSON<{ sugerencia: MotivoDelLog | null }>(
          `/api/agente/motivo-sugerido?presupuestoId=${encodeURIComponent(presupuestoId)}`,
        );
        if (!vivo || !d.sugerencia) return;
        setSugerencia(d.sugerencia);
        if (!tocadoRef.current) {
          const mapeado = sugerirMotivoPerdida(d.sugerencia.frase);
          if (mapeado) setSeleccionado((prev) => prev ?? mapeado);
        }
      } catch {
        // caída-declarada: sin sugerencia el modal funciona como siempre — el pre-relleno es ayuda, no requisito
      }
    })();
    return () => {
      vivo = false;
    };
  }, [presupuestoId]);

  function handleConfirm() {
    if (!seleccionado) return;
    onConfirm(seleccionado, seleccionado === "otro" ? texto.trim() || undefined : undefined, reactivar || undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Por qué se perdió este presupuesto?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          <span className="font-semibold">{patientName}</span> — se moverá a{" "}
          <span className="font-bold text-[var(--color-danger)]">Perdido</span>
        </p>

        {sugerencia && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-[var(--color-accent-soft)] px-3 py-2.5">
            <Sparkles size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-[var(--color-foreground)]">
              El agente recogió en la conversación:{" "}
              <span className="font-medium">«{sugerencia.frase}»</span>
              {sugerencia.decision ? ` (decisión: ${sugerencia.decision})` : ""}. Confírmalo o corrígelo — lo que se guarda lo decides tú.
            </p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {MOTIVOS.map((m) => (
            <label
              key={m.valor}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                seleccionado === m.valor
                  ? "border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <input
                type="radio"
                name="motivo"
                value={m.valor}
                checked={seleccionado === m.valor}
                onChange={() => {
                  tocadoRef.current = true;
                  setSeleccionado(m.valor);
                  // «Otro» hereda la frase del agente como punto de partida.
                  if (m.valor === "otro" && sugerencia && texto === "") setTexto(sugerencia.frase);
                }}
                className="accent-[var(--color-danger)]"
              />
              <span className="text-xs font-medium text-[var(--color-foreground)]">{m.label}</span>
            </label>
          ))}
        </div>

        {seleccionado === "otro" && (
          <textarea
            placeholder="Describe el motivo…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] mb-4"
          />
        )}

        {/* Reactivar checkbox */}
        <label className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5 cursor-pointer mb-4 select-none">
          <input
            type="checkbox"
            checked={reactivar}
            onChange={(e) => setReactivar(e.target.checked)}
            className="accent-[var(--color-accent)] w-3.5 h-3.5 shrink-0"
          />
          <span className="text-xs text-[var(--color-foreground)] font-medium">Recordar reactivar en 3 meses</span>
          <span className="inline-flex items-center gap-1 text-[9px] text-[var(--color-accent)] ml-auto shrink-0">
            <Droplet size={10} strokeWidth={ICON_STROKE} aria-hidden />
            Reactivación
          </span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
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
