"use client";

// La tercera columna: quién es, y LA FICHA DEL CASO.
//
// ─── LA REGLA DE ESTA PANTALLA ─────────────────────────────────────────────
//
// **El centro es SOLO el hilo y la caja de escribir. Todo contexto,
// recomendación y aviso vive AQUÍ, sin excepciones** (2026-08-11).
//
// FASE B (B2, 2026-08-17): la FICHA DEL CASO **sustituye** al resumen viejo
// («qué pasa» del clasificador + tarjetas de presupuestos/pagos) — esta
// columna no puede tener dos resúmenes del mismo caso, se desincronizan y la
// coordinadora acaba viendo cosas distintas. Queda: CONTACTO arriba (saber
// con quién hablas va antes, decisión del 2026-08-12 — identidad, no
// resumen), LA ficha (el mismo componente que Seguimiento, misma fuente), y
// la salida a la ficha completa del paciente para el detalle financiero.

import type { Conversacion } from "../../lib/mensajeria/conversaciones";
import Link from "next/link";
import { FichaCasoPanel } from "../../components/agente/FichaCasoPanel";

export function ContextoConversacion({
  conversacion,
}: {
  conversacion: Conversacion | null;
}) {
  const pacienteId = conversacion?.pacienteId ?? null;

  if (!conversacion) {
    return (
      <div className="p-4">
        <p className="text-[13px] text-[var(--color-muted)]">
          Aquí aparecerá con quién estás hablando.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {/* ─── 1 · Quién es (identidad, no resumen — se queda) ──────────── */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Contacto
        </p>
        <p className="mt-1.5 text-[15px] font-semibold text-[var(--color-foreground)]">
          {conversacion.nombre}
        </p>
        <p className="mt-0.5 text-[12px] tabular-nums text-[var(--color-muted)]">
          {conversacion.telefono}
        </p>
        {conversacion.clinicaNombre && (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
            {conversacion.clinicaNombre}
          </p>
        )}
      </div>

      {/* ─── 2 · LA FICHA DEL CASO — el único resumen ─────────────────── */}
      <FichaCasoPanel telefono={conversacion.telefono} modo="mensajeria" />

      {/* ─── 3 · La salida al detalle financiero del paciente ─────────── */}
      {pacienteId && (
        <Link
          href={`/pacientes/${pacienteId}`}
          className="block rounded-lg border border-[var(--color-border)] px-3 py-2 text-center text-[13px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
        >
          Ver ficha completa
        </Link>
      )}
    </div>
  );
}
