"use client";

// La tercera columna: quién es, qué pasa, y si puedes contestar o no.
//
// ─── LA REGLA DE ESTA PANTALLA ─────────────────────────────────────────────
//
// **El centro es SOLO el hilo y la caja de escribir. Todo contexto,
// recomendación y aviso vive AQUÍ, sin excepciones** (2026-08-11).
//
// Y el orden es fijo (2026-08-12): **contacto arriba** — saber con quién
// hablas va antes que saber qué le pasa —, después UN solo bloque de
// contexto, y debajo la ficha. El aviso de criterio no es un recuadro
// aparte: es una línea de alarma DENTRO del bloque de contexto. Dos
// recuadros que decían casi lo mismo ocupaban el doble de espacio, y un
// aviso enterrado bajo datos de ficha no es un aviso.
//
// La ficha se pinta desde el MISMO endpoint que la página de paciente
// (`/api/pacientes/[id]`): cero consultas nuevas y cero cifras nuevas — si un
// número no cuadrara con la ficha grande, habría un cálculo paralelo.
//
// El caso llega por props: lo pide la pantalla UNA vez y lo comparten esta
// columna y el compositor. Dos peticiones serían dos verdades.

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
import { AlertTriangle } from "../../components/icons";

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

  const situacion = caso ? situacionPresupuesto(caso.item) : null;

  // El hilo está justo al lado: repetir aquí la frase del paciente sería
  // decirla dos veces en la misma pantalla. Se dice el hecho, no la cita.
  const quePasa =
    situacion &&
    (situacion.quePasa.startsWith("Respondió: «")
      ? "Su último mensaje espera respuesta."
      : situacion.quePasa);

  // El caso vivo manda; los cerrados son historial (regla del 2026-08-11).
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
    <div className="space-y-5 p-4">
      {/* ─── 1 · Quién es ─────────────────────────────────────────────── */}
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

      {/* ─── 2 · Qué pasa — UN solo bloque, con la alarma dentro ──────── */}
      {situacion && caso ? (
        <div className="space-y-2.5 rounded-xl border border-[var(--color-border)] p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Qué pasa
          </p>
          {quebrado(caso.item) && (
            <div className="flex gap-2 rounded-lg bg-[var(--color-danger-soft)] px-2.5 py-2">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]"
                aria-hidden
              />
              <p className="min-w-0 text-[12px] leading-snug text-[var(--color-foreground)]">
                <span className="font-semibold">Necesita tu criterio</span>
                {caso.item.automatizacion?.motivo
                  ? ` — ${caso.item.automatizacion.motivo}`
                  : ""}
                <span className="text-[var(--color-muted)]"> · Sin borrador a propósito.</span>
              </p>
            </div>
          )}
          <p className="text-[12.5px] leading-relaxed text-[var(--color-foreground)]">{quePasa}</p>
          <p className="text-[13px] font-semibold leading-snug text-[var(--color-accent)]">
            {situacion.recomendacion}
          </p>
          {/* Sin chip de intención a propósito: «Logística» y compañía son
              vocabulario interno del clasificador (§5 del estándar), y puesto
              junto a la recomendación parecía su categoría. */}
        </div>
      ) : cargandoCaso ? (
        <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
      ) : errorCaso ? (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3.5 py-3">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            No se pudo cargar el caso
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            {errorCaso} Sin él no hay recomendación — el hilo y el envío siguen funcionando.
          </p>
          <button
            type="button"
            onClick={recargarCaso}
            className="mt-2 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : !conversacion.presupuestoId && conversacion.leadId ? (
        <div className="rounded-xl border border-[var(--color-border)] p-3.5">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            Es un lead, no un presupuesto
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            El agente todavía no analiza conversaciones de leads: sin recomendación ni borrador.
            Puedes escribirle igual.
          </p>
        </div>
      ) : !conversacion.presupuestoId && !conversacion.leadId ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3.5">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            Sin contexto: no sabemos quién es
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            No está asociada a ningún paciente ni lead — no hay caso del que decir qué pasa, ni
            vía por la que responder. Créale una ficha y vuelve.
          </p>
        </div>
      ) : null}

      {/* ─── 3 · La ficha ─────────────────────────────────────────────── */}
      {!pacienteId ? (
        conversacion.leadId ? (
          <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
            Cuando se convierta en paciente, aquí saldrán sus presupuestos y sus pagos.
          </p>
        ) : null
      ) : error ? (
        <ErrorState detail={`La ficha no se pudo cargar. ${error}`} onRetry={cargar} />
      ) : cargando && !ficha ? (
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      ) : ficha ? (
        <div className="space-y-3">
          {ultimo && (
            <div className="rounded-xl border border-[var(--color-border)] p-3.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Último presupuesto
              </p>
              <p className="mt-1.5 truncate text-[13px] font-semibold text-[var(--color-foreground)]">
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
          {/* Los ceros no informan: solo aparecen cuando hay dinero. */}
          {(ficha.kpisPagos?.pendiente ?? 0) > 0 && (
            <Dato etiqueta="Pendiente de cobro" valor={eur(ficha.kpisPagos!.pendiente!)} />
          )}
          {(ficha.kpisPagos?.totalFacturado ?? 0) > 0 && (
            <Dato etiqueta="Cobrado" valor={eur(ficha.kpisPagos!.totalFacturado!)} />
          )}

          {anteriores.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Antes ({anteriores.length})
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {anteriores.slice(0, 4).map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-2"
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
        </div>
      ) : null}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-0.5">
      <span className="text-[12px] text-[var(--color-muted)]">{etiqueta}</span>
      <span className="text-[13px] font-semibold tabular-nums text-[var(--color-foreground)]">
        {valor}
      </span>
    </div>
  );
}
