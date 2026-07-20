// app/api/presupuestos/cola-envios/route.ts
// GET — lista envíos del día (o filtro por fecha/estado)
// PATCH — actualizar estado de un envío

import { selectColaEnviosRaw, createColaEnvioRaw, findColaEnvioRaw, updateColaEnvioRaw } from "../../../lib/presupuestos/cola-envios-repo";
import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import type { EnvioItem, EstadoEnvio } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  verificarPresupuestoPermitido,
  mapaPresupuestoClinica,
} from "../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

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
export const GET = withPresupuestosAuth(async (session, req: Request) => {
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

    const recs = await selectColaEnviosRaw({
        fields: [
          "Presupuesto", "Paciente", "Telefono", "Contenido",
          "Tipo", "Estado", "Programado_para", "Enviado_en", "Plantilla_usada",
          "Tratamiento", "Importe", "Doctor",
        ],
        filterByFormula,
        sort: [{ field: "Tipo", direction: "asc" }],
        maxRecords: 500,
      });

    let envios = recs.map(recordToEnvio);

    // Sprint B Fase 4 — la cola no guarda la clínica; resolvemos presupuesto ->
    // clínica en lote y filtramos a las clínicas permitidas (null = admin).
    const permitidas = await nombresClinicasPermitidas(session);
    if (permitidas) {
      const clinicaPorPresup = await mapaPresupuestoClinica(
        envios.map((e) => e.presupuestoId),
      );
      envios = envios.filter((e) =>
        permiteClinica(permitidas, clinicaPorPresup.get(e.presupuestoId) ?? ""),
      );
    }

    return NextResponse.json({ envios });
  } catch (err) {
    console.error("[cola-envios] GET error:", err);
    return NextResponse.json({ envios: [], error: "Error al cargar envíos" });
  }
});

// POST — crear un envío individual (desde campañas de reactivación, etc.)
export const POST = withPresupuestosAuth(async (session, req: Request) => {
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

    // Sprint B Fase 4 (IDOR): solo se encola un envío sobre un presupuesto de una
    // clínica del usuario.
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
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

    await createColaEnvioRaw(fields);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cola-envios] POST error:", err);
    return NextResponse.json({ error: "Error al crear envío" }, { status: 500 });
  }
});

// PATCH — actualizar estado de un envío
export const PATCH = withPresupuestosAuth(async (session, req: Request) => {
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
    const rec = await findColaEnvioRaw(id);
    const f = rec.fields as any;

    // Sprint B Fase 4 (IDOR): marcar "Enviado" dispara el envío real; solo se
    // opera sobre envíos de un presupuesto de una clínica del usuario.
    const presupuestoIdEnvio = String(f["Presupuesto"] ?? "");
    if (presupuestoIdEnvio) {
      const permiso = await verificarPresupuestoPermitido(session, presupuestoIdEnvio);
      if (permiso !== "ok") {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
    }

    // Update the record
    await updateColaEnvioRaw(id, update);

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
});
