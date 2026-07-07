"use client";

// Sprint UI — modal de confirmación propio que sustituye a los
// confirm()/alert() nativos en toda la app. Patrón: modal para decidir,
// toast (sonner) para el resultado.
//
// Uso:
//   const [open, setOpen] = useState(false);
//   <ConfirmDialog
//     open={open}
//     title="¿Cancelar esta cita?"
//     description="Avisaremos al paciente por WhatsApp."
//     confirmLabel="Cancelar cita"
//     destructive
//     onConfirm={() => { ...; setOpen(false); }}
//     onClose={() => setOpen(false)}
//   />

import { useEffect, useRef, type ReactNode } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Texto o contenido bajo el título (p. ej. vista previa del mensaje). */
  description?: ReactNode;
  /** Verbo de la acción, en el botón primario. Ej: "Enviar", "Eliminar". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Acción irreversible → botón primario en rojo. */
  destructive?: boolean;
  /** Deshabilita el botón mientras la acción está en curso. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // No se puede cerrar mientras la acción async está en curso.
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const confirmClass = destructive
    ? "bg-[var(--color-danger)] text-[var(--color-on-accent)] hover:opacity-90"
    : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div className="fyllio-fade-in relative w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          {title}
        </h2>
        {description && (
          <div className="mt-2 text-sm text-[var(--color-muted)]">{description}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 transition-colors ${confirmClass}`}
          >
            {busy ? "Un momento…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
