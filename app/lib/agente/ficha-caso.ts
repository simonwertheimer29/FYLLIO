// app/lib/agente/ficha-caso.ts
//
// LA FICHA DEL CASO (fase B, aprobada 2026-08-17): lo que ve la coordinadora
// al abrir un caso entregado por el agente, para actuar sin releer el hilo
// ni repreguntar lo ya recogido.
//
// UNA SOLA FICHA: esta función es la única fuente — Seguimiento la despliega
// y Mensajería la monta en su columna derecha. NADA de aquí se persiste:
// todo se deriva al leer, de fuentes que ya existen (semáforo, log de
// eventos, mensajes, historial). Si dos pantallas enseñaran cosas distintas
// del mismo caso, sería un bug de esta función, no de las pantallas.
//
// REGLA DE DISEÑO (dictada): la ficha es corta. Cada campo nuevo le quita
// fuerza al primero — si algo no cambia lo que la coordinadora hará en el
// próximo minuto, no entra.
//
// HONESTIDAD (caso a): un hilo SIN evaluación del agente lo dice con todas
// las letras (`evaluado: false`, `queQuiere: null`) — ni blanco ni resumen
// fingido. La frase de «qué quiere» la compone CÓDIGO desde los campos
// recogidos, nunca un resumen generado que habría que verificar.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { contextoDeConversacion } from "./contexto-conversacion";
import { elegirPresupuestoActivo } from "../seguimiento/presupuesto-activo";
import { semaforoDeContacto, type EstadoSemaforo } from "../automatizacion/semaforo";
import {
  pendientesDeAplazados,
  ETIQUETA_CLAVE,
  type ClaveAplazado,
  type EventoAplazamiento,
} from "../automatizacion/aplazamientos";
import type { EtapaObjetivo } from "../automatizacion/objetivos";
import { estadoDeLaPersona, objetivoActivoDe, queQuiereDe, type EstadoPersona } from "./estado-persona";
import { fechaCorta } from "../agenda/fechas";
import { fechaClinica, horaClinica, hoyISO } from "../time";
import { leerPayloadEvaluacion, type PayloadEvaluacion } from "./persistir-turno";
import type { PreferenciaCita } from "./evaluador";
import { buscarLeadActivoPorTelefono, getLead } from "../leads/leads";
import { estadoBorradorDe, type EstadoBorrador } from "./borrador-agente";
import { optOutDeTelefono, type EstadoOptOut } from "../contacto/optout";
import { consentimientoDeTelefono, type EstadoConsentimiento } from "../contacto/consentimiento";
import { hiloJugado } from "../mensajeria/hilo-jugado";

export type FichaCaso = {
  telefono: string;
  nombre: string;
  esPaciente: boolean;
  /** Hilo jugado (10-09): paciente simulado, agente real con traza. Del dato. */
  jugada: boolean;
  /** Para el aislamiento del caller (mejor esfuerzo, del contexto). */
  clinicaId: string | null;
  /** false = el agente NO ha evaluado este hilo (caso a): la ficha lo dice,
   *  no lo rellena. */
  evaluado: boolean;

  // ── 16-09 · LA FICHA DE CUATRO BLOQUES (MEJORAS 253, paso 1) ──
  /** Bloque 1: el ESTADO del caso como etiqueta («Quiere cambiar su cita»,
   *  «Listo para cerrar»). Sale del semáforo, de la causa de entrega y del
   *  objetivo — lo mismo que la marca de la bandeja — nunca del modelo. */
  estado: EtiquetaEstado;
  /** Bloque 2: la descripción en frases, compuesta por CÓDIGO desde datos
   *  que ya existen (la cita, los campos, el contador de vueltas, el log).
   *  Vacía = no hay nada que decir. Lo pendiente va DENTRO, como una frase
   *  más, con su clave para poder marcarlo respondido. */
  descripcion: FraseDescripcion[];
  /** La cita del caso: la próxima del paciente (misma verdad que el
   *  `citaFutura` del contexto) o la del lead. */
  cita: CitaDelCaso | null;
  /** Paso 2 (16-09): la preferencia de cita ESTRUCTURADA, acumulada del log
   *  (la última que el modelo dio). Para el buscador de huecos del paso 3;
   *  la coordinadora sigue leyendo el texto. null = no la ha dicho. */
  preferenciaCita: PreferenciaCita | null;

  // ── Arriba del todo, antes de nada ──
  /** Lo único de la ficha que dice qué NO hacer: si hay espera vigente,
   *  escribir rompe la promesa que hizo el agente. */
  espera: { hasta: string; frase: string | null } | null;
  /** Qué se ha intentado ya: evita insistir a quien ya se escribió tres
   *  veces esta semana. Contado de mensajes, no juzgado. */
  intentos: { salientes: number; ultimo: string | null };

  // ── Estado del caso ──
  semaforo: EstadoSemaforo;
  /** Caso c: el PACIENTE cerró desde el portal (historial portal_*) — se
   *  distingue de «lo entregó el agente» (derivado en el log). */
  cierrePorPaciente: { accion: "aceptado" | "rechazado"; fecha: string } | null;

  // ── 1 · Qué quiere (una frase, compuesta por código) ──
  queQuiere: string | null;
  objetivoActivo: EtapaObjetivo | null;
  /** Caso b: los demás objetivos abiertos, UNA línea cada uno. */
  otrosObjetivos: EtapaObjetivo[];

  // ── 2 · Qué falta resolver (vacío si no hay: no inventar relleno) ──
  pendientes: { clave: ClaveAplazado; etiqueta: string; frase: string }[];

  // ── 3 · Qué recogió el agente ──
  recogido: { campo: string; valor: string | null }[] | null;

  // ── Los presupuestos del caso (21-08): de CUÁL se habla, y los demás
  //    NOMBRADOS. La fuente se declara — un activo elegido en silencio es
  //    peor que dos cards. null = sin presupuestos vivos. ──
  presupuestos: {
    activo: { id: string; importe: number | null; tratamiento: string | null };
    otros: { id: string; importe: number | null; tratamiento: string | null }[];
    fuente: "conversacion" | "proxy" | "sin_senal";
  } | null;

  // ── La línea de la cola (Seguimiento): paciente · qué quiere · espera ──
  linea: { paciente: string; queQuiere: string; esperandoDesde: string | null };
  /** 11-09 — quien escribe NO es la titular del número (juicio del último
   *  turno): la ficha lo declara arriba y la entrega lleva su nombre. */
  hablaPor: { nombre: string | null; relacion: string | null } | null;

  // ── Auditoría 2026-09-05 ──
  /** MEJORAS 119 — el borrador del evaluador para el ÚLTIMO entrante y si
   *  ese entrante está evaluado. `alDia=false` = el juicio de arriba es de
   *  un mensaje anterior: la pantalla lo dice, no lo enseña como actual. */
  agente: EstadoBorrador;
  /** MEJORAS 135 — pidió no recibir mensajes. Lo enseña el composer y lo
   *  respetan las rutas de envío. */
  optOut: EstadoOptOut;
  /** MEJORAS 166 — si consta consentimiento del canal (sí / no / desconocido),
   *  con fecha y origen. La ficha lo enseña; el bloqueo va detrás de flag. */
  consentimiento: EstadoConsentimiento;
  /** MEJORAS 139 — el número lo comparten varias personas: la ficha lo
   *  declara y no afirma nada de ningún expediente. */
  identidadAmbigua: { motivo: "varios_pacientes" | "paciente_y_lead"; nombres: string[] } | null;

  // ── G3 · El LEAD del teléfono, si existe y no se convirtió ──
  /** La cita del caso es la cita del lead: el modal de agendar cuelga de
   *  aquí. null = sin lead activo (paciente convertido o contacto suelto). */
  lead: {
    id: string;
    nombre: string;
    estado: string;
    fechaCita: string | null;
    horaCita: string | null;
    doctorAsignadoId: string | null;
  } | null;
};

// «Qué quiere» (componerQueQuiere, queQuiereDe) vive en estado-persona.ts
// desde el 11-09: la misma regla que decide el turno decide el titular.

// ─── LA FICHA DE CUATRO BLOQUES (16-09, MEJORAS 253) ────────────────────────
// La columna derecha decía tres veces lo mismo —prosa del agente, titular
// compuesto por código y lista de campos— porque cada bloque se añadió
// resolviendo un problema distinto sin mirar a los otros. Ahora son cuatro:
// contacto + ESTADO, DESCRIPCIÓN, datos con valor, y la acción. Las dos
// piezas nuevas son PURAS y las compone código (decisión confirmada por
// Simon el 16-09): un resumen generado habría que juzgarlo antes de
// enseñarlo, y la frase que puso de ejemplo sale ENTERA de datos que ya
// existen. Determinista, gratis y nunca miente.

export type EtiquetaEstado = { texto: string; tono: "danger" | "accent" | "warning" | "neutro" };
export type FraseDescripcion = { texto: string; pendiente?: ClaveAplazado };
export type CitaDelCaso = {
  /** Día de clínica, YYYY-MM-DD. */
  fecha: string;
  /** HH:MM, o null si la cita del lead no tiene hora. */
  hora: string | null;
  doctor: string | null;
  fuente: "paciente" | "lead";
};

/** El objetivo, como estado del caso (bloque 1). Distinto de ETIQUETA_OBJETIVO
 *  (el titular): aquí es una etiqueta corta, no una frase. */
const ESTADO_POR_OBJETIVO: Record<EtapaObjetivo, string> = {
  mover_cita: "Quiere cambiar su cita",
  cita: "Quiere cita",
  presupuesto: "Decidiendo su presupuesto",
  cobro: "Pago pendiente",
  identificar: "Contacto nuevo",
};

/** La etiqueta de ESTADO del caso. Precedencia: lo que exige a una persona
 *  (el derivado, con su causa) > lo lleva alguien > espera > lo que el agente
 *  está haciendo (dudas sin responder, el objetivo). Sin evaluación se dice. */
export function etiquetaEstadoDe(a: {
  semaforo: EstadoSemaforo;
  estadoPersona: EstadoPersona;
  objetivoActivo: EtapaObjetivo | null;
  pendientes: number;
  evaluado: boolean;
}): EtiquetaEstado {
  const s = a.semaforo;
  if (!s.verde && s.motivo === "derivado_sin_resolver") {
    switch (s.causa) {
      case "urgencia":
        return { texto: "Urgencia — pide que le vean ya", tono: "danger" };
      case "peticion_queja":
        return a.estadoPersona === "queja"
          ? { texto: "Se queja — lo tiene que ver una persona", tono: "danger" }
          : { texto: "Pide hablar con una persona", tono: "danger" };
      case "antecedente_medico":
        return { texto: "Mencionó algo médico — lo mira el doctor", tono: "danger" };
      case "insistencia":
        return { texto: "Insiste sin respuesta", tono: "danger" };
      case "no_legible":
        return { texto: "Envió un audio o archivo — ábrelo en WhatsApp", tono: "warning" };
      case "sin_respuesta_valida":
        return { texto: "Lo contesta mejor una persona", tono: "warning" };
      case "caso_completo": {
        const obj = s.objetivo ?? a.objetivoActivo;
        return { texto: obj ? `${ESTADO_POR_OBJETIVO[obj]} · listo para cerrar` : "Listo para cerrar", tono: "accent" };
      }
      default:
        return { texto: "Entregado al equipo", tono: "accent" };
    }
  }
  if (!s.verde && s.motivo === "hilo_asumido") return { texto: "Lo lleva una persona", tono: "neutro" };
  if (!s.verde && s.motivo === "espera") {
    return { texto: s.hasta ? `En espera hasta el ${fechaClinica(s.hasta)}` : "En espera", tono: "warning" };
  }
  if (!a.evaluado) return { texto: "Sin evaluar por el agente", tono: "neutro" };
  if (a.pendientes > 0) return { texto: "Tiene dudas sin responder", tono: "warning" };
  if (a.objetivoActivo) return { texto: ESTADO_POR_OBJETIVO[a.objetivoActivo], tono: "accent" };
  return { texto: "Solo conversación", tono: "neutro" };
}

/** De qué preguntó, en prosa: «Ha preguntado dos veces POR EL DÍA U HORA DE
 *  SU CITA sin respuesta». ETIQUETA_CLAVE es para listas; esto es para frases. */
const PREGUNTO_POR: Record<ClaveAplazado, string> = {
  precio_descuento: "por el precio o un descuento",
  plan_pago: "por una forma de pago a medida",
  cobertura_seguro: "por la cobertura de su seguro",
  cambio_tratamiento: "por un cambio en el tratamiento",
  garantia_condiciones: "por garantías y condiciones",
  dato_presupuesto: "por un dato de su presupuesto",
  agenda_disponibilidad: "por los huecos de agenda",
  dato_cita: "por el día u hora de su cita",
  duda_clinica: "algo clínico, para el doctor",
  otro: "algo que el agente no pudo responder",
};

const conValor = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim() !== "" && v.trim() !== "no_aplica";

/** La DESCRIPCIÓN (bloque 2): en qué anda esta persona y qué ha pasado, en
 *  dos o tres frases. Cada frase sale de UN dato; si el dato no está, la
 *  frase no se escribe — nunca relleno. El orden es el de la lectura: la
 *  cita que tiene → qué quiere → qué preguntó sin respuesta → lo que pasó
 *  fuera del hilo (portal) → cuánto se le ha escrito. */
export function componerDescripcion(a: {
  evaluado: boolean;
  cita: CitaDelCaso | null;
  objetivoActivo: EtapaObjetivo | null;
  /** Los campos del objetivo activo (acumulados). */
  campos: Record<string, string | null> | undefined;
  queQuiere: string | null;
  pendientes: readonly { clave: ClaveAplazado; frase: string }[];
  semaforo: EstadoSemaforo;
  cierrePorPaciente: { accion: "aceptado" | "rechazado"; fecha: string } | null;
  presupuestos: FichaCaso["presupuestos"];
  intentos: { salientes: number; ultimo: string | null };
}): FraseDescripcion[] {
  const out: FraseDescripcion[] = [];
  const cuando = (c: CitaDelCaso) => `${fechaCorta(c.fecha)}${c.hora ? ` a las ${c.hora}` : ""}`;
  if (a.cita) out.push({ texto: `Tiene cita el ${cuando(a.cita)}${a.cita.doctor ? ` con ${a.cita.doctor}` : ""}.` });

  if (!a.evaluado) return out;

  // Qué quiere. Para mover la cita se escribe en prosa sobre la cita de
  // arriba («Quiere cambiarla: …»); para el resto vale el titular.
  if (a.objetivoActivo === "mover_cita" && a.cita) {
    const c = a.campos ?? {};
    const anular = /anul|cancel/i.test(c.mover_o_anular ?? "");
    const motivo = conValor(c.motivo) ? ` — ${c.motivo.trim()}` : "";
    if (anular) out.push({ texto: `Quiere anularla${motivo}.` });
    else if (conValor(c.dia_franja_nuevos)) out.push({ texto: `Quiere cambiarla: ${c.dia_franja_nuevos.trim()}${motivo}.` });
    else out.push({ texto: `Quiere cambiarla, pero aún no ha dicho cuándo le viene bien${motivo}.` });
  } else if (a.queQuiere) {
    out.push({ texto: `${a.queQuiere}.` });
  }

  // Lo que preguntó y sigue sin respuesta: una frase por clave, con el
  // contador de vueltas (la n-ésima vez que vuelve sobre lo mismo).
  const porClave = new Map<ClaveAplazado, string[]>();
  for (const p of a.pendientes) porClave.set(p.clave, [...(porClave.get(p.clave) ?? []), p.frase]);
  for (const [clave, frases] of porClave) {
    const n = frases.length;
    const veces = n === 1 ? "" : n === 2 ? "dos veces " : n === 3 ? "tres veces " : `${n} veces `;
    out.push({ texto: `Ha preguntado ${veces}${PREGUNTO_POR[clave]} sin respuesta: «${frases[n - 1]}».`, pendiente: clave });
  }

  // Sus palabras, solo cuando la causa exige a una persona: escribirle
  // «como si nada» a alguien enfadado es el fallo que esta frase evita.
  const s = a.semaforo;
  if (!s.verde && s.motivo === "derivado_sin_resolver" && s.frase && (s.causa === "peticion_queja" || s.causa === "urgencia" || s.causa === "antecedente_medico")) {
    out.push({ texto: `Sus palabras: ${s.frase}` });
  }

  if (a.cierrePorPaciente) {
    out.push({ texto: `${a.cierrePorPaciente.accion === "aceptado" ? "Aceptó" : "Rechazó"} su presupuesto desde el portal el ${fechaClinica(a.cierrePorPaciente.fecha)}.` });
  }

  // Varios presupuestos vivos: se DECLARA de cuál se habla y de dónde salió
  // la elección (21-08) — un activo en silencio es peor que dos cards.
  const p = a.presupuestos;
  if (p && p.otros.length > 0) {
    const nombre = (o: { tratamiento: string | null; importe: number | null }) =>
      `${o.tratamiento ?? "tratamiento"}${o.importe != null ? ` (${Math.round(o.importe).toLocaleString("es-ES")} €)` : ""}`;
    if (p.fuente === "sin_senal") {
      out.push({ texto: `${1 + p.otros.length} presupuestos vivos y la conversación no señala cuál: ${[p.activo, ...p.otros].map(nombre).join(", ")}.` });
    } else {
      out.push({
        texto: `Se habla del presupuesto de ${nombre(p.activo)}${p.fuente === "proxy" ? " (elegido por la señal más reciente; compruébalo en la conversación)" : ""}; también vivo: ${p.otros.map(nombre).join(", ")}.`,
      });
    }
  }

  if (a.intentos.salientes === 0) out.push({ texto: "Aún no se le ha escrito." });
  else if (a.intentos.ultimo) {
    out.push({ texto: `${a.intentos.salientes === 1 ? "Un mensaje enviado" : `${a.intentos.salientes} mensajes enviados`}, el último el ${fechaClinica(a.intentos.ultimo)}.` });
  }
  return out;
}

export async function fichaDeCaso(telefono: string, opts?: { hoy?: string }): Promise<FichaCaso> {
  const cliente = requireCliente("fichaDeCaso");
  const ctx = await contextoDeConversacion(telefono);
  const sem = await semaforoDeContacto(telefono, { hoy: opts?.hoy });
  const [agente, optOut, consentimiento] = await Promise.all([
    estadoBorradorDe(telefono),
    optOutDeTelefono(telefono),
    consentimientoDeTelefono(telefono),
  ]);

  // G3 — el lead del teléfono (activo = no convertido). caída-declarada: si
  // la búsqueda falla, la ficha sigue sin el botón de agendar, no se cae.
  const lead = await (async () => {
    try {
      const digitos = telefono.replace(/[^0-9]/g, "");
      // §20: menos de 7 dígitos con LIKE %…% casaría leads AJENOS — sin
      // identificador suficiente, no hay lead, no «el primero que cuadre».
      if (digitos.length < 7) return null;
      const ref = await buscarLeadActivoPorTelefono(digitos);
      if (!ref) return null;
      const l = await getLead(ref.id);
      if (!l) return null;
      return {
        id: l.id,
        nombre: l.nombre,
        estado: String(l.estado),
        fechaCita: l.fechaCita,
        horaCita: l.horaCita,
        doctorAsignadoId: l.doctorAsignadoId,
      };
    } catch (e) {
      console.error("[ficha-caso] lead por teléfono:", e instanceof Error ? e.message : e);
      return null;
    }
  })();

  const datos = await runWithClienteDb(cliente, async (trx) => {
    // Intentos: salientes contados del hilo, y el último de cada dirección.
    const m: any = await sql`select
        count(*) filter (where direccion = 'Saliente' and coalesce(fuente, '') <> 'Modo_A_manual_pendiente')::int as salientes,
        max("timestamp") filter (where direccion = 'Saliente' and coalesce(fuente, '') <> 'Modo_A_manual_pendiente') as ultimo_saliente,
        max("timestamp") filter (where direccion = 'Entrante') as ultimo_entrante
      from mensajes_whatsapp where telefono = ${telefono}`.execute(trx);

    const eventos = await trx
      .selectFrom("eventos_automatizacion")
      .select(["evento", "clave_aplazado", "motivo_texto", "evaluacion_json", "created_at"])
      .where("tipo_caso", "=", "conversacion")
      .where("caso_id", "=", telefono)
      .where("evento", "in", ["aplazado", "aplazado_resuelto", "evaluacion"])
      .orderBy("created_at", "asc")
      .execute();

    // Caso c: la firma del portal vive en historial_acciones, atada a los
    // presupuestos de la persona (por id o por teléfono del presupuesto).
    const digitos = telefono.replace(/[^0-9]/g, "");
    const portal: any = await sql`select ha.tipo, ha.fecha
        from historial_acciones ha
        join presupuestos pr on pr.id = ha.presupuesto_id
        where ha.tipo in ('portal_aceptado', 'portal_rechazado')
          and (replace(replace(replace(coalesce(pr.paciente_telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + digitos + "%"}
               ${ctx.pacienteId ? sql`or pr.paciente_id = ${ctx.pacienteId}` : sql``})
        order by ha.fecha desc limit 1`.execute(trx);

    // 16-09 · LA CITA DEL CASO (bloque 2): la próxima del paciente, con su
    // doctor. La MISMA verdad que `citaFutura` del contexto (misma tabla,
    // mismo «>= now()», sin filtrar estado): si el agente cree que hay cita,
    // la ficha la enseña; si no, tampoco. Sin paciente no hay consulta.
    const cita = ctx.pacienteId
      ? await sql<{ hora_inicio: Date | string; doctor: string | null }>`select c.hora_inicio, s.nombre as doctor
          from citas c left join staff s on s.id = c.profesional_id
          where c.paciente_id = ${ctx.pacienteId} and c.hora_inicio >= now()
          order by c.hora_inicio asc limit 1`.execute(trx)
      : null;

    return {
      salientes: Number(m.rows?.[0]?.salientes ?? 0),
      ultimoSaliente: m.rows?.[0]?.ultimo_saliente ?? null,
      ultimoEntrante: m.rows?.[0]?.ultimo_entrante ?? null,
      eventos,
      portal: portal.rows?.[0] ?? null,
      cita: cita?.rows?.[0] ?? null,
    };
  });

  // Pendientes: la regla del posterior, la misma que usa el evaluador.
  const evsAplazamiento: EventoAplazamiento[] = datos.eventos
    .filter((x) => x.evento === "aplazado" || x.evento === "aplazado_resuelto")
    .map((x) => ({
      evento: x.evento as "aplazado" | "aplazado_resuelto",
      clave: x.clave_aplazado as ClaveAplazado,
      motivoTexto: x.motivo_texto,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
  const pendientes = pendientesDeAplazados(evsAplazamiento).flatMap((p) =>
    p.motivos.map((frase) => ({ clave: p.clave, etiqueta: ETIQUETA_CLAVE[p.clave], frase })),
  );

  // El último juicio persistido — la verdad de «qué recogió».
  const filasEvaluacion = datos.eventos.filter((x) => x.evento === "evaluacion");
  const ultimaEvaluacion = filasEvaluacion[filasEvaluacion.length - 1] ?? null;
  // MEJORAS 173: jsonb → objeto; el helper acepta las dos formas.
  const payload: PayloadEvaluacion | null = leerPayloadEvaluacion(ultimaEvaluacion?.evaluacion_json);
  const evaluado = payload != null;

  // El último juicio que identificó de QUÉ presupuesto se habla (un turno
  // sobre otra cosa no borra el último conocido) — mata el proxy del activo.
  let presupuestoReferidoId: string | null = null;
  for (let i = filasEvaluacion.length - 1; i >= 0; i--) {
    const raw = filasEvaluacion[i]?.evaluacion_json;
    if (!raw) continue;
    try {
      const pj = leerPayloadEvaluacion(raw);
      if (pj?.presupuestoReferidoId) {
        presupuestoReferidoId = pj.presupuestoReferidoId;
        break;
      }
    } catch { /* payload ilegible: no se inventa */ }
  }
  const eleccionActivo = elegirPresupuestoActivo(
    ctx.presupuestosVivos.map((v) => ({
      id: v.id,
      importe: v.importe,
      tratamiento: v.tratamiento,
      fechaISO: v.fechaISO,
      conSenalClasificador: v.senalClasificador,
    })),
    { referidoId: presupuestoReferidoId },
  );

  // Objetivo activo: la MISMA función que el evaluador (estado-persona.ts),
  // con lo abierto de HOY, no lo del turno. Aquí se pasa `estado: null` a
  // propósito: el objetivo de la ficha es el que lista lo RECOGIDO, y lo
  // recogido no desaparece porque el último turno fuera una queja. El
  // estado manda en el TITULAR (queQuiereDe), que es donde Pablo salía
  // como «Quiere cita» mientras se quejaba de un cobro (11-09).
  // LO RECOGIDO SE ACUMULA, NO ES LO DEL ÚLTIMO TURNO (15-09, fallo medido
  // por Simon probando la reactivación: «ha desaparecido el bloque de datos
  // que tiene el agente, y yo los di antes de que me entregaran el caso»).
  //
  // La ficha leía `camposRecogidos` de la ÚLTIMA evaluación. Normalmente da
  // igual —con los objetivos abiertos el evaluador re-extrae del hilo entero
  // en cada turno—, pero hay turnos que por diseño no recogen nada:
  //   · la REACTIVACIÓN, que llega sin objetivos para no perseguir a nadie;
  //   · una urgencia o una queja, donde el prompt dice «este turno NO recoges
  //     nada» (la regla del estado de la persona);
  //   · un «gracias» que no trae ningún dato.
  // En todos ellos el bloque se vaciaba y la coordinadora llamaba a preguntar
  // lo que la persona YA había contado, que es exactamente lo que el producto
  // promete evitar. El comentario de abajo muestra que el problema de al lado
  // ya se había visto (el TITULAR no cambia por una queja); faltaba aplicarlo
  // a los campos.
  //
  // LA REGLA DE FUSIÓN, por ETAPA y no por campo: si un turno tuvo esa etapa
  // abierta, su extracción MANDA sobre ella entera —así un dato que la persona
  // corrige o retira desaparece de verdad—; si no la tuvo, se conserva lo que
  // hubiera. Autoridad donde la hay, memoria donde no.
  const camposAcumulados: Record<string, Record<string, string | null>> = {};
  let preferenciaCita: PreferenciaCita | null = null;
  for (const fila of filasEvaluacion) {
    const pj = fila?.evaluacion_json ? leerPayloadEvaluacion(fila.evaluacion_json) : null;
    // La preferencia estructurada: la ÚLTIMA que el modelo dio (un turno que
    // no habla de cuándo no la borra; uno que la corrige la sustituye).
    if (pj?.preferenciaCita) preferenciaCita = pj.preferenciaCita;
    for (const [etapa, campos] of Object.entries((pj?.camposRecogidos ?? {}) as Record<string, Record<string, string | null>>)) {
      if (campos && typeof campos === "object") camposAcumulados[etapa] = campos;
    }
  }
  const abiertos = ctx.objetivosAbiertos;
  const estado = payload ? estadoDeLaPersona(payload) : null;
  const objetivoActivo: EtapaObjetivo | null = payload
    ? objetivoActivoDe({ tema: payload.tema, abiertas: abiertos, campos: camposAcumulados, estado: null })
    : (abiertos[0] ?? null);
  const otrosObjetivos = abiertos.filter((o) => o !== objetivoActivo);

  const camposActivo = objetivoActivo ? camposAcumulados[objetivoActivo] : undefined;
  const queQuiere = payload
    ? queQuiereDe({ estado, tema: payload.tema, abiertas: abiertos, campos: camposAcumulados })
    : null;
  // Teléfono compartido, versión barata (11-09): si el último juicio dice
  // que escribe otra persona, la entrega lo dice con su nombre y su relación
  // — «para Lucía, hija de Carmen, sin ficha» — y nada de lo de abajo es suyo.
  const hablaPor = payload?.hablaPor ?? null;
  const nombreEntrega = hablaPor
    ? `${hablaPor.nombre ?? "Otra persona"} (${hablaPor.relacion ? `${hablaPor.relacion}, ` : ""}escribe desde el número de ${ctx.nombre}, sin ficha)`
    : ctx.nombre;
  const recogido = evaluado && camposActivo
    ? Object.entries(camposActivo as Record<string, string | null>).map(([campo, valor]) => ({ campo, valor }))
    : evaluado
      ? []
      : null;

  // «Cuánto lleva esperando» de la línea: desde la entrega si el caso está
  // en manos de alguien; si no, desde el último entrante sin responder.
  const ultEntrante = datos.ultimoEntrante ? new Date(datos.ultimoEntrante).toISOString() : null;
  const ultSaliente = datos.ultimoSaliente ? new Date(datos.ultimoSaliente).toISOString() : null;
  const esperandoDesde =
    !sem.verde && sem.motivo === "derivado_sin_resolver" && sem.desde
      ? sem.desde
      : ultEntrante && (!ultSaliente || ultEntrante > ultSaliente)
        ? ultEntrante
        : null;

  const jugada = await hiloJugado(telefono);

  // La cita del caso: la del paciente si la hay; si no, la del lead mientras
  // no haya pasado (una cita de ayer no es «tiene cita»).
  const cita: CitaDelCaso | null = datos.cita
    ? (() => {
        const d = new Date(datos.cita.hora_inicio);
        return { fecha: hoyISO(d), hora: horaClinica(d), doctor: datos.cita.doctor ?? null, fuente: "paciente" as const };
      })()
    : lead?.fechaCita && lead.fechaCita >= hoyISO()
      ? { fecha: lead.fechaCita, hora: lead.horaCita, doctor: null, fuente: "lead" as const }
      : null;
  const intentos = { salientes: datos.salientes, ultimo: ultSaliente };
  const cierrePorPaciente = datos.portal
    ? {
        accion: (datos.portal.tipo === "portal_aceptado" ? "aceptado" : "rechazado") as "aceptado" | "rechazado",
        fecha: new Date(datos.portal.fecha).toISOString(),
      }
    : null;
  const presupuestos: FichaCaso["presupuestos"] = eleccionActivo
    ? {
        activo: { id: eleccionActivo.activo.id, importe: eleccionActivo.activo.importe, tratamiento: eleccionActivo.activo.tratamiento },
        otros: eleccionActivo.otros.map((o) => ({ id: o.id, importe: o.importe, tratamiento: o.tratamiento })),
        fuente: eleccionActivo.fuente,
      }
    : null;
  const estadoEtiqueta = etiquetaEstadoDe({
    semaforo: sem,
    estadoPersona: estado,
    objetivoActivo,
    pendientes: pendientes.length,
    evaluado,
  });
  const descripcion = componerDescripcion({
    evaluado,
    cita,
    objetivoActivo,
    campos: camposActivo as Record<string, string | null> | undefined,
    queQuiere,
    pendientes,
    semaforo: sem,
    cierrePorPaciente,
    presupuestos,
    intentos,
  });

  return {
    telefono,
    nombre: ctx.nombre,
    esPaciente: ctx.pacienteId != null,
    jugada,
    clinicaId: ctx.clinicaId ?? null,
    evaluado,
    estado: estadoEtiqueta,
    descripcion,
    cita,
    preferenciaCita,
    espera:
      !sem.verde && sem.motivo === "espera" && sem.hasta
        ? { hasta: sem.hasta, frase: sem.esperaMotivo ?? null }
        : null,
    intentos,
    semaforo: sem,
    cierrePorPaciente,
    queQuiere,
    objetivoActivo,
    otrosObjetivos,
    pendientes,
    recogido,
    presupuestos,
    linea: {
      paciente: nombreEntrega,
      queQuiere: queQuiere ?? (evaluado ? "Solo conversación" : "Sin respuesta del agente"),
      esperandoDesde,
    },
    hablaPor,
    agente,
    optOut,
    consentimiento,
    identidadAmbigua: ctx.identidadAmbigua,
    lead,
  };
}
