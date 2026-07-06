// app/api/presupuestos/plantillas/route.ts
// CRUD para plantillas de mensaje

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { PlantillaMensaje } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

function recordToPlantilla(r: any): PlantillaMensaje {
  const f = r.fields as any;
  return {
    id: r.id,
    nombre: String(f["Nombre"] ?? ""),
    tipo: f["Tipo"] ?? "Primer contacto",
    clinica: String(f["Clinica"] ?? "Todas"),
    doctor: String(f["Doctor"] ?? ""),
    tratamiento: String(f["Tratamiento"] ?? ""),
    contenido: String(f["Contenido"] ?? ""),
    activa: f["Activa"] === true,
    fechaCreacion: f["Fecha_creacion"] ? String(f["Fecha_creacion"]) : "",
  };
}

// GET — lista plantillas
export const GET = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const url = new URL(req.url);
    // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión (+ bucket
    // 'Todas' de plantillas de red). Una clínica pedida solo cuenta si está
    // permitida; si no, todas las permitidas (null = admin, sin restricción).
    const permitidas = await nombresClinicasPermitidas(session);
    const clinicaQuery = url.searchParams.get("clinica") || "";
    const tipoFilter = url.searchParams.get("tipo") || "";
    const clinicaFormula =
      clinicaQuery && permiteClinica(permitidas, clinicaQuery)
        ? formulaClinicaPermitida(new Set([clinicaQuery]), "Clinica", "Todas")
        : formulaClinicaPermitida(permitidas, "Clinica", "Todas");

    let filterParts: string[] = [];
    if (clinicaFormula) {
      filterParts.push(clinicaFormula);
    }
    if (tipoFilter) {
      filterParts.push(`{Tipo}='${tipoFilter}'`);
    }

    const selectOpts: any = {
      fields: ["Nombre", "Tipo", "Clinica", "Doctor", "Tratamiento", "Contenido", "Activa", "Fecha_creacion"],
      sort: [{ field: "Tipo", direction: "asc" }, { field: "Nombre", direction: "asc" }],
    };
    if (filterParts.length > 0) {
      selectOpts.filterByFormula = filterParts.length === 1
        ? filterParts[0]
        : `AND(${filterParts.join(", ")})`;
    }

    const recs = await base(TABLES.plantillasMensaje as any).select(selectOpts).all();
    const plantillas = recs.map(recordToPlantilla);

    return NextResponse.json({ plantillas });
  } catch (err) {
    console.error("[plantillas] GET error:", err);
    return NextResponse.json({ plantillas: [], error: "Error al cargar plantillas" });
  }
});

// POST — crear plantilla
export const POST = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { nombre, tipo, clinica, doctor, tratamiento, contenido } = body as {
      nombre: string;
      tipo: string;
      clinica?: string;
      doctor?: string;
      tratamiento?: string;
      contenido: string;
    };

    if (!nombre || !tipo || !contenido) {
      return NextResponse.json({ error: "nombre, tipo y contenido son requeridos" }, { status: 400 });
    }

    // Sprint B Fase 4 — la plantilla creada debe ser de una clínica permitida. Un
    // coord no puede crear plantillas de red ('Todas') ni de otra clínica.
    const clinicaVal = clinica || "Todas";
    const permitidas = await nombresClinicasPermitidas(session);
    if (!permiteClinica(permitidas, clinicaVal)) {
      return NextResponse.json({ error: "Clínica no permitida" }, { status: 403 });
    }

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    const rec = await (base(TABLES.plantillasMensaje as any).create as any)({
      Nombre: nombre,
      Tipo: tipo,
      Clinica: clinicaVal,
      Doctor: doctor || "",
      Tratamiento: tratamiento || "",
      Contenido: contenido,
      Activa: true,
      Fecha_creacion: now,
    });

    return NextResponse.json({ ok: true, plantilla: recordToPlantilla(rec) });
  } catch (err) {
    console.error("[plantillas] POST error:", err);
    return NextResponse.json({ error: "Error al crear plantilla" }, { status: 500 });
  }
});

// PUT — actualizar plantilla
export const PUT = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { id, nombre, tipo, clinica, doctor, tratamiento, contenido, activa } = body as {
      id: string;
      nombre?: string;
      tipo?: string;
      clinica?: string;
      doctor?: string;
      tratamiento?: string;
      contenido?: string;
      activa?: boolean;
    };

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    // Sprint B Fase 4 — la plantilla existente (por id) debe pertenecer a una
    // clínica permitida; y si se cambia la clínica, la nueva también. Evita que
    // un coord edite/mueva una plantilla de otra clínica.
    const permitidas = await nombresClinicasPermitidas(session);
    const existingRec = await base(TABLES.plantillasMensaje as any).find(id).catch(() => null);
    if (!existingRec) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    const clinicaActual = String((existingRec.fields as any)["Clinica"] ?? "Todas");
    if (!permiteClinica(permitidas, clinicaActual)) {
      return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
    }
    if (clinica !== undefined && !permiteClinica(permitidas, clinica)) {
      return NextResponse.json({ error: "Clínica no permitida" }, { status: 403 });
    }

    const update: Record<string, any> = {};
    if (nombre !== undefined) update.Nombre = nombre;
    if (tipo !== undefined) update.Tipo = tipo;
    if (clinica !== undefined) update.Clinica = clinica;
    if (doctor !== undefined) update.Doctor = doctor;
    if (tratamiento !== undefined) update.Tratamiento = tratamiento;
    if (contenido !== undefined) update.Contenido = contenido;
    if (activa !== undefined) update.Activa = activa;

    await base(TABLES.plantillasMensaje as any).update(id, update as any);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[plantillas] PUT error:", err);
    return NextResponse.json({ error: "Error al actualizar plantilla" }, { status: 500 });
  }
});

// DELETE — eliminar plantilla
export const DELETE = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { id } = body as { id: string };

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    // Sprint B Fase 4 — solo se puede borrar una plantilla de una clínica permitida.
    const permitidas = await nombresClinicasPermitidas(session);
    const existingRec = await base(TABLES.plantillasMensaje as any).find(id).catch(() => null);
    if (!existingRec) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    const clinicaActual = String((existingRec.fields as any)["Clinica"] ?? "Todas");
    if (!permiteClinica(permitidas, clinicaActual)) {
      return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
    }

    await base(TABLES.plantillasMensaje as any).destroy(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[plantillas] DELETE error:", err);
    return NextResponse.json({ error: "Error al eliminar plantilla" }, { status: 500 });
  }
});
