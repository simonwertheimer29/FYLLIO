"use client";

// LA FICHA DEL CASO — el componente ÚNICO (fase B, B2). Seguimiento la
// despliega y Mensajería la monta en su columna derecha: mismo contenido,
// mismo orden, porque es el mismo componente sobre el mismo endpoint. Dos
// versiones se desincronizan y la coordinadora acaba viendo cosas distintas
// del mismo caso.
//
// EL ORDEN ES EL DICTADO y no se reordena: (0) la espera —lo único que dice
// qué NO hacer— y qué se ha intentado ya; (1) qué quiere; (2) qué falta
// resolver; (3) qué recogió; (4) la conversación, accesible y no desplegada.
//
// REGLA DE DISEÑO (dictada): la ficha es corta. Si algo no cambia lo que la
// coordinadora hará en el próximo minuto, NO entra — los «y ya que estamos»
// se rechazan aquí, no se acumulan.
//
// HONESTIDAD: sin evaluación del agente, la ficha lo dice con todas las
// letras — ni blanco ni resumen fingido (§4 del estándar + caso a).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../ui/Feedback";
import { fechaClinica } from "../../lib/time";
import { Clock, PauseCircle, UserCheck, CheckCircle2 } from "../icons";
import { eur as eurUI } from "../shared/Cifra";
import type { FichaCaso } from "../../lib/agente/ficha-caso";

const ETIQUETA_OTRO: Record<string, string> = {
  cobro: "un pago pendiente",
  presupuesto: "un presupuesto por decidir",
  cita: "una cita por cerrar",
  identificar: "identificar a la persona",
};

export function FichaCasoPanel({
  telefono,
  modo,
}: {
  telefono: string;
  /** «mensajeria»: la conversación está al lado — sin enlace al hilo.
   *  «seguimiento»: el hilo se enlaza, cerrado por defecto. */
  modo: "mensajeria" | "seguimiento";
}) {
  const [ficha, setFicha] = useState<FichaCaso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const d = await cargarJSON<FichaCaso>(
        `/api/agente/ficha?telefono=${encodeURIComponent(telefono)}`,
      );
      setFicha(d);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [telefono]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) {
    return <ErrorState detail={`La ficha del caso no se pudo cargar. ${error}`} onRetry={cargar} />;
  }
  if (cargando && !ficha) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    );
  }
  if (!ficha) return null;

  return (
    <div className="space-y-3">
      {/* ── 0 · ANTES DE NADA: la espera (qué NO hacer) y lo intentado ── */}
      {ficha.espera && (
        <div className="flex gap-2 rounded-xl bg-[var(--color-warning-soft)] px-3 py-2.5">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <p className="min-w-0 text-[12.5px] leading-snug text-[var(--color-foreground)]">
            <span className="font-semibold">No escribir hasta el {fechaClinica(ficha.espera.hasta)}</span>
            {" — pidió tiempo"}
            {ficha.espera.frase ? `: ${ficha.espera.frase}` : "."}
          </p>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {ficha.intentos.salientes === 0
          ? "Aún no se le ha escrito."
          : `${ficha.intentos.salientes} ${ficha.intentos.salientes === 1 ? "mensaje enviado" : "mensajes enviados"} · último el ${fechaClinica(ficha.intentos.ultimo!)}`}
      </p>
      {ficha.semaforo.motivo === "hilo_asumido" && (
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-foreground)]">
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
          Lo lleva una persona.
        </p>
      )}
      {ficha.cierrePorPaciente && (
        <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-foreground)]">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-hidden />
          {ficha.cierrePorPaciente.accion === "aceptado"
            ? "Aceptó su presupuesto desde el portal"
            : "Rechazó su presupuesto desde el portal"}
          {" · "}
          {fechaClinica(ficha.cierrePorPaciente.fecha)}
        </p>
      )}

      {/* ── 1 · Qué quiere ── */}
      {ficha.evaluado ? (
        <div className="rounded-xl border border-[var(--color-border)] p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Qué quiere
          </p>
          <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-[var(--color-foreground)]">
            {ficha.queQuiere ?? "Sin objetivo abierto — solo conversación."}
          </p>
          {ficha.otrosObjetivos.length > 0 && (
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">
              Además: {ficha.otrosObjetivos.map((o) => ETIQUETA_OTRO[o] ?? o).join(" · ")}
            </p>
          )}
          {/* 21-08: con varios presupuestos vivos, se DECLARA de cuál se
              habla y de dónde salió la elección — un activo en silencio es
              peor que dos cards. Los demás, nombrados. */}
          {ficha.presupuestos && ficha.presupuestos.otros.length > 0 && (
            <div className="mt-2 border-t border-[var(--color-border)] pt-2">
              <p className="text-[12px] text-[var(--color-foreground)]">
                Se habla del presupuesto de{" "}
                <span className="font-semibold">
                  {ficha.presupuestos.activo.tratamiento ?? "tratamiento"}
                  {ficha.presupuestos.activo.importe != null ? ` (${eurUI(ficha.presupuestos.activo.importe)})` : ""}
                </span>
                {ficha.presupuestos.fuente === "proxy" && (
                  <span className="text-[var(--color-muted)]"> — elegido por ser el más señalado o reciente; compruébalo en el hilo</span>
                )}
              </p>
              {ficha.presupuestos.otros.map((o) => (
                <p key={o.id} className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                  También vivo: {o.tratamiento ?? "tratamiento"}
                  {o.importe != null ? ` (${eurUI(o.importe)})` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3.5">
          <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
            El agente no ha evaluado esta conversación
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            No hay nada recogido: lo que sepas, tendrás que leerlo del hilo.
          </p>
        </div>
      )}

      {/* ── 2 · Qué falta resolver (vacío = nada, sin relleno) ── */}
      {ficha.pendientes.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Qué falta resolver
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {ficha.pendientes.map((p, i) => (
              <li key={`${p.clave}-${i}`} className="text-[12.5px] leading-snug text-[var(--color-foreground)]">
                <span className="tabular-nums text-[var(--color-muted)]">{i + 1}.</span>{" "}
                <span className="font-medium">{p.etiqueta}</span>
                <span className="text-[var(--color-muted)]"> — «{p.frase}»</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── 3 · Qué recogió el agente ── */}
      {ficha.recogido && ficha.recogido.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Qué recogió el agente
          </p>
          <dl className="mt-1.5 space-y-1">
            {ficha.recogido.map((c) => (
              <div key={c.campo} className="flex items-baseline justify-between gap-2">
                <dt className="text-[12px] text-[var(--color-muted)]">{legibleCampo(c.campo)}</dt>
                <dd className="text-right text-[12.5px] font-medium text-[var(--color-foreground)]">
                  {c.valor == null ? (
                    <span className="font-normal text-[var(--color-muted)]">sin recoger</span>
                  ) : c.valor === "no_aplica" ? (
                    <span className="font-normal text-[var(--color-muted)]">—</span>
                  ) : (
                    c.valor
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* ── 4 · La conversación: accesible, no desplegada ── */}
      {modo === "seguimiento" && (
        <Link
          href={`/mensajeria?telefono=${encodeURIComponent(ficha.telefono)}`}
          className="block rounded-lg border border-[var(--color-border)] px-3 py-2 text-center text-[13px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
        >
          Ver la conversación
        </Link>
      )}
    </div>
  );
}

/** Claves internas → lenguaje de coordinadora (§5 del estándar: nada de
 *  enums crudos en pantalla). */
function legibleCampo(clave: string): string {
  const MAPA: Record<string, string> = {
    nombre_completo: "Nombre completo",
    tratamiento_o_molestia: "Qué necesita",
    urgencia: "Urgencia",
    disponibilidad: "Disponibilidad",
    preferencia_doctor: "Doctor preferido",
    clinica_preferida: "Clínica",
    decision: "Decisión",
    como_pagar: "Cómo pagará",
    disponibilidad_primera_cita: "Primera cita",
    que_le_frena: "Qué le frena",
    cuando_retomar: "Cuándo retomar",
    motivo_rechazo: "Motivo del rechazo",
    confirma_pago: "Confirma el pago",
    via_pago: "Vía de pago",
    fecha_pago: "Fecha de pago",
    nombre: "Nombre",
    es_paciente: "¿Ya es paciente?",
    que_necesita: "Qué necesita",
  };
  return MAPA[clave] ?? clave.replace(/_/g, " ");
}
