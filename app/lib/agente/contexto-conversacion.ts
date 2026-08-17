// app/lib/agente/contexto-conversacion.ts
//
// La entrada del evaluador (fase A, paso 2): para un teléfono, quién es y qué
// objetivos están abiertos. Es la mitad DETERMINISTA de «qué persigue el
// agente» — la otra mitad (de qué habla la persona ahora) la pone el hilo, y
// las combina el evaluador en cada turno. Nada de esto se persiste: se deriva
// al preguntar, como `estado_automatizacion` y por la misma razón.
//
// La unidad es la CONVERSACIÓN, no el caso: el paciente no sabe si es un lead,
// un presupuesto o un cobro — escribe a la clínica (misma decisión que la
// bandeja: un hilo es un teléfono). Por eso aquí pueden salir varios objetivos
// a la vez, en el orden de PRECEDENCIA_OBJETIVOS.
//
// Server-only (repos + SQL). Corre dentro del contexto de cliente del caller,
// como todos los repos. Un fallo de datos LANZA: derivar «no tiene caso» de
// una consulta rota sería inventar un dato (lecciones §4/§10) — y para el
// agente, tratar a un deudor como desconocido.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { esLeadActivo } from "../leads/pipeline";
import { finanzasDePaciente } from "../finanzas-paciente";
import { PRECEDENCIA_OBJETIVOS, type EtapaObjetivo } from "../automatizacion/objetivos";

/** Presupuesto sin cerrar (ni ACEPTADO ni PERDIDO): hay decisión pendiente. */
export type PresupuestoVivo = {
  id: string;
  estado: string;
  tratamiento: string | null;
  importe: number | null;
  clinicaId: string | null;
};

export type LeadActivoContexto = {
  id: string;
  nombre: string;
  estado: string;
  tratamientoInteres: string | null;
  fechaCita: string | null;
  clinicaId: string | null;
};

export type ContextoConversacion = {
  /** La clave del hilo, en E.164 (migración 018). */
  telefono: string;
  /** Mismo orden de resolución que la bandeja: paciente → lead → perfil → número. */
  nombre: string;
  origenNombre: "paciente" | "lead" | "perfil" | "telefono";
  pacienteId: string | null;
  leadActivo: LeadActivoContexto | null;
  presupuestosVivos: PresupuestoVivo[];
  /** € comprometidos y no cobrados (firmado − cobrado, `finanzas-paciente`).
   *  0 = nada pendiente. Solo puede ser > 0 si hay paciente. */
  pendienteCobro: number;
  /** Mejor esfuerzo, para cargar la configuración de objetivos de SU clínica:
   *  paciente → lead → presupuesto vivo → último mensaje. NULL = no se sabe —
   *  y no significa «todas»: el caller usa entonces la configuración global. */
  clinicaId: string | null;
  /** Qué está abierto para esta persona, en orden de precedencia. Vacío es
   *  válido: un paciente al día y sin caso abierto no tiene objetivo, y el
   *  agente solo contesta. `identificar` sale únicamente cuando no sabemos
   *  quién es (ni paciente ni lead activo). */
  objetivosAbiertos: EtapaObjetivo[];
};

/** El emparejamiento del sistema: dígitos contra dígitos, como las fórmulas
 *  que ya usan webhook y repos (`buscarLeadActivoPorTelefonoPg`). */
const soloDigitos = (raw: string): string => raw.replace(/[^0-9]/g, "");

export async function contextoDeConversacion(telefonoRaw: string): Promise<ContextoConversacion> {
  const cliente = requireCliente("contextoDeConversacion");
  const digitos = soloDigitos(telefonoRaw);
  if (!digitos) {
    throw new Error("contextoDeConversacion: teléfono sin dígitos");
  }
  // La clave de hilo es E.164. Si llega en dígitos, el «+» es un hecho, no una
  // suposición — mismo razonamiento que el webhook con el wa_id.
  const telefono = telefonoRaw.trim().startsWith("+") ? telefonoRaw.trim() : `+${digitos}`;

  const patron = `%${digitos}%`;

  type Filas = {
    paciente: { id: string; nombre: string; clinica_id: string | null } | null;
    leads: {
      id: string;
      nombre: string;
      estado: string | null;
      tratamiento_interes: string | null;
      fecha_cita: string | null;
      clinica_id: string | null;
      convertido_a_paciente: boolean | null;
    }[];
    vivos: {
      id: string;
      estado: string | null;
      tratamiento_nombre: string | null;
      importe: number | string | null;
      clinica_id: string | null;
    }[];
    perfil: { nombre_perfil: string | null; clinica_id: string | null } | null;
    /** Fase B, punto 1: el paciente tiene una cita futura registrada. */
    citaFutura: boolean;
  };

  const filas: Filas = await runWithClienteDb(cliente, async (trx) => {
    const paciente =
      (await trx
        .selectFrom("pacientes")
        .select(["id", "nombre", "clinica_id"])
        .where(
          sql<boolean>`replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}`,
        )
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst()) ?? null;

    const leads = await trx
      .selectFrom("leads")
      .select([
        "id",
        "nombre",
        "estado",
        "tratamiento_interes",
        "fecha_cita",
        "clinica_id",
        "convertido_a_paciente",
      ])
      .where(
        sql<boolean>`replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}`,
      )
      .orderBy("created_at", "desc")
      .execute();

    // Vivos = con decisión pendiente. Por paciente_id cuando la persona está
    // fichada Y por teléfono del presupuesto: las dos vías existen en datos
    // reales y quedarse con una pierde casos de la otra.
    const porTelefono = sql<boolean>`replace(replace(replace(coalesce(paciente_telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}`;
    const vivos = await trx
      .selectFrom("presupuestos")
      .select(["id", "estado", "tratamiento_nombre", "importe", "clinica_id"])
      .where((eb) =>
        eb.or([porTelefono, ...(paciente ? [eb("paciente_id", "=", paciente.id)] : [])]),
      )
      .where((eb) => eb.or([eb("estado", "is", null), eb("estado", "not in", ["ACEPTADO", "PERDIDO"])]))
      .orderBy("created_at", "desc")
      .execute();

    const perfil =
      (await trx
        .selectFrom("mensajes_whatsapp")
        .select(["nombre_perfil", "clinica_id"])
        .where("telefono", "=", telefono)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst()) ?? null;

    // Fase B, punto 1 (2026-08-17): ¿tiene el PACIENTE una cita futura? Sin
    // ella, el objetivo «cita» se abre también para pacientes — el ciclo de
    // vida no se acaba en el embudo. El recorrido R3 lo destapó: «ya pagué,
    // dadme cita» moría en el hilo porque cita era solo de leads.
    const citaFutura = paciente
      ? ((await trx
          .selectFrom("citas")
          .select("id")
          .where("paciente_id", "=", paciente.id)
          .where("hora_inicio", ">=", sql<Date>`now()`)
          .limit(1)
          .executeTakeFirst()) ?? null)
      : null;

    return { paciente, leads, vivos, perfil, citaFutura: citaFutura != null };
  });

  const leadActivoFila =
    filas.leads.find((l) => l.convertido_a_paciente !== true && esLeadActivo(String(l.estado ?? ""))) ??
    null;
  const leadActivo: LeadActivoContexto | null = leadActivoFila
    ? {
        id: leadActivoFila.id,
        nombre: leadActivoFila.nombre,
        estado: String(leadActivoFila.estado ?? ""),
        tratamientoInteres: leadActivoFila.tratamiento_interes,
        fechaCita: leadActivoFila.fecha_cita,
        clinicaId: leadActivoFila.clinica_id,
      }
    : null;

  const presupuestosVivos: PresupuestoVivo[] = filas.vivos.map((v) => ({
    id: v.id,
    estado: String(v.estado ?? ""),
    tratamiento: v.tratamiento_nombre,
    importe: v.importe == null ? null : Number(v.importe),
    clinicaId: v.clinica_id,
  }));

  const pendienteCobro = filas.paciente ? (await finanzasDePaciente(filas.paciente.id)).pendiente : 0;

  const abiertos = new Set<EtapaObjetivo>();
  if (pendienteCobro > 0) abiertos.add("cobro");
  if (presupuestosVivos.length > 0) abiertos.add("presupuesto");
  // «cita» abierta para un lead ACTIVO — y desde la fase B (punto 1) también
  // para un PACIENTE sin cita futura: el ciclo de vida del paciente existente
  // (pedir cita, volver semanas después) no estaba modelado y el agente
  // conversaba indefinidamente sin entregar. Un paciente CON cita futura no
  // la tiene abierta: no hay nada que cerrar.
  if (leadActivo) abiertos.add("cita");
  if (filas.paciente && !filas.citaFutura) abiertos.add("cita");
  // «identificar» = no hay NINGUNA fila que diga quién es — ni paciente ni
  // lead en ningún estado. Un lead cerrado («No interesado») no abre cita,
  // pero sabemos su nombre: preguntárselo sería absurdo. Lo destapó el censo
  // del QA: 167 hilos del DEMO salían a identificar y la mayoría eran leads
  // cerrados, no desconocidos.
  const leadCualquiera = filas.leads[0] ?? null;
  if (!filas.paciente && !leadCualquiera) abiertos.add("identificar");
  const objetivosAbiertos = PRECEDENCIA_OBJETIVOS.filter((e) => abiertos.has(e));

  const nombre =
    filas.paciente?.nombre ??
    leadActivo?.nombre ??
    leadCualquiera?.nombre ??
    filas.perfil?.nombre_perfil ??
    telefono;
  const origenNombre: ContextoConversacion["origenNombre"] = filas.paciente
    ? "paciente"
    : leadActivo ?? leadCualquiera
      ? "lead"
      : filas.perfil?.nombre_perfil
        ? "perfil"
        : "telefono";

  return {
    telefono,
    nombre,
    origenNombre,
    pacienteId: filas.paciente?.id ?? null,
    leadActivo,
    presupuestosVivos,
    pendienteCobro,
    clinicaId:
      filas.paciente?.clinica_id ??
      leadActivo?.clinicaId ??
      presupuestosVivos[0]?.clinicaId ??
      filas.perfil?.clinica_id ??
      null,
    objetivosAbiertos,
  };
}
