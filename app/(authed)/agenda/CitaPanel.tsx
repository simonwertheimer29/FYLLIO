"use client";

// G3-panel (dictado 30-08) — al pulsar una cita: su estado operativo y LA
// FICHA DEL CASO de siempre, intacta, debajo. No se construye una ficha
// nueva: FichaCasoPanel se monta tal cual (modo seguimiento, que ya trae el
// enlace a la conversación) y solo la CABECERA es de la cita — estado,
// recordatorio, traslado, y el chip del agente.
//
// El chip del agente dice algo ÚTIL (dictado): el semáforo de la ficha cubre
// los rojos (persona lo lleva / derivado / espera) pero NO afirmaba el caso
// verde — con el hilo libre y el evaluador de la clínica encendido, el
// agente contesta ahí solo y escribirle puede pisarle. Ese cruce
// (semáforo × interruptor de clínica) es exactamente lo que faltaba y lo que
// este chip enseña.
//
// Cita sin teléfono (nombre libre, sin ficha ni lead): se dice «sin
// conversación vinculada» — jamás una ficha vacía que parezca un caso sin
// datos (§4).

import { useEffect, useState } from "react";
import { PanelAccionShell, btnAccionSecundario } from "../../components/shared/panel-accion-ui";
import { FichaCasoPanel } from "../../components/agente/FichaCasoPanel";
import { cargarJSON } from "../../lib/fetch-json";
import { fechaClinica } from "../../lib/time";
import { fechaCorta } from "../../lib/agenda/fechas";
import {
  X,
  Sparkles,
  Bell,
  Check,
  CalendarClock,
  MessageCircle,
  ICON_STROKE,
} from "../../components/icons";

type SemaforoFicha = {
  verde: boolean;
  motivo?: "derivado_sin_resolver" | "hilo_asumido" | "espera";
  hasta?: string;
};

export type CitaDePanel = {
  id: string;
  nombre: string | null;
  estado: string;
  hora: string;
  fecha: string;
  doctorNombre: string;
  sinPasar: boolean;
  esFyllio: boolean;
  telefono: string | null;
  recordatorio: { estado: string; enviadoEnISO: string | null } | null;
  agenteActivo: boolean;
};

const ESTILO_ESTADO_CHIP: Record<string, string> = {
  Confirmada: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  Programada: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  Completado: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
};

function lineaRecordatorio(r: CitaDePanel["recordatorio"]): { texto: string; tono: "ok" | "neutro" | "mal" } {
  if (!r) return { texto: "Aún sin recordatorio — se genera la víspera de la cita.", tono: "neutro" };
  switch (r.estado) {
    case "Enviado":
      return { texto: `Recordatorio enviado${r.enviadoEnISO ? ` el ${fechaClinica(r.enviadoEnISO)}` : ""}.`, tono: "ok" };
    case "Pendiente":
      return { texto: "Recordatorio en la cola de envíos de hoy.", tono: "neutro" };
    case "Fallido":
      return { texto: "El recordatorio FALLÓ — revísalo en Envíos.", tono: "mal" };
    default:
      return { texto: `Recordatorio ${r.estado.toLowerCase()}.`, tono: "neutro" };
  }
}

export function CitaPanel({
  cita,
  onClose,
  onMover,
  onTrasladada,
  onCambio,
}: {
  cita: CitaDePanel;
  onClose: () => void;
  /** Abre el modal de mover (el arrastre en la rejilla sigue funcionando). */
  onMover: () => void;
  onTrasladada: () => void;
  onCambio: () => void;
}) {
  // El semáforo del caso, para el chip del agente. Mismo endpoint que usa la
  // ficha de abajo; si falla, el chip simplemente no afirma nada del hilo.
  const [semaforo, setSemaforo] = useState<SemaforoFicha | null>(null);
  useEffect(() => {
    if (!cita.telefono || !cita.agenteActivo) return;
    let vivo = true;
    void (async () => {
      try {
        const d = await cargarJSON<{ semaforo: SemaforoFicha }>(
          `/api/agente/ficha?telefono=${encodeURIComponent(cita.telefono!)}`,
        );
        if (vivo) setSemaforo(d.semaforo);
      } catch {
        // caída-declarada: sin semáforo el chip solo dice el interruptor de la clínica — no afirma quién lleva el hilo
      }
    })();
    return () => { vivo = false; };
  }, [cita.telefono, cita.agenteActivo]);

  const chipAgente = (() => {
    if (!cita.agenteActivo) {
      return { texto: "Agente apagado en esta clínica.", clase: "text-[var(--color-muted)]" };
    }
    if (!cita.telefono) return null; // sin conversación no hay hilo que llevar
    if (!semaforo) return { texto: "Agente encendido en esta clínica.", clase: "text-[var(--color-muted)]" };
    if (semaforo.verde) {
      return {
        texto: "El agente lleva esta conversación — si escribes tú, puedes pisarle.",
        clase: "font-medium text-[var(--color-accent)]",
      };
    }
    switch (semaforo.motivo) {
      case "hilo_asumido":
        return { texto: "Lo lleva una persona — el agente no contesta aquí.", clase: "text-[var(--color-foreground)]" };
      case "derivado_sin_resolver":
        return { texto: "Derivado: lo tiene que resolver una persona (detalle abajo).", clase: "font-medium text-[var(--color-warning)]" };
      case "espera":
        return { texto: `En espera${semaforo.hasta ? ` hasta el ${fechaClinica(semaforo.hasta)}` : ""} — sin contacto.`, clase: "text-[var(--color-foreground)]" };
      default:
        return { texto: "Agente encendido en esta clínica.", clase: "text-[var(--color-muted)]" };
    }
  })();

  const rec = lineaRecordatorio(cita.recordatorio);

  return (
    <PanelAccionShell onClose={onClose}>
      {/* ── Cabecera: LA CITA ── */}
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold text-[var(--color-foreground)]">
              {cita.nombre ?? "—"}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              <span className="[font-variant-numeric:tabular-nums]">{fechaCorta(cita.fecha)} · {cita.hora}</span> — {cita.doctorNombre}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTILO_ESTADO_CHIP[cita.estado] ?? "bg-[var(--color-surface-muted)] text-[var(--color-foreground)]"}`}>
            {cita.estado === "Completado" ? "Completada" : cita.estado}
          </span>
          {cita.sinPasar && (
            <span className="rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warning)]">
              Sin pasar a tu software
            </span>
          )}
        </div>

        <p className={`mt-2 flex items-center gap-1.5 text-[11.5px] ${rec.tono === "mal" ? "font-medium text-[var(--color-danger)]" : rec.tono === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}`}>
          <Bell size={12} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
          {rec.texto}
        </p>

        {chipAgente && (
          <p className={`mt-1 flex items-center gap-1.5 text-[11.5px] ${chipAgente.clase}`}>
            <Sparkles size={12} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
            {chipAgente.texto}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {cita.esFyllio && (
            <button type="button" onClick={onMover} className={btnAccionSecundario}>
              <CalendarClock size={13} strokeWidth={ICON_STROKE} aria-hidden /> Mover cita
            </button>
          )}
          {cita.sinPasar && (
            <button type="button" onClick={onTrasladada} className={btnAccionSecundario}>
              <Check size={13} strokeWidth={ICON_STROKE} aria-hidden /> Ya está en mi software
            </button>
          )}
        </div>
      </div>

      {/* ── LA FICHA DE SIEMPRE, intacta ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {cita.telefono ? (
          <FichaCasoPanel telefono={cita.telefono} modo="seguimiento" onCambio={onCambio} />
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] px-3 py-4 text-center">
            <MessageCircle size={16} strokeWidth={ICON_STROKE} className="mx-auto mb-1.5 text-[var(--color-muted)]" aria-hidden />
            <p className="text-xs font-medium text-[var(--color-foreground)]">Sin conversación vinculada</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
              La cita se creó sin ficha de paciente — no hay hilo ni caso que enseñar.
            </p>
          </div>
        )}
      </div>
    </PanelAccionShell>
  );
}
