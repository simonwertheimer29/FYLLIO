// app/lib/automatizacion/semaforo.ts
//
// EL SEMÁFORO DE CONTACTO (aprobado 2026-08-17). Un solo criterio, lo miran
// los dos lados antes de hablar: el evaluador antes de contestar y las
// cadencias/automatizaciones antes de dispararse. Sin esto, el seguimiento
// a los N días se dispara justo mientras la coordinadora está negociando.
//
//   ROJO ⇔ hay un asunto derivado sin resolver con una persona
//        ∨ alguien dijo «este hilo es mío» y no lo soltó
//        ∨ hay una espera vigente («sin contacto hasta [fecha]»)
//
// EL DISPARADOR DE LA VUELTA NO ES UN MENSAJE, ES EL CIERRE DEL ASUNTO.
// «El agente vuelve cuando una persona responde» se descartó a propósito:
// metería al agente encima de la coordinadora mientras cierra el caso. El
// asunto se cierra con un HECHO DEL SISTEMA (la cita existe, el cobro está,
// el presupuesto se cerró) o con `resuelto_manual` — nunca con quién habló
// último. Y sin expiración por tiempo: caducar taparía el fallo en vez de
// enseñarlo; la presión es el censo de rojos con su edad (`censoSemaforo`).
//
// QUÉ HECHO CIERRA CADA CAUSA (mapeo aprobado; sin hecho observable → solo
// manual, sin inventar):
//   urgencia            → cita CREADA después del derivado · si no, manual
//   antecedente_medico  → la cita próxima se celebró (hora_inicio entre el
//                         derivado y ahora) · si no, manual
//   caso_completo·cita  → cita creada después del derivado (paciente) o
//                         cambio de estado del lead posterior · o el objetivo
//                         dejó de estar abierto
//   caso_completo·cobro/presupuesto/identificar → el objetivo dejó de estar
//                         abierto (pendiente=0, sin presupuestos vivos,
//                         identidad resuelta) — estado ACTUAL, que para
//                         hechos monótonos no necesita timestamp
//   peticion_queja      → SOLO manual (una queja atendida no deja fila)
//   insistencia         → SOLO manual (el botón «pendiente respondido» es el
//                         emisor natural de aplazado_resuelto, fase C)
//
// Los «qué está abierto» los responde `contextoDeConversacion` — la misma
// semántica censada por QA que usa el evaluador, no una copia (§16).
//
// EXENTOS del semáforo, por criterio de producto (PLAN §3): los
// RECORDATORIOS DE CITA. La cita es un compromiso existente del paciente,
// no un contacto comercial — y son los mensajes RGPD-limpios.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO } from "../time";
import type { CausaDerivacion } from "./estado";
import type { EtapaObjetivo } from "./objetivos";

export type MotivoRojo = "derivado_sin_resolver" | "hilo_asumido" | "espera";

export type EstadoSemaforo = {
  verde: boolean;
  /** Solo en rojo. Si concurren varios, gana el asunto derivado (es el que
   *  exige a alguien) sobre el asumido, y este sobre la espera. */
  motivo?: MotivoRojo;
  /** En `derivado_sin_resolver`: la causa y el objetivo del derivado. */
  causa?: CausaDerivacion;
  objetivo?: EtapaObjetivo | null;
  /** En `derivado_sin_resolver`: la FRASE del paciente que lo provocó (el
   *  motivo_texto del derivado) — la ficha la enseña arriba cuando la causa
   *  es queja/petición (21-08): escribirle «como si nada» a alguien enfadado
   *  es el fallo que ese aviso evita. */
  frase?: string | null;
  /** ISO del evento que puso el rojo — para calcular la edad. */
  desde?: string;
  /** Solo en `espera`: hasta cuándo (YYYY-MM-DD, inclusive). */
  hasta?: string;
  /** Solo en `espera`: la frase que la fijó — el MOTIVO que el evaluador
   *  necesita para juzgar si un entrante «responde al motivo» (punto 5). */
  esperaMotivo?: string | null;
};

type EventoSemaforo = {
  caso_id: string;
  evento: string;
  causa_derivacion: CausaDerivacion | null;
  objetivo_activo: EtapaObjetivo | null;
  hasta: Date | string | null;
  motivo_texto: string | null;
  created_at: Date;
};

const EVENTOS_SEMAFORO = [
  "derivado",
  "resuelto_manual",
  "asumido_manual",
  "soltado",
  "espera_fijada",
  "espera_levantada",
] as const;

const soloDigitos = (raw: string): string => raw.replace(/[^0-9]/g, "");

/** Carga TODOS los eventos que mueven el semáforo, del cliente entero, en una
 *  consulta. Está acotado por diseño: aquí solo viven derivaciones, cierres,
 *  asumidos y esperas — nunca mensajes ni evaluaciones. El matching contra
 *  teléfonos de candidatos es por dígitos (la semántica de todo el sistema),
 *  y eso exige tener los caso_id delante, no un WHERE exacto. */
async function cargarEventosSemaforo(): Promise<EventoSemaforo[]> {
  const cliente = requireCliente("cargarEventosSemaforo");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select caso_id, evento, causa_derivacion, objetivo_activo, hasta, motivo_texto, created_at
        from eventos_automatizacion
        where tipo_caso = 'conversacion'
          and evento in ('derivado','resuelto_manual','asumido_manual','soltado','espera_fijada','espera_levantada')
        order by created_at asc`.execute(trx),
  );
  return (r.rows ?? []) as EventoSemaforo[];
}

/** El semáforo de UN hilo, a partir de sus eventos ya ordenados. Puro. */
function derivarDeEventos(eventos: EventoSemaforo[], hoy: string): Omit<EstadoSemaforo, "verde"> & { verde: boolean; pendienteHechos: EventoSemaforo | null } {
  // 1 · Asunto derivado: manda el ÚLTIMO derivado. Está abierto salvo
  //     resuelto_manual posterior; los hechos del sistema se comprueban
  //     después (cuestan consultas y solo hacen falta si sigue candidato).
  const derivados = eventos.filter((e) => e.evento === "derivado");
  const ultimoDerivado = derivados[derivados.length - 1] ?? null;
  let derivadoAbierto: EventoSemaforo | null = null;
  if (ultimoDerivado) {
    const resueltoDespues = eventos.some(
      (e) => e.evento === "resuelto_manual" && e.created_at > ultimoDerivado.created_at,
    );
    if (!resueltoDespues) derivadoAbierto = ultimoDerivado;
  }

  // 2 · «Este hilo es mío»: el último asumido_manual sin soltar. También lo
  //     suelta un resuelto_manual — quien marca resuelto no retiene el hilo.
  const asumidos = eventos.filter((e) => e.evento === "asumido_manual");
  const ultimoAsumido = asumidos[asumidos.length - 1] ?? null;
  const asumidoVigente =
    ultimoAsumido != null &&
    !eventos.some(
      (e) => (e.evento === "soltado" || e.evento === "resuelto_manual") && e.created_at > ultimoAsumido.created_at,
    );

  // 3 · Espera: la última espera_fijada sin levantar y sin vencer. La fecha es
  //     día de clínica (§13), inclusive: «hasta el viernes» cubre el viernes.
  const esperas = eventos.filter((e) => e.evento === "espera_fijada");
  const ultimaEspera = esperas[esperas.length - 1] ?? null;
  let esperaVigente: { desde: string; hasta: string; motivo: string | null } | null = null;
  if (ultimaEspera?.hasta != null) {
    const levantadaDespues = eventos.some(
      (e) => e.evento === "espera_levantada" && e.created_at > ultimaEspera.created_at,
    );
    const hasta =
      ultimaEspera.hasta instanceof Date ? hoyISO(ultimaEspera.hasta) : String(ultimaEspera.hasta).slice(0, 10);
    if (!levantadaDespues && hasta >= hoy) {
      esperaVigente = { desde: ultimaEspera.created_at.toISOString(), hasta, motivo: ultimaEspera.motivo_texto };
    }
  }

  if (derivadoAbierto) {
    return {
      verde: false,
      motivo: "derivado_sin_resolver",
      causa: derivadoAbierto.causa_derivacion ?? undefined,
      frase: derivadoAbierto.motivo_texto ?? null,
      objetivo: derivadoAbierto.objetivo_activo ?? null,
      desde: derivadoAbierto.created_at.toISOString(),
      pendienteHechos: derivadoAbierto,
    };
  }
  if (asumidoVigente && ultimoAsumido) {
    return { verde: false, motivo: "hilo_asumido", desde: ultimoAsumido.created_at.toISOString(), pendienteHechos: null };
  }
  if (esperaVigente) {
    return {
      verde: false,
      motivo: "espera",
      desde: esperaVigente.desde,
      hasta: esperaVigente.hasta,
      esperaMotivo: esperaVigente.motivo,
      pendienteHechos: null,
    };
  }
  return { verde: true, pendienteHechos: null };
}

/** ¿Algún hecho del sistema cierra este derivado? Consulta datos REALES por
 *  hilo — solo se llama para derivados aún candidatos a abiertos, que es un
 *  conjunto pequeño por construcción (mientras hay uno abierto, el agente no
 *  vuelve a derivar). Sin hecho observable para la causa → false, sin
 *  inventar (decisión 2026-08-17): lo cierra `resuelto_manual`. */
async function hechoCierra(derivado: EventoSemaforo): Promise<boolean> {
  const causa = derivado.causa_derivacion;
  if (causa === "peticion_queja" || causa === "insistencia") return false;

  const cliente = requireCliente("hechoCierra");
  const { contextoDeConversacion } = await import("../agente/contexto-conversacion");
  const ctx = await contextoDeConversacion(derivado.caso_id);

  if (causa === "urgencia" || (causa === "caso_completo" && derivado.objetivo_activo === "cita")) {
    // La clínica ACTUÓ: existe una cita creada después de la entrega.
    if (ctx.pacienteId) {
      const r: any = await runWithClienteDb(cliente, (trx) =>
        sql`select 1 from citas
            where paciente_id = ${ctx.pacienteId} and created_at > ${derivado.created_at}
            limit 1`.execute(trx),
      );
      if (r.rows?.length) return true;
    }
    if (causa === "caso_completo" && ctx.leadActivo) {
      const r: any = await runWithClienteDb(cliente, (trx) =>
        sql`select 1 from acciones_lead
            where lead_id = ${ctx.leadActivo!.id} and tipo_accion = 'Cambio_Estado'
              and created_at > ${derivado.created_at}
            limit 1`.execute(trx),
      );
      if (r.rows?.length) return true;
    }
    // caso_completo·cita también cierra si el objetivo dejó de estar abierto
    // (el lead se convirtió o se cerró). La urgencia NO: su asunto es la
    // atención, no el objetivo comercial.
    if (causa === "caso_completo") return !ctx.objetivosAbiertos.includes("cita");
    return false;
  }

  if (causa === "antecedente_medico") {
    // La derivación era «revísalo antes de la cita»: la cita se celebró.
    if (!ctx.pacienteId) return false;
    const r: any = await runWithClienteDb(cliente, (trx) =>
      sql`select 1 from citas
          where paciente_id = ${ctx.pacienteId}
            and hora_inicio > ${derivado.created_at} and hora_inicio <= now()
          limit 1`.execute(trx),
    );
    return Boolean(r.rows?.length);
  }

  if (causa === "caso_completo") {
    const objetivo = derivado.objetivo_activo;
    // Sin objetivo persistido (derivados pre-026) no hay hecho atribuible.
    if (!objetivo) return false;
    // cobro/presupuesto/identificar: hechos monótonos — si el objetivo ya no
    // está abierto (pendiente=0, sin vivos, identidad resuelta), el asunto que
    // se entregó está cumplido. No necesita timestamp: derivó ABIERTO.
    return !ctx.objetivosAbiertos.includes(objetivo);
  }

  return false;
}

/** El instante se inyecta desde el borde (§14): los recorridos del QA
 *  necesitan «vencer» esperas sin esperar al jueves. Default: hoy real. */
export type OpcionesSemaforo = { hoy?: string };

/** El semáforo de un hilo. Lee el log + los hechos. */
export async function semaforoDeContacto(telefono: string, opts?: OpcionesSemaforo): Promise<EstadoSemaforo> {
  const todos = await cargarEventosSemaforo();
  const dig = soloDigitos(telefono);
  const propios = todos.filter((e) => {
    const d = soloDigitos(e.caso_id);
    return d.includes(dig) || dig.includes(d);
  });
  return resolverConHechos(propios, opts?.hoy);
}

/**
 * Versión EN LOTE, para las cadencias: una consulta de eventos para toda la
 * cola y el matching por dígitos en memoria. Devuelve una función y no un
 * mapa a propósito: los teléfonos de los candidatos llegan en formatos
 * distintos («+34 613 128 152» vs «34613128152») y la clave del mapa los
 * partiría en dos — mismo bug que ya partió la bandeja (migración 018).
 */
export async function semaforosParaCadencia(opts?: OpcionesSemaforo): Promise<(telefono: string | null | undefined) => Promise<EstadoSemaforo>> {
  const todos = await cargarEventosSemaforo();
  const cache = new Map<string, EstadoSemaforo>();
  return async (telefono) => {
    const dig = soloDigitos(String(telefono ?? ""));
    if (!dig) return { verde: true }; // sin teléfono no hay hilo que proteger
    const hit = cache.get(dig);
    if (hit) return hit;
    const propios = todos.filter((e) => {
      const d = soloDigitos(e.caso_id);
      return d.includes(dig) || dig.includes(d);
    });
    const estado = await resolverConHechos(propios, opts?.hoy);
    cache.set(dig, estado);
    return estado;
  };
}

async function resolverConHechos(eventos: EventoSemaforo[], hoyInyectado?: string): Promise<EstadoSemaforo> {
  const hoy = hoyInyectado ?? hoyISO();
  const base = derivarDeEventos(eventos, hoy);
  if (base.pendienteHechos) {
    if (await hechoCierra(base.pendienteHechos)) {
      // El asunto se cerró por hecho del sistema: se re-deriva SIN el derivado
      // (puede quedar debajo un asumido o una espera vigentes).
      const sinDerivado = eventos.filter((e) => e.evento !== "derivado");
      const resto = derivarDeEventos(sinDerivado, hoy);
      const { pendienteHechos: _r, ...estadoResto } = resto;
      return estadoResto;
    }
  }
  const { pendienteHechos: _p, ...estado } = base;
  return estado;
}

// ─── El censo: el número que se mira ────────────────────────────────────────
//
// El semáforo es el único punto por el que todo el producto puede enmudecer,
// y lo haría EN SILENCIO — el fallo que más ha costado. El censo es la
// alarma: cuántos hilos están en rojo, por qué causa, y desde hace cuánto.
// Si la cifra sube, algo va mal. Y la lista de derivados sin resolver con su
// edad es LA presión que sustituye a la caducidad descartada: nada expira
// solo, pero envejecer a la vista de todos.

export type FilaCensoSemaforo = {
  telefono: string;
  motivo: MotivoRojo;
  causa: CausaDerivacion | null;
  objetivo: EtapaObjetivo | null;
  desde: string;
  edadDias: number;
  hasta: string | null;
};

export type CensoSemaforo = {
  /** Hilos con algún evento de semáforo (el universo evaluado). */
  hilosConHistorial: number;
  enRojo: number;
  porMotivo: Record<MotivoRojo, number>;
  porCausa: Partial<Record<CausaDerivacion, number>>;
  /** Todos los rojos, los más viejos primero — la lista de presión. */
  filas: FilaCensoSemaforo[];
};

export async function censoSemaforo(opts?: OpcionesSemaforo): Promise<CensoSemaforo> {
  const todos = await cargarEventosSemaforo();
  // Se agrupa por DÍGITOS, no por el string del caso_id: el mismo hilo puede
  // tener eventos con «+34 613 128 152» y «+34613128152» (el derivado del
  // evaluador usa la clave del hilo; un resuelto manual puede llegar en otro
  // formato) y partirlo en dos leería un rojo y un verde donde hay UNO.
  const porCaso = new Map<string, { telefono: string; eventos: EventoSemaforo[] }>();
  for (const e of todos) {
    const clave = soloDigitos(e.caso_id) || e.caso_id;
    const grupo = porCaso.get(clave) ?? { telefono: e.caso_id, eventos: [] };
    grupo.eventos.push(e);
    porCaso.set(clave, grupo);
  }

  const hoy = opts?.hoy ?? hoyISO();
  const filas: FilaCensoSemaforo[] = [];
  for (const [, { telefono, eventos }] of porCaso) {
    const estado = await resolverConHechos(eventos, hoy);
    if (estado.verde || !estado.motivo || !estado.desde) continue;
    const edadDias = Math.max(
      0,
      Math.round(
        (new Date(`${hoy}T00:00:00Z`).getTime() - new Date(`${hoyISO(new Date(estado.desde))}T00:00:00Z`).getTime()) /
          86_400_000,
      ),
    );
    filas.push({
      telefono,
      motivo: estado.motivo,
      causa: estado.causa ?? null,
      objetivo: estado.objetivo ?? null,
      desde: estado.desde,
      edadDias,
      hasta: estado.hasta ?? null,
    });
  }
  filas.sort((a, b) => b.edadDias - a.edadDias);

  const porMotivo: Record<MotivoRojo, number> = { derivado_sin_resolver: 0, hilo_asumido: 0, espera: 0 };
  const porCausa: Partial<Record<CausaDerivacion, number>> = {};
  for (const f of filas) {
    porMotivo[f.motivo]++;
    if (f.causa) porCausa[f.causa] = (porCausa[f.causa] ?? 0) + 1;
  }
  return { hilosConHistorial: porCaso.size, enRojo: filas.length, porMotivo, porCausa, filas };
}

export const ETIQUETA_MOTIVO_ROJO: Record<MotivoRojo, string> = {
  derivado_sin_resolver: "Asunto derivado sin resolver",
  hilo_asumido: "Hilo asumido por una persona",
  espera: "En espera (sin contacto hasta fecha)",
};
