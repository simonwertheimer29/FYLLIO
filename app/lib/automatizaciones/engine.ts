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

  // 5. horario laboral (solo si hay alguna acción WA)
  const hayAccionWA = regla.acciones.some(
    (a) => a.tipo === "enviar_whatsapp_template",
  );
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
  for (const accion of regla.acciones) {
    try {
      const r = await ejecutarAccion(accion, regla, evento);
      detalleEjecucion.push({ tipo: accion.tipo, ok: true, ...r });
    } catch (err) {
      huboError = true;
      detalleEjecucion.push({
        tipo: accion.tipo,
        ok: false,
        error: String(err instanceof Error ? err.message : err),
      });
    }
  }

  await logAccion({
    reglaId: regla.id,
    ...idsLink(evento),
    resultado: huboError ? "error" : "success",
    detalle: { acciones: detalleEjecucion, evento },
  });

  if (!huboError) {
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
    default:
      throw new Error(`accion no soportada: ${(accion as any).tipo}`);
  }
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
    template_id: templateId,
    variables: variablesMap,
    paciente_id: pacienteIdDeEvento(evento),
    nota: "send queued (WA client integration TBD en el sprint que enganche el cliente)",
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
  await base(TABLES.leads).update(
    [{ id: evento.entidadId, fields: { Estado: nuevoEstado } }],
    { typecast: true },
  );
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
  await base(TABLES.accionesLead).create(
    [
      {
        fields: {
          Lead: [evento.entidadId],
          Tipo: tipo,
          Descripcion: descripcion,
          Timestamp: new Date().toISOString(),
        },
      },
    ],
    { typecast: true },
  );
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
    const rec = await base(TABLES.patients).find(pacienteId);
    return Boolean(rec.fields["Optout_Automatizaciones"] ?? false);
  } catch {
    return false;
  }
}

async function contarMensajesAutoUltimas24h(pacienteId: string): Promise<number> {
  // Usamos Acciones_Automatizacion como source-of-truth: cualquier
  // resultado=success cuya regla envió WA cuenta. Filtro temporal
  // últimas 24h.
  const desdeIso = new Date(
    Date.now() - COOLDOWN_HORAS * 60 * 60 * 1000,
  ).toISOString();
  const recs = await fetchAll(
    base(TABLES.accionesAutomatizacion).select({
      filterByFormula: `AND(FIND("${pacienteId}", ARRAYJOIN({Paciente_Link}, ",")), {Resultado} = "success", IS_AFTER({Ejecutada_At}, "${desdeIso}"))`,
      pageSize: 100,
    }),
  );
  // Solo cuentan las que enviaron WA; revisamos detalle.
  let count = 0;
  for (const r of recs) {
    const det = String(r.fields["Detalle"] ?? "");
    if (det.includes("enviar_whatsapp_template")) count += 1;
  }
  return count;
}

async function dentroHorarioLaboral(
  clinicaId: string | null,
): Promise<boolean> {
  const horario = clinicaId
    ? await getHorarioClinica(clinicaId)
    : HORARIO_DEFAULT;
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
  const cfg = horario[dia];
  if (!cfg.activo) return false;
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const t = `${hh}:${mm}`;
  return t >= cfg.inicio && t <= cfg.fin;
}

export async function getHorarioClinica(
  clinicaId: string,
): Promise<HorarioLaboral> {
  // Lee Configuraciones_Clinica con Categoria=horario_laboral, Clinica_Link=clinicaId.
  // Si no existe, devuelve defaults.
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
    const parsed = JSON.parse(valor);
    return { ...HORARIO_DEFAULT, ...parsed } as HorarioLaboral;
  } catch {
    return HORARIO_DEFAULT;
  }
}
