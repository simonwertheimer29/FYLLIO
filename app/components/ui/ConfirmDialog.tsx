"use client";

// Sprint UI — modal de confirmación propio que sustituye a los
// confirm()/alert() nativos en toda la app. Patrón: modal para decidir,
// toast (sonner) para el resultado. Desde el 10-sep (MEJORAS 221) es un
// `Modal` con dos botones: el cascarón, el velo y el teclado son los comunes.
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
import { Modal, btnModalPeligro, btnModalPrimario, btnModalSecundario } from "./Modal";

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
  // Modal ya cierra con Escape (no mientras `busy`) y devuelve el foco; aquí
  // solo se decide que el foco inicial caiga en el botón que confirma.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <Modal
      titulo={title}
      onCerrar={onClose}
      ocupado={busy}
      ancho="sm"
      pie={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnModalSecundario}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={destructive ? btnModalPeligro : btnModalPrimario}
          >
            {busy ? "Un momento…" : confirmLabel}
          </button>
        </>
      }
    >
      {description && <div className="text-sm text-[var(--color-muted)]">{description}</div>}
    </Modal>
  );
}
