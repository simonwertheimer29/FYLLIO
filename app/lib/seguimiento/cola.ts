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
import { minutosLaborablesEntre } from "./tiempo-laborable";

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
  | "nuevo_sin_contactar";

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

export const OBLIGACION_DE_DETALLE: Record<DetalleCohorte, ObligacionPlazo> = {
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
function desdeDeObligacion(detalle: DetalleCohorte, e: EntradaCohorte): string | null {
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

function cohorteBase(e: EntradaCohorte): { cohorte: Exclude<Cohorte, "fuera_de_plazo">; detalle: DetalleCohorte } | null {
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

// ─── La cola con datos ──────────────────────────────────────────────────────

export type CasoDeCola = {
  /** lead:<id> · presupuesto:<id> · conversacion:<telefono> */
  id: string;
  tipo: "lead" | "presupuesto" | "conversacion";
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
  /** Borrador del motor (solo presupuestos, si existe) — P3: se precarga en
   *  el chat embebido para que el envío quede MEDIDO contra lo que la
   *  persona realmente vio y editó. */
  mensajeSugerido: string | null;
  /** El agente evaluó este hilo (hay evento `evaluacion` en el log) — B3:
   *  gobierna el botón «Redactar entrada»; sin evaluación, sin botón. */
  evaluado: boolean;
};

export type ResumenCola = {
  /** € parados EN LA COLA = presupuestos que esperan a una persona. Lo que
   *  trabaja el agente o la cadencia no está «parado por nosotros». */
  dineroParado: number;
  dineroPresupuestos: number;
  /** Los leads no tienen importe: HECHO, no estimación — se cuentan. */
  leadsSinImporte: number;
  masViejoDias: number | null;
};

export async function colaDeSeguimiento(opts?: { hoy?: string }): Promise<{
  casos: CasoDeCola[];
  resumen: ResumenCola;
}> {
  const cliente = requireCliente("colaDeSeguimiento");
  const hoy = opts?.hoy ?? hoyISO();
  const ahora = new Date(`${hoy}T12:00:00Z`);
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
      .select(["id", "paciente_id", "paciente_telefono", "tratamiento_nombre", "estado", "importe", "clinica_id", "fecha", "created_at", "requiere_persona", "intencion_detectada", "contact_count", "fase_seguimiento", "mensaje_sugerido"])
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
    const ev: any = await sql`select caso_id, evento, causa_derivacion, clave_aplazado, hasta, created_at
        from eventos_automatizacion
        where tipo_caso = 'conversacion'
          and evento in ('derivado','resuelto_manual','asumido_manual','soltado','espera_fijada','espera_levantada','aplazado','aplazado_resuelto','evaluacion')
        order by created_at asc`.execute(trx);

    // (La consulta de citas futuras murió con la condición anotada de
    //  citados, 18-08: un citado ya no es cola — su recordatorio vive en
    //  Envíos y «¿quién viene?» es la agenda.)

    return {
      leads,
      presupuestos,
      pacientes,
      mensajes: (m.rows ?? []) as { telefono: string; ultimo_entrante: Date | null; ultimo_saliente: Date | null }[],
      eventos: (ev.rows ?? []) as { caso_id: string; evento: string; causa_derivacion: CausaDerivacion | null; clave_aplazado: string | null; hasta: Date | string | null; created_at: Date }[],
    };
  });

  // ── El log del agente, agrupado por dígitos del hilo ──────────────────────
  type EstadoAgente = { entregadoCausa: CausaDerivacion | null; entregadoEn: string | null; aplazadosVivos: number; enEspera: boolean; evaluado: boolean; telefono: string };
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

  // El reloj de plazos, uno para toda la pasada: minutos LABORABLES hasta
  // `ahora` con el horario default de la casa (el de cada clínica llega con
  // la pantalla del agente, fase D).
  const reloj: RelojDePlazos = {
    minutosLaborablesDesde: (iso) => minutosLaborablesEntre(new Date(iso), ahora),
  };

  const clasificar = (args: {
    tipoCaso: "lead" | "presupuesto" | "conversacion";
    telefono: string | null;
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
      reloj,
    );
    if (!r) return null; // no es cola de trabajo (Mensajería / Envíos / Tablas)
    const ultimoToque = [men.entrante, men.saliente].filter(Boolean).sort().pop() ?? null;
    const desde = ultimoToque ?? (args.creadoAt ? new Date(args.creadoAt).toISOString() : null);
    const paradoDias = desde ? Math.max(0, diasDeClinicaEntre(new Date(desde), ahora)) : 0;
    return { ...r, paradoDias, enEspera: agente?.enEspera ?? false, conversacion };
  };

  // 1 · Presupuestos abiertos (ganan al lead del mismo teléfono).
  const pacientesPorId = new Map(datos.pacientes.map((p) => [p.id, p]));
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
      automatizacion: autom,
      creadoAt: pr.fecha ?? pr.created_at,
      umbralDias: UMBRAL_REACTIVACION_DIAS.presupuesto,
    });
    // El teléfono queda cubierto AUNQUE el presupuesto no entre en cola: el
    // dedupe presupuesto>lead es del caso, no de su cohorte.
    if (telefono) digitosCubiertos.add(dig(telefono));
    if (!k) continue;
    casos.push({
      id: `presupuesto:${pr.id}`,
      tipo: "presupuesto",
      telefono,
      nombre: pac?.nombre ?? "Paciente",
      clinicaId: pr.clinica_id == null ? null : String(pr.clinica_id),
      cohorte: k.cohorte,
      detalle: k.detalle,
      importe: pr.importe == null ? null : Number(pr.importe),
      tratamiento: pr.tratamiento_nombre ?? null,
      origen: null,
      paradoDias: k.paradoDias,
      esperandoMinLaborables: k.esperandoMinLaborables,
      enEspera: k.enEspera,
      mensajeSugerido: pr.mensaje_sugerido ?? null,
      evaluado: buscarAgente(telefono)?.evaluado ?? false,
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
    const k = clasificar({ tipoCaso: "lead", telefono: l.telefono, automatizacion: automL, creadoAt: l.created_at, umbralDias: UMBRAL_REACTIVACION_DIAS.lead });
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
      mensajeSugerido: null,
      evaluado: buscarAgente(l.telefono)?.evaluado ?? false,
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
      mensajeSugerido: null,
      evaluado: a.evaluado,
    });
  }

  // ── La cabecera: dinero PARADO EN LA COLA — hechos, nunca estimaciones ───
  // Solo suma lo que espera a una PERSONA (los casos de la cola). Lo que
  // trabaja el agente o la cadencia no está parado por nosotros — el total
  // de presupuestos abiertos ya vive en /presupuestos y /red.
  const dineroPresupuestos = casos
    .filter((c) => c.tipo === "presupuesto" && c.importe != null)
    .reduce((s, c) => s + (c.importe ?? 0), 0);
  const resumen: ResumenCola = {
    dineroParado: dineroPresupuestos,
    dineroPresupuestos,
    leadsSinImporte: casos.filter((c) => c.tipo === "lead").length,
    masViejoDias: casos.length ? Math.max(...casos.map((c) => c.paradoDias)) : null,
  };

  return { casos, resumen };
}


