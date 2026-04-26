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
    }
  } catch (err) {
    console.error("[copilot exec]", action.tool, err instanceof Error ? err.message : err);
    return { ok: false, error: "Error al ejecutar la acción" };
  }
}
