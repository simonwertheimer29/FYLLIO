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

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../ui/Feedback";
import { fechaClinica } from "../../lib/time";
import { AlertTriangle, Clock, PauseCircle, UserCheck, CheckCircle2 } from "../icons";
import { eur as eurUI } from "../shared/Cifra";
import type { FichaCaso } from "../../lib/agente/ficha-caso";
import type { CausaDerivacion } from "../../lib/automatizacion/estado";

const ETIQUETA_OTRO: Record<string, string> = {
  cobro: "un pago pendiente",
  presupuesto: "un presupuesto por decidir",
  cita: "una cita por cerrar",
  identificar: "identificar a la persona",
};

// ── El asunto derivado, en lenguaje de coordinadora (fase C) ──────────────
// Hasta hoy la ficha solo enseñaba la causa cuando era una queja: nadie
// sabía POR QUÉ le llegó un caso. El título dice la causa; la frase del
// paciente, cuando existe, dice el resto.
const TITULO_DERIVADO: Record<CausaDerivacion, string> = {
  peticion_queja: "Pidió hablar con una persona",
  urgencia: "Urgencia — no puede esperar",
  antecedente_medico: "Mencionó una medicación o condición médica",
  caso_completo: "El agente terminó su parte — queda cerrarlo",
  insistencia: "Insistió varias veces — el agente no le resuelve",
};
/** Rojo para lo que exige atención inmediata (el mismo criterio que la cola
 *  prioritaria de la derivación); el resto informa sin alarmar. */
const CAUSA_PRIORITARIA: ReadonlySet<CausaDerivacion> = new Set([
  "peticion_queja",
  "urgencia",
  "antecedente_medico",
]);

export function FichaCasoPanel({
  telefono,
  modo,
  onCambio,
}: {
  telefono: string;
  /** «mensajeria»: la conversación está al lado — sin enlace al hilo.
   *  «seguimiento»: el hilo se enlaza, cerrado por defecto. */
  modo: "mensajeria" | "seguimiento";
  /** Tras una decisión del semáforo (resolver, soltar, levantar espera): la
   *  ficha ya se recarga sola, pero la cola/bandeja del caller también
   *  cambió — este callback es su aviso. */
  onCambio?: () => void;
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

  // Tras una decisión: la ficha se recarga (el estado que enseñaba cambió) y
  // se avisa al caller — la cola de Seguimiento o la bandeja también cambiaron.
  const alCambiar = useCallback(() => {
    void cargar();
    onCambio?.();
  }, [cargar, onCambio]);

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
      {/* ── 0 · ANTES DE TODO: el asunto derivado (21-08 la queja; fase C,
          todas las causas). Un tag y un pendiente en una lista no bastan —
          si la coordinadora no sabe por qué le llegó el caso, le escribe
          «como si nada» a alguien enfadado o cierra sin cerrar lo que el
          agente entregó. Arriba, con la frase del paciente, y el botón que
          lo cierra: «Marcar resuelto» es UNO para todas las causas (026) —
          la causa ya está en el log. */}
      {ficha.semaforo.motivo === "derivado_sin_resolver" && (
        <div
          className={`flex gap-2 rounded-xl border px-3 py-2.5 ${
            !ficha.semaforo.causa || CAUSA_PRIORITARIA.has(ficha.semaforo.causa)
              ? "border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10"
              : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
          }`}
        >
          {!ficha.semaforo.causa || CAUSA_PRIORITARIA.has(ficha.semaforo.causa) ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" aria-hidden />
          ) : (
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug text-[var(--color-foreground)]">
              <span className="font-semibold">
                {ficha.semaforo.causa
                  ? TITULO_DERIVADO[ficha.semaforo.causa]
                  : "Derivado al equipo"}
                {ficha.semaforo.desde ? ` — ${fechaClinica(ficha.semaforo.desde)}` : ""}.
              </span>
              {ficha.semaforo.causa === "caso_completo" && ficha.semaforo.objetivo
                ? ` Queda ${ETIQUETA_OTRO[ficha.semaforo.objetivo] ?? ficha.semaforo.objetivo}.`
                : ""}
              {ficha.semaforo.frase ? ` Sus palabras: ${ficha.semaforo.frase}` : ""}
              {ficha.semaforo.causa === "peticion_queja" ? " Resuélvelo antes de cerrar nada." : ""}
            </p>
            <BotonSemaforo
              telefono={ficha.telefono}
              evento="resuelto_manual"
              etiqueta="Marcar resuelto"
              hecho="Asunto marcado como resuelto"
              onHecho={alCambiar}
            />
          </div>
        </div>
      )}
      {/* ── La espera (qué NO hacer) y lo intentado ── */}
      {ficha.espera && (
        <div className="flex gap-2 rounded-xl bg-[var(--color-warning-soft)] px-3 py-2.5">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug text-[var(--color-foreground)]">
              <span className="font-semibold">No escribir hasta el {fechaClinica(ficha.espera.hasta)}</span>
              {" — pidió tiempo"}
              {ficha.espera.frase ? `: ${ficha.espera.frase}` : "."}
            </p>
            <BotonSemaforo
              telefono={ficha.telefono}
              evento="espera_levantada"
              etiqueta="Levantar la espera"
              hecho="Espera levantada — se puede volver a escribir"
              onHecho={alCambiar}
            />
          </div>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {ficha.intentos.salientes === 0
          ? "Aún no se le ha escrito."
          : `${ficha.intentos.salientes} ${ficha.intentos.salientes === 1 ? "mensaje enviado" : "mensajes enviados"} · último el ${fechaClinica(ficha.intentos.ultimo!)}`}
      </p>
      {ficha.semaforo.motivo === "hilo_asumido" && (
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-foreground)]">
            <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
            Lo lleva una persona.
          </p>
          <BotonSemaforo
            telefono={ficha.telefono}
            evento="soltado"
            etiqueta="Soltar el hilo"
            hecho="Hilo soltado — deja de estar en manos de nadie"
            onHecho={alCambiar}
            sinMargen
          />
        </div>
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
              {ficha.presupuestos.fuente === "sin_senal" ? (
                <>
                  {/* 21-08: sin señal de la conversación NO se elige — decir
                      «se habla de X» cuando no se habla de ninguno era mentir
                      con aviso en letra pequeña. */}
                  <p className="text-[12px] font-semibold text-[var(--color-foreground)]">
                    {1 + ficha.presupuestos.otros.length} presupuestos vivos — la conversación no señala cuál.
                  </p>
                  {[ficha.presupuestos.activo, ...ficha.presupuestos.otros].map((o) => (
                    <p key={o.id} className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                      · {o.tratamiento ?? "tratamiento"}
                      {o.importe != null ? ` (${eurUI(o.importe)})` : ""}
                    </p>
                  ))}
                </>
              ) : (
                <>
                  <p className="text-[12px] text-[var(--color-foreground)]">
                    Se habla del presupuesto de{" "}
                    <span className="font-semibold">
                      {ficha.presupuestos.activo.tratamiento ?? "tratamiento"}
                      {ficha.presupuestos.activo.importe != null ? ` (${eurUI(ficha.presupuestos.activo.importe)})` : ""}
                    </span>
                    {ficha.presupuestos.fuente === "proxy" && (
                      <span className="text-[var(--color-muted)]"> — elegido por la señal más reciente; compruébalo en el hilo</span>
                    )}
                  </p>
                  {ficha.presupuestos.otros.map((o) => (
                    <p key={o.id} className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                      También vivo: {o.tratamiento ?? "tratamiento"}
                      {o.importe != null ? ` (${eurUI(o.importe)})` : ""}
                    </p>
                  ))}
                </>
              )}
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

/** Un botón de decisión del semáforo (fase C): resuelto · soltar · levantar
 *  espera. Confirmación en dos clics —el log es append-only y un resuelto
 *  por error cierra un asunto de verdad—, sin `confirm()` nativo (estándar)
 *  y sin inventar un modal nuevo para tres botones. El segundo clic dispara;
 *  si no llega en unos segundos, el botón vuelve a su texto. */
function BotonSemaforo({
  telefono,
  evento,
  etiqueta,
  hecho,
  onHecho,
  sinMargen = false,
}: {
  telefono: string;
  evento: "resuelto_manual" | "soltado" | "espera_levantada";
  etiqueta: string;
  /** El toast de éxito: dice qué pasó, no «hecho». */
  hecho: string;
  onHecho: () => void;
  sinMargen?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  async function pulsar() {
    if (enviando) return;
    if (!confirmando) {
      setConfirmando(true);
      timeoutRef.current = setTimeout(() => setConfirmando(false), 5000);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setEnviando(true);
    try {
      await cargarJSON("/api/automatizacion/decidir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipoCaso: "conversacion", casoId: telefono, evento }),
      });
      toast.success(hecho);
      onHecho();
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={pulsar}
      disabled={enviando}
      className={`${sinMargen ? "" : "mt-2 "}inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
        confirmando
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {enviando ? "Guardando…" : confirmando ? `¿Seguro? ${etiqueta}` : etiqueta}
    </button>
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
