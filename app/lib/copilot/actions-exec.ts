// app/lib/copilot/actions-exec.ts
//
// Sprint 11 D — ejecutor de las 8 ACTION_TOOLS confirmadas por el usuario
// desde el chat. Cada caso reusa endpoints/funciones que ya existen para
// no duplicar lógica:
//
//  - cambiar_estado_lead          → updateLead({estado, motivoNoInteres})
//  - marcar_lead_llamado          → updateLead({llamado:true}) + log
//  - enviar_whatsapp_lead         → /api/leads/intervencion/enviar-waba
//                                   (con fallback wa.me si WABA inactivo)
//  - enviar_whatsapp_presupuesto  → /api/presupuestos/intervencion/enviar-waba
//  - anadir_nota_lead             → updateLead({notas: append})
//  - anadir_nota_presupuesto      → PATCH base().Presupuestos.Notas append
//  - cambiar_estado_presupuesto   → /api/presupuestos/kanban/[id] PATCH
//  - marcar_atendido_actuar_hoy   → log Acciones_Lead "Llamada" o
//                                   registrar-respuesta presup
//
// Permisos:
//  - coord solo sobre sus clinicas
//  - admin requiere selectedClinicaId para ESCRIBIR. Si no, error.

import { base, TABLES } from "../airtable";
import { listClinicaIdsForUser } from "../auth/users";
import { getLead, updateLead, appendLeadLog } from "../leads/leads";
import { logAccionLead } from "../leads/acciones";
import { getServicioMensajeria, type EnviarMensajeParams } from "../presupuestos/mensajeria";
import { getPaciente } from "../pacientes/pacientes";
import { crearPago, type TipoPago } from "../pagos";
import {
  renderizarPlantilla,
  getPlantillasActivas,
} from "../plantillas/plantillas";
import type { Session } from "../auth/session";
import type { CopilotAction } from "../../components/copilot/types";

export type ExecResult = { ok: true; message: string } | { ok: false; error: string };

type ExecEnv = {
  session: Session;
  selectedClinicaId: string | null;
};

async function ensureLeadAccessible(
  env: ExecEnv,
  leadId: string,
): Promise<{ ok: true; lead: NonNullable<Awaited<ReturnType<typeof getLead>>> } | ExecResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, error: "Lead no encontrado" };
  if (env.session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(env.session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return { ok: false, error: "No tienes permiso sobre este lead" };
    }
  }
  return { ok: true, lead };
}

function adminMustHaveSelected(env: ExecEnv, accion: string): ExecResult | null {
  if (env.session.rol === "admin" && !env.selectedClinicaId) {
    return {
      ok: false,
      error: `Para ${accion} selecciona una clínica desde la cabecera.`,
    };
  }
  return null;
}

// ─── Lead actions ─────────────────────────────────────────────────────

async function execCambiarEstadoLead(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "cambiar el estado de un lead");
  if (block) return block;
  const access = await ensureLeadAccessible(env, String(p.leadId));
  if (!("lead" in access)) return access;
  const patch: any = { estado: String(p.nuevoEstado) };
  if (p.nuevoEstado === "No Interesado") {
    patch.motivoNoInteres = p.motivoNoInteres ?? "Rechazo_Producto";
  } else if (access.lead.motivoNoInteres) {
    patch.motivoNoInteres = null;
  }
  await updateLead(access.lead.id, patch);
  await appendLeadLog(access.lead.id, `Copilot · estado → ${p.nuevoEstado}`);
  logAccionLead({
    leadId: access.lead.id,
    tipo: "Cambio_Estado",
    usuarioId: env.session.userId,
    detalles: `Copilot → ${p.nuevoEstado}`,
  }).catch(() => {});
  return { ok: true, message: `✓ ${access.lead.nombre} ahora está en ${p.nuevoEstado}.` };
}

async function execMarcarLeadLlamado(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "marcar un lead como llamado");
  if (block) return block;
  const access = await ensureLeadAccessible(env, String(p.leadId));
  if (!("lead" in access)) return access;
  await updateLead(access.lead.id, { llamado: true });
  await appendLeadLog(access.lead.id, "Copilot · llamada realizada");
  logAccionLead({
    leadId: access.lead.id,
    tipo: "Llamada",
    usuarioId: env.session.userId,
    detalles: "Copilot",
  }).catch(() => {});
  return { ok: true, message: `✓ ${access.lead.nombre} marcado como llamado.` };
}

async function execEnviarWhatsappLead(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "enviar un WhatsApp");
  if (block) return block;
  const access = await ensureLeadAccessible(env, String(p.leadId));
  if (!("lead" in access)) return access;
  const lead = access.lead;
  const mensaje = String(p.mensaje ?? "").trim();
  if (!mensaje) return { ok: false, error: "Mensaje vacío" };
  if (!lead.telefono) return { ok: false, error: "Lead sin teléfono" };

  // WABA activo en la clínica del lead?
  let wabaActivo = false;
  if (lead.clinicaId) {
    try {
      const cliRec = await base(TABLES.clinics as any).find(lead.clinicaId);
      const nombre = String((cliRec.fields as any)?.["Nombre"] ?? "");
      const cfgRecs = await base(TABLES.configuracionWABA as any)
        .select({
          filterByFormula: `{Clinica}='${nombre.replace(/'/g, "\\'")}'`,
          maxRecords: 1,
        })
        .firstPage();
      if (cfgRecs.length > 0) {
        wabaActivo = Boolean((cfgRecs[0].fields as any)?.["Activo"]);
      }
    } catch {
      /* no waba */
    }
  }

  if (wabaActivo) {
    try {
      const servicio = getServicioMensajeria("waba");
      await servicio.enviarMensaje({
        leadId: lead.id,
        telefono: lead.telefono,
        contenido: mensaje,
      } as EnviarMensajeParams);
    } catch (err) {
      const m = err instanceof Error ? err.message : "fallo WABA";
      return { ok: false, error: `WABA falló: ${m}` };
    }
  } else {
    // Fallback: persistimos el saliente en Mensajes_WhatsApp y dejamos
    // al usuario abrir wa.me manualmente. (En la UI del panel se abre
    // con click; desde Copilot solo registramos la intención.)
    const servicio = getServicioMensajeria("manual");
    await servicio.enviarMensaje({
      leadId: lead.id,
      telefono: lead.telefono,
      contenido: mensaje,
    });
  }

  await updateLead(lead.id, { whatsappEnviados: lead.whatsappEnviados + 1 });
  await appendLeadLog(lead.id, "Copilot · WhatsApp enviado");
  logAccionLead({
    leadId: lead.id,
    tipo: "WhatsApp_Saliente",
    usuarioId: env.session.userId,
    detalles: mensaje.slice(0, 500),
  }).catch(() => {});

  const tail = wabaActivo
    ? "(enviado vía WABA)"
    : "(registrado; abre wa.me desde el panel para mandarlo si aún no usas WABA)";
  return { ok: true, message: `✓ Mensaje enviado a ${lead.nombre}. ${tail}` };
}

async function execAnadirNotaLead(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "añadir una nota");
  if (block) return block;
  const access = await ensureLeadAccessible(env, String(p.leadId));
  if (!("lead" in access)) return access;
  const nota = String(p.nota ?? "").trim();
  if (!nota) return { ok: false, error: "Nota vacía" };
  const prev = access.lead.notas ?? "";
  const sep = prev ? "\n" : "";
  await updateLead(access.lead.id, { notas: prev + sep + `[Copilot] ${nota}` });
  return { ok: true, message: `✓ Nota añadida a ${access.lead.nombre}.` };
}

// ─── Presupuesto actions ──────────────────────────────────────────────

async function ensurePresupAccessible(
  env: ExecEnv,
  presupuestoId: string,
): Promise<{ ok: true; rec: any; clinicaNombre: string; pacienteNombre: string } | ExecResult> {
  let rec: any;
  try {
    rec = await base(TABLES.presupuestos as any).find(presupuestoId);
  } catch {
    return { ok: false, error: "Presupuesto no encontrado" };
  }
  const f = rec.fields as any;
  const clinicaNombre = Array.isArray(f["Clinica"])
    ? String(f["Clinica"][0] ?? "")
    : String(f["Clinica"] ?? "");
  const pacienteNombre = Array.isArray(f["Paciente_nombre"])
    ? String(f["Paciente_nombre"][0] ?? "")
    : String(f["Paciente_nombre"] ?? "");
  if (env.session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(env.session.userId);
    // resolver nombres de clinicas accesibles
    const allowedNombres: string[] = [];
    for (const id of allowed) {
      try {
        const c = await base(TABLES.clinics as any).find(id);
        const n = String((c.fields as any)?.["Nombre"] ?? "");
        if (n) allowedNombres.push(n);
      } catch {
        /* ignore */
      }
    }
    if (!allowedNombres.includes(clinicaNombre)) {
      return { ok: false, error: "No tienes permiso sobre este presupuesto" };
    }
  }
  return { ok: true, rec, clinicaNombre, pacienteNombre };
}

async function execEnviarWhatsappPresupuesto(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "enviar un WhatsApp");
  if (block) return block;
  const access = await ensurePresupAccessible(env, String(p.presupuestoId));
  if (!("rec" in access)) return access;
  const mensaje = String(p.mensaje ?? "").trim();
  if (!mensaje) return { ok: false, error: "Mensaje vacío" };
  const f = access.rec.fields as any;
  const telefono = f["Paciente_Telefono"]
    ? String(f["Paciente_Telefono"])
    : Array.isArray(f["Teléfono"])
      ? String(f["Teléfono"][0] ?? "")
      : String(f["Teléfono"] ?? "");
  if (!telefono) return { ok: false, error: "Presupuesto sin teléfono" };

  // Para presupuestos hay endpoint propio que decide WABA vs manual.
  // Como aquí no tenemos su comprobación trivial, vamos directamente
  // al servicio "manual" (registra saliente en Mensajes_WhatsApp). Si
  // quieres WABA, lo activa el panel de Presupuestos.
  const servicio = getServicioMensajeria("manual");
  await servicio.enviarMensaje({
    presupuestoId: access.rec.id,
    telefono,
    contenido: mensaje,
  });
  return {
    ok: true,
    message: `✓ Mensaje registrado para ${access.pacienteNombre}.`,
  };
}

async function execAnadirNotaPresupuesto(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "añadir una nota");
  if (block) return block;
  const access = await ensurePresupAccessible(env, String(p.presupuestoId));
  if (!("rec" in access)) return access;
  const nota = String(p.nota ?? "").trim();
  if (!nota) return { ok: false, error: "Nota vacía" };
  const prev = String((access.rec.fields as any)?.["Notas"] ?? "");
  const sep = prev ? "\n" : "";
  await base(TABLES.presupuestos as any).update(access.rec.id, {
    Notas: prev + sep + `[Copilot] ${nota}`,
  } as any);
  return { ok: true, message: `✓ Nota añadida a ${access.pacienteNombre}.` };
}

async function execCambiarEstadoPresupuesto(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "cambiar estado de un presupuesto");
  if (block) return block;
  const access = await ensurePresupAccessible(env, String(p.presupuestoId));
  if (!("rec" in access)) return access;
  const fields: Record<string, unknown> = { Estado: String(p.nuevoEstado) };
  if (p.nuevoEstado === "PERDIDO" && p.motivoPerdida) {
    fields["MotivoPerdida"] = String(p.motivoPerdida);
  }
  await base(TABLES.presupuestos as any).update(access.rec.id, fields as any, {
    typecast: true,
  } as any);
  return {
    ok: true,
    message: `✓ Presupuesto de ${access.pacienteNombre} ahora está en ${p.nuevoEstado}.`,
  };
}

// ─── marcar_atendido_actuar_hoy ──────────────────────────────────────

async function execMarcarAtendido(env: ExecEnv, p: any): Promise<ExecResult> {
  const block = adminMustHaveSelected(env, "marcar como atendido");
  if (block) return block;
  if (p.kind === "lead") {
    const access = await ensureLeadAccessible(env, String(p.id));
    if (!("lead" in access)) return access;
    await appendLeadLog(access.lead.id, "Copilot · atendido");
    logAccionLead({
      leadId: access.lead.id,
      tipo: "Llamada",
      usuarioId: env.session.userId,
      detalles: "Atendido vía Copilot",
    }).catch(() => {});
    return { ok: true, message: `✓ ${access.lead.nombre} marcado como atendido.` };
  } else {
    const access = await ensurePresupAccessible(env, String(p.id));
    if (!("rec" in access)) return access;
    const now = new Date().toISOString();
    await base(TABLES.presupuestos as any).update(access.rec.id, {
      Ultima_accion_registrada: now,
      Tipo_ultima_accion: "Llamada realizada",
    } as any);
    await base(TABLES.contactosPresupuesto as any).create({
      PresupuestoId: access.rec.id,
      TipoContacto: "llamada",
      Resultado: "contestó",
      FechaHora: now,
      Nota: "Atendido vía Copilot",
      RegistradoPor: env.session.nombre || env.session.userId,
    } as any);
    return { ok: true, message: `✓ ${access.pacienteNombre} marcado como atendido.` };
  }
}

// ═══ Sprint 14b Bloque 8 — modulo financiero ═══════════════════════════

async function ensurePacienteAccessible(
  env: ExecEnv,
  pacienteId: string,
): Promise<
  | { ok: true; paciente: NonNullable<Awaited<ReturnType<typeof getPaciente>>> }
  | ExecResult
> {
  const paciente = await getPaciente(pacienteId);
  if (!paciente) return { ok: false, error: "Paciente no encontrado" };
  if (env.session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(env.session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return { ok: false, error: "No tienes permiso sobre este paciente" };
    }
  }
  return { ok: true, paciente };
}

/**
 * Sprint 14b Bloque 8 hotfix — para acciones financieras la clínica
 * la dicta el paciente, no el header. Si el admin tiene un scope
 * concreto en el header que NO coincide con la clínica del paciente,
 * lo rechazamos con un mensaje claro (evita escribir en una clínica
 * que el admin no tiene "abierta" mentalmente). Si admin tiene null
 * (Todas), permite la acción usando la clínica del paciente.
 *
 * Para coordinacion el guard ya está en ensurePacienteAccessible.
 */
function ensurePacienteClinicaMatchesScope(
  env: ExecEnv,
  paciente: NonNullable<Awaited<ReturnType<typeof getPaciente>>>,
  clinicaNombrePorId: Map<string, string>,
): ExecResult | null {
  if (env.session.rol !== "admin") return null; // coord ya validado.
  if (!env.selectedClinicaId) return null; // admin con "Todas" → permitir.
  if (paciente.clinicaId && env.selectedClinicaId === paciente.clinicaId) {
    return null; // match.
  }
  const pacienteClinicaNombre = paciente.clinicaId
    ? clinicaNombrePorId.get(paciente.clinicaId) ?? paciente.clinicaId
    : "(sin clínica)";
  const sesionClinicaNombre =
    clinicaNombrePorId.get(env.selectedClinicaId) ?? env.selectedClinicaId;
  return {
    ok: false,
    error: `Este paciente pertenece a ${pacienteClinicaNombre}, no a ${sesionClinicaNombre}. Cambia el scope del header o selecciona "Todas las clínicas" para esta acción.`,
  };
}

/**
 * Resuelve el mapa Clinicas (id → nombre) en una sola pasada cuando hace
 * falta para el mensaje de mismatch. Cacheable, pero las acciones son
 * de baja frecuencia y la query es ligera.
 */
async function loadClinicaNombrePorId(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const recs = await (
      base(TABLES.clinics as any) as any
    )
      .select({ fields: ["Nombre"] })
      .all();
    for (const r of recs) map.set(r.id, String(r.fields?.["Nombre"] ?? ""));
  } catch {
    /* noop — el mensaje de error usará IDs como fallback */
  }
  return map;
}

// ─── enviar_recordatorio_pago ──────────────────────────────────────────

async function execEnviarRecordatorioPago(
  env: ExecEnv,
  p: any,
): Promise<ExecResult> {
  // Sprint 14b Bloque 8 hotfix — la clinica la dicta el paciente,
  // no el header. ensurePacienteAccessible ya valida coordinacion.
  const access = await ensurePacienteAccessible(env, String(p.pacienteId));
  if (!("paciente" in access)) return access;
  const paciente = access.paciente;
  const clinicaNombrePorId = await loadClinicaNombrePorId();
  const mismatch = ensurePacienteClinicaMatchesScope(env, paciente, clinicaNombrePorId);
  if (mismatch) return mismatch;
  if (!paciente.telefono) {
    return { ok: false, error: "Paciente sin teléfono — no se puede enviar WA." };
  }

  // Resolver plantillaId: si llega plantillaId directo, usarlo; si llega
  // plantillaNombre, buscar la activa con ese nombre (override por
  // nombre del lib).
  let plantillaId: string | null = p.plantillaId ? String(p.plantillaId) : null;
  if (!plantillaId && p.plantillaNombre) {
    const activas = await getPlantillasActivas({
      clinicaId: paciente.clinicaId,
      categoria: "cobranza",
    });
    const match = activas.find((pl) => pl.nombre === String(p.plantillaNombre));
    if (!match) {
      return {
        ok: false,
        error: `Plantilla "${p.plantillaNombre}" no encontrada en cobranza.`,
      };
    }
    plantillaId = match.id;
  }
  if (!plantillaId) {
    return { ok: false, error: "Falta plantillaId o plantillaNombre." };
  }

  // Render del mensaje final.
  let texto = "";
  try {
    const r = await renderizarPlantilla({
      plantillaId,
      pacienteId: paciente.id,
    });
    texto = r.texto;
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo renderizar la plantilla: ${err instanceof Error ? err.message : "error"}`,
    };
  }

  // Enviar via servicio de mensajeria. El servicio usa el modo activo
  // de la clinica (manual o WABA). Para Bloque 8 mantenemos el patrón
  // simple: modo manual (genera URL wa.me) por defecto. La integracion
  // WABA por clinica vive en Bloque siguiente.
  if (!paciente.clinicaId) {
    return { ok: false, error: "Paciente sin clínica asignada." };
  }
  try {
    const servicio = getServicioMensajeria("manual");
    const params: EnviarMensajeParams = {
      telefono: paciente.telefono,
      contenido: texto,
      pacienteId: paciente.id,
      fuente: "Modo_A_manual",
    };
    const out = await servicio.enviarMensaje(params);
    if (!out.ok) {
      return {
        ok: false,
        error: "Error enviando mensaje WhatsApp.",
      };
    }
    return {
      ok: true,
      message:
        out.urlWhatsApp
          ? `✓ Recordatorio listo para enviar a ${paciente.nombre}. Abre: ${out.urlWhatsApp}`
          : `✓ Recordatorio enviado a ${paciente.nombre}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error enviando WA.",
    };
  }
}

// ─── marcar_pago_recibido ──────────────────────────────────────────────

async function execMarcarPagoRecibido(env: ExecEnv, p: any): Promise<ExecResult> {
  // Sprint 14b Bloque 8 hotfix — clinica desde el paciente.
  const access = await ensurePacienteAccessible(env, String(p.pacienteId));
  if (!("paciente" in access)) return access;
  const clinicaNombrePorId = await loadClinicaNombrePorId();
  const mismatch = ensurePacienteClinicaMatchesScope(
    env,
    access.paciente,
    clinicaNombrePorId,
  );
  if (mismatch) return mismatch;

  const importe = Number(p.importe ?? 0);
  if (!Number.isFinite(importe) || importe <= 0) {
    return { ok: false, error: "Importe inválido (>0)." };
  }
  const tipo = String(p.tipo ?? "") as TipoPago;
  if (!["Senal", "Primer_Pago_Plan", "Liquidacion"].includes(tipo)) {
    return { ok: false, error: "Tipo inválido." };
  }
  const metodo = p.metodo ? String(p.metodo) : "Otro";
  const fechaPago = p.fechaPago ? String(p.fechaPago) : undefined;
  const nota = p.nota ? String(p.nota) : "Registrado vía Copilot";

  try {
    const pago = await crearPago({
      pacienteId: access.paciente.id,
      importe,
      tipo,
      metodo: metodo as any,
      fechaPago,
      nota,
      usuarioCreadorId: env.session.userId,
    });
    const importeFmt = importe.toLocaleString("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: true,
    });
    return {
      ok: true,
      message: `✓ Pago de ${importeFmt}€ registrado a ${access.paciente.nombre} (${pago.tipo}).`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al registrar pago.",
    };
  }
}

// ─── agendar_llamada_cobranza ──────────────────────────────────────────

async function execAgendarLlamadaCobranza(
  env: ExecEnv,
  p: any,
): Promise<ExecResult> {
  // Sprint 14b Bloque 8 hotfix — clinica desde el paciente.
  const access = await ensurePacienteAccessible(env, String(p.pacienteId));
  if (!("paciente" in access)) return access;
  const clinicaNombrePorId = await loadClinicaNombrePorId();
  const mismatch = ensurePacienteClinicaMatchesScope(
    env,
    access.paciente,
    clinicaNombrePorId,
  );
  if (mismatch) return mismatch;

  const fechaHoraRaw = String(p.fechaHora ?? "").trim();
  if (!fechaHoraRaw) return { ok: false, error: "Falta fechaHora." };
  // Si llega solo YYYY-MM-DD, asumir 09:00 local Madrid.
  const fechaIso =
    /^\d{4}-\d{2}-\d{2}$/.test(fechaHoraRaw)
      ? `${fechaHoraRaw}T09:00:00`
      : fechaHoraRaw;
  const dt = new Date(fechaIso);
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, error: "fechaHora inválida." };
  }

  try {
    // Reusa Acciones_Pago (Sprint 14a Bloque 6) con Tipo='Reembolsar' no
    // encaja semánticamente — ese enum tiene 4 valores fijos. Mejor
    // tabla: log a Acciones_Lead via campo Detalles (acepta texto
    // libre). Esto es el patrón usado en Sprint 11 marcar_atendido.
    // Si el paciente tiene leadOrigenId, vinculamos al lead; si no,
    // creamos una nota en paciente.notas.
    const fechaTxt = dt.toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const detalles = `Llamada de cobranza agendada para ${fechaTxt}${p.nota ? ` — ${p.nota}` : ""}`;
    if (access.paciente.leadOrigenId) {
      await logAccionLead({
        leadId: access.paciente.leadOrigenId,
        tipo: "Nota",
        usuarioId: env.session.userId,
        detalles: `[Cobranza] ${detalles}`,
      });
    } else {
      // Sin lead origen: append a paciente.notas via Airtable.
      const notaPrev = String(((await base(TABLES.patients as any).find(access.paciente.id)).fields as any)?.["Notas"] ?? "");
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const append = `[${stamp} · Cobranza] ${detalles}`;
      await base(TABLES.patients as any).update(access.paciente.id, {
        Notas: notaPrev ? `${notaPrev}\n${append}` : append,
      } as any);
    }
    return {
      ok: true,
      message: `✓ Llamada de cobranza agendada para ${access.paciente.nombre} (${fechaTxt}).`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al agendar llamada.",
    };
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export async function execAction(env: ExecEnv, action: CopilotAction): Promise<ExecResult> {
  try {
    switch (action.tool) {
      case "cambiar_estado_lead":
        return await execCambiarEstadoLead(env, action.params);
      case "marcar_lead_llamado":
        return await execMarcarLeadLlamado(env, action.params);
      case "enviar_whatsapp_lead":
        return await execEnviarWhatsappLead(env, action.params);
      case "enviar_whatsapp_presupuesto":
        return await execEnviarWhatsappPresupuesto(env, action.params);
      case "anadir_nota_lead":
        return await execAnadirNotaLead(env, action.params);
      case "anadir_nota_presupuesto":
        return await execAnadirNotaPresupuesto(env, action.params);
      case "cambiar_estado_presupuesto":
        return await execCambiarEstadoPresupuesto(env, action.params);
      case "marcar_atendido_actuar_hoy":
        return await execMarcarAtendido(env, action.params);
      // Sprint 14b Bloque 8 — modulo financiero.
      case "enviar_recordatorio_pago":
        return await execEnviarRecordatorioPago(env, action.params);
      case "marcar_pago_recibido":
        return await execMarcarPagoRecibido(env, action.params);
      case "agendar_llamada_cobranza":
        return await execAgendarLlamadaCobranza(env, action.params);
      // Sprint 17 Bloque 8 — Voice IA.
      case "iniciar_llamada_confirmacion":
        return await execIniciarLlamadaConfirmacion(action.params);
    }
  } catch (err) {
    console.error("[copilot exec]", action.tool, err instanceof Error ? err.message : err);
    return { ok: false, error: "Error al ejecutar la acción" };
  }
}

// ─── Sprint 17 — execIniciarLlamadaConfirmacion ─────────────────────────

async function execIniciarLlamadaConfirmacion(
  params: Record<string, unknown>,
): Promise<ExecResult> {
  const citaId = String(params.citaId ?? "");
  if (!citaId.startsWith("rec")) {
    return { ok: false, error: "citaId inválido (no empieza por rec)" };
  }
  const { iniciarLlamada } = await import("../llamadas/iniciar");
  // Tool del Copilot = acción humana confirmada → manual=true.
  // El cron daily NUNCA pasa por aquí (llama iniciarLlamada directo
  // sin manual y respeta horario).
  const r = await iniciarLlamada({
    citaId,
    tipo: "confirmacion_cita",
    manual: true,
  });
  if (!r.ok) {
    const motivos: Record<string, string> = {
      paciente_sin_telefono: "Paciente sin teléfono.",
      paciente_optout: "Paciente con opt-out activado.",
      cooldown: "Cooldown 24h activo (ya llamado o WA reciente).",
      fuera_horario: "Fuera del horario laboral configurado.",
      limite_clinica: "Límite diario de llamadas alcanzado.",
      pausa_automatica: "Pausa automática por tasa de fallidas alta.",
      vapi_error: "Vapi devolvió error.",
      config_incompleta: "Config Vapi incompleta en el entorno.",
      cita_no_existe: "Cita no encontrada.",
    };
    return {
      ok: false,
      error: `${motivos[r.motivo] ?? r.motivo}${r.detalle ? ` (${r.detalle})` : ""}`,
    };
  }
  return {
    ok: true,
    message: `Llamada IA iniciada (Vapi call ${r.llamada.vapiCallId?.slice(0, 8) ?? "?"}…). Verás el resultado en /llamadas en unos minutos.`,
  };
}
