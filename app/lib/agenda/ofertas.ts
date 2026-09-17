// app/lib/agenda/ofertas.ts
//
// EL BUCLE OFRECER → ELEGIR → COMPROBAR → RESERVAR (17-09, cambio de flujo
// del paso 3 dictado por Simon). Nada queda reservado hasta que el paciente
// acepta; la coordinadora no escribe ni una palabra: elige horas, pulsa
// enviar, y cuando el paciente contesta reserva de un clic.
//
// Este módulo es el MOTOR y no vive en la pantalla (condición 6 de Simon):
// compone la oferta, la comprueba, interpreta lo que decidió el evaluador,
// contesta con plantillas de CÓDIGO y reserva. Lo mismo que hará el agente el
// día que vea la agenda, y lo mismo que recorre el QA de punta a punta.
//
// Lo que garantiza el código y no el modelo:
//  · Nunca se confirma un hueco que ya no existe: se recomprueba al enviar
//    la oferta y al reservar; si se ocupó, NO se manda nada — se enseña ya
//    escrito «se acaba de ocupar, te quedan estas».
//  · Una oferta CADUCA (24 h, tope en su primera hora menos 2 h); se calcula
//    al leer, sin cron. Una elección tardía se guarda pero no reserva: la
//    coordinadora ve la comprobación y decide. Con 4 h de gracia si el hueco
//    sigue libre y nadie reofertó (contestó a la lista que tenía delante).
//  · El ACUSE a la elección sale con retardo (10 min dentro de horario, 0
//    fuera) y SOLO si nadie ha reservado ni se le ha escrito nada desde que
//    eligió: dos mensajes que se contradicen es peor que el silencio.
//  · Solo con la agenda en Fyllio (en_vivo): con copia o sin agenda, ofrecer
//    horas como reales es la promesa falsa que el juez veta al agente.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { getLead, updateLead } from "../leads/leads";
import { getServicioMensajeria } from "../presupuestos/mensajeria";
import { hasWABACredentials } from "../presupuestos/waba-credentials";
import { envioBloqueadoPorOptOut } from "../contacto/optout";
import { hiloJugado, FUENTE_SIMULACION } from "../mensajeria/hilo-jugado";
import { huecosDelCaso, libresDelCaso, mismoHueco } from "./huecos-del-caso";
import type { Alternativa } from "./ofertas-textos";
import { leerAgendaEnFyllio } from "./garantia";
import { instanteDeCita, upsertCitaDeLead } from "./cita-de-lead";
import { confirmarCitaAlPaciente, type ResultadoConfirmacion } from "./confirmar-cita";
import { textoConfirmacionCita } from "./confirmacion-cita";
import { clinicaAbierta } from "../seguimiento/tiempo-laborable";
import { HORARIO_DEFAULT } from "../automatizaciones/types";
import type { PreferenciaCita } from "../agente/evaluador";
import { textoOferta, textoSeOcupo, textoTodasOcupadas, textoSinHuecos, textoAcuse } from "./ofertas-textos";

export * from "./ofertas-textos";

// ─── Constantes (decisiones de Simon, 17-09) ────────────────────────────────

/** Una oferta vive un día. */
export const PLAZO_OFERTA_MS = 24 * 3_600_000;
/** …y nunca más allá de su primera hora menos dos horas. */
export const TOPE_ANTES_DEL_HUECO_MS = 2 * 3_600_000;
/** Recién enviada no puede nacer muerta: mínimo media hora. */
const VIDA_MINIMA_MS = 30 * 60_000;
/** Gracia tras vencer: si contesta poco después y el hueco sigue libre, no es tardía. */
export const GRACIA_MS = 4 * 3_600_000;
export const MAX_ALTERNATIVAS = 4;
/** Minutos que se espera dentro de horario antes de acusar (fuera: 0). */
export const ACUSE_RETARDO_MIN = 10;

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type EstadoOferta = "abierta" | "elegida" | "reservada" | "caducada" | "reemplazada";

export type Oferta = {
  id: string;
  telefono: string;
  leadId: string;
  clinicaId: string | null;
  tratamientoId: string | null;
  alternativas: Alternativa[];
  texto: string;
  mensajeId: string | null;
  enviadaEn: Date;
  caducaEn: Date;
  /** El estado EFECTIVO (con el vencimiento aplicado al leer). */
  estado: EstadoOferta;
  eleccion: number | null;
  eleccionEn: Date | null;
  eleccionTardia: boolean;
  desambiguaciones: number;
  acuseEnviadoEn: Date | null;
  citaId: string | null;
};

// ─── Puras ──────────────────────────────────────────────────────────────────

export function instanteDeAlternativa(a: Pick<Alternativa, "fecha" | "hora">): Date {
  const d = instanteDeCita(a.fecha, a.hora);
  if (!d) throw new Error(`alternativa ilegible: ${a.fecha} ${a.hora}`);
  return d;
}

/** Cuándo vence una oferta enviada en `enviadaEn` con estas alternativas. */
export function caducaEn(alternativas: readonly Pick<Alternativa, "fecha" | "hora">[], enviadaEn: Date): Date {
  const plazo = enviadaEn.getTime() + PLAZO_OFERTA_MS;
  const primera = Math.min(...alternativas.map((a) => instanteDeAlternativa(a).getTime()));
  const tope = primera - TOPE_ANTES_DEL_HUECO_MS;
  return new Date(Math.max(enviadaEn.getTime() + VIDA_MINIMA_MS, Math.min(plazo, tope)));
}

/** El estado con el vencimiento aplicado: abierta y vencida = caducada. */
export function estadoEfectivo(o: Pick<Oferta, "estado" | "caducaEn">, ahora: Date): EstadoOferta {
  return o.estado === "abierta" && ahora.getTime() > o.caducaEn.getTime() ? "caducada" : o.estado;
}

/** ¿Una elección hecha en `eleccionEn` llega TARDE? Tardía si la oferta ya
 *  fue reemplazada (contestó a una lista que ya no tiene delante), o si pasó
 *  la gracia, o si el hueco elegido empieza en menos de dos horas. */
export function eleccionTardia(
  o: Pick<Oferta, "estado" | "caducaEn" | "alternativas">,
  eleccionEn: Date,
  indice: number | null,
): boolean {
  if (o.estado === "reemplazada" || o.estado === "reservada") return true;
  const t = eleccionEn.getTime();
  if (t <= o.caducaEn.getTime()) return false;
  const alt = indice != null ? o.alternativas[indice] : o.alternativas[0];
  const topeHueco = alt ? instanteDeAlternativa(alt).getTime() - TOPE_ANTES_DEL_HUECO_MS : Infinity;
  return t > Math.min(o.caducaEn.getTime() + GRACIA_MS, topeHueco);
}

// ─── Lectura ────────────────────────────────────────────────────────────────

function filaAOferta(f: any, ahora: Date): Oferta {
  const base = {
    id: String(f.id),
    telefono: String(f.telefono),
    leadId: String(f.lead_id),
    clinicaId: (f.clinica_id as string | null) ?? null,
    tratamientoId: (f.tratamiento_id as string | null) ?? null,
    alternativas: (Array.isArray(f.alternativas) ? f.alternativas : []) as Alternativa[],
    texto: String(f.texto ?? ""),
    mensajeId: (f.mensaje_id as string | null) ?? null,
    enviadaEn: new Date(f.enviada_en),
    caducaEn: new Date(f.caduca_en),
    estado: f.estado as EstadoOferta,
    eleccion: typeof f.eleccion === "number" ? f.eleccion : null,
    eleccionEn: f.eleccion_en ? new Date(f.eleccion_en) : null,
    eleccionTardia: f.eleccion_tardia === true,
    desambiguaciones: Number(f.desambiguaciones ?? 0),
    acuseEnviadoEn: f.acuse_enviado_en ? new Date(f.acuse_enviado_en) : null,
    citaId: (f.cita_id as string | null) ?? null,
  };
  return { ...base, estado: estadoEfectivo(base, ahora) };
}

/** La ÚLTIMA oferta del hilo, con el vencimiento aplicado (y persistido si
 *  acaba de vencer). null = nunca se le ofreció nada. Las reservadas y
 *  reemplazadas también se devuelven: la ficha decide qué enseñar. */
export async function ofertaDelCaso(telefono: string, opts?: { ahora?: Date }): Promise<Oferta | null> {
  const cliente = requireCliente("ofertaDelCaso");
  const ahora = opts?.ahora ?? new Date();
  return runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`select * from ofertas_hueco where telefono = ${telefono} order by created_at desc limit 1`.execute(trx);
    const f = r.rows?.[0];
    if (!f) return null;
    const o = filaAOferta(f, ahora);
    if (o.estado === "caducada" && f.estado === "abierta") {
      await sql`update ofertas_hueco set estado = 'caducada', updated_at = now() where id = ${o.id} and estado = 'abierta'`.execute(trx);
    }
    return o;
  });
}

async function ofertaPorId(id: string, ahora: Date): Promise<Oferta | null> {
  const cliente = requireCliente("ofertaPorId");
  return runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`select * from ofertas_hueco where id = ${id}`.execute(trx);
    return r.rows?.[0] ? filaAOferta(r.rows[0], ahora) : null;
  });
}

/** Lo que el evaluador necesita del bucle: la oferta abierta (o elegida sin
 *  reservar) para que el modelo interprete la elección, y nada más. */
export async function ofertaAbiertaParaEvaluador(telefono: string, ahora = new Date()): Promise<{ id: string; alternativas: Alternativa[]; estado: EstadoOferta; desambiguaciones: number } | null> {
  const o = await ofertaDelCaso(telefono, { ahora });
  if (!o) return null;
  if (o.estado !== "abierta" && o.estado !== "elegida" && o.estado !== "caducada") return null;
  if (o.estado === "caducada" && o.eleccion != null) return null; // ya contestó a la caducada; lo lleva la coordinadora
  return { id: o.id, alternativas: o.alternativas, estado: o.estado, desambiguaciones: o.desambiguaciones };
}

// ─── Comprobar ──────────────────────────────────────────────────────────────

/** Cuáles de estas alternativas SIGUEN libres ahora mismo, según el mismo
 *  motor que las calculó. Sin duración (tratamiento) no se puede afirmar
 *  nada: todas cuentan como ocupadas y se dice. */
export async function comprobarAlternativas(p: {
  alternativas: readonly Alternativa[];
  tratamientoId: string | null;
  clinicaId: string | null;
  ahora?: Date;
}): Promise<{ libres: Alternativa[]; ocupadas: Alternativa[]; motivo: string | null }> {
  if (p.alternativas.length === 0) return { libres: [], ocupadas: [], motivo: null };
  const fechas = p.alternativas.map((a) => a.fecha).sort();
  const desde = fechas[0]!;
  const dias = Math.max(1, Math.round((instanteDeAlternativa({ fecha: fechas[fechas.length - 1]!, hora: "00:00" }).getTime() - instanteDeAlternativa({ fecha: desde, hora: "00:00" }).getTime()) / 86_400_000) + 1);
  // Por CONTENCIÓN en los intervalos libres, no por «existe ese slot»: la
  // rejilla se desplaza en cuanto algo ocupa un trozo (un bloqueo de 15 min
  // a las 14:00 hacía «desaparecer» las 14:20 y las 14:40 aunque siguieran
  // libres — visto en el e2e del 17-09).
  const r = await libresDelCaso({ preferencia: null, tratamientoTexto: null, tratamientoId: p.tratamientoId, doctorId: null, clinicaId: p.clinicaId, modo: "todos", desde, dias, ahora: p.ahora });
  if (!r.tratamiento) return { libres: [], ocupadas: [...p.alternativas], motivo: r.nota ?? "Sin tratamiento no se puede comprobar el hueco." };
  const libres: Alternativa[] = [];
  const ocupadas: Alternativa[] = [];
  for (const a of p.alternativas) (r.cabe(a) ? libres : ocupadas).push(a);
  return { libres, ocupadas, motivo: null };
}

/** Rellena hasta `max` alternativas: las que siguen libres de la lista vieja
 *  y, si faltan, las mejores del caso (preferencia) que no estén ya. */
export async function alternativasDeRepuesto(p: {
  vivas: readonly Alternativa[];
  excluir: readonly Alternativa[];
  preferencia: PreferenciaCita | null;
  tratamientoId: string | null;
  doctorId: string | null;
  clinicaId: string | null;
  max?: number;
  ahora?: Date;
}): Promise<Alternativa[]> {
  const max = p.max ?? 3;
  const salida = [...p.vivas].slice(0, max);
  if (salida.length >= max) return salida;
  const r = await huecosDelCaso({
    preferencia: p.preferencia,
    tratamientoTexto: null,
    tratamientoId: p.tratamientoId,
    doctorId: p.doctorId,
    clinicaId: p.clinicaId,
    max: max + p.excluir.length + salida.length,
    ahora: p.ahora,
  });
  for (const h of r.huecos) {
    if (salida.length >= max) break;
    if (salida.some((s) => mismoHueco(s, h)) || p.excluir.some((e) => mismoHueco(e, h))) continue;
    salida.push(h);
  }
  return salida;
}

// ─── Enviar la oferta ───────────────────────────────────────────────────────

export type ResultadoOferta =
  | { ok: true; oferta: Oferta; simulado: boolean; modo: "waba" | "manual" }
  | { ok: false; motivo: "lead_no_existe" | "sin_agenda_en_fyllio" | "sin_alternativas" | "demasiadas" | "ocupadas" | "texto_no_coincide" | "opt_out" | "fallo_envio"; ocupadas?: Alternativa[]; libres?: Alternativa[]; esperado?: string; detalle?: string };

async function enviarAlPaciente(p: { telefono: string; leadId: string; texto: string; autor: "persona" | "agente"; idempotencyKey: string }): Promise<{ ok: true; mensajeId: string; simulado: boolean; modo: "waba" | "manual" } | { ok: false }> {
  const simulado = await hiloJugado(p.telefono);
  const modo: "waba" | "manual" = !simulado && hasWABACredentials() ? "waba" : "manual";
  const r = await getServicioMensajeria(modo).enviarMensaje({
    leadId: p.leadId,
    telefono: p.telefono,
    contenido: p.texto,
    autor: p.autor,
    sugeridoPorIa: false,
    ...(simulado ? { fuente: FUENTE_SIMULACION } : {}),
    idempotencyKey: p.idempotencyKey,
  });
  if (!r.ok) return { ok: false };
  return { ok: true, mensajeId: r.mensajeId, simulado, modo };
}

export type VarianteOferta = { tipo: "oferta" } | { tipo: "se_ocupo"; ocupada: Alternativa } | { tipo: "todas_ocupadas" };

/** El texto EXACTO que saldría: lo que la coordinadora ve antes de pulsar y
 *  lo que el servidor exige que coincida al enviar. */
export async function textoDeOferta(p: { nombre: string; alternativas: readonly Alternativa[]; tratamientoId: string | null; variante?: VarianteOferta }): Promise<string> {
  const cliente = requireCliente("textoDeOferta");
  const variante = p.variante ?? { tipo: "oferta" };
  if (variante.tipo === "se_ocupo") return textoSeOcupo({ nombre: p.nombre, ocupada: variante.ocupada, restantes: p.alternativas });
  if (variante.tipo === "todas_ocupadas") return textoTodasOcupadas({ nombre: p.nombre, nuevas: p.alternativas });
  const tratamientoNombre = p.tratamientoId
    ? await runWithClienteDb(cliente, async (trx) => {
        const r: any = await sql`select nombre from tratamientos where id = ${p.tratamientoId}`.execute(trx);
        return (r.rows?.[0]?.nombre as string | undefined) ?? null;
      })
    : null;
  return textoOferta({ nombre: p.nombre, alternativas: p.alternativas, tratamiento: tratamientoNombre });
}

/** Envía una oferta (o la que sustituye a otra). Recomprueba cada hueco antes
 *  de enviar: si alguno se ocupó, NO manda nada y devuelve cuáles. `texto`,
 *  si viene, tiene que ser EXACTAMENTE el que se compone (el clic es la
 *  revisión). */
export async function crearOferta(p: {
  telefono: string;
  leadId: string;
  alternativas: readonly Alternativa[];
  tratamientoId: string | null;
  /** Qué mensaje lleva: la oferta normal, o el «se ocupó» / «todas ocupadas» que sustituye a la anterior. */
  variante?: VarianteOferta;
  texto?: string;
  ahora?: Date;
}): Promise<ResultadoOferta> {
  const cliente = requireCliente("crearOferta");
  const ahora = p.ahora ?? new Date();
  const lead = await getLead(p.leadId);
  if (!lead) return { ok: false, motivo: "lead_no_existe" };
  const enFyllio = await runWithClienteDb(cliente, (trx) => leerAgendaEnFyllio(trx));
  if (!enFyllio) return { ok: false, motivo: "sin_agenda_en_fyllio" };
  if (p.alternativas.length === 0) return { ok: false, motivo: "sin_alternativas" };
  if (p.alternativas.length > MAX_ALTERNATIVAS) return { ok: false, motivo: "demasiadas" };

  const clinicaId = p.alternativas[0]!.clinicaId ?? lead.clinicaId ?? null;
  const comp = await comprobarAlternativas({ alternativas: p.alternativas, tratamientoId: p.tratamientoId, clinicaId, ahora });
  if (comp.ocupadas.length > 0) return { ok: false, motivo: "ocupadas", ocupadas: comp.ocupadas, libres: comp.libres, detalle: comp.motivo ?? undefined };

  const esperado = await textoDeOferta({ nombre: lead.nombre, alternativas: p.alternativas, tratamientoId: p.tratamientoId, variante: p.variante });
  if (p.texto != null && p.texto !== esperado) return { ok: false, motivo: "texto_no_coincide", esperado };
  if ((await envioBloqueadoPorOptOut(p.telefono)).bloqueado) return { ok: false, motivo: "opt_out" };

  const huella = p.alternativas.map((a) => `${a.fecha}T${a.hora}@${a.doctorId}`).join("|");
  const envio = await enviarAlPaciente({ telefono: p.telefono, leadId: p.leadId, texto: esperado, autor: "persona", idempotencyKey: `oferta:${p.leadId}:${huella}:${ahora.getTime()}` });
  if (!envio.ok) return { ok: false, motivo: "fallo_envio" };

  const vence = caducaEn(p.alternativas, ahora);
  const oferta = await runWithClienteDb(cliente, async (trx) => {
    // La anterior (abierta, elegida o caducada) queda sustituida: una
    // elección que llegue a ELLA ya es tardía por definición.
    await sql`update ofertas_hueco set estado = 'reemplazada', updated_at = now()
        where telefono = ${p.telefono} and estado in ('abierta', 'elegida', 'caducada')`.execute(trx);
    const r: any = await sql`insert into ofertas_hueco
        (cliente, telefono, lead_id, clinica_id, tratamiento_id, alternativas, texto, mensaje_id, enviada_en, caduca_en, estado)
        values (${cliente}, ${p.telefono}, ${p.leadId}, ${clinicaId}, ${p.tratamientoId}, ${JSON.stringify(p.alternativas)}::jsonb, ${esperado}, ${envio.mensajeId}, ${ahora}, ${vence}, 'abierta')
        returning *`.execute(trx);
    return filaAOferta(r.rows[0], ahora);
  });
  return { ok: true, oferta, simulado: envio.simulado, modo: envio.modo };
}

// ─── La respuesta del paciente ──────────────────────────────────────────────

/** Persiste lo que el evaluador decidió sobre la oferta (índice elegido, o
 *  null si no se entendió / no se interpretó) y ENCOLA el acuse. La reserva
 *  NO se hace aquí: la hace la coordinadora de un clic. */
export async function registrarRespuestaAOferta(p: {
  ofertaId: string;
  indice: number | null;
  mensajeId: string | null;
  ahora?: Date;
}): Promise<{ oferta: Oferta; tardia: boolean } | null> {
  const cliente = requireCliente("registrarRespuestaAOferta");
  const ahora = p.ahora ?? new Date();
  const o = await ofertaPorId(p.ofertaId, ahora);
  if (!o) return null;
  const indice = p.indice != null && p.indice >= 0 && p.indice < o.alternativas.length ? p.indice : null;
  const tardia = eleccionTardia(o, ahora, indice);
  const estadoNuevo: EstadoOferta = o.estado === "abierta" ? "elegida" : o.estado;
  await runWithClienteDb(cliente, (trx) =>
    sql`update ofertas_hueco set estado = ${estadoNuevo}, eleccion = ${indice}, eleccion_en = ${ahora}, eleccion_tardia = ${tardia},
          eleccion_mensaje_id = ${p.mensajeId}, acuse_enviado_en = null, updated_at = now() where id = ${o.id}`.execute(trx),
  );
  const oferta: Oferta = { ...o, estado: estadoNuevo, eleccion: indice, eleccionEn: ahora, eleccionTardia: tardia, acuseEnviadoEn: null };
  await encolarAcuse(oferta, ahora);
  return { oferta, tardia };
}

/** El agente pidió aclarar cuál (una vez; a la segunda deriva). */
export async function anotarDesambiguacion(ofertaId: string): Promise<void> {
  const cliente = requireCliente("anotarDesambiguacion");
  await runWithClienteDb(cliente, (trx) => sql`update ofertas_hueco set desambiguaciones = desambiguaciones + 1, updated_at = now() where id = ${ofertaId}`.execute(trx));
}

async function horarioDeClinica(clinicaId: string | null) {
  try {
    const { conocimientoDeClinica } = await import("../automatizacion/pg");
    const c = await conocimientoDeClinica(clinicaId);
    return c.plazos.horario ?? HORARIO_DEFAULT;
  } catch {
    return HORARIO_DEFAULT;
  }
}

async function encolarAcuse(o: Oferta, ahora: Date): Promise<void> {
  const cliente = requireCliente("encolarAcuse");
  const abierta = clinicaAbierta(ahora, await horarioDeClinica(o.clinicaId));
  const retardoSeg = abierta ? ACUSE_RETARDO_MIN * 60 : 0;
  const { encolar } = await import("../cola/qstash");
  const r = await encolar({ tipo: "acuse_oferta", cliente, ofertaId: o.id, telefono: o.telefono, clinicaId: o.clinicaId }, { retardoSeg });
  if (!r.encolado) {
    // Sin cola no hay retardo posible: sale ya (también dentro de horario).
    // Un doblete raro es mejor que dos horas de silencio con el paciente
    // esperando; Ajustes → Incidencias ya dice que falta el token.
    await acuseDeEleccion({ ofertaId: o.id, ahora });
  }
}

export type ResultadoAcuse = { enviado: true; mensajeId: string } | { enviado: false; motivo: "no_existe" | "sin_eleccion" | "ya_acusado" | "ya_reservada" | "ya_se_le_escribio" | "opt_out" | "fallo_envio" };

/** EL ACUSE, cuando la cola lo entrega. Sale SOLO si la elección sigue sin
 *  atender: nadie reservó, y no se le ha escrito NADA desde que eligió
 *  (condición de Simon: si ella ya mandó «se acaba de ocupar», un acuse
 *  diciendo que lo está comprobando se contradice). */
export async function acuseDeEleccion(p: { ofertaId: string; ahora?: Date }): Promise<ResultadoAcuse> {
  const cliente = requireCliente("acuseDeEleccion");
  const ahora = p.ahora ?? new Date();
  const o = await ofertaPorId(p.ofertaId, ahora);
  if (!o) return { enviado: false, motivo: "no_existe" };
  if (!o.eleccionEn) return { enviado: false, motivo: "sin_eleccion" };
  if (o.acuseEnviadoEn) return { enviado: false, motivo: "ya_acusado" };
  if (o.estado === "reservada" || o.estado === "reemplazada" || o.citaId) return { enviado: false, motivo: "ya_reservada" };
  const escrito = await runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`select 1 from mensajes_whatsapp
        where telefono = ${o.telefono} and direccion = 'Saliente' and "timestamp" > ${o.eleccionEn}
          and coalesce(fuente, '') <> 'Modo_A_manual_pendiente' limit 1`.execute(trx);
    if (r.rows?.length) return true;
    const c: any = await sql`select 1 from citas where lead_id = ${o.leadId} and hora_inicio >= now() and estado in ('Programada', 'Confirmada') limit 1`.execute(trx);
    return Boolean(c.rows?.length);
  });
  if (escrito) return { enviado: false, motivo: "ya_se_le_escribio" };
  if ((await envioBloqueadoPorOptOut(o.telefono)).bloqueado) return { enviado: false, motivo: "opt_out" };

  const lead = await getLead(o.leadId);
  const abierta = clinicaAbierta(ahora, await horarioDeClinica(o.clinicaId));
  const alternativa = o.eleccion != null ? (o.alternativas[o.eleccion] ?? null) : null;
  const texto = textoAcuse({ nombre: lead?.nombre ?? "", alternativa, abierta });
  const envio = await enviarAlPaciente({ telefono: o.telefono, leadId: o.leadId, texto, autor: "agente", idempotencyKey: `acuse-oferta:${o.id}:${o.eleccionEn.getTime()}` });
  if (!envio.ok) return { enviado: false, motivo: "fallo_envio" };
  await runWithClienteDb(cliente, (trx) =>
    sql`update ofertas_hueco set acuse_enviado_en = ${ahora}, acuse_mensaje_id = ${envio.mensajeId}, updated_at = now() where id = ${o.id}`.execute(trx),
  );
  return { enviado: true, mensajeId: envio.mensajeId };
}

// ─── Reservar de un clic ────────────────────────────────────────────────────

export type ResultadoReserva =
  | { ok: true; alternativa: Alternativa; citaId: string; confirmacion: ResultadoConfirmacion; textoConfirmacion: string }
  | { ok: false; motivo: "sin_oferta" | "sin_eleccion" | "lead_no_existe" | "sin_agenda_en_fyllio" | "ya_reservada"; detalle?: string }
  | {
      ok: false;
      motivo: "ocupado";
      ocupada: Alternativa;
      /** Lo que se le puede mandar YA ESCRITO: las que siguen libres más las de repuesto. Vacío = no hay horas. */
      restantes: Alternativa[];
      texto: string;
      variante: "se_ocupo" | "todas_ocupadas" | "sin_huecos";
    };

/** La coordinadora reserva la alternativa que eligió el paciente (o la que
 *  elige ella si no se entendió). Recomprueba; si se ocupó, no manda nada y
 *  devuelve el mensaje corregido para que lo envíe de un clic. */
export async function reservarEleccion(p: {
  telefono: string;
  /** Manda sobre la elección del paciente (cuando no se entendió cuál, o la coordinadora prefiere otra de la lista). */
  indice?: number | null;
  preferencia?: PreferenciaCita | null;
  ahora?: Date;
}): Promise<ResultadoReserva> {
  const cliente = requireCliente("reservarEleccion");
  const ahora = p.ahora ?? new Date();
  const o = await ofertaDelCaso(p.telefono, { ahora });
  if (!o || o.estado === "reemplazada") return { ok: false, motivo: "sin_oferta" };
  if (o.estado === "reservada" || o.citaId) return { ok: false, motivo: "ya_reservada" };
  const indice = p.indice ?? o.eleccion;
  if (indice == null || indice < 0 || indice >= o.alternativas.length) return { ok: false, motivo: "sin_eleccion" };
  const alt = o.alternativas[indice]!;
  const lead = await getLead(o.leadId);
  if (!lead) return { ok: false, motivo: "lead_no_existe" };
  const enFyllio = await runWithClienteDb(cliente, (trx) => leerAgendaEnFyllio(trx));
  if (!enFyllio) return { ok: false, motivo: "sin_agenda_en_fyllio" };

  const comp = await comprobarAlternativas({ alternativas: o.alternativas, tratamientoId: o.tratamientoId, clinicaId: o.clinicaId, ahora });
  if (!comp.libres.some((l) => mismoHueco(l, alt))) {
    const vivas = comp.libres;
    const restantes = await alternativasDeRepuesto({ vivas, excluir: o.alternativas, preferencia: p.preferencia ?? null, tratamientoId: o.tratamientoId, doctorId: null, clinicaId: o.clinicaId, ahora });
    const variante = restantes.length === 0 ? "sin_huecos" : vivas.length > 0 ? "se_ocupo" : "todas_ocupadas";
    const texto =
      variante === "sin_huecos"
        ? textoSinHuecos({ nombre: lead.nombre })
        : variante === "se_ocupo"
          ? textoSeOcupo({ nombre: lead.nombre, ocupada: alt, restantes })
          : textoTodasOcupadas({ nombre: lead.nombre, nuevas: restantes });
    return { ok: false, motivo: "ocupado", ocupada: alt, restantes, texto, variante };
  }

  // Reservar: lo mismo que el PATCH del lead de siempre.
  const updated = await updateLead(o.leadId, { estado: "Citado", fechaCita: alt.fecha, horaCita: alt.hora, doctorAsignadoId: alt.doctorId });
  const { citaId } = await upsertCitaDeLead({
    cliente,
    lead: { id: updated.id, nombre: updated.nombre, clinicaId: updated.clinicaId ?? null, pacienteId: updated.pacienteId ?? null, fechaCita: alt.fecha, horaCita: alt.hora, doctorAsignadoId: alt.doctorId },
    tratamientoId: o.tratamientoId,
  });
  await runWithClienteDb(cliente, (trx) =>
    sql`update ofertas_hueco set estado = 'reservada', eleccion = ${indice}, cita_id = ${citaId}, updated_at = now() where id = ${o.id}`.execute(trx),
  );
  // Confirmar: la plantilla de siempre, autor persona, sin juez.
  const textoConfirmacion = textoConfirmacionCita({ nombre: updated.nombre, fecha: alt.fecha, hora: alt.hora, doctor: alt.doctorNombre || null, clinica: alt.clinicaNombre });
  const confirmacion = await confirmarCitaAlPaciente({ telefono: p.telefono, leadId: o.leadId, texto: textoConfirmacion });
  return { ok: true, alternativa: alt, citaId, confirmacion, textoConfirmacion };
}

// ─── Sin huecos (opción b) ──────────────────────────────────────────────────

export type ResultadoSinHuecos =
  | { ok: true; mensajeId: string; simulado: boolean }
  | { ok: false; motivo: "lead_no_existe" | "texto_no_coincide" | "opt_out" | "fallo_envio"; esperado?: string };

/** Se ocuparon todas y no hay otras: se le dice (texto aprobado) y el caso
 *  pasa a una persona con causa `sin_huecos` (plazo: al abrir la clínica).
 *  La oferta vieja queda sustituida. */
export async function avisarSinHuecos(p: { telefono: string; leadId: string; texto: string; actorNombre?: string | null; ahora?: Date }): Promise<ResultadoSinHuecos> {
  const cliente = requireCliente("avisarSinHuecos");
  const ahora = p.ahora ?? new Date();
  const lead = await getLead(p.leadId);
  if (!lead) return { ok: false, motivo: "lead_no_existe" };
  const esperado = textoSinHuecos({ nombre: lead.nombre });
  if (p.texto !== esperado) return { ok: false, motivo: "texto_no_coincide", esperado };
  if ((await envioBloqueadoPorOptOut(p.telefono)).bloqueado) return { ok: false, motivo: "opt_out" };
  const envio = await enviarAlPaciente({ telefono: p.telefono, leadId: p.leadId, texto: esperado, autor: "persona", idempotencyKey: `sin-huecos:${p.leadId}:${ahora.getTime()}` });
  if (!envio.ok) return { ok: false, motivo: "fallo_envio" };
  await runWithClienteDb(cliente, (trx) =>
    sql`update ofertas_hueco set estado = 'reemplazada', updated_at = now() where telefono = ${p.telefono} and estado in ('abierta', 'elegida', 'caducada')`.execute(trx),
  );
  const { registrarEventoIdempotente } = await import("../automatizacion/pg");
  await registrarEventoIdempotente({
    tipoCaso: "conversacion",
    casoId: p.telefono,
    evento: "derivado",
    causaDerivacion: "sin_huecos",
    objetivoActivo: "cita",
    motivoTexto: "se ocuparon todas las horas propuestas y no hay otras en los próximos días",
    actorNombre: p.actorNombre ?? "coordinadora",
    mensajeId: envio.mensajeId,
  });
  return { ok: true, mensajeId: envio.mensajeId, simulado: envio.simulado };
}

/** Los motivos en lenguaje de coordinadora (los usan las rutas). */
export const MENSAJE_MOTIVO_OFERTA: Record<string, string> = {
  lead_no_existe: "Lead no encontrado",
  sin_agenda_en_fyllio: "La agenda no vive en Fyllio: no se pueden proponer horas como reales. Anota la cita y confírmala en tu software.",
  sin_alternativas: "Elige al menos una hora.",
  demasiadas: `Como mucho ${MAX_ALTERNATIVAS} horas por mensaje: más es marear al paciente.`,
  ocupadas: "Alguna de esas horas se acaba de ocupar. No se ha enviado nada: revisa la lista.",
  texto_no_coincide: "El mensaje cambió desde que lo viste. Vuelve a mirarlo.",
  opt_out: "Esta persona pidió no recibir mensajes. Solo se le puede contestar cuando escribe ella.",
  fallo_envio: "No se pudo enviar el mensaje",
  sin_oferta: "No hay ninguna propuesta de horas abierta para este caso.",
  sin_eleccion: "No consta qué hora eligió: elige tú una de la lista.",
  ya_reservada: "Esa propuesta ya se reservó.",
};
