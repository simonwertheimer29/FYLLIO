"use client";

// Cierre «Aceptó y pagó» con el cobro real de hoy. En dental lo común es
// señal o pago parcial (acepta 3.800 € y deja 500 hoy): el total del
// presupuesto se muestra como contexto y como chip de un toque, pero el
// campo "pagado hoy" empieza VACÍO a propósito — prefijarlo al total
// empujaba por inercia a registrar cobros que no ocurrieron e inflaba la
// facturación. «Aceptar sin pago» existe por lo mismo: no inventar un pago.
// Gemelo del MotivoPerdidaModal (el cierre malo pregunta el motivo; el
// bueno, el cobro).

import { useState } from "react";
import { METODOS_PAGO, type MetodoPago } from "../../lib/pagos-format";
import { Check, ICON_STROKE } from "../icons";

export type PagoCierre = { importe: number; metodo?: string };

export default function PagoCierreModal({
  patientName,
  amount,
  onConfirm,
  onCancel,
}: {
  patientName?: string;
  /** Importe del presupuesto aceptado (contexto y chip "el total"). */
  amount?: number;
  /** null = aceptar sin registrar pago. */
  onConfirm: (pago: PagoCierre | null) => void;
  onCancel: () => void;
}) {
  const [importeStr, setImporteStr] = useState("");
  const [metodo, setMetodo] = useState<MetodoPago>("Tarjeta");
  const [enviado, setEnviado] = useState(false);

  const importe = Number(importeStr.replace(",", "."));
  const importeValido = Number.isFinite(importe) && importe > 0;
  const totalStr = amount != null ? `${amount.toLocaleString("es-ES")} €` : null;
  const superaTotal = importeValido && amount != null && importe > amount;

  function confirmar(pago: PagoCierre | null) {
    if (enviado) return;
    setEnviado(true);
    onConfirm(pago);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Cuánto ha pagado hoy?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          {patientName ? <span className="font-semibold">{patientName}</span> : "El paciente"} aceptó
          su presupuesto{totalStr ? (
            <>
              {" "}de <span className="font-bold text-[var(--color-success)]">{totalStr}</span>
            </>
          ) : null}
          . Registra la señal o el pago de hoy — o acéptalo sin pago si aún no ha pagado nada.
        </p>

        <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)] mb-1">
          Pagado hoy
        </label>
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              placeholder="0"
              value={importeStr}
              onChange={(e) => setImporteStr(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] pl-3 pr-8 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">
              €
            </span>
          </div>
          {amount != null && amount > 0 && (
            <button
              type="button"
              onClick={() => setImporteStr(String(amount))}
              className="shrink-0 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              El total ({totalStr})
            </button>
          )}
        </div>
        {superaTotal && (
          <p className="text-[11px] text-[var(--color-warning)] mb-2">
            Es más que el importe del presupuesto ({totalStr}).
          </p>
        )}

        <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)] mb-1 mt-3">
          Método
        </label>
        <select
          value={metodo}
          onChange={(e) => setMetodo(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] mb-4"
        >
          {METODOS_PAGO.map((m) => (
            <option key={m} value={m}>
              {m === "Financiacion" ? "Financiación" : m}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => confirmar({ importe, metodo })}
          disabled={!importeValido || enviado}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--color-success)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed mb-2"
        >
          <Check size={14} strokeWidth={ICON_STROKE} aria-hidden />
          {importeValido
            ? `Registrar pago de ${importe.toLocaleString("es-ES")} €`
            : "Registrar pago"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={enviado}
            className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => confirmar(null)}
            disabled={enviado}
            className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-foreground)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Aceptar sin pago
          </button>
        </div>
      </div>
    </div>
  );
}
