"use client";

// La tercera columna: qué pasa y con quién estás hablando.
//
// ─── LA REGLA DE ESTA PANTALLA ─────────────────────────────────────────────
//
// **El centro es SOLO el hilo y la caja de escribir. Todo contexto,
// recomendación y aviso vive AQUÍ, sin excepciones** (2026-08-11).
//
// Y el orden de esta columna es el de lo que DECIDE ANTES: primero qué le pasa
// a este caso y si necesita criterio, después el contacto y el presupuesto. Un
// aviso enterrado bajo tres datos de ficha no es un aviso.
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
import type { PresupuestoIntervencion } from "../../lib/presupuestos/types";
import type { CasoDeConversacion } from "./useCasoDeConversacion";
import { situacionPresupuesto } from "../../lib/presupuestos/situacion";
import { AlertTriangle, Sparkles } from "../../components/icons";

/** El caso está quebrado. Misma fuente que el panel de Seguimiento. */
function quebrado(item: PresupuestoIntervencion): boolean {
  return item.automatizacion?.estado === "quebrado";
}

type Ficha = {
  paciente?: { nombre?: string; telefono?: string; clinicaId?: string | null };
  presupuestos: Array<{ id: string; estado?: string; importe?: number; tratamiento?: string | null }>;
  kpisPagos?: { pendiente?: number; totalFacturado?: number };
  proximaCita?: { fecha?: string } | null;
};

export function ContextoConversacion({
  conversacion,
  caso,
  cargandoCaso,
  errorCaso,
  recargarCaso,
}: {
  conversacion: Conversacion | null;
  caso: CasoDeConversacion | null;
  cargandoCaso: boolean;
  errorCaso: string | null;
  recargarCaso: () => void;
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

  // El caso vivo primero; los cerrados, historial. Es la regla del 2026-08-11
  // aplicada también aquí: el panel enseña de qué se está hablando, no todo lo
  // que esta persona ha tenido alguna vez.
  const situacion = caso ? situacionPresupuesto(caso.item) : null;

  const CERRADOS = new Set(["ACEPTADO", "PERDIDO", "RECHAZADO"]);
  const abiertos = (ficha?.presupuestos ?? []).filter((p) => !CERRADOS.has(p.estado ?? ""));
  const ultimo = abiertos[0] ?? ficha?.presupuestos?.[0] ?? null;
  const anteriores = (ficha?.presupuestos ?? []).filter((p) => p.id !== ultimo?.id);

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
      {/* ─── 1 · Lo que decide: necesita criterio ─────────────────────── */}
      {caso && quebrado(caso.item) && (
        <div className="flex gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3 py-2.5">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
            aria-hidden
          />
          <div className="min-w-0 text-[12.5px] leading-relaxed text-[var(--color-foreground)]">
            <p className="font-semibold">Esto necesita tu criterio</p>
            <p className="mt-0.5 text-[var(--color-muted)]">
              {caso.item.automatizacion?.motivo ? `${caso.item.automatizacion.motivo}. ` : ""}
              No he preparado ningún borrador a propósito: lo que se conteste aquí lo sostiene la
              clínica.
            </p>
          </div>
        </div>
      )}

      {/* ─── 2 · Qué pasa y qué se recomienda ─────────────────────────── */}
      {situacion ? (
        <div className="rounded-xl border border-[var(--color-border)] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Qué pasa
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-foreground)]">
            {situacion.quePasa}
          </p>
          <p className="mt-2 text-[13px] font-semibold text-[var(--color-accent)]">
            {situacion.recomendacion}
          </p>
          {caso?.item.intencionDetectada && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
              <Sparkles className="h-2.5 w-2.5" aria-hidden />
              {caso.item.intencionDetectada}
            </p>
          )}
        </div>
      ) : cargandoCaso ? (
        <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
      ) : errorCaso ? (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            No se pudo cargar el caso
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
            {errorCaso} Sin él no hay recomendación — el hilo y el envío siguen funcionando.
          </p>
          <button
            type="button"
            onClick={recargarCaso}
            className="mt-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : !conversacion.presupuestoId && conversacion.leadId ? (
        // Tiene caso, pero el agente no lo cubre: el clasificador de leads se
        // quedó fuera del rediseño «decisión primero» (recorte del 6 de agosto).
        <div className="rounded-xl border border-[var(--color-border)] p-3">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            Es un lead, no un presupuesto
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
            El agente todavía no analiza conversaciones de leads, así que no hay recomendación ni
            borrador. Puedes escribirle igual.
          </p>
        </div>
      ) : !conversacion.presupuestoId && !conversacion.leadId ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            Sin contexto: no sabemos quién es
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
            No está asociada a ningún paciente ni lead, así que no hay caso del que decir qué pasa
            — ni vía por la que responder. Créale una ficha y vuelve.
          </p>
        </div>
      ) : null}

      {/* ─── 3 · Con quién hablas ─────────────────────────────────────── */}
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
        // Si es un lead, el recuadro de arriba ya lo dice: repetirlo aquí eran
        // dos avisos casi idénticos en la misma columna. Solo queda la línea
        // que añade algo — qué aparecerá cuando tenga ficha.
        conversacion.leadId ? (
          <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
            Cuando se convierta en paciente, aquí saldrán sus presupuestos y sus pagos.
          </p>
        ) : null
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
          {/* ─── El orden es el de lo que cambia una decisión ───────────
              Antes esto abría con «Pendiente de cobro 0 €» y «Cobrado 0 €»,
              que en la mayoría de conversaciones son dos ceros ocupando el
              sitio principal para no decir nada, y dejaban medio panel vacío
              debajo. Ahora arriba va el CASO —lo que se está hablando— y el
              dinero solo aparece cuando hay dinero. */}
          {ultimo && (
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Último presupuesto
              </p>
              <p className="mt-1 truncate text-[13px] font-semibold text-[var(--color-foreground)]">
                {ultimo.tratamiento ?? "Sin tratamiento"}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                {ultimo.estado ?? "—"}
                {ultimo.importe != null ? ` · ${eur(ultimo.importe)}` : ""}
              </p>
            </div>
          )}

          {ficha.proximaCita?.fecha && (
            <Dato etiqueta="Próxima cita" valor={fechaClinica(ficha.proximaCita.fecha)} />
          )}

          {/* Los ceros, abajo y solo si NO son cero. Un «0 €» no informa de
              nada y ocupa lo mismo que un dato. */}
          {(ficha.kpisPagos?.pendiente ?? 0) > 0 && (
            <Dato etiqueta="Pendiente de cobro" valor={eur(ficha.kpisPagos!.pendiente!)} />
          )}
          {(ficha.kpisPagos?.totalFacturado ?? 0) > 0 && (
            <Dato etiqueta="Cobrado" valor={eur(ficha.kpisPagos!.totalFacturado!)} />
          )}

          {/* El historial: los casos anteriores de esta persona. Es donde va lo
              que la regla del «caso vivo» deja fuera del panel de acción —
              existe, se ve, pero no compite con lo que se está hablando. */}
          {anteriores.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Antes ({anteriores.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {anteriores.slice(0, 4).map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5"
                  >
                    <p className="truncate text-[12.5px] text-[var(--color-muted)]">
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
          )}

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
