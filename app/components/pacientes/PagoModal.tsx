"use client";

// PagoModal — alta/edición de un pago del paciente (Sprint 14a Bloque 6).
// Bloque 3 (2026-07-23): EXTRAÍDO de Paciente360View a archivo propio para
// que la tabla de Pacientes reutilice el MISMO modal (regla: ningún modal
// nuevo si ya existe uno para ese flujo). Escribe por /api/pacientes/[id]/
// pagos — el registro origen del cobro es el pago, nunca el paciente.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Pago, TipoPago, MetodoPago } from "../../lib/pagos-format";
import { AlertTriangle, ICON_STROKE } from "../icons";
import { Modal, btnModalPrimario, btnModalSecundario } from "../ui/Modal";
import { hoyISO } from "../../lib/time";

export const TIPOS_PAGO_OPTS: Array<{ value: TipoPago; label: string; help: string }> = [
  {
    value: "Senal",
    label: "Señal",
    help: "Anticipo al firmar el presupuesto. Inicia el compromiso del paciente.",
  },
  {
    value: "Primer_Pago_Plan",
    label: "Primer pago de plan",
    help: "Primer movimiento del plan de pagos. Arranca el tratamiento.",
  },
  {
    value: "Liquidacion",
    label: "Liquidación",
    help: "Pago final del importe restante.",
  },
];

export const METODOS_PAGO_OPTS: MetodoPago[] = [
  "Efectivo",
  "Tarjeta",
  "Transferencia",
  "Bizum",
  "Financiacion",
  "Otro",
];

export function PagoModal({
  mode,
  pacienteId,
  clinicaId,
  pago,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  pacienteId: string;
  /** Sprint 14b Bloque 0 — clínica del paciente para cargar métodos
   *  configurados (con fallback global). Si null, usamos lista hardcoded. */
  clinicaId: string | null;
  pago?: Pago;
  onClose: () => void;
  onDone: () => void;
}) {
  const [importe, setImporte] = useState<string>(
    pago ? String(pago.importe) : "",
  );
  const [fechaPago, setFechaPago] = useState<string>(
    pago?.fechaPago ?? hoyISO(),
  );
  const [metodo, setMetodo] = useState<string>(pago?.metodo ?? "Tarjeta");
  const [tipo, setTipo] = useState<TipoPago>(pago?.tipo ?? "Senal");
  const [nota, setNota] = useState<string>(pago?.nota ?? "");
  const [submitting, setSubmitting] = useState(false);
  // Sprint 14b Bloque 0 — métodos de pago desde Configuraciones_Clinica
  // (con fallback a global si la clínica no customizó). Mientras carga,
  // usamos METODOS_PAGO_OPTS del enum como respaldo.
  const [metodosDisp, setMetodosDisp] = useState<string[]>(
    METODOS_PAGO_OPTS.slice(),
  );
  useEffect(() => {
    let cancelled = false;
    const target = clinicaId ?? "global";
    fetch(`/api/configuraciones/${target}?categoria=Metodos_Pago`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.opciones) return;
        const valores = (j.opciones as Array<{ valor: string }>).map((o) => o.valor);
        if (valores.length > 0) setMetodosDisp(valores);
      })
      .catch(() => {
        // Fallback al hardcoded; ya está seteado.
      });
    return () => {
      cancelled = true;
    };
  }, [clinicaId]);
  const [error, setError] = useState<string | null>(null);

  const isMigrated = pago && (pago.nota ?? "").includes("[MIGRADO Sprint 13.1]");
  const tipoCfg = TIPOS_PAGO_OPTS.find((t) => t.value === tipo);

  const inputClass =
    "mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-sm focus:border-[var(--color-accent)] focus:outline-none";
  const labelClass =
    "text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide";

  async function handleSubmit() {
    const importeNum = Number(importe.replace(",", "."));
    if (!Number.isFinite(importeNum) || importeNum <= 0) {
      setError("El importe debe ser un número mayor que 0");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      setError("Fecha inválida (AAAA-MM-DD)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url =
        mode === "create"
          ? `/api/pacientes/${pacienteId}/pagos`
          : `/api/pacientes/${pacienteId}/pagos/${pago!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importe: importeNum,
          fechaPago,
          metodo,
          tipo,
          nota: nota || undefined,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      toast.success(mode === "create" ? "Pago registrado" : "Pago actualizado");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      titulo={mode === "create" ? "Registrar pago" : "Editar pago"}
      subtitulo={
        isMigrated ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
            <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
            Pago histórico migrado, edita con cuidado.
          </span>
        ) : undefined
      }
      onCerrar={onClose}
      ocupado={submitting}
      pie={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className={btnModalSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className={btnModalPrimario}>
            {submitting ? "Guardando…" : mode === "create" ? "Guardar pago" : "Guardar cambios"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Importe (€)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Fecha</label>
              <input
                type="date"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Método</label>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className={inputClass}
              >
                {/* Sprint 14b Bloque 0 — métodos de pago configurables
                    por clínica via Configuraciones_Clinica. Si el método
                    actual del pago en edición no está en la lista (caso
                    legacy o método deshabilitado), lo añadimos al final
                    para que se vea en lugar de aparentar 'no
                    seleccionado'. */}
                {!metodosDisp.includes(metodo) && metodo && (
                  <option value={metodo}>{metodo}</option>
                )}
                {metodosDisp.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoPago)}
                className={inputClass}
              >
                {TIPOS_PAGO_OPTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {tipoCfg && (
                <p className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">{tipoCfg.help}</p>
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Nota (opcional)</label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
          {error && (
            <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
      </div>
    </Modal>
  );
}
