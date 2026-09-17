"use client";

// LA FICHA DEL CASO — el componente ÚNICO (fase B, B2). Seguimiento la
// despliega y Mensajería la monta en su columna derecha: mismo contenido,
// mismo orden, porque es el mismo componente sobre el mismo endpoint. Dos
// versiones se desincronizan y la coordinadora acaba viendo cosas distintas
// del mismo caso.
//
// CUATRO BLOQUES (16-09, MEJORAS 253 — antes eran siete que decían tres
// veces lo mismo): (1) el ESTADO como etiqueta, debajo del contacto; luego
// lo que dice qué NO hacer (espera, opt-out, quien escribe no es la titular);
// (2) la DESCRIPCIÓN en dos o tres frases compuestas por código, con lo
// pendiente dentro; (3) los datos recogidos, SOLO los que tienen valor;
// (4) la acción principal. «Marcar resuelto» y la salida al hilo, pequeños
// y al final.
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
import { fechaClinica, hoyISO } from "../../lib/time";
import { AlertTriangle, CalendarDays, PauseCircle, UserCheck, Ban, ICON_STROKE } from "../icons";
import type { ClaveAplazado } from "../../lib/automatizacion/aplazamientos";
import { AgendarPanel } from "../agenda/AgendarPanel";
import { HuecosDelCasoPanel, ConfirmarCitaPendiente } from "./HuecosDelCasoPanel";
import { OfertaPanel } from "./OfertaPanel";
import { fechaCorta } from "../../lib/agenda/fechas";
import type { FichaCaso } from "../../lib/agente/ficha-caso";

const ETIQUETA_OTRO: Record<string, string> = {
  cobro: "un pago pendiente",
  presupuesto: "un presupuesto por decidir",
  cita: "una cita por cerrar",
  mover_cita: "mover su cita",
  identificar: "identificar a la persona",
};

// La causa de la entrega, en lenguaje de coordinadora, vive desde el 16-09 en
// `etiquetaEstadoDe` (ficha-caso.ts): es el ESTADO del caso (bloque 1), y el
// mismo dato alimenta la marca de la bandeja. Aquí solo se pinta.

export function FichaCasoPanel({
  telefono,
  modo,
  onCambio,
  ficha: fichaExterna,
  onRecargar,
}: {
  telefono: string;
  /** «mensajeria»: la conversación está al lado — sin enlace al hilo.
   *  «seguimiento»: el hilo se enlaza, cerrado por defecto. */
  modo: "mensajeria" | "seguimiento";
  /** Tras una decisión del semáforo (resolver, soltar, levantar espera): la
   *  ficha ya se recarga sola, pero la cola/bandeja del caller también
   *  cambió — este callback es su aviso. */
  onCambio?: () => void;
  /** MEJORAS 119 — si la pantalla YA tiene la ficha (Mensajería la pide una
   *  vez y la reparte entre el composer y esta columna), se pasa aquí y el
   *  panel no la vuelve a pedir; recargar es `onRecargar`. */
  ficha?: FichaCaso | null;
  onRecargar?: () => void;
}) {
  const externa = fichaExterna !== undefined;
  const [fichaPropia, setFichaPropia] = useState<FichaCaso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // G3 — el panel de agendar, montado desde la ficha misma.
  const [agendando, setAgendando] = useState(false);

  const cargar = useCallback(async () => {
    if (externa) {
      onRecargar?.();
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const d = await cargarJSON<FichaCaso>(
        `/api/agente/ficha?telefono=${encodeURIComponent(telefono)}`,
      );
      setFichaPropia(d);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [telefono, externa, onRecargar]);

  useEffect(() => {
    if (!externa) cargar();
  }, [cargar, externa]);

  const ficha = externa ? fichaExterna : fichaPropia;

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
      {/* ── 1 · EL ESTADO, como etiqueta (16-09, MEJORAS 253). Debajo del
          contacto en Mensajería; la primera línea en Seguimiento. Sale del
          semáforo, de la causa de entrega y del objetivo — lo mismo que la
          marca de la bandeja. La edad del derivado va al lado: nada caduca
          solo, pero envejece a la vista (MEJORAS 125). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <MarcaEstado tono={ficha.estado.tono}>{ficha.estado.texto}</MarcaEstado>
        {ficha.semaforo.motivo === "derivado_sin_resolver" && ficha.semaforo.desde && (
          <span className="text-[11px] text-[var(--color-muted)]">
            desde el {fechaClinica(ficha.semaforo.desde)}{edadLegible(ficha.semaforo.desde)}
          </span>
        )}
      </div>
      {/* ── La espera (qué NO hacer) ── */}
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
              etiqueta="Reanudar el contacto"
              hecho="Contacto reanudado — se puede volver a escribir"
              onHecho={alCambiar}
            />
          </div>
        </div>
      )}
      {/* ── 11-09 · quien escribe no es la titular del número («soy la hija
          de Carmen»): se declara arriba, con su nombre, para que la entrega
          se lea como lo que es — un contacto nuevo sin ficha — y nadie le
          conteste con los datos de la madre. */}
      {ficha.hablaPor && (
        <div className="flex gap-2 rounded-xl bg-[var(--color-warning-soft)] px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--color-foreground)]">
            <span className="font-semibold">
              {`Escribe ${ficha.hablaPor.nombre ?? "otra persona"}${ficha.hablaPor.relacion ? `, ${ficha.hablaPor.relacion}` : ""}`}
            </span>
            {` — desde el número de ${ficha.nombre}, sin ficha propia. `}
            Las citas, presupuestos y pagos de esta ficha son de la titular, no suyos.
          </p>
        </div>
      )}
      {/* ── MEJORAS 139 · el número lo comparten varias personas: se declara
          y NADA de lo de abajo habla de un expediente concreto. */}
      {ficha.identidadAmbigua && (
        <div className="flex gap-2 rounded-xl bg-[var(--color-warning-soft)] px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--color-foreground)]">
            <span className="font-semibold">Este número lo usan varias personas</span>
            {`: ${ficha.identidadAmbigua.nombres.join(", ")}. `}
            Hasta saber quién escribe, ni el agente ni esta ficha afirman presupuestos, pagos ni citas de ninguna.
          </p>
        </div>
      )}
      {/* ── Hilo jugado (10-09): una línea, no una alarma. Dice de dónde sale
          la conversación para que nadie lea a un paciente simulado como real,
          y señala dónde está la prueba de que el agente decidió de verdad. */}
      {ficha.jugada && (
        <p className="text-[11.5px] leading-snug text-[var(--color-muted)]">
          Conversación simulada: el paciente es simulado y las respuestas son del agente real. Cada decisión queda registrada en «ver por qué».
        </p>
      )}
      {/* ── MEJORAS 135 · pidió no recibir mensajes: lo único que cambia lo
          que la coordinadora hará ahora mismo (no escribirle si no escribe
          él). Revertir es de una persona y queda en el log con su nombre. */}
      {ficha.optOut.activo && (
        <div className="flex gap-2 rounded-xl bg-[var(--color-warning-soft)] px-3 py-2.5">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug text-[var(--color-foreground)]">
              <span className="font-semibold">Pidió no recibir mensajes</span>
              {ficha.optOut.desde ? ` — ${fechaClinica(ficha.optOut.desde)}` : ""}
              {ficha.optOut.frase ? `: ${ficha.optOut.frase}` : "."}
              {" Solo se le contesta si escribe él; ningún envío automático."}
            </p>
            <BotonSemaforo
              telefono={ficha.telefono}
              evento="opt_in"
              etiqueta="Revertir (lo ha pedido él)"
              hecho="Opt-out revertido — vuelve a recibir mensajes"
              onHecho={alCambiar}
            />
          </div>
        </div>
      )}
      {ficha.semaforo.motivo === "hilo_asumido" && (
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-foreground)]">
            <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
            Lo lleva una persona.
          </p>
          <BotonSemaforo
            telefono={ficha.telefono}
            evento="soltado"
            etiqueta="Devolver la conversación al agente"
            hecho="Conversación devuelta — deja de estar en manos de nadie"
            onHecho={alCambiar}
            sinMargen
          />
        </div>
      )}
      {/* ── 2 · LA DESCRIPCIÓN: en qué anda esta persona y qué ha pasado, en
          dos o tres frases compuestas por CÓDIGO (ficha-caso.ts). Lo que
          preguntó sin respuesta va DENTRO, como una frase más, con su botón
          de «Respondido» (MEJORAS 121: resolver una clave resuelve todas sus
          frases; una vez por clave). Sin evaluación, se dice. */}
      {ficha.evaluado ? (
        <div className="rounded-xl border border-[var(--color-border)] p-3.5">
          {ficha.descripcion.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-[var(--color-foreground)]">
              Solo conversación — no hay nada que recoger.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--color-foreground)]">
              {ficha.descripcion.map((f, i) => (
                <span key={i}>
                  {i > 0 ? " " : ""}
                  {f.texto}
                  {f.pendiente && (
                    <>
                      {" "}
                      <BotonSemaforo
                        telefono={ficha.telefono}
                        evento="aplazado_resuelto"
                        claveAplazado={f.pendiente}
                        etiqueta="Respondido"
                        hecho="Marcado como respondido"
                        onHecho={alCambiar}
                        sinMargen
                        compacto
                      />
                    </>
                  )}
                </span>
              ))}
            </p>
          )}
          {/* MEJORAS 119/128: si el ÚLTIMO mensaje no tiene evaluación, lo de
              arriba es del anterior — se dice, no se enseña como actual. */}
          {!ficha.agente.alDia && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-[var(--color-warning)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              El último mensaje de la persona no tiene evaluación del agente: esto es de un mensaje anterior.
            </p>
          )}
          {ficha.otrosObjetivos.length > 0 && (
            <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">
              Además: {ficha.otrosObjetivos.map((o) => ETIQUETA_OTRO[o] ?? o).join(" · ")}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-3.5">
          <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
            El agente no ha evaluado esta conversación
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            No hay datos anotados: lo que sepas, tendrás que leerlo de la conversación.
          </p>
        </div>
      )}

      {/* ── 3 · Datos que tiene el agente — SOLO los que tienen valor. Las
          filas con «—» o «sin recoger» no se pintan (16-09): una fila vacía
          no cambia lo que la coordinadora hará y le quita fuerza a la llena. */}
      {(() => {
        const conValor = (ficha.recogido ?? []).filter((c) => c.valor != null && c.valor !== "no_aplica" && c.valor.trim() !== "");
        return conValor.length > 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Datos que tiene el agente
            </p>
            <dl className="mt-1.5 space-y-1">
              {conValor.map((c) => (
                <div key={c.campo} className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-[var(--color-muted)]">{legibleCampo(c.campo)}</dt>
                  <dd className="text-right text-[12.5px] font-medium text-[var(--color-foreground)]">{c.valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null;
      })()}

      {/* ── 4 · LA ACCIÓN (paso 3, 17-09): el botón que ya sabe qué hacer.
          Sin cita: tres huecos del servidor que cumplen lo que recogió el
          agente, con su garantía y el mensaje entero antes de pulsar
          (HuecosDelCasoPanel). Con cita: moverla abre la agenda (G3). Solo
          con lead activo: la cita del caso es la cita del lead (un paciente
          convertido se agenda desde la agenda). Mover no es crear. */}
      {/* 060 (17-09): con la agenda en Fyllio se PROPONEN horas y el paciente
          elige (OfertaPanel: nada reservado hasta que acepta). Con copia o sin
          agenda no se pueden proponer horas como reales: se ANOTA la cita
          (HuecosDelCasoPanel) y se confirma en el software de la clínica. */}
      {ficha.lead && !ficha.lead.fechaCita && ficha.agendaEnFyllio && (
        <OfertaPanel telefono={ficha.telefono} oferta={ficha.oferta} onHecho={alCambiar} />
      )}
      {ficha.lead && !ficha.lead.fechaCita && !ficha.agendaEnFyllio && (
        <HuecosDelCasoPanel telefono={ficha.telefono} onHecho={alCambiar} onVerAgenda={() => setAgendando(true)} />
      )}
      {ficha.lead && ficha.lead.fechaCita && ficha.cita?.fuente === "lead" && !ficha.cita.confirmadaEn && ficha.agendaEnFyllio && (
        <ConfirmarCitaPendiente telefono={ficha.telefono} leadId={ficha.lead.id} onHecho={alCambiar} />
      )}
      {ficha.lead && ficha.lead.fechaCita && (
        <button
          type="button"
          onClick={() => setAgendando(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <CalendarDays size={14} strokeWidth={ICON_STROKE} aria-hidden />
          {`Mover su cita del ${fechaCorta(ficha.lead.fechaCita)}${ficha.lead.horaCita ? ` (${ficha.lead.horaCita})` : ""}`}
        </button>
      )}
      {agendando && ficha.lead && (
        <AgendarPanel
          sujeto={{ tipo: "lead", lead: ficha.lead }}
          onClose={() => setAgendando(false)}
          onHecho={alCambiar}
        />
      )}

      {/* ── Secundario, pequeño: cerrar lo entregado y salir al hilo.
          «Marcar resuelto» es UNO para todas las causas (026) — la causa ya
          está en el log. */}
      {(ficha.semaforo.motivo === "derivado_sin_resolver" || modo === "seguimiento") && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {ficha.semaforo.motivo === "derivado_sin_resolver" ? (
            <BotonSemaforo
              telefono={ficha.telefono}
              evento="resuelto_manual"
              etiqueta="Marcar resuelto"
              hecho="Asunto marcado como resuelto"
              onHecho={alCambiar}
              sinMargen
            />
          ) : (
            <span />
          )}
          {modo === "seguimiento" && (
            <Link
              href={`/mensajeria?telefono=${encodeURIComponent(ficha.telefono)}`}
              className="text-[12.5px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              Ver la conversación
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** La etiqueta de estado del caso (bloque 1) — el mismo aspecto que la marca
 *  de la bandeja, para que el estado se lea igual en la lista y en la ficha. */
function MarcaEstado({ tono, children }: { tono: "danger" | "accent" | "warning" | "neutro"; children: React.ReactNode }) {
  const cls =
    tono === "danger"
      ? "border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : tono === "accent"
        ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        : tono === "warning"
          ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {tono === "danger" && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
      {tono === "accent" && <UserCheck className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
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
  compacto = false,
  claveAplazado,
}: {
  telefono: string;
  evento: "resuelto_manual" | "soltado" | "espera_levantada" | "aplazado_resuelto" | "opt_in";
  /** Solo con `aplazado_resuelto`: qué clave se resuelve (MEJORAS 121). */
  claveAplazado?: ClaveAplazado;
  etiqueta: string;
  /** El toast de éxito: dice qué pasó, no «hecho». */
  hecho: string;
  onHecho: () => void;
  sinMargen?: boolean;
  /** Dentro de una frase (la descripción): más pequeño, alineado al texto. */
  compacto?: boolean;
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
        body: JSON.stringify({ tipoCaso: "conversacion", casoId: telefono, evento, claveAplazado }),
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
      className={`${sinMargen ? "" : "mt-2 "}inline-flex shrink-0 items-center rounded-lg border font-semibold transition-colors disabled:opacity-50 ${compacto ? "align-baseline px-1.5 py-0 text-[11px]" : "px-2.5 py-1 text-[12px]"} ${
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
 *  enums crudos en pantalla). Exportada: el banco de pruebas pinta los
 *  mismos campos — una sola traducción (§16). */
export function legibleCampo(clave: string): string {
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
    // mover_cita (15-09) y la cita declinada: faltaban y salían como enum.
    mover_o_anular: "Mover o anular",
    dia_franja_nuevos: "Nuevos días y franjas",
    cual_cita: "Qué cita",
    motivo: "Motivo",
    motivo_no_cita: "Por qué no quiere cita",
  };
  return MAPA[clave] ?? clave.replace(/_/g, " ");
}

/** La EDAD del asunto derivado, en días de clínica (§13): la presión que
 *  sustituye a la caducidad (MEJORAS 125 — nada caduca solo, pero envejece a
 *  la vista). Hoy no se dice; desde ayer, sí. */
function edadLegible(desdeISO: string): string {
  const desde = new Date(`${hoyISO(new Date(desdeISO))}T00:00:00Z`).getTime();
  const hoy = new Date(`${hoyISO()}T00:00:00Z`).getTime();
  const dias = Math.max(0, Math.round((hoy - desde) / 86_400_000));
  if (dias === 0) return "";
  return dias === 1 ? " (hace 1 día)" : ` (hace ${dias} días)`;
}
