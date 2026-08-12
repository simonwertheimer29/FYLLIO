// app/lib/presupuestos/situacion.ts
//
// «Qué pasa con este caso» y «qué se recomienda hacer».
//
// Vivía dentro de `IntervencionSidePanel` como función local. Sale aquí porque
// la bandeja de /mensajeria necesita exactamente lo mismo, y la alternativa era
// copiarla: dos criterios de negocio para la misma frase, que divergen el día
// que alguien cambie uno. Es el patrón paralelo de siempre.
//
// Es criterio de NEGOCIO, no presentación: qué se le dice a la coordinadora que
// está pasando y qué debería hacer. La presentación la pone
// `ContextoRecomendacion` de `panel-accion-ui`, que no sabe de casos.

import { preguntaPorElPago } from "./intenciones";
import type { PresupuestoIntervencion } from "./types";
import { ESTADO_CONFIG } from "./colors";
import { haceTexto } from "./estado-conversacion";
import { eur } from "../../components/shared/Cifra";
import type { PrioridadPanel } from "../../components/shared/panel-accion-ui";

// ─── Situación: qué pasa + recomendación (datos del motor primero) ─────

export type SituacionPresupuesto = {
  prioridad: PrioridadPanel;
  quePasa: string;
  recomendacion: string;
  primaria: "escribir" | "llamar";
};

export function prioridadDe(item: PresupuestoIntervencion, dias: number): PrioridadPanel {
  switch (item.urgenciaIntervencion) {
    case "CRÍTICO":
    case "ALTO":
      return "alta";
    case "MEDIO":
      return "media";
    case "BAJO":
    case "NINGUNO":
      return "baja";
    default:
      return dias >= 7 ? "alta" : dias >= 3 ? "media" : "baja";
  }
}

export function situacionPresupuesto(item: PresupuestoIntervencion): SituacionPresupuesto {
  const dias = item.diasDesdeUltimoContacto ?? item.daysSince;
  const importe = item.amount != null ? eur(item.amount) : "";
  const estadoLabel = ESTADO_CONFIG[item.estado]?.label ?? item.estado;

  if (item.estado === "PERDIDO") {
    return {
      prioridad: "baja",
      quePasa: `Motivo registrado: ${item.motivoPerdidaTexto ?? item.motivoPerdida ?? "sin especificar"}.`,
      recomendacion: "Caso cerrado como perdido",
      primaria: "escribir",
    };
  }
  if (item.estado === "ACEPTADO") {
    return {
      prioridad: "baja",
      quePasa: `Presupuesto de ${importe} aceptado.`,
      recomendacion: "Coordina el inicio del tratamiento",
      primaria: "escribir",
    };
  }
  if (preguntaPorElPago(item.intencionDetectada)) {
    return {
      prioridad: "alta",
      quePasa: `Está listo para aceptar y preguntó por las opciones de pago.`,
      recomendacion: "Envíale los detalles de pago",
      primaria: "escribir",
    };
  }
  // Pelota NUESTRA según el hilo (clasificación única del servidor): la card
  // lo dice aunque la IA no haya clasificado el texto — sin esta rama, un
  // presupuesto con Ultima_respuesta_paciente vacío caía al fallback viejo de
  // "N días sin contacto" y la card contradecía a su propio hilo.
  if (item.conversacion?.estado === "pendiente_responder") {
    const resp = item.ultimaRespuestaPaciente;
    return {
      prioridad: prioridadDe(item, dias),
      quePasa: resp
        ? `Respondió: «${resp.slice(0, 70)}${resp.length > 70 ? "…" : ""}»`
        : `Te respondió ${item.conversacion.haceMs != null ? haceTexto(item.conversacion.haceMs) : "hace poco"} y sigue sin contestación.`,
      recomendacion: item.accionSugerida ?? "Responde a su mensaje",
      primaria: "escribir",
    };
  }
  // Sin clasificación del servidor (datos antiguos): el texto persistido
  // sigue valiendo como hasta ahora.
  if (item.ultimaRespuestaPaciente && !item.conversacion) {
    return {
      prioridad: prioridadDe(item, dias),
      quePasa: `Respondió: «${item.ultimaRespuestaPaciente.slice(0, 70)}${item.ultimaRespuestaPaciente.length > 70 ? "…" : ""}»`,
      recomendacion: item.accionSugerida ?? "Responde a su mensaje",
      primaria: "escribir",
    };
  }
  if (item.conversacion?.estado === "en_espera_paciente" && item.conversacion.haceMs != null) {
    return {
      prioridad: "baja",
      quePasa: `Le escribiste ${haceTexto(item.conversacion.haceMs)}; la pelota está en el paciente.`,
      recomendacion: "Espera su respuesta — ya actuaste",
      primaria: "escribir",
    };
  }
  if (item.conversacion?.estado === "reactivable" && item.conversacion.haceMs != null) {
    return {
      prioridad: prioridadDe(item, dias),
      quePasa: `Se le escribió ${haceTexto(item.conversacion.haceMs)} sobre ${item.treatments[0] ?? "su presupuesto"} y no ha respondido.`,
      recomendacion: "Insiste — genera el mensaje con IA",
      primaria: "escribir",
    };
  }
  return {
    prioridad: prioridadDe(item, dias),
    quePasa: `${dias} día${dias === 1 ? "" : "s"} sin contacto con ${importe || "el presupuesto"} en juego (${estadoLabel}).`,
    recomendacion:
      item.accionSugerida ?? (dias >= 7 ? "Rescata este presupuesto" : dias >= 3 ? "Haz seguimiento" : "Confirma que le llegó el presupuesto"),
    primaria: dias >= 7 ? "llamar" : "escribir",
  };
}

// ─── Panel ─────────────────────────────────────────────────────────────
