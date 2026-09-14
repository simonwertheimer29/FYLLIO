// app/lib/agente/control-decisor.ts
//
// EL CONTROL SOBRE EL MENSAJE DE UN DECISOR QUE NO ES EL CÓDIGO (13-09).
//
// En el banco de los tres decisores (`hilos:tres`), B (contexto) y C (libre)
// escribían el mensaje y salía TAL CUAL: los vetos deterministas se pasaban
// «solo para enseñar si cazarían» y el juez no corría. Con eso, cada número
// medido sobre B y C describe un agente que en producción no existe — y el
// 13-09 se pagó: el decisor con contexto le dijo a una persona «te tenemos
// anotada para el jueves de 18:00 a 19:00» (una cita que nadie reservó) y la
// conclusión que se escribió fue «ninguna guarda lo paró», cuando la mitad de
// la verdad era que ninguna guarda CORRIÓ.
//
// Aquí vive la parte que el control NO decide y que depende de quién habla
// (`control-borrador.ts` lo dice en su cabecera): QUÉ sale cuando el veredicto
// es «descartado». Producción pone su plantilla y cuenta los descartes
// seguidos para entregar el caso (MEJORAS 233); esto hace lo mismo con UNA
// diferencia deliberada, y es la que mantiene limpia la comparación:
//
//   LA PLANTILLA DE REEMPLAZO NO RECOGE DATOS. Producción usa
//   `plantillaNeutraConRecogida` —sabe qué campos le faltan porque los tiene
//   delante—. Un decisor al que NO le damos los campos (C, y el D del alcance)
//   no puede heredar por la puerta de atrás una pregunta que no supo hacer:
//   sería el código recogiendo y la cifra apuntada al modelo. Se reemplaza con
//   la plantilla NEUTRA, y el segundo descarte seguido pasa el caso a una
//   persona igual que en producción.
//
// Lo que sí es idéntico a producción: la secuencia (veto → juez → poda → una
// reescritura → descarte), los datos que constan (`renderDatosQueConstan`) y
// la regla de los dos descartes. Lo que cambia es sólo el reemplazo.

import { controlarBorrador } from "./control-borrador";
import { plantillaNeutra, plantillaPasaAPersona, type IdiomaPlantilla } from "./juez-borrador";
import type { ControlDeUnMensaje } from "./actos";
import type { UsageTurno } from "./coste";

export type { ControlDeUnMensaje };

export type MensajeDelDecisor = {
  /** LO QUE SALE: lo que el paciente ve y a lo que reacciona. */
  texto: string;
  /** Lo que escribió el decisor, SOLO si el control lo cambió (si no, null:
   *  guardar el mismo texto dos veces invita a leer un cambio donde no hubo). */
  borrador: string | null;
  /** null = salió tal cual. */
  control: ControlDeUnMensaje | null;
  /** Descartes SEGUIDOS del hilo contando este (0 si este no descartó). */
  descartesSeguidos: number;
  /** Segundo descarte seguido: el caso pasa a una persona (233). */
  pasaAPersona: boolean;
  /** Una línea para el visor y el log. null = nada que contar. */
  nota: string | null;
  usage: UsageTurno | undefined;
};

const SALE_TAL_CUAL = (texto: string): MensajeDelDecisor => ({
  texto,
  borrador: null,
  control: null,
  descartesSeguidos: 0,
  pasaAPersona: false,
  nota: null,
  usage: undefined,
});

export async function controlarMensajeDelDecisor(a: {
  /** El mensaje que escribió el decisor. Vacío = no hay nada que controlar. */
  mensaje: string;
  /** Para la plantilla de reemplazo: el primer nombre que se usa al hablarle. */
  nombre: string;
  /** TODOS los nombres válidos para dirigirse a ella (el que consta y la pista
   *  del perfil de WhatsApp), para el veto del vocativo. Separado de `nombre`
   *  porque aquel es el que se ESCRIBE en la plantilla y este es contra el que
   *  se COMPARA: en un desconocido el primero está vacío o es el teléfono, y
   *  usar ese como vara convertía «Hola Dani» —el nombre de su perfil, que el
   *  prompt autoriza— en un nombre inventado. Medido el 14-09. */
  nombrePersona?: string | null;
  /** `renderDatosQueConstan(entrada)` — los MISMOS que ve producción. */
  datosQueConstan: string;
  ultimoMensaje?: string;
  dichoPorLaPersona?: string;
  turnoEntrega?: boolean;
  citaConsta?: boolean;
  idioma?: IdiomaPlantilla;
  /** El modelo que escribió el borrador: reescribir es su trabajo. */
  modeloId?: string;
  descartesSeguidosAntes?: number;
  /** false = no se gasta una reescritura (pasadas que quieren el veredicto pelado). */
  reescribir?: boolean;
  /** Los falsos positivos que el código perdonó, para que el caller los CUENTE. */
  perdonados?: string[];
}): Promise<MensajeDelDecisor> {
  if (a.mensaje.trim() === "") return SALE_TAL_CUAL(a.mensaje);

  const idioma: IdiomaPlantilla = a.idioma ?? "es";
  const control = await controlarBorrador(
    a.mensaje,
    {
      datosQueConstan: a.datosQueConstan,
      ultimoMensaje: a.ultimoMensaje,
      dichoPorLaPersona: a.dichoPorLaPersona,
      nombrePersona: a.nombrePersona ?? a.nombre,
      turnoEntrega: a.turnoEntrega,
      citaConsta: a.citaConsta,
      idioma,
      modeloId: a.modeloId,
      reescribir: a.reescribir,
    },
    a.perdonados ?? [],
  );
  const usage = control.usage;

  if (control.estado === "pasa") return { ...SALE_TAL_CUAL(control.texto), usage };

  if (control.estado === "podado") {
    return {
      texto: control.texto,
      borrador: a.mensaje,
      control: { estado: "podado", motivo: control.motivo, frase: control.frase, fuente: control.fuente, reescrito: control.reescrito },
      descartesSeguidos: 0,
      pasaAPersona: false,
      nota: `podado (${control.motivo} · ${control.fuente})${control.reescrito ? ", tras reescribir" : ""}: se fue «${control.frase}»`,
      usage,
    };
  }

  if (control.estado === "reescrito") {
    return {
      texto: control.texto,
      borrador: a.mensaje,
      control: { estado: "reescrito", motivo: control.motivo, frase: control.frase, fuente: control.fuente, reescrito: true },
      descartesSeguidos: 0,
      pasaAPersona: false,
      nota: `reescrito (${control.motivo} · ${control.fuente}): la frase que infringía ERA la respuesta — «${control.frase ?? "?"}»`,
      usage,
    };
  }

  // Descartado o juez sin respuesta (fail-closed, cuenta igual): sale la
  // plantilla NEUTRA —que no recoge— y al SEGUNDO seguido, la de pasar a una
  // persona: el agente no puede contestar esto sin infringir y deja de
  // intentarlo.
  const descartesSeguidos = Math.max(0, a.descartesSeguidosAntes ?? 0) + 1;
  const pasaAPersona = descartesSeguidos >= 2;
  const motivo = control.estado === "descartado" ? control.motivo : "sin_categoria";
  const frase = control.estado === "descartado" ? control.frase : null;
  return {
    texto: pasaAPersona ? plantillaPasaAPersona(a.nombre, idioma) : plantillaNeutra(a.nombre, idioma),
    borrador: a.mensaje,
    control: {
      estado: control.estado,
      motivo: control.estado === "descartado" ? motivo : null,
      frase,
      // El juez que no responde es fail-closed, no una caza: no lleva fuente.
      fuente: control.estado === "descartado" ? control.fuente : null,
      reescrito: control.estado === "descartado" ? control.reescrito : false,
    },
    descartesSeguidos,
    pasaAPersona,
    nota:
      control.estado === "juez_no_respondio"
        ? `el juez no respondió: descartado (fail-closed)${pasaAPersona ? " · 2º seguido: el caso pasa a una persona" : ""}`
        : `descartado (${motivo} · ${control.estado === "descartado" ? control.fuente : "?"}): «${frase ?? "?"}» — sale plantilla${pasaAPersona ? " · 2º seguido: el caso pasa a una persona" : ""}`,
    usage,
  };
}
