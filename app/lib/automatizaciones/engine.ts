// app/lib/automatizaciones/engine.ts
//
// Sprint 16b Bloque 1 — motor de evaluación de reglas.
//
//   evaluarReglas(evento) — recibe un evento del sistema, busca las
//   reglas activas que coinciden con su Trigger_Tipo, evalúa
//   condiciones + salvaguardas, ejecuta acciones y registra log.
//
//   emitirEvento(evento) — wrapper que persiste el evento en
//   Eventos_Sistema y luego llama evaluarReglas síncrono. Para eventos
//   time-based el cron llama directo evaluarReglas sin persistir
//   (el evento se construye in-memory desde la query del cron).
//
// Salvaguardas (en este orden, primer skip gana):
//   1. modo_test → solo dispara si paciente_test coincide con la entidad.
//   2. opt-out paciente → skip si Optout_Automatizaciones=true.
//   3. cooldown → skip si paciente recibió ≥3 mensajes auto en últimas 24h.
//   4. horario laboral → skip si la acción es enviar_whatsapp_template
//      y NOW está fuera del horario de la clínica.

import { fetchAll, base, TABLES } from "../airtable";
import {
  listReglasActivasParaTrigger,
  incrementarDisparos,
  logAccion,
  emitirEventoRow,
} from "./repo";
import type {
  Accion,
  AccionTipo,
  Condicion,
  EventoSistema,
  Regla,
  TriggerTipo,
  HorarioLaboral,
} from "./types";
import { HORARIO_DEFAULT } from "./types";

const COOLDOWN_HORAS = 24;
const COOLDOWN_LIMITE = 3;

// ─── Public API ───────────────────────────────────────────────────────

export async function emitirEvento(evento: EventoSistema): Promise<void> {
  // Persistencia opcional para auditoría/debug. Si Airtable falla no
  // tumbamos la operación principal del caller.
  try {
    await emitirEventoRow({
      tipo: evento.tipo,
      entidadTipo: evento.entidadTipo,
      entidadId: evento.entidadId,
      payload: evento.payload,
    });
  } catch (err) {
    console.error("[automatizaciones] emitirEventoRow falló:", err);
  }
  await evaluarReglasParaEvento(evento);
}

export async function evaluarReglasParaEvento(
  evento: EventoSistema,
): Promise<void> {
  // El mapping evento→trigger es 1:1 excepto para casos cron (que entran
  // por evaluarReglasCron). Aquí solo manejamos el subset event-based.
  const triggerMap: Partial<Record<EventoSistema["tipo"], TriggerTipo>> = {
    lead_creado: "lead_creado",
    presupuesto_creado: "presupuesto_presentado",
    presupuesto_actualizado: "presupuesto_presentado",
  };
  const trigger = triggerMap[evento.tipo];
  if (!trigger) return;

  const clinicaId = (evento.payload?.clinicaId as string | undefined) ?? null;
  const reglas = await listReglasActivasParaTrigger(trigger, clinicaId);

  for (const regla of reglas) {
    await evaluarRegla(regla, evento);
  }
}

/** Llamado por el cron job. Trigger viene precalculado (cita_24h_antes,
 *  presupuesto_estancado_7d, lead_inactivo_n_dias, lead_sin_gestionar_2h —
 *  esta última usa lead_creado a posteriori). */
export async function evaluarRegla(
  regla: Regla,
  evento: EventoSistema,
): Promise<void> {
  // 1. condiciones JSON
  if (!cumpleCondiciones(regla.condiciones, evento.payload)) {
    await logAccion({
      reglaId: regla.id,
      ...idsLink(evento),
      resultado: "skipped_dedupe",
      detalle: { motivo: "condiciones_no_cumplen", evento },
    });
    return;
  }

  // 2. modo_test
  if (regla.modoTest) {
    const pacienteId = pacienteIdDeEvento(evento);
    if (!pacienteId || pacienteId !== regla.pacienteTestId) {
      await logAccion({
        reglaId: regla.id,
        ...idsLink(evento),
        resultado: "skipped_test",
        detalle: { motivo: "modo_test_paciente_no_coincide", pacienteId, regla: regla.pacienteTestId },
      });
      return;
    }
  }

  // 3. opt-out paciente
  const pacienteId = pacienteIdDeEvento(evento);
  if (pacienteId) {
    const optout = await getOptoutPaciente(pacienteId);
    if (optout) {
      await logAccion({
        reglaId: regla.id,
        ...idsLink(evento),
        resultado: "skipped_optout",
        detalle: { motivo: "paciente_optout" },
      });
      return;
    }
  }

  // 4. cooldown
  if (pacienteId) {
    const enviadosUltimas24h = await contarMensajesAutoUltimas24h(pacienteId);
    if (enviadosUltimas24h >= COOLDOWN_LIMITE) {
      await logAccion({
        reglaId: regla.id,
        ...idsLink(evento),
        resultado: "skipped_cooldown",
        detalle: { motivo: "cooldown", enviados24h: enviadosUltimas24h },
      });
      return;
    }
  }

  // 5. horario laboral (solo si hay alguna acción de mensajería saliente)
  const ACCIONES_MENSAJERIA: AccionTipo[] = [
    "enviar_whatsapp_template",
    "enviar_plantilla_personalizada",
    "enviar_recordatorio_extra",
  ];
  const hayAccionWA = regla.acciones.some((a) => ACCIONES_MENSAJERIA.includes(a.tipo));
  if (hayAccionWA) {
    const clinicaId =
      (evento.payload?.clinicaId as string | undefined) ?? null;
    const dentro = await dentroHorarioLaboral(clinicaId);
    if (!dentro) {
      await logAccion({
        reglaId: regla.id,
        ...idsLink(evento),
        resultado: "skipped_horario",
        detalle: { motivo: "fuera_horario_laboral" },
      });
      return;
    }
  }

  // ── Ejecutar acciones ──
  const detalleEjecucion: Array<Record<string, unknown>> = [];
  let huboError = false;
  let huboPendiente = false;
  for (const accion of regla.acciones) {
    try {
      const r = await ejecutarAccion(accion, regla, evento);
      // Una acción "pendiente" (p. ej. WA skeleton) NO es un éxito: se
      // ejecutó el trámite pero el efecto real no ocurrió.
      if (r.pendiente === true) huboPendiente = true;
      detalleEjecucion.push({ tipo: accion.tipo, ok: r.pendiente !== true, ...r });
    } catch (err) {
      huboError = true;
      detalleEjecucion.push({
        tipo: accion.tipo,
        ok: false,
        error: String(err instanceof Error ? err.message : err),
      });
    }
  }

  // Honestidad (mantenimiento jul-2026): "success" solo si TODAS las acciones
  // produjeron su efecto real. Un skeleton sin integración queda como
  // pendiente_integracion — no suma disparos ni engaña al KPI.
  const resultado = huboError
    ? "error"
    : huboPendiente
      ? "pendiente_integracion"
      : "success";

  await logAccion({
    reglaId: regla.id,
    ...idsLink(evento),
    resultado,
    detalle: { acciones: detalleEjecucion, evento },
  });

  if (resultado === "success") {
    await incrementarDisparos(regla.id);
  }
}

// ─── Condiciones ──────────────────────────────────────────────────────

function cumpleCondiciones(
  cs: Condicion[],
  payload: Record<string, unknown>,
): boolean {
  if (cs.length === 0) return true;
  return cs.every((c) => evalCondicion(c, payload));
}

function getCampo(payload: Record<string, unknown>, campo: string): unknown {
  // Soporta dot-paths simples: "lead.estado", "presupuesto.amount".
  const parts = campo.split(".");
  let cur: any = payload;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evalCondicion(c: Condicion, payload: Record<string, unknown>): boolean {
  const v = getCampo(payload, c.campo);
  switch (c.operador) {
    case "eq":
      return v === c.valor;
    case "neq":
      return v !== c.valor;
    case "gt":
      return Number(v) > Number(c.valor);
    case "gte":
      return Number(v) >= Number(c.valor);
    case "lt":
      return Number(v) < Number(c.valor);
    case "lte":
      return Number(v) <= Number(c.valor);
    case "in":
      return Array.isArray(c.valor) && (c.valor as unknown[]).includes(v);
    case "not_in":
      return Array.isArray(c.valor) && !(c.valor as unknown[]).includes(v);
    case "exists":
      return v !== undefined && v !== null && v !== "";
    case "not_exists":
      return v === undefined || v === null || v === "";
    case "contains":
      return typeof v === "string" && v.includes(String(c.valor));
    default:
      return false;
  }
}

// ─── Acciones ─────────────────────────────────────────────────────────

async function ejecutarAccion(
  accion: Accion,
  regla: Regla,
  evento: EventoSistema,
): Promise<Record<string, unknown>> {
  switch (accion.tipo as AccionTipo) {
    case "enviar_whatsapp_template":
      return ejecutarEnviarWA(accion.params, regla, evento);
    case "crear_alerta_coordinadora":
      return ejecutarCrearAlerta(accion.params, regla, evento);
    case "actualizar_estado_lead":
      return ejecutarActualizarEstadoLead(accion.params, evento);
    case "crear_accion_lead":
      return ejecutarCrearAccionLead(accion.params, evento);
    // Sprint 18 — acciones del motor de no-shows.
    case "programar_llamada_ia":
      return ejecutarAccionNoShow(accion.params, evento, "programar_llamada_ia");
    case "enviar_plantilla_personalizada":
      return ejecutarAccionNoShow(accion.params, evento, "enviar_plantilla_recordatorio");
    case "enviar_recordatorio_extra":
      return ejecutarAccionNoShow(accion.params, evento, "enviar_recordatorio_extra");
    case "alerta_overbooking":
      return ejecutarAccionNoShow(accion.params, evento, "considerar_overbooking");
    default:
      throw new Error(`accion no soportada: ${(accion as any).tipo}`);
  }
}

/**
 * Sprint 18 — puente del motor de reglas a las acciones de no-shows. El cita_id
 * sale de params.cita_id (o del evento si es sobre una Cita). Delegamos en
 * lib/no-shows/acciones (import dinámico para no acoplar el motor a Vapi/WA).
 */
async function ejecutarAccionNoShow(
  params: Record<string, unknown>,
  evento: EventoSistema,
  accion: "programar_llamada_ia" | "enviar_plantilla_recordatorio" | "enviar_recordatorio_extra" | "considerar_overbooking",
): Promise<Record<string, unknown>> {
  const citaId = String(
    params.cita_id ?? params.citaId ?? (evento.entidadTipo === "Cita" ? evento.entidadId : ""),
  );
  if (!citaId) throw new Error(`${accion} requiere cita_id`);
  const { aplicarAccionNoShow } = await import("../no-shows/acciones");
  const plantillaNombre =
    accion === "enviar_recordatorio_extra"
      ? String(params.plantilla ?? "recordatorio_extra_2h_antes")
      : accion === "enviar_plantilla_recordatorio"
        ? String(params.plantilla ?? "recordatorio_personalizado_alto_riesgo")
        : undefined;
  const r = await aplicarAccionNoShow({
    citaId,
    accion: accion === "enviar_recordatorio_extra" ? "enviar_plantilla_recordatorio" : accion,
    manual: false,
    plantillaNombre,
  });
  if (!r.ok) throw new Error(`${accion}: ${r.motivo ?? "error"}${r.detalle ? ` (${r.detalle})` : ""}`);
  return { accion, ...r };
}

async function ejecutarEnviarWA(
  params: Record<string, unknown>,
  regla: Regla,
  evento: EventoSistema,
): Promise<Record<string, unknown>> {
  // Sprint 16b — implementación skeleton. La integración WA real se
  // engancha en el sprint que ya tiene el client (Twilio/WABA). Aquí
  // dejamos el shape: persistimos el intento en Acciones_Pago/Mensajes
  // si el caller lo quiere. Por ahora solo registramos en el detalle.
  const templateId = String(params.template_id ?? params.templateId ?? "");
  const variablesMap = (params.variables_map ?? params.variables ?? {}) as Record<
    string,
    unknown
  >;
  return {
    tipo: "enviar_whatsapp_template",
    // Honestidad: mientras el cliente WA no esté enganchado esto NO es un
    // envío. El caller lo registra como pendiente_integracion (nunca
    // success) y la UI muestra "Necesita WhatsApp conectado". Ver
    // WA_ENGINE_OPERATIVO en types.ts.
    pendiente: true,
    template_id: templateId,
    variables: variablesMap,
    paciente_id: pacienteIdDeEvento(evento),
    nota: "NO enviado — integración WABA pendiente (backlog #5B)",
    regla: regla.codigo,
  };
}

async function ejecutarCrearAlerta(
  params: Record<string, unknown>,
  regla: Regla,
  evento: EventoSistema,
): Promise<Record<string, unknown>> {
  const tipoAlerta = String(params.tipo_alerta ?? params.tipoAlerta ?? "automatizacion");
  const mensaje = String(params.mensaje ?? "Alerta automatizada");
  const urgencia = String(params.urgencia ?? "media");
  // Reusa la tabla Alertas_Enviadas como mecanismo de log/inbox.
  await base(TABLES.alertasEnviadas).create(
    [
      {
        fields: {
          Resumen: `[auto] ${regla.codigo} · ${mensaje.slice(0, 60)}`,
          Tipo: tipoAlerta,
          Mensaje: mensaje,
          Urgencia: urgencia,
          Created_At: new Date().toISOString(),
        },
      },
    ],
    { typecast: true },
  );
  return { tipoAlerta, urgencia, evento: evento.tipo };
}

async function ejecutarActualizarEstadoLead(
  params: Record<string, unknown>,
  evento: EventoSistema,
): Promise<Record<string, unknown>> {
  if (evento.entidadTipo !== "Lead") {
    throw new Error("actualizar_estado_lead requiere evento sobre un Lead");
  }
  const nuevoEstado = String(params.nuevo_estado ?? params.nuevoEstado ?? "");
  if (!nuevoEstado) throw new Error("falta nuevo_estado");
  // FASE 1 migración: la escritura vive en el repo del dominio Leads.
  // El cast es deliberado: el estado viene de los params de la regla y
  // updateLead escribe con typecast:true (Airtable crea la opción si es
  // nueva), mismo comportamiento que tenía el update directo.
  const { updateLead } = await import("../leads/leads");
  await updateLead(evento.entidadId, {
    estado: nuevoEstado as import("../leads/leads").LeadEstado,
  });
  return { leadId: evento.entidadId, nuevoEstado };
}

async function ejecutarCrearAccionLead(
  params: Record<string, unknown>,
  evento: EventoSistema,
): Promise<Record<string, unknown>> {
  if (evento.entidadTipo !== "Lead") {
    throw new Error("crear_accion_lead requiere evento sobre un Lead");
  }
  const tipo = String(params.tipo ?? "automatica");
  const descripcion = String(params.descripcion ?? "");
  // FASE 1 migración: la escritura vive en el repo del dominio Leads
  // (import dinámico como el resto de puentes del engine, para no acoplar
  // el motor en build a dominios que a su vez emiten eventos).
  const { crearAccionAutomatizacion } = await import("../leads/acciones");
  await crearAccionAutomatizacion({
    leadId: evento.entidadId,
    tipo,
    descripcion,
  });
  return { leadId: evento.entidadId, tipo, descripcion };
}

// ─── Salvaguardas helpers ─────────────────────────────────────────────

function pacienteIdDeEvento(evento: EventoSistema): string | null {
  if (evento.entidadTipo === "Paciente") return evento.entidadId;
  const pid = evento.payload?.pacienteId;
  return typeof pid === "string" ? pid : null;
}

function idsLink(evento: EventoSistema): {
  pacienteId?: string | null;
  leadId?: string | null;
  presupuestoId?: string | null;
} {
  switch (evento.entidadTipo) {
    case "Paciente":
      return { pacienteId: evento.entidadId };
    case "Lead":
      return { leadId: evento.entidadId };
    case "Presupuesto":
      return { presupuestoId: evento.entidadId };
    default:
      return {};
  }
}

async function getOptoutPaciente(pacienteId: string): Promise<boolean> {
  try {
    // FASE 1 migración: lectura via repo del dominio Pacientes. getPaciente
    // devuelve null si no existe o la query falla → false (mismo criterio;
    // sigue siendo la salvaguarda-silenciosa anotada como follow-up nº 10).
    const { getPaciente } = await import("../pacientes/pacientes");
    const p = await getPaciente(pacienteId);
    return p?.optoutAutomatizaciones ?? false;
  } catch {
    return false;
  }
}

async function contarMensajesAutoUltimas24h(pacienteId: string): Promise<number> {
  // Usamos Acciones_Automatizacion como source-of-truth: cualquier
  // resultado=success cuya regla envió WA cuenta. Filtro temporal
  // últimas 24h. Si la query falla (tabla no existe en prod, etc.)
  // devolvemos 0 — la salvaguarda cooldown queda inactiva por
  // defecto, mejor que tumbar el motor entero.
  try {
    const desdeIso = new Date(
      Date.now() - COOLDOWN_HORAS * 60 * 60 * 1000,
    ).toISOString();
    const recs = await fetchAll(
      base(TABLES.accionesAutomatizacion).select({
        filterByFormula: `AND(FIND("${pacienteId}", ARRAYJOIN({Paciente_Link}, ",")), {Resultado} = "success", IS_AFTER({Ejecutada_At}, "${desdeIso}"))`,
        pageSize: 100,
      }),
    );
    let count = 0;
    for (const r of recs) {
      const det = String(r.fields["Detalle"] ?? "");
      if (det.includes("enviar_whatsapp_template")) count += 1;
    }
    return count;
  } catch (err) {
    console.error("[automatizaciones cooldown query]", err);
    return 0;
  }
}

async function dentroHorarioLaboral(
  clinicaId: string | null,
): Promise<boolean> {
  // Defensivo: si getHorarioClinica falla o devuelve un objeto
  // incompleto (merge superficial con HORARIO_DEFAULT puede borrar
  // campos), caemos siempre a HORARIO_DEFAULT como fallback.
  let horario: HorarioLaboral = HORARIO_DEFAULT;
  if (clinicaId) {
    try {
      horario = await getHorarioClinica(clinicaId);
    } catch (err) {
      console.error("[automatizaciones horario]", err);
    }
  }
  const now = new Date();
  const dias: Array<keyof HorarioLaboral> = [
    "domingo",
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
  ];
  const dia = dias[now.getDay()]!;
  const cfg = horario[dia] ?? HORARIO_DEFAULT[dia];
  if (!cfg || !cfg.activo) return false;
  if (!cfg.inicio || !cfg.fin) return true; // datos incompletos: no bloquear
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const t = `${hh}:${mm}`;
  return t >= cfg.inicio && t <= cfg.fin;
}

export async function getHorarioClinica(
  clinicaId: string,
): Promise<HorarioLaboral> {
  // Lee Configuraciones_Clinica con Categoria=horario_laboral,
  // Clinica_Link=clinicaId. Si la categoría todavía no existe (singleSelect
  // no extendido), Airtable puede devolver UNKNOWN_FIELD_NAME aunque la
  // tabla sí. Capturamos y caemos a defaults.
  try {
    const recs = await fetchAll(
      base(TABLES.configuracionesClinica).select({
        filterByFormula: `AND({Categoria}="horario_laboral", FIND("${clinicaId}", ARRAYJOIN({Clinica_Link}, ",")))`,
        maxRecords: 1,
      }),
    );
    const r = recs[0];
    if (!r) return HORARIO_DEFAULT;
    const valor = String(r.fields["Valor"] ?? "");
    try {
      const parsed = JSON.parse(valor) as Partial<HorarioLaboral>;
      // Merge día por día para no perder inicio/fin si parsed es parcial.
      const out: HorarioLaboral = { ...HORARIO_DEFAULT };
      for (const k of Object.keys(HORARIO_DEFAULT) as Array<keyof HorarioLaboral>) {
        if (parsed[k]) {
          out[k] = { ...HORARIO_DEFAULT[k], ...(parsed[k] as object) };
        }
      }
      return out;
    } catch {
      return HORARIO_DEFAULT;
    }
  } catch (err) {
    console.error("[automatizaciones getHorarioClinica]", err);
    return HORARIO_DEFAULT;
  }
}
