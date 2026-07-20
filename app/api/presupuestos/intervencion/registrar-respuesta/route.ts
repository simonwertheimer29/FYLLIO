// app/api/presupuestos/intervencion/registrar-respuesta/route.ts
// POST — registra una acción (WA enviado, llamada, respuesta recibida)

import { NextResponse } from "next/server";
import { getPresupuestoPorIdRaw, updatePresupuestoRaw } from "../../../../lib/presupuestos/repo";
import { createContactoRaw } from "../../../../lib/presupuestos/contactos";
import { base, TABLES } from "../../../../lib/airtable";
import { DateTime } from "luxon";
import { registrarAccion } from "../../../../lib/historial/registrar";
import { clasificarRespuesta, guardarClasificacion } from "../../../../lib/presupuestos/intervencion";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { crearNotificacion } from "../../../../lib/presupuestos/notificaciones";
import type { TipoUltimaAccionIntervencion, PresupuestoEstado } from "../../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

const TIPO_MAP: Record<string, { contactTipo: string; label: string }> = {
  "WhatsApp enviado":         { contactTipo: "whatsapp", label: "WhatsApp enviado" },
  "Llamada realizada":        { contactTipo: "llamada",  label: "Llamada realizada" },
  "Mensaje recibido":         { contactTipo: "whatsapp", label: "Mensaje recibido del paciente" },
  "Sin respuesta tras llamada": { contactTipo: "llamada", label: "Sin respuesta tras llamada" },
};

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const {
      presupuestoId,
      tipo,
      mensaje,
      notas,
    } = body as {
      presupuestoId: string;
      tipo: TipoUltimaAccionIntervencion;
      mensaje?: string;
      notas?: string;
    };

    if (!presupuestoId || !tipo) {
      return NextResponse.json({ error: "presupuestoId y tipo son requeridos" }, { status: 400 });
    }

    // Sprint B Fase 4 (IDOR): solo se registra/muta sobre un presupuesto de una
    // clínica del usuario.
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    // Actualizar campos de intervención en Presupuestos. Una acción SALIENTE
    // (WhatsApp/llamada) deja el caso "esperando respuesta": la pelota pasa al
    // paciente. Fase_seguimiento lo persiste y mantiene el caso visible en la
    // cola (si no, un envío sin urgencia previa desaparecía). Vuelve solo:
    // el webhook entrante pone "En intervención" al recibir respuesta.
    const dejaEsperandoRespuesta =
      tipo === "WhatsApp enviado" || tipo === "Llamada realizada";
    try {
      await updatePresupuestoRaw(presupuestoId, {
        Ultima_accion_registrada: now,
        Tipo_ultima_accion: tipo,
        ...(dejaEsperandoRespuesta ? { Fase_seguimiento: "Esperando respuesta" } : {}),
      });
    } catch (err) {
      console.error("[registrar-respuesta] Airtable update error:", err);
    }

    // Crear contacto en Contactos_Presupuesto
    const mapping = TIPO_MAP[tipo];
    if (mapping) {
      try {
        await createContactoRaw({
          PresupuestoId: presupuestoId,
          TipoContacto: mapping.contactTipo,
          Resultado: tipo === "Sin respuesta tras llamada" ? "no contestó" : "contestó",
          FechaHora: now,
          Nota: notas || mensaje || undefined,
          RegistradoPor: session.email,
        });

        // Incrementar ContactCount
        const presRec0 = await getPresupuestoPorIdRaw(presupuestoId, ["ContactCount"]);
        const presRecs = presRec0 ? [presRec0] : [];
        const currentCount = presRecs.length
          ? Number((presRecs[0].fields as any)["ContactCount"] ?? 0)
          : 0;
        await updatePresupuestoRaw(presupuestoId, {
          UltimoContacto: now.slice(0, 10),
          ContactCount: currentCount + 1,
        });
      } catch (err) {
        console.error("[registrar-respuesta] Contacto creation error:", err);
      }
    }

    // Registrar en historial
    await registrarAccion({
      presupuestoId,
      tipo: "contacto",
      descripcion: mapping?.label ?? tipo,
      metadata: { tipo, mensaje: mensaje?.slice(0, 200), notas: notas?.slice(0, 200) },
      registradoPor: session.nombre || session.email,
    });

    // Si es "Mensaje recibido" con texto, clasificar automáticamente
    let clasificacion = undefined;
    if (tipo === "Mensaje recibido" && mensaje) {
      try {
        const rec1 = await getPresupuestoPorIdRaw(presupuestoId, ["Paciente_nombre", "Tratamiento_nombre", "Importe", "Estado", "Clinica"]);
        const recs = rec1 ? [rec1] : [];

        if (recs.length > 0) {
          const f = recs[0].fields as any;
          const patientName = Array.isArray(f["Paciente_nombre"])
            ? String(f["Paciente_nombre"][0] ?? "")
            : String(f["Paciente_nombre"] ?? "");
          const treatments = String(f["Tratamiento_nombre"] ?? "")
            .split(/[,+]/)
            .map((t: string) => t.trim())
            .filter(Boolean);
          const amount = f["Importe"] != null ? Number(f["Importe"]) : undefined;
          const estado = String(f["Estado"] ?? "PRESENTADO") as PresupuestoEstado;
          const clinica = Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? "");

          clasificacion = await clasificarRespuesta({
            respuestaPaciente: mensaje,
            patientName,
            treatments,
            estado,
            amount,
            clinica: clinica || undefined,
          });

          await guardarClasificacion({
            presupuestoId,
            respuestaPaciente: mensaje,
            clasificacion,
            registradoPor: session.nombre || session.email,
          });

          // Notificación urgente
          if (clasificacion.urgencia === "CRÍTICO") {
            crearNotificacion({
              tipo: "Intervencion_urgente",
              titulo: `Intervención urgente: ${patientName}`,
              mensaje: `${patientName} respondió: "${clasificacion.intencion}". ${clasificacion.accionSugerida}`,
            }).catch(() => {});
          }

          // Notificación nuevo mensaje
          crearNotificacion({
            tipo: "Nuevo_mensaje_paciente",
            titulo: `Nuevo mensaje de ${patientName}`,
            mensaje: (mensaje ?? "").slice(0, 100),
          }).catch(() => {});
        }
      } catch (err) {
        console.error("[registrar-respuesta] Auto-clasificación error:", err);
      }
    }

    // Persistir en Mensajes_WhatsApp (fire-and-forget)
    const servicio = getServicioMensajeria("manual");
    if (tipo === "WhatsApp enviado" && mensaje) {
      // Obtener teléfono del presupuesto
      const telRec0 = await getPresupuestoPorIdRaw(presupuestoId, ["Paciente_Telefono", "Teléfono"]);
      const telRecs = telRec0 ? [telRec0] : [];
      const telF = telRecs.length ? (telRecs[0].fields as any) : {};
      const telefono = telF["Paciente_Telefono"]
        ? String(telF["Paciente_Telefono"])
        : Array.isArray(telF["Teléfono"])
          ? String(telF["Teléfono"][0] ?? "")
          : String(telF["Teléfono"] ?? "");
      if (telefono) {
        servicio.enviarMensaje({
          presupuestoId,
          telefono,
          contenido: mensaje,
        }).catch(() => {});
      }
    } else if (tipo === "Mensaje recibido" && mensaje) {
      servicio.recibirMensaje({
        presupuestoId,
        telefono: "",
        contenido: mensaje,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, clasificacion });
  } catch (err) {
    console.error("[registrar-respuesta] error:", err);
    return NextResponse.json(
      { error: "Error al registrar respuesta" },
      { status: 500 }
    );
  }
});
