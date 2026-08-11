"use client";

// La tercera columna: con quién estás hablando.
//
// El spec pedía «reutiliza la ficha que ya existe, no construyas otra». Al
// mirarlo, la ficha que existe son DOS PÁGINAS COMPLETAS de paciente (1.673 y
// 640 líneas, una importada literalmente como `Paciente360ViewLegacy`), no un
// panel: meterlas en 288 px sería peor que no ponerlas.
//
// Así que se reutiliza lo que sí es reutilizable —su ENDPOINT, el mismo
// `/api/pacientes/[id]` que alimenta la ficha grande— y aquí solo se pinta el
// resumen. Cero consultas nuevas y cero cifras nuevas: si un número no cuadra
// con el de la ficha, es que hay un cálculo paralelo, y eso se vería.
//
// Y el enlace a la ficha entera, que es donde se actúa sobre el paciente. Esta
// columna informa; no duplica lo que hace la página.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../../components/ui/Feedback";
import { eur } from "../../components/shared/Cifra";
import { fechaClinica } from "../../lib/time";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";

type Ficha = {
  paciente?: { nombre?: string; telefono?: string; clinicaId?: string | null };
  presupuestos: Array<{ id: string; estado?: string; importe?: number; tratamiento?: string | null }>;
  kpisPagos?: { pendiente?: number; totalFacturado?: number };
  proximaCita?: { fecha?: string } | null;
};

export function ContextoConversacion({
  conversacion,
}: {
  conversacion: Conversacion | null;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const pacienteId = conversacion?.pacienteId ?? null;

  const cargar = useCallback(async () => {
    if (!pacienteId) {
      setFicha(null);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const d = await cargarJSON<Ficha>(`/api/pacientes/${pacienteId}`, {
        validar: traeLista("presupuestos"),
      });
      setFicha(d);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [pacienteId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

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
    <div className="space-y-4 p-4">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Contacto
        </p>
        <p className="mt-1 text-sm font-semibold text-[var(--color-foreground)]">
          {conversacion.nombre}
        </p>
        <p className="text-[12px] tabular-nums text-[var(--color-muted)]">
          {conversacion.telefono}
        </p>
        {conversacion.clinicaNombre && (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
            {conversacion.clinicaNombre}
          </p>
        )}
      </div>

      {/* Sin paciente no hay ficha que enseñar, y decirlo es más útil que un
          hueco: significa que esta persona no está en el sistema todavía. */}
      {!pacienteId ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3">
          <p className="text-[13px] font-medium text-[var(--color-foreground)]">
            {conversacion.leadId ? "Es un lead, todavía sin ficha" : "No está en el sistema"}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
            {conversacion.leadId
              ? "Cuando se convierta en paciente, aquí saldrán sus presupuestos y sus pagos."
              : "Ni paciente ni lead. Créale una ficha para poder trabajarlo."}
          </p>
        </div>
      ) : error ? (
        <ErrorState detail={`La ficha no se pudo cargar. ${error}`} onRetry={cargar} />
      ) : cargando && !ficha ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-muted)]"
            />
          ))}
        </div>
      ) : ficha ? (
        <>
          <Dato
            etiqueta="Pendiente de cobro"
            valor={eur(ficha.kpisPagos?.pendiente ?? 0)}
          />
          <Dato etiqueta="Cobrado" valor={eur(ficha.kpisPagos?.totalFacturado ?? 0)} />
          {ficha.proximaCita?.fecha && (
            <Dato etiqueta="Próxima cita" valor={fechaClinica(ficha.proximaCita.fecha)} />
          )}

          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Presupuestos ({ficha.presupuestos.length})
            </p>
            <ul className="mt-1 space-y-1">
              {ficha.presupuestos.slice(0, 4).map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-[var(--color-border)] px-2.5 py-2"
                >
                  <p className="truncate text-[13px] text-[var(--color-foreground)]">
                    {p.tratamiento ?? "Sin tratamiento"}
                  </p>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {p.estado ?? "—"}
                    {p.importe != null ? ` · ${eur(p.importe)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <Link
            href={`/pacientes/${pacienteId}`}
            className="block rounded-lg border border-[var(--color-border)] px-3 py-2 text-center text-[13px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            Ver ficha completa
          </Link>
        </>
      ) : null}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-[var(--color-muted)]">{etiqueta}</span>
      <span className="text-[13px] font-semibold tabular-nums text-[var(--color-foreground)]">
        {valor}
      </span>
    </div>
  );
}
