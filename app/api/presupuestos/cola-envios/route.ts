// app/api/presupuestos/cola-envios/route.ts
// GET — lista envíos del día (o filtro por fecha/estado)
// PATCH — actualizar estado de un envío

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import type { UserSession, EnvioItem, EstadoEnvio } from "../../../lib/presupuestos/types";

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

function recordToEnvio(r: any): EnvioItem {
  const f = r.fields as any;
  return {
    id: r.id,
    presupuestoId: String(f["Presupuesto"] ?? ""),
    paciente: String(f["Paciente"] ?? ""),
    telefono: String(f["Telefono"] ?? ""),
    contenido: String(f["Contenido"] ?? ""),
    tipo: f["Tipo"] ?? "Primer contacto",
    estado: f["Estado"] ?? "Pendiente",
    programadoPara: String(f["Programado_para"] ?? ""),
    enviadoEn: f["Enviado_en"] ? String(f["Enviado_en"]) : undefined,
    plantillaUsada: String(f["Plantilla_usada"] ?? ""),
    tratamiento: f["Tratamiento"] ? String(f["Tratamiento"]) : undefined,
    importe: f["Importe"] != null ? Number(f["Importe"]) : undefined,
    doctor: f["Doctor"] ? String(f["Doctor"]) : undefined,
  };
}

// GET — lista envíos
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const fecha = url.searchParams.get("fecha") || DateTime.now().setZone(ZONE).toISODate()!;
    const estadoFilter = url.searchParams.get("estado") || "";

    const filterParts: string[] = [
      `IS_SAME({Programado_para},'${fecha}','day')`,
    ];
    if (estadoFilter) {
      filterParts.push(`{Estado}='${estadoFilter}'`);
    }

    const filterByFormula = filterParts.length === 1
      ? filterParts[0]
      : `AND(${filterParts.join(", ")})`;

    const recs = await base(TABLES.colaEnvios as any)
      .select({
        fields: [
          "Presupuesto", "Paciente", "Telefono", "Contenido",
          "Tipo", "Estado", "Programado_para", "Enviado_en", "Plantilla_usada",
          "Tratamiento", "Importe", "Doctor",
        ],
        filterByFormula,
        sort: [{ field: "Tipo", direction: "asc" }],
        maxRecords: 500,
      })
      .all();

    const envios = recs.map(recordToEnvio);

    return NextResponse.json({ envios });
  } catch (err) {
    console.error("[cola-envios] GET error:", err);
    return NextResponse.json({ envios: [], error: "Error al cargar envíos" });
  }
}

// POST — crear un envío individual (desde campañas de reactivación, etc.)
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { presupuestoId, paciente, telefono, contenido, tipo, plantillaUsada, tratamiento, importe, doctor } = body as {
      presupuestoId: string;
      paciente: string;
      telefono: string;
      contenido: string;
      tipo: string;
      plantillaUsada?: string;
      tratamiento?: string;
      importe?: number;
      doctor?: string;
    };

    if (!presupuestoId || !paciente) {
      return NextResponse.json({ error: "presupuestoId y paciente requeridos" }, { status: 400 });
    }

    const now = DateTime.now().setZone(ZONE);
    const programadoPara = `${now.toISODate()!}T09:00:00`;

    const fields: Record<string, any> = {
      Presupuesto: presupuestoId,
      Paciente: paciente,
      Telefono: telefono || "",
      Contenido: contenido || "",
      Tipo: tipo || "Reactivacion",
      Estado: "Pendiente",
      Programado_para: programadoPara,
      Plantilla_usada: plantillaUsada || "",
    };
    if (tratamiento) fields.Tratamiento = tratamiento;
    if (importe != null) fields.Importe = importe;
    if (doctor) fields.Doctor = doctor;

    await (base(TABLES.colaEnvios as any).create as any)(fields);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cola-envios] POST error:", err);
    return NextResponse.json({ error: "Error al crear envío" }, { status: 500 });
  }
}

// PATCH — actualizar estado de un envío
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, estado } = body as { id: string; estado: EstadoEnvio };

    if (!id || !estado) {
      return NextResponse.json({ error: "id y estado requeridos" }, { status: 400 });
    }

    const validEstados: EstadoEnvio[] = ["Enviado", "Fallido", "Cancelado"];
    if (!validEstados.includes(estado)) {
      return NextResponse.json({ error: "estado inválido" }, { status: 400 });
    }

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    const update: Record<string, any> = { Estado: estado };
    if (estado === "Enviado") {
      update.Enviado_en = now;
    }

    // First fetch the record to get details for mensajería
    const rec = await base(TABLES.colaEnvios as any).find(id);
    const f = rec.fields as any;

    // Update the record
    await base(TABLES.colaEnvios as any).update(id, update as any);

    // If sent, also register in Mensajes_WhatsApp
    if (estado === "Enviado") {
      const telefono = String(f["Telefono"] ?? "");
      const contenido = String(f["Contenido"] ?? "");
      const presupuestoId = String(f["Presupuesto"] ?? "");

      if (telefono && contenido) {
        try {
          const svc = getServicioMensajeria("manual");
          await svc.enviarMensaje({
            presupuestoId,
            telefono,
            contenido,
            fuente: "Plantilla_automatica",
          });
        } catch (err) {
          console.error("[cola-envios] Error registering in Mensajes_WhatsApp:", err);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cola-envios] PATCH error:", err);
    return NextResponse.json({ error: "Error al actualizar envío" }, { status: 500 });
  }
}
