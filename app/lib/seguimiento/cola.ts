// app/lib/seguimiento/cola.ts
//
// LA COLA DE SEGUIMIENTO (fase B, P1 — TRES cohortes desde el 18-08).
//
// LAS COHORTES SON TRES Y NO CRECEN (dictado, §3 del PLAN): **Necesita
// respuesta · Listos para cerrar · Fuera de plazo.** La regla de entrada:
// SOLO entra lo que exige que una PERSONA haga algo. Todo lo demás no es
// cola — es Mensajería (supervisión del agente), Envíos (cadencia) o
// consulta (Tablas) — y aquí se representa como `null`.
//
// El mapeo, bajo esa regla:
//   quiebre                → Necesita respuesta
//   paciente escribió      → Necesita respuesta
//   entregas del agente    → caso_completo → Listos; resto de causas
//                            (urgencia, queja, antecedente…) → Necesita.
//   cierra y anota         → Listos para cerrar
//   agotado (toca llamar)  → Necesita respuesta (detalle) — la cadencia se
//                            acabó y lo que queda es una llamada humana.
//   lead nuevo sin hilo    → Necesita respuesta (detalle) — la cadencia de
//                            leads NO existe (MEJORAS 100); el primer toque
//                            es de una persona. Un PRESUPUESTO sin hilo NO:
//                            su primer toque lo propone la cola de Envíos.
//   aplazados sin entrega  → null — el agente sigue trabajando: supervisión,
//                            vive en Mensajería > En curso (18-08: se
//                            eliminó «Pendientes de resolver»).
//   citados                → null — su pendiente es el recordatorio
//                            automático (Envíos); «¿quién viene?» es la
//                            agenda (MEJORAS 97). Cayó la condición anotada.
//   esperando al paciente  → null — consulta (Tablas).
//   sin respuesta          → null — consulta; la cadencia de Envíos lo toca.
//
// FUERA DE PLAZO no es un estado nuevo: es la ESCALADA de las otras dos.
// «Le tocaba a una persona y no se hizo dentro del umbral» — llegar ahí es
// un fallo del equipo (el censo de rojos viejos hecho cohorte). El umbral es
// un compromiso de servicio POR TIPO (configurable en la pantalla del
// agente, fase D; defaults dictados abajo) y su reloj SOLO corre en horario
// de clínica (tiempo-laborable.ts).
//
// Módulo con dos capas: `cohorteDeCaso` PURA (client-safe; el reloj
// laborable se INYECTA como callback, así el QA lo fija sin base) y
// `colaDeSeguimiento` con datos (solo servidor). La lib vieja (cohortes.ts)
// NO se toca: LeadsView, Intervención y /red siguen sobre ella hasta P4.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO } from "../time";
import {
  estadoConversacion,
  entradaDesdeMensajes,
  diasDeClinicaEntre,
  UMBRAL_REACTIVACION_DIAS,
  type EstadoConversacion,
} from "../presupuestos/estado-conversacion";
import {
  estadoAutomatizacion,
  type EstadoAutomatizacion,
  type CausaDerivacion,
} from "../automatizacion/estado";
import type { IntencionDetectada } from "../presupuestos/types";
import { ultimosEventosPorCaso, toquesAntesDeAgotar } from "../automatizacion/pg";
import { esLeadActivo } from "../leads/pipeline";
import { parseConocimiento, plazosParaReloj, politicaCobro, POLITICA_COBRO_DEFAULT } from "../agente/conocimiento";
import { calcularCobrosPorPaciente } from "../cobros";
import { listPacientes } from "../pacientes/pacientes";
import { listPagosResumen } from "../pagos";
import { selectPresupuestosRaw } from "../presupuestos/repo";
import { listAllOpciones } from "../configuraciones/configuraciones";
import { minutosLaborablesEntre } from "./tiempo-laborable";
import { elegirPresupuestoActivo } from "./presupuesto-activo";

// ─── Las tres. No crecen. ───────────────────────────────────────────────────

export type Cohorte =
  | "necesita_respuesta"
  | "listos_para_cerrar"
  | "fuera_de_plazo";

export const ORDEN_COHORTES: readonly Cohorte[] = [
  "necesita_respuesta",
  "listos_para_cerrar",
  "fuera_de_plazo",
];

export const ETIQUETA_COHORTE: Record<Cohorte, string> = {
  necesita_respuesta: "Necesita respuesta",
  listos_para_cerrar: "Listos para cerrar",
  fuera_de_plazo: "Fuera de plazo",
};

/** El PORQUÉ dentro de la cohorte — para la card y los FILTROS, jamás una
 *  cuarta cohorte. Fuera de plazo CONSERVA el detalle de su obligación. */
export type DetalleCohorte =
  | "quebrado"
  | "paciente_escribio"
  | "entregado_urgente"
  | "entregado_listo"
  | "cierre_pendiente"
  | "agotado"
  | "nuevo_sin_contactar"
  | "cobro_vencido";

/** Los detalles de CONVERSACIÓN — los únicos que mide el reloj laborable.
 *  El cobro escala por DÍAS de la política de cobro (F5), nunca por minutos:
 *  el vencimiento es del dinero, no de una persona esperando en horario. */
export type DetalleConversacion = Exclude<DetalleCohorte, "cobro_vencido">;

// ─── Fuera de plazo: umbrales por tipo de obligación ───────────────────────

export type ObligacionPlazo = "urgencia" | "respuesta" | "cierre" | "lead_nuevo" | "llamada";

/** Defaults DICTADOS (18-08), en minutos LABORABLES: el estándar es la
 *  clínica con recepcionista que contesta el mismo día — el número acaba en
 *  la venta y no puede bajar el listón. Configurable por clínica y por tipo
 *  en la pantalla del agente (fase D). `llamada` es default nuestro (no
 *  dictado): el agotado toca llamarlo dentro de la jornada. */
export const UMBRAL_FUERA_DE_PLAZO_MIN: Record<ObligacionPlazo, number> = {
  urgencia: 30,
  respuesta: 120,
  cierre: 240,
  lead_nuevo: 60,
  llamada: 240,
};

export const OBLIGACION_DE_DETALLE: Record<DetalleConversacion, ObligacionPlazo> = {
  quebrado: "respuesta",
  paciente_escribio: "respuesta",
  entregado_urgente: "urgencia",
  entregado_listo: "cierre",
  cierre_pendiente: "cierre",
  agotado: "llamada",
  nuevo_sin_contactar: "lead_nuevo",
};

// ─── La función pura: un caso → una de las tres, o null (no es cola) ───────

export type EntradaCohorte = {
  /** Un presupuesto sin hilo lo toca la cadencia de Envíos; un lead sin hilo
   *  lo toca una PERSONA (no hay cadencia de leads) — el tipo decide. */
  tipoCaso: "lead" | "presupuesto" | "conversacion";
  conversacion: EstadoConversacion;
  /** Del clasificador viejo (compat 93/94, sigue vivo hasta que Simon
   *  encienda el evaluador): quebrado/agotado/cierre_pendiente. */
  automatizacion?: EstadoAutomatizacion | null;
  hoy: string;
  /** Del LOG del agente, por teléfono (contado por el caller, no juzgado). */
  agente?: {
    entregadoCausa: CausaDerivacion | null;
    aplazadosVivos: number;
  } | null;
  /** Espera vigente («sin contacto hasta») — 026, o la de «llamé y no
   *  contesta» (MEJORAS 102). Saca de la cola lo que era iniciativa NUESTRA
   *  (agotado, lead nuevo): el caso vuelve solo al vencer. NO tapa lo que el
   *  paciente provoca (escribió, quiebre) ni las entregas del agente. */
  enEspera?: boolean;
  /** Instantes que arrancan el reloj de cada obligación (ISO). Sin el que
   *  toca, el caso no puede escalar a Fuera de plazo — se queda en su
   *  cohorte base, nunca inventa una antigüedad. */
  ultimoEntranteISO?: string | null;
  ultimoSalienteISO?: string | null;
  entregadoEnISO?: string | null;
  creadoISO?: string | null;
};

export type RelojDePlazos = {
  /** Minutos LABORABLES desde el instante dado hasta ahora (lo inyecta el
   *  caller; el QA lo fija a mano — §14). */
  minutosLaborablesDesde: (iso: string) => number;
  umbralesMin?: Partial<Record<ObligacionPlazo, number>>;
};

export type ResultadoCohorte = {
  cohorte: Cohorte;
  detalle: DetalleCohorte;
  /** Desde cuándo espera a la persona (ISO) — la edad que mide el plazo. */
  esperandoDesde: string | null;
  /** Minutos laborables esperando, si el reloj pudo medirlos. */
  esperandoMinLaborables: number | null;
};

/** El instante en que la obligación pasó a manos de una persona. */
function desdeDeObligacion(detalle: DetalleConversacion, e: EntradaCohorte): string | null {
  switch (detalle) {
    case "paciente_escribio":
      return e.ultimoEntranteISO ?? null;
    case "quebrado":
    case "cierre_pendiente":
      return e.ultimoEntranteISO ?? e.ultimoSalienteISO ?? e.creadoISO ?? null;
    case "entregado_urgente":
    case "entregado_listo":
      return e.entregadoEnISO ?? null;
    case "agotado":
      return e.ultimoSalienteISO ?? e.creadoISO ?? null;
    case "nuevo_sin_contactar":
      return e.creadoISO ?? null;
  }
}

export function cohorteDeCaso(e: EntradaCohorte, reloj?: RelojDePlazos): ResultadoCohorte | null {
  const base = cohorteBase(e);
  if (!base) return null;

  const esperandoDesde = desdeDeObligacion(base.detalle, e);
  let esperandoMinLaborables: number | null = null;
  let cohorte: Cohorte = base.cohorte;
  if (reloj && esperandoDesde) {
    esperandoMinLaborables = reloj.minutosLaborablesDesde(esperandoDesde);
    const umbral = reloj.umbralesMin?.[OBLIGACION_DE_DETALLE[base.detalle]]
      ?? UMBRAL_FUERA_DE_PLAZO_MIN[OBLIGACION_DE_DETALLE[base.detalle]];
    if (esperandoMinLaborables > umbral) cohorte = "fuera_de_plazo";
  }
  return { cohorte, detalle: base.detalle, esperandoDesde, esperandoMinLaborables };
}

function cohorteBase(e: EntradaCohorte): { cohorte: Exclude<Cohorte, "fuera_de_plazo">; detalle: DetalleConversacion } | null {
  // 1 · NECESITA RESPUESTA — hay una persona esperando una acción humana.
  if (e.automatizacion === "quebrado") return { cohorte: "necesita_respuesta", detalle: "quebrado" };
  if (e.agente?.entregadoCausa && e.agente.entregadoCausa !== "caso_completo") {
    return { cohorte: "necesita_respuesta", detalle: "entregado_urgente" };
  }
  if (e.conversacion === "pendiente_responder") {
    return { cohorte: "necesita_respuesta", detalle: "paciente_escribio" };
  }

  // 2 · LISTOS PARA CERRAR — el agente terminó; aquí estará el volumen. Un
  //     listo CON aplazados va aquí: los aplazados se ven DENTRO de la ficha.
  if (e.agente?.entregadoCausa === "caso_completo") {
    return { cohorte: "listos_para_cerrar", detalle: "entregado_listo" };
  }
  if (e.automatizacion === "cierre_pendiente") {
    return { cohorte: "listos_para_cerrar", detalle: "cierre_pendiente" };
  }

  // 3 · Lo que aún exige persona sin ser respuesta ni cierre. La ESPERA
  //     vigente lo saca (MEJORAS 102: «llamé y no contesta» fija espera de
  //     1 día laborable y el caso vuelve SOLO): estos dos son iniciativa
  //     nuestra, y una espera dice exactamente «no toca iniciativa».
  if (!e.enEspera) {
    if (e.automatizacion === "agotado") return { cohorte: "necesita_respuesta", detalle: "agotado" };
    if (e.conversacion === "sin_conversacion" && e.tipoCaso === "lead") {
      return { cohorte: "necesita_respuesta", detalle: "nuevo_sin_contactar" };
    }
  }

  // 4 · NO ES COLA (18-08). El switch mantiene la TOTALIDAD: un valor nuevo
  //     de EstadoConversacion rompe la compilación en vez de colarse.
  // (pendiente_responder ya salió en la guarda 1: el narrowing lo excluye.)
  switch (e.conversacion) {
    case "sin_conversacion": // presupuesto/conversación sin hilo → Envíos (cadencia)
    case "en_espera_paciente": // esperamos NOSOTROS → consulta (Tablas)
    case "reactivable": // rezagados → la cadencia de Envíos los toca
      return null;
    default:
      return exhaustivo(e.conversacion);
  }
}

function exhaustivo(x: never): never {
  throw new Error(`EstadoConversacion sin destino: ${String(x)}`);
}

// ─── El cobro vencido: cohorte por DÍAS (F5) ───────────────────────────────
//
// El cobro entra por las mismas puertas que el presupuesto donde ya hay
// conversación (paciente escribió → NR; el agente entregó → Listos). Lo
// único genuinamente nuevo es el VENCIDO SIN CONVERSACIÓN: sin cadencia de
// cobro, si no entra en cola muere invisible. La política de cobro de la
// clínica decide cuándo: vencido > N días → Necesita respuesta; > M días →
// Fuera de plazo. Estancados y por-vencer NO son cola (señal en campana).

export function cohorteDeCobro(args: {
  pendiente: number;
  diasVencido: number | null;
  tieneLiquidacion: boolean;
  politica: { vencidoDias: number; fueraDePlazoDias: number };
}): { cohorte: Cohorte; detalle: "cobro_vencido" } | null {
  if (args.pendiente <= 0) return null;
  if (args.tieneLiquidacion) return null; // hay acuerdo de liquidación: no se persigue
  if (args.diasVencido == null || args.diasVencido <= args.politica.vencidoDias) return null;
  return {
    cohorte: args.diasVencido > args.politica.fueraDePlazoDias ? "fuera_de_plazo" : "necesita_respuesta",
    detalle: "cobro_vencido",
  };
}

// ─── La cola con datos ──────────────────────────────────────────────────────

export type CasoDeCola = {
  /** lead:<id> · presupuesto:<id> · conversacion:<telefono> · cobro:<pacienteId> */
  id: string;
  tipo: "lead" | "presupuesto" | "conversacion" | "cobro";
  telefono: string | null;
  nombre: string;
  clinicaId: string | null;
  cohorte: Cohorte;
  detalle: DetalleCohorte;
  /** € SOLO cuando el dato existe (presupuestos). Los leads no llevan
   *  importe en datos: se cuentan, no se inventan. */
  importe: number | null;
  tratamiento: string | null;
  origen: string | null;
  /** Días de clínica que lleva parado (desde el último toque o el alta). */
  paradoDias: number;
  /** Minutos laborables que la obligación lleva esperando a la persona. */
  esperandoMinLaborables: number | null;
  /** Espera vigente («sin contacto hasta») — la card lo señala. */
  enEspera: boolean;
  /** El agente evaluó este hilo (hay evento `evaluacion` en el log) — B3:
   *  gobierna el botón «Redactar entrada»; sin evaluación, sin botón. */
  evaluado: boolean;
  /** Agrupación 21-08 (el caso es la CONVERSACIÓN): suma de TODOS los
   *  presupuestos vivos del caso — lo que suma la cabecera. null en leads. */
  importeTotal: number | null;
  /** Los demás presupuestos vivos, NOMBRADOS (condición dictada: el otro se
   *  recuerda, no solo se cuenta). */
  otrosPresupuestos: { id: string; importe: number | null; tratamiento: string | null }[];
  /** De dónde salió el activo — "conversacion" (el evaluador capturó de
   *  cuál hablan), "proxy" (señal del clasificador, o único/más reciente) o
   *  "sin_senal" (varios vivos y nadie señaló ninguno: el activo es solo
   *  ancla técnica y la UI no lo presenta como elegido). Visible siempre:
   *  un activo elegido en silencio es peor que dos cards. */
  activoFuente: "conversacion" | "proxy" | "sin_senal" | null;
  /** F5 — el pago vencido del caso (política de cobro superada). En un caso
   *  con presupuesto vivo Y deuda es EL MISMO caso con dos objetivos: el
   *  cobro se anexa, jamás crea una segunda card. */
  cobro: { pacienteId: string; pendiente: number; diasVencido: number } | null;
};

export type ResumenCola = {
  /** € parados EN LA COLA = presupuestos que esperan a una persona. Lo que
   *  trabaja el agente o la cadencia no está «parado por nosotros». */
  /** DOS bolsillos (F5, dictado): presupuestos por cerrar y cobros vencidos
   *  no se suman — dineroParado queda como la cifra de presupuestos. */
  dineroParado: number;
  dineroPresupuestos: number;
  dineroCobros: number;
  /** Los leads no tienen importe: HECHO, no estimación — se cuentan. */
  leadsSinImporte: number;
  masViejoDias: number | null;
};

export async function colaDeSeguimiento(opts?: { hoy?: string; ahora?: Date }): Promise<{
  casos: CasoDeCola[];
  resumen: ResumenCola;
}> {
  const cliente = requireCliente("colaDeSeguimiento");
  // RELOJ VIVO (MEJORAS 111, dictada 23-08): el «ahora» de los plazos
  // operativos es el instante real — con el ancla vieja de mediodía, una
  // urgencia de las 15:00 no podía escalar hasta el día siguiente y el
  // umbral de 30 min no significaba nada. Lo DIARIO (paradoDias, estados de
  // conversación) sigue contando en días de clínica y no se mueve dentro
  // del día (§13): solo el reloj fino cobra vida. `ahora` se inyecta desde
  // el QA (§14) para que los fixtures anclados midan siempre lo mismo;
  // `hoy` inyectado sin `ahora` conserva el mediodía de antes.
  const ahora = opts?.ahora ?? (opts?.hoy ? new Date(`${opts.hoy}T12:00:00Z`) : new Date());
  const hoy = opts?.hoy ?? hoyISO(ahora);
  const dig = (t: string | null | undefined) => String(t ?? "").replace(/[^0-9]/g, "");

  // El clasificador VIEJO, con su función real (no una réplica que pierda
  // ramas): últimos eventos humanos por caso + umbral de agotado. Compat
  // 93/94 — vive hasta que Simon decida encender el evaluador.
  const [evPresupuesto, evLead, umbralToques] = await Promise.all([
    ultimosEventosPorCaso("presupuesto"),
    ultimosEventosPorCaso("lead"),
    toquesAntesDeAgotar(null),
  ]);

  const datos = await runWithClienteDb(cliente, async (trx) => {
    const leads = await trx
      .selectFrom("leads")
      .select(["id", "nombre", "telefono", "estado", "tratamiento_interes", "canal_captacion", "clinica_id", "fecha_cita", "convertido_a_paciente", "created_at", "whatsapp_enviados"])
      .where((eb) => eb.or([eb("convertido_a_paciente", "is", null), eb("convertido_a_paciente", "=", false)]))
      .execute();

    const presupuestos = await trx
      .selectFrom("presupuestos")
      .select(["id", "paciente_id", "paciente_telefono", "tratamiento_nombre", "estado", "importe", "clinica_id", "fecha", "created_at", "requiere_persona", "intencion_detectada", "contact_count", "fase_seguimiento"])
      .where((eb) => eb.or([eb("estado", "is", null), eb("estado", "not in", ["ACEPTADO", "PERDIDO"])]))
      .execute();

    const pacientes = await trx
      .selectFrom("pacientes")
      .select(["id", "nombre", "telefono"])
      .execute();

    // Mensajes: agregados por teléfono, una consulta (el patrón de la bandeja).
    const m: any = await sql`select telefono,
        max("timestamp") filter (where direccion = 'Entrante') as ultimo_entrante,
        max("timestamp") filter (where direccion = 'Saliente') as ultimo_saliente
      from mensajes_whatsapp where telefono is not null group by telefono`.execute(trx);

    // El LOG del agente: derivados/cierres/aplazados/esperas por caso.
    const ev: any = await sql`select caso_id, evento, causa_derivacion, clave_aplazado, hasta, created_at, evaluacion_json
        from eventos_automatizacion
        where tipo_caso = 'conversacion'
          and evento in ('derivado','resuelto_manual','asumido_manual','soltado','espera_fijada','espera_levantada','aplazado','aplazado_resuelto','evaluacion')
        order by created_at asc`.execute(trx);

    // Fase D grupo 4: los PLAZOS y el HORARIO por clínica viven en la
    // configuración del agente — el reloj de cada caso se construye con los
    // de SU clínica (fila clinica_id null = la global de la red).
    const cfg: any = await sql`select clinica_id, conocimiento
        from configuracion_automatizaciones`.execute(trx);

    // (La consulta de citas futuras murió con la condición anotada de
    //  citados, 18-08: un citado ya no es cola — su recordatorio vive en
    //  Envíos y «¿quién viene?» es la agenda.)

    return {
      leads,
      presupuestos,
      pacientes,
      mensajes: (m.rows ?? []) as { telefono: string; ultimo_entrante: Date | null; ultimo_saliente: Date | null }[],
      eventos: (ev.rows ?? []) as { caso_id: string; evento: string; causa_derivacion: CausaDerivacion | null; clave_aplazado: string | null; hasta: Date | string | null; created_at: Date; evaluacion_json: unknown }[],
      configs: (cfg.rows ?? []) as { clinica_id: string | null; conocimiento: string | null }[],
    };
  });

  // ── El log del agente, agrupado por dígitos del hilo ──────────────────────
  type EstadoAgente = { entregadoCausa: CausaDerivacion | null; entregadoEn: string | null; aplazadosVivos: number; enEspera: boolean; evaluado: boolean; presupuestoReferidoId: string | null; telefono: string };
  const agentePorDigitos = new Map<string, EstadoAgente>();
  {
    const grupos = new Map<string, typeof datos.eventos>();
    for (const e of datos.eventos) {
      const k = dig(e.caso_id) || e.caso_id;
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(e);
    }
    for (const [k, evs] of grupos) {
      // Entregado: el último derivado sin resuelto_manual posterior. El cierre
      // por HECHOS del semáforo no se re-deriva aquí (costaría una consulta
      // por hilo): la cola lo enseña un pelín de más y la ficha —que sí mira
      // hechos— lo dice exacto. Se asume de más, jamás de menos.
      const derivados = evs.filter((x) => x.evento === "derivado");
      const ultimo = derivados[derivados.length - 1] ?? null;
      const resueltoDespues = ultimo
        ? evs.some((x) => x.evento === "resuelto_manual" && x.created_at > ultimo.created_at)
        : false;
      // Aplazados vivos: regla del posterior, por clave.
      const vivosPorClave = new Map<string, number>();
      for (const x of evs) {
        if (x.evento === "aplazado") vivosPorClave.set(x.clave_aplazado ?? "", (vivosPorClave.get(x.clave_aplazado ?? "") ?? 0) + 1);
        if (x.evento === "aplazado_resuelto") vivosPorClave.set(x.clave_aplazado ?? "", 0);
      }
      const aplazadosVivos = [...vivosPorClave.values()].reduce((s, n) => s + n, 0);
      const esperas = evs.filter((x) => x.evento === "espera_fijada");
      const ultimaEspera = esperas[esperas.length - 1] ?? null;
      const esperaLevantada = ultimaEspera
        ? evs.some((x) => x.evento === "espera_levantada" && x.created_at > ultimaEspera.created_at)
        : true;
      const hastaISO = ultimaEspera?.hasta
        ? ultimaEspera.hasta instanceof Date
          ? hoyISO(ultimaEspera.hasta)
          : String(ultimaEspera.hasta).slice(0, 10)
        : null;
      agentePorDigitos.set(k, {
        telefono: evs[0].caso_id,
        evaluado: evs.some((x) => x.evento === "evaluacion"),
        // El ÚLTIMO juicio que identificó de qué presupuesto se habla — un
        // turno sobre otra cosa (referido null) NO borra el último conocido.
        presupuestoReferidoId: (() => {
          for (let i = evs.length - 1; i >= 0; i--) {
            const x = evs[i] as { evento: string; evaluacion_json?: unknown };
            if (x.evento !== "evaluacion" || x.evaluacion_json == null) continue;
            try {
              const pj = JSON.parse(String(x.evaluacion_json));
              if (pj?.presupuestoReferidoId) return String(pj.presupuestoReferidoId);
            } catch { /* payload ilegible: se ignora, no se inventa */ }
          }
          return null;
        })(),
        entregadoCausa: ultimo && !resueltoDespues ? ultimo.causa_derivacion : null,
        entregadoEn: ultimo && !resueltoDespues ? ultimo.created_at.toISOString() : null,
        aplazadosVivos,
        enEspera: hastaISO != null && !esperaLevantada && hastaISO >= hoy,
      });
    }
  }

  const mensajesPorDigitos = new Map<string, { entrante: string | null; saliente: string | null }>();
  for (const m of datos.mensajes) {
    const k = dig(m.telefono);
    const prev = mensajesPorDigitos.get(k);
    const entrante = m.ultimo_entrante ? m.ultimo_entrante.toISOString() : null;
    const saliente = m.ultimo_saliente ? m.ultimo_saliente.toISOString() : null;
    mensajesPorDigitos.set(k, {
      entrante: !prev?.entrante || (entrante && entrante > prev.entrante) ? entrante : prev.entrante,
      saliente: !prev?.saliente || (saliente && saliente > prev.saliente) ? saliente : prev.saliente,
    });
  }

  const buscarAgente = (tel: string | null | undefined): EstadoAgente | null => {
    const d = dig(tel);
    if (!d) return null;
    for (const [k, v] of agentePorDigitos) if (k.includes(d) || d.includes(k)) return v;
    return null;
  };

  const casos: CasoDeCola[] = [];
  const digitosCubiertos = new Set<string>();

  // El reloj de plazos, POR CLÍNICA (fase D grupo 4): umbrales y horario de
  // la configuración del agente; sin config (o rota — se loguea, §9), los
  // defaults de la casa. Conservador y visible: una config ilegible NUNCA
  // tumba la cola ni esconde un caso.
  const plazosPorClinica = new Map<string | null, ReturnType<typeof plazosParaReloj>>();
  const politicaPorClinica = new Map<string | null, ReturnType<typeof politicaCobro>>();
  for (const fila of datos.configs) {
    try {
      const con = parseConocimiento(fila.conocimiento ?? null);
      const clave = fila.clinica_id ? String(fila.clinica_id) : null;
      plazosPorClinica.set(clave, plazosParaReloj(con));
      politicaPorClinica.set(clave, politicaCobro(con));
    } catch (err) {
      console.error(
        `[cola] configuración de plazos ilegible (clínica ${fila.clinica_id ?? "global"}) — el caso corre con los defaults:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const politicaDe = (clinicaId: string | null) =>
    politicaPorClinica.get(clinicaId) ?? politicaPorClinica.get(null) ?? POLITICA_COBRO_DEFAULT;
  const relojDe = (clinicaId: string | null): RelojDePlazos => {
    const p = plazosPorClinica.get(clinicaId) ?? plazosPorClinica.get(null);
    if (!p) return { minutosLaborablesDesde: (iso) => minutosLaborablesEntre(new Date(iso), ahora) };
    return {
      minutosLaborablesDesde: (iso) => minutosLaborablesEntre(new Date(iso), ahora, p.horario ?? undefined),
      umbralesMin: p.umbralesMin,
    };
  };

  const clasificar = (args: {
    tipoCaso: "lead" | "presupuesto" | "conversacion";
    telefono: string | null;
    /** La clínica del caso — decide QUÉ reloj mide sus plazos (grupo 4). */
    clinicaId?: string | null;
    automatizacion?: EstadoAutomatizacion | null;
    creadoAt: Date | string | null;
    /** UMBRAL_REACTIVACION_DIAS.lead|presupuesto — el del tipo del caso. */
    umbralDias: number;
  }) => {
    const men = mensajesPorDigitos.get(dig(args.telefono)) ?? { entrante: null, saliente: null };
    const conversacion = estadoConversacion(
      entradaDesdeMensajes([
        ...(men.entrante ? [{ direccion: "Entrante", timestamp: men.entrante }] : []),
        ...(men.saliente ? [{ direccion: "Saliente", timestamp: men.saliente }] : []),
      ]),
      args.umbralDias,
      ahora,
    ).estado;
    const agente = buscarAgente(args.telefono);
    const r = cohorteDeCaso(
      {
        tipoCaso: args.tipoCaso,
        conversacion,
        automatizacion: args.automatizacion ?? null,
        hoy,
        agente: agente ? { entregadoCausa: agente.entregadoCausa, aplazadosVivos: agente.aplazadosVivos } : null,
        enEspera: agente?.enEspera ?? false,
        ultimoEntranteISO: men.entrante,
        ultimoSalienteISO: men.saliente,
        entregadoEnISO: agente?.entregadoEn ?? null,
        creadoISO: args.creadoAt ? new Date(args.creadoAt).toISOString() : null,
      },
      relojDe(args.clinicaId ?? null),
    );
    if (!r) return null; // no es cola de trabajo (Mensajería / Envíos / Tablas)
    const ultimoToque = [men.entrante, men.saliente].filter(Boolean).sort().pop() ?? null;
    const desde = ultimoToque ?? (args.creadoAt ? new Date(args.creadoAt).toISOString() : null);
    const paradoDias = desde ? Math.max(0, diasDeClinicaEntre(new Date(desde), ahora)) : 0;
    return { ...r, paradoDias, enEspera: agente?.enEspera ?? false, conversacion };
  };

  // 1 · Presupuestos abiertos, AGRUPADOS POR CONVERSACIÓN (21-08, dictado):
  //     un paciente con dos presupuestos vivos es UN caso con dos documentos
  //     — el caso es la conversación, no el papel. El ACTIVO lo decide la
  //     conversación (elegirPresupuestoActivo: juicio del evaluador > señal
  //     del clasificador > el más reciente — y la fuente SE DECLARA). La
  //     cohorte del caso es LA PEOR de sus miembros: se asume de más, jamás
  //     de menos. (La cola de ENVÍOS sigue por documento a propósito: la
  //     cadencia es del papel; el caso, de la persona.)
  const pacientesPorId = new Map(datos.pacientes.map((p) => [p.id, p]));
  type MiembroPresupuesto = {
    pr: (typeof datos.presupuestos)[number];
    telefono: string | null;
    k: ReturnType<typeof clasificar>;
    conSenal: boolean;
  };
  const grupos = new Map<string, MiembroPresupuesto[]>();
  for (const pr of datos.presupuestos) {
    const pac = pr.paciente_id ? pacientesPorId.get(pr.paciente_id) : null;
    const telefono = pr.paciente_telefono ?? pac?.telefono ?? null;
    const men = mensajesPorDigitos.get(dig(telefono)) ?? { entrante: null, saliente: null };
    const convPr = estadoConversacion(
      entradaDesdeMensajes([
        ...(men.entrante ? [{ direccion: "Entrante", timestamp: men.entrante }] : []),
        ...(men.saliente ? [{ direccion: "Saliente", timestamp: men.saliente }] : []),
      ]),
      UMBRAL_REACTIVACION_DIAS.presupuesto,
      ahora,
    ).estado;
    const autom = estadoAutomatizacion({
      cerrado: false, // la consulta ya filtra ACEPTADO/PERDIDO
      conversacion: convPr,
      intencion: (pr.intencion_detectada ?? null) as IntencionDetectada | null,
      requierePersona: pr.requiere_persona,
      toques: Number(pr.contact_count ?? 0),
      toquesAntesDeAgotar: umbralToques,
      ultimoEvento: evPresupuesto.get(pr.id) ?? null,
    }).estado;
    const k = clasificar({
      tipoCaso: "presupuesto",
      telefono,
      clinicaId: pr.clinica_id == null ? null : String(pr.clinica_id),
      automatizacion: autom,
      creadoAt: pr.fecha ?? pr.created_at,
      umbralDias: UMBRAL_REACTIVACION_DIAS.presupuesto,
    });
    // El teléfono queda cubierto AUNQUE el presupuesto no entre en cola: el
    // dedupe presupuesto>lead es del caso, no de su cohorte.
    if (telefono) digitosCubiertos.add(dig(telefono));
    const clave = dig(telefono) || `sin-tel:${pr.id}`;
    const conSenal = pr.requiere_persona === true || pr.intencion_detectada != null;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push({ pr, telefono, k, conSenal });
  }

  const RANGO_PEOR: Record<Cohorte, number> = { fuera_de_plazo: 3, necesita_respuesta: 2, listos_para_cerrar: 1 };
  for (const miembros of grupos.values()) {
    const enCola = miembros.filter((m) => m.k != null);
    if (enCola.length === 0) continue; // ninguno exige persona → no es cola
    const peor = enCola.reduce((a, b) => (RANGO_PEOR[b.k!.cohorte] > RANGO_PEOR[a.k!.cohorte] ? b : a));
    const telefono = miembros[0].telefono;
    const agente = buscarAgente(telefono);
    const fechaISO = (pr: MiembroPresupuesto["pr"]): string | null => {
      const f = pr.fecha ?? pr.created_at;
      return f ? new Date(f).toISOString() : null;
    };
    const eleccion = elegirPresupuestoActivo(
      miembros.map((m) => ({
        id: String(m.pr.id),
        importe: m.pr.importe == null ? null : Number(m.pr.importe),
        tratamiento: m.pr.tratamiento_nombre ?? null,
        fechaISO: fechaISO(m.pr),
        conSenalClasificador: m.conSenal,
      })),
      { referidoId: agente?.presupuestoReferidoId ?? null },
    )!;
    const activo = miembros.find((m) => String(m.pr.id) === eleccion.activo.id)!;
    const pacActivo = activo.pr.paciente_id ? pacientesPorId.get(activo.pr.paciente_id) : null;
    casos.push({
      id: `presupuesto:${eleccion.activo.id}`,
      tipo: "presupuesto",
      telefono,
      nombre: pacActivo?.nombre ?? "Paciente",
      clinicaId: activo.pr.clinica_id == null ? null : String(activo.pr.clinica_id),
      cohorte: peor.k!.cohorte,
      detalle: peor.k!.detalle,
      importe: eleccion.activo.importe,
      importeTotal: miembros.reduce((sum, m) => sum + (m.pr.importe == null ? 0 : Number(m.pr.importe)), 0),
      otrosPresupuestos: eleccion.otros.map((o) => ({ id: o.id, importe: o.importe, tratamiento: o.tratamiento })),
      activoFuente: eleccion.fuente,
      tratamiento: eleccion.activo.tratamiento,
      origen: null,
      paradoDias: peor.k!.paradoDias,
      esperandoMinLaborables: peor.k!.esperandoMinLaborables,
      enEspera: peor.k!.enEspera,
      evaluado: agente?.evaluado ?? false,
      cobro: null,
    });
  }

  // 2 · Leads activos sin presupuesto en la cola.
  for (const l of datos.leads) {
    if (!esLeadActivo(String(l.estado ?? ""))) continue;
    const d = dig(l.telefono);
    if (d && digitosCubiertos.has(d)) continue;
    const menL = mensajesPorDigitos.get(d) ?? { entrante: null, saliente: null };
    const convL = estadoConversacion(
      entradaDesdeMensajes([
        ...(menL.entrante ? [{ direccion: "Entrante", timestamp: menL.entrante }] : []),
        ...(menL.saliente ? [{ direccion: "Saliente", timestamp: menL.saliente }] : []),
      ]),
      UMBRAL_REACTIVACION_DIAS.lead,
      ahora,
    ).estado;
    const automL = estadoAutomatizacion({
      cerrado: false,
      conversacion: convL,
      intencion: null, // los leads no se clasifican (recorte declarado fase 1)
      requierePersona: null,
      toques: Number(l.whatsapp_enviados ?? 0),
      toquesAntesDeAgotar: umbralToques,
      ultimoEvento: evLead.get(l.id) ?? null,
    }).estado;
    const k = clasificar({ tipoCaso: "lead", telefono: l.telefono, clinicaId: l.clinica_id == null ? null : String(l.clinica_id), automatizacion: automL, creadoAt: l.created_at, umbralDias: UMBRAL_REACTIVACION_DIAS.lead });
    if (d) digitosCubiertos.add(d);
    if (!k) continue;
    casos.push({
      id: `lead:${l.id}`,
      tipo: "lead",
      telefono: l.telefono,
      nombre: l.nombre,
      clinicaId: l.clinica_id == null ? null : String(l.clinica_id),
      cohorte: k.cohorte,
      detalle: k.detalle,
      importe: null,
      tratamiento: l.tratamiento_interes ?? null,
      origen: l.canal_captacion ?? null,
      paradoDias: k.paradoDias,
      esperandoMinLaborables: k.esperandoMinLaborables,
      enEspera: k.enEspera,
      evaluado: buscarAgente(l.telefono)?.evaluado ?? false,
      importeTotal: null,
      otrosPresupuestos: [],
      activoFuente: null,
      cobro: null,
    });
  }

  // 3 · Casos de conversación del agente que no son ni lead ni presupuesto
  //     (huérfanos con eventos): también son cola.
  for (const [k, a] of agentePorDigitos) {
    if ([...digitosCubiertos].some((d) => d.includes(k) || k.includes(d))) continue;
    if (a.entregadoCausa == null && a.aplazadosVivos === 0) continue;
    const kk = clasificar({ tipoCaso: "conversacion", telefono: a.telefono, creadoAt: null, umbralDias: UMBRAL_REACTIVACION_DIAS.presupuesto });
    if (!kk) continue;
    casos.push({
      id: `conversacion:${a.telefono}`,
      tipo: "conversacion",
      telefono: a.telefono,
      nombre: a.telefono,
      clinicaId: null,
      cohorte: kk.cohorte,
      detalle: kk.detalle,
      importe: null,
      tratamiento: null,
      origen: null,
      paradoDias: kk.paradoDias,
      esperandoMinLaborables: kk.esperandoMinLaborables,
      enEspera: kk.enEspera,
      evaluado: a.evaluado,
      importeTotal: null,
      otrosPresupuestos: [],
      activoFuente: null,
      cobro: null,
    });
  }

  // 4 · COBROS VENCIDOS (F5): la política de cobro de cada clínica decide
  //     cuándo un pago pasa a la cola. MISMA derivación que /tablas/cobros y
  //     el dashboard (calcularCobrosPorPaciente) — cero cálculo paralelo. El
  //     caso es la conversación: si el teléfono ya tiene caso, el cobro se
  //     ANEXA (dos objetivos, una card) y la cohorte queda en la peor; solo
  //     el vencido sin caso crea uno nuevo (tipo "cobro").
  {
    const [pacientesCompletos, pagos, presupRaw, opciones] = await Promise.all([
      listPacientes({}),
      listPagosResumen(),
      selectPresupuestosRaw({
        fields: ["Paciente", "Estado", "Importe", "Fecha_Aceptado", "FechaAlta", "Tratamiento_nombre"],
      }),
      listAllOpciones(),
    ]);
    const cobros = calcularCobrosPorPaciente({
      pacientes: pacientesCompletos,
      presupuestos: presupRaw as any,
      pagos,
      opciones,
      ahoraMs: ahora.getTime(),
    });
    const pacCompletoPorId = new Map(pacientesCompletos.map((pc) => [pc.id, pc]));
    const casoPorDigitos = new Map<string, CasoDeCola>();
    for (const c of casos) {
      const d = dig(c.telefono);
      if (d) casoPorDigitos.set(d, c);
    }
    for (const cb of cobros) {
      const r = cohorteDeCobro({
        pendiente: cb.pendiente,
        diasVencido: cb.diasVencido,
        tieneLiquidacion: cb.tieneLiquidacion,
        politica: politicaDe(cb.clinicaId),
      });
      if (!r) continue;
      const pac = pacCompletoPorId.get(cb.pacienteId);
      const d = dig(pac?.telefono);
      const objetivo = { pacienteId: cb.pacienteId, pendiente: cb.pendiente, diasVencido: cb.diasVencido! };
      const existente = d ? casoPorDigitos.get(d) : undefined;
      if (existente) {
        // UN caso, dos objetivos. La cohorte se queda con LA PEOR; si el
        // cobro la empeora, el detalle lo dice.
        existente.cobro = objetivo;
        if (RANGO_PEOR[r.cohorte] > RANGO_PEOR[existente.cohorte]) {
          existente.cohorte = r.cohorte;
          existente.detalle = r.detalle;
        }
        continue;
      }
      casos.push({
        id: `cobro:${cb.pacienteId}`,
        tipo: "cobro",
        telefono: pac?.telefono ?? null,
        nombre: pac?.nombre ?? "Paciente",
        clinicaId: cb.clinicaId,
        cohorte: r.cohorte,
        detalle: r.detalle,
        importe: null,
        tratamiento: cb.tratamientos.length ? cb.tratamientos.join(", ") : null,
        origen: null,
        // El cobro lleva parado lo que lleva vencido — días de la clínica.
        paradoDias: cb.diasVencido!,
        esperandoMinLaborables: null,
        enEspera: false,
        evaluado: d ? (buscarAgente(pac?.telefono ?? null)?.evaluado ?? false) : false,
        importeTotal: null,
        otrosPresupuestos: [],
        activoFuente: null,
        cobro: objetivo,
      });
    }
  }

  // ── La cabecera: dinero PARADO EN LA COLA — hechos, nunca estimaciones ───
  // Solo suma lo que espera a una PERSONA (los casos de la cola). Lo que
  // trabaja el agente o la cadencia no está parado por nosotros — el total
  // de presupuestos abiertos ya vive en /presupuestos y /red.
  const dineroPresupuestos = casos
    .filter((c) => c.tipo === "presupuesto")
    .reduce((s, c) => s + (c.importeTotal ?? c.importe ?? 0), 0);
  const dineroCobros = casos.reduce((s2, c) => s2 + (c.cobro?.pendiente ?? 0), 0);
  const resumen: ResumenCola = {
    dineroParado: dineroPresupuestos,
    dineroPresupuestos,
    dineroCobros,
    leadsSinImporte: casos.filter((c) => c.tipo === "lead").length,
    masViejoDias: casos.length ? Math.max(...casos.map((c) => c.paradoDias)) : null,
  };

  return { casos, resumen };
}


