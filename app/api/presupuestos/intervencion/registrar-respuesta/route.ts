// app/api/presupuestos/intervencion/registrar-respuesta/route.ts
// POST — registra una acción (WA enviado, llamada, respuesta recibida)

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import { DateTime } from "luxon";
import { registrarAccion } from "../../../../lib/historial/registrar";
import { clasificarRespuesta, guardarClasificacion } from "../../../../lib/presupuestos/intervencion";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { crearNotificacion } from "../../../../lib/presupuestos/notificaciones";
import type { UserSession, TipoUltimaAccionIntervencion, PresupuestoEstado } from "../../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

const TIPO_MAP: Record<string, { contactTipo: string; label: string }> = {
  "WhatsApp enviado":         { contactTipo: "whatsapp", label: "WhatsApp enviado" },
  "Llamada realizada":        { contactTipo: "llamada",  label: "Llamada realizada" },
  "Mensaje recibido":         { contactTipo: "whatsapp", label: "Mensaje recibido del paciente" },
  "Sin respuesta tras llamada": { contactTipo: "llamada", label: "Sin respuesta tras llamada" },
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

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

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    // Actualizar campos de intervención en Presupuestos
    try {
      await base(TABLES.presupuestos as any).update(presupuestoId, {
        Ultima_accion_registrada: now,
        Tipo_ultima_accion: tipo,
      } as any);
    } catch (err) {
      console.error("[registrar-respuesta] Airtable update error:", err);
    }

    // Crear contacto en Contactos_Presupuesto
    const mapping = TIPO_MAP[tipo];
    if (mapping) {
      try {
        await base(TABLES.contactosPresupuesto as any).create({
          PresupuestoId: presupuestoId,
          TipoContacto: mapping.contactTipo,
          Resultado: tipo === "Sin respuesta tras llamada" ? "no contestó" : "contestó",
          FechaHora: now,
          Nota: notas || mensaje || undefined,
          RegistradoPor: session.email,
        } as any);

        // Incrementar ContactCount
        const presRecs = await base(TABLES.presupuestos as any)
          .select({
            filterByFormula: `RECORD_ID()='${presupuestoId}'`,
            fields: ["ContactCount"],
            maxRecords: 1,
          })
          .all();
        const currentCount = presRecs.length
          ? Number((presRecs[0].fields as any)["ContactCount"] ?? 0)
          : 0;
        await base(TABLES.presupuestos as any).update(presupuestoId, {
          UltimoContacto: now.slice(0, 10),
          ContactCount: currentCount + 1,
        } as any);
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
        const recs = await base(TABLES.presupuestos as any)
          .select({
            filterByFormula: `RECORD_ID()='${presupuestoId}'`,
            fields: ["Paciente_nombre", "Tratamiento_nombre", "Importe", "Estado", "Clinica"],
            maxRecords: 1,
          })
          .all();

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
      const telRecs = await base(TABLES.presupuestos as any)
        .select({
          filterByFormula: `RECORD_ID()='${presupuestoId}'`,
          fields: ["Paciente_Telefono", "Teléfono"],
          maxRecords: 1,
        })
        .all();
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
}
