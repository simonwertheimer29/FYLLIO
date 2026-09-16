// app/lib/agente/plantillas-hueco.ts
//
// LAS DOS RESPUESTAS AL PACIENTE CUANDO NO LE VA LA HORA (17-09, paso 3b).
// Plantillas de CÓDIGO: las escribe el sistema, no el modelo, porque lo que
// dicen depende de hechos que solo el código garantiza (la cita sigue
// reservada; alguien va a mirarlo). Textos pendientes de la aprobación de
// Simon antes de salir a producción (en DEMO se ven).
//
//  · RECHAZA («no me viene bien», «no puedo ese día»): no se puede quedar en
//    silencio hasta mañana — es la ventana en la que llama a otra clínica. Se
//    reconoce, se dice que una persona le propone otra hora, y se le invita a
//    decir qué le encaja. NO se anula nada: el hueco lo suelta la coordinadora.
//  · CONTRAPROPONE («¿y el viernes?»): no puede sonar a confirmación. Se
//    recoge la propuesta sin repetirla como si fuera un hueco, se dice que
//    se comprueba, y se deja claro que la cita reservada sigue en pie hasta
//    entonces.

import type { IdiomaPlantilla } from "./juez-borrador";
import { fechaClinica } from "../time";

export type CitaConfirmadaParaPlantilla = { fecha: string; hora: string };

const nombreDe = (nombre: string): string => {
  const n = nombre.trim().split(/\s+/)[0] ?? "";
  return n.length > 1 && !/\d/.test(n) ? `, ${n}` : "";
};

export function plantillaHuecoRechazado(p: {
  nombre: string;
  tipo: "rechaza" | "contrapropone";
  cita: CitaConfirmadaParaPlantilla;
  idioma?: IdiomaPlantilla;
}): string {
  const n = nombreDe(p.nombre);
  const dia = fechaClinica(p.cita.fecha, { diaSemana: true });
  const cuando = `${dia} a las ${p.cita.hora}`;
  if (p.tipo === "rechaza") {
    if (p.idioma === "ca") return `Entès${n}: ${cuando} no et va bé. Ho passo a l'equip perquè et proposin una altra hora en quant obri la clínica. Si ens dius quins dies o franges t'encaixen millor, ho tenen en compte.`;
    if (p.idioma === "en") return `Understood${n}: ${cuando} doesn't work for you. I'm passing it on to the team so they can offer you another time as soon as the clinic opens. If you tell us which days or times suit you best, they'll take it into account.`;
    return `Entendido${n}: ${cuando} no te viene bien. Se lo paso al equipo para que te propongan otra hora en cuanto abra la clínica. Si nos dices qué días o franjas te encajan mejor, lo tienen en cuenta.`;
  }
  if (p.idioma === "ca") return `Gràcies${n}. Passo la teva proposta a l'equip perquè la comprovin a l'agenda i et confirmin en quant obri la clínica. Fins llavors, la teva cita de ${cuando} segueix reservada.`;
  if (p.idioma === "en") return `Thanks${n}. I'm passing your suggestion to the team so they can check the schedule and confirm as soon as the clinic opens. Until then, your appointment on ${cuando} is still booked.`;
  return `Gracias${n}. Le paso tu propuesta al equipo para que la comprueben en la agenda y te confirmen en cuanto abra la clínica. Hasta entonces, tu cita del ${cuando} sigue reservada.`;
}
