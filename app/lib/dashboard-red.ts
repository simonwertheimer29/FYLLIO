// Dashboard de manager (Bloque 2, 2026-07-23) — cálculo ÚNICO y derivado.
//
// Responde en orden: ¿dónde pierdo dinero ahora? ¿cómo va el negocio?
// ¿qué clínica sube y cuál baja? ¿progresamos?
//
// TODO deriva de los registros reales (presupuestos, pagos, leads, hilo,
// historial) por las MISMAS funciones de las colas:
//   - reactivables → conversacionDePresupuesto (la de la cola de intervención)
//   - vencidos     → calcularCobrosPorPaciente (la de la cola de cobros)
//   - sin contacto → estadoConversacion sobre hilo+acciones (la de Actuar hoy)
//   - perdidos/mes → historial cambio_estado→PERDIDO (decisión 2026-07-23;
//                    los antiguos sin historial se cuentan aparte, honesto)
// Cero cachés nuevas y cero lecturas de las columnas en deprecación (nº 28).
//
// Server-only. Corre dentro del contexto de cliente (runWithCliente) del
// caller — el tenant lo garantiza RLS como en todos los repos.

import { listLeads } from "./leads/leads";
import { listPacientes } from "./pacientes/pacientes";
import { listClinicas } from "./auth/users";
import { currentCliente } from "./airtable";
import { selectPresupuestosRaw } from "./presupuestos/repo";
import { listPagosResumen } from "./pagos";
import { listAllOpciones } from "./configuraciones/configuraciones";
import { ultimosMensajesPorConversacion } from "./presupuestos/mensajeria";
import { colaDeSeguimiento } from "./seguimiento/cola";
import { ultimasAccionesDireccionPorLead } from "./leads/acciones";
import { esIntencionDeCierre } from "./presupuestos/intenciones";
import { conversacionDePresupuesto } from "./presupuestos/conversacion-presupuesto";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_DIAS,
} from "./presupuestos/estado-conversacion";
import { calcularCobrosPorPaciente } from "./cobros";
import { fechasPerdidaPorPresupuesto } from "./historial/registrar";
import { esLeadActivo } from "./leads/pipeline";
import { citaDelLead, citasPorPacienteDeLeads } from "./leads/cita";
import { hoyISO, mesISO } from "./time";
import { catalogoTiposPaciente } from "./pacientes/tipos-paciente";

/** Comparación contra el MISMO TRAMO del mes anterior (días 1..hoy).
 *  Un mes a medias no se compara nunca contra uno entero: el día 3 todos los
 *  deltas dirían "−90%" (pasada visual 2026-07-27). */
export type CifraDelta = { valor: number; previo: number };

/** Conversión medida sobre la COHORTE de presentación: numerador y denominador
 *  son LOS MISMOS presupuestos. Antes el numerador contaba por fecha de
 *  aceptación y el denominador por fecha de alta — dos conjuntos distintos, con
 *  una etiqueta ("de los presentados, aceptados") que prometía el ratio de
 *  cohorte que la fórmula no calculaba; podía pasar del 100%.
 *
 *  `abiertos` es la parte de la cohorte que todavía no ha decidido. Mientras
 *  pese más que UMBRAL_COHORTE_ABIERTA la comparación no existe: en julio, 28
 *  de 48 presupuestos seguían en el aire y el 29% resultante se leía como un
 *  desplome frente a meses ya resueltos al 100%. */
export type ConversionCohorte = {
  pct: number | null;
  pctPrevio: number | null;
  presentados: number;
  presentadosPrevio: number;
  aceptados: number;
  aceptadosPrevio: number;
  /** De la cohorte del mes en curso, cuántos siguen sin decidirse. */
  abiertos: number;
  /** false → la cohorte aún está madurando: se muestra el % pero SIN delta. */
  comparable: boolean;
  /** true → el denominador es demasiado corto para leer un porcentaje. */
  muestraCorta: boolean;
};

/** Denominador mínimo para que un porcentaje se pinte como señal (y para que
 *  una clínica pueda encabezar el ranking de caídas). Con 2 presupuestos, un
 *  100% es ruido con autoridad. */
export const BASE_MINIMA_COHORTE = 5;
/** Parte de la cohorte que puede seguir abierta sin invalidar la comparación. */
export const UMBRAL_COHORTE_ABIERTA = 0.2;

export type RiesgoItem = {
  tipo: "reactivables" | "vencidos" | "sin_contacto" | "cierre_sin_accion";
  n: number;
  /** Σ € en juego (null para conteos sin importe). */
  importe: number | null;
  /** Titular de 3-5 palabras: el QUÉ en lenguaje de negocio, sin jerga. */
  titulo: string;
  /** Línea de detalle: el contexto completo (de qué, por qué importa). */
  detalle: string;
  href: string;
};

/**
 * Aviso del DÍA: alguien con cita hoy ha escrito hoy.
 *
 * POR QUÉ NO ES UN `RiesgoItem` (decisión del 6 ago de 2026). No es trabajo
 * pendiente ni dinero en juego: es **información con caducidad de horas**. Un
 * «llego cinco minutos tarde» a las 09:55 no significa nada a las 12:00, y una
 * cohorte de la cola lo tendría ahí hasta que alguien lo marcara visto. Va a la
 * franja del día porque el destinatario es distinto: el de la cola es quien hace
 * seguimiento, el de esto es quien está en recepción ahora mismo.
 *
 * Y NO suma a `importeEnRiesgo`: no hay dinero en juego. Meterlo ahí movería el
 * titular por una razón que no es pérdida.
 */
export type AvisoHoyItem = {
  /** Nombre del paciente o lead. Nunca un id (§5 del estándar visual). */
  quien: string;
  /** Hora de su cita de hoy, "HH:MM" — o null si el dato no está. */
  horaCita: string | null;
  /**
   * Qué dijo, si la clasificación lo sabe («Logística», «Acuse de recibo»…).
   * `null` cuando el mensaje aún no está clasificado, que es lo normal mientras
   * el agente no esté operativo: entonces la señal sigue valiendo — «ha escrito»
   * ya es motivo para mirarlo si viene hoy.
   */
  deQueVa: string | null;
  href: string;
};

/** "Qué está funcionando" — SOLO agregados con umbral de materialidad;
 *  el logro anecdótico de un presupuesto suelto está prohibido (revisión
 *  2026-07-23). Números verificables, cero causalidad. */
export type ExitoItem = {
  tipo: "conversion" | "aceptado_semana" | "mejor_clinica" | "mejor_tratamiento";
  dato: string;
  /** Titular de 3-5 palabras. */
  titulo: string;
  /** Línea de detalle con el contexto. */
  detalle: string;
};

export type ClinicaFila = {
  id: string;
  nombre: string;
  /** Conversión de la COHORTE de presentación (misma regla que el negocio). */
  conversionPct: number | null;
  conversionPctPrevio: number | null;
  /** Crudos del ratio: la tabla los enseña cuando la muestra es corta. */
  presentadosMes: number;
  presentadosMesPrevio: number;
  aceptadosMes: number;
  aceptadosMesPrevio: number;
  aceptadoMes: number;
  aceptadoMesPrevio: number;
  /** Σ pendiente VENCIDO de la clínica (regla de cobros compartida). */
  vencido: number;
  /** Δ% € aceptado vs el mismo tramo del mes anterior; null si el previo es 0. */
  tendenciaPct: number | null;
  /** Pocos presupuestos en juego: ni pinta señal ni encabeza el ranking. */
  muestraCorta: boolean;
  /** Casos esperando a una persona en esta clínica. Fase C: sale de LA COLA
   *  de Seguimiento — el mismo cálculo que el filtro «necesitan de mí» de la
   *  bandeja y que las cohortes de /seguimiento. Es un número MAYOR que el
   *  viejo (incluye pendientes de responder y listos para cerrar, no solo
   *  quiebres/derivados): el viejo mentía por defecto.
   *
   *  `null` = no se pudo consultar, que NO es lo mismo que cero. Un cero
   *  inventado aquí diría «esta clínica lo lleva al día» sobre un fallo. */
  necesitanPersona: number | null;
};

/** Embudo de conversión sobre la COHORTE de leads captados en la ventana.
 *  Cada etapa es un SUBCONJUNTO de la anterior (mismos leads, no cuentas
 *  independientes), así que el embudo solo puede bajar.
 *
 *  La etapa "citados" entró con MEJORAS 50 (2026-07-27). Antes no estaba
 *  porque el dato parecía no existir: de los 79 leads convertidos, CERO tenían
 *  `fecha_cita`. Resultó que los 79 SÍ tenían citas reales en la agenda, a
 *  través de su paciente — faltaba el enlace, no el dato. Lo resuelve
 *  `lib/leads/cita` con su ventana de atribución. */
export type EmbudoEtapa = {
  clave: "captados" | "citados" | "pacientes" | "presupuesto" | "aceptado";
  etiqueta: string;
  /** Qué significa la etapa, en lenguaje de negocio. */
  detalle: string;
  n: number;
  /** % de la etapa ANTERIOR que llega aquí; null en la primera. */
  siguePct: number | null;
};

export type DashboardRed = {
  hoy: {
    riesgo: RiesgoItem[];
    exitos: ExitoItem[];
    /** Con cita hoy y ha escrito hoy — ver `AvisoHoyItem`. */
    avisos: AvisoHoyItem[];
    /** Σ € de las señales que tienen importe (los leads sin contactar no lo
     *  tienen). Titular de la franja: cuánto hay en juego hoy. */
    importeEnRiesgo: number;
    /** Clínicas distintas con al menos un caso en riesgo. */
    clinicasEnRiesgo: number;
  };
  negocio: {
    leads: {
      nuevosMes: CifraDelta;
      /** Leads en el pipeline AHORA — misma definición que /seguimiento y que
       *  la cabecera del tablero (lib/leads/pipeline). Antes contaba solo
       *  "Contactado": un tercer número para el mismo concepto. */
      enSeguimiento: number;
      citadosMes: CifraDelta;
      conversionMes: ConversionCohorte;
    };
    presupuestos: {
      presentadosMes: CifraDelta;
      presentadosImporteMes: CifraDelta;
      aceptadosMes: CifraDelta;
      aceptadosImporteMes: CifraDelta;
      perdidosMes: CifraDelta;
      perdidosImporteMes: CifraDelta;
      /** Perdidos históricos sin entrada de historial (sin mes atribuible). */
      perdidosSinFecha: number;
      conversionMes: ConversionCohorte;
    };
    cobros: {
      cobradoMes: CifraDelta;
      pendiente: number;
      vencido: number;
    };
    /** Mezcla privado / aseguradora: el titular, no el detalle. La dirección
     *  quiere saber de qué depende su facturación; el desglose por mutua y su
     *  evolución viven en la pestaña Tarifas de KPIs (spec 2026-07-29). */
    mezcla: {
      pacientesConTipo: number;
      pacientesSinTipo: number;
      privadoPct: number | null;
      aseguradoraPct: number | null;
      aceptadoPrivado: number;
      aceptadoAseguradora: number;
    } | null;
  };
  clinicas: ClinicaFila[];
  /** Embudo de la misma ventana de 6 meses que `progreso`. */
  embudo: { etapas: EmbudoEtapa[]; meses: number };
  /** Series mensuales, últimos 6 meses (viejo → nuevo), huecos a 0:
   *  total = € aceptado · leads = nuevos · presupuestos = presentados ·
   *  cobros = € cobrado. Mismos orígenes que el resto del dashboard. */
  progreso: Array<{ mes: string; total: number; leads: number; presupuestos: number; cobros: number }>;
};

// Mes DE LA CLÍNICA: `getMonth()` es el mes del runtime, y en Vercel eso es
// UTC (MEJORAS 52).
const mesKey = (d: Date) => mesISO(d);
/** Resta meses SOBRE EL CALENDARIO de la clínica ("2026-07" − 1 = "2026-06").
 *  Hacerlo con `new Date(ahora.getFullYear(), ahora.getMonth() - n, 1)` mezcla
 *  el calendario del runtime con el de la clínica: entre las 00:00 y las 02:00
 *  del día 1 de mes los dos no coinciden. */
const mesMenos = (mes: string, n: number) => {
  const y = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7)) - 1 - n;
  const anio = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${anio}-${String(mm + 1).padStart(2, "0")}`;
};
const mesDeIso = (iso: string) => iso.slice(0, 7);

export async function calcularDashboardRed(opts: {
  /** null = todas las clínicas del cliente (admin). */
  clinicaIds: string[] | null;
  ahora?: Date;
}): Promise<DashboardRed> {
  const ahora = opts.ahora ?? new Date();
  const mesActual = mesKey(ahora);
  const mesPrevio = mesMenos(mesActual, 1);

  const [clinicasAll, pacientes, presus, pagos, leadsAll, opciones, ultimos, accionesLead, perdidaPorPresupuesto] =
    await Promise.all([
      // Tenant: clinicas es tabla de identidad CENTRAL — sin el cliente
      // devolvería las clínicas de TODOS los clientes (lo cazó el QA de RLS).
      listClinicas({ onlyActivas: true, cliente: currentCliente() ?? undefined }),
      listPacientes({ clinicaIds: opts.clinicaIds ?? undefined }),
      selectPresupuestosRaw({
        fields: [
          "Paciente", "Estado", "Importe", "FechaAlta", "Fecha_Aceptado",
          "Tratamiento_nombre", "Intencion_detectada", "Fecha_ultima_respuesta",
          "Ultima_accion_registrada", "Tipo_ultima_accion",
        ],
      }),
      listPagosResumen(),
      listLeads(),
      listAllOpciones(),
      ultimosMensajesPorConversacion(),
      ultimasAccionesDireccionPorLead(),
      fechasPerdidaPorPresupuesto(),
    ]);

  const clinicas = opts.clinicaIds
    ? clinicasAll.filter((c) => opts.clinicaIds!.includes(c.id))
    : clinicasAll;
  const clinicaIdsSet = new Set(clinicas.map((c) => c.id));

  // Scope: pacientes ya vienen filtrados por el repo; presupuestos y pagos se
  // atribuyen a clínica VÍA su paciente (misma atribución que la cola de
  // cobros). Un presupuesto cuyo paciente no está en scope, fuera.
  const pacPorId = new Map(pacientes.map((p) => [p.id, p]));
  const presusScope = presus.filter((r) => {
    const links = ((r.fields as any)["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    return pid ? pacPorId.has(pid) : opts.clinicaIds === null;
  });
  const pagosScope = pagos.filter((p) => p.pacienteRecordId && pacPorId.has(p.pacienteRecordId));
  const leads = leadsAll.filter(
    (l) => !opts.clinicaIds || (l.clinicaId && clinicaIdsSet.has(l.clinicaId)),
  );

  const pacDe = (r: { fields: Record<string, unknown> }) => {
    const links = (r.fields["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    return pid ? pacPorId.get(pid) : undefined;
  };
  const abierto = (estado: string) => estado !== "ACEPTADO" && estado !== "PERDIDO";

  // ── Sección 1 · riesgo ───────────────────────────────────────────────
  let reactivablesN = 0;
  let reactivablesImporte = 0;
  // Próximos a cierre sin acción: intención de cierre detectada y la pelota
  // es NUESTRA (pendiente_responder) — misma clasificación compartida.
  //
  // El `Set` literal que vivía aquí se retiró el 2026-08-06: era una de cinco
  // copias del mismo criterio, y añadir una categoría al enum habría bajado
  // ESTE TITULAR DE DINERO un 80 % (de 5.900 € a 1.200 € en DEMO) sin fallar
  // nada. Ahora el significado vive en `presupuestos/intenciones`, con un
  // `Record` exhaustivo que rompe la compilación si aparece una categoría nueva.
  let cierreN = 0;
  let cierreImporte = 0;
  // Clínicas distintas tocadas por alguna señal de riesgo — solo para el
  // titular de la franja ("… en N clínicas"). Se acumula donde ya se decide
  // cada caso: cero recorridos nuevos y cero criterios paralelos.
  const clinicasRiesgo = new Set<string>();
  for (const r of presusScope) {
    const f = r.fields as any;
    if (!abierto(String(f["Estado"] ?? ""))) continue;
    const conv = conversacionDePresupuesto(
      {
        fechaUltimaRespuesta: f["Fecha_ultima_respuesta"] ? String(f["Fecha_ultima_respuesta"]) : null,
        ultimaAccionRegistrada: f["Ultima_accion_registrada"] ? String(f["Ultima_accion_registrada"]) : null,
        tipoUltimaAccion: f["Tipo_ultima_accion"] ? String(f["Tipo_ultima_accion"]) : null,
      },
      ultimos.porPresupuesto.get(r.id),
      ahora,
    );
    const importe = Number(f["Importe"] ?? 0) || 0;
    const clinicaDelCaso = pacDe(r)?.clinicaId;
    if (conv.estado === "reactivable") {
      reactivablesN++;
      reactivablesImporte += importe;
      if (clinicaDelCaso) clinicasRiesgo.add(clinicaDelCaso);
    }
    if (
      conv.estado === "pendiente_responder" &&
      esIntencionDeCierre(f["Intencion_detectada"] as string | null)
    ) {
      cierreN++;
      cierreImporte += importe;
      if (clinicaDelCaso) clinicasRiesgo.add(clinicaDelCaso);
    }
  }

  const cobros = calcularCobrosPorPaciente({
    pacientes,
    presupuestos: presusScope as any,
    pagos: pagosScope,
    opciones,
    // `ahoraMs` existía y el dashboard no lo pasaba: otro parámetro que el QA
    // creía estar controlando y no controlaba.
    ahoraMs: ahora.getTime(),
  });
  let vencidosN = 0;
  let vencidosImporte = 0;
  let pendienteTotal = 0;
  for (const c of cobros) {
    pendienteTotal += c.pendiente;
    if (c.urgencia === "vencido") {
      vencidosN++;
      vencidosImporte += c.pendiente;
      if (c.clinicaId) clinicasRiesgo.add(c.clinicaId);
    }
  }

  let sinContactoN = 0;
  const max = (a?: string | null, b?: string | null) => (!a ? (b ?? null) : !b || a > b ? a : b);
  for (const l of leads) {
    if (l.convertido || !esLeadActivo(l.estado)) continue;
    const hilo = ultimos.porLead.get(l.id);
    const conv = estadoConversacion(
      {
        ultimoEntranteAt: max(accionesLead.entrantePorLead[l.id], hilo?.entranteAt),
        ultimoSalienteAt: max(accionesLead.salientePorLead[l.id], hilo?.salienteAt),
      },
      UMBRAL_REACTIVACION_DIAS.lead,
      ahora,
    );
    if (conv.estado === "sin_conversacion") {
      sinContactoN++;
      if (l.clinicaId) clinicasRiesgo.add(l.clinicaId);
    }
  }

  const riesgo: RiesgoItem[] = [];
  // Copy (revisión 2026-07-23): cada card es una FRASE completa de negocio —
  // qué pasó, de qué, por qué importa. Sin taquigrafía ni jerga; hechos
  // verificables, cero afirmaciones de causalidad.
  //
  // `s()` pluraliza SUSTANTIVOS y `v()` conjuga VERBOS. Están separados porque
  // usar el de sustantivos en un verbo producía "superó"+"aron" → "superóaron",
  // y "sigue"+"s" → "sigues", que además le decía a la manager que era ELLA
  // quien no pagaba (pasada visual 2026-07-27).
  const s = (n: number) => (n === 1 ? "" : "s");
  const v = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);
  if (reactivablesN > 0) {
    riesgo.push({
      tipo: "reactivables",
      n: reactivablesN,
      importe: reactivablesImporte,
      titulo: "Presupuestos sin seguimiento",
      detalle: `Se escribió a ${reactivablesN} paciente${s(reactivablesN)}, no ${v(reactivablesN, "respondió", "respondieron")} y nadie ha vuelto a insistir.`,
      // P4 (21-08): los rezagados salieron de la cola de Seguimiento — la
      // insistencia es de la CADENCIA, y su pantalla es la cola de Envíos.
      href: "/envios",
    });
  }
  if (vencidosN > 0) {
    riesgo.push({
      tipo: "vencidos",
      n: vencidosN,
      importe: vencidosImporte,
      titulo: "Cobros fuera de plazo",
      detalle: `${vencidosN} paciente${s(vencidosN)} ${v(vencidosN, "superó", "superaron")} su plazo de pago y ${v(vencidosN, "sigue", "siguen")} sin pagar.`,
      href: "/cobros?urgencia=vencido",
    });
  }
  if (cierreN > 0) {
    riesgo.push({
      tipo: "cierre_sin_accion",
      n: cierreN,
      importe: cierreImporte,
      titulo: "Cierres esperando tu respuesta",
      detalle: `${cierreN} paciente${s(cierreN)} ya ${v(cierreN, "dijo que quiere aceptar y espera", "dijeron que quieren aceptar y esperan")} respuesta para cerrar.`,
      href: "/seguimiento?cohorte=necesita_respuesta",
    });
  }
  if (sinContactoN > 0) {
    riesgo.push({
      tipo: "sin_contacto",
      n: sinContactoN,
      importe: null,
      titulo: "Leads sin primer contacto",
      detalle: `${sinContactoN} lead${s(sinContactoN)} nuevo${s(sinContactoN)} todavía no ${v(sinContactoN, "ha", "han")} recibido ni un mensaje ni una llamada.`,
      href: "/seguimiento?cohorte=necesita_respuesta",
    });
  }

  // Orden por URGENCIA DE ACCIÓN, no por importe (pasada visual 2026-07-27).
  // El criterio es cuánto se estropea el caso por esperar un día más:
  //   1. Cierres esperándonos — el paciente ya dijo que sí y la pelota es
  //      nuestra: es dinero firmado que se enfría por no contestar.
  //   2. Leads sin primer contacto — la frescura ES la conversión (la misma
  //      razón por la que Seguimiento pone los nuevos arriba, 2026-07-26).
  //   3. Reactivables — ya se enfriaron; se recuperan, pero el reloj corre.
  //   4. Cobros vencidos — duele, pero el tratamiento está firmado y el
  //      dinero no se evapora por esperar un día.
  // Un importe grande NO adelanta a un caso más perecedero: por eso el
  // titular de la franja lleva el Σ€ aparte.
  const ORDEN_URGENCIA_ACCION: RiesgoItem["tipo"][] = [
    "cierre_sin_accion",
    "sin_contacto",
    "reactivables",
    "vencidos",
  ];
  riesgo.sort(
    (a, b) => ORDEN_URGENCIA_ACCION.indexOf(a.tipo) - ORDEN_URGENCIA_ACCION.indexOf(b.tipo),
  );

  // ── Sección 2 · el negocio ───────────────────────────────────────────
  /** "¿esta fecha entra en este mes?" — la pregunta cambia según PARA QUÉ se
   *  cuenta, así que los contadores la reciben en vez de darla por supuesta. */
  type Ventana = (iso: string | null | undefined, mes: string) => boolean;
  const enMes: Ventana = (iso, mes) => !!iso && mesDeIso(iso) === mes;

  // Mismo TRAMO del mes: días 1..hoy en ambos meses. Sin esto, un mes a medias
  // se compara contra uno entero y el día 3 todo cae un 90%. Se aplica a lo
  // RETROSPECTIVO (altas, aceptaciones, pérdidas, pagos); NO a la fecha de cita,
  // que es prospectiva — capar el futuro borraría citas ya agendadas del mes.
  const diaHoy = Number(hoyISO(ahora).slice(8, 10));
  const enTramo: Ventana = (iso, mes) => {
    if (!enMes(iso, mes)) return false;
    const dia = Number(iso!.slice(8, 10));
    return !Number.isFinite(dia) || dia === 0 ? true : dia <= diaHoy;
  };

  // Y para la SERIE HISTÓRICA, otra ventana (MEJORAS 88, 2026-08-01).
  //
  // `enTramo` compara TRAMOS; no construye series. Se escribió para que "este
  // mes" no se comparase contra un mes entero (el día 3, todo caía un 90%), y
  // se reutilizó tal cual en la gráfica de 6 meses — donde significa otra cosa:
  // recortar TODOS los meses cerrados al día de hoy. Efecto medido el 1 de
  // agosto: marzo·abril·mayo·julio a 0 € y junio a 4.800 €, con 31.584 · 15.786
  // · 44.062 · 37.881 € reales en la base. La gráfica solo era correcta a final
  // de mes, y contradecía su propia decisión de diseño (2026-07-27: el mes en
  // curso se pinta punteado EN VEZ de excluirlo, "para ver la tendencia sin que
  // un mes a medias parezca una caída" — si los cerrados también se recortan,
  // no hay tendencia que ver).
  //
  // Un mes CERRADO se cuenta entero; el mes EN CURSO, hasta hoy — que es
  // exactamente lo que su trazo punteado ya le está diciendo al usuario.
  const enSerie: Ventana = (iso, mes) =>
    mes === mesActual ? enTramo(iso, mes) : enMes(iso, mes);

  // Leads
  const creados = (mes: string, dentro: Ventana = enTramo) =>
    leads.filter((l) => dentro(l.createdAt, mes));
  const nuevosAct = creados(mesActual);
  const nuevosPrev = creados(mesPrevio);
  const citadosEnMes = (mes: string) => leads.filter((l) => enMes(l.fechaCita, mes)).length;

  // Presupuestos
  const presentados = (mes: string, dentro: Ventana = enTramo) =>
    presusScope.filter((r) => dentro(String((r.fields as any)["FechaAlta"] ?? "") || null, mes));
  /** Aceptados POR FECHA DE ACEPTACIÓN — "cuánto se firmó este mes". No sirve
   *  como numerador de la conversión: son otra cohorte (ver conversionDe). */
  const aceptados = (mes: string, dentro: Ventana = enTramo) =>
    presusScope.filter(
      (r) =>
        String((r.fields as any)["Estado"] ?? "") === "ACEPTADO" &&
        dentro(String((r.fields as any)["Fecha_Aceptado"] ?? "") || null, mes),
    );
  const importeDe = (rs: ReadonlyArray<{ fields: Record<string, unknown> }>) =>
    rs.reduce((s, r) => s + (Number((r.fields as any)["Importe"] ?? 0) || 0), 0);
  const perdidosDe = (mes: string) =>
    presusScope.filter((r) => {
      if (String((r.fields as any)["Estado"] ?? "") !== "PERDIDO") return false;
      const fecha = perdidaPorPresupuesto.get(r.id);
      return !!fecha && enTramo(fecha, mes);
    });
  const perdidosSinFecha = presusScope.filter(
    (r) => String((r.fields as any)["Estado"] ?? "") === "PERDIDO" && !perdidaPorPresupuesto.get(r.id),
  ).length;

  const presAct = presentados(mesActual);
  const presPrev = presentados(mesPrevio);
  const acepAct = aceptados(mesActual);
  const acepPrev = aceptados(mesPrevio);
  const perdAct = perdidosDe(mesActual);
  const perdPrev = perdidosDe(mesPrevio);

  /** Conversión de una COHORTE de presupuestos: de ESTOS mismos, cuántos ya se
   *  aceptaron. El numerador es un subconjunto del denominador por
   *  construcción, así que no puede pasar del 100% ni desmentir a su etiqueta. */
  const ratioCohorte = (rs: ReadonlyArray<{ fields: Record<string, unknown> }>) => {
    let aceptadosN = 0;
    let abiertosN = 0;
    for (const r of rs) {
      const estado = String(r.fields["Estado"] ?? "");
      if (estado === "ACEPTADO") aceptadosN++;
      else if (abierto(estado)) abiertosN++;
    }
    return {
      total: rs.length,
      aceptados: aceptadosN,
      abiertos: abiertosN,
      pct: rs.length > 0 ? Math.round((aceptadosN / rs.length) * 100) : null,
    };
  };
  const conversionDe = (
    act: ReturnType<typeof ratioCohorte>,
    prev: ReturnType<typeof ratioCohorte>,
  ): ConversionCohorte => ({
    pct: act.pct,
    pctPrevio: prev.pct,
    presentados: act.total,
    presentadosPrevio: prev.total,
    aceptados: act.aceptados,
    aceptadosPrevio: prev.aceptados,
    abiertos: act.abiertos,
    comparable:
      act.total > 0 &&
      prev.total > 0 &&
      act.abiertos / act.total <= UMBRAL_COHORTE_ABIERTA,
    muestraCorta: act.total < BASE_MINIMA_COHORTE || prev.total < BASE_MINIMA_COHORTE,
  });

  const cohortePres = ratioCohorte(presAct);
  const cohortePresPrev = ratioCohorte(presPrev);
  const conversionPresupuestos = conversionDe(cohortePres, cohortePresPrev);

  /** Misma regla para leads: de los captados en el mes, cuántos ya convirtieron.
   *  Un lead de esta semana todavía no ha tenido tiempo de convertir. */
  const ratioLeads = (arr: typeof leads) => {
    let convertidosN = 0;
    let abiertosN = 0;
    for (const l of arr) {
      if (l.convertido) convertidosN++;
      else if (esLeadActivo(l.estado)) abiertosN++;
    }
    return {
      total: arr.length,
      aceptados: convertidosN,
      abiertos: abiertosN,
      pct: arr.length > 0 ? Math.round((convertidosN / arr.length) * 100) : null,
    };
  };
  const conversionLeads = conversionDe(ratioLeads(nuevosAct), ratioLeads(nuevosPrev));

  // Cobros
  //
  // La ventana también se recibe (MEJORAS 88, segunda mitad). Esta era la única
  // de las cinco métricas que comparaba el mes en curso contra el mes anterior
  // ENTERO, y el comentario de `/api/cobros` afirmaba desde el 2026-07-27 que lo
  // hacía "igual que el dashboard de Red" — pero /red nunca lo hizo para cobros.
  // Medido hoy, 1 de agosto: /red diría «−28.261 € vs mes pasado» y /cobros
  // «+0 €», por la misma cifra. Es la trampa exacta que aquella decisión vino a
  // matar, viva en el sitio que se daba por bueno.
  const cobradoEn = (mes: string, dentro: Ventana = enTramo) =>
    pagosScope.filter((p) => dentro(p.fechaPago, mes)).reduce((s, p) => s + p.importe, 0);

  // ── "Qué está funcionando" — agregados con umbral de materialidad ────
  // `useGrouping` explícito: sin él, es-ES escribe "5900 €" y "11.580 €" en la
  // misma franja de cards.
  const eurTxt = (n: number) => `${n.toLocaleString("es-ES", { useGrouping: true })} €`;
  const exitos: ExitoItem[] = [];
  const convAct = conversionPresupuestos.pct;
  const convPrev = conversionPresupuestos.pctPrevio;
  // Solo se celebra una subida que se puede comparar: con la cohorte del mes
  // aún madurando o con una muestra corta, el "sube" sería el mismo espejismo
  // en verde.
  if (
    convAct != null &&
    convPrev != null &&
    convAct > convPrev &&
    conversionPresupuestos.comparable &&
    !conversionPresupuestos.muestraCorta
  ) {
    exitos.push({
      tipo: "conversion",
      dato: `${convAct}%`,
      titulo: "La conversión sube",
      detalle: `El ${convAct}% de los presupuestos presentados este mes acabó aceptado; el mes pasado fue el ${convPrev}%.`,
    });
  }
  // Semana actual (7 días) vs anterior (7-14), sobre fecha_aceptado.
  const diaIso = (d: number) => hoyISO(new Date(ahora.getTime() - d * 24 * 3600_000));
  const hace7d = diaIso(7);
  const hace14d = diaIso(14);
  const aceptadosDesde = (desde: string, hasta?: string) =>
    presusScope.filter((r) => {
      const f = r.fields as any;
      if (String(f["Estado"] ?? "") !== "ACEPTADO") return false;
      const fecha = String(f["Fecha_Aceptado"] ?? "").slice(0, 10);
      return !!fecha && fecha >= desde && (!hasta || fecha < hasta);
    });
  const semanaRs = aceptadosDesde(hace7d);
  const semana = importeDe(semanaRs);
  const semanaPrev = importeDe(aceptadosDesde(hace14d, hace7d));
  if (semana > semanaPrev && semana > 0) {
    exitos.push({
      tipo: "aceptado_semana",
      dato: eurTxt(semana),
      titulo: "Semana fuerte de firmas",
      detalle:
        semanaPrev > 0
          ? `Presupuestos aceptados esta semana, ${eurTxt(semana - semanaPrev)} más que la anterior.`
          : `Presupuestos aceptados esta semana; la anterior no se firmó ninguno.`,
    });
  }
  // Mejor clínica de la semana (solo con red multi-clínica y con dato real).
  if (clinicas.length > 1) {
    const porClinica = new Map<string, number>();
    for (const r of semanaRs) {
      const cid = pacDe(r)?.clinicaId;
      if (!cid) continue;
      porClinica.set(cid, (porClinica.get(cid) ?? 0) + (Number((r.fields as any)["Importe"] ?? 0) || 0));
    }
    const mejor = [...porClinica.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mejor && mejor[1] > 0) {
      const nombre = clinicas.find((c) => c.id === mejor[0])?.nombre ?? "—";
      exitos.push({
        tipo: "mejor_clinica",
        dato: eurTxt(mejor[1]),
        titulo: `${nombre} lidera la semana`,
        detalle: "Es la clínica con más presupuesto aceptado de toda la red esta semana.",
      });
    }
  }
  // Mejor tratamiento de la semana.
  {
    const porTrat = new Map<string, number>();
    for (const r of semanaRs) {
      const t = String((r.fields as any)["Tratamiento_nombre"] ?? "").trim();
      if (!t) continue;
      porTrat.set(t, (porTrat.get(t) ?? 0) + (Number((r.fields as any)["Importe"] ?? 0) || 0));
    }
    const mejor = [...porTrat.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mejor && mejor[1] > 0) {
      exitos.push({
        tipo: "mejor_tratamiento",
        dato: eurTxt(mejor[1]),
        // El dato es de los últimos 7 días: el titular dice semana, no mes.
        titulo: `${mejor[0]} tira de la semana`,
        detalle: "Es el tratamiento que más dinero aceptado sumó esta semana.",
      });
    }
  }

  // ── Sección 3 · clínicas ─────────────────────────────────────────────
  //
  // «Necesitan persona» sale de LA COLA de Seguimiento (fase C), no de un
  // cálculo propio: al hacer clic en la cifra tienen que salir exactamente
  // esos casos — el filtro «necesitan de mí» de la bandeja y las cohortes de
  // /seguimiento cuentan con la misma función. Dos cálculos del mismo número
  // divergen tarde o temprano, y entonces /red dice 7 y la bandeja enseña 5.
  //
  // Si falla, queda `null` y la tabla lo dice: un cero inventado aquí afirmaría
  // que la clínica lo lleva al día (§4).
  let necesitanPersona: { porClinica: Record<string, number>; sinClinica: number } | null = null;
  try {
    const { casos } = await colaDeSeguimiento();
    const porClinica: Record<string, number> = {};
    let sinClinica = 0;
    for (const caso of casos) {
      if (!caso.clinicaId) {
        sinClinica++;
        continue;
      }
      if (opts.clinicaIds != null && !opts.clinicaIds.includes(caso.clinicaId)) continue;
      porClinica[caso.clinicaId] = (porClinica[caso.clinicaId] ?? 0) + 1;
    }
    necesitanPersona = { porClinica, sinClinica };
  } catch (err) {
    console.error("[dashboard-red] no se pudo contar «necesitan persona»:", err);
  }

  const filas: ClinicaFila[] = clinicas.map((c) => {
    const deClinica = (rs: ReadonlyArray<{ fields: Record<string, unknown> }>) =>
      rs.filter((r) => pacDe(r)?.clinicaId === c.id);
    // Conversión con la MISMA regla de cohorte que el bloque de negocio: de los
    // presupuestos presentados por esta clínica, cuántos ya se aceptaron.
    const cohorte = ratioCohorte(deClinica(presAct));
    const cohortePrevia = ratioCohorte(deClinica(presPrev));
    const aceptadoMes = importeDe(deClinica(acepAct));
    const aceptadoMesPrevio = importeDe(deClinica(acepPrev));
    const vencido = cobros
      .filter((x) => x.clinicaId === c.id && x.urgencia === "vencido")
      .reduce((s, x) => s + x.pendiente, 0);
    return {
      id: c.id,
      nombre: c.nombre,
      conversionPct: cohorte.pct,
      conversionPctPrevio: cohortePrevia.pct,
      presentadosMes: cohorte.total,
      presentadosMesPrevio: cohortePrevia.total,
      aceptadosMes: cohorte.aceptados,
      aceptadosMesPrevio: cohortePrevia.aceptados,
      aceptadoMes,
      aceptadoMesPrevio,
      vencido,
      tendenciaPct:
        aceptadoMesPrevio > 0
          ? Math.round(((aceptadoMes - aceptadoMesPrevio) / aceptadoMesPrevio) * 100)
          : null,
      muestraCorta:
        cohorte.total < BASE_MINIMA_COHORTE || cohortePrevia.total < BASE_MINIMA_COHORTE,
      necesitanPersona: necesitanPersona ? (necesitanPersona.porClinica[c.id] ?? 0) : null,
    };
  });
  // Orden por defecto: mayor caída arriba. Las clínicas con muestra corta van
  // DESPUÉS de las fiables aunque su caída sea la mayor: un 100% salido de dos
  // presupuestos no puede encabezar el ranking de "la que más cae".
  filas.sort((a, b) => {
    if (a.muestraCorta !== b.muestraCorta) return a.muestraCorta ? 1 : -1;
    return (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity);
  });

  // ── Mezcla privado / aseguradora ─────────────────────────────────────
  // Se mide sobre los pacientes CON TIPO, y los que no lo tienen se declaran:
  // el campo es nuevo y se rellena con el uso, así que un porcentaje sobre el
  // total diría "38% privado" cuando la verdad es "de los que sabemos".
  const catalogoMezcla = await catalogoTiposPaciente(null);
  const aseguradoras = new Set(
    catalogoMezcla.filter((t) => t.esAseguradora).map((t) => t.valor.toLowerCase()),
  );
  const esAseg = (tipo: string | null) => !!tipo && aseguradoras.has(tipo.toLowerCase());
  let conTipo = 0;
  let privados = 0;
  let aceptadoPrivado = 0;
  let aceptadoAseguradora = 0;
  for (const p of pacientes) {
    if (!p.tipoPaciente) continue;
    conTipo++;
    if (!esAseg(p.tipoPaciente)) privados++;
  }
  for (const r of presusScope) {
    if (String(r.fields["Estado"] ?? "") !== "ACEPTADO") continue;
    const links = (r.fields["Paciente"] ?? []) as string[];
    const pac = Array.isArray(links) ? pacPorId.get(links[0]!) : undefined;
    if (!pac?.tipoPaciente) continue;
    const importe = Number(r.fields["Importe"] ?? 0) || 0;
    if (esAseg(pac.tipoPaciente)) aceptadoAseguradora += importe;
    else aceptadoPrivado += importe;
  }
  const mezcla =
    conTipo === 0
      ? null
      : {
          pacientesConTipo: conTipo,
          pacientesSinTipo: pacientes.length - conTipo,
          privadoPct: Math.round((privados / conTipo) * 100),
          aseguradoraPct: 100 - Math.round((privados / conTipo) * 100),
          aceptadoPrivado,
          aceptadoAseguradora,
        };

  // ── Sección 4 · progreso (6 meses, 4 series) ─────────────────────────
  const progreso: Array<{ mes: string; total: number; leads: number; presupuestos: number; cobros: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const mes = mesMenos(mesActual, i);
    progreso.push({
      mes,
      // `enSerie`, no `enTramo`: los meses cerrados van ENTEROS (MEJORAS 88).
      // `cobradoEn` ya usaba `enMes` — era la única de las cuatro que no
      // estaba recortada, y por eso la línea de cobros era la única creíble.
      total: importeDe(aceptados(mes, enSerie)),
      leads: creados(mes, enSerie).length,
      presupuestos: presentados(mes, enSerie).length,
      cobros: cobradoEn(mes, enSerie),
    });
  }

  // ── Sección 5 · embudo (misma ventana de 6 meses que el progreso) ────
  //
  // Cohorte: los leads captados en la ventana. Cada etapa filtra la MISMA
  // lista, así que el numerador siempre está contenido en el denominador —
  // el embudo no puede subir. Se derivan de los datos que ya están cargados
  // (leads en scope + presupuestos en scope): cero consultas nuevas.
  const MESES_EMBUDO = 6;
  const desdeEmbudo = mesMenos(mesActual, MESES_EMBUDO - 1);
  const cohorteLeads = leads.filter(
    (l) => !!l.createdAt && mesDeIso(l.createdAt) >= desdeEmbudo,
  );
  const pacientesConPresupuesto = new Set<string>();
  const pacientesConAceptado = new Set<string>();
  for (const r of presusScope) {
    const links = (r.fields["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    if (!pid) continue;
    pacientesConPresupuesto.add(pid);
    if (String(r.fields["Estado"] ?? "") === "ACEPTADO") pacientesConAceptado.add(pid);
  }
  const convertidos = cohorteLeads.filter((l) => l.convertido && l.pacienteId);
  const conPresupuesto = convertidos.filter((l) => pacientesConPresupuesto.has(l.pacienteId!));
  const conAceptado = convertidos.filter((l) => pacientesConAceptado.has(l.pacienteId!));

  // Citas de la cohorte (MEJORAS 50): la del propio lead si alguien la agendó
  // desde Fyllio, y si no la primera de su paciente dentro de la ventana de
  // atribución. Una consulta de tres columnas sobre los pacientes de la cohorte.
  const citasPorPac = await citasPorPacienteDeLeads(
    cohorteLeads.map((l) => l.pacienteId).filter((x): x is string => !!x),
  );
  const conCitaAtribuible = new Set<string>();
  for (const l of cohorteLeads) {
    if (citaDelLead(l, citasPorPac)) conCitaAtribuible.add(l.id);
  }
  // Llegar a ser paciente implica haber pisado la clínica, así que un convertido
  // cuenta como citado aunque su cita caiga fuera de la ventana. Es lo único
  // que mantiene el embudo sin subir — y de paso se declara cuántos son.
  const citados = cohorteLeads.filter(
    (l) => conCitaAtribuible.has(l.id) || (l.convertido && l.pacienteId),
  );
  const convertidosSinCitaAtribuible = convertidos.filter(
    (l) => !conCitaAtribuible.has(l.id),
  ).length;

  const etapasCrudas: Array<Omit<EmbudoEtapa, "siguePct">> = [
    {
      clave: "captados",
      etiqueta: "Leads captados",
      detalle: "Personas que preguntaron por un tratamiento",
      n: cohorteLeads.length,
    },
    {
      clave: "citados",
      etiqueta: "Consiguieron cita",
      detalle:
        convertidosSinCitaAtribuible > 0
          ? `Con cita agendada o registrada en la agenda · ${convertidosSinCitaAtribuible} sin fecha atribuible`
          : "Con cita agendada desde Fyllio o registrada en la agenda",
      n: citados.length,
    },
    {
      clave: "pacientes",
      etiqueta: "Llegaron a la clínica",
      detalle: "Leads que acabaron dados de alta como paciente",
      n: convertidos.length,
    },
    {
      clave: "presupuesto",
      etiqueta: "Recibieron presupuesto",
      detalle: "De esos pacientes, a cuántos se les presentó uno",
      n: conPresupuesto.length,
    },
    {
      clave: "aceptado",
      etiqueta: "Aceptaron",
      detalle: "Presupuesto firmado: el tratamiento sale adelante",
      n: conAceptado.length,
    },
  ];
  const etapasEmbudo: EmbudoEtapa[] = etapasCrudas.map((e, i) => {
    const previa = i === 0 ? null : etapasCrudas[i - 1].n;
    return {
      ...e,
      siguePct: previa == null ? null : previa > 0 ? Math.round((e.n / previa) * 100) : null,
    };
  });

  // ── Avisos del día: con cita hoy y ha escrito hoy ──────────────────────────
  //
  // Se compone de datos YA cargados arriba: `ultimos` (último entrante por
  // conversación) y las citas de los leads. Cero consultas nuevas.
  //
  // LO QUE ESTA SEÑAL NO SABE, y se declara en vez de disimularse: no distingue
  // «llego tarde» de «no puedo ir» ni de «gracias». Eso lo sabría la
  // clasificación (`intencion_detectada`), que solo existe cuando el agente ha
  // corrido. Mientras no exista, `deQueVa` va en null y la señal dice lo único
  // que sabe: **ha escrito, y viene hoy**. Que ya es motivo para mirarlo.
  const avisosDelDia: AvisoHoyItem[] = [];
  {
    // El día de la CLÍNICA, anclado al `ahora` que recibe la función — nunca
    // `Date.now()` por dentro (§14).
    const hoyStr = hoyISO(ahora);
    const esHoy = (iso: string | null | undefined) => !!iso && hoyISO(new Date(iso)) === hoyStr;
    for (const l of leads) {
      if (l.convertido || !esLeadActivo(l.estado)) continue;
      const citaHoy = l.fechaCita && String(l.fechaCita).slice(0, 10) === hoyStr;
      if (!citaHoy) continue;
      const entrante = ultimos.porLead.get(l.id)?.entranteAt ?? null;
      if (!esHoy(entrante)) continue;
      avisosDelDia.push({
        quien: l.nombre,
        horaCita: l.horaCita ? String(l.horaCita).slice(0, 5) : null,
        deQueVa: l.intencionDetectada ?? null,
        href: "/seguimiento",
      });
    }
    // La cita más temprana primero: es la que antes deja de poder atenderse.
    avisosDelDia.sort((a, b) => (a.horaCita ?? "99:99").localeCompare(b.horaCita ?? "99:99"));
  }

  return {
    hoy: {
      // La franja ocupa el ancho completo y admite hasta 6 señales; hoy el
      // catálogo tiene 4 tipos, así que el tope no recorta nada.
      riesgo: riesgo.slice(0, 6),
      exitos: exitos.slice(0, 3),
      avisos: avisosDelDia,
      importeEnRiesgo: riesgo.reduce((s, r) => s + (r.importe ?? 0), 0),
      clinicasEnRiesgo: clinicasRiesgo.size,
    },
    negocio: {
      leads: {
        nuevosMes: { valor: nuevosAct.length, previo: nuevosPrev.length },
        // Pipeline = la MISMA definición de /seguimiento y de la cabecera del
        // tablero (lib/leads/pipeline). Contar solo "Contactado" dejaba fuera a
        // Nuevos y Citados: el cuarto número para el mismo concepto que la
        // decisión del 2026-07-23 vino a matar.
        enSeguimiento: leads.filter((l) => !l.convertido && esLeadActivo(l.estado)).length,
        citadosMes: { valor: citadosEnMes(mesActual), previo: citadosEnMes(mesPrevio) },
        conversionMes: conversionLeads,
      },
      presupuestos: {
        presentadosMes: { valor: presAct.length, previo: presPrev.length },
        presentadosImporteMes: { valor: importeDe(presAct), previo: importeDe(presPrev) },
        aceptadosMes: { valor: acepAct.length, previo: acepPrev.length },
        aceptadosImporteMes: { valor: importeDe(acepAct), previo: importeDe(acepPrev) },
        perdidosMes: { valor: perdAct.length, previo: perdPrev.length },
        perdidosImporteMes: { valor: importeDe(perdAct), previo: importeDe(perdPrev) },
        perdidosSinFecha,
        conversionMes: conversionPresupuestos,
      },
      cobros: {
        cobradoMes: { valor: cobradoEn(mesActual), previo: cobradoEn(mesPrevio) },
        pendiente: pendienteTotal,
        vencido: vencidosImporte,
      },
      mezcla,
    },
    clinicas: filas,
    embudo: { etapas: etapasEmbudo, meses: MESES_EMBUDO },
    progreso,
  };
}
