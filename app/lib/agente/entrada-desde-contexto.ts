// app/lib/agente/entrada-desde-contexto.ts
//
// EL ÚNICO CONSTRUCTOR de la entrada del evaluador (10-09, MEJORAS 225).
//
// Hasta hoy la entrada la montaban DOS sitios: el orquestador del webhook
// (evaluar-entrante) y el banco de pruebas (banco-pruebas), cada uno a su
// manera. Divergieron sin que nadie lo viera: el orquestador pasaba el
// nombre de PERFIL de WhatsApp como `nombre` y el banco ponía el teléfono
// «exactamente como producción»; el orquestador no pasaba la clínica; el
// orden de los objetivos no era el mismo. El resultado: con el mismo
// mensaje, el banco decía «sigue» y producción entregaba el caso al primer
// turno — y el banco, que existe para probar producción, no lo enseñaba.
//
// Regla: la entrada se construye AQUÍ y solo aquí. El orquestador trae sus
// piezas de la base; el banco trae piezas sintéticas. Lo que difiere entre
// los dos es el DATO (señales del hilo, ids), nunca la construcción.
// `qa:banco-vs-runner` lo comprueba sobre el fixture de hilos jugados.
//
// Y la pista de perfil: un nombre de perfil de WhatsApp NO es un nombre
// que la persona haya dado. Viaja aparte (`nombrePerfil`), el render lo
// declara como pista, y el evaluador quita del juicio un `nombre` recogido
// que solo conste en el perfil (código, no prompt).

import type { EntradaEvaluador, MensajeHilo, SenalesHilo } from "./evaluador";
import type { ConocimientoClinica } from "./conocimiento";
import type { ObjetivoAgente, EtapaObjetivo } from "../automatizacion/objetivos";
import { pendientesDeAplazados, vueltasPorClave, type EventoAplazamiento } from "../automatizacion/aplazamientos";
import { esLegible, etiquetaDeTipo } from "../mensajeria/tipos-mensaje";

/** La coletilla del cobro se dice UNA vez (MEJORAS 120): si un saliente del
 *  hilo ya la lleva, el evaluador no la repite. */
export const FRASE_RECUERDO_COBRO = /pago pendiente|pendiente de pago|pago que tienes pendiente|tienes un pago/i;

/** Lo que el constructor necesita del contexto de la conversación. Es un
 *  SUBCONJUNTO de `ContextoConversacion` (el orquestador pasa el suyo tal
 *  cual; el banco fabrica uno). */
export type ContextoParaEntrada = {
  telefono: string;
  nombre: string;
  origenNombre: "paciente" | "lead" | "perfil" | "telefono";
  pacienteId: string | null;
  presupuestosVivos: readonly { id?: string | null; tratamiento: string | null; importe: number | null }[];
  pendienteCobro: number;
  objetivosAbiertos: readonly EtapaObjetivo[];
  identidadAmbigua: { nombres: string[] } | null;
};

export type SemaforoParaEntrada = {
  verde: boolean;
  motivo?: string | null;
  hasta?: string | null;
  esperaMotivo?: string | null;
};

export type PiezasEntrada = {
  ctx: ContextoParaEntrada;
  objetivosConfig: readonly ObjetivoAgente[];
  conocimiento: ConocimientoClinica | null;
  clinicaNombre: string | null;
  hilo: MensajeHilo[];
  /** Tipo del entrante que dispara el turno (034). Ausente = texto. */
  tipoEntrante?: string | null;
  aplazamientos: readonly EventoAplazamiento[];
  semaforo: SemaforoParaEntrada;
  diasHastaProximaCita: number | null;
  /** Contadas por código sobre marcas de tiempo REALES; el banco no las tiene. */
  senales: SenalesHilo | null;
  optOutVigente: boolean;
  clinicasDelHilo: EntradaEvaluador["clinicasDelHilo"];
  hoy?: string;
};

export function entradaDesdeContexto(p: PiezasEntrada): EntradaEvaluador {
  const { ctx } = p;
  // Solo una FICHA (paciente o lead) da nombre. Sin ficha, el nombre es el
  // teléfono y el perfil de WhatsApp viaja aparte, como pista.
  const fichado = ctx.origenNombre === "paciente" || ctx.origenNombre === "lead";
  const objetivosAbiertos = ctx.objetivosAbiertos
    .map((etapa) => p.objetivosConfig.find((o) => o.etapa === etapa))
    .filter((o): o is ObjetivoAgente => o != null);
  const ultimoEntrante = [...p.hilo].reverse().find((m) => m.direccion === "Entrante") ?? null;
  const tipoUltimo = String(ultimoEntrante?.tipo ?? p.tipoEntrante ?? "text");
  const ultimoNoLegible = !esLegible(tipoUltimo) ? { tipo: tipoUltimo, etiqueta: etiquetaDeTipo(tipoUltimo) } : null;
  const pendientes = pendientesDeAplazados(p.aplazamientos);
  const yaDerivado = !p.semaforo.verde && p.semaforo.motivo !== "espera";
  return {
    nombre: fichado ? ctx.nombre : ctx.telefono,
    nombrePerfil: ctx.origenNombre === "perfil" ? ctx.nombre : null,
    esPacienteConocido: ctx.pacienteId != null,
    clinica: p.clinicaNombre,
    objetivosAbiertos,
    presupuestosVivos: ctx.presupuestosVivos.map((x) => ({ id: x.id, tratamiento: x.tratamiento, importe: x.importe })),
    pendienteCobro: ctx.pendienteCobro,
    hilo: p.hilo,
    aplazadosPendientes: pendientes.flatMap((x) => x.motivos.map((motivo) => ({ clave: x.clave, motivo }))),
    aplazadosPorClave: vueltasPorClave(p.aplazamientos),
    conocimiento: p.conocimiento,
    umbralInsistencia: p.conocimiento?.alcance.umbralInsistencia ?? undefined,
    urgencias: p.conocimiento?.alcance.urgencias ?? undefined,
    diasHastaProximaCita: p.diasHastaProximaCita,
    yaDerivado,
    hoy: p.hoy,
    esperaVigente:
      !p.semaforo.verde && p.semaforo.motivo === "espera" && p.semaforo.hasta
        ? { hasta: p.semaforo.hasta, motivo: p.semaforo.esperaMotivo ?? null }
        : null,
    ultimoNoLegible,
    cobroYaRecordado: p.hilo.some((m) => m.direccion === "Saliente" && FRASE_RECUERDO_COBRO.test(m.contenido)),
    senales: p.senales,
    optOutVigente: p.optOutVigente,
    clinicasDelHilo: p.clinicasDelHilo,
    identidadAmbigua: ctx.identidadAmbigua ? { nombres: ctx.identidadAmbigua.nombres } : null,
  };
}
