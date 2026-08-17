// app/lib/seguimiento/cola.ts
//
// LA COLA DE SEGUIMIENTO (fase B, P1 — mapeo corregido el 17-08).
//
// LAS COHORTES SON CUATRO Y NO CRECEN (dictado): Necesita respuesta ·
// Listos para cerrar · Pendientes de resolver · Sin actividad. La cola
// contesta UNA pregunta —¿qué me toca ahora?— y todo lo demás
// (lead/presupuesto, doctor, tratamiento, origen, citado, agotado…) es
// FILTRO sobre las cuatro, nunca una quinta categoría.
//
// El mapeo de las cohortes viejas, bajo esa regla:
//   quiebre                → Necesita respuesta
//   en conversación        → Necesita respuesta SI el paciente escribió lo
//                            último (pendiente_responder) — en modo A un
//                            paciente esperando ES trabajo; si esperamos
//                            NOSOTROS su respuesta (en_espera_paciente), no
//                            hay nada que hacer AHORA → Sin actividad.
//   cierra y anota         → Listos para cerrar
//   entregas del agente    → causa caso_completo → Listos para cerrar;
//                            resto de causas (urgencia, queja, insistencia,
//                            antecedente) → Necesita respuesta («rompió de
//                            verdad» del §3).
//   aplazados vivos        → Pendientes de resolver (el agente sigue)
//   toca llamar (agotado)  → Sin actividad (§3 lo dice explícito)
//   sin respuesta          → Sin actividad
//   nuevos sin contactar   → Sin actividad (con su señal de urgencia)
//   citados                → Sin actividad — CONDICIÓN ANOTADA (17-08): se
//                            quedan en la cola HASTA QUE EXISTA la pantalla
//                            que recoja confirmar/recordar citas; ese
//                            trabajo no puede quedarse sin vivir en ninguna
//                            parte. Cuando exista, salen a filtro.
//
// La partición es TOTAL POR CONSTRUCCIÓN: guardas en el orden del §3
// (Necesita > Listos > Pendientes) y Sin actividad como residual — el mismo
// mecanismo que sostiene la invariante de la lib vieja, vigilado por
// qa:cola. La lib vieja (cohortes.ts) NO se toca aquí: LeadsView,
// Intervención y /red siguen sobre ella hasta P4.
//
// Módulo con dos capas: `cohorteDeCaso` PURA (client-safe, la prueba el QA
// sin base) y `colaDeSeguimiento` con datos (solo servidor).

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

// ─── Las cuatro. No crecen. ─────────────────────────────────────────────────

export type Cohorte =
  | "necesita_respuesta"
  | "listos_para_cerrar"
  | "pendientes_de_resolver"
  | "sin_actividad";

export const ORDEN_COHORTES: readonly Cohorte[] = [
  "necesita_respuesta",
  "listos_para_cerrar",
  "pendientes_de_resolver",
  "sin_actividad",
];

export const ETIQUETA_COHORTE: Record<Cohorte, string> = {
  necesita_respuesta: "Necesita respuesta",
  listos_para_cerrar: "Listos para cerrar",
  pendientes_de_resolver: "Pendientes de resolver",
  sin_actividad: "Sin actividad",
};

/** El PORQUÉ dentro de la cohorte — para la card y los FILTROS, jamás una
 *  quinta cohorte. */
export type DetalleCohorte =
  | "quebrado"
  | "paciente_escribio"
  | "entregado_urgente"
  | "entregado_listo"
  | "cierre_pendiente"
  | "aplazados_vivos"
  | "citado"
  | "agotado"
  | "nuevo_sin_contactar"
  | "sin_respuesta"
  | "esperando_al_paciente";

// ─── La función pura: un caso, una cohorte, siempre ────────────────────────

export type EntradaCohorte = {
  conversacion: EstadoConversacion;
  /** Del clasificador viejo (compat 93/94, sigue vivo hasta que Simon
   *  encienda el evaluador): quebrado/agotado/cierre_pendiente. */
  automatizacion?: EstadoAutomatizacion | null;
  /** Cita futura (leads y pacientes) — condición anotada de citados. */
  fechaCita?: string | null;
  hoy: string;
  /** Del LOG del agente, por teléfono (contado por el caller, no juzgado). */
  agente?: {
    entregadoCausa: CausaDerivacion | null;
    aplazadosVivos: number;
  } | null;
};

export function cohorteDeCaso(e: EntradaCohorte): { cohorte: Cohorte; detalle: DetalleCohorte } {
  // 1 · NECESITA RESPUESTA — lo único que interrumpe (§3), en su orden.
  if (e.automatizacion === "quebrado") return { cohorte: "necesita_respuesta", detalle: "quebrado" };
  if (e.agente?.entregadoCausa && e.agente.entregadoCausa !== "caso_completo") {
    return { cohorte: "necesita_respuesta", detalle: "entregado_urgente" };
  }
  if (e.conversacion === "pendiente_responder") {
    return { cohorte: "necesita_respuesta", detalle: "paciente_escribio" };
  }

  // 2 · LISTOS PARA CERRAR — el agente terminó; aquí estará el volumen.
  if (e.agente?.entregadoCausa === "caso_completo") {
    return { cohorte: "listos_para_cerrar", detalle: "entregado_listo" };
  }
  if (e.automatizacion === "cierre_pendiente") {
    return { cohorte: "listos_para_cerrar", detalle: "cierre_pendiente" };
  }

  // 3 · PENDIENTES DE RESOLVER — el agente aplazó algo y SIGUE trabajando.
  if ((e.agente?.aplazadosVivos ?? 0) > 0) {
    return { cohorte: "pendientes_de_resolver", detalle: "aplazados_vivos" };
  }

  // 4 · SIN ACTIVIDAD — el residual. El detalle alimenta filtros y señales,
  //     nunca una cohorte nueva.
  if (e.fechaCita && e.fechaCita >= e.hoy) return { cohorte: "sin_actividad", detalle: "citado" };
  if (e.automatizacion === "agotado") return { cohorte: "sin_actividad", detalle: "agotado" };
  switch (e.conversacion) {
    case "sin_conversacion":
      return { cohorte: "sin_actividad", detalle: "nuevo_sin_contactar" };
    case "en_espera_paciente":
      return { cohorte: "sin_actividad", detalle: "esperando_al_paciente" };
    case "reactivable":
      return { cohorte: "sin_actividad", detalle: "sin_respuesta" };
  }
  // Inalcanzable: pendiente_responder salió en la guarda 1. El `never` de
  // abajo mantiene la TOTALIDAD — un valor nuevo de EstadoConversacion rompe
  // la compilación aquí en vez de colarse en silencio.
  return exhaustivo(e.conversacion);
}

function exhaustivo(x: never): never {
  throw new Error(`EstadoConversacion sin cohorte: ${String(x)}`);
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
  /** Espera vigente («sin contacto hasta») — la card lo señala. */
  enEspera: boolean;
};

export type ResumenCola = {
  /** € parados en la cola = suma de importes de presupuestos abiertos. */
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
    const ev: any = await sql`select caso_id, evento, causa_derivacion, clave_aplazado, hasta, created_at
        from eventos_automatizacion
        where tipo_caso = 'conversacion'
          and evento in ('derivado','resuelto_manual','asumido_manual','soltado','espera_fijada','espera_levantada','aplazado','aplazado_resuelto')
        order by created_at asc`.execute(trx);

    // Citas futuras por paciente (condición anotada de citados).
    const c: any = await sql`select distinct paciente_id from citas
        where paciente_id is not null and hora_inicio >= now()`.execute(trx);

    return {
      leads,
      presupuestos,
      pacientes,
      mensajes: (m.rows ?? []) as { telefono: string; ultimo_entrante: Date | null; ultimo_saliente: Date | null }[],
      eventos: (ev.rows ?? []) as { caso_id: string; evento: string; causa_derivacion: CausaDerivacion | null; clave_aplazado: string | null; hasta: Date | string | null; created_at: Date }[],
      conCitaFutura: new Set(((c.rows ?? []) as { paciente_id: string }[]).map((x) => String(x.paciente_id))),
    };
  });

  // ── El log del agente, agrupado por dígitos del hilo ──────────────────────
  type EstadoAgente = { entregadoCausa: CausaDerivacion | null; aplazadosVivos: number; enEspera: boolean; telefono: string };
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
        entregadoCausa: ultimo && !resueltoDespues ? ultimo.causa_derivacion : null,
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

  const clasificar = (args: {
    telefono: string | null;
    automatizacion?: EstadoAutomatizacion | null;
    fechaCita?: string | null;
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
    const r = cohorteDeCaso({
      conversacion,
      automatizacion: args.automatizacion ?? null,
      fechaCita: args.fechaCita ?? null,
      hoy,
      agente: agente ? { entregadoCausa: agente.entregadoCausa, aplazadosVivos: agente.aplazadosVivos } : null,
    });
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
      telefono,
      automatizacion: autom,
      fechaCita: pr.paciente_id && datos.conCitaFutura.has(String(pr.paciente_id)) ? hoy : null,
      creadoAt: pr.fecha ?? pr.created_at,
      umbralDias: UMBRAL_REACTIVACION_DIAS.presupuesto,
    });
    if (telefono) digitosCubiertos.add(dig(telefono));
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
      enEspera: k.enEspera,
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
    const k = clasificar({ telefono: l.telefono, automatizacion: automL, fechaCita: l.fecha_cita, creadoAt: l.created_at, umbralDias: UMBRAL_REACTIVACION_DIAS.lead });
    if (d) digitosCubiertos.add(d);
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
      enEspera: k.enEspera,
    });
  }

  // 3 · Casos de conversación del agente que no son ni lead ni presupuesto
  //     (huérfanos con eventos): también son cola.
  for (const [k, a] of agentePorDigitos) {
    if ([...digitosCubiertos].some((d) => d.includes(k) || k.includes(d))) continue;
    if (a.entregadoCausa == null && a.aplazadosVivos === 0) continue;
    const kk = clasificar({ telefono: a.telefono, creadoAt: null, umbralDias: UMBRAL_REACTIVACION_DIAS.presupuesto });
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
      enEspera: kk.enEspera,
    });
  }

  // ── La cabecera: dinero PARADO — hechos, nunca estimaciones ──────────────
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


